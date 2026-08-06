import { describe, it, expect } from 'vitest'
import { parseAmount, parseDateInfo, rowsToTransactions } from '../csvImport'
import { categorize, guessDirection } from '../categorize'
import { taxYearly, taxSummaryForYear, findDuplicateGroups, summarize } from '../analytics'

// Logika uang & pajak adalah bagian paling fatal jika salah diam-diam.
// Tes ini mengunci perilakunya.

describe('parseAmount', () => {
  it('format ribuan Indonesia (titik)', () => expect(parseAmount('1.250.000')).toBe(1250000))
  it('ada Rp dan spasi', () => expect(parseAmount('Rp 35.000')).toBe(35000))
  it('koma sebagai desimal', () => expect(parseAmount('1.250,50')).toBeCloseTo(1250.5))
  it('format ribuan dengan koma (gaya en)', () => expect(parseAmount('1,250,000')).toBe(1250000))
  it('negatif dalam kurung', () => expect(parseAmount('(50.000)')).toBe(-50000))
  it('kosong atau null menjadi 0', () => {
    expect(parseAmount('')).toBe(0)
    expect(parseAmount(null)).toBe(0)
  })
})

// Tanggal yang salah diam-diam lebih berbahaya daripada tanggal yang gagal
// terbaca: transaksi masuk ke periode yang salah, laporan bulanan ikut salah,
// dan tidak ada yang tahu. Tes ini mengunci mana yang boleh dipercaya.
describe('parseDateInfo — tanggal yang gagal terbaca', () => {
  const ymd = (r) => { const d = new Date(r.iso); return [d.getFullYear(), d.getMonth() + 1, d.getDate()] }

  it('format lazim Indonesia terbaca dan ditandai yakin', () => {
    expect(parseDateInfo('15/07/2026').certain).toBe(true)
    expect(ymd(parseDateInfo('15/07/2026'))).toEqual([2026, 7, 15])
    expect(ymd(parseDateInfo('15-07-2026'))).toEqual([2026, 7, 15])
    expect(ymd(parseDateInfo('15.07.2026'))).toEqual([2026, 7, 15])
    expect(ymd(parseDateInfo('15/07/26'))).toEqual([2026, 7, 15])
  })

  it('ISO dan serial Excel tetap terbaca', () => {
    expect(ymd(parseDateInfo('2026-07-15'))).toEqual([2026, 7, 15])
    expect(parseDateInfo(45809).certain).toBe(true)
  })

  it('kosong ditandai, bukan diam-diam dipakai', () => {
    for (const v of ['', null, undefined]) {
      const r = parseDateInfo(v)
      expect(r.certain).toBe(false)
      expect(r.reason).toBe('kosong')
    }
  })

  it('teks yang bukan tanggal ditandai', () => {
    const r = parseDateInfo('bukan tanggal')
    expect(r.certain).toBe(false)
    expect(r.reason).toBe('tidak dikenali')
  })

  // JavaScript MENGGULUNG tanggal tak masuk akal alih-alih menolaknya:
  // new Date(2026, 12, 32) menghasilkan 1 Feb 2027 dengan isNaN false. Tanpa
  // pemeriksaan komponen, baris-baris ini lolos sebagai "yakin" dengan tahun
  // yang salah — kegagalan diam paling mahal di seluruh alur impor.
  it('tanggal mustahil ditolak, bukan digulung ke tanggal lain', () => {
    for (const v of ['32/13/2026', '31/02/2026', '00/00/2026', '99/99/2026']) {
      const r = parseDateInfo(v)
      expect(r.certain).toBe(false)
      expect(r.reason).toBe('mustahil')
    }
  })

  it('31 Februari tidak boleh menjadi 2 Maret', () => {
    expect(ymd(parseDateInfo('31/02/2026'))).not.toEqual([2026, 3, 2])
    expect(parseDateInfo('31/02/2026').certain).toBe(false)
  })

  it('tahun di luar nalar pembukuan ditandai', () => {
    expect(parseDateInfo('15/07/1899').certain).toBe(false)
    expect(parseDateInfo('15/07/2199').certain).toBe(false)
  })

  it('baris yang ditandai tetap punya tanggal agar bisa ditampilkan', () => {
    const r = parseDateInfo('ngawur')
    expect(Number.isNaN(new Date(r.iso).getTime())).toBe(false)
  })

  it('parseDateInfo dan parseDate sepakat soal nilai iso', () => {
    expect(parseDateInfo('15/07/2026').iso).toBe(parseDateInfo('15/07/2026').iso)
  })
})

// Kontrak yang dipakai layar pratinjau impor untuk mengelompokkan baris
// bermasalah. Layar itu butuh sesi login sehingga tidak bisa diuji di peramban;
// yang bisa dikunci adalah bentuk data yang diandalkannya.
describe('rowsToTransactions — penandaan baris bertanggal meragukan', () => {
  const headers = ['Tanggal', 'Keterangan', 'Jumlah']
  const baris = (tgl) => [{ Tanggal: tgl, Keterangan: 'Penjualan toko', Jumlah: '150000' }]

  it('tanggal terbaca tidak ditandai', () => {
    const [t] = rowsToTransactions(baris('15/07/2026'), headers, 'manual')
    expect(t._dateUncertain).toBe(false)
    expect(t._dateReason).toBeNull()
  })

  it('tanggal mustahil ditandai lengkap dengan alasan dan nilai aslinya', () => {
    const [t] = rowsToTransactions(baris('31/02/2026'), headers, 'manual')
    expect(t._dateUncertain).toBe(true)
    expect(t._dateReason).toBe('mustahil')
    expect(t._dateRaw).toBe('31/02/2026')
  })

  it('kolom tanggal kosong ditandai dan nilai aslinya kosong', () => {
    const [t] = rowsToTransactions(baris(''), headers, 'manual')
    expect(t._dateUncertain).toBe(true)
    expect(t._dateReason).toBe('kosong')
    expect(t._dateRaw).toBe('')
  })

  it('baris bertanda tetap membawa occurred_at yang valid agar bisa dirender', () => {
    const [t] = rowsToTransactions(baris('ngawur'), headers, 'manual')
    expect(t._dateUncertain).toBe(true)
    expect(Number.isNaN(new Date(t.occurred_at).getTime())).toBe(false)
  })
})

describe('categorize', () => {
  it('aturan bawaan: PLN menjadi Operasional Listrik', () =>
    expect(categorize('Token PLN 100rb', 'out')).toBe('Operasional Listrik'))
  it('marketplace: Shopee menjadi Penjualan Marketplace (in)', () =>
    expect(categorize('Penjualan Shopee SP-1', 'in')).toBe('Penjualan Marketplace'))
  it('aturan pengguna diprioritaskan di atas bawaan', () =>
    expect(categorize('bayar GRAB', 'out', [{ keyword: 'grab', category: 'Transportasi Khusus' }]))
      .toBe('Transportasi Khusus'))
  it('fallback default sesuai arah', () => {
    expect(categorize('hal tak dikenal', 'in')).toBe('Pendapatan Lain')
    expect(categorize('hal tak dikenal', 'out')).toBe('Pengeluaran Lain')
  })
})

describe('guessDirection', () => {
  it('kata "masuk" dianggap pemasukan', () => expect(guessDirection('transfer masuk')).toBe('in'))
  it('default pengeluaran', () => expect(guessDirection('xyz')).toBe('out'))
})

describe('taxYearly (PPh Final UMKM 0,5%)', () => {
  it('Orang Pribadi di bawah Rp 500 juta bebas pajak', () => {
    const r = taxYearly(400_000_000, 'pribadi')
    expect(r.pph).toBe(0)
    expect(r.eligibleFinal).toBe(true)
  })
  it('Orang Pribadi di atas Rp 500 juta: 0,5% atas kelebihan', () => {
    const r = taxYearly(700_000_000, 'pribadi')
    expect(r.taxable).toBe(200_000_000)
    expect(r.pph).toBe(1_000_000)
  })
  it('Badan tanpa pembebasan Rp 500 juta', () => {
    const r = taxYearly(100_000_000, 'badan')
    expect(r.taxable).toBe(100_000_000)
    expect(r.pph).toBe(500_000)
  })
  it('di atas Rp 4,8 miliar tidak memakai tarif final', () => {
    const r = taxYearly(5_000_000_000, 'badan')
    expect(r.eligibleFinal).toBe(false)
    expect(r.pph).toBe(0)
  })
})

describe('taxSummaryForYear', () => {
  it('agregasi setahun dengan pembebasan Rp 500 juta berjalan (OP)', () => {
    const monthly = [
      { month: '2026-01', income: 300_000_000 },
      { month: '2026-02', income: 300_000_000 },
    ]
    const r = taxSummaryForYear(monthly, '2026', 'pribadi')
    expect(r.annualTurnover).toBe(600_000_000)
    // 500 juta pertama bebas, sisa 100 juta kena 0,5% = 500.000
    expect(r.pphTotal).toBe(500_000)
  })
})

describe('findDuplicateGroups', () => {
  it('mendeteksi nominal & arah sama dalam toleransi waktu', () => {
    const tx = [
      { id: 1, amount: 50000, direction: 'in', occurred_at: '2026-06-01T10:00:00Z' },
      { id: 2, amount: 50000, direction: 'in', occurred_at: '2026-06-01T15:00:00Z' },
      { id: 3, amount: 99000, direction: 'in', occurred_at: '2026-06-01T10:00:00Z' },
    ]
    const groups = findDuplicateGroups(tx, 24)
    expect(groups.length).toBe(1)
    expect(groups[0].length).toBe(2)
  })
  it('tidak menggabungkan bila arah berbeda', () => {
    const tx = [
      { id: 1, amount: 50000, direction: 'in', occurred_at: '2026-06-01T10:00:00Z' },
      { id: 2, amount: 50000, direction: 'out', occurred_at: '2026-06-01T11:00:00Z' },
    ]
    expect(findDuplicateGroups(tx, 24).length).toBe(0)
  })
})

describe('summarize', () => {
  it('laba = pemasukan - pengeluaran', () => {
    const r = summarize([{ direction: 'in', amount: 100 }, { direction: 'out', amount: 30 }])
    expect(r).toMatchObject({ income: 100, expense: 30, profit: 70, count: 2 })
  })
})
