import { lazy } from 'react'
import { ambil, simpan, hapus } from './simpanLokal'

// ============================================================
// PEMUAT HALAMAN YANG TAHAN RILIS BARU.
//
// 26 halaman dimuat lewat React.lazy(), dan nama berkas potongannya mengandung
// hash isi. Konsekuensinya muncul setiap kali kita merilis: pengguna yang
// tabnya sudah terbuka sejak sebelum deploy masih memegang index lama, jadi
// klik menu apa pun akan mengambil potongan yang SUDAH TIDAK ADA di server.
// Kegagalan itu naik sebagai error render, ditangkap ErrorBoundary, dan yang
// dilihat pengguna adalah "Maaf, terjadi kendala" — untuk aplikasi yang
// sebenarnya sehat.
//
// Muat ulang memang memperbaikinya, tapi tidak ada yang memberi tahu pengguna
// itu, dan yang tertinggal di kepalanya adalah "aplikasinya suka rusak".
// Karena penyebabnya spesifik dan penyembuhnya pasti, satu-satunya jawaban yang
// benar adalah melakukannya sendiri.
//
// Penjaga anti-loop memakai sessionStorage: kalau muat ulang TIDAK menolong
// (potongannya memang rusak, bukan sekadar basi), percobaan kedua dibiarkan
// gagal ke ErrorBoundary alih-alih memuat ulang tanpa henti — layar yang
// berkedip selamanya jauh lebih buruk daripada satu pesan galat yang jujur.
// ============================================================

const KUNCI = 'bp-muat-ulang-potongan'

const galatPotongan = (e) => {
  const pesan = String(e?.message || e || '')
  return /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically imported/i.test(pesan)
}

const sesiAmbil = (k) => { try { return sessionStorage.getItem(k) } catch { return ambil(k) } }
const sesiSimpan = (k, v) => { try { sessionStorage.setItem(k, v); return true } catch { return simpan(k, v) } }
const sesiHapus = (k) => { try { sessionStorage.removeItem(k) } catch { hapus(k) } }

export function lazyAman(pengimpor) {
  return lazy(() => pengimpor().then(
    (mod) => {
      // Berhasil memuat = index yang dipegang tab ini cocok dengan server lagi.
      sesiHapus(KUNCI)
      return mod
    },
    (e) => {
      if (galatPotongan(e) && !sesiAmbil(KUNCI)) {
        sesiSimpan(KUNCI, '1')
        window.location.reload()
        // Promise yang tidak pernah selesai: menahan render sampai muat ulang
        // benar-benar terjadi, supaya layar galat tidak sempat berkedip dulu.
        return new Promise(() => {})
      }
      throw e
    },
  ))
}
