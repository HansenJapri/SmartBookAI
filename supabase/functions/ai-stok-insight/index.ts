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

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? ''
const MODEL = 'gemini-2.5-flash'

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
    try { const b = await req.json(); force = b?.force === true } catch { /* body kosong tak apa */ }

    const today = todayWIB()

    // ---- Cache harian ----
    if (!force) {
      const { data: cached } = await supabase
        .from('ai_insights').select('content, payload')
        .eq('insight_date', today).eq('kind', 'stok').maybeSingle()
      if (cached?.content) return json({ content: cached.content, metrics: cached.payload, cached: true })
    }

    const { data: allowed } = await supabase.rpc('bump_ai_usage', { p_kind: 'stok', p_limit: 5 })
    if (allowed === false) return json({ error: 'Batas pembuatan insight stok harian tercapai. Coba lagi besok.' }, 429)

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
    if (GEMINI_API_KEY && metrics.total_products > 0) {
      try {
        const PROMPT = `Kamu asisten manajemen stok untuk UMKM Indonesia yang praktis.
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
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
          {
            method: 'POST',
            headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: PROMPT }] }],
              // thinkingBudget:0 mematikan mode "thinking" gemini-2.5-flash agar
              // tidak memakan maxOutputTokens → narasi tidak terpotong di tengah.
              generationConfig: { temperature: 0.3, maxOutputTokens: 600, thinkingConfig: { thinkingBudget: 0 } },
            }),
          },
        )
        if (geminiRes.ok) {
          const data = await geminiRes.json()
          const cand = data?.candidates?.[0]
          const text = (cand?.content?.parts?.map((p: any) => p.text).join('') ?? '').trim()
          // Jangan tampilkan narasi terpotong (MAX_TOKENS) — pakai template lengkap.
          if (text && cand?.finishReason !== 'MAX_TOKENS') content = text
        }
      } catch { /* jatuh ke template */ }
    }
    const usedAI = Boolean(content)
    if (!content) content = templateNarrative(metrics)

    try {
      await supabase.from('ai_insights').upsert({
        user_id: userData.user.id, insight_date: today, kind: 'stok',
        content, payload: metrics,
      }, { onConflict: 'user_id,insight_date,kind' })
    } catch { /* cache gagal bukan masalah fatal */ }

    return json({ content, metrics, cached: false, ai: usedAI })
  } catch (e) {
    return json({ error: 'Terjadi kesalahan saat membuat insight stok.', detail: String(e).slice(0, 300) }, 500)
  }
})
