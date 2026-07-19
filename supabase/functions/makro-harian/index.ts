// ============================================================
// Supabase Edge Function: makro-harian (v3)
// Pipeline makro BERSAMA untuk seluruh platform, berjalan 1x per "hari data":
//   1) HARGA RESMI bahan pokok dari PIHPS Bank Indonesia (endpoint publik
//      resmi tanpa kunci) -> tabel commodity_prices.
//   2) Kurs USD/IDR (open.er-api.com, backfill frankfurter/ECB)
//      -> tabel exchange_rates.
//   3) Judul berita Bing News RSS per komoditas -> 1 panggilan Gemini
//      -> tabel macro_signals. (Google News tidak dipakai: blokir IP
//      datacenter, terverifikasi 503.)
//
// BATAS HARI = 06.00 WIB: dijadwalkan pg_cron pukul 23.00 UTC (06.00 WIB).
// Sebelum jam 6 pagi, kunci hari jatuh ke kemarin sehingga data yang tampil
// selalu "hasil tarikan jam 6 pagi terbaru". Pemicu dari aplikasi (lazy)
// hanya cadangan bila cron terlewat.
//
// KEAMANAN: fungsi ini boleh dipicu TANPA login (untuk cron pg_net) karena:
//   - idempoten — kunci macro_runs memastikan kerja berat maksimal 1x/hari;
//   - tidak membaca/menulis data milik pengguna mana pun;
//   - hanya menulis data agregat publik via service role;
//   - respons hanya berisi jumlah baris.
// ============================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? ''
const MODEL = 'gemini-2.5-flash'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// Keranjang komoditas — WAJIB sinkron dengan ai-hpp-draft & src/lib/hpp.js.
// Kelompok pangan mengikuti daftar bahan pokok (Perpres 71/2015) + panel PIHPS;
// sisanya bahan strategis lintas sektor UMKM.
const COMMODITIES: { key: string; label: string; q: string; qEn?: string }[] = [
  { key: 'beras', label: 'Beras', q: 'harga beras' },
  { key: 'jagung', label: 'Jagung', q: 'harga jagung' },
  { key: 'kedelai', label: 'Kedelai', q: 'harga kedelai impor' },
  { key: 'gula', label: 'Gula Pasir', q: 'harga gula pasir' },
  { key: 'minyak_goreng', label: 'Minyak Goreng/CPO', q: 'harga minyak goreng OR CPO', qEn: 'crude palm oil price' },
  { key: 'terigu', label: 'Tepung Terigu/Gandum', q: 'harga terigu OR gandum', qEn: 'wheat price global' },
  { key: 'cabai_merah', label: 'Cabai Merah', q: 'harga cabai merah' },
  { key: 'cabai_rawit', label: 'Cabai Rawit', q: 'harga cabai rawit' },
  { key: 'bawang_merah', label: 'Bawang Merah', q: 'harga bawang merah' },
  { key: 'bawang_putih', label: 'Bawang Putih', q: 'harga bawang putih impor' },
  { key: 'daging_sapi', label: 'Daging Sapi', q: 'harga daging sapi' },
  { key: 'ayam', label: 'Daging Ayam', q: 'harga ayam potong OR daging ayam' },
  { key: 'telur', label: 'Telur Ayam', q: 'harga telur ayam' },
  { key: 'ikan', label: 'Ikan Segar', q: 'harga ikan bandeng OR kembung OR tongkol' },
  { key: 'garam', label: 'Garam', q: 'harga garam konsumsi' },
  { key: 'susu', label: 'Susu', q: 'harga susu' },
  { key: 'kakao', label: 'Kakao/Cokelat', q: 'harga kakao OR cokelat', qEn: 'cocoa price' },
  { key: 'kopi', label: 'Kopi', q: 'harga kopi robusta arabika' },
  { key: 'lpg', label: 'LPG/Gas', q: 'harga LPG OR gas elpiji' },
  { key: 'bbm', label: 'BBM', q: 'harga BBM pertalite solar' },
  { key: 'tekstil', label: 'Tekstil/Kain', q: 'harga kain OR tekstil industri' },
  { key: 'kertas', label: 'Kertas', q: 'harga kertas HVS OR kertas' },
  { key: 'deterjen', label: 'Deterjen/Kimia RT', q: 'harga deterjen' },
  { key: 'plastik', label: 'Plastik/Kemasan', q: 'harga plastik OR bijih plastik' },
  { key: 'kurs', label: 'Kurs USD/IDR', q: 'nilai tukar rupiah dolar', qEn: 'rupiah exchange rate' },
]

// Pemetaan kelompok PIHPS -> commodity_key kita.
const PIHPS_GROUP: Record<string, string> = {
  'Beras': 'beras',
  'Daging Ayam': 'ayam',
  'Daging Sapi': 'daging_sapi',
  'Telur Ayam': 'telur',
  'Bawang Merah': 'bawang_merah',
  'Bawang Putih': 'bawang_putih',
  'Cabai Merah': 'cabai_merah',
  'Cabai Rawit': 'cabai_rawit',
  'Minyak Goreng': 'minyak_goreng',
  'Gula Pasir': 'gula',
}
const PIHPS_UNIT: Record<string, string> = { minyak_goreng: 'Rp/liter' } // sisanya Rp/kg

const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://localhost:5174', APP_ORIGIN].filter(Boolean)
function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : (ALLOWED_ORIGINS[0] || '*')
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

const todayWIB = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
// Kunci "hari data": batas hari pukul 06.00 WIB (sebelum jam 6 = hari kemarin).
const runKeyWIB = () => new Date(Date.now() + (7 - 6) * 3600 * 1000).toISOString().slice(0, 10)

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
}

// ---------- SUMBER TEPERCAYA TERPUSAT (RAG) ----------
// Hanya berita dari domain di bawah yang boleh masuk pipeline & jadi referensi.
// Menambah/mengurangi sumber cukup di daftar ini (satu titik kendali).
const TRUSTED_DOMAINS = [
  // Resmi pemerintah / lembaga
  'bi.go.id', 'bps.go.id', 'badanpangan.go.id', 'kemendag.go.id', 'esdm.go.id',
  'kementan.go.id', 'setkab.go.id', 'antaranews.com',
  // Media ekonomi-bisnis arus utama Indonesia
  'kontan.co.id', 'bisnis.com', 'cnbcindonesia.com', 'katadata.co.id',
  'kompas.com', 'kompas.id', 'detik.com', 'tempo.co', 'cnnindonesia.com',
  'liputan6.com', 'republika.co.id', 'idxchannel.com', 'investor.id',
  'medcom.id', 'sindonews.com', 'tribunnews.com', 'merdeka.com', 'suara.com',
  'okezone.com', 'viva.co.id', 'inews.id', 'kumparan.com', 'tirto.id',
  // Global (untuk komoditas dunia: CPO, gandum, kakao, kurs)
  'reuters.com', 'bloomberg.com', 'investing.com', 'tradingeconomics.com',
  'nasdaq.com', 'barchart.com', 'agweb.com', 'spglobal.com', 'apnews.com',
]

function domainOf(link: string): string {
  try { return new URL(link).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' }
}
function isTrusted(domain: string): boolean {
  return TRUSTED_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))
}

// Bing News RSS memberi link redirect (bing.com/news/apiclick.aspx?...&url=<asli>).
// Kita simpan HANYA URL AKHIR artikel — bisa langsung dibuka & divalidasi pembaca.
function finalUrl(link: string): string {
  try {
    const u = new URL(link)
    if (u.hostname.endsWith('bing.com')) {
      const real = u.searchParams.get('url')
      if (real) return decodeURIComponent(real)
      return '' // link bing tanpa URL asli tidak dipakai
    }
    return link
  } catch { return '' }
}

type NewsItem = { title: string; link: string; domain: string; snippet: string; pubDate: string }

async function fetchRss(url: string, max = 4): Promise<NewsItem[]> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA } })
    clearTimeout(t)
    if (!res.ok) return []
    const xml = await res.text()
    const items: NewsItem[] = []
    const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || []
    for (const b of blocks) {
      if (items.length >= max) break
      const title = decodeEntities((b.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] || '').trim())
      const raw = decodeEntities((b.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '').trim())
      // Ringkasan artikel dari feed — dipakai untuk grounding ekstraksi harga.
      const snippet = decodeEntities((b.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1] || ''))
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
      const pubRaw = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '').trim()
      const pubMs = Date.parse(pubRaw)
      const pubDate = Number.isFinite(pubMs) ? new Date(pubMs).toISOString().slice(0, 10) : ''
      const link = finalUrl(raw)
      const domain = domainOf(link)
      // Saring: wajib judul + link akhir https dari sumber tepercaya.
      if (!title || !link.startsWith('http') || !isTrusted(domain)) continue
      items.push({ title: title.slice(0, 200), link: link.slice(0, 400), domain, snippet, pubDate })
    }
    return items
  } catch { return [] }
}

// ---------- HARGA VIA RAG BERITA (komoditas di luar cakupan PIHPS) ----------
// Angka HANYA sah bila tertulis eksplisit di judul/ringkasan berita sumber
// tepercaya; kode memverifikasi ulang keberadaan angka itu di teks (anti
// karang). Satuan, tanggal & link diambil dari item berita — bukan dari AI.
const RAG_PRICE: Record<string, { unit: string; min: number; max: number; target: string }> = {
  jagung: { unit: 'Rp/kg', min: 2000, max: 20000, target: 'harga jagung pipilan kering per kg' },
  kedelai: { unit: 'Rp/kg', min: 5000, max: 30000, target: 'harga kedelai per kg' },
  terigu: { unit: 'Rp/kg', min: 5000, max: 30000, target: 'harga tepung terigu per kg' },
  ikan: { unit: 'Rp/kg', min: 10000, max: 150000, target: 'harga ikan konsumsi (bandeng/kembung/tongkol) per kg' },
  garam: { unit: 'Rp/kg', min: 1000, max: 30000, target: 'harga garam konsumsi per kg' },
  susu: { unit: 'Rp/liter', min: 8000, max: 50000, target: 'harga susu cair/UHT per liter' },
  kakao: { unit: 'Rp/kg', min: 30000, max: 500000, target: 'harga biji kakao per kg' },
  kopi: { unit: 'Rp/kg', min: 20000, max: 500000, target: 'harga biji kopi per kg' },
  lpg: { unit: 'Rp/tabung 3 kg', min: 12000, max: 60000, target: 'harga LPG tabung 3 kg' },
  bbm: { unit: 'Rp/liter', min: 5000, max: 30000, target: 'harga BBM Pertalite per liter' },
  tekstil: { unit: 'Rp/meter', min: 3000, max: 300000, target: 'harga kain per meter' },
  kertas: { unit: 'Rp/rim', min: 20000, max: 150000, target: 'harga kertas A4 per rim' },
  deterjen: { unit: 'Rp/kg', min: 5000, max: 100000, target: 'harga deterjen bubuk per kg' },
  plastik: { unit: 'Rp/kg', min: 5000, max: 100000, target: 'harga plastik kemasan/resin per kg' },
}
const RAG_KEYS = Object.keys(RAG_PRICE)

// Kata kunci nama komoditas & petunjuk satuan — kandidat harga HANYA sah bila
// kalimatnya menyebut komoditasnya (deterministik, bukan tebakan AI).
const RAG_KEYWORDS: Record<string, string[]> = {
  jagung: ['jagung'],
  kedelai: ['kedelai'],
  terigu: ['terigu', 'tepung'],
  ikan: ['ikan', 'bandeng', 'kembung', 'tongkol'],
  garam: ['garam'],
  susu: ['susu'],
  kakao: ['kakao', 'cokelat', 'coklat'],
  kopi: ['kopi'],
  lpg: ['lpg', 'elpiji', 'bright gas'],
  bbm: ['pertalite'],
  tekstil: ['kain', 'tekstil'],
  kertas: ['kertas', 'hvs'],
  deterjen: ['deterjen', 'detergen'],
  plastik: ['plastik', 'resin'],
}
// Produk "tetangga" yang sering satu daftar harga — bila namanya muncul LEBIH
// DEKAT ke angka daripada kata kunci target, angka itu milik produk tsb, buang.
const RAG_NEGATIVES: Record<string, string[]> = {
  bbm: ['pertamax', 'solar', 'dex', 'revvo', 'shell', 'bp '],
  lpg: ['12 kg', '12kg', '5,5 kg', '5.5 kg', '50 kg', '5,5kg'],
  susu: ['kental', 'bubuk', 'formula', 'evaporasi', 'kedelai'],
  terigu: ['tepung beras', 'tapioka', 'maizena', 'ketan'],
  kakao: ['minuman', 'bubuk instan'],
}

const RAG_UNIT_HINTS: Record<string, string[]> = {
  jagung: ['/kg', 'per kg', 'per kilogram', 'perkilogram', 'sekilo'],
  kedelai: ['/kg', 'per kg', 'per kilogram', 'perkilogram', 'sekilo'],
  terigu: ['/kg', 'per kg', 'per kilogram', 'perkilogram', 'sekilo'],
  ikan: ['/kg', 'per kg', 'per kilogram', 'perkilogram', 'sekilo'],
  garam: ['/kg', 'per kg', 'per kilogram', 'perkilogram', 'sekilo'],
  susu: ['/liter', 'per liter', 'perliter'],
  kakao: ['/kg', 'per kg', 'per kilogram', 'perkilogram', 'sekilo'],
  kopi: ['/kg', 'per kg', 'per kilogram', 'perkilogram', 'sekilo'],
  lpg: ['3 kg', '3kg', 'per tabung', '/tabung'],
  bbm: ['/liter', 'per liter', 'perliter', 'pertalite'],
  tekstil: ['/meter', 'per meter', 'permeter'],
  kertas: ['/rim', 'per rim', 'perrim'],
  deterjen: ['/kg', 'per kg', 'sachet', 'kemasan'],
  plastik: ['/kg', 'per kg', 'per kilogram'],
}

// Ambil petikan ISI ARTIKEL di sekitar tulisan "Rp..." (maks 3 petikan) —
// tetap dari halaman sumber tepercaya, untuk komoditas yang ringkasan RSS-nya
// tidak memuat angka. Petikan inilah yang jadi dasar ekstraksi & verifikasi.
async function fetchArticleExcerpts(link: string): Promise<string[]> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(link, { signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept': 'text/html' } })
    clearTimeout(t)
    if (!res.ok) return []
    const html = await res.text()
    const text = decodeEntities(
      html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
    ).replace(/\s+/g, ' ')
    const out: string[] = []
    let idx = 0
    while (out.length < 4) {
      const p = text.indexOf('Rp', idx)
      if (p < 0) break
      out.push(text.slice(Math.max(0, p - 120), p + 180).trim())
      idx = p + 180
    }
    return out
  } catch { return [] }
}

// Gali SEMUA sebutan "Rp <angka>" dari teks secara deterministik (regex, bukan
// AI) beserta kalimat sekitarnya. AI nanti hanya MEMILIH kandidat yang cocok,
// tidak pernah menghasilkan angka sendiri.
function parseRupiahMentions(text: string): { harga: number; kalimat: string; pre: string }[] {
  const out: { harga: number; kalimat: string; pre: string }[] = []
  const re = /Rp\s?\.?\s?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(ribu|rb|juta|jt)?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) && out.length < 8) {
    const numStr = m[1].trim()
    const suf = (m[2] || '').toLowerCase()
    let val = 0
    if (suf === 'juta' || suf === 'jt') val = Math.round(parseFloat(numStr.replace(/\./g, '').replace(',', '.')) * 1e6)
    else if (suf === 'ribu' || suf === 'rb') val = Math.round(parseFloat(numStr.replace(',', '.')) * 1000)
    else val = Math.round(Number(numStr.replace(/[.,]/g, '')))
    if (!Number.isFinite(val) || val <= 0) continue
    out.push({
      harga: val,
      kalimat: text.slice(Math.max(0, m.index - 90), m.index + 90).trim(),
      // 55 huruf tepat SEBELUM "Rp" — untuk mencocokkan pola daftar harga
      // "NamaProduk: Rp X" agar angka tidak tertukar produk sebelahnya.
      pre: text.slice(Math.max(0, m.index - 55), m.index).toLowerCase(),
    })
  }
  return out
}

// Verifikasi deterministik: angka harga benar-benar tertulis di teks berita
// dalam salah satu format lazim Indonesia (18.500 / 18500 / 18 ribu / 1,2 juta).
function numberAppearsIn(text: string, price: number): boolean {
  const s = ' ' + String(text).toLowerCase().replace(/ /g, ' ') + ' '
  const cands = new Set<string>()
  cands.add(String(price))
  cands.add(price.toLocaleString('id-ID'))            // 18.500
  cands.add(price.toLocaleString('en-US'))            // 18,500
  if (price % 1000 === 0) {
    const rb = price / 1000
    for (const r of [`${rb} ribu`, `${rb}ribu`, `${rb} rb`, `${rb}rb`, `${rb}.000`, `${rb},000`]) cands.add(r)
    if (rb >= 1000 && rb % 100 === 0) {
      const jt = price / 1_000_000
      const jtStr = String(jt).replace('.', ',')
      for (const j of [`${jt} juta`, `${jtStr} juta`, `${jt}jt`, `${jtStr}jt`]) cands.add(j)
    }
  }
  // Angka dengan pecahan ribuan gaya "18,5 ribu"
  if (price % 100 === 0 && price >= 1000) {
    const rbF = price / 1000
    if (!Number.isInteger(rbF)) {
      const rbStr = String(rbF).replace('.', ',')
      cands.add(`${rbStr} ribu`); cands.add(`${rbStr}rb`)
    }
  }
  for (const c of cands) if (s.includes(c.toLowerCase())) return true
  return false
}

// ---------- HARGA RESMI: PIHPS Bank Indonesia ----------
// Endpoint publik resmi (JSON, tanpa kunci) — URL yang sama disimpan sebagai
// referensi yang bisa dibuka pengguna.
async function fetchPihps(runKey: string) {
  const start = new Date(new Date(runKey + 'T00:00:00Z').getTime() - 6 * 86400000).toISOString().slice(0, 10)
  const url = 'https://www.bi.go.id/hargapangan/WebSite/TabelHarga/GetGridDataDaerah'
    + `?price_type_id=1&comcat_id=&province_id=&regency_id=&market_id=&tipe_laporan=1&start_date=${start}&end_date=${runKey}`
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15000)
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept': 'application/json' } })
    clearTimeout(t)
    if (!res.ok) return { url, rows: [] as any[] }
    const j = await res.json()
    const out: any[] = []
    let groupKey = ''
    for (const row of j?.data || []) {
      const name = String(row.name || '').trim()
      const isGroup = row.level === 1
      if (isGroup) groupKey = PIHPS_GROUP[name] || ''
      if (!groupKey || !name) continue
      // Ambil kolom tanggal dd/mm/yyyy, urutkan, pilih nilai terisi terbaru + sebelumnya.
      const dates = Object.keys(row)
        .filter((k) => /^\d{2}\/\d{2}\/\d{4}$/.test(k))
        .map((k) => ({ k, d: k.slice(6) + '-' + k.slice(3, 5) + '-' + k.slice(0, 2) }))
        .sort((a, b) => (a.d < b.d ? -1 : 1))
      let price = 0, prev = 0, priceDate = ''
      for (const { k, d } of dates) {
        const v = Number(String(row[k] ?? '').replace(/[^\d]/g, ''))
        if (v > 0) { prev = price || v; price = v; priceDate = d }
      }
      if (price <= 0) continue
      out.push({
        commodity_key: groupKey,
        variant_name: name,
        is_group: isGroup,
        price,
        prev_price: prev && prev !== price ? prev : null,
        price_date: priceDate || null,
        unit: PIHPS_UNIT[groupKey] || 'Rp/kg',
        source_name: 'PIHPS Bank Indonesia',
        source_url: url,
      })
    }
    return { url, rows: out }
  } catch { return { url, rows: [] as any[] } }
}

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsHeaders(origin)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
    const runKey = runKeyWIB()
    // Mode diagnosa internal (body {"debug":true}) — cron memakai body kosong,
    // UI tidak pernah mengirimnya; hasilnya tidak tampil ke pengguna.
    let debug = false
    try { const b = await req.json(); debug = b?.debug === true } catch { /* body kosong */ }
    const diag: any = { excerpts: {}, extract: null, rejects: [] }

    // ---------- 0) KURS USD/IDR — DIPERBARUI SETIAP PEMANGGILAN ----------
    // Median dari beberapa sumber pasar terbuka agar tidak bergantung pada
    // satu snapshot; tanggal data tampil di UI. (Selisih kecil antar situs
    // kurs adalah normal — beda jam pengambilan & jenis kurs.)
    let kursNote = ''
    try {
      const vals: number[] = []
      const srcs: string[] = []
      await Promise.all([
        (async () => {
          try {
            const j = await (await fetch('https://open.er-api.com/v6/latest/USD')).json()
            const v = Number(j?.rates?.IDR); if (v > 0) { vals.push(v); srcs.push('er-api') }
          } catch { /* satu sumber gagal tak apa */ }
        })(),
        (async () => {
          try {
            const j = await (await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json')).json()
            const v = Number(j?.usd?.idr); if (v > 0) { vals.push(v); srcs.push('currency-api') }
          } catch { /* lanjut */ }
        })(),
        (async () => {
          try {
            const j = await (await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=IDR')).json()
            const v = Number(j?.rates?.IDR); if (v > 0) { vals.push(v); srcs.push('ECB') }
          } catch { /* lanjut */ }
        })(),
      ])
      if (vals.length) {
        vals.sort((a, b) => a - b)
        const mid = vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2
        await svc.from('exchange_rates').upsert({
          rate_date: todayWIB(), usd_idr: Math.round(mid * 100) / 100, source: `median(${srcs.join(',')})`,
        })
        kursNote = `USD/IDR: ${Math.round(mid)}`
      }
    } catch { /* kurs gagal tidak menghentikan pipeline */ }

    // ---------- LOCK: hanya satu proses per hari-data ----------
    const { error: lockErr } = await svc.from('macro_runs').insert({ run_date: runKey, status: 'running' })
    if (lockErr) {
      const { data: run } = await svc.from('macro_runs').select('*').eq('run_date', runKey).maybeSingle()
      if (run?.status === 'done') return json({ ok: true, already: true })
      const stale = run?.started_at && (Date.now() - new Date(run.started_at).getTime() > 10 * 60 * 1000)
      if (!stale) return json({ ok: true, running: true })
      await svc.from('macro_runs').update({ status: 'running', started_at: new Date().toISOString() }).eq('run_date', runKey)
    }

    // ---------- 1) HARGA RESMI (PIHPS BI) ----------
    const pihps = await fetchPihps(runKey)
    if (pihps.rows.length) {
      await svc.from('commodity_prices').upsert(
        pihps.rows.map((r) => ({ ...r, run_date: runKey })),
        { onConflict: 'run_date,variant_name,province_id' },
      )
    }

    // ---------- 2) BACKFILL HISTORI KURS (sekali saja saat data < 30 hari) ----------
    try {
      const { count } = await svc.from('exchange_rates').select('rate_date', { count: 'exact', head: true })
      if ((count || 0) < 30) {
        const end = todayWIB()
        const start = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
        const r = await fetch(`https://api.frankfurter.dev/v1/${start}..${end}?base=USD&symbols=IDR`)
        if (r.ok) {
          const j = await r.json()
          const rows = Object.entries(j?.rates || {}).map(([d, v]: any) => ({
            rate_date: d, usd_idr: Number(v?.IDR) || 0, source: 'frankfurter(ECB)',
          })).filter((x) => x.usd_idr > 0)
          if (rows.length) await svc.from('exchange_rates').upsert(rows)
        }
      }
    } catch { /* backfill opsional */ }

    // ---------- 2b) INFLASI RESMI (BPS, via halaman statistik Bank Indonesia) ----------
    // Tabel di halaman ini adalah data inflasi IHK resmi BPS; baris teratas =
    // bulan terbaru. Disimpan beserta label bulan datanya.
    try {
      const r = await fetch('https://www.bi.go.id/id/statistik/indikator/data-inflasi.aspx', {
        headers: { 'User-Agent': UA },
      })
      if (r.ok) {
        const html = (await r.text()).replace(/\s+/g, ' ')
        const m = html.match(/(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s*(20\d\d)\s*<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*%/)
        if (m) {
          const MONTH_NO: Record<string, string> = {
            Januari: '01', Februari: '02', Maret: '03', April: '04', Mei: '05', Juni: '06',
            Juli: '07', Agustus: '08', September: '09', Oktober: '10', November: '11', Desember: '12',
          }
          const yoy = Number(m[3].replace(',', '.'))
          if (Number.isFinite(yoy) && yoy > -5 && yoy < 50) {
            await svc.from('macro_config').upsert({
              month: `${m[2]}-${MONTH_NO[m[1]]}`,
              inflation_yoy: yoy,
              note: `Inflasi umum (YoY) data ${m[1]} ${m[2]} — sumber resmi BPS (via bi.go.id), diperbarui otomatis.`,
            }, { onConflict: 'month' })
          }
        }
      }
    } catch { /* inflasi opsional */ }

    // ---------- 3) BERITA (Bing News RSS -> link akhir, sumber tepercaya saja) ----------
    const feeds = await Promise.all(COMMODITIES.map(async (c) => {
      const urlId = `https://www.bing.com/news/search?q=${encodeURIComponent(c.q)}&format=RSS&setmkt=id-ID&qft=interval%3d%227%22`
      let items = await fetchRss(urlId, 5)
      if (c.qEn) {
        const urlEn = `https://www.bing.com/news/search?q=${encodeURIComponent(c.qEn)}&format=RSS&setmkt=en-US&qft=interval%3d%227%22`
        items = items.concat(await fetchRss(urlEn, 3))
      }
      const seen = new Set<string>()
      items = items.filter((it) => {
        const k = it.title.toLowerCase(); const l = it.link.toLowerCase()
        if (seen.has(k) || seen.has(l)) return false
        seen.add(k); seen.add(l); return true
      })
      return { key: c.key, label: c.label, headlines: items.slice(0, 5) }
    }))

    // ---------- 3b) HARGA RAG untuk komoditas di luar PIHPS ----------
    // Harga terakhir yang pernah tersimpan (utk prev_price & carry-forward).
    const prevByKey: Record<string, any> = {}
    try {
      const since = new Date(Date.parse(runKey) - 60 * 86400000).toISOString().slice(0, 10)
      const { data: prevRows } = await svc.from('commodity_prices').select('*')
        .in('commodity_key', RAG_KEYS).eq('province_id', 0)
        .gte('run_date', since).lt('run_date', runKey)
        .order('run_date', { ascending: false }).limit(200)
      for (const r of prevRows || []) if (!prevByKey[r.commodity_key]) prevByKey[r.commodity_key] = r
    } catch { /* tanpa histori tetap jalan */ }

    let ragSaved = 0
    if (GEMINI_API_KEY) {
      // Buka isi artikel (maks 3 per komoditas) dari sumber tepercaya agar
      // angka harga yang tidak muncul di ringkasan RSS tetap bisa ditemukan.
      const excerptsByKey: Record<string, string[][]> = {}
      await Promise.all(feeds
        .filter((f) => RAG_KEYS.includes(f.key) && f.headlines.length)
        .map(async (f) => {
          // Buka maks 3 artikel teratas per komoditas secara paralel.
          const tops = f.headlines.slice(0, 3)
          const got = await Promise.all(tops.map((h) => fetchArticleExcerpts(h.link)))
          const per: string[][] = f.headlines.map((_, i) => got[i] || [])
          excerptsByKey[f.key] = per
          diag.excerpts[f.key] = per.flat().length
        }))

      // PEMILIHAN DETERMINISTIK: angka digali regex dari teks sumber, lalu
      // disaring aturan mekanis — kalimatnya WAJIB menyebut nama komoditas;
      // diprioritaskan yang menyebut satuan target. Tanpa tebakan AI.
      type Pick = { key: string; i: number; harga: number; kalimat: string; hasUnit: boolean; strong: boolean; score: number }
      const picked: Pick[] = []
      for (const f of feeds) {
        if (!RAG_KEYS.includes(f.key) || !f.headlines.length) continue
        const cfg = RAG_PRICE[f.key]
        const kws = RAG_KEYWORDS[f.key] || []
        const hints = RAG_UNIT_HINTS[f.key] || []
        const negs = RAG_NEGATIVES[f.key] || []
        let best: Pick | null = null
        f.headlines.forEach((h, i) => {
          const texts = [`${h.title}. ${h.snippet}`, ...(excerptsByKey[f.key]?.[i] || [])]
          for (const t of texts) {
            for (const m of parseRupiahMentions(t)) {
              if (m.harga < cfg.min || m.harga > cfg.max) continue
              const kal = m.kalimat.toLowerCase()
              if (!kws.some((k) => kal.includes(k))) continue // wajib sebut komoditasnya
              // "Nama terdekat menang": bila produk tetangga (Solar, 12 kg, dll)
              // disebut LEBIH DEKAT ke angka daripada kata kunci target,
              // angka itu milik produk tetangga — buang kandidatnya.
              const preKw = Math.max(...kws.map((k) => m.pre.lastIndexOf(k)), -1)
              const preNeg = Math.max(...negs.map((n) => m.pre.lastIndexOf(n)), -1)
              if (preNeg > preKw) continue
              // strong = nama komoditas tepat SEBELUM angka ("Garam ... Rp X")
              // — kunci anti-tertukar pada artikel daftar banyak harga.
              const strong = preKw >= 0
              const hasUnit = hints.some((u) => kal.includes(u))
              const score = (strong ? 2 : 0) + (hasUnit ? 1 : 0)
              const cand: Pick = { key: f.key, i, harga: m.harga, kalimat: m.kalimat, hasUnit, strong, score }
              if (!best || cand.score > best.score) best = cand
            }
          }
        })
        if (best) picked.push(best)
        diag.excerpts[f.key + '_pick'] = best ? `${(best as Pick).harga} (skor ${(best as Pick).score})` : null
      }

      // AI hanya KONFIRMASI ya/tidak per kandidat terpilih — tugas biner paling
      // andal; angka & sumber tidak pernah berasal dari AI.
      let confirmed: Record<string, boolean> = {}
      let confirmOk = false
      if (picked.length) {
        const CONFIRM_PROMPT = `Periksa tiap butir: apakah KALIMAT tersebut benar-benar menyatakan harga jual/eceran "target" itu (satuan cocok, bukan subsidi/anggaran/produk lain/harga masa lalu)? Harga tingkat daerah/pasar tetap sah.

DATA:
${JSON.stringify(picked.map((p) => ({ key: p.key, target: RAG_PRICE[p.key].target, harga: p.harga, kalimat: p.kalimat })))}

Balas HANYA JSON array: [ { "key": string, "sah": true | false } ]`
        try {
          const exRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
            {
              method: 'POST',
              headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: CONFIRM_PROMPT }] }],
                generationConfig: {
                  temperature: 0, responseMimeType: 'application/json',
                  maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 512 },
                },
              }),
            },
          )
          if (exRes.ok) {
            const exData = await exRes.json()
            const exText = exData?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '[]'
            try {
              const arr = JSON.parse(exText.match(/\[[\s\S]*\]/)?.[0] ?? '[]')
              for (const a of arr) if (a && typeof a.key === 'string') confirmed[a.key] = a.sah === true
              confirmOk = arr.length > 0
            } catch { diag.extract = `parse gagal: ${exText.slice(0, 200)}` }
          } else {
            diag.extract = `HTTP ${exRes.status}: ${(await exRes.text()).slice(0, 200)}`
          }
        } catch (e) { diag.extract = `exception: ${String(e).slice(0, 200)}` }
        if (debug) diag.extracted = { picked: picked.map((p) => ({ key: p.key, harga: p.harga, hasUnit: p.hasUnit })), confirmed }
      }

      const ragRows: any[] = []
      for (const p of picked) {
        // Bila AI konfirmasi berjalan: pakai yang disetujui. Bila AI gagal
        // dihubungi: pakai hanya kandidat "strong" bersatuan cocok (aturan
        // mekanis paling ketat) — tetap tanpa asumsi.
        const lolos = confirmOk ? confirmed[p.key] === true : (p.strong && p.hasUnit)
        if (!lolos) { diag.rejects.push(`${p.key}: ${p.harga} tidak lolos konfirmasi`); continue }
        const feed = feeds.find((f) => f.key === p.key)
        const ev = feed?.headlines?.[p.i]
        if (!ev) continue
        const cfg = RAG_PRICE[p.key]
        const prev = prevByKey[p.key]
        ragRows.push({
          run_date: runKey,
          commodity_key: p.key,
          variant_name: COMMODITIES.find((c) => c.key === p.key)?.label || p.key,
          is_group: true,
          price: p.harga,
          prev_price: prev && Number(prev.price) !== p.harga ? Number(prev.price) : null,
          price_date: ev.pubDate || runKey,
          unit: cfg.unit,
          source_name: ev.domain,
          source_url: ev.link,
        })
      }
      if (ragRows.length) {
        await svc.from('commodity_prices').upsert(ragRows, { onConflict: 'run_date,variant_name,province_id' })
        ragSaved = ragRows.length
      }
    }

    // Carry-forward: komoditas RAG tanpa harga baru hari ini tetap tampil
    // dengan harga TERSUMBER terakhir (tanggal & link sumber aslinya dibawa).
    try {
      const { data: todayRows } = await svc.from('commodity_prices')
        .select('commodity_key').eq('run_date', runKey).eq('province_id', 0).in('commodity_key', RAG_KEYS)
      const have = new Set((todayRows || []).map((r: any) => r.commodity_key))
      const carries = RAG_KEYS
        .filter((k) => !have.has(k) && prevByKey[k])
        .map((k) => {
          const { id: _id, created_at: _ca, ...rest } = prevByKey[k]
          return { ...rest, run_date: runKey }
        })
      if (carries.length) await svc.from('commodity_prices').upsert(carries, { onConflict: 'run_date,variant_name,province_id' })
    } catch { /* opsional */ }

    // ---------- 4) SATU panggilan Gemini untuk semua komoditas ----------
    let signals: any[] = []
    if (GEMINI_API_KEY) {
      const input = feeds.map((f) => ({
        key: f.key, label: f.label,
        berita: f.headlines.map((h) => ({ judul: h.title, ringkasan: h.snippet.slice(0, 200), sumber: h.domain })),
      }))
      const PROMPT = `Kamu analis harga komoditas untuk UMKM Indonesia.
Berdasarkan JUDUL BERITA 7 hari terakhir di bawah (hanya dari media tepercaya yang sudah disaring), nilai arah harga tiap komoditas di pasar Indonesia untuk 30 hari ke depan.

DATA JUDUL BERITA PER KOMODITAS (satu-satunya sumber informasimu):
${JSON.stringify(input)}

Balas HANYA JSON array, satu objek per komoditas (SEMUA key dari DATA harus ada, tanpa key tambahan):
[
  {
    "key": string,
    "direction": "naik" | "turun" | "stabil",
    "est_pct_min": number,
    "est_pct_max": number,
    "confidence": "rendah" | "sedang" | "tinggi",
    "drivers": [string]
  }
]

ATURAN KERAS (pelanggaran = jawaban tidak dipakai):
- Simpulkan HANYA dari judul & ringkasan berita di DATA. DILARANG memakai pengetahuan lain, mengarang kejadian, atau menyebut hal yang tidak tertulis di DATA.
- Setiap butir "drivers" WAJIB merujuk isi judul/ringkasan yang ada di DATA (parafrase singkat, tanpa menambah fakta) dan akhiri dengan nama sumbernya dalam kurung, contoh: "Stok beras Bulog menipis jelang paceklik (kontan.co.id)". Maksimal 3 butir. Tanpa dasar di DATA = jangan tulis.
- Bila berita untuk suatu komoditas kosong/sedikit/tidak jelas arah: direction "stabil", confidence "rendah", est 0 sampai 0, drivers [].
- confidence "tinggi" HANYA bila minimal 2 judul dari sumber berbeda searah.
- Estimasi KONSERVATIF, kelipatan 0.5, rentang wajar (umumnya -10 sampai +10; ekstrem hanya bila berita sangat kuat).
- Untuk key "kurs": arah "naik" artinya rupiah MELEMAH (USD/IDR naik).`
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
          {
            method: 'POST',
            headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: PROMPT }] }],
              generationConfig: {
                temperature: 0.2,
                responseMimeType: 'application/json',
                maxOutputTokens: 16384,
                // Matikan mode "thinking" 2.5 Flash: token berpikir ikut memakan
                // maxOutputTokens sehingga JSON bisa terpotong tanpa error.
                thinkingConfig: { thinkingBudget: 0 },
              },
            }),
          },
        )
        if (geminiRes.ok) {
          const data = await geminiRes.json()
          const finish = data?.candidates?.[0]?.finishReason
          const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '[]'
          try { signals = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]') } catch {
            signals = []
            console.error(`gemini parse gagal (finish=${finish}): ${String(text).slice(0, 200)}`)
          }
          if (!signals.length) console.error(`gemini 0 sinyal (finish=${finish}, len=${String(text).length})`)
        } else {
          console.error(`gemini HTTP ${geminiRes.status}: ${(await geminiRes.text()).slice(0, 300)}`)
        }
      } catch (e) { signals = []; console.error(`gemini exception: ${String(e).slice(0, 200)}`) }
    }

    const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
    const half = (n: number) => Math.round(n * 2) / 2
    const byKey: Record<string, any> = {}
    for (const s of signals) if (s && typeof s.key === 'string') byKey[s.key] = s

    const rows = COMMODITIES.map((c) => {
      const f = feeds.find((x) => x.key === c.key)
      const s = byKey[c.key] || {}
      let min = half(clamp(Number(s.est_pct_min) || 0, -30, 30))
      let max = half(clamp(Number(s.est_pct_max) || 0, -30, 30))
      if (min > max) { const t = min; min = max; max = t }
      const direction = ['naik', 'turun', 'stabil'].includes(s.direction) ? s.direction : 'stabil'
      return {
        run_date: runKey,
        commodity_key: c.key,
        commodity_label: c.label,
        direction,
        est_pct_min: min,
        est_pct_max: max,
        confidence: ['rendah', 'sedang', 'tinggi'].includes(s.confidence) ? s.confidence : 'rendah',
        drivers: Array.isArray(s.drivers) ? s.drivers.slice(0, 3).map((d: any) => String(d).slice(0, 140)) : [],
        sources: (f?.headlines || []).map((h) => ({ title: h.title, link: h.link, domain: h.domain })),
      }
    })
    await svc.from('macro_signals').upsert(rows, { onConflict: 'run_date,commodity_key' })

    await svc.from('macro_runs').update({
      status: 'done', finished_at: new Date().toISOString(),
      detail: `${rows.length} sinyal; ${pihps.rows.length} harga PIHPS; ${ragSaved} harga RAG; ${kursNote || 'kurs gagal'}`,
    }).eq('run_date', runKey)

    return json({ ok: true, signals: rows.length, prices: pihps.rows.length, rag: ragSaved, ...(debug ? { diag } : {}) })
  } catch (e) {
    return json({ error: 'Terjadi kesalahan pipeline makro.', detail: String(e).slice(0, 300) }, 500)
  }
})
