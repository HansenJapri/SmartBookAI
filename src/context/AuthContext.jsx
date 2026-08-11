import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured, phoneOtpEnabled } from '../lib/supabase'
import { track } from '../lib/api'
import { TERMS_VERSION } from '../lib/legal'

const AuthCtx = createContext(null)

// Masa berlaku kode OTP, dipakai hitung mundur di layar verifikasi.
// HARUS sama dengan setelan Supabase: Authentication > Emails > Email OTP
// Expiration = 180. Angka di sini hanya untuk tampilan; yang benar-benar
// menolak kode kedaluwarsa adalah Supabase, bukan penghitung ini.
export const OTP_TTL_SECONDS = 180

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mfaPending, setMfaPending] = useState(false)
  // Sesi yang berakhir DI TENGAH pemakaian, bukan saat membuka aplikasi.
  //
  // Ini penyebab keluhan "data saya hilang" yang paling sulit dilacak: saat
  // refresh token gagal (perangkat lama menganggur semalam, login di dua HP,
  // jam sistem melenceng), setiap query ke Supabase mulai ditolak. Halaman
  // menangkap kegagalan itu dan menampilkan empty state, sementara AuthContext
  // masih memegang `user` yang lama — jadi tidak ada satu pun pengalihan ke
  // layar masuk. Yang dilihat pemilik usaha: aplikasi yang tampak normal
  // dengan SELURUH catatannya lenyap.
  //
  // Dibedakan dari keluar-sendiri: `signOut()` menyetel penanda ini kembali ke
  // false supaya orang yang sengaja keluar tidak disambut peringatan.
  const [sesiBerakhir, setSesiBerakhir] = useState(false)

  // Apakah sesi perlu menyelesaikan 2FA (punya faktor terverifikasi namun belum
  // naik ke aal2 pada sesi ini).
  const refreshAal = async () => {
    try {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      setMfaPending(!!data && data.currentLevel === 'aal1' && data.nextLevel === 'aal2')
    } catch { setMfaPending(false) }
  }

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    supabase.auth.getSession().then(async ({ data }) => {
      setUser(data.session?.user ?? null)
      await refreshAal()
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Sesi hilang PADAHAL sebelumnya ada = kedaluwarsa, bukan keluar biasa.
      // `setUser` dipanggil dengan bentuk fungsi supaya keputusan ini dibuat
      // dari nilai user yang benar-benar terkini, bukan dari tangkapan closure
      // yang dibekukan saat efek ini pertama kali dipasang.
      setUser((sebelumnya) => {
        const sekarang = session?.user ?? null
        if (!sekarang && sebelumnya && event !== 'SIGNED_OUT') setSesiBerakhir(true)
        return sekarang
      })
      if (session?.user) setSesiBerakhir(false)
      setTimeout(() => { refreshAal() }, 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Lapis kedua. `onAuthStateChange` adalah jalur utama, tetapi ia hanya
  // berbunyi ketika pustaka Supabase sendiri yang menyadari sesinya jatuh.
  // Kegagalan bisa juga muncul lebih dulu sebagai penolakan pada satu query
  // biasa (JWT kedaluwarsa, 401). api.js menyiarkan kejadian itu ke sini
  // supaya penyebabnya sampai ke pengguna pada saat ia terjadi — bukan
  // beberapa menit kemudian, dalam bentuk halaman-halaman yang kosong.
  useEffect(() => {
    const h = () => setSesiBerakhir(true)
    window.addEventListener('bp-sesi-berakhir', h)
    return () => window.removeEventListener('bp-sesi-berakhir', h)
  }, [])

  // Cek ketersediaan email & telepon (sebelum daftar)
  const checkEmailAvailable = async (email) => {
    const { data, error } = await supabase.rpc('check_email_available', { p_email: email })
    if (error) return true // jika RPC belum ada, biarkan Supabase yang menolak duplikat
    return data
  }
  const checkPhoneAvailable = async (phone) => {
    const { data, error } = await supabase.rpc('check_phone_available', { p_phone: phone })
    if (error) return true
    return data
  }

  // Daftar - mengirim OTP email (perlu verifikasi)
  const signUp = async ({ email, password, businessName, ownerName, phone }) => {
    // Pendaftaran hanya bisa lanjut bila pengguna mencentang persetujuan S&K,
    // jadi kita catat persetujuan itu di metadata akun (auth.users) sebagai bukti.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: {
        business_name: businessName, owner_name: ownerName, phone,
        accepted_terms: true,
        // Persetujuan mencakup Syarat & Ketentuan DAN Kebijakan Privasi
        // (TERMS_VERSION adalah versi gabungan kedua dokumen). Dicatat eksplisit
        // sebagai jejak persetujuan sesuai UU PDP.
        accepted_privacy: true,
        accepted_terms_at: new Date().toISOString(),
        terms_version: TERMS_VERSION,
      } },
    })
    if (error) throw error
    return data
  }

  // Verifikasi OTP email (kode 6 digit) saat pendaftaran
  const verifyEmailOtp = async ({ email, token }) => {
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'signup' })
    if (error) throw error
    return data
  }

  const resendSignupOtp = async (email) => {
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    if (error) throw error
  }

  // ---------- LOGIN DUA LANGKAH (password -> OTP email 8 digit) ----------
  // Langkah 1. Password diverifikasi DI SERVER oleh Edge Function auth-login-otp,
  // yang lalu meminta Supabase mengirim kode ke email. Tidak ada sesi yang
  // terbit di browser pada langkah ini — itu inti keamanannya. Memanggil
  // signInWithPassword dari sini lalu menampilkan layar OTP hanyalah keamanan
  // semu: JWT-nya sudah aktif sebelum kode diisi.
  const startLogin = async ({ email, password }) => {
    const { data, error } = await supabase.functions.invoke('auth-login-otp', {
      body: { email: String(email).trim().toLowerCase(), password },
    })
    // functions.invoke melempar FunctionsHttpError untuk status non-2xx; badan
    // responsnya dibaca supaya UI bisa membedakan sebabnya.
    //
    // Bila badan respons TIDAK bisa dibaca, penyebabnya bukan kredensial —
    // fungsinya belum ter-deploy, jaringan putus, atau CORS. Jangan pernah
    // menerjemahkan itu menjadi "password salah": pengguna akan mengganti
    // password yang sebenarnya sudah benar, dan penyebab aslinya tersembunyi.
    if (error) {
      let body = null
      try { body = await error.context?.json?.() } catch { /* tidak terbaca */ }
      const e = new Error(body?.error || 'service_unavailable')
      // Jeda tunggu dari server dipakai UI untuk menghitung mundur tombol
      // "Kirim ulang" — tanpa ini pengguna menabrak throttle berulang kali.
      e.retryAfter = Number(body?.retry_after) || 0
      throw e
    }
    if (!data?.sent) throw new Error(data?.error || 'service_unavailable')
    return { resendAfter: Number(data?.resend_after) || 60 }
  }

  // Langkah 2. Kode benar & belum kedaluwarsa -> barulah sesi terbit.
  const verifyLoginOtp = async ({ email, token }) => {
    const { data, error } = await supabase.auth.verifyOtp({
      email: String(email).trim().toLowerCase(), token, type: 'email',
    })
    if (error) throw error
    track('login')
    return data
  }

  // Kirim ulang kode login. Memerlukan password lagi karena gerbangnya memang
  // di sana — tanpa itu, endpoint ini menjadi jalur login tanpa password.
  const resendLoginOtp = async ({ email, password }) => startLogin({ email, password })

  // Lupa password - kirim kode OTP recovery ke email
  const requestPasswordReset = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password',
    })
    if (error) throw error
  }

  // Verifikasi kode recovery lalu set password baru
  const verifyRecoveryAndSetPassword = async ({ email, token, newPassword }) => {
    const { error: vErr } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' })
    if (vErr) throw vErr
    const { error: uErr } = await supabase.auth.updateUser({ password: newPassword })
    if (uErr) throw uErr
  }

  // Update password ketika sudah punya sesi (mis. dari link recovery)
  const updatePassword = async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw error
  }

  // ---------- VERIFIKASI TELEPON (OTP SMS) - aktif bila phoneOtpEnabled ----------
  const startPhoneVerify = async (phoneE164) => {
    if (!phoneOtpEnabled) throw new Error('Verifikasi SMS belum diaktifkan (provider SMS belum dipasang).')
    const { error } = await supabase.auth.updateUser({ phone: phoneE164 })
    if (error) throw error
  }
  const confirmPhoneOtp = async ({ phone, token }) => {
    if (!phoneOtpEnabled) throw new Error('Verifikasi SMS belum diaktifkan.')
    const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'phone_change' })
    if (error) throw error
    await supabase.from('profiles').update({ phone_verified: true }).eq('id', user.id)
  }

  // ---------- 2FA (TOTP) ----------
  // Menyelesaikan tantangan 2FA saat login (menaikkan sesi ke aal2).
  const verifyMfa = async (code) => {
    const { data: factors, error: lErr } = await supabase.auth.mfa.listFactors()
    if (lErr) throw lErr
    const totp = (factors?.totp || []).find((f) => f.status === 'verified')
    if (!totp) throw new Error('Faktor 2FA tidak ditemukan.')
    const { data: ch, error: cErr } = await supabase.auth.mfa.challenge({ factorId: totp.id })
    if (cErr) throw cErr
    const { error: vErr } = await supabase.auth.mfa.verify({ factorId: totp.id, challengeId: ch.id, code })
    if (vErr) throw vErr
    await refreshAal()
  }

  const signOut = async () => {
    // Ditutup lebih dulu: keluar atas kehendak sendiri tidak boleh memicu
    // peringatan "sesi berakhir" dari pemantau di atas.
    setSesiBerakhir(false)
    await supabase.auth.signOut()
    setUser(null); setMfaPending(false)
  }

  return (
    <AuthCtx.Provider value={{
      user, loading, configured: isSupabaseConfigured, phoneOtpEnabled,
      mfaPending, verifyMfa, refreshAal,
      sesiBerakhir, akuiSesiBerakhir: () => setSesiBerakhir(false),
      checkEmailAvailable, checkPhoneAvailable,
      signUp, verifyEmailOtp, resendSignupOtp, signOut,
      startLogin, verifyLoginOtp, resendLoginOtp, OTP_TTL_SECONDS,
      requestPasswordReset, verifyRecoveryAndSetPassword, updatePassword,
      startPhoneVerify, confirmPhoneOtp,
    }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)
