import { useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Store, UserPlus } from 'lucide-react'
import { useWorkspace } from '../context/WorkspaceContext'
import { useLang } from '../context/LangContext'

// ============================================================
// Pengalih workspace permanen di kaki sidebar.
//
// Sebelumnya pengalih hanya berupa alert yang muncul kalau `!membership &&
// memberships.length > 0`. Akibatnya: saat staf sedang BERADA di dalam usaha
// orang lain, satu-satunya pilihan adalah "Kembali ke usaha saya" — tidak bisa
// lompat langsung ke usaha ketiga. Kontrol ini selalu ada di setiap keadaan,
// dan sekaligus menjadi tempat tetap untuk melihat undangan yang menunggu
// (dulu undangan hanya berupa kartu yang bisa hilang selamanya sekali ditutup).
// ============================================================

export default function WorkspaceSwitcher({ businessName }) {
  const { t } = useLang()
  const tw = t.workspace
  const { user, isOwner, memberships, invites, membership, switchWorkspace, accept } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState('')
  const boxRef = useRef(null)

  // Tanpa usaha lain dan tanpa undangan, tidak ada yang bisa dipilih —
  // tampilkan identitas usaha saja supaya kaki sidebar tidak berubah ramai.
  const hasChoices = memberships.length > 0 || invites.length > 0

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const activeLabel = isOwner
    ? (businessName || tw.myBusiness)
    : (membership?.business_name || tw.otherBusiness)

  const onAccept = async (inv) => {
    setErr(''); setBusy(inv.id)
    try { await accept(inv.id) } catch (e) { setErr(e.message || tw.acceptFailed); setBusy(null) }
  }

  if (!hasChoices) {
    return (
      <div className="side-user">
        <b>{businessName || tw.myBusiness}</b>
        {user?.email}
      </div>
    )
  }

  return (
    <div className="ws-switch" ref={boxRef}>
      <button type="button" className="ws-trigger" onClick={() => setOpen((v) => !v)}
        aria-expanded={open} aria-haspopup="listbox">
        <span className="ws-trigger-txt">
          <b>{activeLabel}</b>
          <span className="ws-sub">
            {isOwner ? tw.roleOwner : tw.roleStaff}
            {invites.length > 0 ? ` • ${tw.pendingCount.replace('{n}', invites.length)}` : ''}
          </span>
        </span>
        <ChevronsUpDown size={16} aria-hidden="true" />
      </button>

      {open && (
        <div className="ws-menu" role="listbox" aria-label={tw.switchLabel}>
          {err && <div className="ws-err">{err}</div>}

          <div className="ws-group-label">{tw.switchLabel}</div>

          <button type="button" className={`ws-item ${isOwner ? 'active' : ''}`}
            onClick={() => switchWorkspace(null)} role="option" aria-selected={isOwner}>
            <Store size={15} aria-hidden="true" />
            <span className="ws-item-txt">
              <b>{businessName || tw.myBusiness}</b>
              <span className="ws-sub">{tw.roleOwner}</span>
            </span>
            {isOwner && <Check size={15} aria-hidden="true" />}
          </button>

          {memberships.map((m) => {
            const on = !isOwner && membership?.owner_id === m.owner_id
            return (
              <button type="button" key={m.id} className={`ws-item ${on ? 'active' : ''}`}
                onClick={() => switchWorkspace(m.owner_id)} role="option" aria-selected={on}>
                <Store size={15} aria-hidden="true" />
                <span className="ws-item-txt">
                  <b>{m.business_name || tw.otherBusiness}</b>
                  <span className="ws-sub">
                    {tw.roleStaff} • {(m.modules || []).length
                      ? (m.modules || []).map((k) => t.team.moduleLabels[k] || k).join(', ')
                      : tw.noModule}
                  </span>
                </span>
                {on && <Check size={15} aria-hidden="true" />}
              </button>
            )
          })}

          {invites.length > 0 && (
            <>
              <div className="ws-group-label">{tw.pendingLabel}</div>
              {invites.map((inv) => (
                <div className="ws-item ws-invite" key={inv.id}>
                  <UserPlus size={15} aria-hidden="true" />
                  <span className="ws-item-txt">
                    <b>{inv.business_name || tw.otherBusiness}</b>
                    <span className="ws-sub">
                      {(inv.modules || []).map((k) => t.team.moduleLabels[k] || k).join(', ') || tw.noModule}
                    </span>
                  </span>
                  <button type="button" className="btn btn-primary ws-accept"
                    disabled={busy === inv.id} onClick={() => onAccept(inv)}>
                    {busy === inv.id ? tw.accepting : tw.accept}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
