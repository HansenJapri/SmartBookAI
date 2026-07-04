import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// True hanya jika kedua env terisi dan bukan placeholder
export const isSupabaseConfigured =
  Boolean(url && anonKey) &&
  !url.includes('xxxxxxxx') &&
  !anonKey.includes('isi-anon')

// Fitur OTP SMS (telepon). Diaktifkan setelah provider SMS (mis. Twilio) dipasang.
// Set VITE_PHONE_OTP=true di .env untuk mengaktifkan.
export const phoneOtpEnabled = String(import.meta.env.VITE_PHONE_OTP).toLowerCase() === 'true'

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true, // untuk reset password via link
      },
    })
  : null
