import { useCallback, useEffect, useRef, useState } from 'react'

// ============================================================
// TIGA KEADAAN PEMUATAN DATA — memuat / gagal / berhasil.
//
// Kebiasaan lama di seluruh halaman berbunyi:
//
//     fetchTransactions().then(setTx).catch(() => setTx([]))
//
// Baris itu menyamakan "gagal" dengan "kosong". Untuk pemilik warung yang
// kemarin mencatat tiga ratus transaksi, layar yang berbunyi "Belum ada
// transaksi" tidak bisa dibedakan dari data yang hilang. Yang dia lakukan
// berikutnya bisa ditebak — mencatat ulang semuanya — dan begitu koneksinya
// pulih, dia sudah menciptakan duplikat yang sebenarnya.
//
// Karena itu hook ini memegang satu aturan: KEGAGALAN TIDAK PERNAH MENULIS
// `data`. Empty state hanya boleh tampil bila server benar-benar menjawab
// dengan nol baris. Saat gagal, data lama (kalau ada) tetap ditampilkan dan
// galatnya disampaikan terpisah — itu lebih jujur daripada layar kosong.
//
// Percobaan ulang otomatis saat koneksi kembali disengaja: kegagalan paling
// umum di lapangan adalah sinyal yang berkedip beberapa detik, dan menuntut
// pengguna menekan "Coba lagi" untuk sesuatu yang sudah pulih sendiri hanya
// membuat aplikasi terasa rapuh.
// ============================================================

/**
 * @param {() => Promise<any>} pengambil  fungsi pengambil data
 * @param {any[]} deps                     dependensi; pengambilan diulang saat berubah
 * @param {{ awal?: any }} opsi            nilai awal `data` (default null = belum pernah dimuat)
 */
export function useAsyncData(pengambil, deps = [], { awal = null } = {}) {
  const [data, setData] = useState(awal)
  const [galat, setGalat] = useState(null)
  const [memuat, setMemuat] = useState(true)
  const [putaran, setPutaran] = useState(0)

  // Disimpan di ref supaya pemanggil tidak wajib membungkus fungsinya dengan
  // useCallback; `deps` tetap menjadi satu-satunya pemicu pengambilan ulang.
  const ref = useRef(pengambil)
  ref.current = pengambil

  useEffect(() => {
    let hidup = true
    setMemuat(true)
    Promise.resolve()
      .then(() => ref.current())
      .then((hasil) => {
        if (!hidup) return
        setData(hasil)
        setGalat(null)
      })
      .catch((e) => {
        // Sengaja TIDAK menyentuh `data`. Lihat catatan di atas.
        if (hidup) setGalat(e instanceof Error ? e : new Error(String(e)))
      })
      .then(() => { if (hidup) setMemuat(false) })
    return () => { hidup = false }
  }, [...deps, putaran]) // eslint-disable-line react-hooks/exhaustive-deps

  const muatUlang = useCallback(() => setPutaran((n) => n + 1), [])

  // Koneksi pulih -> coba lagi sendiri, tapi hanya bila memang sedang gagal.
  useEffect(() => {
    if (!galat) return
    const lagi = () => muatUlang()
    window.addEventListener('online', lagi)
    return () => window.removeEventListener('online', lagi)
  }, [galat, muatUlang])

  return { data, galat, memuat, muatUlang, setData }
}
