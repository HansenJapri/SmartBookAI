// ============================================================
// Load test REST Supabase — daftar & simpan transaksi (§1.6).
//
// ⚠️  BELUM PERNAH DIJALANKAN. Skrip ini ditulis, bukan diverifikasi.
//     Menjalankannya membebani database SUNGGUHAN. Jalankan HANYA terhadap
//     proyek Supabase khusus uji, tidak pernah ke produksi.
//
// ⚠️  JANGAN load-test endpoint AI. Cap 10 panggilan/hari/workspace membuat
//     beban AI sudah dibatasi oleh desain; membanjirinya hanya menghabiskan
//     kuota dan menagih biaya Gemini tanpa memberi informasi baru (§1.6).
//     Yang perlu diuji beban justru jalur NON-AI: daftar transaksi, import,
//     laporan.
//
// Prasyarat:
//   1. Pasang k6 — https://k6.io/docs/get-started/installation/
//   2. Siapkan proyek Supabase UJI (bukan produksi) dan seed datanya:
//        npm run seed:uji
//   3. Ambil JWT akun uji (dari devtools setelah login, atau via API auth).
//
// Jalankan:
//   LOAD_TEST_CONFIRM=1 \
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_ANON_KEY=... \
//   SUPABASE_JWT=... \
//   WORKSPACE_ID=... \
//   k6 run --vus 20 --duration 60s load/rest-transaksi.js
//
// Bersihkan setelah selesai:
//   npm run seed:uji:bersih
// ============================================================
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

const URL = __ENV.SUPABASE_URL
const ANON = __ENV.SUPABASE_ANON_KEY
const JWT = __ENV.SUPABASE_JWT
const WORKSPACE = __ENV.WORKSPACE_ID

// Pagar keselamatan. Tanpa konfirmasi eksplisit, skrip menolak jalan —
// skrip beban yang tergeletak di repo dan tak sengaja diarahkan ke produksi
// adalah cara yang sangat mudah untuk merusak hari seseorang.
if (__ENV.LOAD_TEST_CONFIRM !== '1') {
  throw new Error(
    'Set LOAD_TEST_CONFIRM=1 untuk menjalankan. Pastikan SUPABASE_URL menunjuk '
    + 'proyek UJI, bukan produksi.',
  )
}
if (!URL || !ANON || !JWT) {
  throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY, dan SUPABASE_JWT wajib diisi.')
}

const gagalBaca = new Rate('gagal_baca')
const gagalTulis = new Rate('gagal_tulis')
const latensiDaftar = new Trend('latensi_daftar_transaksi', true)

// Ambang [TARGET] §1.6. Kalau terlampaui, k6 keluar dengan status gagal.
export const options = {
  thresholds: {
    'http_req_duration{operasi:daftar}': ['p(95)<1000'],
    'http_req_duration{operasi:simpan}': ['p(95)<1500'],
    http_req_failed: ['rate<0.01'],
    gagal_baca: ['rate<0.01'],
    gagal_tulis: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

const headers = {
  apikey: ANON,
  Authorization: `Bearer ${JWT}`,
  'Content-Type': 'application/json',
}

export default function () {
  // ---- Baca: daftar transaksi berhalaman, pola yang dipakai UI ----
  // RLS menambah predikat di setiap query; inilah yang sebenarnya diukur di
  // sini — apakah indeks (workspace_id, occurred_at) mendukungnya.
  const daftar = http.get(
    `${URL}/rest/v1/transactions`
    + '?select=id,amount,direction,category,occurred_at,description'
    + '&order=occurred_at.desc&limit=50',
    { headers, tags: { operasi: 'daftar' } },
  )
  latensiDaftar.add(daftar.timings.duration)
  gagalBaca.add(!check(daftar, {
    'daftar 200': (r) => r.status === 200,
    'daftar mengembalikan array': (r) => {
      try { return Array.isArray(r.json()) } catch { return false }
    },
  }))

  sleep(0.5)

  // ---- Baca: agregasi Dashboard (rentang periode) ----
  const sejak = new Date(Date.now() - 30 * 864e5).toISOString()
  const agregat = http.get(
    `${URL}/rest/v1/transactions?select=amount,direction&occurred_at=gte.${sejak}`,
    { headers, tags: { operasi: 'agregat' } },
  )
  gagalBaca.add(!check(agregat, { 'agregat 200': (r) => r.status === 200 }))

  sleep(0.5)

  // ---- Tulis: simpan satu transaksi ----
  // Ditandai deskripsi "[LOAD TEST]" supaya baris sisa mudah dibersihkan
  // kalau proses terhenti di tengah jalan.
  const simpan = http.post(
    `${URL}/rest/v1/transactions`,
    JSON.stringify({
      description: `[LOAD TEST] vu-${__VU} iter-${__ITER}`,
      amount: 10000,
      direction: 'out',
      category: 'Pengeluaran Lain',
      channel: 'manual',
      occurred_at: new Date().toISOString(),
      payment_status: 'lunas',
      ...(WORKSPACE ? { workspace_id: WORKSPACE } : {}),
    }),
    { headers: { ...headers, Prefer: 'return=minimal' }, tags: { operasi: 'simpan' } },
  )
  gagalTulis.add(!check(simpan, {
    'simpan 201': (r) => r.status === 201 || r.status === 200,
  }))

  sleep(1)
}

export function handleSummary(data) {
  const p95 = data.metrics['http_req_duration{operasi:daftar}']?.values?.['p(95)']
  return {
    stdout: '\n'
      + '─────────────────────────────────────────────\n'
      + `  p95 daftar transaksi : ${p95 ? `${Math.round(p95)} ms` : 'n/a'} (target < 1000 ms)\n`
      + `  Error rate           : ${((data.metrics.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2)}% (target < 1%)\n`
      + '─────────────────────────────────────────────\n'
      + '  Jangan lupa: npm run seed:uji:bersih\n\n',
  }
}
