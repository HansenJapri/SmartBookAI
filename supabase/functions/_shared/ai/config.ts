// ============================================================
// Peta routing API key & model AI — SUMBER KEBENARAN TUNGGAL.
//
// Semua Edge Function AI WAJIB mengambil key & model dari sini lewat
// getGeminiClient(feature). Jangan hardcode key/model di tempat lain, supaya
// perubahan routing cukup dilakukan di satu berkas ini.
//
// Key disimpan sebagai secret Supabase: GEMINI_KEY_A / _B / _C.
// (GEMINI_API_KEY lama dipakai sebagai cadangan agar deployment lama tidak mati.)
// ============================================================

export type FeatureName =
  | 'insight_dashboard'
  | 'insight_stok'
  | 'chat'
  | 'crud'
  | 'ocr'
  | 'voice_live'
  | 'voice_tts'

export type KeySlot = 'A' | 'B' | 'C'

export interface FeatureRoute {
  key: KeySlot
  model: string
  /** Model cadangan bila percobaan pertama gagal validasi (maks 1x retry). */
  fallbackModel?: string
  /** Nama fitur untuk penghitung kuota (workspace_ai_usage.feature). */
  quotaFeature: 'insight_dashboard' | 'insight_stok' | 'chat' | 'crud' | 'ocr' | 'voice'
  /** Batas harian per WORKSPACE. Voice dalam DETIK, sisanya jumlah panggilan. */
  dailyCap: number
}

// Nama model sudah dicocokkan dengan daftar Rate Limit di Google AI Studio.
// Fallback SENGAJA hanya bertukar antar dua model Flash-Lite (3.5 <-> 3.1):
// keduanya bucket RPD terpisah, jadi retry tidak memakan kuota model pertama,
// dan kita tidak perlu menyentuh Gemini 3.6 Flash yang RPD-nya jauh lebih kecil
// (20/hari) dibanding Flash-Lite (500/hari).
export const FEATURE_ROUTES: Record<FeatureName, FeatureRoute> = {
  insight_dashboard: {
    key: 'A',
    model: 'gemini-3.5-flash-lite',
    quotaFeature: 'insight_dashboard',
    dailyCap: 10,
  },
  chat: {
    key: 'A',
    model: 'gemini-3.1-flash-lite',
    quotaFeature: 'chat',
    dailyCap: 10,
  },
  insight_stok: {
    key: 'B',
    model: 'gemini-3.5-flash-lite',
    quotaFeature: 'insight_stok',
    dailyCap: 10,
  },
  voice_live: {
    key: 'B',
    model: 'gemini-2.5-flash-native-audio-dialog',
    quotaFeature: 'voice',
    dailyCap: 10 * 60, // 10 menit, disimpan sebagai DETIK
  },
  voice_tts: {
    key: 'B',
    model: 'gemini-2.5-flash-tts',
    quotaFeature: 'voice',
    dailyCap: 10 * 60,
  },
  crud: {
    key: 'C',
    model: 'gemini-3.5-flash-lite',
    fallbackModel: 'gemini-3.1-flash-lite',
    quotaFeature: 'crud',
    dailyCap: 10,
  },
  ocr: {
    key: 'C',
    model: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-3.5-flash-lite',
    quotaFeature: 'ocr',
    dailyCap: 10,
  },
}

/** Ambil nilai API key untuk slot tertentu dari environment. */
export function resolveKey(slot: KeySlot): string | undefined {
  const direct = Deno.env.get(`GEMINI_KEY_${slot}`)
  if (direct) return direct
  // Cadangan: proyek lama hanya punya satu key project-wide.
  return Deno.env.get('GEMINI_API_KEY') ?? undefined
}
