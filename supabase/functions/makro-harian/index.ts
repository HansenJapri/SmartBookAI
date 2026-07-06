// ============================================================
// Supabase Edge Function: makro-harian
// Pipeline makroekonomi BERSAMA untuk seluruh platform (bukan per user):
//   1) Tarik kurs USD/IDR dari API gratis -> tabel exchange_rates.
//   2) Tarik judul berita Google News RSS per komoditas (gratis, hanya
//      judul+link dari feed, tanpa scraping artikel).
//   3) SATU panggilan Gemini 2.5 Flash menilai arah & estimasi kenaikan 30 hari
//      per komoditas -> tabel macro_signals.
// Dipicu "lazy": pengguna pertama yang membuka Radar Harga hari itu memicu
// fungsi ini; hasil di-cache untuk SEMUA pengguna (kunci efisiensi biaya UMKM).
// Kunci ganda (lock) lewat tabel macro_runs agar tidak jalan dobel.
//
// Deploy: nama function "makro-harian".
// ============================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? ''
const MODEL = 'gemini-2.5-flash'

// Keranjang komoditas platform — WAJIB sinkron dengan ai-hpp-draft & src/lib/hpp.js
const COMMODITIES: { key: string; label: string; q: string; qEn?: string }[] = [
  { key: 'beras', label: 'Beras', q: 'harga beras' },
  { key: 'terigu', label: 'Terigu/Gandum', q: 'harga terigu OR gandum', qEn: 'wheat price global' },
  { key: 'gula', label: 'Gula', q: 'harga gula pasir' },
  { key: 'telur', label: 'Telur Ayam', q: 'harga telur ayam' },
  { key: 'ayam', label: 'Daging Ayam', q: 'harga ayam potong OR daging ayam' },
  { key: 'daging_sapi', label: 'Daging Sapi', q: 'harga daging sapi' },
  { key: 'cabai', label: 'Cabai', q: 'harga cabai' },
  { key: 'bawang_merah', label: 'Bawang Merah', q: 'harga bawang merah' },
  { key: 'bawang_putih', label: 'Bawang Putih', q: 'harga bawang putih impor' },
  { key: 'minyak_goreng', label: 'Minyak Goreng/CPO', q: 'harga minyak goreng OR CPO', qEn: 'crude palm oil price' },
  { key: 'kedelai', label: 'Kedelai', q: 'harga kedelai impor' },
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

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
}

// Ambil judul+link dari feed RSS (regex sederhana — cukup untuk Google News).
async function fetchRss(url: string, max = 4): Promise<{ title: string; link: string }[]> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (BukuPintarAI)' } })
    clearTimeout(t)
    if (!res.ok) return []
    const xml = await res.text()
    const items: { title: string; link: string }[] = []
    const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || []
    for (const b of blocks.slice(0, max)) {
      const title = decodeEntities((b.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] || '').trim())
      const link = (b.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '').trim()
      if (title) items.push({ title: title.slice(0, 200), link: link.slice(0, 400) })
    }
    return items
  } catch { return [] }
}

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsHeaders(origin)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    // Wajib login — semua pengguna boleh MEMICU, tapi kerja & hasil dibagi bersama.
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Harus masuk (login).' }, 401)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
    })
    const { data: userData } = await userClient.auth.getUser()
    if (!userData?.user) return json({ error: 'Sesi tidak valid.' }, 401)

    // Klien service-role: menulis tabel makro bersama (RLS dilewati, aman karena
    // fungsi ini tidak menerima data bebas dari klien untuk ditulis).
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
    const today = todayWIB()

    // ---------- LOCK: hanya satu proses per hari ----------
    const { error: lockErr } = await svc.from('macro_runs').insert({ run_date: today, status: 'running' })
    if (lockErr) {
      // Sudah ada baris hari ini: selesai, sedang jalan, atau macet (>10 menit).
      const { data: run } = await svc.from('macro_runs').select('*').eq('run_date', today).maybeSingle()
      if (run?.status === 'done') return json({ ok: true, already: true })
      const stale = run?.started_at && (Date.now() - new Date(run.started_at).getTime() > 10 * 60 * 1000)
      if (!stale) return json({ ok: true, running: true })
      await svc.from('macro_runs').update({ status: 'running', started_at: new Date().toISOString() }).eq('run_date', today)
    }

    // ---------- 1) KURS USD/IDR ----------
    let kursNote = ''
    try {
      const r = await fetch('https://open.er-api.com/v6/latest/USD')
      const j = await r.json()
      const idr = Number(j?.rates?.IDR)
      if (idr > 0) {
        await svc.from('exchange_rates').upsert({ rate_date: today, usd_idr: idr, source: 'open.er-api.com' })
        kursNote = `USD/IDR hari ini: ${Math.round(idr)}`
      }
    } catch { /* kurs gagal — lanjut */ }
    // Isi mundur (backfill) riwayat kurs sekali di awal, agar grafik tren langsung hidup.
    try {
      const { count } = await svc.from('exchange_rates').select('rate_date', { count: 'exact', head: true })
      if ((count || 0) < 30) {
        const end = today
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

    // ---------- 2) BERITA (Google News RSS — gratis) ----------
    const feeds = await Promise.all(COMMODITIES.map(async (c) => {
      const urlId = `https://news.google.com/rss/search?q=${encodeURIComponent(c.q + ' when:7d')}&hl=id&gl=ID&ceid=ID:id`
      let items = await fetchRss(urlId, 4)
      if (c.qEn) {
        const urlEn = `https://news.google.com/rss/search?q=${encodeURIComponent(c.qEn + ' when:7d')}&hl=en-US&gl=US&ceid=US:en`
        items = items.concat(await fetchRss(urlEn, 2))
      }
      // Dedup judul.
      const seen = new Set<string>()
      items = items.filter((it) => { const k = it.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
      return { key: c.key, label: c.label, headlines: items.slice(0, 5) }
    }))

    // ---------- 3) SATU panggilan Gemini untuk semua komoditas ----------
    let signals: any[] = []
    if (GEMINI_API_KEY) {
      const input = feeds.map((f) => ({ key: f.key, label: f.label, judul_berita: f.headlines.map((h) => h.title) }))
      const PROMPT = `Kamu analis harga komoditas untuk UMKM Indonesia.
Berdasarkan JUDUL BERITA 7 hari terakhir di bawah, nilai arah harga tiap komoditas di pasar Indonesia untuk 30 hari ke depan.

DATA JUDUL BERITA PER KOMODITAS:
${JSON.stringify(input)}

Balas HANYA JSON array, satu objek per komoditas (SEMUA key harus ada):
[
  {
    "key": string,                    // sama persis dengan key input
    "direction": "naik" | "turun" | "stabil",
    "est_pct_min": number,            // perkiraan perubahan 30 hari, persen, batas bawah (boleh negatif)
    "est_pct_max": number,            // batas atas
    "confidence": "rendah" | "sedang" | "tinggi",
    "drivers": [string]               // maksimal 3 frasa singkat penyebab, HARUS bersumber dari judul yang diberikan
  }
]

ATURAN KERAS:
- Simpulkan HANYA dari judul berita yang diberikan. Dilarang memakai pengetahuan lain untuk mengarang kejadian.
- Bila judul untuk suatu komoditas sedikit/tidak jelas arah: direction "stabil", confidence "rendah", est 0 sampai 0.
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
              generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 4096 },
            }),
          },
        )
        if (geminiRes.ok) {
          const data = await geminiRes.json()
          const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '[]'
          try { signals = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]') } catch { signals = [] }
        }
      } catch { signals = [] }
    }

    // ---------- Validasi deterministik + simpan ----------
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
        run_date: today,
        commodity_key: c.key,
        commodity_label: c.label,
        direction,
        est_pct_min: min,
        est_pct_max: max,
        confidence: ['rendah', 'sedang', 'tinggi'].includes(s.confidence) ? s.confidence : 'rendah',
        drivers: Array.isArray(s.drivers) ? s.drivers.slice(0, 3).map((d: any) => String(d).slice(0, 140)) : [],
        sources: (f?.headlines || []).map((h) => ({ title: h.title, link: h.link })),
      }
    })
    await svc.from('macro_signals').upsert(rows, { onConflict: 'run_date,commodity_key' })

    await svc.from('macro_runs').update({
      status: 'done', finished_at: new Date().toISOString(),
      detail: `${rows.length} sinyal; ${kursNote || 'kurs gagal diambil'}`,
    }).eq('run_date', today)

    return json({ ok: true, signals: rows.length })
  } catch (e) {
    return json({ error: 'Terjadi kesalahan pipeline makro.', detail: String(e).slice(0, 300) }, 500)
  }
})
