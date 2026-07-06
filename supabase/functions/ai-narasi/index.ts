// ============================================================
// Supabase Edge Function: ai-narasi
// Narasi insight harian untuk Dashboard. Dua tahap:
//   1) SEMUA metrik dihitung DETERMINISTIK di sini (kode, bukan AI).
//   2) Gemini 2.5 Flash hanya MENARASIKAN metrik itu — dilarang menambah angka.
// Hasil di-cache di tabel ai_insights (1 baris per user per hari) sehingga
// pengguna yang membuka dashboard berkali-kali tidak memicu biaya AI baru.
// Fallback: bila AI gagal, narasi template dari kode tetap dikembalikan.
//
// Deploy: nama function "ai-narasi".
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

// Narasi cadangan berbasis template murni (tanpa AI) — aplikasi tetap hidup
// saat kuota habis / layanan AI gangguan.
function templateNarrative(m: any): string {
  const parts: string[] = []
  if (m.wow_pct !== null) {
    parts.push(`Omzet 7 hari terakhir ${rupiah(m.income_7d)} (${m.wow_pct >= 0 ? 'naik' : 'turun'} ${Math.abs(m.wow_pct)}% dibanding 7 hari sebelumnya).`)
  } else if (m.income_7d > 0) {
    parts.push(`Omzet 7 hari terakhir ${rupiah(m.income_7d)}.`)
  } else {
    parts.push('Belum ada pemasukan tercatat dalam 7 hari terakhir.')
  }
  if (m.weekend_share_pct !== null && m.weekend_share_pct > 40) parts.push(`Akhir pekan menyumbang ${m.weekend_share_pct}% omzet 14 hari terakhir.`)
  if (m.top_expense_cat) parts.push(`Pengeluaran terbesar 30 hari: ${m.top_expense_cat} (${rupiah(m.top_expense_amt)}).`)
  if (m.unpaid_count > 0) parts.push(`Ada ${m.unpaid_count} penjualan belum lunas total ${rupiah(m.unpaid_total)}${m.unpaid_oldest_days ? `, yang tertua ${m.unpaid_oldest_days} hari` : ''}.`)
  if (m.low_stock_names?.length) parts.push(`Stok menipis: ${m.low_stock_names.slice(0, 4).join(', ')}.`)
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

    // ---- Cache harian: kalau sudah ada & tidak dipaksa, kembalikan tanpa biaya AI ----
    if (!force) {
      const { data: cached } = await supabase
        .from('ai_insights').select('content, payload, created_at')
        .eq('insight_date', today).eq('kind', 'harian').maybeSingle()
      if (cached?.content) return json({ content: cached.content, metrics: cached.payload, cached: true })
    }

    // Kuota harian generasi narasi (cache-hit tidak kena kuota).
    const { data: allowed } = await supabase.rpc('bump_ai_usage', { p_kind: 'narasi', p_limit: 5 })
    if (allowed === false) return json({ error: 'Batas pembuatan insight harian tercapai. Coba lagi besok.' }, 429)

    // ================= TAHAP 1: metrik deterministik =================
    const { data: txs } = await supabase
      .from('transactions')
      .select('direction, amount, category, payment_status, occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(2000)

    const now = Date.now()
    const d7 = now - 7 * 86400000, d14 = now - 14 * 86400000, d30 = now - 30 * 86400000, d60 = now - 60 * 86400000
    let income7 = 0, incomePrev7 = 0, weekend14 = 0, income14 = 0
    let unpaidCount = 0, unpaidTotal = 0, unpaidOldest = 0
    const exp30: Record<string, number> = {}, exp60: Record<string, number> = {}
    for (const t of txs || []) {
      const amt = Number(t.amount) || 0
      const ts = new Date(t.occurred_at).getTime()
      if (t.direction === 'in') {
        if (ts >= d7) income7 += amt
        else if (ts >= d14) incomePrev7 += amt
        if (ts >= d14) {
          income14 += amt
          const dow = new Date(t.occurred_at).getDay()
          if (dow === 0 || dow === 6) weekend14 += amt
        }
        if (t.payment_status === 'belum') {
          unpaidCount++; unpaidTotal += amt
          const age = Math.floor((now - ts) / 86400000)
          if (age > unpaidOldest) unpaidOldest = age
        }
      } else {
        if (ts >= d30) exp30[t.category] = (exp30[t.category] || 0) + amt
        else if (ts >= d60) exp60[t.category] = (exp60[t.category] || 0) + amt
      }
    }
    const topExp = Object.entries(exp30).sort((a, b) => b[1] - a[1])[0] || null
    const topExpPrev = topExp ? (exp60[topExp[0]] || 0) : 0

    const { data: products } = await supabase.from('products').select('name, stock, min_stock')
    const lowStock = (products || []).filter((p) => Number(p.min_stock) > 0 && Number(p.stock) <= Number(p.min_stock))

    // Target aktif (bila ada) — progres dihitung deterministik.
    let target: any = null
    try {
      const { data: tgt } = await supabase
        .from('sales_targets').select('name, amount, start_date')
        .eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (tgt) {
        const start = new Date(tgt.start_date + 'T00:00:00').getTime()
        let achieved = 0
        for (const t of txs || []) {
          if (t.direction === 'in' && new Date(t.occurred_at).getTime() >= start) achieved += Number(t.amount) || 0
        }
        target = { name: tgt.name, amount: Number(tgt.amount), achieved, progress_pct: Number(tgt.amount) > 0 ? Math.round((achieved / Number(tgt.amount)) * 100) : 0 }
      }
    } catch { /* tabel belum ada — abaikan */ }

    const metrics = {
      income_7d: income7,
      income_prev_7d: incomePrev7,
      wow_pct: incomePrev7 > 0 ? Math.round(((income7 - incomePrev7) / incomePrev7) * 100) : null,
      weekend_share_pct: income14 > 0 ? Math.round((weekend14 / income14) * 100) : null,
      top_expense_cat: topExp ? topExp[0] : null,
      top_expense_amt: topExp ? Math.round(topExp[1]) : 0,
      top_expense_prev_amt: Math.round(topExpPrev),
      unpaid_count: unpaidCount,
      unpaid_total: Math.round(unpaidTotal),
      unpaid_oldest_days: unpaidOldest,
      low_stock_names: lowStock.slice(0, 6).map((p) => p.name),
      target,
      tx_count: (txs || []).length,
    }

    // ================= TAHAP 2: Gemini menarasikan =================
    let content = ''
    if (GEMINI_API_KEY && metrics.tx_count > 0) {
      try {
        const PROMPT = `Kamu penasihat keuangan UMKM Indonesia yang membumi.
Narasikan DATA berikut untuk pemilik usaha, dalam Bahasa Indonesia sehari-hari.

DATA (satu-satunya sumber angka yang boleh kamu sebut):
${JSON.stringify(metrics)}

ATURAN KERAS:
- Maksimal 5 kalimat ringkas + 1 kalimat saran tindakan konkret di akhir.
- TEKS BIASA tanpa markdown (tanpa *, #, _).
- DILARANG menyebut angka apa pun yang tidak ada di DATA. Dilarang mengarang tren.
- Field null artinya datanya belum ada — jangan disebut.
- Format uang: "Rp 2,4 juta" atau "Rp 450 ribu" (dibulatkan wajar dari DATA).
- Nada: hangat, jelas, tidak menggurui.`
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
          {
            method: 'POST',
            headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: PROMPT }] }],
              generationConfig: { temperature: 0.3, maxOutputTokens: 400 },
            }),
          },
        )
        if (geminiRes.ok) {
          const data = await geminiRes.json()
          content = (data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '').trim()
        }
      } catch { /* jatuh ke template */ }
    }
    const usedAI = Boolean(content)
    if (!content) content = metrics.tx_count > 0 ? templateNarrative(metrics) : 'Belum ada transaksi tercatat. Mulai catat lewat menu Transaksi, tombol + Catat, atau foto struk — insight harian akan muncul di sini.'

    // Simpan cache (upsert per user per hari).
    try {
      await supabase.from('ai_insights').upsert({
        user_id: userData.user.id, insight_date: today, kind: 'harian',
        content, payload: metrics,
      }, { onConflict: 'user_id,insight_date,kind' })
    } catch { /* cache gagal bukan masalah fatal */ }

    return json({ content, metrics, cached: false, ai: usedAI })
  } catch (e) {
    return json({ error: 'Terjadi kesalahan saat membuat insight.', detail: String(e).slice(0, 300) }, 500)
  }
})
