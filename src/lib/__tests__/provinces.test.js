// ============================================================
// provinces.js — sebelumnya 0% coverage.
//
// Daftar ini bukan sekadar data tampilan: `id`-nya dikirim apa adanya sebagai
// `province_id` ke endpoint PIHPS Bank Indonesia. Satu id yang bergeser berarti
// Radar Harga menampilkan harga provinsi yang SALAH tanpa error apa pun —
// pengguna di Aceh melihat harga Papua dan tidak ada yang tahu.
// ============================================================
import { describe, it, expect } from 'vitest'
import { PROVINCES, PROVINCE_NAME } from '../provinces'

describe('daftar provinsi PIHPS', () => {
  it('memuat 35 entri: nasional + 34 provinsi', () => {
    expect(PROVINCES).toHaveLength(35)
  })

  it('id 0 adalah rata-rata nasional (tampilan bawaan Radar)', () => {
    expect(PROVINCES[0]).toEqual({ id: 0, name: 'Nasional (rata-rata)' })
  })

  it('id berurutan 0..34 tanpa lompatan', () => {
    expect(PROVINCES.map((p) => p.id)).toEqual(Array.from({ length: 35 }, (_, i) => i))
  })

  it('tidak ada id ganda', () => {
    expect(new Set(PROVINCES.map((p) => p.id)).size).toBe(PROVINCES.length)
  })

  it('tidak ada nama ganda atau kosong', () => {
    const nama = PROVINCES.map((p) => p.name)
    expect(new Set(nama).size).toBe(nama.length)
    expect(nama.every((n) => typeof n === 'string' && n.trim().length > 0)).toBe(true)
  })

  it('memetakan beberapa id kunci ke provinsi yang benar', () => {
    // Dipatok eksplisit: id ini yang dikirim ke API, bukan namanya.
    expect(PROVINCE_NAME[1]).toBe('Aceh')
    expect(PROVINCE_NAME[13]).toBe('DKI Jakarta')
    expect(PROVINCE_NAME[16]).toBe('Jawa Timur')
    expect(PROVINCE_NAME[34]).toBe('Papua Barat')
  })
})

describe('PROVINCE_NAME', () => {
  it('mencakup seluruh entri PROVINCES', () => {
    expect(Object.keys(PROVINCE_NAME)).toHaveLength(PROVINCES.length)
    for (const p of PROVINCES) expect(PROVINCE_NAME[p.id]).toBe(p.name)
  })

  it('mengembalikan undefined untuk id di luar daftar', () => {
    expect(PROVINCE_NAME[99]).toBeUndefined()
    expect(PROVINCE_NAME[-1]).toBeUndefined()
  })
})
