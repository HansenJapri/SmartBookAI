// ============================================================
// Supabase Edge Function: ai-hpp-draft
// Membuat DRAF komposisi biaya (bahan/kemasan/energi/tenaga) untuk 1 unit
// produk memakai Gemini 2.5 Flash — pendekatan hybrid sesuai PRD:
// AI mengusulkan, PENGGUNA WAJIB mengoreksi & menyimpan sendiri.
// Fungsi ini TIDAK menulis ke database.
//
// Deploy: nama function "ai-hpp-draft".
// ============================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? ''
const MODEL = 'gemini-2.5-flash'

// Kunci komoditas — WAJIB sinkron dengan daftar di makro-harian & src/lib/hpp.js
const COMMODITY_KEYS = [
  'beras', 'terigu', 'gula', 'telur', 'ayam', 'daging_sapi', 'cabai', 'bawang_merah',
  'bawang_putih', 'minyak_goreng', 'kedelai', 'susu', 'kakao', 'kopi', 'lpg', 'bbm',
  'tekstil', 'kertas', 'deterjen', 'plastik',
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

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsHeaders(origin)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    if (!GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY belum diatur di server.' }, 501)

    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Harus masuk (login).' }, 401)
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
    })
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) return json({ error: 'Sesi tidak valid.' }, 401)

    const { data: allowed } = await supabase.rpc('bump_ai_usage', { p_kind: 'hpp', p_limit: 10 })
    if (allowed === false) return json({ error: 'Batas pembuatan draf HPP hari ini tercapai. Coba lagi besok, atau isi komposisi manual.' }, 429)

    const { productName, businessType, unit, sellPrice } = await req.json()
    if (!productName || typeof productName !== 'string') return json({ error: 'Nama produk kosong.' }, 400)

    const PROMPT = `Kamu konsultan biaya produksi UMKM Indonesia.
Buat DRAF komposisi biaya untuk MEMPRODUKSI/MENYEDIAKAN 1 ${String(unit || 'pcs').slice(0, 20)} produk:
- Nama produk: "${String(productName).slice(0, 120).replace(/"/g, "'")}"
- Jenis usaha: "${String(businessType || 'UMKM umum').slice(0, 120).replace(/"/g, "'")}"
${sellPrice ? `- Harga jual saat ini: Rp ${Math.round(Number(sellPrice) || 0)}` : ''}

Balas HANYA JSON dengan struktur PERSIS:
{
  "components": [
    {
      "name": string,                   // nama bahan/komponen, singkat
      "type": "bahan" | "kemasan" | "energi" | "tenaga" | "lainnya",
      "qty": number,                    // jumlah per 1 unit produk
      "unit": string,                   // gram, ml, butir, pcs, kwh, menit, dll
      "est_price_per_unit": number,     // perkiraan harga pasar Indonesia per 1 satuan, Rupiah (boleh desimal, mis. harga per gram)
      "commodity_key": string | null,   // salah satu dari daftar di bawah bila cocok, selain itu null
      "import_exposure": "tinggi" | "sedang" | "rendah"  // seberapa tergantung impor (kurs USD)
    }
  ],
  "note": string  // 1 kalimat catatan/asumsi penting
}

Daftar commodity_key yang boleh dipakai: ${JSON.stringify(COMMODITY_KEYS)}

ATURAN:
- Maksimal 12 komponen; fokus komponen yang berarti terhadap biaya.
- Harga = perkiraan wajar pasar Indonesia saat ini; total biaya semua komponen harus MASUK AKAL dibanding harga jual bila diberikan (HPP biasanya 40-75% harga jual).
- import_exposure: terigu/gandum tinggi (hampir seluruh gandum Indonesia impor), kedelai tinggi, bawang putih tinggi, susu bubuk & kakao olahan tinggi, gula sedang, sisanya nilai wajar.
- Ini DRAF kasar yang akan dikoreksi pengguna — konservatif lebih baik daripada presisi palsu.`

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: PROMPT }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 1536 },
        }),
      },
    )
    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      return json({ error: 'Layanan AI sedang tidak tersedia.', detail: errText.slice(0, 300) }, 502)
    }
    const data = await geminiRes.json()
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '{}'
    let parsed: any = {}
    try { parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}') } catch { parsed = {} }

    const comps = (Array.isArray(parsed.components) ? parsed.components : []).slice(0, 15).map((c: any) => ({
      name: String(c.name ?? '').slice(0, 80),
      type: ['bahan', 'kemasan', 'energi', 'tenaga', 'lainnya'].includes(c.type) ? c.type : 'bahan',
      qty: Math.max(0, Number(c.qty) || 0),
      unit: String(c.unit ?? 'pcs').slice(0, 20),
      est_price_per_unit: Math.max(0, Number(c.est_price_per_unit) || 0),
      commodity_key: COMMODITY_KEYS.includes(c.commodity_key) ? c.commodity_key : null,
      import_exposure: ['tinggi', 'sedang', 'rendah'].includes(c.import_exposure) ? c.import_exposure : 'rendah',
    })).filter((c: any) => c.name && c.qty > 0)

    return json({ components: comps, note: String(parsed.note || '').slice(0, 300) })
  } catch (e) {
    return json({ error: 'Terjadi kesalahan saat membuat draf.', detail: String(e).slice(0, 300) }, 500)
  }
})
