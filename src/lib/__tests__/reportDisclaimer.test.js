import { describe, it, expect } from 'vitest'
import {
  DISCLAIMER_KUR, DISCLAIMER_PAJAK, PDF_FOOTER_H, REFERENSI_PREFIX,
  disclaimerAoa, refFile, stampPdfDisclaimer,
} from '../reportDisclaimer'

// Dokumen tiruan jsPDF: mencatat setiap panggilan text() beserta halaman aktif,
// supaya bisa dibuktikan penafian benar-benar digambar di SETIAP halaman.
function fakeDoc(jumlahHalaman) {
  const dipanggil = []
  let halaman = 1
  return {
    dipanggil,
    internal: {
      getNumberOfPages: () => jumlahHalaman,
      pageSize: { width: 210, height: 297 },
    },
    setPage(n) { halaman = n },
    setFontSize() {}, setFont() {}, setDrawColor() {}, setLineWidth() {},
    setTextColor() {}, line() {},
    splitTextToSize: (teks) => String(teks).split('\n'),
    text(isi, x, y, opt) { dipanggil.push({ halaman, isi, x, y, opt }) },
  }
}

describe('teks baku penafian', () => {
  // Teks ini adalah teks hukum. Test ini sengaja kaku: kalau ada yang
  // memparafrase atau memperhalus kalimatnya, test harus merah.
  it('penafian pajak menolak dirinya sebagai dokumen resmi dan menunjuk DJP', () => {
    expect(DISCLAIMER_PAJAK).toContain('REFERENSI — BUKAN DOKUMEN RESMI PERPAJAKAN.')
    expect(DISCLAIMER_PAJAK).toContain('PP 55/2022 dan UU 7/2021 (HPP)')
    expect(DISCLAIMER_PAJAK).toContain('Wajib diverifikasi ulang dengan DJP atau konsultan pajak')
    expect(DISCLAIMER_PAJAK).toContain('tidak bertanggung jawab atas')
  })

  it('penafian KUR menempatkan keputusan pada bank penyalur, bukan pada laporan', () => {
    expect(DISCLAIMER_KUR).toContain('REFERENSI — BUKAN JAMINAN PERSETUJUAN KREDIT.')
    expect(DISCLAIMER_KUR).toContain('sepenuhnya ada pada bank penyalur')
    expect(DISCLAIMER_KUR).toContain('SLIK OJK')
    expect(DISCLAIMER_KUR).toContain('tidak menentukan kelolosan pengajuan')
  })

  it('tidak menjanjikan kelolosan atau keresmian di kedua teks', () => {
    for (const teks of [DISCLAIMER_KUR, DISCLAIMER_PAJAK]) {
      expect(teks.toLowerCase()).not.toContain('siap diajukan')
      expect(teks.toLowerCase()).not.toContain('dijamin')
      expect(teks).toMatch(/^REFERENSI — BUKAN /)
    }
  })
})

describe('nama berkas', () => {
  it('mengawali setiap berkas dengan penanda Referensi-', () => {
    expect(refFile('Rekap-Pajak-Toko-2026.pdf')).toBe('Referensi-Rekap-Pajak-Toko-2026.pdf')
    expect(refFile('Laporan-LabaRugi-Toko-all.xlsx')).toBe('Referensi-Laporan-LabaRugi-Toko-all.xlsx')
    expect(REFERENSI_PREFIX).toBe('Referensi-')
  })
})

describe('baris penafian Excel', () => {
  it('menaruh judul penafian di baris pertama, sebelum data apa pun', () => {
    const rows = disclaimerAoa(DISCLAIMER_PAJAK)
    expect(rows[0][0]).toBe('REFERENSI — BUKAN DOKUMEN RESMI PERPAJAKAN.')
  })

  it('ditutup baris kosong sebagai pemisah dari tabel di bawahnya', () => {
    const rows = disclaimerAoa(DISCLAIMER_KUR)
    expect(rows[rows.length - 1]).toEqual([])
  })

  it('memotong badan teks agar tiap baris tetap terbaca di satu sel', () => {
    const rows = disclaimerAoa(DISCLAIMER_KUR)
    const isi = rows.slice(0, -1)
    expect(isi.length).toBeGreaterThan(1)
    for (const [sel] of isi) expect(sel.length).toBeLessThanOrEqual(95)
    // Tidak ada kata yang terpotong: gabungan baris = teks asli.
    expect(isi.map(([s]) => s).join(' ')).toBe(DISCLAIMER_KUR.replace('\n', ' '))
  })
})

describe('stempel penafian PDF', () => {
  it('menggambar penafian di setiap halaman, bukan hanya halaman terakhir', () => {
    const doc = fakeDoc(4)
    stampPdfDisclaimer(doc, DISCLAIMER_PAJAK)
    const halamanTerstempel = new Set(
      doc.dipanggil.filter((c) => Array.isArray(c.isi)).map((c) => c.halaman)
    )
    expect([...halamanTerstempel].sort()).toEqual([1, 2, 3, 4])
  })

  it('menomori halaman dengan jumlah total yang benar', () => {
    const doc = fakeDoc(3)
    stampPdfDisclaimer(doc, DISCLAIMER_KUR)
    const nomor = doc.dipanggil.filter((c) => typeof c.isi === 'string' && c.isi.startsWith('Halaman'))
    expect(nomor.map((c) => c.isi)).toEqual([
      'Halaman 1 dari 3', 'Halaman 2 dari 3', 'Halaman 3 dari 3',
    ])
  })

  it('menaruh penafian di dalam area kaki yang dicadangkan tabel', () => {
    const doc = fakeDoc(1)
    stampPdfDisclaimer(doc, DISCLAIMER_KUR)
    const blok = doc.dipanggil.find((c) => Array.isArray(c.isi))
    // Tabel memakai margin bawah PDF_FOOTER_H + 4, jadi penafian tidak boleh
    // mulai lebih tinggi dari batas itu.
    expect(blok.y).toBeGreaterThanOrEqual(297 - PDF_FOOTER_H)
  })

  it('aman pada dokumen satu halaman', () => {
    const doc = fakeDoc(1)
    expect(() => stampPdfDisclaimer(doc, DISCLAIMER_PAJAK)).not.toThrow()
    expect(doc.dipanggil.length).toBeGreaterThan(0)
  })
})
