import { useEffect, useState } from 'react'

// ============================================================
// Status koneksi perangkat.
//
// Target pengguna kami berjualan di warung dan pasar dengan sinyal seluler yang
// naik-turun. Tanpa deteksi ini, koneksi yang putus muncul sebagai
// "TypeError: Failed to fetch" — pesan yang tidak berarti apa-apa bagi pemilik
// usaha, dan yang lebih buruk, tidak membedakan "internet Anda putus" dari
// "data Anda bermasalah". Yang pertama akan pulih sendiri; yang kedua tidak.
//
// `navigator.onLine` memang hanya tahu ada-tidaknya antarmuka jaringan, bukan
// apakah server benar-benar terjangkau. Itu cukup: nilai false hampir pasti
// benar (dan itulah yang kita pakai untuk memperingatkan), sedangkan nilai true
// hanya berarti "silakan coba" — kegagalan sesudahnya tetap ditangani jalur
// error biasa.
// ============================================================

export function useOnline() {
  const [online, setOnline] = useState(() => {
    try { return navigator.onLine !== false } catch { return true }
  })

  useEffect(() => {
    const nyala = () => setOnline(true)
    const mati = () => setOnline(false)
    window.addEventListener('online', nyala)
    window.addEventListener('offline', mati)
    return () => {
      window.removeEventListener('online', nyala)
      window.removeEventListener('offline', mati)
    }
  }, [])

  return online
}

/**
 * Penjaga sinkron untuk jalur TULIS. Dipakai sebelum memanggil server supaya
 * isian formulir tidak dibuang oleh permintaan yang sudah pasti gagal.
 */
export function sedangOffline() {
  try { return navigator.onLine === false } catch { return false }
}
