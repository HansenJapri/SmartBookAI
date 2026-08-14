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

// ------------------------------------------------------------
// Penanda asal aksi untuk audit log
// ------------------------------------------------------------
//
// Penulisan data dari alur asisten tetap dilakukan browser: ai-crud hanya
// menghasilkan DRAF, dan manusia yang menekan Simpan. Jadi dari sisi database,
// tulisan itu identik dengan tulisan manual — JWT-nya sama, auth.uid() sama.
//
// Supaya trigger log_audit() bisa membedakannya, permintaan yang berasal dari
// alur AI membawa header `x-smartbook-via: ai`, yang dibaca trigger lewat
// current_setting('request.headers').
//
// Kenapa bendera modul, bukan klien Supabase kedua: seluruh src/lib/api.js
// memakai satu instans `supabase` bersama. Membuat instans kedua berarti
// menduplikasi puluhan fungsi penulisan hanya demi satu header.
//
// BATAS YANG DIAKUI: bendera ini berlaku untuk SEMUA permintaan yang terbang
// selama ia menyala. Karena itu ia hanya boleh dinyalakan di sekitar satu
// operasi simpan yang di-await sampai selesai (lihat tandaiAsalAI di
// src/lib/aiActions.js), dan dipulihkan di blok finally. Penandanya sendiri
// memang informasional — klien yang dimodifikasi bisa memalsukannya — jadi
// kebocoran bendera adalah kesalahan pelabelan, bukan lubang keamanan.
let asalAI = false

/** Nyalakan/matikan penanda. Dipakai lewat pembungkus, jangan dipanggil langsung. */
export function setAsalAI(nyala) { asalAI = Boolean(nyala) }

/** fetch yang menyelipkan header penanda saat bendera menyala. */
function fetchBerpenanda(input, init = {}) {
  if (!asalAI) return fetch(input, init)
  const headers = new Headers(init.headers || {})
  headers.set('x-smartbook-via', 'ai')
  return fetch(input, { ...init, headers })
}

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true, // untuk reset password via link
      },
      global: { fetch: fetchBerpenanda },
    })
  : null
