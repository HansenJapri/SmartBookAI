import { supabase } from './supabase'

// Pemantauan error sederhana tanpa dependensi tambahan: menangkap error global
// dan render, mencatatnya ke tabel app_events (type 'client_error') agar dapat
// ditinjau dari sisi admin. Throttle + dedupe agar tidak membanjiri.
//
// Untuk pemantauan lebih lengkap (mis. Sentry), pasang SDK lalu inisialisasi di
// sini dengan membaca VITE_SENTRY_DSN dari .env.

const MAX_PER_SESSION = 20
let sent = 0
const seen = new Set()

export async function logClientError(kind, message, extra = {}) {
  try {
    const msg = String(message || '').slice(0, 400)
    if (!msg) return
    const key = kind + '|' + msg
    if (seen.has(key) || sent >= MAX_PER_SESSION) return
    seen.add(key); sent++
    if (!supabase) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return // RLS app_events: hanya untuk sesi login
    await supabase.from('app_events').insert({
      user_id: user.id,
      type: 'client_error',
      meta: {
        kind, message: msg,
        path: typeof location !== 'undefined' ? location.pathname : '',
        ua: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 160) : '',
        ...extra,
      },
    })
  } catch { /* jangan pernah mengganggu UX */ }
}

export function initMonitoring() {
  if (typeof window === 'undefined') return
  window.addEventListener('error', (e) => {
    logClientError('window.error', e?.message || e?.error?.message, { src: e?.filename, line: e?.lineno })
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e?.reason
    logClientError('unhandledrejection', r?.message || String(r))
  })
}
