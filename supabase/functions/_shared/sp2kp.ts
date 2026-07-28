// ============================================================
// Shared (Deno/Edge): sumber harga BARANG KEBUTUHAN POKOK (bapok) SP2KP Kemendag.
// Dipakai oleh edge function `harga-daerah` (on-demand) & `makro-harian` (cron).
// Logika transform DICERMINKAN dari src/lib/sp2kp.js yang teruji unit.
// HANYA tipe_komoditas_id=1 (bapok) — HET/HA tidak diambil.
// Endpoint bulk berauth `generate-perbandingan-harga` SENGAJA DIHINDARI.
// ============================================================

export const SP2KP_API = 'https://api-sp2kp.kemendag.go.id'
export const SP2KP_SITE = 'https://sp2kp.kemendag.go.id'
export const SP2KP_SOURCE_NAME = 'SP2KP Kemendag'
const BAPOK = 1
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// Nama provinsi app (id PIHPS 1..34) — dipakai mencocokkan ke nama SP2KP.
export const PROVINCE_NAME: Record<number, string> = {
  1: 'Aceh', 2: 'Sumatera Utara', 3: 'Sumatera Barat', 4: 'Riau', 5: 'Kepulauan Riau',
  6: 'Jambi', 7: 'Bengkulu', 8: 'Sumatera Selatan', 9: 'Kepulauan Bangka Belitung', 10: 'Lampung',
  11: 'Banten', 12: 'Jawa Barat', 13: 'DKI Jakarta', 14: 'Jawa Tengah', 15: 'DI Yogyakarta',
  16: 'Jawa Timur', 17: 'Bali', 18: 'Nusa Tenggara Barat', 19: 'Nusa Tenggara Timur', 20: 'Kalimantan Barat',
  21: 'Kalimantan Selatan', 22: 'Kalimantan Tengah', 23: 'Kalimantan Timur', 24: 'Kalimantan Utara', 25: 'Gorontalo',
  26: 'Sulawesi Selatan', 27: 'Sulawesi Tenggara', 28: 'Sulawesi Tengah', 29: 'Sulawesi Utara', 30: 'Sulawesi Barat',
  31: 'Maluku', 32: 'Maluku Utara', 33: 'Papua', 34: 'Papua Barat',
}

// ---------- helper murni (cermin src/lib/sp2kp.js) ----------
export const unitLabel = (s?: string) => {
  const u = String(s || 'kg').trim().toLowerCase()
  if (u === 'lt' || u === 'l' || u === 'liter') return 'Rp/liter'
  if (u === '' || u === 'kg') return 'Rp/kg'
  return 'Rp/' + u
}
export const commodityKeyOf = (id: number) => 'sp2kp-' + id
export const normProvName = (name?: string) =>
  String(name || '').toLowerCase()
    .replace(/\bprov(insi)?\.?\b/g, '')
    .replace(/\bdaerah istimewa\b/g, 'di')
    .replace(/\bd\.i\.?\b/g, 'di')
    .replace(/[^a-z]+/g, ' ').trim()
export const priceOnDate = (series: any, tanggal: string) => {
  const arr = (series && series.data) || (Array.isArray(series) ? series : [])
  const hit = arr.find((x: any) => x.tanggal_data === tanggal)
  if (hit) return Math.round(Number(hit.harga) || 0)
  const last = arr[arr.length - 1]
  return last ? Math.round(Number(last.harga) || 0) : 0
}

// ---------- fetch util ----------
async function getJson(url: string, timeoutMs = 20000): Promise<any> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept': 'application/json' } })
    if (!res.ok) return null
    return await res.json()
  } catch { return null } finally { clearTimeout(t) }
}
async function inChunks<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)))
  }
  return out
}

export async function fetchVariants() {
  const sort = encodeURIComponent('[{"selector":"order_public","desc":false}]')
  const j = await getJson(`${SP2KP_API}/master/api/variant?take=99999&sort=${sort}&tipe_komoditas_id=${BAPOK}&is_active=true`)
  return (j?.data || [])
    .filter((v: any) => v && v.id && v.tipe_komoditas_id === BAPOK)
    .map((v: any) => ({
      id: v.id,
      nama: v.nama || v.nama_variant || (v.komoditas && v.komoditas.nama) || '',
      unit: unitLabel(v.satuan && (v.satuan.display || v.satuan.nama)),
      order: v.order_public ?? v.order ?? 999,
    }))
    .filter((v: any) => v.nama)
}

export async function fetchDates(runKeyFallback: string): Promise<{ tanggal: string; pembanding: string }> {
  const j = await getJson(`${SP2KP_API}/report/api/latest-price-dates?tipe_komoditas_id=${BAPOK}`)
  return { tanggal: j?.data?.tanggal || runKeyFallback, pembanding: j?.data?.tanggal_pembanding || '' }
}

// Tanggal data bapok TERKINI menurut SP2KP ('' bila SP2KP tak terjangkau).
// harga-daerah memakainya untuk memutuskan apakah cache masih sesuai tanggal
// SP2KP atau harus ditarik ulang — kunci agar Radar tak pernah menampilkan
// snapshot dari tanggal yang sudah usang (mis. rilis harian SP2KP telat).
export async function fetchLatestTanggal(): Promise<string> {
  const j = await getJson(`${SP2KP_API}/report/api/latest-price-dates?tipe_komoditas_id=${BAPOK}`)
  return j?.data?.tanggal || ''
}

// Baris commodity_prices NASIONAL (province_id=0) — harga nasional tertimbang (HNT).
export async function buildNational(runKey: string) {
  const [variants, dates] = await Promise.all([fetchVariants(), fetchDates(runKey)])
  const start = dates.pembanding || dates.tanggal
  const series = await inChunks(variants, 10, async (v: any) => ({
    v, s: await getJson(`${SP2KP_API}/report/api/hnt/history-series?tanggal_start=${start}&tanggal_end=${dates.tanggal}&variant_id=${v.id}`, 15000),
  }))
  const rows: any[] = []
  for (const { v, s } of series) {
    const price = priceOnDate(s, dates.tanggal)
    if (price <= 0) continue
    const prev = dates.pembanding ? priceOnDate(s, dates.pembanding) : 0
    rows.push({
      run_date: runKey, commodity_key: commodityKeyOf(v.id), variant_name: v.nama, is_group: true,
      price, prev_price: prev > 0 && prev !== price ? prev : null, price_date: dates.tanggal,
      unit: v.unit, source_name: SP2KP_SOURCE_NAME, source_url: SP2KP_SITE, province_id: 0,
    })
  }
  return rows
}

// Baris commodity_prices PER PROVINSI — dicocokkan via NAMA (kode BPS berbeda dari id app).
// prev_price diambil dari province-comparison pada TANGGAL PEMBANDING (hari-data
// sebelumnya) — SAMA dengan tabel default SP2KP. TIDAK memakai field
// `harga_sebelumnya` respons karena itu berbasis BULAN LALU (mis. 26 Jun),
// sehingga %/arah akan meleset dari yang tampil di situs SP2KP.
export async function buildProvince(runKey: string, provinceId: number) {
  const [variants, dates] = await Promise.all([fetchVariants(), fetchDates(runKey)])
  const target = normProvName(PROVINCE_NAME[provinceId])
  const compUrl = (id: number, tgl: string) =>
    `${SP2KP_API}/report/api/average-price/province-comparison?variant_id=${id}&tanggal=${tgl}`
  const pick = (c: any) =>
    (c?.data?.items || []).find((x: any) => normProvName(x.nama_provinsi) === target)
  const comps = await inChunks(variants, 10, async (v: any) => {
    const [cNow, cPrev] = await Promise.all([
      getJson(compUrl(v.id, dates.tanggal), 15000),
      dates.pembanding ? getJson(compUrl(v.id, dates.pembanding), 15000) : Promise.resolve(null),
    ])
    return { v, cNow, cPrev }
  })
  const rows: any[] = []
  for (const { v, cNow, cPrev } of comps) {
    const itNow = pick(cNow)
    if (!itNow) continue
    const price = Math.round(Number(itNow.harga) || 0)
    if (price <= 0) continue
    const itPrev = pick(cPrev)
    const prev = itPrev ? Math.round(Number(itPrev.harga) || 0) : 0
    rows.push({
      run_date: runKey, commodity_key: commodityKeyOf(v.id), variant_name: v.nama, is_group: true,
      price, prev_price: prev > 0 && prev !== price ? prev : null, price_date: cNow?.data?.tanggal || dates.tanggal,
      unit: v.unit, source_name: SP2KP_SOURCE_NAME, source_url: SP2KP_SITE, province_id: provinceId,
    })
  }
  return rows
}
