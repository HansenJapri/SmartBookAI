// ============================================================
// Supabase Edge Function: harga-daerah
// Harga BARANG KEBUTUHAN POKOK (bapok) resmi SP2KP Kemendag.
//   province_id = 0  -> harga nasional tertimbang (HNT) semua bapok
//   province_id = 1..34 -> harga rata-rata provinsi tsb (dicocokkan via NAMA)
// Sumber: https://sp2kp.kemendag.go.id (API publik api-sp2kp.kemendag.go.id).
// HANYA tipe_komoditas_id=1 (bapok) — HET/HA tidak diambil.
//
// Cache: commodity_prices per (run_date, province_id) per hari-data (06.00 WIB).
// Logika SP2KP ada di ../_shared/sp2kp.ts (cermin src/lib/sp2kp.js, teruji unit).
// ============================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildNational, buildProvince, fetchLatestTanggal } from '../_shared/sp2kp.ts'
import { corsHeaders, originDitolak } from '../_shared/cors.ts'
import { catatErrorServer } from '../_shared/log-error.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const runKeyWIB = () => new Date(Date.now() + (7 - 6) * 3600 * 1000).toISOString().slice(0, 10)

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsHeaders(origin)
  if (req.method === 'OPTIONS') {
    originDitolak(origin, 'harga-daerah')
    return new Response('ok', { headers: cors })
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    let provinceId = 0
    try { const b = await req.json(); provinceId = Math.round(Number(b?.province_id) || 0) } catch { /* default 0 */ }
    if (!Number.isInteger(provinceId) || provinceId < 0 || provinceId > 34) {
      return json({ error: 'Provinsi tidak dikenal.' }, 400)
    }

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
    const runKey = runKeyWIB()

    // Tanggal data bapok terkini menurut SP2KP (1 panggilan murah).
    const liveTanggal = await fetchLatestTanggal()

    // Cache per (hari-data, provinsi) — HANYA baris SP2KP. Baris legacy (PIHPS /
    // harga RAG media) SENGAJA diabaikan agar tak pernah tampil di Radar.
    const { data: cached } = await svc.from('commodity_prices')
      .select('*').eq('run_date', runKey).eq('province_id', provinceId)
      .eq('source_name', 'SP2KP Kemendag')

    // Cache SAH hanya bila price_date-nya == tanggal terkini SP2KP. Begitu SP2KP
    // maju tanggal (mis. rilis harian telat melewati jam 6 pagi), snapshot lama
    // otomatis ditarik ulang → Radar TAK PERNAH menampilkan angka tanggal usang.
    // Bila SP2KP tak terjangkau (liveTanggal=''), sajikan cache apa adanya.
    if (cached?.length && (!liveTanggal || String(cached[0].price_date) === liveTanggal)) {
      return json({ runDate: runKey, prices: cached })
    }

    const rows = provinceId === 0 ? await buildNational(runKey) : await buildProvince(runKey, provinceId)
    if (rows.length) {
      await svc.from('commodity_prices').upsert(rows, { onConflict: 'run_date,variant_name,province_id' })
      return json({ runDate: runKey, prices: rows })
    }
    // Tarik ulang gagal & tak ada cache yang cocok: sajikan cache lama bila ada.
    if (cached?.length) return json({ runDate: runKey, prices: cached })
    return json({ error: 'Harga bahan pokok sedang tidak dapat dimuat.' }, 503)
  } catch (e) {
    await catatErrorServer({
      fitur: 'Radar Harga',
      aksi: 'menarik harga bahan pokok SP2KP',
      error: e,
      tingkat: 'error',
    })
    return json({ error: 'Harga bahan pokok sedang tidak dapat dimuat.', detail: String(e).slice(0, 200) }, 500)
  }
})
