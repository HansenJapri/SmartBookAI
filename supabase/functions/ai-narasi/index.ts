// ============================================================
// Supabase Edge Function: ai-narasi
// Narasi insight harian untuk Dashboard. Dua tahap:
//   1) SEMUA metrik dihitung DETERMINISTIK di sini (kode, bukan AI).
//   2) Gemini 2.5 Flash hanya MENARASIKAN metrik itu — dilarang menambah angka.
// Hasil di-cache di tabel ai_insights (1 baris per user per hari) sehingga
// pengguna yang membuka dashboard berkali-kali tidak memicu biaya AI baru.
// Fallback: bila AI gagal, narasi template dari kode tetap dikembalikan.
//
// Fokus insight: KONDISI BISNIS HARI INI (omset, pengeluaran, laba, margin),
// dibandingkan kemarin & bulan berjalan, lalu hal yang butuh perhatian.
//
// Deploy: nama function "ai-narasi".
// ============================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getGeminiClient, payloadGagalAI } from '../_shared/ai/gemini-client.ts'
import {
  checkQuota, commitQuota, dailyLimitPayload, telemetriDari,
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
// walau diminta Inggris (dipengaruhi data JSON & nama kategori yang Indonesia).
// Kalau lolos filter kata umum Indonesia ini, buang hasil AI & pakai template EN.
const ID_MARKERS = /\b(yang|dengan|adalah|belum|sudah|dan|untuk|dari|akan|ini|itu|karena|juga|lebih|masih|bisa|perlu|coba|jadi|kalau|kamu|anda)\b/i
function looksIndonesian(text: string): boolean {
  const hits = text.match(new RegExp(ID_MARKERS, 'gi'))
  return (hits?.length ?? 0) >= 3
}
// Batas hari/bulan dalam zona WIB (+07:00), dikembalikan sebagai epoch ms UTC.
const wibStart = (isoDate: string) => new Date(isoDate + 'T00:00:00+07:00').getTime()

// Narasi cadangan berbasis template murni (tanpa AI) — aplikasi tetap hidup
// saat kuota habis / layanan AI gangguan. Membuka dengan kondisi HARI INI.
function templateNarrative(m: any): string {
  const parts: string[] = []
  // Kalimat pembuka = kondisi bisnis hari ini.
  if (m.today_income > 0 || m.today_expense > 0) {
    parts.push(`Hari ini masuk ${rupiah(m.today_income)} dan keluar ${rupiah(m.today_expense)}, jadi laba hari ini ${rupiah(m.today_profit)}.`)
    if (m.yesterday_income > 0) {
      const dir = m.today_income >= m.yesterday_income ? 'lebih tinggi' : 'lebih rendah'
      parts.push(`Omset hari ini ${dir} dibanding kemarin (${rupiah(m.yesterday_income)}).`)
    }
  } else {
    parts.push('Belum ada transaksi tercatat hari ini.')
  }
  // Bulan berjalan.
  if (m.month_income > 0 || m.month_expense > 0) {
    parts.push(`Bulan ini omset ${rupiah(m.month_income)}, laba bersih ${rupiah(m.month_profit)} (margin ${m.month_margin_pct ?? 0}%).`)
  }
  if (m.wow_pct !== null) {
    parts.push(`Tren 7 hari terakhir ${m.wow_pct >= 0 ? 'naik' : 'turun'} ${Math.abs(m.wow_pct)}% dibanding pekan sebelumnya.`)
  }
  if (m.target?.revenue_pct != null || m.target?.profit_pct != null) {
    const bits: string[] = []
    if (m.target.revenue_pct != null) bits.push(`omset ${m.target.revenue_pct}%`)
    if (m.target.profit_pct != null) bits.push(`profit ${m.target.profit_pct}%`)
    parts.push(`Target "${m.target.name}": ${bits.join(', ')} tercapai.`)
  }
  if (m.unpaid_count > 0) parts.push(`Ada ${m.unpaid_count} penjualan belum lunas total ${rupiah(m.unpaid_total)}${m.unpaid_oldest_days ? `, tertua ${m.unpaid_oldest_days} hari` : ''}.`)
  if (m.low_stock_names?.length) parts.push(`Stok menipis: ${m.low_stock_names.slice(0, 4).join(', ')}.`)
  return parts.join(' ')
}

// English fallback template — same structure & fields as templateNarrative.
function templateNarrativeEn(m: any): string {
  const parts: string[] = []
  if (m.today_income > 0 || m.today_expense > 0) {
    parts.push(`Today's income is ${rupiah(m.today_income)} and expenses ${rupiah(m.today_expense)}, for a profit of ${rupiah(m.today_profit)}.`)
    if (m.yesterday_income > 0) {
      const dir = m.today_income >= m.yesterday_income ? 'higher' : 'lower'
      parts.push(`Today's revenue is ${dir} than yesterday (${rupiah(m.yesterday_income)}).`)
    }
  } else {
    parts.push('No transactions recorded today yet.')
  }
  if (m.month_income > 0 || m.month_expense > 0) {
    parts.push(`This month's revenue is ${rupiah(m.month_income)}, net profit ${rupiah(m.month_profit)} (margin ${m.month_margin_pct ?? 0}%).`)
  }
  if (m.wow_pct !== null) {
    parts.push(`The last-7-day trend is ${m.wow_pct >= 0 ? 'up' : 'down'} ${Math.abs(m.wow_pct)}% versus the prior week.`)
  }
  if (m.target?.revenue_pct != null || m.target?.profit_pct != null) {
    const bits: string[] = []
    if (m.target.revenue_pct != null) bits.push(`revenue ${m.target.revenue_pct}%`)
    if (m.target.profit_pct != null) bits.push(`profit ${m.target.profit_pct}%`)
    parts.push(`Target "${m.target.name}": ${bits.join(', ')} achieved.`)
  }
  if (m.unpaid_count > 0) parts.push(`There are ${m.unpaid_count} unpaid sale(s) totaling ${rupiah(m.unpaid_total)}${m.unpaid_oldest_days ? `, the oldest ${m.unpaid_oldest_days} day(s)` : ''}.`)
  if (m.low_stock_names?.length) parts.push(`Low stock: ${m.low_stock_names.slice(0, 4).join(', ')}.`)
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
    const kind = isEn ? 'harian_en' : 'harian'

    const today = todayWIB()

    // ---- Cache harian: kalau sudah ada & tidak dipaksa, kembalikan tanpa biaya AI ----
    if (!force) {
      const { data: cached } = await supabase
        .from('ai_insights').select('content, payload, created_at')
        .eq('insight_date', today).eq('kind', kind).maybeSingle()
      if (cached?.content) return json({ content: cached.content, metrics: cached.payload, cached: true })
    }

    // Kuota harian PER WORKSPACE (cache-hit di atas tidak kena kuota).
    // Dicek SEBELUM memanggil Gemini supaya kuota asli di Google tidak terbuang.
    const ai = getGeminiClient('insight_dashboard')
    const quota = await checkQuota(supabase, ai.quotaFeature, ai.dailyCap)
    if (!quota.allowed) return json(dailyLimitPayload(ai.quotaFeature, quota), 429)

    // ================= TAHAP 1: metrik deterministik =================
    const { data: txs } = await supabase
      .from('transactions')
      .select('direction, amount, category, payment_status, occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(3000)

    const now = Date.now()
    const d7 = now - 7 * 86400000, d14 = now - 14 * 86400000, d30 = now - 30 * 86400000, d60 = now - 60 * 86400000

    // Batas HARI INI / KEMARIN / BULAN INI / BULAN LALU (zona WIB).
    const todayStart = wibStart(today)
    const yesterdayStart = todayStart - 86400000
    const [yy, mm] = today.split('-').map(Number)
    const monthStart = wibStart(`${yy}-${String(mm).padStart(2, '0')}-01`)
    const lastMonthY = mm === 1 ? yy - 1 : yy
    const lastMonthM = mm === 1 ? 12 : mm - 1
    const lastMonthStart = wibStart(`${lastMonthY}-${String(lastMonthM).padStart(2, '0')}-01`)

    let income7 = 0, incomePrev7 = 0, weekend14 = 0, income14 = 0
    let todayIncome = 0, todayExpense = 0, yesterdayIncome = 0, yesterdayExpense = 0
    let monthIncome = 0, monthExpense = 0, lastMonthIncome = 0, lastMonthExpense = 0
    let unpaidCount = 0, unpaidTotal = 0, unpaidOldest = 0
    const exp30: Record<string, number> = {}, exp60: Record<string, number> = {}
    for (const t of txs || []) {
      const amt = Number(t.amount) || 0
      const ts = new Date(t.occurred_at).getTime()
      // Snapshot hari ini / kemarin / bulan ini / bulan lalu (semua arah).
      if (ts >= todayStart) { if (t.direction === 'in') todayIncome += amt; else todayExpense += amt }
      else if (ts >= yesterdayStart) { if (t.direction === 'in') yesterdayIncome += amt; else yesterdayExpense += amt }
      if (ts >= monthStart) { if (t.direction === 'in') monthIncome += amt; else monthExpense += amt }
      else if (ts >= lastMonthStart) { if (t.direction === 'in') lastMonthIncome += amt; else lastMonthExpense += amt }

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

    const todayProfit = todayIncome - todayExpense
    const monthProfit = monthIncome - monthExpense
    const lastMonthProfit = lastMonthIncome - lastMonthExpense

    const { data: products } = await supabase.from('products').select('name, stock, min_stock')
    const lowStock = (products || []).filter((p) => Number(p.min_stock) > 0 && Number(p.stock) <= Number(p.min_stock))

    // Target aktif (bila ada) — progres omset & profit dihitung deterministik
    // dalam rentang target sendiri (start_date..deadline).
    let target: any = null
    try {
      const { data: tgt } = await supabase
        .from('sales_targets').select('name, amount, revenue_target, profit_target, start_date, deadline')
        .eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (tgt) {
        const start = wibStart((tgt.start_date || today))
        const end = tgt.deadline ? new Date(tgt.deadline + 'T23:59:59+07:00').getTime() : null
        let inc = 0, exp = 0
        for (const t of txs || []) {
          const ts = new Date(t.occurred_at).getTime()
          if (ts < start || (end && ts > end)) continue
          if (t.direction === 'in') inc += Number(t.amount) || 0
          else exp += Number(t.amount) || 0
        }
        const prof = inc - exp
        const rev = tgt.revenue_target != null ? Number(tgt.revenue_target) : (tgt.amount != null ? Number(tgt.amount) : null)
        const profT = tgt.profit_target != null ? Number(tgt.profit_target) : null
        target = {
          name: tgt.name,
          revenue_target: rev, profit_target: profT,
          achieved_revenue: Math.round(inc), achieved_profit: Math.round(prof),
          revenue_pct: rev && rev > 0 ? Math.round((inc / rev) * 100) : null,
          profit_pct: profT && profT > 0 ? Math.round((prof / profT) * 100) : null,
          deadline: tgt.deadline || null,
        }
      }
    } catch { /* tabel belum ada — abaikan */ }

    const metrics = {
      today_income: Math.round(todayIncome),
      today_expense: Math.round(todayExpense),
      today_profit: Math.round(todayProfit),
      yesterday_income: Math.round(yesterdayIncome),
      yesterday_expense: Math.round(yesterdayExpense),
      today_vs_yesterday_pct: yesterdayIncome > 0 ? Math.round(((todayIncome - yesterdayIncome) / yesterdayIncome) * 100) : null,
      month_income: Math.round(monthIncome),
      month_expense: Math.round(monthExpense),
      month_profit: Math.round(monthProfit),
      month_margin_pct: monthIncome > 0 ? Math.round((monthProfit / monthIncome) * 100) : null,
      last_month_income: Math.round(lastMonthIncome),
      last_month_profit: Math.round(lastMonthProfit),
      income_7d: Math.round(income7),
      income_prev_7d: Math.round(incomePrev7),
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
    // Sebab kegagalan AI, bila ada. Ikut dikirim ke klien supaya "narasi ini
    // template" bisa dibedakan dari "narasi ini memang sedang tidak menarik".
    let aiError: string | null = null
    let tele: QuotaTelemetry | undefined
    if (metrics.tx_count > 0) {
      try {
        const PROMPT = isEn ? `You are a down-to-earth, to-the-point financial advisor for a small Indonesian business (UMKM).
Your job: summarize this owner's BUSINESS CONDITION for TODAY, in plain everyday English.

DATA (the only source of numbers you may mention):
${JSON.stringify(metrics)}

HOW TO STRUCTURE IT (must follow this order):
1) First sentence = CONCLUSION about today's business condition (use today_income, today_expense, today_profit). If both are 0, say no transactions yet today and discuss the month-to-date instead.
2) Briefly compare with yesterday (today_vs_yesterday_pct) and/or month-to-date (month_income, month_profit, month_margin_pct).
3) Highlight 1 thing that needs attention if present: target (target.revenue_pct / target.profit_pct), receivables (unpaid_*), biggest expense (top_expense_cat), or low stock (low_stock_names).
4) Last sentence = 1 concrete, realistic action tip for a small shop/UMKM owner.

HARD RULES:
- Maximum 5 sentences total. Concise, no rambling.
- PLAIN TEXT with no markdown (no *, #, _, no bullets).
- NEVER mention any number not in DATA. Never invent trends or products.
- A null/0 field means the data doesn't exist yet — don't force a mention of it.
- Currency amounts stay in Rupiah, written like "Rp 2.4 million" or "Rp 450 thousand" (round sensibly from DATA).
- Percentages are taken as-is from DATA (e.g. margin ${metrics.month_margin_pct ?? 0}%).
- Tone: warm, clear, encouraging without being preachy.
- LANGUAGE: your ENTIRE reply must be in English, even though the DATA field names and category names below are in Indonesian — translate any Indonesian category/product name naturally into English inside your sentence. Do not write a single Indonesian sentence.` : `Kamu penasihat keuangan UMKM Indonesia yang membumi dan to the point.
Tugasmu: simpulkan KONDISI BISNIS pemilik usaha ini untuk HARI INI, dalam Bahasa Indonesia sehari-hari.

DATA (satu-satunya sumber angka yang boleh kamu sebut):
${JSON.stringify(metrics)}

CARA MERANGKAI (wajib urut):
1) Kalimat pertama = KESIMPULAN kondisi bisnis HARI INI (pakai today_income, today_expense, today_profit). Bila keduanya 0, katakan belum ada transaksi hari ini lalu bahas bulan berjalan.
2) Bandingkan singkat dengan kemarin (today_vs_yesterday_pct) dan/atau bulan berjalan (month_income, month_profit, month_margin_pct).
3) Sorot 1 hal yang perlu perhatian bila ada: target (target.revenue_pct / target.profit_pct), piutang (unpaid_*), pengeluaran terbesar (top_expense_cat), atau stok menipis (low_stock_names).
4) Kalimat terakhir = 1 saran tindakan konkret & realistis untuk pemilik warung/UMKM.

ATURAN KERAS:
- Maksimal 5 kalimat total. Padat, tidak bertele-tele.
- TEKS BIASA tanpa markdown (tanpa *, #, _, tanpa bullet).
- DILARANG menyebut angka apa pun yang tidak ada di DATA. Dilarang mengarang tren atau produk.
- Field bernilai null/0 artinya datanya belum ada — jangan dipaksa dibahas.
- Format uang ringkas: "Rp 2,4 juta" atau "Rp 450 ribu" (bulatkan wajar dari DATA).
- Persen ambil apa adanya dari DATA (mis. margin ${metrics.month_margin_pct ?? 0}%).
- Nada: hangat, jelas, memberi semangat tanpa menggurui.`
        // thinkingBudget:0 (disableThinking) mematikan mode "thinking" agar tidak
        // ikut memakan maxOutputTokens sehingga narasi terpotong di tengah.
        const r = await ai.generate({
          prompt: PROMPT,
          temperature: 0.3,
          maxOutputTokens: 700,
          disableThinking: true,
        })
        // Narasi yang terpotong (finishReason MAX_TOKENS) JANGAN ditampilkan —
        // biarkan jatuh ke template yang selalu berupa kalimat lengkap.
        // Bila diminta Inggris tapi Gemini tetap membalas Indonesia, buang juga.
        if (r.text && r.finishReason !== 'MAX_TOKENS' && !(isEn && looksIndonesian(r.text))) {
          content = r.text
          tele = telemetriDari(r, ai.route.key)
        } else {
          // Jawaban datang tapi dibuang (terpotong, atau bahasa yang salah).
          // Kuota TIDAK naik — perilaku lama yang benar dan tetap dipertahankan —
          // tapi tokennya sudah terbakar di Google. Kalau tidak dicatat di sini,
          // biaya ini tidak muncul di mana pun.
          tele = { ...telemetriDari(r, ai.route.key), wastedTokens: r.usage.total }
        }
      } catch (e) {
        // Template cadangan tetap dipakai — pengguna tidak boleh melihat
        // dashboard kosong hanya karena Gemini bermasalah. Tapi kegagalannya
        // WAJIB tercatat: menelan error di sini membuat pemadaman AI
        // 7-10 Agustus 2026 terlihat seperti dashboard yang sehat selama tiga
        // hari, karena satu-satunya gejalanya adalah narasi yang mendadak
        // terdengar kaku — sesuatu yang tidak muncul di grafik mana pun.
        aiError = payloadGagalAI(e).code
        console.error(`[ai-narasi] Gemini gagal, memakai template: ${String(e).slice(0, 300)}`)
      }
    }
    const usedAI = Boolean(content)
    // Penghitung kuota HANYA naik saat panggilan AI benar-benar menghasilkan narasi.
    if (usedAI) await commitQuota(supabase, ai.quotaFeature, 1, tele)
    // Jawaban datang tapi dibuang: kuota tidak naik (units=0), token tetap dicatat.
    else if (tele) await commitQuota(supabase, ai.quotaFeature, 0, tele)
    if (!content) {
      content = metrics.tx_count > 0
        ? (isEn ? templateNarrativeEn(metrics) : templateNarrative(metrics))
        : (isEn
          ? 'No transactions recorded yet. Start logging via the Transactions menu, the + Record button, or a receipt photo — a daily insight will appear here.'
          : 'Belum ada transaksi tercatat. Mulai catat lewat menu Transaksi, tombol + Catat, atau foto struk — insight harian akan muncul di sini.')
    }

    // Simpan cache (upsert per user per hari, terpisah per bahasa lewat "kind").
    try {
      await supabase.from('ai_insights').upsert({
        user_id: userData.user.id, insight_date: today, kind,
        content, payload: metrics,
      }, { onConflict: 'user_id,insight_date,kind' })
    } catch { /* cache gagal bukan masalah fatal */ }

    return json({ content, metrics, cached: false, ai: usedAI, aiError })
  } catch (e) {
    return json({ error: 'Terjadi kesalahan saat membuat insight.', detail: String(e).slice(0, 300) }, 500)
  }
})
