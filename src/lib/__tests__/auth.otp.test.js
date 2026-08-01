import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ============================================================
// Login dua langkah (password -> OTP email 8 digit).
//
// Yang dikunci di sini adalah SATU sifat yang menentukan apakah OTP-nya nyata
// atau cuma hiasan: sesi tidak boleh terbit sebelum kode diverifikasi. Kalau
// suatu saat ada yang mengembalikan signInWithPassword ke sisi klien, JWT akan
// aktif sebelum layar OTP diisi dan penyerang tinggal menutup layarnya.
// ============================================================

const AUTH_CTX = join(process.cwd(), 'src', 'context', 'AuthContext.jsx')
const LOGIN_PAGE = join(process.cwd(), 'src', 'pages', 'Login.jsx')
const EDGE_FN = join(process.cwd(), 'supabase', 'functions', 'auth-login-otp', 'index.ts')

const tanpaKomentar = (kode) => kode
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n')

describe('kontrak keamanan login dua langkah', () => {
  it('klien tidak pernah memanggil signInWithPassword', () => {
    for (const f of [AUTH_CTX, LOGIN_PAGE]) {
      const kode = tanpaKomentar(readFileSync(f, 'utf8'))
      expect(kode, `${f} tidak boleh menerbitkan sesi sebelum OTP`)
        .not.toMatch(/signInWithPassword/)
    }
  })

  it('verifikasi password terjadi di Edge Function, dan sesinya langsung dimatikan', () => {
    const fn = readFileSync(EDGE_FN, 'utf8')
    expect(fn).toMatch(/signInWithPassword/)
    // Sesi hasil pembuktian password tidak boleh dikembalikan ke pemanggil.
    expect(fn).toMatch(/signOut\(\)/)
    expect(tanpaKomentar(fn)).not.toMatch(/json\(\s*\{[^}]*session/)
  })

  it('endpoint login tidak boleh dipakai membuat akun baru', () => {
    const fn = readFileSync(EDGE_FN, 'utf8')
    expect(fn).toMatch(/shouldCreateUser:\s*false/)
  })

  it('email dan password kosong ditolak sebelum menyentuh Supabase', () => {
    const fn = tanpaKomentar(readFileSync(EDGE_FN, 'utf8'))
    expect(fn).toMatch(/if \(!email \|\| !password\)/)
  })

  it('email tidak terdaftar dan password salah dijawab sama (tidak membocorkan akun)', () => {
    const fn = readFileSync(EDGE_FN, 'utf8')
    const jumlahInvalid = (fn.match(/invalid_credentials/g) || []).length
    // Dipakai untuk: input kosong, gagal signIn, dan fallback — semuanya sama.
    expect(jumlahInvalid).toBeGreaterThanOrEqual(2)
    expect(fn).not.toMatch(/user_not_found|email_not_registered/)
  })
})

describe('masa berlaku kode', () => {
  it('OTP_TTL_SECONDS = 180 (3 menit) sesuai setelan Supabase', async () => {
    const mod = await import('../../context/AuthContext.jsx')
    expect(mod.OTP_TTL_SECONDS).toBe(180)
  })

  it('halaman login memakai panjang kode 8 digit', () => {
    const kode = readFileSync(LOGIN_PAGE, 'utf8')
    expect(kode).toMatch(/maxLength=\{8\}/)
    expect(kode).toMatch(/otp\.length < 8/)
  })

  it('halaman daftar memakai panjang kode 8 digit', () => {
    const kode = readFileSync(join(process.cwd(), 'src', 'pages', 'Register.jsx'), 'utf8')
    expect(kode).toMatch(/maxLength=\{8\}/)
    expect(kode).toMatch(/otp\.length < 8/)
  })
})

describe('penanganan batas laju & kegagalan kirim', () => {
  const fn = () => readFileSync(EDGE_FN, 'utf8')

  it('throttle Supabase terdeteksi walau pesannya tidak memuat kata "rate limit"', () => {
    // Regresi: pesan aslinya "For security purposes, you can only request this
    // after 30 seconds." Versi pertama hanya mencari string "rate limit",
    // sehingga throttle ini lolos dan tampil sebagai "gagal mengirim kode".
    const kode = fn()
    expect(kode).toMatch(/over_email_send_rate_limit/)
    expect(kode).toMatch(/after \\d\+ seconds\?/)
    expect(kode).toMatch(/status === 429/)
  })

  it('jeda tunggu diambil dari pesan server, bukan ditebak', () => {
    expect(fn()).toMatch(/match\(\/after \(\\d\+\) seconds\?\/i\)/)
  })

  it('kuota per jam DIBEDAKAN dari throttle antar-permintaan', () => {
    // Regresi: keduanya sempat disamakan dan kuota per jam diberi default
    // 60 detik. Pengguna diberi tahu "tunggu 60 detik", menunggu, gagal lagi.
    const kode = fn()
    expect(kode).toMatch(/email_quota_exceeded/)
    expect(kode).toMatch(/jenis: 'kuota'/)
    expect(kode).toMatch(/jenis: 'throttle'/)
    // Tidak boleh ada lagi angka tebakan sebagai fallback jeda.
    expect(kode).not.toMatch(/: Number\(m\[1\]\) : 60/)
  })

  it('signOut memakai scope local — tidak boleh mencabut sesi perangkat lain', () => {
    // Regresi paling merugikan: signOut() bawaannya scope 'global', yang
    // mencabut SELURUH refresh token pengguna. Gejalanya "harus login terus"
    // dan refresh_token_not_found di log auth.
    // Komentar dibuang: berkas ini SENGAJA menyebut signOut() bawaan untuk
    // menjelaskan kenapa diganti, dan penyebutan itu bukan pelanggaran.
    const kode = tanpaKomentar(fn())
    expect(kode).toMatch(/signOut\(\{\s*scope:\s*'local'\s*\}\)/)
    expect(kode).not.toMatch(/signOut\(\)/)
  })

  it('tombol masuk terkunci selama hitung mundur', () => {
    const kode = readFileSync(LOGIN_PAGE, 'utf8')
    expect(kode).toMatch(/disabled=\{busy \|\| tungguKirim > 0\}/)
    expect(kode).toMatch(/signinWait/)
  })

  it('kegagalan pengiriman email dibedakan dari kesalahan pengguna', () => {
    const kode = fn()
    expect(kode).toMatch(/email_delivery_failed/)
    expect(kode).toMatch(/badcredentials/i)
  })

  it('deteksi kegagalan kirim memakai sinyal yang BENAR-BENAR sampai ke klien', () => {
    // Regresi mahal: versi sebelumnya hanya mencari "535"/"gsmtp"/"BadCredentials".
    // Pola itu cuma ada di LOG Supabase — GoTrue tidak membocorkannya lewat API.
    // Yang sampai ke Edge Function hanya status 500 + code "unexpected_failure"
    // + pesan "Error sending magic link email". Akibatnya deteksi lama selalu
    // meleset dan pengguna terus melihat pesan generik yang menyesatkan.
    const kode = fn()
    expect(kode).toMatch(/error sending/i)
    expect(kode).toMatch(/unexpected_failure/)
    expect(kode).toMatch(/status === 500/)
  })

  it('respons sukses membawa jeda sebelum boleh kirim ulang', () => {
    expect(fn()).toMatch(/resend_after/)
  })

  it('halaman login menonaktifkan tombol kirim ulang selama jeda', () => {
    const kode = readFileSync(LOGIN_PAGE, 'utf8')
    expect(kode).toMatch(/disabled=\{busy \|\| tungguKirim > 0\}/)
    expect(kode).toMatch(/if \(tungguKirim > 0\) return/)
  })

  it('pesan kegagalan layanan tidak pernah dipetakan jadi "password salah"', () => {
    const kode = tanpaKomentar(readFileSync(LOGIN_PAGE, 'utf8'))
    // Fallback terakhir harus errService, bukan errInvalid.
    expect(kode).toMatch(/\|\| a\.errService/)
    expect(kode).not.toMatch(/\|\| a\.errInvalid/)
  })
})

describe('OtpCountdown', () => {
  beforeEach(() => { vi.useRealTimers() })

  it('menghitung sisa waktu dari stempel kirim, bukan dari saat komponen dipasang', async () => {
    // Sifat penting: pengguna yang berpindah tab lalu kembali harus melihat
    // sisa waktu yang benar, bukan hitungan yang mulai dari awal lagi.
    const kode = readFileSync(join(process.cwd(), 'src', 'components', 'OtpCountdown.jsx'), 'utf8')
    expect(kode).toMatch(/Date\.now\(\)\s*-\s*startedAt/)
    expect(kode).toMatch(/Math\.max\(0,/)
  })
})
