// ============================================================
// Cabang tepi modul uang — melengkapi hpp.test / aging.test / kpi.test yang
// sudah ada, khusus menutup Q-03 (§5.2: coverage CABANG modul uang ≥ 90%).
//
// Yang dikejar di sini bukan jalur normal — itu sudah diuji — melainkan cabang
// yang hanya jalan saat datanya cacat: nominal berupa teks, persentase null,
// pembagi nol, kunci komoditas tak dikenal. Justru di situlah salah hitung uang
// lolos tanpa error, karena JavaScript diam-diam menghasilkan NaN dan NaN
// dirender sebagai "Rp NaN" atau, lebih buruk, ikut dijumlahkan.
// ============================================================
import { describe, it, expect } from 'vitest'
import {
  computeHpp, marginPct, priceForMargin, applyAdjustments,
  applyMacroScenario, applyKursScenario, EXPOSURE_FACTOR, COMMODITY_LABEL, COMMODITIES,
} from '../hpp'
import {
  daysOutstanding, isOverdue, agingBucketKey, buildAgingSummary,
  normalizePhone, waReminderLink,
} from '../aging'
import {
  attendanceScore, taskScore, weightedTotal, applyBonusTier,
  attendanceAdjustments, recapAttendance,
} from '../kpi'

// ---------------- HPP ----------------

describe('hpp — cabang tepi', () => {
  it('computeHpp memperlakukan qty/harga non-angka sebagai 0, bukan NaN', () => {
    expect(computeHpp([
      { qty: 'dua', price_per_unit: 1000 },
      { qty: 2, price_per_unit: null },
      { qty: undefined, price_per_unit: undefined },
      { qty: 3, price_per_unit: 500 },
    ])).toBe(1500)
  })

  it('computeHpp atas daftar kosong = 0', () => {
    expect(computeHpp([])).toBe(0)
  })

  it('marginPct mengembalikan 0 untuk harga jual 0 atau negatif', () => {
    expect(marginPct(0, 5000)).toBe(0)
    expect(marginPct(-100, 5000)).toBe(0)
    expect(marginPct('bukan angka', 5000)).toBe(0)
  })

  it('marginPct bisa negatif saat HPP melebihi harga jual (jualan rugi)', () => {
    expect(marginPct(10000, 15000)).toBe(-50)
  })

  it('priceForMargin membatasi target margin pada 95%', () => {
    // Tanpa clamp, target 100% membuat pembagi 0 -> Infinity -> "Rp ∞".
    const pada95 = priceForMargin(10000, 95)
    expect(priceForMargin(10000, 100)).toBe(pada95)
    expect(priceForMargin(10000, 999)).toBe(pada95)
    expect(Number.isFinite(pada95)).toBe(true)
  })

  it('priceForMargin memperlakukan target negatif & non-angka sebagai 0', () => {
    expect(priceForMargin(10000, -50)).toBe(10000)
    expect(priceForMargin(10000, 'abc')).toBe(10000)
    expect(priceForMargin(10000, null)).toBe(10000)
  })

  it('priceForMargin menaikkan harga sesuai margin yang diminta', () => {
    expect(priceForMargin(10000, 50)).toBe(20000)
  })

  it('applyAdjustments memperlakukan persentase non-angka sebagai 0%', () => {
    const rows = [{ qty: 2, price_per_unit: 1000 }]
    expect(applyAdjustments(rows, () => null)).toBe(2000)
    expect(applyAdjustments(rows, () => 'abc')).toBe(2000)
    expect(applyAdjustments(rows, () => undefined)).toBe(2000)
  })

  it('applyAdjustments menangani penurunan harga (persentase negatif)', () => {
    expect(applyAdjustments([{ qty: 1, price_per_unit: 1000 }], () => -20)).toBe(800)
  })

  it('applyAdjustments tetap 0 untuk baris dengan data rusak', () => {
    expect(applyAdjustments([{ qty: 'x', price_per_unit: 'y' }], () => 50)).toBe(0)
  })

  it('applyMacroScenario memakai 0% untuk komoditas tanpa sinyal', () => {
    const rows = [
      { qty: 1, price_per_unit: 1000, commodity_key: 'beras' },
      { qty: 1, price_per_unit: 1000, commodity_key: 'tidak_ada_di_sinyal' },
      { qty: 1, price_per_unit: 1000 }, // tanpa commodity_key sama sekali
    ]
    const s = applyMacroScenario(rows, { beras: { est_pct_min: 10, est_pct_max: 20 } })
    expect(s.base).toBe(3000)
    expect(s.min).toBe(3100)
    expect(s.max).toBe(3200)
  })

  it('applyMacroScenario menukar min & max bila sinyalnya terbalik', () => {
    // Sinyal cacat (min > max) tidak boleh menghasilkan rentang terbalik di UI.
    const rows = [{ qty: 1, price_per_unit: 1000, commodity_key: 'gula' }]
    const s = applyMacroScenario(rows, { gula: { est_pct_min: 30, est_pct_max: 10 } })
    expect(s.min).toBeLessThanOrEqual(s.max)
    expect(s.min).toBe(1100)
    expect(s.max).toBe(1300)
  })

  it('applyKursScenario memakai faktor paparan sesuai tingkatnya', () => {
    const base = { qty: 1, price_per_unit: 1000 }
    expect(applyKursScenario([{ ...base, import_exposure: 'tinggi' }], 10).next).toBe(1070)
    expect(applyKursScenario([{ ...base, import_exposure: 'sedang' }], 10).next).toBe(1040)
    expect(applyKursScenario([{ ...base, import_exposure: 'rendah' }], 10).next).toBe(1010)
  })

  it('applyKursScenario jatuh ke faktor "rendah" untuk paparan tak dikenal atau kosong', () => {
    const base = { qty: 1, price_per_unit: 1000 }
    expect(applyKursScenario([{ ...base, import_exposure: 'ngawur' }], 10).next).toBe(1010)
    expect(applyKursScenario([base], 10).next).toBe(1010)
  })

  it('applyKursScenario dengan kurs non-angka tidak mengubah HPP', () => {
    const rows = [{ qty: 1, price_per_unit: 1000, import_exposure: 'tinggi' }]
    expect(applyKursScenario(rows, 'abc').next).toBe(1000)
    expect(applyKursScenario(rows, null).next).toBe(1000)
  })

  it('faktor paparan konservatif: tinggi > sedang > rendah, semuanya < 1', () => {
    expect(EXPOSURE_FACTOR.tinggi).toBeGreaterThan(EXPOSURE_FACTOR.sedang)
    expect(EXPOSURE_FACTOR.sedang).toBeGreaterThan(EXPOSURE_FACTOR.rendah)
    expect(EXPOSURE_FACTOR.tinggi).toBeLessThan(1)
  })

  it('COMMODITY_LABEL mencakup seluruh komoditas tanpa kunci ganda', () => {
    expect(Object.keys(COMMODITY_LABEL)).toHaveLength(COMMODITIES.length)
    expect(new Set(COMMODITIES.map((c) => c.key)).size).toBe(COMMODITIES.length)
  })
})

// ---------------- Aging (piutang/utang) ----------------

describe('aging — cabang tepi', () => {
  const HARI_INI = new Date('2026-08-05T12:00:00')

  it('daysOutstanding mengembalikan 0 untuk tanggal tidak sah', () => {
    expect(daysOutstanding({ occurred_at: 'bukan tanggal' }, HARI_INI)).toBe(0)
    expect(daysOutstanding({}, HARI_INI)).toBe(0) // undefined -> Invalid Date
  })

  // Kejanggalan nyata: `new Date(null)` BUKAN Invalid Date, melainkan epoch
  // 1970-01-01. Penjaga Number.isNaN karena itu tidak menangkapnya, dan tagihan
  // ber-occurred_at null dihitung berumur ~56 tahun lalu masuk bucket "> 90
  // hari". Dikunci apa adanya, bukan diperbaiki: kolom occurred_at NOT NULL di
  // database, jadi ini belum bisa terjadi lewat jalur normal. Kalau suatu saat
  // kolomnya dibuat nullable, test inilah yang akan mengingatkan.
  it('occurred_at null dihitung sebagai epoch 1970, bukan 0 hari', () => {
    expect(daysOutstanding({ occurred_at: null }, HARI_INI)).toBeGreaterThan(20000)
    expect(agingBucketKey(daysOutstanding({ occurred_at: null }, HARI_INI))).toBe('b90p')
  })

  it('daysOutstanding tidak pernah negatif untuk transaksi bertanggal masa depan', () => {
    expect(daysOutstanding({ occurred_at: '2026-12-01T00:00:00' }, HARI_INI)).toBe(0)
  })

  it('isOverdue false bila jatuh tempo tidak diisi', () => {
    expect(isOverdue({}, HARI_INI)).toBe(false)
    expect(isOverdue({ due_date: '' }, HARI_INI)).toBe(false)
    expect(isOverdue({ due_date: null }, HARI_INI)).toBe(false)
  })

  it('isOverdue membandingkan per-tanggal: hari-H belum lewat tempo', () => {
    // Jatuh tempo hari ini pukul 12.00 -> belum lewat (batasnya 23:59:59).
    expect(isOverdue({ due_date: '2026-08-05' }, HARI_INI)).toBe(false)
    expect(isOverdue({ due_date: '2026-08-04' }, HARI_INI)).toBe(true)
  })

  it('agingBucketKey menempatkan tepat di batas bucket', () => {
    expect(agingBucketKey(0)).toBe('b30')
    expect(agingBucketKey(30)).toBe('b30')
    expect(agingBucketKey(31)).toBe('b60')
    expect(agingBucketKey(60)).toBe('b60')
    expect(agingBucketKey(61)).toBe('b90')
    expect(agingBucketKey(90)).toBe('b90')
    expect(agingBucketKey(91)).toBe('b90p')
    expect(agingBucketKey(99999)).toBe('b90p')
  })

  it('agingBucketKey jatuh ke bucket terakhir untuk umur negatif', () => {
    expect(agingBucketKey(-5)).toBe('b90p')
  })

  it('buildAgingSummary tahan terhadap daftar kosong/null', () => {
    for (const masukan of [[], null, undefined]) {
      const s = buildAgingSummary(masukan, HARI_INI)
      expect(s.count).toBe(0)
      expect(s.total).toBe(0)
      expect(s.overdueCount).toBe(0)
      expect(s.buckets.b30).toEqual({ count: 0, total: 0 })
    }
  })

  it('buildAgingSummary memperlakukan nominal non-angka sebagai 0', () => {
    const s = buildAgingSummary([
      { occurred_at: '2026-08-01T00:00:00', amount: 'seratus ribu' },
      { occurred_at: '2026-08-01T00:00:00', amount: 50000 },
    ], HARI_INI)
    expect(s.total).toBe(50000)
    expect(s.count).toBe(2)
  })

  it('buildAgingSummary menghitung yang lewat tempo terpisah dari total', () => {
    const s = buildAgingSummary([
      { occurred_at: '2026-07-01T00:00:00', amount: 100000, due_date: '2026-07-15' },
      { occurred_at: '2026-08-01T00:00:00', amount: 200000, due_date: '2026-09-30' },
    ], HARI_INI)
    expect(s.total).toBe(300000)
    expect(s.overdueCount).toBe(1)
    expect(s.overdueTotal).toBe(100000)
  })

  it('normalizePhone menangani seluruh bentuk awalan', () => {
    expect(normalizePhone('081234567890')).toBe('6281234567890')
    expect(normalizePhone('6281234567890')).toBe('6281234567890')
    expect(normalizePhone('81234567890')).toBe('6281234567890')
    expect(normalizePhone('+62 812-3456-7890')).toBe('6281234567890')
  })

  it('normalizePhone meneruskan apa adanya bentuk yang tak dikenali', () => {
    // Cabang terakhir: bukan 62/0/8 — mis. nomor telepon rumah berawalan 7.
    expect(normalizePhone('7123456')).toBe('7123456')
  })

  it('normalizePhone mengembalikan string kosong bila tidak ada digit', () => {
    expect(normalizePhone('')).toBe('')
    expect(normalizePhone(null)).toBe('')
    expect(normalizePhone('abc-def')).toBe('')
  })

  it('waReminderLink kosong bila kontak tidak ada', () => {
    expect(waReminderLink({ amount: 1000, description: 'x' })).toBe('')
    expect(waReminderLink({ customer_contact: 'abc', amount: 1000, description: 'x' })).toBe('')
  })

  it('waReminderLink menyusun pesan lengkap dengan nama, tempo, dan usaha', () => {
    const url = waReminderLink({
      customer_contact: '081234567890', customer_name: 'Bu Sari',
      description: 'Kue coklat', amount: 45000, due_date: '2026-08-10',
    }, 'Toko Kue', (n) => `Rp ${n}`)

    expect(url.startsWith('https://wa.me/6281234567890?text=')).toBe(true)
    const pesan = decodeURIComponent(url.split('text=')[1])
    expect(pesan).toContain('Halo Bu Sari,')
    expect(pesan).toContain('Kue coklat')
    expect(pesan).toContain('Rp 45000')
    expect(pesan).toContain('jatuh tempo 2026-08-10')
    expect(pesan).toContain('— Toko Kue')
  })

  it('waReminderLink menghilangkan bagian opsional yang kosong', () => {
    const url = waReminderLink({
      customer_contact: '081234567890', description: 'Barang', amount: 1000,
    })
    const pesan = decodeURIComponent(url.split('text=')[1])
    expect(pesan.startsWith('Halo, mengingatkan')).toBe(true)
    expect(pesan).not.toContain('jatuh tempo')
    expect(pesan).not.toContain('—')
  })
})

// ---------------- KPI & payroll ----------------

describe('kpi — cabang tepi', () => {
  it('attendanceScore null bila belum ada catatan absensi sama sekali', () => {
    expect(attendanceScore(null)).toBeNull()
    expect(attendanceScore({})).toBeNull()
    expect(attendanceScore({ hadir: 0, izin: 0, sakit: 0, cuti: 0, alpa: 0 })).toBeNull()
  })

  it('attendanceScore: hadir & cuti penuh, izin/sakit setengah, alpa nol', () => {
    expect(attendanceScore({ hadir: 10 })).toBe(100)
    expect(attendanceScore({ cuti: 10 })).toBe(100)
    expect(attendanceScore({ alpa: 10 })).toBe(0)
    expect(attendanceScore({ hadir: 5, izin: 5 })).toBe(75)
    expect(attendanceScore({ hadir: 5, sakit: 5 })).toBe(75)
  })

  it('attendanceScore mengabaikan nilai non-angka', () => {
    expect(attendanceScore({ hadir: '10', izin: 'abc' })).toBe(100)
  })

  it('taskScore null bila karyawan tidak punya tugas di periode itu', () => {
    expect(taskScore([], 'e1', '2026-08')).toBeNull()
    expect(taskScore(null, 'e1', '2026-08')).toBeNull()
    expect(taskScore([{ assignee_id: 'e2', due_date: '2026-08-01' }], 'e1', '2026-08')).toBeNull()
    expect(taskScore([{ assignee_id: 'e1', due_date: '2026-07-01' }], 'e1', '2026-08')).toBeNull()
  })

  it('taskScore menghargai selesai tepat waktu penuh, terlambat setengah', () => {
    const tugas = (over) => ({ assignee_id: 'e1', due_date: '2026-08-10', status: 'selesai', ...over })
    expect(taskScore([tugas({ done_at: '2026-08-09' })], 'e1', '2026-08')).toBe(100)
    expect(taskScore([tugas({ done_at: '2026-08-15' })], 'e1', '2026-08')).toBe(50)
  })

  it('taskScore memberi 0 untuk tugas yang belum selesai', () => {
    expect(taskScore([
      { assignee_id: 'e1', due_date: '2026-08-10', status: 'berjalan' },
    ], 'e1', '2026-08')).toBe(0)
  })

  it('taskScore ikut menghitung tugas yang diselesaikan di periode itu walau tempo di luar', () => {
    expect(taskScore([
      { assignee_id: 'e1', due_date: '2026-07-01', done_at: '2026-08-03', status: 'selesai' },
    ], 'e1', '2026-08')).toBe(50) // selesai lewat tempo -> setengah
  })

  it('weightedTotal null bila tidak ada kriteria berbobot yang punya skor', () => {
    expect(weightedTotal([], {})).toBeNull()
    expect(weightedTotal(null, {})).toBeNull()
    expect(weightedTotal([{ id: 'a', weight: 40 }], {})).toBeNull()
    expect(weightedTotal([{ id: 'a', weight: 40 }], { a: null })).toBeNull()
    expect(weightedTotal([{ id: 'a', weight: 40 }], { a: '' })).toBeNull()
  })

  it('weightedTotal melewati kriteria nonaktif dan berbobot nol', () => {
    const kriteria = [
      { id: 'a', weight: 40, active: false },
      { id: 'b', weight: 0 },
      { id: 'c', weight: 60 },
    ]
    expect(weightedTotal(kriteria, { a: 0, b: 0, c: 80 })).toBe(80)
  })

  it('weightedTotal menormalkan bobot terhadap kriteria yang ikut dihitung saja', () => {
    // Kriteria tanpa skor tidak boleh menyeret total ke bawah.
    const kriteria = [{ id: 'a', weight: 40 }, { id: 'b', weight: 60 }]
    expect(weightedTotal(kriteria, { a: 100 })).toBe(100)
    expect(weightedTotal(kriteria, { a: 100, b: 50 })).toBe(70)
  })

  it('weightedTotal membatasi skor di luar 0-100', () => {
    expect(weightedTotal([{ id: 'a', weight: 1 }], { a: 500 })).toBe(100)
    expect(weightedTotal([{ id: 'a', weight: 1 }], { a: -50 })).toBe(0)
  })

  it('applyBonusTier null saat skor belum ada', () => {
    expect(applyBonusTier([{ min_score: 80, bonus: 100000 }], null)).toBeNull()
    expect(applyBonusTier([{ min_score: 80, bonus: 100000 }], undefined)).toBeNull()
  })

  it('applyBonusTier memilih jenjang tertinggi yang terlampaui', () => {
    const aturan = [
      { min_score: 60, bonus: 50000 },
      { min_score: 90, bonus: 200000 },
      { min_score: 80, bonus: 100000 },
    ]
    expect(applyBonusTier(aturan, 95).bonus).toBe(200000)
    expect(applyBonusTier(aturan, 85).bonus).toBe(100000)
    expect(applyBonusTier(aturan, 60).bonus).toBe(50000)
  })

  it('applyBonusTier null bila tidak ada jenjang yang terlampaui', () => {
    expect(applyBonusTier([{ min_score: 80, bonus: 1 }], 50)).toBeNull()
    expect(applyBonusTier([], 100)).toBeNull()
    expect(applyBonusTier(null, 100)).toBeNull()
  })

  it('applyBonusTier membulatkan bonus & potongan, default 0', () => {
    const hasil = applyBonusTier([{ min_score: 0, bonus: 1000.6 }], 10)
    expect(hasil.bonus).toBe(1001)
    expect(hasil.deduction).toBe(0)
  })

  it('attendanceAdjustments kosong tanpa aturan atau tanpa rekap', () => {
    expect(attendanceAdjustments({}, [])).toEqual({ bonus: 0, deduction: 0, detail: [] })
    expect(attendanceAdjustments(null, null)).toEqual({ bonus: 0, deduction: 0, detail: [] })
  })

  it('attendanceAdjustments menjumlahkan bonus & potongan per status', () => {
    const hasil = attendanceAdjustments(
      { hadir: 20, alpa: 2 },
      [
        { status: 'hadir', bonus_per_day: 10000 },
        { status: 'alpa', deduction_per_day: 50000 },
      ],
    )
    expect(hasil.bonus).toBe(200000)
    expect(hasil.deduction).toBe(100000)
    expect(hasil.detail).toEqual(['bonus hadir 20 hari', 'potongan alpa 2 hari'])
  })

  it('attendanceAdjustments melewati status tanpa aturan atau berjumlah 0', () => {
    const hasil = attendanceAdjustments(
      { hadir: 0, sakit: 3 },
      [{ status: 'hadir', bonus_per_day: 10000 }],
    )
    expect(hasil).toEqual({ bonus: 0, deduction: 0, detail: [] })
  })

  it('recapAttendance hanya menghitung karyawan yang diminta & status yang dikenal', () => {
    const rc = recapAttendance([
      { employee_id: 'e1', status: 'hadir' },
      { employee_id: 'e1', status: 'hadir' },
      { employee_id: 'e1', status: 'status_ngawur' },
      { employee_id: 'e2', status: 'hadir' },
    ], 'e1')
    expect(rc).toEqual({ hadir: 2, izin: 0, sakit: 0, cuti: 0, alpa: 0 })
  })

  it('recapAttendance tahan terhadap daftar kosong/null', () => {
    expect(recapAttendance(null, 'e1')).toEqual({ hadir: 0, izin: 0, sakit: 0, cuti: 0, alpa: 0 })
  })
})
