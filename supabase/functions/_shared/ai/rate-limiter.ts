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
 * Tambah penghitung SETELAH panggilan AI sukses.
 * units: 1 untuk fitur berbasis panggilan; jumlah DETIK untuk voice.
 */
export async function commitQuota(
  supabase: SupabaseClient,
  feature: QuotaFeature,
  units = 1,
): Promise<void> {
  try {
    await supabase.rpc('ai_quota_commit', { p_feature: feature, p_units: units })
  } catch {
    // Gagal mencatat pemakaian tidak boleh menggagalkan respons yang sudah jadi.
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
