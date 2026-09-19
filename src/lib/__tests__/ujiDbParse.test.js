import { describe, it, expect } from 'vitest'
import { uraikanKeluaran, nilaiHasil, formatBaris, normalisasiUrlDb, putuskanTanpaUrl } from '../../../scripts/ujiDbParse.mjs'

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

describe('normalisasiUrlDb', () => {
  const URL_SAH = 'postgresql://postgres.abc:rahasia@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'

  it('membedakan "tidak diset" dari "diset tapi rusak"', () => {
    // Ini inti perbedaannya: tidak diset = PR dari fork, gerbang dilewati.
    // Diset tapi rusak = konfigurasi salah, gerbang HARUS merah.
    expect(normalisasiUrlDb(undefined).ada).toBe(false)
    expect(normalisasiUrlDb('').ada).toBe(false)
    expect(normalisasiUrlDb('   ').ada).toBe(false)
    expect(normalisasiUrlDb('postgres').ada).toBe(true)
    expect(normalisasiUrlDb('postgres').sah).toBe(false)
  })

  it('membuang spasi dan baris baru yang terbawa saat menyalin secret', () => {
    // Kegagalan CI 19 Sep 2026: satu karakter di depan membuat psql
    // memperlakukan seluruh string sebagai nama database.
    const h = normalisasiUrlDb(`\n  ${URL_SAH}\n`)
    expect(h.sah).toBe(true)
    expect(h.url).toBe(URL_SAH)
    expect(h.dirapikan).toBe(true)
  })

  it('menolak nilai tanpa skema postgres, dan menjelaskan akibatnya', () => {
    const h = normalisasiUrlDb('aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres')
    expect(h.sah).toBe(false)
    expect(h.alasan).toMatch(/socket lokal|s\.PGSQL/)
  })

  it('TIDAK PERNAH membocorkan isi URL di pesan errornya', () => {
    // Di dalamnya ada password database. Pesan error CI terbaca siapa pun yang
    // bisa melihat log run.
    const h = normalisasiUrlDb('bukan-url-tapi-ada-rahasia-super-penting')
    expect(h.alasan).not.toContain('rahasia-super-penting')
    expect(h.alasan).toMatch(/\d+ karakter/)
  })

  it('menerima skema postgres:// maupun postgresql://', () => {
    expect(normalisasiUrlDb(URL_SAH).sah).toBe(true)
    expect(normalisasiUrlDb(URL_SAH.replace('postgresql://', 'postgres://')).sah).toBe(true)
  })

  it('memperingatkan transaction pooler (6543) yang merusak BEGIN/ROLLBACK', () => {
    expect(normalisasiUrlDb(URL_SAH.replace(':5432', ':6543')).peringatan).toMatch(/6543/)
    expect(normalisasiUrlDb(URL_SAH).peringatan).toBeNull()
  })
})

describe('putuskanTanpaUrl', () => {
  it('MERAH bila run berhak atas rahasia tapi secretnya kosong', () => {
    // Hijau palsu 19 Sep 2026: secret ter-set kosong, gerbang melewati dirinya
    // sendiri, seluruh run dilaporkan hijau tanpa satu kasus SQL pun berjalan.
    const p = putuskanTanpaUrl('true')
    expect(p.kode).toBe(1)
    expect(p.pesan).toMatch(/KOSONG/)
  })

  it('hijau (dilewati) hanya untuk run yang memang tidak berhak, yaitu PR fork', () => {
    const p = putuskanTanpaUrl('false')
    expect(p.kode).toBe(0)
    expect(p.pesan).toMatch(/fork/)
  })

  it("memperlakukan string 'false' sebagai false, bukan truthy", () => {
    // Nilainya datang dari ekspresi YAML sebagai string. Boolean('false') === true,
    // dan kekeliruan itu mengembalikan lubangnya persis seperti semula.
    expect(putuskanTanpaUrl('false').kode).toBe(0)
    expect(putuskanTanpaUrl(false).kode).toBe(0)
    expect(putuskanTanpaUrl('FALSE').kode).toBe(0)
  })

  it('default aman: nilai tak dikenal atau kosong TIDAK mewajibkan', () => {
    // UJI_DB_WAJIB belum ada saat skrip dijalankan dari mesin lokal.
    expect(putuskanTanpaUrl(undefined).kode).toBe(0)
    expect(putuskanTanpaUrl('').kode).toBe(0)
  })
})
