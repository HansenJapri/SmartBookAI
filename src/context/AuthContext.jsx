import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured, phoneOtpEnabled } from '../lib/supabase'
import { track } from '../lib/api'
import { TERMS_VERSION } from '../lib/legal'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mfaPending, setMfaPending] = useState(false)

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
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
      setTimeout(() => { refreshAal() }, 0)
    })
    return () => sub.subscription.unsubscribe()
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

  const signIn = async ({ email, password }) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    track('login')
    return data
  }

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
    await supabase.auth.signOut()
    setUser(null); setMfaPending(false)
  }

  return (
    <AuthCtx.Provider value={{
      user, loading, configured: isSupabaseConfigured, phoneOtpEnabled,
      mfaPending, verifyMfa, refreshAal,
      checkEmailAvailable, checkPhoneAvailable,
      signUp, verifyEmailOtp, resendSignupOtp, signIn, signOut,
      requestPasswordReset, verifyRecoveryAndSetPassword, updatePassword,
      startPhoneVerify, confirmPhoneOtp,
    }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)
