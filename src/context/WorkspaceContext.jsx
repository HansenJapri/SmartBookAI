import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  fetchMyMembership, fetchMyMemberships, fetchPendingInvitations,
  acceptInvitation, declineInvitation,
  getSelectedWorkspace, setSelectedWorkspace,
} from '../lib/api'
import { isOwnerView } from '../lib/rbac'
import { useAuth } from './AuthContext'

// ============================================================
// Satu sumber kebenaran untuk "workspace mana yang sedang dibuka dan dengan
// hak apa". Sebelumnya keadaan ini hidup di dalam AppLayout, sehingga penjaga
// rute tidak bisa membacanya dan setiap halaman harus mengambil ulang sendiri.
//
// isOwner DIHITUNG dari workspace yang dipilih, bukan dari `membership === null`
// — lihat isOwnerView() di lib/rbac.js untuk alasannya.
// ============================================================

const Ctx = createContext(null)

export function WorkspaceProvider({ children }) {
  const { user } = useAuth()
  const [membership, setMembership] = useState(null)
  const [memberships, setMemberships] = useState([])
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  // Undangan yang ditunda untuk sesi ini saja. Penundaan permanen dulu disimpan
  // di localStorage dan tidak bisa dibatalkan dari UI mana pun; kini "Nanti"
  // hanya menyembunyikan kartu sampai halaman dimuat lagi, sedangkan penolakan
  // tegas dicatat di server lewat declineInvitation().
  const [snoozed, setSnoozed] = useState([])

  const selected = getSelectedWorkspace()
  const isOwner = isOwnerView(user?.id, selected)

  const refresh = useCallback(async () => {
    if (!user) { setLoading(false); return }
    const [mem, mems, inv] = await Promise.all([
      fetchMyMembership().catch(() => null),
      fetchMyMemberships().catch(() => []),
      fetchPendingInvitations().catch(() => []),
    ])
    setMembership(mem)
    setMemberships(mems)
    setInvites(inv)
    setLoading(false)
  }, [user])

  useEffect(() => { refresh() }, [refresh])

  const switchWorkspace = useCallback((ownerId) => {
    setSelectedWorkspace(ownerId && ownerId !== user?.id ? ownerId : '')
    // Muat ulang penuh: seluruh data (transaksi, laporan, katalog) terikat ke
    // owner efektif, jadi lebih aman mengosongkan semua cache di memori.
    window.location.reload()
  }, [user])

  const accept = useCallback(async (inviteId) => {
    const row = await acceptInvitation(inviteId)
    switchWorkspace(row?.owner_id || null)
  }, [switchWorkspace])

  const decline = useCallback(async (inviteId) => {
    await declineInvitation(inviteId)
    setInvites((prev) => prev.filter((x) => x.id !== inviteId))
  }, [])

  const snooze = useCallback((inviteId) => {
    setSnoozed((prev) => (prev.includes(inviteId) ? prev : [...prev, inviteId]))
  }, [])

  const value = useMemo(() => ({
    user,
    isOwner,
    selectedWorkspace: selected,
    membership: isOwner ? null : membership,
    memberships,
    invites,
    visibleInvites: invites.filter((i) => !snoozed.includes(i.id)),
    loading,
    refresh,
    switchWorkspace,
    accept,
    decline,
    snooze,
  }), [user, isOwner, selected, membership, memberships, invites, snoozed,
    loading, refresh, switchWorkspace, accept, decline, snooze])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWorkspace() {
  return useContext(Ctx) || {
    user: null, isOwner: true, selectedWorkspace: '', membership: null,
    memberships: [], invites: [], visibleInvites: [], loading: false,
    refresh: async () => {}, switchWorkspace: () => {},
    accept: async () => {}, decline: async () => {}, snooze: () => {},
  }
}
