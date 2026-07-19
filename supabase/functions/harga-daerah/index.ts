// ============================================================
// Supabase Edge Function: harga-daerah
// Harga bahan pokok resmi PIHPS Bank Indonesia PER PROVINSI (id 1..34).
// Dipanggil saat pengguna memilih provinsi di Radar Harga:
//   - bila cache hari ini (commodity_prices, province_id=X) sudah ada
//     -> langsung kembalikan (tanpa memanggil PIHPS lagi);
//   - bila belum -> tarik dari endpoint publik resmi PIHPS, simpan, kembalikan.
// Wajib login (verify_jwt) — data yang ditulis hanya agregat publik.
// ============================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? ''
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// Sinkron dengan makro-harian.
const PIHPS_GROUP: Record<string, string> = {
  'Beras': 'beras',
  'Daging Ayam': 'ayam',
  'Daging Sapi': 'daging_sapi',
  'Telur Ayam': 'telur',
  'Bawang Merah': 'bawang_merah',
  'Bawang Putih': 'bawang_putih',
  'Cabai Merah': 'cabai_merah',
  'Cabai Rawit': 'cabai_rawit',
  'Minyak Goreng': 'minyak_goreng',
  'Gula Pasir': 'gula',
}
const PIHPS_UNIT: Record<string, string> = { minyak_goreng: 'Rp/liter' }

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

// Kunci "hari data" sama dengan makro-harian (batas 06.00 WIB).
const runKeyWIB = () => new Date(Date.now() + (7 - 6) * 3600 * 1000).toISOString().slice(0, 10)

async function fetchPihpsProvinsi(runKey: string, provinceId: number) {
  const start = new Date(new Date(runKey + 'T00:00:00Z').getTime() - 6 * 86400000).toISOString().slice(0, 10)
  const url = 'https://www.bi.go.id/hargapangan/WebSite/TabelHarga/GetGridDataDaerah'
    + `?price_type_id=1&comcat_id=&province_id=${provinceId}&regency_id=&market_id=&tipe_laporan=1&start_date=${start}&end_date=${runKey}`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20000)
  const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept': 'application/json' } })
  clearTimeout(t)
  if (!res.ok) return []
  const j = await res.json()
  const out: any[] = []
  let groupKey = ''
  for (const row of j?.data || []) {
    const name = String(row.name || '').trim()
    const isGroup = row.level === 1
    if (isGroup) groupKey = PIHPS_GROUP[name] || ''
    if (!groupKey || !name) continue
    const dates = Object.keys(row)
      .filter((k) => /^\d{2}\/\d{2}\/\d{4}$/.test(k))
      .map((k) => ({ k, d: k.slice(6) + '-' + k.slice(3, 5) + '-' + k.slice(0, 2) }))
      .sort((a, b) => (a.d < b.d ? -1 : 1))
    let price = 0, prev = 0, priceDate = ''
    for (const { k, d } of dates) {
      const v = Number(String(row[k] ?? '').replace(/[^\d]/g, ''))
      if (v > 0) { prev = price || v; price = v; priceDate = d }
    }
    if (price <= 0) continue
    out.push({
      run_date: runKey,
      commodity_key: groupKey,
      variant_name: name,
      is_group: isGroup,
      price,
      prev_price: prev && prev !== price ? prev : null,
      price_date: priceDate || null,
      unit: PIHPS_UNIT[groupKey] || 'Rp/kg',
      source_name: 'PIHPS Bank Indonesia',
      source_url: url,
      province_id: provinceId,
    })
  }
  return out
}

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsHeaders(origin)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    let provinceId = 0
    try { const b = await req.json(); provinceId = Math.round(Number(b?.province_id)) } catch { /* di bawah divalidasi */ }
    if (!Number.isInteger(provinceId) || provinceId < 1 || provinceId > 34) {
      return json({ error: 'Provinsi tidak dikenal.' }, 400)
    }

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
    const runKey = runKeyWIB()

    // Cache per provinsi per hari-data.
    const { data: cached } = await svc.from('commodity_prices')
      .select('*').eq('run_date', runKey).eq('province_id', provinceId)
    if (cached?.length) return json({ runDate: runKey, prices: cached })

    const rows = await fetchPihpsProvinsi(runKey, provinceId)
    if (rows.length) {
      await svc.from('commodity_prices').upsert(rows, { onConflict: 'run_date,variant_name,province_id' })
    }
    return json({ runDate: runKey, prices: rows })
  } catch (e) {
    return json({ error: 'Harga per provinsi sedang tidak dapat dimuat.', detail: String(e).slice(0, 200) }, 500)
  }
})
