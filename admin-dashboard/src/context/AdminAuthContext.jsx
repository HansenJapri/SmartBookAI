import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { checkIsAdmin } from '../lib/adminApi'

const Ctx = createContext(null)

export function AdminAuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [mfaPending, setMfaPending] = useState(false)

  const refreshAal = async () => {
    try {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      setMfaPending(!!data && data.currentLevel === 'aal1' && data.nextLevel === 'aal2')
    } catch { setMfaPending(false) }
  }

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    let active = true

    // Evaluasi sesi + status admin + status 2FA.
    const evaluate = async (session) => {
      const u = session?.user ?? null
      let admin = false
      if (u) { try { admin = await checkIsAdmin() } catch { admin = false } }
      let mfa = false
      if (u) {
        try {
          const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
          mfa = !!data && data.currentLevel === 'aal1' && data.nextLevel === 'aal2'
        } catch { mfa = false }
      }
      if (!active) return
      setUser(u); setIsAdmin(admin); setMfaPending(mfa); setLoading(false)
    }

    supabase.auth.getSession()
      .then(({ data }) => evaluate(data.session))
      .catch(() => { if (active) setLoading(false) })

    // PENTING: jangan await pemanggilan Supabase langsung di dalam callback ini -
    // callback berjalan saat "auth lock" Supabase masih dipegang, sehingga query
    // is_admin() akan men-deadlock (layar memuat selamanya saat refresh).
    // Solusinya: tunda ke luar callback dengan setTimeout(0).
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setTimeout(() => { if (active) evaluate(session) }, 0)
    })

    // Jaring pengaman: apa pun yang terjadi, jangan biarkan layar memuat selamanya.
    const safety = setTimeout(() => { if (active) setLoading(false) }, 8000)

    return () => { active = false; clearTimeout(safety); sub.subscription.unsubscribe() }
  }, [])

  // Login admin: setelah autentikasi, WAJIB lolos pemeriksaan is_admin().
  // Akun non-admin langsung dikeluarkan → "hanya 1 akun admin yang bisa masuk".
  const signIn = async ({ email, password }) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    const ok = await checkIsAdmin()
    if (!ok) {
      await supabase.auth.signOut()
      throw new Error('Akun ini tidak punya akses admin.')
    }
    setIsAdmin(true)
  }

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
    setUser(null); setIsAdmin(false); setMfaPending(false)
  }

  return (
    <Ctx.Provider value={{ user, isAdmin, loading, configured: isSupabaseConfigured, mfaPending, verifyMfa, refreshAal, signIn, signOut }}>
      {children}
    </Ctx.Provider>
  )
}

export const useAdminAuth = () => useContext(Ctx)
