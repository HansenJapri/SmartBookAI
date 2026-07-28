// ============================================================
// SP2KP Kemendag — sumber harga BARANG KEBUTUHAN POKOK (bapok) untuk Radar Harga.
// Menggantikan PIHPS Bank Indonesia sebagai sumber utama harga.
//
// API publik (tanpa auth) yang dipakai — diverifikasi live 2026-07-27:
//   - master/api/variant?tipe_komoditas_id=1     -> daftar variant bapok
//   - report/api/latest-price-dates?...=1         -> {tanggal, tanggal_pembanding}
//   - report/api/hnt/history-series?variant_id=X  -> harga nasional tertimbang (HNT)
//   - report/api/average-price/province-comparison?variant_id=X&tanggal=Y -> per provinsi
// Endpoint bulk `generate-perbandingan-harga` SENGAJA DIHINDARI (butuh token).
// HANYA tipe_komoditas_id=1 (bapok) — HET/HA tidak diambil.
//
// Sifat: pure functions — tak menyentuh jaringan/DB. Aman untuk unit test dan
// dicerminkan di edge function `harga-daerah` (Deno) agar kontrak konsisten.
// ============================================================

export const SP2KP_API = 'https://api-sp2kp.kemendag.go.id'
export const SP2KP_SITE = 'https://sp2kp.kemendag.go.id'
export const SP2KP_SOURCE_NAME = 'SP2KP Kemendag'
export const BAPOK_TIPE_ID = 1 // tipe_komoditas_id = Barang Kebutuhan Pokok

// ---------- URL builders ----------
const SORT_PUBLIC = encodeURIComponent('[{"selector":"order_public","desc":false}]')
export const variantListUrl = () =>
  `${SP2KP_API}/master/api/variant?take=99999&sort=${SORT_PUBLIC}&tipe_komoditas_id=${BAPOK_TIPE_ID}&is_active=true`
export const latestDatesUrl = () =>
  `${SP2KP_API}/report/api/latest-price-dates?tipe_komoditas_id=${BAPOK_TIPE_ID}`
export const hntSeriesUrl = (variantId, start, end) =>
  `${SP2KP_API}/report/api/hnt/history-series?tanggal_start=${start}&tanggal_end=${end}&variant_id=${variantId}`
export const provinceComparisonUrl = (variantId, tanggal) =>
  `${SP2KP_API}/report/api/average-price/province-comparison?variant_id=${variantId}&tanggal=${tanggal}`

// ---------- Normalisasi ----------
// Satuan SP2KP (kg, lt, 400gr, bks, ekor, ...) -> label 'Rp/<unit>' selaras
// skema commodity_prices yang sudah dipakai UI.
export function unitLabel(satuanDisplay) {
  const s = String(satuanDisplay || 'kg').trim().toLowerCase()
  if (s === 'lt' || s === 'l' || s === 'liter') return 'Rp/liter'
  if (s === '' || s === 'kg') return 'Rp/kg'
  return 'Rp/' + s
}

// commodity_key STABIL berbasis id variant SP2KP (bukan nama, agar tahan
// perubahan ejaan). Dipakai sebagai kunci baris di commodity_prices.
export const commodityKeyOf = (variant) => 'sp2kp-' + variant.id

// Alias variant SP2KP -> kunci sinyal RAG makro-harian (untuk overlay
// perkiraan 30 hari). Return '' bila komoditas tak punya sinyal RAG.
export function signalKeyOf(variantName) {
  const n = String(variantName || '').toLowerCase()
  if (n.includes('beras')) return 'beras'
  if (n.includes('gula')) return 'gula'
  if (n.includes('minyak') || n.includes('minyakita')) return 'minyak_goreng'
  if (n.includes('kerbau') || n.includes('daging sapi')) return 'daging_sapi'
  if (n.includes('daging ayam')) return 'ayam'
  if (n.includes('telur')) return 'telur'
  if (n.includes('terigu')) return 'terigu'
  if (n.includes('kedelai')) return 'kedelai'
  if (n.includes('cabai merah')) return 'cabai_merah'
  if (n.includes('cabai rawit')) return 'cabai_rawit'
  if (n.includes('bawang merah')) return 'bawang_merah'
  if (n.includes('bawang putih')) return 'bawang_putih'
  if (n.includes('ikan') || n.includes('udang') || n.includes('bandeng') || n.includes('tongkol')) return 'ikan'
  if (n.includes('jagung')) return 'jagung'
  if (n.includes('garam')) return 'garam'
  if (n.includes('susu')) return 'susu'
  return ''
}

// Samakan nama provinsi lintas sumber (SP2KP pakai kode BPS; app pakai id
// PIHPS 1..34) — pencocokan dilakukan lewat NAMA yang dinormalisasi.
export function normProvName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\bprov(insi)?\.?\b/g, '')
    .replace(/\bdaerah istimewa\b/g, 'di')
    .replace(/\bd\.i\.?\b/g, 'di')
    .replace(/[^a-z]+/g, ' ')
    .trim()
}

// ---------- Parsing respons ----------
// Ekstrak variant bapok bersih dari respons master/api/variant.
export function parseVariants(apiJson) {
  return (apiJson?.data || [])
    .filter((v) => v && v.id && v.tipe_komoditas_id === BAPOK_TIPE_ID)
    .map((v) => ({
      id: v.id,
      nama: v.nama || v.nama_variant || (v.komoditas && v.komoditas.nama) || '',
      unit: unitLabel(v.satuan && (v.satuan.display || v.satuan.nama)),
      is_nasional: v.is_nasional !== false,
      order: v.order_public ?? v.order ?? 999,
    }))
    .filter((v) => v.nama)
}

// Ambil harga pada tanggal tertentu dari series HNT ({data:[{tanggal_data,harga}]}).
// Fallback: nilai terakhir bila tanggal persis tak ada.
export function priceOnDate(series, tanggal) {
  const arr = (series && series.data) || (Array.isArray(series) ? series : [])
  const hit = arr.find((x) => x.tanggal_data === tanggal)
  if (hit) return Math.round(Number(hit.harga) || 0)
  const last = arr[arr.length - 1]
  return last ? Math.round(Number(last.harga) || 0) : 0
}

// Bangun baris commodity_prices NASIONAL (province_id=0) dari variant + peta
// series HNT per variant id. Variant tanpa harga nasional (is_nasional=false /
// belum terisi) DILEWATI — sama seperti baris kosong di situs SP2KP.
export function buildNationalRows({ variants, seriesByVariant, tanggal, tanggalPembanding, runKey }) {
  const rows = []
  for (const v of variants || []) {
    const series = (seriesByVariant || {})[v.id]
    const price = priceOnDate(series, tanggal)
    if (price <= 0) continue
    const prev = tanggalPembanding ? priceOnDate(series, tanggalPembanding) : 0
    rows.push({
      run_date: runKey,
      commodity_key: commodityKeyOf(v),
      variant_name: v.nama,
      is_group: true,
      price,
      prev_price: prev > 0 && prev !== price ? prev : null,
      price_date: tanggal || null,
      unit: v.unit,
      source_name: SP2KP_SOURCE_NAME,
      source_url: SP2KP_SITE,
      province_id: 0,
    })
  }
  return rows
}

// Bangun baris commodity_prices PER PROVINSI dari peta province-comparison per
// variant id. `provinceName` = nama provinsi app (dicocokkan ke items SP2KP).
// prev_price diambil dari `compPrevByVariant` (province-comparison pada TANGGAL
// PEMBANDING / hari-data sebelumnya) — SAMA dengan tabel default SP2KP. Field
// `harga_sebelumnya` respons TIDAK dipakai karena berbasis BULAN LALU sehingga
// %/arah akan meleset dari situs SP2KP.
export function buildProvinceRows({ variants, compByVariant, compPrevByVariant, provinceId, provinceName, tanggal, runKey }) {
  const target = normProvName(provinceName)
  const pick = (comp) => {
    const data = (comp && comp.data) || comp || {}
    const it = (data.items || []).find((x) => normProvName(x.nama_provinsi) === target)
    return { data, it }
  }
  const rows = []
  for (const v of variants || []) {
    const { data, it } = pick((compByVariant || {})[v.id])
    if (!it) continue
    const price = Math.round(Number(it.harga) || 0)
    if (price <= 0) continue
    const { it: itPrev } = pick((compPrevByVariant || {})[v.id])
    const prev = itPrev ? Math.round(Number(itPrev.harga) || 0) : 0
    rows.push({
      run_date: runKey,
      commodity_key: commodityKeyOf(v),
      variant_name: v.nama,
      is_group: true,
      price,
      prev_price: prev > 0 && prev !== price ? prev : null,
      price_date: data.tanggal || tanggal || null,
      unit: v.unit,
      source_name: SP2KP_SOURCE_NAME,
      source_url: SP2KP_SITE,
      province_id: provinceId,
    })
  }
  return rows
}
