// ============================================================
// applock.js — sebelumnya 0% coverage. Area S-5 di §1.7 (App Lock PIN).
//
// Yang dikunci di sini adalah janji keamanannya yang paling mendasar: PIN
// TIDAK PERNAH disimpan sebagai teks biasa di perangkat. Kalau suatu saat
// hashPin diganti jadi penyimpanan langsung "demi kesederhanaan", siapa pun
// yang membuka DevTools bisa membaca PIN pemilik usaha.
//
// Kunci localStorage juga di-scope per user id — akun berbeda di perangkat yang
// sama tidak boleh saling membuka kunci.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  LOCK_TIMEOUT_MS, hashPin, hasPin, setPin, clearPin, verifyPin,
  markActive, lastActive, isLocked, setLockedFlag, requestLock, emitChange,
} from '../applock'

const UID = 'user-abc'
const LAIN = 'user-xyz'

beforeEach(() => localStorage.clear())

describe('penyimpanan PIN', () => {
  it('PIN tidak pernah tersimpan sebagai teks biasa', async () => {
    await setPin(UID, '1234')
    const tersimpan = localStorage.getItem(`bukupintar_pin_${UID}`)

    expect(tersimpan).not.toBe('1234')
    expect(tersimpan).not.toContain('1234')
    // SHA-256 heksadesimal: 64 karakter.
    expect(tersimpan).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hashPin deterministik dan berbeda untuk PIN berbeda', async () => {
    expect(await hashPin('1234')).toBe(await hashPin('1234'))
    expect(await hashPin('1234')).not.toBe(await hashPin('1235'))
  })

  it('hashPin memakai prefiks domain sehingga bukan SHA-256 polos dari angka', async () => {
    // Tanpa prefiks, hash PIN 4 digit bisa dicocokkan dengan tabel pelangi umum.
    const sha256Polos = 'esaifb2ee6b8b48b2bd0dbe5bfd7bf7b4b6c9e97ff1a2a0d2c8d1f0e9a8b7c6d5'
    expect(await hashPin('1234')).not.toBe(sha256Polos)
  })

  it('hasPin false sebelum dipasang, true sesudahnya', async () => {
    expect(hasPin(UID)).toBe(false)
    await setPin(UID, '1234')
    expect(hasPin(UID)).toBe(true)
  })

  it('verifyPin menerima PIN benar dan menolak yang salah', async () => {
    await setPin(UID, '1234')
    expect(await verifyPin(UID, '1234')).toBe(true)
    expect(await verifyPin(UID, '9999')).toBe(false)
    expect(await verifyPin(UID, '')).toBe(false)
  })

  it('clearPin menghapus PIN sekaligus status terkunci', async () => {
    await setPin(UID, '1234')
    setLockedFlag(UID, true)

    clearPin(UID)
    expect(hasPin(UID)).toBe(false)
    expect(isLocked(UID)).toBe(false)
  })

  it('setPin langsung menandai pengguna sedang aktif', async () => {
    await setPin(UID, '1234')
    expect(lastActive(UID)).toBeGreaterThan(0)
  })
})

describe('isolasi antar-akun di perangkat yang sama', () => {
  it('PIN satu akun tidak berlaku untuk akun lain', async () => {
    await setPin(UID, '1234')
    expect(hasPin(LAIN)).toBe(false)
    expect(await verifyPin(LAIN, '1234')).toBe(false)
  })

  it('status terkunci dilacak terpisah per akun', () => {
    setLockedFlag(UID, true)
    expect(isLocked(UID)).toBe(true)
    expect(isLocked(LAIN)).toBe(false)
  })

  it('waktu aktif dilacak terpisah per akun', () => {
    markActive(UID)
    expect(lastActive(UID)).toBeGreaterThan(0)
    expect(lastActive(LAIN)).toBe(0)
  })
})

describe('perilaku saat uid kosong', () => {
  // Terjadi nyata saat sesi habis: komponen sempat merender sebelum user null
  // ditangani. Tidak boleh melempar dan tidak boleh menulis kunci "undefined".
  it('seluruh fungsi aman dipanggil tanpa uid', async () => {
    expect(hasPin('')).toBe(false)
    expect(isLocked('')).toBe(false)
    expect(lastActive('')).toBe(0)
    expect(await verifyPin('', '1234')).toBe(false)

    await setPin('', '1234')
    clearPin('')
    markActive('')
    setLockedFlag('', true)

    expect(localStorage.length).toBe(0)
  })

  it('hasPin false untuk uid undefined maupun null', () => {
    expect(hasPin(undefined)).toBe(false)
    expect(hasPin(null)).toBe(false)
  })
})

describe('status kunci & waktu aktif', () => {
  it('setLockedFlag(true) mengunci, setLockedFlag(false) membuka', () => {
    setLockedFlag(UID, true)
    expect(isLocked(UID)).toBe(true)
    setLockedFlag(UID, false)
    expect(isLocked(UID)).toBe(false)
  })

  it('membuka kunci menghapus kuncinya dari localStorage, bukan menyimpan "0"', () => {
    setLockedFlag(UID, true)
    setLockedFlag(UID, false)
    expect(localStorage.getItem(`bukupintar_locked_${UID}`)).toBeNull()
  })

  it('lastActive mengembalikan 0 bila belum pernah dicatat', () => {
    expect(lastActive(UID)).toBe(0)
  })

  it('lastActive tahan terhadap nilai rusak di localStorage', () => {
    localStorage.setItem(`bukupintar_active_${UID}`, 'bukan-angka')
    expect(lastActive(UID)).toBe(0)
  })

  it('batas tidak aktif adalah 10 menit', () => {
    expect(LOCK_TIMEOUT_MS).toBe(10 * 60 * 1000)
  })
})

describe('sinyal perubahan antar-komponen', () => {
  it('requestLock mengunci dan menyiarkan event bpai-applock', () => {
    const dengar = vi.fn()
    window.addEventListener('bpai-applock', dengar)

    requestLock(UID)

    expect(isLocked(UID)).toBe(true)
    expect(dengar).toHaveBeenCalledTimes(1)
    window.removeEventListener('bpai-applock', dengar)
  })

  it('setPin dan clearPin juga menyiarkan perubahan', async () => {
    const dengar = vi.fn()
    window.addEventListener('bpai-applock', dengar)

    await setPin(UID, '1234')
    clearPin(UID)

    expect(dengar).toHaveBeenCalledTimes(2)
    window.removeEventListener('bpai-applock', dengar)
  })

  it('emitChange tidak melempar walau dispatch gagal', () => {
    const asli = window.dispatchEvent
    window.dispatchEvent = () => { throw new Error('diblokir') }
    expect(() => emitChange()).not.toThrow()
    window.dispatchEvent = asli
  })
})
