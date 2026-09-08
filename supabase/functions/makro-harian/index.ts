// ============================================================
// Supabase Edge Function: makro-harian (v3)
// Pipeline makro BERSAMA untuk seluruh platform, berjalan 1x per "hari data":
//   1) HARGA RESMI bahan pokok dari SP2KP Kemendag (nasional/HNT, API publik
//      tanpa kunci) -> tabel commodity_prices. Logika di ../_shared/sp2kp.ts.
//   2) Kurs USD/IDR SAMA PERSIS TradingView (FX_IDC:USDIDR); backfill histori
//      frankfurter/ECB untuk sparkline -> tabel exchange_rates.
//   3) Judul berita Bing News RSS per komoditas -> 1 panggilan Gemini
//      -> tabel macro_signals (perkiraan arah 30 hari). (Google News tidak
//      dipakai: blokir IP datacenter, terverifikasi 503.)
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
import { buildNational } from '../_shared/sp2kp.ts'
import { getPlatformGeminiClient, GeminiCallError } from '../_shared/ai/gemini-client.ts'
import { corsHeaders, originDitolak } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
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
// DIPANGKAS agresif ke inti paling berdampak (sinkron dengan src/lib/ragPrice.js):
// sumber resmi + kantor berita + media ekonomi papan atas + acuan komoditas global.
const TRUSTED_DOMAINS = [
  // Resmi pemerintah / lembaga (paling otoritatif untuk harga pangan)
  'bi.go.id', 'bps.go.id', 'kemendag.go.id', 'badanpangan.go.id',
  // Kantor berita & media ekonomi papan atas Indonesia
  'antaranews.com', 'kontan.co.id', 'bisnis.com', 'cnbcindonesia.com',
  // Global (komoditas dunia: CPO, gandum, kakao, kurs)
  'reuters.com', 'tradingeconomics.com',
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

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsHeaders(origin)
  if (req.method === 'OPTIONS') {
    originDitolak(origin, 'makro-harian')
    return new Response('ok', { headers: cors })
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
    const runKey = runKeyWIB()

    // ---------- 0) KURS USD/IDR dari TRADINGVIEW — DIPERBARUI SETIAP PEMANGGILAN ----------
    // Angka WAJIB sama persis dengan yang tampil di TradingView (FX_IDC:USDIDR).
    // Harga realtime `lp` di-gate untuk non-login → pakai `close` (nilai berjalan
    // terakhir yang ditampilkan TradingView). Bila TradingView tak terjangkau,
    // SENGAJA tidak menulis sumber lain (agar tak melenceng dari TradingView) —
    // nilai TradingView terakhir yang tersimpan tetap tampil di UI.
    let kursNote = ''
    try {
      const r = await fetch('https://scanner.tradingview.com/forex/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({
          symbols: { tickers: ['FX_IDC:USDIDR'], query: { types: [] } },
          columns: ['lp', 'close'],
        }),
      })
      if (r.ok) {
        const j = await r.json()
        const d = j?.data?.[0]?.d || []
        const rate = Number(d[0]) > 0 ? Number(d[0]) : Number(d[1]) // lp bila ada, else close
        if (rate > 0) {
          await svc.from('exchange_rates').upsert({
            rate_date: todayWIB(), usd_idr: rate, source: 'TradingView (FX_IDC:USDIDR)',
          })
          kursNote = `USD/IDR: ${Math.round(rate)}`
        }
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

    // ---------- 1) HARGA RESMI (SP2KP Kemendag) — nasional (HNT) semua bapok ----------
    // Pra-isi cache commodity_prices (province_id=0) agar Radar langsung siap.
    // Bila gagal, harga-daerah(0) tetap menariknya on-demand saat UI dibuka.
    let sp2kpCount = 0
    try {
      const rows = await buildNational(runKey)
      if (rows.length) {
        await svc.from('commodity_prices').upsert(rows, { onConflict: 'run_date,variant_name,province_id' })
        sp2kpCount = rows.length
      }
    } catch { /* harga SP2KP gagal tak menghentikan pipeline */ }

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

    // ---------- 4) SATU panggilan Gemini untuk semua komoditas ----------
    //
    // Hasil panggilan ini DICATAT, bukan sekadar dipakai. Sampai 8 September
    // 2026 blok ini menelan setiap kegagalan: kunci ditolak 401 setiap pagi,
    // `signals` tetap [], 25 baris "stabil" tetap ditulis, dan run tetap
    // ditandai `done`. Tidak ada satu pun kolom yang membedakan "AI bilang
    // semua stabil" dari "AI tidak pernah menjawab" — sehingga sinyal palsu
    // tampil di Radar selama 32 hari sebagai analisis yang sah.
    let signals: any[] = []
    let aiStatus: 'ok' | 'kosong' | 'gagal' = 'gagal'
    let aiDetail = ''
    let aiModel = ''
    let aiTokens = 0
    {
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
        // Kunci & model datang dari PLATFORM_ROUTES (_shared/ai/config.ts),
        // bukan dari env yang dibaca sendiri. Rantai fallback lintas keluarga
        // model ikut didapat gratis: satu model yang dipensiunkan Google tidak
        // lagi cukup untuk mematikan seluruh sinyal harga.
        const ai = getPlatformGeminiClient('makro')
        const hasil = await ai.generate({
          prompt: PROMPT,
          temperature: 0.2,
          json: true,
          maxOutputTokens: 16384,
          // Token "thinking" ikut memakan maxOutputTokens sehingga JSON bisa
          // terpotong di tengah tanpa satu pun error muncul.
          disableThinking: true,
        })
        aiModel = hasil.modelUsed
        aiTokens = hasil.usage.total

        try {
          signals = JSON.parse(hasil.text.match(/\[[\s\S]*\]/)?.[0] ?? '[]')
        } catch {
          signals = []
        }

        if (signals.length) {
          aiStatus = 'ok'
          aiDetail = `${signals.length} sinyal dari ${hasil.modelUsed}`
            + (hasil.usedFallback ? ' (model cadangan)' : '')
        } else {
          // Model menjawab tapi jawabannya tidak terpakai — biasanya JSON
          // terpotong karena finishReason MAX_TOKENS. Berbeda sebab, berbeda
          // penanganan, jadi berbeda pula statusnya.
          aiStatus = 'kosong'
          aiDetail = `model ${hasil.modelUsed} balas ${hasil.text.length} karakter `
            + `tanpa JSON yang bisa dipakai (finish=${hasil.finishReason})`
          console.error(`[makro] ${aiDetail}`)
        }
      } catch (e) {
        signals = []
        aiStatus = 'gagal'
        aiDetail = e instanceof GeminiCallError
          ? `${e.code}${e.status ? ` HTTP ${e.status}` : ''} pada ${e.model}: ${e.detail.slice(0, 200)}`
          : String(e).slice(0, 240)
        console.error(`[makro] Gemini gagal: ${aiDetail}`)
      }
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
        // Provenance baris ini: hasil AI sungguhan, atau nilai bawaan?
        //
        // Tanpa kolom ini, "AI menilai harga beras stabil" dan "AI tidak pernah
        // menjawab sehingga dipakai nilai bawaan" tersimpan sebagai baris yang
        // SAMA PERSIS: direction 'stabil', est 0..0, drivers []. Itulah yang
        // membuat 32 hari sinyal kosong tampil di Radar sebagai perkiraan yang
        // sah, dan itulah sebabnya kolom ini ada.
        ai_status: aiStatus,
      }
    })
    await svc.from('macro_signals').upsert(rows, { onConflict: 'run_date,commodity_key' })

    // Status run membedakan "selesai lengkap" dari "selesai tanpa AI".
    //
    // 'done' mengunci hari itu sepenuhnya (lihat blok LOCK di atas), jadi
    // memakai 'done' untuk run yang AI-nya gagal berarti kegagalan sesaat di
    // sisi Google mengunci Radar tanpa perkiraan selama 24 jam penuh.
    // 'done_tanpa_ai' membiarkan pemicu berikutnya mencoba lagi — dibatasi
    // jendela stale 10 menit, jadi paling banyak 6 percobaan per jam.
    const statusRun = aiStatus === 'ok' ? 'done' : 'done_tanpa_ai'
    await svc.from('macro_runs').update({
      status: statusRun,
      finished_at: new Date().toISOString(),
      detail: `${rows.length} sinyal; ${sp2kpCount} harga SP2KP; ${kursNote || 'kurs gagal'}; `
        + `AI=${aiStatus}${aiDetail ? ` (${aiDetail})` : ''}`,
      ai_status: aiStatus,
      ai_detail: aiDetail.slice(0, 500) || null,
      ai_model: aiModel || null,
      ai_tokens: aiTokens || null,
    }).eq('run_date', runKey)

    return json({
      ok: true,
      signals: rows.length,
      prices: sp2kpCount,
      ai: { status: aiStatus, model: aiModel || null, tokens: aiTokens, detail: aiDetail || null },
    })
  } catch (e) {
    return json({ error: 'Terjadi kesalahan pipeline makro.', detail: String(e).slice(0, 300) }, 500)
  }
})
