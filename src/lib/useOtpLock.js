import { useCallback, useEffect, useState } from 'react'
import {
  OTP_MAX_ATTEMPTS, OTP_BUCKET, statusOtp, catatOtpGagal, resetOtp, formatTunggu,
} from './otpGuard'

export { OTP_MAX_ATTEMPTS, OTP_BUCKET }

// Status penguncian OTP untuk satu layar verifikasi.
//
// `aktif` menentukan kapan status ditarik dari server: hanya saat layar kode
// benar-benar terbuka. Menariknya di halaman yang belum menampilkan input kode
// akan memicu permintaan jaringan yang tak berguna pada setiap kunjungan.
export function useOtpLock(bucket, email, aktif = true) {
  const [status, setStatus] = useState({ locked: false, remaining: OTP_MAX_ATTEMPTS, retryAfter: 0 })
  const [sisaDetik, setSisaDetik] = useState(0)

  const terapkan = useCallback((s) => {
    setStatus(s)
    setSisaDetik(s.locked ? Math.max(1, s.retryAfter) : 0)
  }, [])

  // Tarik status saat layar kode dibuka: penguncian dari percobaan sebelumnya
  // harus terbaca walau halaman sudah dimuat ulang atau dibuka di tab lain.
  useEffect(() => {
    if (!aktif || !email) return
    let batal = false
    statusOtp(bucket, email).then((s) => { if (!batal) terapkan(s) }).catch(() => {})
    return () => { batal = true }
  }, [bucket, email, aktif, terapkan])

  // Hitung mundur hidup, supaya pengguna tahu kapan boleh mencoba lagi.
  useEffect(() => {
    if (sisaDetik <= 0) return
    const id = setInterval(() => {
      setSisaDetik((n) => {
        if (n <= 1) { setStatus((s) => ({ ...s, locked: false, remaining: OTP_MAX_ATTEMPTS })); return 0 }
        return n - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [sisaDetik])

  const catatGagal = useCallback(async () => {
    const s = await catatOtpGagal(bucket, email)
    terapkan(s)
    return s
  }, [bucket, email, terapkan])

  const bersihkan = useCallback(async () => {
    await resetOtp(bucket, email)
    setStatus({ locked: false, remaining: OTP_MAX_ATTEMPTS, retryAfter: 0 })
    setSisaDetik(0)
  }, [bucket, email])

  return {
    terkunci: status.locked,
    sisaPercobaan: status.remaining,
    sisaDetik,
    tungguTeks: formatTunggu(sisaDetik),
    catatGagal,
    bersihkan,
  }
}
