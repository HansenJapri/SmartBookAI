import { supabase } from './supabase'

// ============================================================
// Pencatat error ke tabel `error_logs` — dibaca tab "Log Error" admin.
//
// KENAPA ADA: sepanjang Agustus–September 2026 setiap kegagalan di sistem ini
// ditemukan oleh PENGGUNA, bukan pemiliknya. Kunci Gemini yang dicabut butuh
// 32 hari untuk ketahuan. CORS yang memblokir seluruh Edge Function baru
// terungkap setelah ada yang mengeluh. Tanggal jatuh tempo yang ditolak
// diam-diam butuh tangkapan layar.
//
// Ketiganya meninggalkan jejak — di log Supabase, di konsol browser — tetapi
// jejak yang tidak pernah dibuka sama saja dengan tidak ada.
//
// DUA ATURAN KERAS di berkas ini:
//
//   1. TIDAK PERNAH MELEMPAR. Pencatat error yang bisa gagal akan menjatuhkan
//      alur yang sedang menanganinya, dan mengubah satu error jadi dua.
//      Setiap jalur di sini dibungkus try/catch yang menelan.
//
//   2. TIDAK PERNAH MENGIRIM ISI DATA PENGGUNA. `konteks` hanya boleh memuat
//      bentuk & besaran (nama field, jenis entitas, panjang), bukan nominal
//      transaksi, nama pelanggan, atau isi pesan. Log yang membocorkan data
//      adalah masalah baru, bukan alat menyelesaikan masalah lama.
// ============================================================

/**
 * Normalisasi pesan sebelum dijadikan sidik jari.
 *
 * Tanpa ini, satu bug yang sama melahirkan ratusan baris berbeda hanya karena
 * UUID, nominal, dan timestamp di dalam pesannya berbeda-beda — dan tabelnya
 * berubah dari alat menjadi kebisingan.
 */
function normalkan(pesan) {
  return String(pesan || '')
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
    .replace(/\b\d[\d.,]*\b/g, '<n>')
    .replace(/["'`].*?["'`]/g, '<s>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

/** Sidik jari pendek & stabil (djb2). Cukup untuk menggabungkan, bukan kripto. */
function sidikJari(bagian) {
  const s = bagian.filter(Boolean).join('|')
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `${(h >>> 0).toString(36)}`
}

/**
 * Peredam sisi klien.
 *
 * Error di dalam render loop bisa terpanggil puluhan kali per detik. Server
 * sudah menggabungkannya lewat `sidik`, tapi mengirim 300 permintaan HTTP untuk
 * satu bug tetap membebani jaringan pengguna yang sedang bermasalah — persis
 * saat aplikasinya paling tidak boleh terasa berat.
 */
const TERAKHIR = new Map()
const JEDA_MS = 30_000

function terlaluSering(sidik) {
  const now = Date.now()
  const lalu = TERAKHIR.get(sidik)
  if (lalu && now - lalu < JEDA_MS) return true
  TERAKHIR.set(sidik, now)
  // Jaga peta tetap kecil pada sesi yang sangat panjang.
  if (TERAKHIR.size > 200) {
    for (const [k, t] of TERAKHIR) if (now - t > JEDA_MS) TERAKHIR.delete(k)
  }
  return false
}

function pesanDari(err) {
  if (!err) return 'Error tanpa pesan'
  if (typeof err === 'string') return err
  return err.message || String(err)
}

function kodeDari(err, kode) {
  if (kode) return String(kode)
  if (err && typeof err === 'object') return err.code || err.status || null
  return null
}

/**
 * Catat satu error. Aman dipanggil dari mana saja, termasuk dari dalam catch
 * yang sedang menangani error lain.
 *
 * @param {object} o
 * @param {string} o.fitur   Nama fitur SEPERTI YANG DIKENAL PENGGUNA ("Radar Harga",
 *                           "AI Catat", "Simulasi HPP") — bukan nama berkas.
 *                           Yang membaca tabel ini pemilik produk, bukan hanya developer.
 * @param {string} [o.aksi]  Yang sedang dilakukan ("menyimpan transaksi piutang").
 * @param {any}    o.error   Error/Response/string.
 * @param {string} [o.kode]
 * @param {'error'|'fatal'|'warn'} [o.tingkat]
 * @param {object} [o.konteks] HANYA bentuk & besaran. Jangan isi data pengguna.
 */
export async function catatError({ fitur, aksi, error, kode, tingkat = 'error', konteks = {} }) {
  try {
    const pesan = pesanDari(error)
    if (!pesan) return

    const k = kodeDari(error, kode)
    const halaman = typeof window !== 'undefined' ? window.location?.pathname : null
    const sidik = sidikJari(['fe', fitur, k, normalkan(pesan)])
    if (terlaluSering(sidik)) return

    await supabase.rpc('catat_error', {
      p_sidik: sidik,
      p_pesan: pesan.slice(0, 2000),
      p_sumber: 'frontend',
      p_fitur: fitur || 'tidak diketahui',
      p_aksi: aksi || null,
      p_kode: k ? String(k).slice(0, 60) : null,
      p_tingkat: tingkat,
      p_halaman: halaman,
      p_jejak: (error && error.stack ? String(error.stack) : '').slice(0, 4000) || null,
      p_konteks: konteks && typeof konteks === 'object' ? konteks : {},
      p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    })
  } catch {
    // Sengaja bisu. Lihat aturan 1 di kepala berkas: pencatat yang bisa gagal
    // akan menjatuhkan alur yang sedang menanganinya.
  }
}

// Penangkap global TIDAK dipasang di berkas ini.
//
// initMonitoring() di monitoring.js sudah memasangnya dan sudah dipanggil dari
// main.jsx. Memasangnya di dua tempat berarti setiap error global tercatat dua
// kali — dan `jumlah` pada tabel error_logs, yang gunanya justru mengukur
// seberapa sering sesuatu terjadi, berubah jadi angka yang menipu.
