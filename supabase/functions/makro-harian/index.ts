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
  { key: 'jagung', label: 'Jagung', q: 'harga jagung pipilan' },
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
  { key: 'kertas', label: 'Kertas', q: 'harga kertas industri' },
  { key: 'deterjen', label: 'Deterjen/Kimia RT', q: 'harga deterjen bahan kimia rumah tangga' },
  { key: 'plastik', label: 'Plastik/Kemasan', q: 'harga plastik kemasan resin' },
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

async function fetchRss(url: string, max = 4): Promise<{ title: string; link: string; domain: string }[]> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA } })
    clearTimeout(t)
    if (!res.ok) return []
    const xml = await res.text()
    const items: { title: string; link: string; domain: string }[] = []
    const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || []
    for (const b of blocks) {
      if (items.length >= max) break
      const title = decodeEntities((b.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] || '').trim())
      const raw = decodeEntities((b.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '').trim())
      const link = finalUrl(raw)
      const domain = domainOf(link)
      // Saring: wajib judul + link akhir https dari sumber tepercaya.
      if (!title || !link.startsWith('http') || !isTrusted(domain)) continue
      items.push({ title: title.slice(0, 200), link: link.slice(0, 400), domain })
    }
    return items
  } catch { return [] }
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
        { onConflict: 'run_date,variant_name' },
      )
    }

    // ---------- 2) KURS USD/IDR ----------
    let kursNote = ''
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/USD')
      const j = await r.json()
      const idr = Number(j?.rates?.IDR)
      if (idr > 0) {
        await svc.from('exchange_rates').upsert({ rate_date: todayWIB(), usd_idr: idr, source: 'open.er-api.com' })
        kursNote = `USD/IDR: ${Math.round(idr)}`
      }
    } catch { /* lanjut */ }
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

    // ---------- 4) SATU panggilan Gemini untuk semua komoditas ----------
    let signals: any[] = []
    if (GEMINI_API_KEY) {
      const input = feeds.map((f) => ({
        key: f.key, label: f.label,
        berita: f.headlines.map((h) => ({ judul: h.title, sumber: h.domain })),
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
- Simpulkan HANYA dari judul berita di DATA. DILARANG memakai pengetahuan lain, mengarang kejadian, atau menyebut peristiwa yang tidak ada di judul.
- Setiap butir "drivers" WAJIB merujuk isi judul yang ada di DATA (parafrase singkat) dan akhiri dengan nama sumbernya dalam kurung, contoh: "Stok beras Bulog menipis jelang paceklik (kontan.co.id)". Maksimal 3 butir. Tanpa dasar judul = jangan tulis.
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
      detail: `${rows.length} sinyal; ${pihps.rows.length} harga PIHPS; ${kursNote || 'kurs gagal'}`,
    }).eq('run_date', runKey)

    return json({ ok: true, signals: rows.length, prices: pihps.rows.length })
  } catch (e) {
    return json({ error: 'Terjadi kesalahan pipeline makro.', detail: String(e).slice(0, 300) }, 500)
  }
})
