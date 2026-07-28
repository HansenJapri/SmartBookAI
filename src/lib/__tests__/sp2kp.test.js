import { describe, it, expect } from 'vitest'
import {
  SP2KP_SOURCE_NAME, SP2KP_SITE,
  unitLabel, commodityKeyOf, signalKeyOf, normProvName,
  parseVariants, priceOnDate, buildNationalRows, buildProvinceRows,
  variantListUrl, hntSeriesUrl, provinceComparisonUrl, latestDatesUrl,
} from '../sp2kp'

// ============================================================
// Kontrak transform SP2KP -> commodity_prices. Data contoh diambil dari
// respons API live (api-sp2kp.kemendag.go.id) agar test = gerbang regresi.
// ============================================================

describe('URL builders — hanya bapok (tipe_komoditas_id=1), tanpa HET', () => {
  it('semua endpoint memakai tipe_komoditas_id=1', () => {
    expect(variantListUrl()).toContain('tipe_komoditas_id=1')
    expect(latestDatesUrl()).toContain('tipe_komoditas_id=1')
  })
  it('endpoint bulk berauth TIDAK dipakai', () => {
    for (const u of [variantListUrl(), latestDatesUrl(), hntSeriesUrl(52, '2026-07-20', '2026-07-27'), provinceComparisonUrl(52, '2026-07-27')]) {
      expect(u).not.toContain('generate-perbandingan-harga')
      expect(u).not.toContain('het-ha')
    }
  })
})

describe('unitLabel', () => {
  it('memetakan satuan SP2KP ke label Rp/<unit>', () => {
    expect(unitLabel('kg')).toBe('Rp/kg')
    expect(unitLabel('Kg')).toBe('Rp/kg')
    expect(unitLabel('lt')).toBe('Rp/liter')
    expect(unitLabel('400gr')).toBe('Rp/400gr')
    expect(unitLabel('')).toBe('Rp/kg')
    expect(unitLabel(null)).toBe('Rp/kg')
  })
})

describe('signalKeyOf (overlay sinyal RAG ke bapok)', () => {
  it('memetakan variant ke kunci sinyal makro-harian', () => {
    expect(signalKeyOf('Beras Medium')).toBe('beras')
    expect(signalKeyOf('Minyakita')).toBe('minyak_goreng')
    expect(signalKeyOf('Minyak Goreng Sawit Curah')).toBe('minyak_goreng')
    expect(signalKeyOf('Daging Ayam Ras')).toBe('ayam')
    expect(signalKeyOf('Daging Sapi Paha Belakang')).toBe('daging_sapi')
    expect(signalKeyOf('Cabai Merah Keriting')).toBe('cabai_merah')
    expect(signalKeyOf('Cabai Rawit Merah')).toBe('cabai_rawit')
    expect(signalKeyOf('Bawang Putih Honan')).toBe('bawang_putih')
    expect(signalKeyOf('Ikan Kembung')).toBe('ikan')
  })
  it('return kosong untuk komoditas tanpa sinyal', () => {
    expect(signalKeyOf('Mie Instan')).toBe('')
    expect(signalKeyOf('Tahu Putih')).toBe('')
  })
})

describe('normProvName (cocokkan nama provinsi lintas sumber)', () => {
  it('menyamakan variasi ejaan', () => {
    expect(normProvName('DKI Jakarta')).toBe(normProvName('Dki Jakarta'))
    expect(normProvName('DI Yogyakarta')).toBe(normProvName('Daerah Istimewa Yogyakarta'))
    expect(normProvName('Sumatera Utara')).toBe('sumatera utara')
  })
})

describe('parseVariants', () => {
  const sample = {
    data: [
      { id: 52, nama: 'Beras Medium', tipe_komoditas_id: 1, is_nasional: true, order_public: 0, satuan: { display: 'kg' } },
      { id: 1, nama: 'Beras SPHP Bulog', tipe_komoditas_id: 1, is_nasional: false, order_public: 2, satuan: { display: 'kg' } },
      { id: 18, nama: 'Minyakita', tipe_komoditas_id: 1, is_nasional: true, order_public: 7, satuan: { display: 'lt' } },
      { id: 999, nama: 'X-HET', tipe_komoditas_id: 2, satuan: { display: 'kg' } }, // bukan bapok -> dibuang
      { id: 0, nama: '', tipe_komoditas_id: 1 }, // kosong -> dibuang
    ],
  }
  it('hanya bapok valid, unit ternormalisasi', () => {
    const v = parseVariants(sample)
    expect(v.map((x) => x.id)).toEqual([52, 1, 18])
    expect(v.find((x) => x.id === 18).unit).toBe('Rp/liter')
    expect(v.find((x) => x.id === 1).is_nasional).toBe(false)
  })
})

describe('priceOnDate', () => {
  const series = { data: [
    { tanggal_data: '2026-07-24', harga: 13857 },
    { tanggal_data: '2026-07-27', harga: 13862 },
  ] }
  it('ambil harga pada tanggal persis', () => {
    expect(priceOnDate(series, '2026-07-27')).toBe(13862)
    expect(priceOnDate(series, '2026-07-24')).toBe(13857)
  })
  it('fallback ke nilai terakhir bila tanggal tak ada', () => {
    expect(priceOnDate(series, '2026-07-25')).toBe(13862)
  })
})

describe('buildNationalRows — atribusi SP2KP & harga sama persis', () => {
  const variants = [
    { id: 52, nama: 'Beras Medium', unit: 'Rp/kg', is_nasional: true },
    { id: 1, nama: 'Beras SPHP Bulog', unit: 'Rp/kg', is_nasional: false },
  ]
  const seriesByVariant = {
    52: { data: [{ tanggal_data: '2026-07-24', harga: 13857 }, { tanggal_data: '2026-07-27', harga: 13862 }] },
    1: { data: [] }, // tanpa harga nasional
  }
  const rows = buildNationalRows({ variants, seriesByVariant, tanggal: '2026-07-27', tanggalPembanding: '2026-07-24', runKey: '2026-07-27' })

  it('harga cocok dengan HNT SP2KP (13862) & prev 13857', () => {
    expect(rows).toHaveLength(1) // Beras SPHP Bulog dilewati (tanpa harga nasional)
    const r = rows[0]
    expect(r.price).toBe(13862)
    expect(r.prev_price).toBe(13857)
    expect(r.province_id).toBe(0)
    expect(r.is_group).toBe(true)
  })
  it('atribusi WAJIB SP2KP Kemendag, bukan PIHPS/BI', () => {
    expect(rows[0].source_name).toBe(SP2KP_SOURCE_NAME)
    expect(rows[0].source_url).toBe(SP2KP_SITE)
    expect(rows[0].source_name).not.toMatch(/PIHPS|Bank Indonesia/)
    expect(rows[0].source_url).not.toMatch(/bi\.go\.id/)
  })
  it('commodity_key stabil berbasis id variant', () => {
    expect(rows[0].commodity_key).toBe(commodityKeyOf({ id: 52 }))
    expect(rows[0].commodity_key).toBe('sp2kp-52')
  })
})

describe('buildProvinceRows — cocok via nama provinsi (kode BPS berbeda)', () => {
  const variants = [{ id: 52, nama: 'Beras Medium', unit: 'Rp/kg' }]
  // compByVariant = tanggal terkini (27 Jul); compPrevByVariant = tanggal
  // pembanding (24 Jul). harga_sebelumnya (basis bulan lalu) SENGAJA diabaikan.
  const compByVariant = {
    52: { data: { tanggal: '2026-07-27', items: [
      { kode_provinsi: '11', nama_provinsi: 'Aceh', harga: 14845.81, harga_sebelumnya: 14700.00 },
      { kode_provinsi: '31', nama_provinsi: 'DKI Jakarta', harga: 13500, harga_sebelumnya: 13200 },
    ] } },
  }
  const compPrevByVariant = {
    52: { data: { tanggal: '2026-07-24', items: [
      { kode_provinsi: '11', nama_provinsi: 'Aceh', harga: 14753.38 },
      { kode_provinsi: '31', nama_provinsi: 'DKI Jakarta', harga: 13500 },
    ] } },
  }
  it('prev_price = harga tanggal pembanding (24 Jul), BUKAN harga_sebelumnya (bulan lalu)', () => {
    const rows = buildProvinceRows({ variants, compByVariant, compPrevByVariant, provinceId: 1, provinceName: 'Aceh', tanggal: '2026-07-27', runKey: '2026-07-27' })
    expect(rows).toHaveLength(1)
    expect(rows[0].price).toBe(14846)
    expect(rows[0].prev_price).toBe(14753) // dari compPrevByVariant, bukan 14700
    expect(rows[0].province_id).toBe(1)
    expect(rows[0].source_name).toBe(SP2KP_SOURCE_NAME)
  })
  it('prev_price null bila sama dengan harga', () => {
    const rows = buildProvinceRows({ variants, compByVariant, compPrevByVariant, provinceId: 13, provinceName: 'DKI Jakarta', tanggal: '2026-07-27', runKey: '2026-07-27' })
    expect(rows[0].price).toBe(13500)
    expect(rows[0].prev_price).toBeNull()
  })
})
