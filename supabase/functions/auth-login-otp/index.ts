// Supabase Edge Function — gerbang password untuk login dua langkah (OTP email).
// Deploy:  supabase functions deploy auth-login-otp --no-verify-jwt
//
// KENAPA FUNGSI INI ADA
// --------------------
// Alur yang salah (dan sering dipakai): panggil signInWithPassword di browser,
// lalu tampilkan layar OTP. Itu keamanan semu — sesi/JWT SUDAH terbit di browser
// sebelum kode diisi, jadi penyerang tinggal menutup layar OTP dan tetap masuk.
//
// Di sini password diverifikasi DI SERVER. Sesi hasil verifikasi langsung
// dimatikan dan tidak pernah dikirim ke klien. Yang dikembalikan hanya
// "silakan cek email". Browser baru mendapat sesi setelah verifyOtp() berhasil
// dengan kode yang benar dan belum kedaluwarsa.
//
// PRASYARAT SETELAN DASHBOARD SUPABASE (Authentication > Emails):
//   1. Email OTP Length     = 8
//   2. Email OTP Expiration = 180 (detik = 3 menit)
//   3. Template "Magic Link" WAJIB memuat {{ .Token }} — bawaannya hanya berisi
//      tautan, sehingga pengguna tidak akan pernah menerima kode angkanya.
//
// SISA RISIKO YANG DIKETAHUI
// -------------------------
// Klien secara teknis masih bisa memanggil supabase.auth.signInWithOtp() sendiri
// dan melewati gerbang password ini (login tanpa password, cukup akses inbox).
// Tingkat keamanannya sama dengan "lupa password" yang sudah ada: siapa pun yang
// menguasai inbox bisa mengambil alih akun. Menutupnya sepenuhnya berarti
// mematikan OTP sisi klien dan mengirim email sendiri (perlu penyedia email
// pihak ketiga). Dicatat di sini supaya tidak dikira sudah tertutup.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Deteksi batas laju Supabase Auth.
//
// PENTING: pesan throttle-nya berbunyi "For security purposes, you can only
// request this after 30 seconds." — TIDAK memuat kata "rate limit". Versi
// pertama fungsi ini hanya mencari string "rate limit", sehingga throttle
// tersebut lolos dan ditampilkan ke pengguna sebagai "gagal mengirim kode",
// yang menyesatkan. Sekarang tiga penanda diperiksa sekaligus dan jeda
// tunggunya dikembalikan supaya UI bisa menghitung mundur.
function bacaRateLimit(err: { message?: string; status?: number; code?: string }): number | null {
  const msg = String(err?.message || '')
  const kena = err?.code === 'over_email_send_rate_limit'
    || err?.status === 429
    || /rate limit/i.test(msg)
    || /after \d+ seconds?/i.test(msg)
  if (!kena) return null
  const m = msg.match(/after (\d+) seconds?/i)
  // 60 detik = jeda minimum bawaan Supabase antar-email ke alamat yang sama.
  return m ? Number(m[1]) : 60
}

// Kegagalan pengiriman email (SMTP), bukan kesalahan pengguna. Dipisahkan
// supaya pesannya jujur: masalahnya ada di konfigurasi pengiriman email,
// bukan pada password atau kode yang diketik.
function gagalKirimEmail(err: { message?: string }): boolean {
  const msg = String(err?.message || '')
  return /\b5\d\d\b/.test(msg)
    || /smtp|gsmtp|username and password not accepted|badcredentials|relay|mail server/i.test(msg)
}

// Klien baru per permintaan, tanpa persistensi sesi: dua permintaan yang
// berjalan bersamaan tidak boleh saling mewarisi sesi.
const freshClient = () =>
  createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const email = String(body?.email || '').trim().toLowerCase()
    const password = String(body?.password || '')
    if (!email || !password) return json({ error: 'invalid_credentials' }, 401)

    // --- Langkah 1: buktikan password benar, tanpa membocorkan sesi ---
    const gate = freshClient()
    const { data: signIn, error: signInErr } = await gate.auth.signInWithPassword({ email, password })

    if (signInErr) {
      const msg = String(signInErr.message || '').toLowerCase()
      // Batas laju ditangani Supabase Auth; teruskan apa adanya supaya UI bisa
      // menampilkan pesan "terlalu sering" alih-alih "password salah".
      const rl = bacaRateLimit(signInErr)
      if (rl) return json({ error: 'rate_limited', retry_after: rl }, 429)
      if (msg.includes('confirm')) return json({ error: 'email_not_confirmed' }, 403)
      // Email tidak ada dan password salah sengaja dijawab sama — jangan
      // memberi tahu penyerang email mana yang terdaftar.
      return json({ error: 'invalid_credentials' }, 401)
    }

    // Sesi hasil langkah ini HANYA untuk membuktikan password. Matikan segera;
    // ia tidak pernah keluar dari fungsi ini.
    if (signIn?.session) { try { await gate.auth.signOut() } catch { /* diabaikan */ } }

    // --- Langkah 2: minta Supabase mengirim kode 8 digit ke email ---
    // shouldCreateUser: false — endpoint ini tidak boleh dipakai membuat akun.
    const mailer = freshClient()
    const { error: otpErr } = await mailer.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    if (otpErr) {
      const rl = bacaRateLimit(otpErr)
      if (rl) return json({ error: 'rate_limited', retry_after: rl }, 429)
      // SMTP menolak (mis. Gmail 535 BadCredentials karena memakai password
      // akun biasa, bukan App Password). Pengguna tidak bisa berbuat apa-apa;
      // katakan apa adanya alih-alih menyalahkan kredensial mereka.
      if (gagalKirimEmail(otpErr)) return json({ error: 'email_delivery_failed' }, 502)
      return json({ error: 'otp_send_failed' }, 502)
    }

    // Jeda minimum sebelum boleh kirim ulang, supaya UI bisa menonaktifkan
    // tombol "Kirim ulang" alih-alih membiarkan pengguna menabrak throttle.
    return json({ sent: true, resend_after: 60 })
  } catch {
    // Tidak membocorkan detail internal ke pemanggil yang belum terautentikasi.
    return json({ error: 'unexpected_error' }, 500)
  }
})
