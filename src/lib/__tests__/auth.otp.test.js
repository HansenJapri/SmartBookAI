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
