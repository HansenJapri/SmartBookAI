import { supabase } from './supabase'

// Pembatas percobaan OTP (P2).
//
// Supabase Auth membatasi PENGIRIMAN kode, bukan berapa kali kode boleh DITEBAK.
// Tanpa pembatas ini, kode 8 digit bisa dicoba berkali-kali selama masa
// berlakunya. Hitungannya disimpan di server (RPC otp_attempt_*) supaya tidak
// bisa dihapus dengan membersihkan localStorage atau membuka jendela penyamaran.
//
// Cadangan lokal: bila RPC tidak terjangkau (jaringan putus, migrasi belum
// terpasang di lingkungan pengembangan), penguncian tetap berlaku di peramban
// ini. Cadangan sengaja tidak dipakai sebagai sumber kebenaran — ia hanya
// menahan, tidak pernah membuka kunci yang sudah ditetapkan server.

export const OTP_MAX_ATTEMPTS = 5
export const OTP_WINDOW_SECONDS = 15 * 60   // 15 menit

// Satu ember per alur, supaya salah kode saat login tidak menghabiskan jatah
// percobaan pada alur lupa-password.
export const OTP_BUCKET = {
  login: 'otp_login',
  signup: 'otp_signup',
  recovery: 'otp_recovery',
}

const kunciLokal = (bucket, email) => `sb_otp_${bucket}_${String(email || '').trim().toLowerCase()}`

function bacaLokal(bucket, email) {
  try {
    const mentah = localStorage.getItem(kunciLokal(bucket, email))
    if (!mentah) return null
    const d = JSON.parse(mentah)
    if (!d || typeof d.hits !== 'number') return null
    if (Date.now() > Number(d.until || 0)) { hapusLokal(bucket, email); return null }
    return d
  } catch { return null }
}

function tulisLokal(bucket, email, hits) {
  try {
    localStorage.setItem(kunciLokal(bucket, email), JSON.stringify({
      hits, until: Date.now() + OTP_WINDOW_SECONDS * 1000,
    }))
  } catch { /* mode privat / storage penuh */ }
}

function hapusLokal(bucket, email) {
  try { localStorage.removeItem(kunciLokal(bucket, email)) } catch { /* abaikan */ }
}

function dariLokal(bucket, email) {
  const d = bacaLokal(bucket, email)
  const hits = d?.hits || 0
  return {
    locked: hits >= OTP_MAX_ATTEMPTS,
    hits,
    remaining: Math.max(0, OTP_MAX_ATTEMPTS - hits),
    retryAfter: d ? Math.max(1, Math.ceil((Number(d.until) - Date.now()) / 1000)) : OTP_WINDOW_SECONDS,
    sumber: 'lokal',
  }
}

async function panggil(fn, bucket, email) {
  const { data, error } = await supabase.rpc(fn, {
    p_bucket: bucket,
    p_subject: String(email || '').trim().toLowerCase(),
    p_limit: OTP_MAX_ATTEMPTS,
    p_window_seconds: OTP_WINDOW_SECONDS,
  })
  if (error) throw error
  const baris = Array.isArray(data) ? data[0] : data
  return {
    locked: !!baris?.locked,
    hits: Number(baris?.hits) || 0,
    remaining: Number(baris?.remaining) || 0,
    retryAfter: Number(baris?.retry_after) || OTP_WINDOW_SECONDS,
    sumber: 'server',
  }
}

// Status percobaan TANPA menambah hitungan — dipakai saat layar OTP dibuka.
export async function statusOtp(bucket, email) {
  if (!email) return { locked: false, hits: 0, remaining: OTP_MAX_ATTEMPTS, retryAfter: 0, sumber: 'kosong' }
  try {
    const server = await panggil('otp_attempt_status', bucket, email)
    // Cadangan lokal boleh mengunci lebih ketat, tidak pernah lebih longgar.
    const lokal = dariLokal(bucket, email)
    return lokal.locked && !server.locked ? lokal : server
  } catch {
    return dariLokal(bucket, email)
  }
}

// Mencatat satu percobaan GAGAL. Kembalikan status setelah penambahan.
export async function catatOtpGagal(bucket, email) {
  const lokalBaru = (bacaLokal(bucket, email)?.hits || 0) + 1
  tulisLokal(bucket, email, lokalBaru)
  try {
    return await panggil('otp_attempt_fail', bucket, email)
  } catch {
    return dariLokal(bucket, email)
  }
}

// Kode benar -> jatah percobaan dikembalikan penuh, supaya pengguna sah yang
// sempat salah ketik tidak terbawa terkunci ke login berikutnya.
export async function resetOtp(bucket, email) {
  hapusLokal(bucket, email)
  try {
    await supabase.rpc('otp_attempt_reset', {
      p_bucket: bucket,
      p_subject: String(email || '').trim().toLowerCase(),
    })
  } catch { /* penguncian akan kedaluwarsa sendiri di akhir jendela */ }
}

// "12:30" — dipakai di pesan penguncian. Sengaja mm:ss dan bukan kalimat
// ("12 menit 30 detik") supaya satu format ini benar di kedua bahasa antarmuka.
export function formatTunggu(detik) {
  const d = Math.max(0, Math.ceil(Number(detik) || 0))
  const menit = Math.floor(d / 60)
  const sisa = d % 60
  return `${menit}:${String(sisa).padStart(2, '0')}`
}
