import { catatError } from './errorLog'

// ============================================================
// Pemantauan error klien — kini MENERUSKAN ke pipeline `error_logs`.
//
// Versi sebelumnya menulis ke `app_events` bertipe 'client_error' dengan tiga
// batasan yang membuatnya nyaris tidak berguna saat benar-benar dibutuhkan:
//
//   1. `if (!user) return` — error yang terjadi SEBELUM login tidak pernah
//      tercatat sama sekali. Padahal layar Masuk & Daftar adalah tempat orang
//      paling mungkin berhenti memakai aplikasi, dan kegagalan CORS pada
//      8 September 2026 justru memukul seluruh jalur itu.
//   2. Semuanya masuk ke satu kolom `meta` jsonb tanpa fitur/aksi/tingkat,
//      jadi pertanyaan "fitur mana yang paling sering rusak?" tidak bisa
//      dijawab tanpa memindai seluruh tabel.
//   3. Dedupe hanya di dalam satu sesi browser. Bug yang menimpa 50 pengguna
//      tampak sebagai 50 kejadian terpisah yang tidak pernah dihubungkan.
//
// Berkas ini SENGAJA dipertahankan sebagai lapis kompatibilitas alih-alih
// dihapus: `logClientError` dan `initMonitoring` sudah dipanggil dari
// ErrorBoundary dan main.jsx. Membuat pipeline kedua di sebelahnya berarti dua
// tempat mencatat error dan tidak ada yang memuat keseluruhannya — cara
// tercepat kehilangan jejak justru setelah bersusah payah membangunnya.
// ============================================================

/**
 * Kompatibel dengan pemanggil lama: logClientError(kind, message, extra).
 *
 * `kind` diterjemahkan menjadi nama fitur yang dikenal pengguna. Yang membaca
 * tab Log Error adalah pemilik produk; "react.render" tidak memberitahunya
 * apa pun tentang bagian mana dari aplikasinya yang sedang rusak.
 */
const FITUR_DARI_KIND = {
  'react.render': 'Render halaman',
  'window.error': 'Global (tak tertangani)',
  'unhandledrejection': 'Global (promise ditolak)',
}

export async function logClientError(kind, message, extra = {}) {
  const { stack, ...sisa } = extra || {}
  await catatError({
    fitur: FITUR_DARI_KIND[kind] || kind || 'tidak diketahui',
    aksi: kind === 'react.render' ? 'merender komponen' : null,
    error: stack ? Object.assign(new Error(String(message || '')), { stack }) : message,
    tingkat: 'fatal',
    konteks: sisa,
  })
}

export function initMonitoring() {
  if (typeof window === 'undefined' || window.__monitoringTerpasang) return
  window.__monitoringTerpasang = true

  window.addEventListener('error', (e) => {
    catatError({
      fitur: 'Global (tak tertangani)',
      aksi: 'render/eksekusi skrip',
      error: e?.error || e?.message,
      tingkat: 'fatal',
      konteks: { berkas: e?.filename || null, baris: e?.lineno || null },
    })
  })

  window.addEventListener('unhandledrejection', (e) => {
    catatError({
      fitur: 'Global (promise ditolak)',
      aksi: 'operasi asinkron tanpa penangan',
      error: e?.reason,
      tingkat: 'fatal',
    })
  })
}
