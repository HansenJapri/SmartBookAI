// ============================================================
// Supabase Edge Function: ai-stok-insight
// Insight kondisi STOK untuk halaman Stok Produk. Pola sama dgn ai-narasi:
//   1) Metrik stok dihitung DETERMINISTIK di sini (kode, bukan AI).
//   2) Gemini 2.5 Flash hanya MENARASIKAN metrik itu — dilarang menambah angka.
// Hasil di-cache di ai_insights (kind='stok', 1 baris/user/hari).
// Fallback: bila AI gagal/kuota habis, narasi template dari kode dikembalikan.
//
// Fokus: produk yang HAMPIR HABIS / SUDAH HABIS harus langsung diinfokan,
// beserta rekomendasi restock & nilai persediaan.
//
// Deploy: nama function "ai-stok-insight".
// ============================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getGeminiClient, payloadGagalAI } from '../_shared/ai/gemini-client.ts'
import {
  checkQuota, commitQuota, quotaBlockedPayload, telemetriDari,
  type QuotaTelemetry,
} from '../_shared/ai/rate-limiter.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? ''

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

const rupiah = (n: number) => 'Rp ' + Math.round(n || 0).toLocaleString('id-ID')
const todayWIB = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)

// Penjaga bahasa: gemini-2.5-flash kadang tetap membalas Bahasa Indonesia
// walau diminta Inggris (dipengaruhi data JSON & nama produk yang Indonesia).
// Kalau lolos filter kata umum Indonesia ini, buang hasil AI & pakai template EN.
const ID_MARKERS = /\b(yang|dengan|adalah|belum|sudah|dan|untuk|dari|akan|ini|itu|karena|juga|lebih|masih|bisa|perlu|coba|jadi|kalau|kamu|anda)\b/i
function looksIndonesian(text: string): boolean {
  const hits = text.match(new RegExp(ID_MARKERS, 'gi'))
  return (hits?.length ?? 0) >= 3
}

function templateNarrative(m: any): string {
  const parts: string[] = []
  if (m.total_products === 0) {
    return 'Belum ada produk terdaftar. Tambah produk beserta stok minimum agar sistem bisa mengingatkan saat stok menipis.'
  }
  if (m.out_names?.length) {
    parts.push(`${m.out_count} produk SUDAH HABIS: ${m.out_names.slice(0, 4).join(', ')}${m.out_count > 4 ? ', dll' : ''}. Segera restock agar penjualan tidak hilang.`)
  }
  if (m.low_names?.length) {
    parts.push(`${m.low_count} produk mau habis (di bawah stok minimum): ${m.low_names.slice(0, 4).join(', ')}${m.low_count > 4 ? ', dll' : ''}.`)
  }
  if (!m.out_names?.length && !m.low_names?.length) {
    parts.push(`Stok aman: ${m.healthy_count} dari ${m.total_products} produk di atas batas minimum.`)
  }
  if (m.watch_count > 0) parts.push(`${m.watch_count} produk mulai menipis (mendekati batas minimum), pantau beberapa hari ke depan.`)
  if (m.inventory_value > 0) parts.push(`Nilai persediaan saat ini sekitar ${rupiah(m.inventory_value)}.`)
  if (m.no_min_count > 0) parts.push(`${m.no_min_count} produk belum diberi stok minimum, jadi tidak bisa diingatkan otomatis — sebaiknya diisi.`)
  return parts.join(' ')
}

// English fallback template — same structure & fields as templateNarrative.
function templateNarrativeEn(m: any): string {
  const parts: string[] = []
  if (m.total_products === 0) {
    return 'No products registered yet. Add products along with a minimum stock level so the system can warn you when stock runs low.'
  }
  if (m.out_names?.length) {
    parts.push(`${m.out_count} product(s) OUT OF STOCK: ${m.out_names.slice(0, 4).join(', ')}${m.out_count > 4 ? ', etc.' : ''}. Restock soon to avoid lost sales.`)
  }
  if (m.low_names?.length) {
    parts.push(`${m.low_count} product(s) running low (below minimum stock): ${m.low_names.slice(0, 4).join(', ')}${m.low_count > 4 ? ', etc.' : ''}.`)
  }
  if (!m.out_names?.length && !m.low_names?.length) {
    parts.push(`Stock is healthy: ${m.healthy_count} of ${m.total_products} products are above the minimum threshold.`)
  }
  if (m.watch_count > 0) parts.push(`${m.watch_count} product(s) are starting to run low (near the minimum threshold) — keep an eye on them over the next few days.`)
  if (m.inventory_value > 0) parts.push(`Current inventory value is roughly ${rupiah(m.inventory_value)}.`)
  if (m.no_min_count > 0) parts.push(`${m.no_min_count} product(s) don't have a minimum stock set yet, so they can't be auto-flagged — worth setting one.`)
  return parts.join(' ')
}

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsHeaders(origin)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Harus masuk (login).' }, 401)
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
    })
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) return json({ error: 'Sesi tidak valid.' }, 401)

    let force = false
    let lang = 'id'
    try { const b = await req.json(); force = b?.force === true; if (b?.lang === 'en') lang = 'en' } catch { /* body kosong tak apa */ }
    const isEn = lang === 'en'
    const kind = isEn ? 'stok_en' : 'stok'

    const today = todayWIB()

    // ---- Cache harian ----
    if (!force) {
      const { data: cached } = await supabase
        .from('ai_insights').select('content, payload')
        .eq('insight_date', today).eq('kind', kind).maybeSingle()
      if (cached?.content) return json({ content: cached.content, metrics: cached.payload, cached: true })
    }

    // Kuota harian PER WORKSPACE, dicek sebelum memanggil Gemini.
    const ai = getGeminiClient('insight_stok')
    const quota = await checkQuota(supabase, ai.quotaFeature, ai.dailyCap)
    if (!quota.allowed) return json(quotaBlockedPayload(ai.quotaFeature, quota), 429)

    // ================= TAHAP 1: metrik deterministik =================
    const { data: products } = await supabase
      .from('products')
      .select('name, category, unit, stock, min_stock, price, cost_price')
      .limit(2000)

    const out: any[] = [], low: any[] = [], watch: any[] = []
    let healthy = 0, noMin = 0, inventoryValue = 0
    for (const p of products || []) {
      const stock = Number(p.stock) || 0
      const min = Number(p.min_stock) || 0
      const unitCost = Number(p.cost_price) || Number(p.price) || 0
      inventoryValue += stock * unitCost
      if (min <= 0) { noMin++; if (stock <= 0) out.push(p); continue }
      if (stock <= 0) out.push(p)
      else if (stock <= min) low.push(p)
      else if (stock <= min * 1.5) watch.push(p)
      else healthy++
    }
    // Urutkan yang paling genting dulu (rasio stok terhadap minimum terkecil).
    const urgency = (p: any) => {
      const min = Number(p.min_stock) || 0
      return min > 0 ? (Number(p.stock) || 0) / min : 0
    }
    out.sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0))
    low.sort((a, b) => urgency(a) - urgency(b))

    const nameUnit = (p: any) => `${p.name}${p.stock != null ? ` (sisa ${Number(p.stock)}${p.unit ? ' ' + p.unit : ''})` : ''}`

    const metrics = {
      total_products: (products || []).length,
      out_count: out.length,
      out_names: out.slice(0, 8).map(nameUnit),
      low_count: low.length,
      low_names: low.slice(0, 8).map(nameUnit),
      watch_count: watch.length,
      watch_names: watch.slice(0, 6).map((p) => p.name),
      healthy_count: healthy,
      no_min_count: noMin,
      inventory_value: Math.round(inventoryValue),
    }

    // ================= TAHAP 2: Gemini menarasikan =================
    let content = ''
    let aiError: string | null = null
    let tele: QuotaTelemetry | undefined
    if (metrics.total_products > 0) {
      try {
        const PROMPT = isEn ? `You are a practical stock-management assistant for a small Indonesian business (UMKM).
Summarize this shop's STOCK CONDITION in plain everyday English.

DATA (the only source of numbers & product names you may mention):
${JSON.stringify(metrics)}

HOW TO STRUCTURE IT (must follow this order):
1) First sentence = warning about OUT-OF-STOCK products (out_names) if any; if none, products RUNNING LOW (low_names). Name the products.
2) If present, mention products starting to run low (watch) as an early warning.
3) If both are empty, say stock is healthy/safe.
4) Last sentence = 1 concrete action tip (e.g. create a Purchase Order for the most critical product, or set a minimum stock level for products missing one).

HARD RULES:
- Maximum 4 sentences. Concise and direct.
- PLAIN TEXT with no markdown (no *, #, _, no bullets).
- ONLY mention product names & numbers that ARE in DATA. Never invent products or numbers.
- A 0/empty field means it doesn't exist — don't discuss it.
- Tone: firm but helpful, like a coworker giving you a heads-up.
- LANGUAGE: your ENTIRE reply must be in English, even though the DATA field names and product names below are in Indonesian — translate any Indonesian product/category name naturally into English inside your sentence. Do not write a single Indonesian sentence.` : `Kamu asisten manajemen stok untuk UMKM Indonesia yang praktis.
Simpulkan KONDISI STOK toko ini dalam Bahasa Indonesia sehari-hari.

DATA (satu-satunya sumber angka & nama produk yang boleh kamu sebut):
${JSON.stringify(metrics)}

CARA MERANGKAI (wajib urut):
1) Kalimat pertama = peringatan produk yang SUDAH HABIS (out_names) bila ada; kalau tidak ada, produk yang MAU HABIS (low_names). Sebut nama produknya.
2) Bila ada, sebut produk yang mulai menipis (watch) sebagai peringatan dini.
3) Bila keduanya kosong, katakan stok sehat/aman.
4) Kalimat terakhir = 1 saran tindakan konkret (mis. buat Purchase Order untuk produk paling genting, atau isi stok minimum untuk produk yang belum diatur).

ATURAN KERAS:
- Maksimal 4 kalimat. Padat dan langsung.
- TEKS BIASA tanpa markdown (tanpa *, #, _, tanpa bullet).
- HANYA sebut nama produk & angka yang ADA di DATA. Dilarang mengarang produk atau angka.
- Field 0/kosong artinya tidak ada — jangan dibahas.
- Nada: tegas tapi membantu, seperti rekan kerja yang mengingatkan.`
        // disableThinking agar maxOutputTokens tidak termakan mode "thinking".
        const r = await ai.generate({
          prompt: PROMPT,
          temperature: 0.3,
          maxOutputTokens: 600,
          disableThinking: true,
        })
        // Jangan tampilkan narasi terpotong (MAX_TOKENS) — pakai template lengkap.
        // Bila diminta Inggris tapi Gemini tetap membalas Indonesia, buang juga.
        if (r.text && r.finishReason !== 'MAX_TOKENS' && !(isEn && looksIndonesian(r.text))) {
          content = r.text
          tele = telemetriDari(r, ai.route.key)
        } else {
          // Jawaban dibuang — token tetap terbakar. Lihat catatan di ai-narasi.
          tele = { ...telemetriDari(r, ai.route.key), wastedTokens: r.usage.total }
        }
      } catch (e) {
        // Sama seperti ai-narasi: template tetap tampil, tapi sebabnya dicatat.
        aiError = payloadGagalAI(e).code
        console.error(`[ai-stok-insight] Gemini gagal, memakai template: ${String(e).slice(0, 300)}`)
      }
    }
    const usedAI = Boolean(content)
    // Kuota hanya naik bila AI benar-benar menghasilkan narasi.
    if (usedAI) await commitQuota(supabase, ai.quotaFeature, 1, tele)
    else if (tele) await commitQuota(supabase, ai.quotaFeature, 0, tele)
    if (!content) content = isEn ? templateNarrativeEn(metrics) : templateNarrative(metrics)

    try {
      await supabase.from('ai_insights').upsert({
        user_id: userData.user.id, insight_date: today, kind,
        content, payload: metrics,
      }, { onConflict: 'user_id,insight_date,kind' })
    } catch { /* cache gagal bukan masalah fatal */ }

    return json({ content, metrics, cached: false, ai: usedAI, aiError })
  } catch (e) {
    return json({ error: 'Terjadi kesalahan saat membuat insight stok.', detail: String(e).slice(0, 300) }, 500)
  }
})
