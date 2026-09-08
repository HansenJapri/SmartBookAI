// ============================================================
// Supabase Edge Function: keepalive
//
// Dua tugas dalam satu panggilan, dijalankan pg_cron setiap <= 6 hari.
//
// TUGAS 1 — menahan proyek Supabase gratis dari jeda 7 hari.
//
// Yang perlu diluruskan lebih dulu: menulis baris ke Postgres dari pg_cron
// SAJA bukan jaminan. pg_cron berjalan DI DALAM database dan tidak melahirkan
// satu pun permintaan API, sedangkan "aktivitas" yang dihitung Supabase adalah
// permintaan yang masuk lewat gerbang proyek — REST, Auth, Storage, Edge
// Function. Cron yang hanya `insert into ...` bisa berjalan rajin selama tujuh
// hari sementara proyeknya tetap dijeda.
//
// Karena itu rantainya sengaja dibuat memutar:
//
//   pg_cron -> pg_net (HTTP keluar) -> Edge Function ini -> PostgREST -> Postgres
//
// Setiap anak panah adalah lapisan yang benar-benar dilewati permintaan, jadi
// yang tercatat bukan hanya "database masih hidup" melainkan "gerbang API
// proyek ini masih melayani permintaan". Ini pula yang tanpa sengaja menjaga
// proyek ini tetap ACTIVE selama ini: cron `makro-harian` kebetulan memakai
// pola yang sama. Dua proyek lain di akun yang sama — `dashboard-database` dan
// `Datasense AI` — tidak punya cron apa pun, dan keduanya sudah INACTIVE.
//
// TUGAS 2 — rekam medis berkala.
//
// Detak yang hanya menulis "saya hidup" menjawab pertanyaan yang paling tidak
// menarik. Setiap detak juga memeriksa hal-hal yang benar-benar pernah rusak
// diam-diam: apakah ketiga kunci Gemini masih diterima Google, kapan terakhir
// pipeline makro benar-benar mendapat jawaban AI, seberapa basi harga SP2KP
// dan kurs. Hasilnya disimpan sebagai riwayat, sehingga pertanyaan "sejak
// kapan ini rusak?" — yang bulan lalu perlu penggalian log berjam-jam untuk
// dijawab — menjadi satu kueri.
//
// Deploy: supabase functions deploy keepalive
// Secret: KEEPALIVE_TOKEN (>= 24 karakter acak)
// ============================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, originDitolak } from '../_shared/cors.ts'
import { diagnosaLengkap } from '../_shared/ai/diagnosa.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/** Perbandingan waktu-tetap: lama balasan tidak boleh membocorkan awalan token. */
function samaWaktuTetap(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let beda = 0
  for (let i = 0; i < a.length; i++) beda |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return beda === 0
}

/** Selisih hari dari sebuah tanggal/timestamp ke sekarang. null bila tak ada. */
function umurHari(nilai: unknown): number | null {
  if (!nilai) return null
  const t = Date.parse(String(nilai))
  if (!Number.isFinite(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsHeaders(origin)
  if (req.method === 'OPTIONS') {
    originDitolak(origin, 'keepalive')
    return new Response('ok', { headers: cors })
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // verify_jwt = false karena pemanggilnya pg_cron, yang tidak punya sesi.
  // Gantinya token bersama, diterima dari DUA sumber:
  //
  //   1. tabel service_config — dipakai pg_cron. Nilainya dibuat DI DALAM
  //      Postgres (gen_random_bytes) dan tidak pernah keluar dari sana: perintah
  //      cron membacanya lewat panggil_keepalive(), bukan menempelkannya sebagai
  //      teks di cron.job.command. Rahasia yang tertulis di definisi cron akan
  //      ikut terbawa setiap kali seseorang membaca jadwal, mengekspornya, atau
  //      menempelkannya ke tiket.
  //   2. secret KEEPALIVE_TOKEN — untuk pemakaian manual & pemantau luar, yang
  //      memang tidak punya akses ke database.
  //
  // Keduanya diperiksa dengan perbandingan waktu-tetap, dan keduanya boleh
  // kosong secara independen.
  const kiriman = req.headers.get('x-keepalive-token') ?? ''
  const tokenEnv = Deno.env.get('KEEPALIVE_TOKEN') ?? ''

  let tokenDb = ''
  try {
    const { data } = await svc.from('service_config').select('nilai').eq('kunci', 'keepalive_token').maybeSingle()
    tokenDb = String(data?.nilai ?? '')
  } catch { /* tabel belum ada: jatuh ke token env saja */ }

  const cocok = (harapan: string) => harapan.length >= 24 && samaWaktuTetap(harapan, kiriman)
  if (!cocok(tokenDb) && !cocok(tokenEnv)) {
    if (tokenDb.length < 24 && tokenEnv.length < 24) {
      console.error('[keepalive] tidak ada token sah (service_config maupun KEEPALIVE_TOKEN). Semua permintaan ditolak.')
      return json({ error: 'keepalive belum dikonfigurasi di server.' }, 503)
    }
    return json({ error: 'Token keepalive tidak cocok.' }, 401)
  }

  try {
    const sumber = new URL(req.url).searchParams.get('sumber') ?? 'cron-6-hari'

    // ---------- 1) Rekam medis dari database ----------
    const { data: kesehatanDb, error: errRingkas } = await svc.rpc('ringkasan_kesehatan')
    const ringkas = (kesehatanDb ?? {}) as Record<string, unknown>

    // ---------- 2) Rekam medis kunci AI ----------
    // Inilah pemeriksaan yang, kalau ada sebulan lalu, akan menemukan kunci
    // yang dicabut pada hari pertama alih-alih pada hari ke-32.
    let kunci: Record<string, unknown>
    try {
      const d = await diagnosaLengkap()
      kunci = {
        slot: d.slot.map((s) => ({
          slot: s.slot,
          sumber: s.sumber,
          sidikJari: s.sidikJari,   // sidik jari, BUKAN kuncinya
          diterima: s.uji?.diterima ?? false,
          http: s.uji?.httpStatus ?? null,
          sebab: s.uji?.diterima ? null : (s.uji?.sebab ?? 'slot kosong'),
        })),
        ruteMati: d.rute
          .filter((r) => r.modelHidup === false && r.fallbackHidup !== true)
          .map((r) => `${r.fitur}:${r.model}`),
      }
    } catch (e) {
      kunci = { error: String(e).slice(0, 200) }
    }

    const slotSemua = (kunci.slot ?? []) as Array<{ diterima: boolean }>
    const slotHidup = slotSemua.filter((s) => s.diterima).length

    // ---------- 3) Penilaian sehat / tidak ----------
    //
    // Ambangnya longgar dengan sengaja. Detak ini berjalan tiap 6 hari, jadi
    // ia bukan alat untuk menangkap gangguan satu jam — ia alat untuk menangkap
    // kerusakan yang MENETAP, jenis yang bulan lalu bertahan 32 hari.
    const hariSejakAiOk = Number(ringkas.makro_hari_sejak_ai_ok ?? 999)
    const umurHarga = umurHari(ringkas.harga_price_date_terakhir)
    const umurKurs = umurHari(ringkas.kurs_tanggal_terakhir)

    const masalah: string[] = []
    if (errRingkas) masalah.push(`ringkasan_kesehatan gagal: ${errRingkas.message}`)
    if (slotHidup < slotSemua.length) {
      masalah.push(`${slotSemua.length - slotHidup} dari ${slotSemua.length} slot kunci Gemini DITOLAK Google`)
    }
    if ((kunci.ruteMati as string[] | undefined)?.length) {
      masalah.push(`rute tanpa model hidup: ${(kunci.ruteMati as string[]).join(', ')}`)
    }
    if (!Number.isFinite(hariSejakAiOk) || hariSejakAiOk > 2) {
      masalah.push(`sinyal AI makro terakhir berhasil ${hariSejakAiOk} hari lalu`)
    }
    if (umurHarga === null || umurHarga > 4) masalah.push(`harga SP2KP basi (${umurHarga} hari)`)
    if (umurKurs === null || umurKurs > 4) masalah.push(`kurs basi (${umurKurs} hari)`)

    const sehat = masalah.length === 0

    // ---------- 4) Tulis detaknya ----------
    // Inilah permintaan yang benar-benar menyentuh PostgREST + Postgres, dan
    // karenanya inilah yang dihitung sebagai aktivitas proyek.
    const { data: baris, error: errTulis } = await svc
      .from('service_heartbeat')
      .insert({
        sumber,
        sehat,
        kesehatan: { db: ringkas, kunci_ai: kunci },
        catatan: sehat ? 'Semua pemeriksaan lolos.' : masalah.join('; ').slice(0, 1000),
      })
      .select('id, beat_at')
      .single()

    if (errTulis) {
      console.error(`[keepalive] GAGAL menulis heartbeat: ${errTulis.message}`)
      return json({ ok: false, error: 'Gagal menulis heartbeat.', detail: errTulis.message }, 500)
    }

    // Pangkas riwayat lama sesekali (~1 dari 10 detak) — cukup untuk tabel yang
    // hanya tumbuh ~61 baris/tahun, dan tidak menambah beban tiap panggilan.
    if (Math.random() < 0.1) await svc.rpc('pangkas_heartbeat')

    if (!sehat) console.error(`[keepalive] TIDAK SEHAT: ${masalah.join('; ')}`)

    // Status HTTP ikut menyuarakan hasil, supaya pemantau luar tidak perlu
    // mem-parse JSON untuk tahu ada yang salah.
    return json({
      ok: true,
      heartbeat_id: baris?.id ?? null,
      beat_at: baris?.beat_at ?? null,
      sehat,
      masalah,
      kesehatan: { db: ringkas, kunci_ai: kunci },
    }, sehat ? 200 : 503)
  } catch (e) {
    console.error(`[keepalive] error: ${String(e).slice(0, 300)}`)
    return json({ ok: false, error: 'keepalive gagal.', detail: String(e).slice(0, 300) }, 500)
  }
})
