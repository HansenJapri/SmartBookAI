// ============================================================
// PEMBUNGKUS localStorage YANG TIDAK PERNAH MELEMPAR.
//
// Kenapa ini ada: `localStorage` bukan API yang aman dipanggil begitu saja.
// Ia MELEMPAR — bukan mengembalikan null — pada tiga keadaan yang benar-benar
// dialami pengguna kami:
//   1. Safari/iOS mode penyamaran        -> SecurityError saat setItem;
//   2. penyimpanan perangkat penuh       -> QuotaExceededError;
//   3. cookie & penyimpanan situs diblok -> SecurityError saat membaca sekalipun.
//
// Bahayanya bukan pada fitur yang gagal, melainkan pada TEMPAT gagalnya.
// `markActive()` di applock dipanggil dari handler event pada setiap aktivitas
// pengguna; lemparan di sana menjadi exception berulang yang membuat interaksi
// terasa macet, dan penyebabnya sama sekali tidak kelihatan dari layar.
//
// Karena itu seluruh akses penyimpanan lokal lewat sini. Fungsi tulis
// mengembalikan boolean supaya pemanggil yang PERLU tahu (mis. PIN kunci layar,
// yang tidak ada gunanya bila tidak tersimpan) bisa memberi tahu pengguna,
// sementara pemanggil yang tidak peduli cukup mengabaikannya.
// ============================================================

export function ambil(kunci) {
  try {
    return localStorage.getItem(kunci)
  } catch {
    return null
  }
}

/** @returns {boolean} true bila benar-benar tersimpan. */
export function simpan(kunci, nilai) {
  try {
    localStorage.setItem(kunci, String(nilai))
    return true
  } catch {
    return false
  }
}

export function hapus(kunci) {
  try {
    localStorage.removeItem(kunci)
    return true
  } catch {
    return false
  }
}

/**
 * Apakah penyimpanan lokal benar-benar bisa dipakai di perangkat ini.
 * Dipakai fitur yang tidak masuk akal tanpa penyimpanan (mis. Kunci Layar PIN),
 * supaya bisa menolak dengan penjelasan alih-alih gagal diam-diam.
 */
export function penyimpananTersedia() {
  const uji = '__bp_uji__'
  try {
    localStorage.setItem(uji, '1')
    localStorage.removeItem(uji)
    return true
  } catch {
    return false
  }
}
