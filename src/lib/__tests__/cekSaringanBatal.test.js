import { describe, it, expect } from 'vitest'
import { periksaSaringanBatal, laporanSaringanBatal } from '../../../scripts/cekSaringanBatal.mjs'

// Penjaga ini yang menjaga agar nota batal tidak ikut dihitung sebagai uang.
// Kalau ia sendiri tidak teruji, ia cuma sebuah skrip yang kebetulan hijau.

describe('periksaSaringanBatal', () => {
  it('menangkap pembacaan di src/ yang tidak memutuskan soal status', () => {
    const p = periksaSaringanBatal([
      { path: 'src/lib/api.js', isi: "const q = supabase.from('transactions').select('*')" },
    ])
    expect(p).toHaveLength(1)
    expect(p[0].alasan).toMatch(/tidak menyebut `status`/)
  })

  it('menerima pembacaan yang menyaring status', () => {
    const p = periksaSaringanBatal([
      {
        path: 'src/lib/api.js',
        isi: [
          "const q = supabase.from('transactions')",
          "  .eq('status', 'aktif')",
          "  .order('occurred_at')",
        ].join('\n'),
      },
    ])
    expect(p).toEqual([])
  })

  it('menerima pengikutsertaan baris batal yang DISENGAJA', () => {
    // Halaman Transaksi memang menampilkan nota batal, bertanda. Penjaga ini
    // menuntut keputusan yang terbaca, bukan satu jawaban tertentu.
    const p = periksaSaringanBatal([
      {
        path: 'src/lib/api.js',
        isi: [
          'export async function fetchTransactions({ termasukBatal = false } = {}) {',
          "  let q = wsSelect(owner, 'transactions')",
          '  if (!termasukBatal) q = q.eq(\'status\', \'aktif\')',
        ].join('\n'),
      },
    ])
    expect(p).toEqual([])
  })

  it('melarang tabel transactions disentuh dari luar api.js', () => {
    // Keputusan soal baris batal harus terkumpul di satu berkas. Halaman yang
    // membaca tabelnya sendiri akan melewatkan keputusan itu tanpa sadar.
    const p = periksaSaringanBatal([
      { path: 'src/pages/Reports.jsx', isi: "supabase.from('transactions').select('*').eq('status','aktif')" },
    ])
    expect(p).toHaveLength(1)
    expect(p[0].alasan).toMatch(/hanya boleh diakses lewat src\/lib\/api\.js/)
  })

  it('menangkap Edge Function yang membaca tanpa memutuskan status, dan menyarankan scopedSelect', () => {
    const p = periksaSaringanBatal([
      { path: 'supabase/functions/ai-narasi/index.ts', isi: "await supabase.from('transactions').select('amount')" },
    ])
    expect(p).toHaveLength(1)
    expect(p[0].alasan).toMatch(/scopedSelect/)
  })

  it('MELEWATI insert — menambah transaksi tidak berurusan dengan status', () => {
    // Memaksa penulis INSERT menyebut status hanya melahirkan `status: 'aktif'`
    // hafalan yang disalin tanpa dipikir, lalu suatu hari disalin ke tempat
    // yang salah.
    const p = periksaSaringanBatal([
      {
        path: 'src/lib/api.js',
        isi: [
          'const { data } = await supabase',
          "  .from('transactions')",
          '  .insert({ ...row, user_id: owner })',
          '  .select()',
        ].join('\n'),
      },
    ])
    expect(p).toEqual([])
  })

  it('tidak menuduh berkas penjaga dan berkas palsu yang memuat polanya sebagai teks', () => {
    const p = periksaSaringanBatal([
      { path: 'scripts/cekSaringanBatal.mjs', isi: "from('transactions')" },
      { path: 'supabase/functions/_shared/ai/rag/uji-supabase-palsu.ts', isi: "from('transactions')" },
    ])
    expect(p).toEqual([])
  })

  it('menemukan setiap pelanggaran, bukan berhenti di yang pertama', () => {
    const p = periksaSaringanBatal([
      { path: 'src/pages/A.jsx', isi: "supabase.from('transactions').select()" },
      { path: 'src/pages/B.jsx', isi: "supabase.from('transactions').select()" },
    ])
    expect(p).toHaveLength(2)
  })
})

describe('laporanSaringanBatal', () => {
  it('menyebut berkas dan baris supaya bisa langsung dibuka dari log CI', () => {
    const teks = laporanSaringanBatal([{ path: 'src/pages/A.jsx', baris: 12, alasan: 'alasan' }])
    expect(teks).toContain('src/pages/A.jsx:12')
  })

  it('menyatakan bersih dengan jelas saat tidak ada pelanggaran', () => {
    expect(laporanSaringanBatal([])).toMatch(/Bersih/)
  })
})
