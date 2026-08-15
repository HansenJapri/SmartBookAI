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
}

/** Bentuk error terstruktur saat kuota harian habis. */
export interface DailyLimitError {
  error: string
  code: 'DAILY_LIMIT_REACHED'
  feature: QuotaFeature
  used: number
  cap: number
  resetAt: string | null
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
  const { data, error } = await supabase.rpc('ai_quota_check', {
    p_feature: feature,
    p_limit: cap,
  })
  if (error) {
    // Tetap fail-closed demi biaya — tapi ditandai `unavailable` supaya
    // pemanggil bisa membedakannya dari kuota yang sungguh habis.
    console.error('ai_quota_check gagal', feature, error.message)
    return { allowed: false, used: cap, cap, resetAt: null, unavailable: true }
  }
  const row = Array.isArray(data) ? data[0] : data
  return {
    allowed: Boolean(row?.allowed),
    used: Number(row?.used ?? 0),
    cap: Number(row?.cap ?? cap),
    resetAt: row?.reset_at ?? null,
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

/** Susun payload error 429 yang terstruktur & ramah pengguna. */
export function dailyLimitPayload(
  feature: QuotaFeature,
  status: QuotaStatus,
): DailyLimitError {
  const label = FEATURE_LABEL_ID[feature] ?? feature
  const unit = feature === 'voice' ? 'menit' : 'kali'
  const capShown = feature === 'voice' ? Math.round(status.cap / 60) : status.cap
  return {
    error: `Kuota harian ${label} untuk usaha Anda sudah habis (${capShown} ${unit}/hari). `
      + 'Kuota dibagi bersama seluruh anggota dan direset otomatis besok. '
      + 'Sementara itu Anda tetap bisa memakai form manual tanpa batas.',
    code: 'DAILY_LIMIT_REACHED',
    feature,
    used: status.used,
    cap: status.cap,
    resetAt: status.resetAt,
  }
}
