// ============================================================
// Rate limiter AI — kuota dihitung PER WORKSPACE (owner), bukan per user.
//
// Alur wajib di setiap endpoint AI:
//   1. checkQuota()  SEBELUM memanggil Gemini. Kalau habis → tolak, jangan
//      panggil API sama sekali (hemat kuota asli).
//   2. commitQuota() HANYA setelah panggilan AI benar-benar sukses.
//
// Reset harian mengikuti tengah malam Pacific (lihat migration_ai_workspace_quota.sql).
// ============================================================
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type QuotaFeature =
  | 'insight_dashboard'
  | 'insight_stok'
  | 'chat'
  | 'crud'
  | 'ocr'
  | 'catat'
  | 'hpp_draft'
  | 'voice'

export interface QuotaStatus {
  allowed: boolean
  used: number
  cap: number
  resetAt: string | null
  /**
   * true = penghitung kuota TIDAK BISA DIBACA (RPC belum ter-deploy, izin
   * dicabut), bukan kuota yang benar-benar habis.
   *
   * Dua keadaan ini sama-sama menghasilkan allowed=false, tapi artinya jauh
   * berbeda bagi yang membaca pesannya: yang satu "tunggu besok", yang satu
   * "ada migration yang belum dijalankan". Menyamakan keduanya di balik satu
   * pesan "kuota habis" pernah membuat berjam-jam terbuang mencari penyebab
   * yang sebenarnya tertulis jelas di log.
   */
  unavailable?: boolean

  // ---- Fase 2: dua penghitung berdampingan ----
  /**
   * APA yang memblokir, bukan sekadar bahwa sesuatu memblokir.
   *
   * 'daily'     → guardrail teknis; tunggu reset, kredit TIDAK terpotong
   * 'credits'   → jatah komersial habis; bisa dibeli/di-upgrade sekarang
   * 'suspended' → dimatikan admin secara sadar
   *
   * Perbedaan 'daily' dan 'credits' adalah perbedaan antara "tunggu tiga jam"
   * dan "beli lagi" — dua kalimat yang sangat berbeda bagi pemilik toko, dan
   * dua tindakan yang sangat berbeda bagi tim penjualan.
   */
  blockedBy?: 'daily' | 'credits' | 'suspended' | 'no_workspace' | null
  creditsUsed?: number
  /** null = tanpa batas kredit (Enterprise). */
  creditsCap?: number | null
  cycleStart?: string | null
  cycleEnd?: string | null
  planCode?: string | null
}

/** Bentuk error terstruktur saat sebuah permintaan AI ditolak kuota. */
export interface QuotaBlockedError {
  error: string
  code: 'DAILY_LIMIT_REACHED' | 'CREDIT_LIMIT_REACHED' | 'AI_SUSPENDED'
  feature: QuotaFeature
  used: number
  cap: number
  resetAt: string | null
  creditsUsed?: number
  creditsCap?: number | null
  cycleEnd?: string | null
  planCode?: string | null
}

const FEATURE_LABEL_ID: Record<QuotaFeature, string> = {
  insight_dashboard: 'Insight AI Dashboard',
  insight_stok: 'Insight AI Stok',
  chat: 'Chat Tanya AI',
  crud: 'Pencatatan via AI',
  ocr: 'Baca struk dengan AI',
  catat: 'Catat dengan kalimat biasa',
  hpp_draft: 'Draf HPP dengan AI',
  voice: 'Fitur suara (voice)',
}

/**
 * Cek kuota TANPA menambah penghitung. Panggil sebelum request ke Gemini.
 */
export async function checkQuota(
  supabase: SupabaseClient,
  feature: QuotaFeature,
  cap: number,
): Promise<QuotaStatus> {
  // `cap` yang dikirim pemanggil (FEATURE_ROUTES.dailyCap) bukan lagi angka
  // penentu, melainkan CADANGAN TERAKHIR — dipakai hanya bila paket maupun
  // override tidak menyebut fitur ini. Urutannya diselesaikan di database:
  // override workspace ?? paket ?? cadangan kode.
  const { data, error } = await supabase.rpc('ai_quota_resolve', {
    p_feature: feature,
    p_fallback_cap: cap,
  })
  if (error) {
    // Tetap fail-closed demi biaya — tapi ditandai `unavailable` supaya
    // pemanggil bisa membedakannya dari kuota yang sungguh habis.
    console.error('ai_quota_resolve gagal', feature, error.message)
    return { allowed: false, used: cap, cap, resetAt: null, unavailable: true }
  }
  const row = Array.isArray(data) ? data[0] : data
  const angka = (v: unknown, bawaan: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : bawaan
  }
  return {
    allowed: Boolean(row?.allowed),
    used: angka(row?.daily_used, 0),
    cap: angka(row?.daily_cap, cap),
    resetAt: row?.daily_reset_at ?? null,
    blockedBy: row?.blocked_by ?? null,
    creditsUsed: angka(row?.credits_used, 0),
    // null di sini berarti TANPA BATAS, jadi ia tidak boleh ikut dijadikan 0
    // oleh pembacaan angka yang ceroboh — 0 berarti kebalikannya persis.
    creditsCap: row?.credits_cap === null || row?.credits_cap === undefined
      ? null
      : Number(row.credits_cap),
    cycleStart: row?.cycle_start ?? null,
    cycleEnd: row?.cycle_end ?? null,
    planCode: row?.plan_code ?? null,
  }
}

/**
 * Telemetri biaya satu panggilan AI. SELURUH field opsional.
 *
 * Opsional bukan karena tidak penting, melainkan karena penghitung kuota harus
 * tetap naik walau telemetrinya tidak tersedia — mis. `ai-narasi` yang kadang
 * menjawab dari cache tanpa menyentuh Gemini. Kuota adalah kebenaran penagihan;
 * telemetri adalah pelengkapnya, dan pelengkap tidak boleh menyandera yang pokok.
 */
export interface QuotaTelemetry {
  model?: string
  keySlot?: string
  promptTokens?: number
  completionTokens?: number
  thinkingTokens?: number
  totalTokens?: number
  /** Token percobaan yang dibuang (gagal validasi lalu diulang). */
  wastedTokens?: number
  latencyMs?: number
  usedFallback?: boolean
  attempts?: number
}

/**
 * Tambah penghitung SETELAH panggilan AI sukses.
 * units: 1 untuk fitur berbasis panggilan; jumlah DETIK untuk voice.
 * telemetry: token & latency dari GenerateResult, bila panggilan Gemini nyata.
 */
export async function commitQuota(
  supabase: SupabaseClient,
  feature: QuotaFeature,
  units = 1,
  telemetry?: QuotaTelemetry,
): Promise<void> {
  const t = telemetry ?? {}
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0)
  try {
    await supabase.rpc('ai_quota_commit', {
      p_feature: feature,
      p_units: units,
      p_prompt_tokens: n(t.promptTokens),
      p_completion_tokens: n(t.completionTokens),
      p_thinking_tokens: n(t.thinkingTokens),
      p_total_tokens: n(t.totalTokens),
      p_wasted_tokens: n(t.wastedTokens),
      p_model: t.model ?? null,
    })
  } catch {
    // Gagal mencatat pemakaian tidak boleh menggagalkan respons yang sudah jadi.
  }
}

/** Ubah GenerateResult jadi telemetri kuota — satu tempat, supaya 8 pemanggil tidak masing-masing salah memetakan. */
export function telemetriDari(
  r: {
    usage?: { prompt: number; completion: number; thinking: number; total: number }
    wastedTokens?: number
    latencyMs?: number
    modelUsed?: string
    usedFallback?: boolean
    attempts?: number
  },
  keySlot?: string,
): QuotaTelemetry {
  return {
    model: r.modelUsed,
    keySlot,
    promptTokens: r.usage?.prompt,
    completionTokens: r.usage?.completion,
    thinkingTokens: r.usage?.thinking,
    totalTokens: r.usage?.total,
    wastedTokens: r.wastedTokens,
    latencyMs: r.latencyMs,
    usedFallback: r.usedFallback,
    attempts: r.attempts,
  }
}

/** Tanggal Indonesia ringkas untuk pesan pengguna: "8 September". */
function tanggalID(iso: string | null | undefined): string {
  if (!iso) return 'siklus berikutnya'
  const BULAN = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ]
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso))
  if (!m) return 'siklus berikutnya'
  return `${Number(m[3])} ${BULAN[Number(m[2]) - 1] ?? ''}`.trim()
}

/**
 * Susun payload 429 yang terstruktur & ramah pengguna.
 *
 * Bercabang pada `blockedBy` karena ketiga sebabnya menuntut TINDAKAN yang
 * berbeda dari pembacanya. Menyeragamkannya jadi satu kalimat "kuota habis"
 * berarti menyuruh orang yang kreditnya habis untuk "menunggu besok" — dan
 * besok ia tetap tidak bisa apa-apa.
 *
 * Dulu bernama dailyLimitPayload(). Namanya diganti karena ia tidak lagi hanya
 * mengurus batas harian, dan nama yang berbohong lebih mahal daripada rename.
 */
export function quotaBlockedPayload(
  feature: QuotaFeature,
  status: QuotaStatus,
): QuotaBlockedError {
  const label = FEATURE_LABEL_ID[feature] ?? feature
  const unit = feature === 'voice' ? 'menit' : 'kali'
  const capShown = feature === 'voice' ? Math.round(status.cap / 60) : status.cap

  const bersama = {
    feature,
    used: status.used,
    cap: status.cap,
    resetAt: status.resetAt,
    creditsUsed: status.creditsUsed,
    creditsCap: status.creditsCap,
    cycleEnd: status.cycleEnd,
    planCode: status.planCode,
  }

  if (status.blockedBy === 'suspended') {
    return {
      ...bersama,
      error: 'Fitur AI untuk akun ini sedang dinonaktifkan oleh admin. '
        + 'Hubungi admin aplikasi untuk mengaktifkannya kembali. '
        + 'Seluruh pencatatan manual tetap bisa Anda pakai seperti biasa.',
      code: 'AI_SUSPENDED',
    }
  }

  if (status.blockedBy === 'credits') {
    const pakai = Math.round(status.creditsUsed ?? 0)
    const jatah = Math.round(status.creditsCap ?? 0)
    return {
      ...bersama,
      error: `Kredit AI usaha Anda untuk siklus ini sudah habis (${pakai} dari ${jatah} kredit). `
        + `Kredit baru terisi pada ${tanggalID(status.cycleEnd)}. `
        + 'Untuk menambah sekarang, tingkatkan paket lewat menu Pengaturan. '
        + 'Sementara itu seluruh form manual tetap bisa dipakai tanpa batas.',
      code: 'CREDIT_LIMIT_REACHED',
    }
  }

  return {
    ...bersama,
    // Kalimat "kredit Anda tidak berkurang" bukan basa-basi: tanpa itu,
    // pengguna yang menabrak guardrail teknis akan mengira jatah komersialnya
    // ikut terpotong, lalu membeli sesuatu yang tidak ia butuhkan.
    error: `Kuota harian ${label} untuk usaha Anda sudah habis (${capShown} ${unit}/hari). `
      + 'Kuota dibagi bersama seluruh anggota dan direset otomatis besok. '
      + 'Kredit Anda tidak berkurang. '
      + 'Sementara itu Anda tetap bisa memakai form manual tanpa batas.',
    code: 'DAILY_LIMIT_REACHED',
  }
}
