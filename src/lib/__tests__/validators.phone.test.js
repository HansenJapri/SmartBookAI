import { describe, it, expect } from 'vitest'
import { normalizePhone, isPhoneValid } from '../validators'
import { normalizePhone as normalizePhoneWa } from '../aging'

// Telepon bersifat opsional saat mendaftar (task B5). Yang membuat itu mungkin
// adalah satu detail kontrak: normalizePhone() di validators.js mengembalikan
// null BAIK saat kosong MAUPUN saat tidak valid. Pemanggil karena itu wajib
// memeriksa "diisi atau tidak" lebih dulu, baru memvalidasi — persis pola di
// Register.jsx dan Settings.jsx. Test ini menjaga kontrak tersebut.

describe('kontrak telepon opsional', () => {
  it('kosong menghasilkan null, sehingga pemanggil bisa memperlakukannya sebagai "tidak diisi"', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone('   ')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
    expect(normalizePhone(undefined)).toBeNull()
  })

  it('nomor Indonesia dinormalkan ke E.164 dari semua bentuk yang lazim diketik', () => {
    expect(normalizePhone('081234567890')).toBe('+6281234567890')
    expect(normalizePhone('81234567890')).toBe('+6281234567890')
    expect(normalizePhone('+6281234567890')).toBe('+6281234567890')
    expect(normalizePhone('6281234567890')).toBe('+6281234567890')
    expect(normalizePhone('0812-3456-7890')).toBe('+6281234567890')
    expect(normalizePhone('(0812) 3456 7890')).toBe('+6281234567890')
  })

  it('nomor tidak valid ditolak, bukan dipaksa lolos', () => {
    expect(normalizePhone('abc')).toBeNull()
    expect(normalizePhone('0812')).toBeNull()          // terlalu pendek
    expect(normalizePhone('0812345678901234')).toBeNull() // terlalu panjang
    expect(isPhoneValid('0812')).toBe(false)
    expect(isPhoneValid('081234567890')).toBe(true)
  })
})

describe('dua normalizePhone yang berbeda', () => {
  // validators.js (validasi pendaftaran) dan aging.js (tautan WhatsApp) sama-sama
  // mengekspor normalizePhone dengan kontrak yang BERBEDA. Tertukar impor tidak
  // memunculkan error apa pun — nomor tak valid akan lolos diam-diam. Test ini
  // ada supaya perbedaan itu terdokumentasi dan ketahuan bila salah satu berubah.
  it('hanya versi validators yang menolak masukan tak valid', () => {
    expect(normalizePhone('abc')).toBeNull()
    expect(normalizePhoneWa('abc')).toBe('')
  })

  it('hanya versi validators yang memaksa panjang nomor masuk akal', () => {
    expect(normalizePhone('81234')).toBeNull()
    expect(normalizePhoneWa('81234')).toBe('6281234')
  })

  it('bentuk keluarannya berbeda: E.164 berawalan + vs digit polos', () => {
    expect(normalizePhone('081234567890')).toBe('+6281234567890')
    expect(normalizePhoneWa('081234567890')).toBe('6281234567890')
  })
})
