import { useEffect, useState } from 'react'
import { useLang } from '../context/LangContext'

// Hitung mundur masa berlaku kode OTP.
//
// Ini murni penanda visual supaya pengguna tahu kapan harus minta kode baru.
// Yang benar-benar menolak kode kedaluwarsa adalah Supabase saat verifyOtp() —
// mengubah angka di sini tidak memperpanjang masa berlaku kode apa pun.
export default function OtpCountdown({ startedAt, seconds, onExpire }) {
  const { t } = useLang()
  const a = t.auth
  const [sisa, setSisa] = useState(seconds)

  useEffect(() => {
    const hitung = () => {
      const lewat = Math.floor((Date.now() - startedAt) / 1000)
      return Math.max(0, seconds - lewat)
    }
    setSisa(hitung())
    const id = setInterval(() => {
      const s = hitung()
      setSisa(s)
      if (s === 0) { clearInterval(id); onExpire?.() }
    }, 1000)
    return () => clearInterval(id)
  }, [startedAt, seconds, onExpire])

  const mm = String(Math.floor(sisa / 60)).padStart(2, '0')
  const ss = String(sisa % 60).padStart(2, '0')

  if (sisa === 0) {
    return <p className="otp-countdown expired">{a.otpExpired}</p>
  }
  return (
    <p className="otp-countdown">
      {a.otpValidFor} <b>{mm}:{ss}</b>
    </p>
  )
}
