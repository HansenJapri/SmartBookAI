// ============================================================
// Supabase Edge Function: ai-struk  (deploy dengan nama: BukuPencatatanStruk)
// Membaca foto/PDF struk dengan Gemini (vision) dan mengembalikan data
// terstruktur: nama toko, tanggal, total, dan daftar item belanja.
//
// Keamanan: kunci dari Secret server; wajib login (JWT). Gambar TIDAK disimpan
// di server. (Catatan: pada paket gratis, isi gambar dapat dipakai penyedia AI
// untuk peningkatan model. Hal ini diungkap pada Kebijakan Privasi.)
//
// Deploy: Supabase Dashboard > Edge Functions > Deploy via Editor
//         Nama function: BukuPencatatanStruk  (secret GEMINI_API_KEY sudah project-wide)
// ============================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? ''
const VISION_MODEL = 'gemini-2.5-flash'

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

const PROMPT = `Kamu membaca STRUK belanja (foto atau PDF) milik pelaku UMKM Indonesia.
Ekstrak isinya menjadi JSON dengan struktur PERSIS:
{
  "merchant": string,            // nama toko/penjual, "" jika tidak jelas
  "date": string,                // tanggal pada struk format YYYY-MM-DD, "" jika tidak ada
  "total": number,               // total akhir yang dibayar (angka, tanpa titik/Rp)
  "items": [
    { "name": string, "qty": number, "unit": string, "unit_price": number, "total": number }
  ]
}
Aturan: angka tanpa pemisah ribuan dan tanpa "Rp". Bila satuan tak tertulis, isi "pcs".
Bila qty tak jelas, isi 1. Jangan menambah item yang tidak ada di struk. Balas HANYA JSON.`

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

    // Batas pembacaan struk harian per akun (kontrol biaya AI vision). Aman bila RPC belum dimigrasi.
    const { data: allowed } = await supabase.rpc('bump_ai_usage', { p_kind: 'struk', p_limit: 30 })
    if (allowed === false) return json({ error: 'Batas pembacaan struk harian tercapai. Silakan coba lagi besok.' }, 429)

    const { image, mimeType } = await req.json()
    if (!image || typeof image !== 'string') return json({ error: 'Gambar struk tidak ada.' }, 400)
    if (image.length > 9_000_000) return json({ error: 'Ukuran gambar terlalu besar. Gunakan foto yang lebih kecil.' }, 413)

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType: mimeType || 'image/jpeg', data: image } },
              { text: PROMPT },
            ],
          }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: 2048 },
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

    const items = Array.isArray(parsed.items) ? parsed.items.map((it: any) => ({
      name: String(it.name ?? '').slice(0, 120),
      qty: Number(it.qty) || 1,
      unit: String(it.unit ?? 'pcs').slice(0, 20),
      unit_price: Number(it.unit_price) || 0,
      total: Number(it.total) || 0,
    })) : []

    return json({
      merchant: String(parsed.merchant ?? '').slice(0, 120),
      date: String(parsed.date ?? '').slice(0, 10),
      total: Number(parsed.total) || items.reduce((s: number, i: any) => s + (i.total || 0), 0),
      items,
    })
  } catch (e) {
    return json({ error: 'Terjadi kesalahan saat membaca struk.', detail: String(e).slice(0, 300) }, 500)
  }
})
