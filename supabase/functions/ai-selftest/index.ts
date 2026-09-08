// ============================================================
// Supabase Edge Function: ai-selftest
// Pemeriksa kesehatan layanan AI — HANYA untuk admin platform.
//
// Menjawab, dalam satu panggilan, tiga pertanyaan yang selama pemadaman
// 8 Agustus – 8 September 2026 hanya bisa dijawab dengan menebak:
//   1. Slot kunci mana (A/B/C) yang benar-benar terisi, dan dari env mana?
//   2. Apakah Google masih menerima kunci itu — kalau tidak, karena apa?
//   3. Apakah SETIAP model di FEATURE_ROUTES masih dilayani kunci slotnya?
//
// TIDAK PERNAH mengembalikan nilai kunci — hanya sidik jari SHA-256 terpotong
// (lihat ../_shared/ai/diagnosa.ts). Sidik jari cukup untuk membandingkan dua
// slot atau memastikan kunci sudah benar-benar berganti setelah rotasi, tapi
// tidak bisa dibalik menjadi kuncinya.
//
// Memakai ListModels, bukan generateContent, sehingga pemeriksaan ini tidak
// memakan satu pun jatah kuota harian yang sedang diperiksa.
//
// Deploy: supabase functions deploy ai-selftest
// ============================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, originDitolak } from '../_shared/cors.ts'
import { diagnosaLengkap } from '../_shared/ai/diagnosa.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

/**
 * Perbandingan string waktu-tetap.
 *
 * `a === b` berhenti pada karakter pertama yang berbeda, sehingga lamanya
 * balasan ikut memberitahu berapa banyak awalan yang sudah benar. Untuk token
 * yang bisa dicoba berulang kali dari luar, itu cukup untuk menebaknya
 * karakter demi karakter.
 */
function samaWaktuTetap(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let beda = 0
  for (let i = 0; i < a.length; i++) beda |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return beda === 0
}

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsHeaders(origin)
  if (req.method === 'OPTIONS') {
    originDitolak(origin, 'ai-selftest')
    return new Response('ok', { headers: cors })
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    // ---------- Gerbang 1: token pemantauan (opsional) ----------
    //
    // Pemadaman kemarin baru ketahuan dari keluhan pengguna, bukan dari grafik.
    // Agar pemantauan otomatis (uptime checker, cron, skrip rilis) bisa
    // memeriksa kesehatan AI, ada jalur kedua: header x-selftest-token yang
    // dicocokkan dengan secret SELFTEST_TOKEN. Pemantau tidak punya — dan tidak
    // boleh punya — sesi admin.
    //
    // Perbandingannya dibuat waktu-tetap supaya lamanya balasan tidak
    // membocorkan berapa banyak karakter awal token yang sudah benar.
    // Kalau SELFTEST_TOKEN tidak diatur, jalur ini mati total dan hanya admin
    // yang bisa masuk.
    const tokenPemantau = Deno.env.get('SELFTEST_TOKEN') ?? ''
    const tokenDikirim = req.headers.get('x-selftest-token') ?? ''
    const lewatToken = tokenPemantau.length >= 24 && samaWaktuTetap(tokenPemantau, tokenDikirim)

    // ---------- Gerbang 2: admin ----------
    // Diagnosa ini memaparkan bentuk konfigurasi server (slot mana yang terisi,
    // model mana yang dipakai) — bukan rahasia, tapi juga bukan sesuatu yang
    // perlu dilihat pemilik warung mana pun.
    if (!lewatToken) {
      const authHeader = req.headers.get('Authorization') || ''
      if (!authHeader.startsWith('Bearer ')) return json({ error: 'Harus masuk sebagai admin.' }, 401)

      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      })
      const { data: userData } = await supabase.auth.getUser()
      if (!userData?.user) return json({ error: 'Sesi tidak valid.' }, 401)

      const { data: isAdmin } = await supabase.rpc('is_admin')
      if (isAdmin !== true) return json({ error: 'Akses khusus admin.' }, 403)
    }

    const hasil = await diagnosaLengkap()

    // Status HTTP ikut menyuarakan hasilnya, supaya pemantauan luar (uptime
    // checker, cron) bisa memakai fungsi ini tanpa mem-parse isi JSON-nya.
    const adaSlotHidup = hasil.slot.some((s) => s.uji?.diterima)
    return json(hasil, adaSlotHidup ? 200 : 503)
  } catch (e) {
    return json({ error: 'Diagnosa gagal dijalankan.', detail: String(e).slice(0, 300) }, 500)
  }
})
