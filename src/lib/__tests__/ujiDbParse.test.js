import { describe, it, expect } from 'vitest'
import { uraikanKeluaran, nilaiHasil, formatBaris } from '../../../scripts/ujiDbParse.mjs'

// Gerbang CI sisi database (job "db") bergantung pada penguraian ini. Kalau ia
// salah menilai, seluruh 26 kasus SQL bisa merah tanpa terlihat — atau lebih
// buruk, hijau padahal gagal.

const KELUARAN_ASLI = [
  'BEGIN',
  '[{"suite":"bom","kasus":"K1 pakai 300g","hasil":"stok 12.00, terbuka 300","lulus":true}]',
  'ROLLBACK',
  '',
].join('\n')

describe('uraikanKeluaran', () => {
  it('mengambil baris JSON di antara tag BEGIN dan ROLLBACK', () => {
    // psql mencetak tag perintah ke stdout; menguraikan seluruh keluaran mentah
    // akan gagal. Inilah kasus yang benar-benar terjadi di CI.
    const baris = uraikanKeluaran(KELUARAN_ASLI)
    expect(baris).toHaveLength(1)
    expect(baris[0].kasus).toBe('K1 pakai 300g')
  })

  it('tahan terhadap baris notice tambahan dari versi psql berbeda', () => {
    const keluaran = [
      'psql:stdin:1: NOTICE:  extension "x" already exists',
      'BEGIN',
      '[{"suite":"rls_lint","kasus":"a","hasil":"b","lulus":true}]',
      'ROLLBACK',
    ].join('\n')
    expect(uraikanKeluaran(keluaran)).toHaveLength(1)
  })

  it('menerima array kosong sebagai JSON yang sah (penilaiannya urusan nilaiHasil)', () => {
    expect(uraikanKeluaran('BEGIN\n[]\nROLLBACK')).toEqual([])
  })

  it('melempar bila tidak ada baris JSON sama sekali', () => {
    expect(() => uraikanKeluaran('BEGIN\nROLLBACK')).toThrow(/Tidak menemukan baris JSON/)
    expect(() => uraikanKeluaran('')).toThrow(/Tidak menemukan baris JSON/)
    expect(() => uraikanKeluaran(null)).toThrow(/Tidak menemukan baris JSON/)
  })

  it('melempar bila JSON-nya rusak', () => {
    expect(() => uraikanKeluaran('[{"lulus":tru')).toThrow(/tidak bisa diurai/)
  })
})

describe('nilaiHasil', () => {
  it('lulus bila semua kasus lulus', () => {
    const h = nilaiHasil([{ lulus: true }, { lulus: true }])
    expect(h).toMatchObject({ total: 2, gagal: 0, lulus: true, alasan: null })
  })

  it('gagal bila ada satu kasus merah', () => {
    const h = nilaiHasil([{ lulus: true }, { lulus: false }, { lulus: true }])
    expect(h).toMatchObject({ total: 3, gagal: 1, lulus: false })
    expect(h.alasan).toMatch(/1 kasus GAGAL/)
  })

  it('NOL kasus adalah kegagalan, bukan kelulusan', () => {
    // Pelajaran dari gerbang unit: "no tests" pernah membuat CI merah selama
    // berhari-hari tanpa satu pun test berjalan, dan gejalanya menipu.
    // Nol kasus di sini tidak boleh bisa lewat sebagai hijau.
    const h = nilaiHasil([])
    expect(h.lulus).toBe(false)
    expect(h.alasan).toMatch(/NOL kasus/)
  })

  it('menganggap lulus hanya bila bernilai true, bukan sekadar truthy-longgar', () => {
    // Baris dari SQL bisa membawa null kalau kolomnya berubah; null tidak boleh
    // diperlakukan sebagai lulus.
    expect(nilaiHasil([{ lulus: null }]).lulus).toBe(false)
    expect(nilaiHasil([{ lulus: undefined }]).lulus).toBe(false)
  })
})

describe('formatBaris', () => {
  it('menandai lulus dan gagal secara berbeda', () => {
    expect(formatBaris({ lulus: true, suite: 'bom', kasus: 'K1', hasil: 'stok 12' }))
      .toBe('  ok   [bom] K1 -> stok 12')
    expect(formatBaris({ lulus: false, suite: 'bom', kasus: 'K1', hasil: 'stok 11' }))
      .toBe('  GAGAL [bom] K1 -> stok 11')
  })
})
