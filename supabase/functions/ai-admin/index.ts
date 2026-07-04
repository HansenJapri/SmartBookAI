// ============================================================
// Supabase Edge Function: ai-admin  (deploy dengan nama: BukuPencatatanAdmin)
// Asisten AI untuk DASHBOARD ADMIN BukuPintar AI.
//
// Keamanan & privasi:
//   - Kunci GEMINI_API_KEY dari Secret server (tidak pernah ke browser).
//   - Memakai token login; hanya pemanggil yang TERVERIFIKASI ADMIN yang dilayani.
//   - Yang dikirim ke Gemini hanya METRIK AGREGAT platform (jumlah, total),
//     TIDAK ada data pribadi pengguna (nama, email, transaksi individual).
//   - Tidak menyimpan riwayat percakapan.
//
// Deploy:
//   Supabase Dashboard > Edge Functions > Deploy via Editor
//   Nama function: BukuPencatatanAdmin
//   Secret GEMINI_API_KEY sudah berlaku untuk seluruh project (tidak perlu diset ulang).
// ============================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ADMIN_ORIGIN = Deno.env.get('ADMIN_ORIGIN') ?? ''
const CHAT_MODEL = 'gemini-2.5-flash-lite'

const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://localhost:5174', ADMIN_ORIGIN].filter(Boolean)

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : (ALLOWED_ORIGINS[0] || '*')
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

const rupiah = (n: number) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID')

const SYSTEM = `Kamu adalah asisten untuk ADMIN platform pembukuan BukuPintar AI.
Tugasmu: membantu admin memahami metrik dan kesehatan platform berdasarkan ringkasan yang diberikan.

CARA MENJAWAB (wajib dipatuhi):
- Tulis dalam TEKS BIASA. DILARANG memakai format markdown: tidak boleh ada tanda bintang (*), pagar (#), atau tanda kutip kode. Jangan menebalkan teks.
- Jawab SINGKAT dan langsung ke inti.
- Jika memberi langkah, gunakan LANGKAH BERNOMOR yang jelas dan sebutkan menu yang dituju. Menu admin di sidebar kiri: Overview, Pengguna, Transaksi, Feedback, Analitik.
- Gunakan ANGKA hanya dari "Ringkasan metrik platform". Jangan mengarang; bila data tak ada, katakan jujur.
- Jangan menampilkan atau menebak data pribadi pengguna tertentu (nama, email, transaksi individu); kamu hanya punya angka agregat.`

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsHeaders(origin)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    if (!GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY belum diatur di server.' }, 501)

    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Harus masuk sebagai admin.' }, 401)

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) return json({ error: 'Sesi tidak valid.' }, 401)

    // Hanya admin yang boleh memakai asisten ini.
    const { data: isAdmin } = await supabase.rpc('is_admin')
    if (isAdmin !== true) return json({ error: 'Akses khusus admin.' }, 403)

    const { message, history } = await req.json()
    if (!message || typeof message !== 'string') return json({ error: 'Pesan kosong.' }, 400)
    if (message.length > 2000) return json({ error: 'Pesan terlalu panjang.' }, 400)

    // Metrik agregat platform (tanpa data pribadi).
    const { data: m } = await supabase.rpc('admin_metrics')
    const k = m || {}
    const summary = [
      `Total pengguna: ${k.total_users ?? 0} (baru 7 hari: ${k.new_users_7d ?? 0}, baru 30 hari: ${k.new_users_30d ?? 0})`,
      `Pengguna aktif: 7 hari ${k.active_users_7d ?? 0}, 30 hari ${k.active_users_30d ?? 0}`,
      `Total transaksi: ${k.total_transactions ?? 0}; total nilai: ${rupiah(k.total_volume)}; nilai 30 hari: ${rupiah(k.volume_30d)}`,
      `Power users (>= 10 transaksi): ${k.power_users ?? 0}`,
      `Total feedback: ${k.total_feedback ?? 0} (belum ditangani: ${k.feedback_open ?? 0})`,
      `Rata-rata rating: ${k.avg_rating ?? '-'} dari ${k.rating_count ?? 0} penilaian`,
      `Merasa terbantu: ya ${k.helped_yes ?? 0}, belum ${k.helped_no ?? 0}`,
    ].join('\n')

    const contents: any[] = []
    if (Array.isArray(history)) {
      for (const h of history.slice(-6)) {
        if (h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string') {
          contents.push({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(h.text).slice(0, 2000) }] })
        }
      }
    }
    contents.push({ role: 'user', parts: [{ text: `Ringkasan metrik platform:\n${summary}\n\nPertanyaan admin:\n${message}` }] })

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents,
          generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
        }),
      },
    )
    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      return json({ error: 'Layanan AI sedang tidak tersedia.', detail: errText.slice(0, 300) }, 502)
    }
    const data = await geminiRes.json()
    const reply = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? ''
    return json({ reply: reply || 'Maaf, saya belum bisa menjawab itu. Coba tanyakan dengan cara lain.' })
  } catch (e) {
    return json({ error: 'Terjadi kesalahan.', detail: String(e).slice(0, 300) }, 500)
  }
})
