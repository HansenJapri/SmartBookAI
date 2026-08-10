// Input kode OTP - fleksibel mengikuti panjang kode dari Supabase (6, 8, dst).
// Satu kolom angka besar agar tidak ada asumsi panjang yang salah.
export default function OtpInput({ value, onChange, maxLength = 10, disabled = false }) {
  const handle = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, maxLength)
    onChange(digits)
  }
  return (
    <input
      className="otp-single"
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={maxLength}
      value={value}
      onChange={handle}
      // Dikunci setelah batas percobaan tercapai (lihat useOtpLock).
      disabled={disabled}
      placeholder="Masukkan kode dari email"
      aria-label="Kode verifikasi"
    />
  )
}
