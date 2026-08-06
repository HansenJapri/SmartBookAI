import { describe, it, expect } from 'vitest'
import { leakFigures, leakConclusion, channelRows, buildLeakReport, leakReportFileName } from '../leakReport'
import { revealLeak } from '../reveal'
import { sampleTransactions } from '../sampleData'

const contoh = () => revealLeak(sampleTransactions(), 'all')

describe('angka laporan kebocoran', () => {
  // Kriteria terima C1: "semua angka konsisten dengan yang tampil di layar
  // Reveal". Rumus pembulatan di bawah disalin persis dari Reveal.jsx; kalau
  // salah satunya berubah tanpa yang lain, test ini merah.
  it('memakai pembulatan yang sama persis dengan layar Reveal', () => {
    const r = contoh()
    const f = leakFigures(r)
    expect(f.marginAsli).toBe(Math.round(r.marginAsli * 1000) / 10)
    expect(f.marginDikira).toBe(Math.round(r.marginDikira * 1000) / 10)
    expect(f.leakPct).toBe(Math.round((r.leak / r.grossOmzet) * 100))
  })

  it('pada data contoh menghasilkan 15% bocor dan margin 14% vs 29%', () => {
    const f = leakFigures(contoh())
    expect(f.leakPct).toBe(15)
    expect(f.marginAsli).toBe(14)
    expect(f.marginDikira).toBe(29)
    expect(f.selisih).toBe(15)
  })

  it('selisih margin sama dengan porsi kebocoran', () => {
    const f = leakFigures(contoh())
    expect(f.selisih).toBeCloseTo(f.leakPct, 1)
  })

  it('tidak pecah saat belum ada omzet', () => {
    const kosong = revealLeak([], 'all')
    const f = leakFigures(kosong)
    expect(f.leakPct).toBe(0)
    expect(Number.isNaN(f.marginAsli)).toBe(false)
  })
})

describe('kalimat kesimpulan', () => {
  it('terisi otomatis mengikuti template C1', () => {
    const kalimat = leakConclusion(contoh())
    expect(kalimat).toBe(
      'Dari omzet kotor Rp 50.000.000, sebanyak Rp 7.500.000 (15%) habis sebelum '
      + 'masuk rekening. Margin aslimu 14%, bukan 29%.',
    )
  })

  it('tata bahasanya utuh: dua kalimat berakhir titik, tanpa placeholder tersisa', () => {
    const kalimat = leakConclusion(contoh())
    expect(kalimat).not.toMatch(/[{}]/)
    expect(kalimat).not.toContain('undefined')
    expect(kalimat).not.toContain('NaN')
    expect(kalimat.trim().endsWith('.')).toBe(true)
    expect(kalimat.split('. ').length).toBe(2)
  })

  it('memberi kalimat yang layak dibaca saat tidak ada data', () => {
    const kalimat = leakConclusion(revealLeak([], 'all'))
    expect(kalimat).toContain('Belum ada data penjualan')
    expect(kalimat).not.toContain('NaN')
  })
})

describe('baris channel', () => {
  it('diurutkan dari potongan terbesar', () => {
    const { tampil } = channelRows(contoh().perChannel)
    const fees = tampil.map((c) => c.fee)
    expect(fees).toEqual([...fees].sort((a, b) => b - a))
  })

  it('data contoh muat seluruhnya tanpa perlu diringkas', () => {
    const { sisa } = channelRows(contoh().perChannel)
    expect(sisa).toBeNull()
  })

  it('channel berlebih diringkas jadi satu baris agar tetap satu halaman', () => {
    const banyak = Array.from({ length: 10 }, (_, i) => ({
      channel: `c${i}`, name: `Channel ${i}`, gross: 1000 * (10 - i), fee: 100 * (10 - i), net: 900 * (10 - i), pct: 0.1,
    }))
    const { tampil, sisa } = channelRows(banyak)
    expect(tampil).toHaveLength(6)
    expect(sisa.jml).toBe(4)
    // Totalnya harus tetap jujur: ringkasan memuat sisa yang tidak tercetak.
    const totalFee = banyak.reduce((s, c) => s + c.fee, 0)
    expect(tampil.reduce((s, c) => s + c.fee, 0) + sisa.fee).toBe(totalFee)
  })

  it('aman saat tidak ada channel sama sekali', () => {
    expect(channelRows([]).tampil).toEqual([])
    expect(channelRows(undefined).tampil).toEqual([])
  })
})

// Membangun PDF sungguhan dengan jsPDF. "Satu halaman" adalah kriteria terima
// yang paling mudah jebol diam-diam: menambah satu baris di mana pun bisa
// mendorong isi ke halaman kedua, dan tidak ada yang menyadarinya sampai
// laporan sudah terkirim ke calon pengguna.
describe('berkas PDF', () => {
  const buat = (reveal, bizName = 'Toko Contoh Nusantara') =>
    buildLeakReport({ reveal, bizName, periodLabel: 'Seluruh Periode' })

  it('data contoh menghasilkan tepat satu halaman', async () => {
    const doc = await buat(contoh())
    expect(doc.internal.getNumberOfPages()).toBe(1)
  })

  // Penjaga upgrade jspdf/jspdf-autotable: menghitung halaman saja tidak
  // membuktikan berkasnya benar-benar bisa ditulis. `output()` adalah jalur
  // yang dipakai invoicePdfBlob(), dan itulah yang paling mungkin pecah saat
  // versi mayor berganti.
  it('menghasilkan berkas PDF yang sah (header %PDF- dan penanda akhir)', async () => {
    const doc = await buat(contoh())
    const isi = doc.output('arraybuffer')
    expect(isi.byteLength).toBeGreaterThan(1000)

    const teks = new TextDecoder('latin1').decode(new Uint8Array(isi))
    expect(teks.startsWith('%PDF-')).toBe(true)
    expect(teks.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('tetap satu halaman saat channel jauh lebih banyak dari yang muat', async () => {
    const r = contoh()
    const banyak = Array.from({ length: 40 }, (_, i) => ({
      channel: `c${i}`, name: `Channel Panjang Sekali ${i}`,
      gross: 5_000_000 - i * 1000, fee: 900_000 - i * 1000,
      net: 4_100_000, pct: 0.18,
    }))
    const doc = await buat({ ...r, perChannel: banyak })
    expect(doc.internal.getNumberOfPages()).toBe(1)
  })

  it('tetap satu halaman untuk angka besar dan nama usaha panjang', async () => {
    const r = contoh()
    const besar = {
      ...r,
      grossOmzet: 9_876_543_210, leak: 1_234_567_890, netReceived: 8_641_975_320,
      feeAdmin: 500_000_000, feeOngkir: 300_000_000, feeIklan: 434_567_890,
    }
    const doc = await buat(besar, 'Perkumpulan Usaha Dagang Sejahtera Bersama Nusantara Jaya Abadi')
    expect(doc.internal.getNumberOfPages()).toBe(1)
  })

  it('tidak pecah saat belum ada data sama sekali', async () => {
    const doc = await buat(revealLeak([], 'all'))
    expect(doc.internal.getNumberOfPages()).toBe(1)
  })

  // Risiko tata letak yang paling nyata: tabel memanjang mendorong kotak
  // kesimpulan turun sampai menimpa garis penafian di kaki halaman. Halamannya
  // tetap satu, jadi uji jumlah halaman saja TIDAK akan menangkapnya.
  const batasFooter = (doc) => doc.internal.pageSize.height - 16
  const bawahKesimpulan = (doc) => doc.lastAutoTable.finalY + 7 + 20

  it('kotak kesimpulan tidak menimpa penafian kaki halaman', async () => {
    const doc = await buat(contoh())
    expect(bawahKesimpulan(doc)).toBeLessThan(batasFooter(doc))
  })

  it('masih ada jarak ke footer pada kasus channel terbanyak', async () => {
    const r = contoh()
    const banyak = Array.from({ length: 40 }, (_, i) => ({
      channel: `c${i}`, name: `Channel Panjang Sekali ${i}`,
      gross: 5_000_000, fee: 900_000, net: 4_100_000, pct: 0.18,
    }))
    const doc = await buat({ ...r, perChannel: banyak })
    expect(bawahKesimpulan(doc)).toBeLessThan(batasFooter(doc))
  })

  it('memuat angka utama, kesimpulan, dan penafian', async () => {
    const doc = await buat(contoh())
    const raw = doc.output()
    // jsPDF memecah teks jadi banyak operator, jadi dicari penanda pendek.
    expect(raw).toContain('TOTAL KEBOCORAN')
    expect(raw).toContain('Laporan Kebocoran')
    expect(raw).toContain('Toko Contoh Nusantara')
    expect(raw).toContain('marketplace') // penafian kaki halaman
  })

  it('nama berkas mengikuti pola yang diminta', () => {
    expect(leakReportFileName('Toko Sari', '2026-07')).toBe('Laporan-Kebocoran-Toko Sari-2026-07.pdf')
    expect(leakReportFileName('Toko Sari', 'all')).toBe('Laporan-Kebocoran-Toko Sari-all.pdf')
  })
})
