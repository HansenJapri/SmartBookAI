// ============================================================
// LAPIS PERTAHANAN KEDUA — blocklist aksi sensitif.
//
// Lapis pertama adalah tidak mendefinisikan tool-nya sama sekali (lihat
// crud-tools.ts): model tidak bisa memanggil fungsi yang tidak dikirimkan.
// Berkas ini adalah jaring pengaman SETELAH model mengembalikan function call,
// SEBELUM dieksekusi ke database — untuk berjaga terhadap prompt injection atau
// kesalahan konfigurasi di masa depan.
// ============================================================

/** Tabel/resource yang HARAM disentuh AI dalam kondisi apa pun. */
export const BLOCKED_TABLES = [
  'users',
  'auth.users',
  'sessions',
  'refresh_tokens',
  'profiles_auth',
  'user_pins',
  'user_2fa',
  'two_factor',
  'otp_codes',
  'password_resets',
  'billing',
  'subscriptions',
  'invoices_billing',
  'api_keys',
  'staff_members',      // role & permission
  'workspace_settings',
  'integrations',
  'webhooks',
] as const

/** Pola nama aksi/endpoint yang ditolak (case-insensitive). */
export const BLOCKED_PATTERNS: RegExp[] = [
  /^\/?settings(\/|$)/i,                       // path /settings/*
  /(^|[_.\-/\s])settings?([_.\-/\s]|$)/i,      // nama tool: update_settings, setting_billing
  /(^|[_.\-/\s])pengaturan([_.\-/\s]|$)/i,     // padanan Bahasa Indonesia
  /(^|[_.\-/])auth([_.\-/]|$)/i,
  /login|logout|signin|signout|session[_-]?token/i,
  /password|passwd|kata[_-]?sandi/i,
  // Catatan: "\b2fa\b" TIDAK cocok dengan "update_2fa" karena "_" ikut dihitung
  // sebagai karakter kata. Karena itu pemisah ditulis eksplisit.
  /(^|[_.\-/\s])2fa([_.\-/\s]|$)|two[_-]?factor|(^|[_.\-/\s])otp([_.\-/\s]|$)|verifikasi[_-]?kode/i,
  /(^|[_.\-/])pin([_.\-/]|$)/i,
  /billing|invoice[_-]?plan|subscription|langganan|pembayaran[_-]?akun/i,
  /api[_-]?key|secret|token/i,
  /role|permission|hak[_-]?akses|rbac/i,
  /integrasi|integration|webhook/i,
  /delete[_-]?(account|workspace)|hapus[_-]?(akun|workspace)/i,
]

export interface BlockCheckResult {
  blocked: boolean
  reason?: string
}

/**
 * Periksa satu function call dari AI terhadap blocklist.
 * Memeriksa nama tool DAN nilai argumen yang menyebut tabel/endpoint target.
 */
export function checkActionAllowed(
  toolName: string,
  args: Record<string, unknown> = {},
): BlockCheckResult {
  const name = String(toolName || '')

  for (const re of BLOCKED_PATTERNS) {
    if (re.test(name)) {
      return { blocked: true, reason: `Nama aksi "${name}" masuk daftar terlarang (${re}).` }
    }
  }

  // Argumen yang secara eksplisit menyebut tabel/endpoint target.
  const suspectKeys = ['table', 'tabel', 'resource', 'endpoint', 'path', 'target', 'entity']
  for (const k of suspectKeys) {
    const v = args?.[k]
    if (typeof v !== 'string') continue
    const val = v.toLowerCase().trim()

    if (BLOCKED_TABLES.some((t) => val === t || val.endsWith(`.${t}`))) {
      return { blocked: true, reason: `Argumen ${k}="${v}" menunjuk tabel terlarang.` }
    }
    for (const re of BLOCKED_PATTERNS) {
      if (re.test(val)) {
        return { blocked: true, reason: `Argumen ${k}="${v}" cocok pola terlarang (${re}).` }
      }
    }
  }

  return { blocked: false }
}

/** Cek langsung sebuah nama tabel (dipakai sebelum query dijalankan). */
export function isTableBlocked(table: string): boolean {
  const t = String(table || '').toLowerCase().trim()
  if (BLOCKED_TABLES.some((b) => t === b || t.endsWith(`.${b}`))) return true
  return BLOCKED_PATTERNS.some((re) => re.test(t))
}

/**
 * Catat percobaan akses terlarang. Secara teori tidak akan pernah terpicu bila
 * lapis pertama benar — kalau muncul di log, ada yang perlu diselidiki.
 */
export function logBlockedAttempt(
  supabase: { from: (t: string) => { insert: (v: unknown) => Promise<unknown> } },
  info: { userId: string | null; toolName: string; reason: string },
): void {
  console.warn('[AI-BLOCKLIST] percobaan akses terlarang', JSON.stringify(info))
  try {
    void supabase.from('ai_blocked_attempts').insert({
      user_id: info.userId,
      tool_name: info.toolName,
      reason: info.reason,
    })
  } catch {
    // Tabel log opsional — kegagalan mencatat tidak boleh membatalkan penolakan.
  }
}
