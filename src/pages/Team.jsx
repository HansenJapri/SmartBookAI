import { useEffect, useState } from 'react'
import { Users, Trash2, Pencil } from 'lucide-react'
import Modal from '../components/Modal'
import { fetchStaff, addStaff, updateStaff, deleteStaff, reinviteStaff } from '../lib/api'
import { MODULES, STAFF_STATUS, canManageUsers, staffDisplayName } from '../lib/rbac'
import { fmtDate } from '../lib/format'
import { useLang } from '../context/LangContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useAlert } from '../context/AlertContext'

const blankForm = () => ({ id: null, email: '', name: '', modules: [] })

// Pengguna & Hak Akses (owner): undang staf via email, batasi per modul.
// Staf mendaftar/login dengan email yang diundang -> otomatis aktif, dan
// hanya melihat menu + data modul yang diizinkan (dijaga RLS di database).
export default function Team() {
  const { t } = useLang()
  const tm = t.team
  const moduleLabel = (key) => tm.moduleLabels[key] || key
  const moduleDesc = (key) => tm.moduleDescs[key] || ''
  const staffStatusLabel = (key) => ({ invited: tm.statusInvited, active: tm.statusActive, revoked: tm.statusRevoked }[key])
  const [list, setList] = useState(null)
  // Status owner ditentukan oleh workspace yang sedang dibuka, BUKAN oleh
  // `membership === null`. Selama undangan belum diterima, membership memang
  // null — dan itu dulu membuat calon staf dianggap owner di halaman ini.
  const { isOwner, membership } = useWorkspace()
  const { showConfirm } = useAlert()
  // Satu sumber kebenaran untuk "boleh CRUD pengguna" — dipakai untuk menyembunyikan
  // tabel DAN untuk menjaga tiap aksi. api.js memeriksa ulang di sisi jaringan.
  const canManage = canManageUsers({ isOwner, membership })
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!canManage) { setList([]); return }
    fetchStaff().then(setList).catch(() => setList([]))
  }, [canManage])

  const toggleModule = (key) => setForm((f) => ({
    ...f,
    modules: f.modules.includes(key) ? f.modules.filter((m) => m !== key) : [...f.modules, key],
  }))

  // Setiap aksi tulis lewat sini. Menyembunyikan tombol saja tidak cukup:
  // handler bisa terpanggil lewat rute lama, state basi, atau ekstensi browser.
  const guard = (fn) => async (...args) => {
    if (!canManage) { setErr(tm.errOwnerOnly); return }
    return fn(...args)
  }

  const save = guard(async (e) => {
    e.preventDefault()
    setErr('')
    const email = form.email.trim().toLowerCase()
    const name = form.name.trim()
    if (!form.id && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setErr(tm.errInvalidEmail)
    if (form.modules.length === 0) return setErr(tm.errNoModule)
    setBusy(true)
    try {
      if (form.id) {
        const upd = await updateStaff(form.id, { modules: form.modules, name })
        setList((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
        setMsg(tm.accessUpdatedMsg.replace('{name}', staffDisplayName(upd)))
      } else {
        const created = await addStaff(email, form.modules, 'staf', name)
        setList((prev) => [created, ...(prev || [])])
        setMsg(tm.invitedMsg.replace('{name}', staffDisplayName(created)))
      }
      setForm(null)
    } catch (e2) {
      setErr(e2.message?.includes('duplicate') ? tm.emailTakenErr : e2.message)
    } finally { setBusy(false) }
  })

  const setStatus = guard(async (s, status) => {
    const labels = { revoked: tm.statusRevokedWord, active: tm.statusActivatedWord }
    const who = staffDisplayName(s)
    if (status === 'revoked') {
      const ok = await showConfirm({
        type: 'error', title: tm.revoke,
        message: tm.confirmRevoke.replace('{name}', who),
        confirmText: tm.revoke,
      })
      if (!ok) return
    }
    try {
      const upd = await updateStaff(s.id, { status })
      setList((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
      setMsg(tm.accessChangedMsg.replace('{name}', who).replace('{status}', labels[status] || status))
    } catch (e2) { setErr(e2.message) }
  })

  const remove = guard(async (s) => {
    const ok = await showConfirm({
      type: 'error', title: tm.del,
      message: tm.confirmDelete.replace('{name}', staffDisplayName(s)),
      confirmText: tm.del,
    })
    if (!ok) return
    try {
      await deleteStaff(s.id)
      setList((prev) => prev.filter((x) => x.id !== s.id))
    } catch (e2) { setErr(e2.message) }
  })

  const reinvite = guard(async (s) => {
    setErr('')
    try {
      const upd = await reinviteStaff(s.id)
      setList((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
      setMsg(tm.reinvitedMsg.replace('{name}', staffDisplayName(s)))
    } catch (e2) { setErr(e2.message) }
  })

  if (!list) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  // Halaman ini untuk owner; staf yang nyasar ke sini melihat info keanggotaannya.
  // Penjaga rute di App.jsx sudah mengalihkan staf, ini pertahanan berlapis.
  if (!canManage) {
    return (
      <div className="card card-pad">
        <h3 className="card-title">{tm.staffInfoTitle}</h3>
        <p className="muted-sm">
          {tm.staffInfoDesc.replace('{modules}', (membership?.modules || []).map((k) => moduleLabel(k)).join(', ') || '-')}
        </p>
      </div>
    )
  }

  return (
    <>
      {msg && (
        <div className="alert alert-ok" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{msg}</span>
          <button className="icon-btn" onClick={() => setMsg('')} aria-label={tm.close}>✕</button>
        </div>
      )}
      {err && !form && <div className="alert alert-err">{err}</div>}

      <div className="toolbar">
        <p className="muted-sm" style={{ flex: 1, margin: 0 }}>
          {tm.hint}
        </p>
        <button className="btn btn-primary" onClick={() => { setErr(''); setForm(blankForm()) }}>{tm.addStaff}</button>
      </div>

      {list.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="ee"><Users size={36} /></div>
          <h3>{tm.emptyTitle}</h3>
          <p>{tm.emptyDesc}</p>
          <button className="btn btn-primary" onClick={() => setForm(blankForm())}>{tm.addFirst}</button>
        </div></div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>{tm.thName}</th><th>{tm.thAccess}</th><th>{tm.thStatus}</th><th>{tm.thSince}</th><th></th></tr></thead>
            <tbody>
              {list.map((s) => {
                const st = STAFF_STATUS[s.status] || STAFF_STATUS.invited
                // Undangan yang ditolak staf. Dulu penolakan hanya tersimpan di
                // browser staf, jadi owner tidak pernah tahu undangannya ditolak
                // dan mengira aplikasinya rusak.
                const declined = Boolean(s.declined_at) && s.status === 'invited'
                return (
                  <tr key={s.id}>
                    {/* Email sengaja TIDAK ditampilkan di tabel — lihat tm.thName.
                        Alamatnya tetap ada di baris (dipakai undangan), hanya
                        tidak dipampang di layar yang sering dilihat bersama. */}
                    <td><b>{staffDisplayName(s)}</b></td>
                    <td>
                      {(s.modules || []).map((k) => (
                        <span key={k} className="pill pill-ch" style={{ marginRight: 4 }}>
                          {moduleLabel(k)}
                        </span>
                      ))}
                    </td>
                    <td>
                      <span className={`badge ${declined ? 'badge-red' : st.cls}`}>
                        {declined ? tm.statusDeclined : staffStatusLabel(s.status)}
                      </span>
                    </td>
                    <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{fmtDate(s.created_at)}</td>
                    <td>
                      <div className="row-actions">
                        {declined && (
                          <button className="linklike" onClick={() => reinvite(s)}>{tm.reinvite}</button>
                        )}
                        {s.status !== 'revoked' ? (
                          <button className="linklike" onClick={() => setStatus(s, 'revoked')}>{tm.revoke}</button>
                        ) : (
                          <button className="linklike" onClick={() => setStatus(s, 'active')}>{tm.activate}</button>
                        )}
                        <button className="icon-btn" title={tm.editModulesTitle} aria-label={tm.editModulesTitle}
                          onClick={() => { setErr(''); setForm({ id: s.id, email: s.email, name: s.name || '', modules: s.modules || [] }) }}>
                          <Pencil size={15} />
                        </button>
                        <button className="icon-btn danger" title={tm.del} aria-label={tm.del} onClick={() => remove(s)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal onClose={() => setForm(null)} onSubmit={save} labelledBy="teamModalTitle">
            <div className="modal-head">
              <h3 id="teamModalTitle">{form.id ? tm.editAccessTitle : tm.inviteTitle}</h3>
              <button type="button" className="icon-btn" onClick={() => setForm(null)} aria-label={tm.close}>✕</button>
            </div>
            <div className="modal-body">
              {err && <div className="alert alert-err">{err}</div>}
              <div className="field">
                <label htmlFor="team-name">{tm.lStaffName}</label>
                <input id="team-name" className="input" type="text" value={form.name} maxLength={60}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={tm.namePh} />
                <p className="muted-sm" style={{ margin: '6px 0 0' }}>{tm.nameHint}</p>
              </div>
              {/* Email tetap dibutuhkan untuk mengirim undangan — ia satu-satunya
                  identitas yang ada sebelum staf punya akun — tapi hanya muncul
                  di formulir ini, tidak lagi di tabel. */}
              <div className="field">
                <label htmlFor="team-email">{tm.lStaffEmail}</label>
                <input id="team-email" className="input" type="email" value={form.email} disabled={Boolean(form.id)}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={tm.emailPh} />
                {!form.id && (
                  <p className="muted-sm" style={{ margin: '6px 0 0' }}>
                    {tm.inviteHint}
                  </p>
                )}
              </div>
              <div className="field">
                <label id="team-modules-label">{tm.lModules}</label>
                <div role="group" aria-labelledby="team-modules-label">
                {MODULES.map((m) => (
                  <label key={m.key} className="agree" style={{ margin: '0 0 8px' }}>
                    <input type="checkbox" checked={form.modules.includes(m.key)} onChange={() => toggleModule(m.key)} />
                    <span><b>{moduleLabel(m.key)}</b><br /><span className="muted-sm">{moduleDesc(m.key)}</span></span>
                  </label>
                ))}
                </div>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost btn-block" onClick={() => setForm(null)}>{tm.cancel}</button>
                <button className="btn btn-primary btn-block" disabled={busy}>{busy ? tm.saving : form.id ? tm.save : tm.invite}</button>
              </div>
            </div>
        </Modal>
      )}
    </>
  )
}
