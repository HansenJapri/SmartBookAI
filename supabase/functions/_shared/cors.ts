// ============================================================
// CORS bersama untuk SELURUH Edge Function — SUMBER KEBENARAN TUNGGAL.
//
// Sebelum berkas ini, sebelas Edge Function menyalin blok yang sama persis:
//
//   const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://localhost:5174', APP_ORIGIN]
//   const allow = origin && ALLOWED_ORIGINS.includes(origin)
//     ? origin
//     : (ALLOWED_ORIGINS[0] || '*')
//
// Baris terakhir itu yang mematikan aplikasi di produksi selama berminggu-minggu.
// Ketika origin TIDAK dikenal, server tetap membalas 200 — tetapi dengan
// `Access-Control-Allow-Origin: http://localhost:5173`. Browser membandingkan
// nilai itu dengan origin sesungguhnya, tidak cocok, lalu MEMBUANG respons
// secara diam-diam dan tidak pernah mengirim POST-nya.
//
// Akibatnya sebuah pemadaman total yang tidak meninggalkan jejak di mana pun:
//   - log Supabase hanya memperlihatkan `OPTIONS | 200` tanpa POST susulan,
//   - tidak ada error 4xx/5xx yang bisa dicari,
//   - Edge Function tidak pernah dijalankan sehingga tidak ada log fungsi,
//   - di layar pengguna hanya "gagal memuat" tanpa sebab.
//
// Terverifikasi 8 September 2026: aplikasi dipakai dari domain kustom
// `https://smartbookai.id`, sedangkan secret APP_ORIGIN berisi
// `https://smart-book-ai.vercel.app`. Seluruh fitur AI dan harga Radar mati
// dari sisi pengguna, padahal SETIAP komponen di server sehat — SP2KP membalas
// data hari itu juga, dan `harga-daerah` mengembalikan 42 komoditas dalam 3
// detik saat dipanggil dengan curl (yang tidak tunduk pada CORS).
//
// Dua keputusan di berkas ini adalah jawaban langsung atas kejadian itu:
//
// 1. Origin yang TIDAK diizinkan tidak mendapat header Allow-Origin sama
//    sekali. Browser tetap menolak — memang harus — tapi sekarang ia menolak
//    dengan pesan yang menyebut sebabnya, dan `originDitolak()` mencatatnya ke
//    log fungsi. Kegagalan yang bisa dibaca jauh lebih murah daripada
//    kegagalan yang benar secara status HTTP.
//
// 2. Domain produksi ditulis di KODE, bukan hanya bergantung pada secret.
//    Domain yang hanya hidup di secret berarti satu perubahan yang tidak
//    tercatat di repo (memasang domain kustom, mengganti alias Vercel) bisa
//    mematikan seluruh aplikasi tanpa satu baris kode pun berubah — dan itulah
//    yang terjadi. APP_ORIGIN tetap dibaca dan tetap menambah, jadi domain
//    baru bisa dipasang tanpa deploy ulang; ia hanya tidak lagi menjadi
//    SATU-SATUNYA yang menahan aplikasi tetap hidup.
// ============================================================

/**
 * Domain produksi yang sudah pasti. Ditulis di sini supaya ter-versi di repo
 * dan ikut ter-review, bukan hanya ada di dashboard.
 */
const ORIGIN_PRODUKSI = [
  'https://smartbookai.id',
  'https://www.smartbookai.id',
  'https://smart-book-ai.vercel.app',
]

/**
 * Origin tambahan dari secret. Menerima satu nilai maupun daftar dipisah koma,
 * supaya memasang domain baru cukup mengubah secret tanpa deploy ulang.
 */
function originDariEnv(namaEnv: string): string[] {
  return (Deno.env.get(namaEnv) ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, '')) // buang garis miring di ekor
    .filter(Boolean)
}

/**
 * Dev lokal pada PORT BERAPA PUN, termasuk 127.0.0.1.
 *
 * Daftar lama memaku 5173 dan 5174. Vite menaikkan port sendiri begitu port
 * sebelumnya terpakai, jadi dev server ketiga (5175) sudah cukup membuat
 * seluruh fitur AI mati di mesin developer — kegagalan yang tampak seperti bug
 * aplikasi padahal hanya nomor port. `npm run preview` (4173) juga tidak pernah
 * masuk daftar, sehingga build produksi tidak pernah bisa diuji lokal.
 */
const POLA_LOKAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/

/**
 * Deployment preview Vercel milik proyek ini.
 *
 * Setiap push menghasilkan URL baru yang tidak mungkin didaftarkan satu per
 * satu. Polanya dijaga tetap sempit — harus diakhiri `.vercel.app` dan diawali
 * nama proyek — supaya bukan izin terbuka untuk seluruh vercel.app.
 */
const POLA_PREVIEW_VERCEL = /^https:\/\/smart-book-[a-z0-9-]*\.vercel\.app$/

export function daftarOriginDiizinkan(namaEnv = 'APP_ORIGIN'): string[] {
  return [...new Set([...ORIGIN_PRODUKSI, ...originDariEnv(namaEnv)])]
}

export function originDiizinkan(origin: string | null, namaEnv = 'APP_ORIGIN'): boolean {
  if (!origin) return false
  const bersih = origin.replace(/\/+$/, '')
  return daftarOriginDiizinkan(namaEnv).includes(bersih)
    || POLA_LOKAL.test(bersih)
    || POLA_PREVIEW_VERCEL.test(bersih)
}

/**
 * Header CORS untuk satu permintaan.
 *
 * Origin tak dikenal SENGAJA tidak mendapat Allow-Origin. Membalas dengan
 * origin lain (perilaku lama) membuat browser menolak tanpa alasan yang bisa
 * dibaca siapa pun; tanpa header, pesan browser langsung menyebut CORS.
 *
 * Permintaan TANPA header Origin (pg_cron/pg_net, curl, server-ke-server)
 * bukan permintaan browser sehingga tidak tunduk pada CORS sama sekali — tidak
 * ada header yang perlu ditambahkan, dan ketiadaannya tidak menghalangi apa pun.
 */
export function corsHeaders(origin: string | null, namaEnv = 'APP_ORIGIN'): Record<string, string> {
  const dasar: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // Preflight di-cache 24 jam: satu OPTIONS per origin per hari, bukan satu
    // per panggilan. Ini memotong separuh perjalanan jaringan setiap fitur AI.
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
  if (origin && originDiizinkan(origin, namaEnv)) {
    dasar['Access-Control-Allow-Origin'] = origin.replace(/\/+$/, '')
  }
  return dasar
}

/**
 * Catat origin yang ditolak ke log fungsi.
 *
 * Panggil ini di jalur OPTIONS. Inilah satu-satunya jejak yang akan ada ketika
 * domain baru dipasang dan lupa didaftarkan — tanpa baris ini, gejalanya lagi-
 * lagi hanya "aplikasi tidak jalan" tanpa satu pun petunjuk di log.
 */
export function originDitolak(origin: string | null, namaFungsi: string, namaEnv = 'APP_ORIGIN'): void {
  if (origin && !originDiizinkan(origin, namaEnv)) {
    console.error(
      `[cors:${namaFungsi}] origin DITOLAK: ${origin}. `
      + `Diizinkan: ${daftarOriginDiizinkan(namaEnv).join(', ')} + localhost/127.0.0.1:* + preview Vercel. `
      + `Tambahkan domain ini ke secret ${namaEnv} (boleh dipisah koma) atau ke ORIGIN_PRODUKSI di _shared/cors.ts.`,
    )
  }
}

/** Jawaban preflight standar. Kembalikan null bila metodenya bukan OPTIONS. */
export function balasPreflight(req: Request, namaFungsi: string, namaEnv = 'APP_ORIGIN'): Response | null {
  if (req.method !== 'OPTIONS') return null
  const origin = req.headers.get('Origin')
  originDitolak(origin, namaFungsi, namaEnv)
  return new Response('ok', { headers: corsHeaders(origin, namaEnv) })
}
