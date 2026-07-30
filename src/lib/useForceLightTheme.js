import { useEffect } from 'react'

// Memaksa mode terang pada halaman tertentu (masuk, daftar, ketentuan, privasi).
// Preferensi tema pengguna di localStorage TIDAK diubah — hanya atribut DOM yang
// ditimpa selama halaman ini terbuka, lalu dikembalikan saat keluar. Dengan begitu
// pengguna yang memilih mode gelap tetap mendapatkannya lagi di dalam aplikasi.
export default function useForceLightTheme() {
  useEffect(() => {
    const root = document.documentElement
    const previous = root.dataset.theme || 'light'
    root.dataset.theme = 'light'
    return () => { root.dataset.theme = previous }
  }, [])
}
