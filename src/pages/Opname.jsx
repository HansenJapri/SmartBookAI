import { useEffect, useState } from 'react'
import { ClipboardCheck, ArrowLeft, Trash2 } from 'lucide-react'
import Modal from '../components/Modal'
import {
  fetchOpnames, addOpname, updateOpname, deleteOpname, postOpname, fetchProducts,
} from '../lib/api'
import { nextDocNumber, buildOpnameItems, opnameDiff, opnameSummary, SO_STATUS } from '../lib/gudang'
import { fmtDate } from '../lib/format'
import { useLang } from '../context/LangContext'
import GagalMuat from '../components/GagalMuat'
import { useAlert } from '../context/AlertContext'

// Stock Opname bersesi: Draf (isi hitung fisik, bisa disimpan berkali-kali)
// -> Posting (stok sistem DISET = hasil hitung; sesi terkunci) / Batal.
export default function Opname() {
  const { t } = useLang()
  const { showConfirm } = useAlert()
  const op = t.opname
  const soStatusLabel = (key) => ({ draft: op.statusDraft, posted: op.statusPosted, cancelled: op.statusCancelled }[key])
  const [list, setList] = useState(null)
  const [gagalMuat, setGagalMuat] = useState(null)
  const [detail, setDetail] = useState(null)   // sesi yang sedang dibuka
  const [confirmPost, setConfirmPost] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const load = () => fetchOpnames()
    .then((d) => { setList(d); setGagalMuat(null) })
    .catch((e) => setGagalMuat(e))
  useEffect(() => { load() }, [])

  const draft = (list || []).find((s) => s.status === 'draft')

  const start = async () => {
    setErr(''); setMsg('')
    if (draft) { setDetail(draft); return } // satu draf aktif dalam satu waktu
    setBusy(true)
    try {
      const products = await fetchProducts()
      if (!products.length) { setErr(op.errNoProducts); return }
      const created = await addOpname({
        opname_number: nextDocNumber('SO', (list || []).map((x) => x.opname_number)),
        status: 'draft',
        items: buildOpnameItems(products),
      })
      setList((prev) => [created, ...(prev || [])])
      setDetail(created)
      setMsg(op.startedMsg.replace('{num}', created.opname_number))
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const setCounted = (productId, value) => {
    setDetail((d) => ({
      ...d,
      items: d.items.map((it) => (it.product_id === productId ? { ...it, counted_qty: value === '' ? null : value } : it)),
    }))
  }

  const saveDraft = async () => {
    setBusy(true); setErr('')
    try {
      const upd = await updateOpname(detail.id, { items: detail.items })
      setDetail(upd)
      setList((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
      setMsg(op.draftSavedMsg)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const doPost = async () => {
    setBusy(true); setErr('')
    try {
      const res = await postOpname(detail)
      setList((prev) => prev.map((x) => (x.id === res.opname.id ? res.opname : x)))
      setDetail(res.opname)
      setConfirmPost(false)
      setMsg(
        res.changes.length === 0
          ? op.postedNoDiffMsg.replace('{num}', res.opname.opname_number)
          : op.postedMsg.replace('{num}', res.opname.opname_number) + ' ' +
            res.changes.map((c) => `${c.name} ${c.before} → ${c.after} ${c.unit}`).join('; ') + '.'
      )
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const cancelSession = async (s) => {
    if (!(await showConfirm({ message: op.confirmCancelSession.replace('{num}', s.opname_number) }))) return
    try {
      const upd = await updateOpname(s.id, { status: 'cancelled' })
      setList((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
      if (detail?.id === s.id) setDetail(null)
    } catch (e2) { setErr(e2.message) }
  }

  const removeSession = async (s) => {
    if (!(await showConfirm({ message: op.confirmDelSession.replace('{num}', s.opname_number), type: 'error' }))) return
    try {
      await deleteOpname(s.id)
      setList((prev) => prev.filter((x) => x.id !== s.id))
      if (detail?.id === s.id) setDetail(null)
    } catch (e2) { setErr(e2.message) }
  }

  if (gagalMuat && !list) return <GagalMuat galat={gagalMuat} onRetry={load} />
  if (!list) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  // ---------- TAMPILAN DETAIL SESI ----------
  if (detail) {
    const editable = detail.status === 'draft'
    const sum = opnameSummary(detail.items)
    return (
      <>
        {msg && <div className="alert alert-ok" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{msg}</span><button className="icon-btn" onClick={() => setMsg('')} aria-label={op.close}>✕</button></div>}
        {err && <div className="alert alert-err">{err}</div>}

        <div className="toolbar">
          <button className="btn btn-ghost" onClick={() => { setDetail(null); setMsg('') }}>
            <ArrowLeft size={15} style={{ verticalAlign: '-3px', marginRight: 4 }} />{op.back}
          </button>
          <b style={{ fontSize: 16 }}>{detail.opname_number}</b>
          <span className={`badge ${(SO_STATUS[detail.status] || SO_STATUS.draft).cls}`}>{soStatusLabel(detail.status)}</span>
          <span className="muted-sm">{fmtDate(detail.created_at)}</span>
          <div style={{ flex: 1 }} />
          {editable && (
            <>
              <button className="btn btn-ghost" onClick={saveDraft} disabled={busy}>{op.saveDraft}</button>
              <button className="btn btn-primary" onClick={() => { setErr(''); setConfirmPost(true) }} disabled={busy || sum.counted === 0}>
                {op.postOpname}
              </button>
            </>
          )}
        </div>

        <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>{op.thProduct}</th><th>{op.thUnit}</th><th style={{ textAlign: 'right' }}>{op.thSystemStock}</th>
              <th>{op.thPhysicalStock}</th><th style={{ textAlign: 'right' }}>{op.thDiff}</th>
            </tr></thead>
            <tbody>
              {detail.items.map((it) => {
                const d = opnameDiff(it)
                return (
                  <tr key={it.product_id}>
                    <td><b>{it.name}</b></td>
                    <td className="muted-sm">{it.unit}</td>
                    <td style={{ textAlign: 'right' }}>{Number(it.system_qty)}</td>
                    <td style={{ maxWidth: 160 }}>
                      {editable ? (
                        <input className="input" type="number" min="0" step="any"
                          value={it.counted_qty ?? ''} placeholder={op.notCountedPh}
                          onChange={(e) => setCounted(it.product_id, e.target.value)} />
                      ) : (
                        <span>{it.counted_qty ?? <span className="muted-sm">{op.notCounted}</span>}</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {d === null ? <span className="muted-sm">-</span>
                        : d === 0 ? <span className="muted-sm">0</span>
                        : <span className={d > 0 ? 'amt-in' : 'amt-out'}>{d > 0 ? '+' : ''}{d}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="muted-sm mt">
          {op.summary.replace('{counted}', sum.counted).replace('{total}', sum.total).replace('{plus}', sum.plus).replace('{minus}', sum.minus)}
          {editable && op.summarySkipHint}
        </p>

        {/* Konfirmasi posting: tampilkan HANYA selisih agar keputusan jelas (HCI rule 4 & 5) */}
        {confirmPost && (
          <Modal onClose={() => setConfirmPost(false)} labelledBy="opnamePostModalTitle">
              <div className="modal-head">
                <h3 id="opnamePostModalTitle">{op.postConfirmTitle.replace('{num}', detail.opname_number)}</h3>
                <button type="button" className="icon-btn" onClick={() => setConfirmPost(false)} aria-label={op.close}>✕</button>
              </div>
              <div className="modal-body">
                {sum.diffs.length === 0 ? (
                  <p style={{ marginTop: 0 }}>{op.postConfirmNoDiff}</p>
                ) : (
                  <>
                    <p style={{ marginTop: 0 }}>{op.postConfirmWillSet.replace('{n}', sum.diffs.length)}</p>
                    <ul style={{ margin: '0 0 12px', paddingLeft: 18 }}>
                      {sum.diffs.map((x) => (
                        <li key={x.product_id} style={{ marginBottom: 4 }}>
                          {x.name}: {Number(x.system_qty)} → <b>{Number(x.counted_qty)}</b> {x.unit}{' '}
                          <span className={x.diff > 0 ? 'amt-in' : 'amt-out'}>({x.diff > 0 ? '+' : ''}{x.diff})</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="muted-sm">{op.postConfirmFooter}</p>
                <div className="modal-foot">
                  <button type="button" className="btn btn-ghost btn-block" onClick={() => setConfirmPost(false)}>{op.cancel}</button>
                  <button className="btn btn-primary btn-block" disabled={busy} onClick={doPost}>
                    {busy ? op.processing : op.yesPost}
                  </button>
                </div>
              </div>
          </Modal>
        )}
      </>
    )
  }

  // ---------- TAMPILAN DAFTAR SESI ----------
  return (
    <>
      {msg && <div className="alert alert-ok" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{msg}</span><button className="icon-btn" onClick={() => setMsg('')} aria-label={op.close}>✕</button></div>}
      {err && <div className="alert alert-err">{err}</div>}

      <div className="toolbar">
        <p className="muted-sm" style={{ flex: 1, margin: 0 }}>
          {op.hint}
        </p>
        <button className="btn btn-primary" onClick={start} disabled={busy}>
          {draft ? op.continueDraft : op.startOpname}
        </button>
      </div>

      {list.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="ee"><ClipboardCheck size={36} /></div>
          <h3>{op.emptyTitle}</h3>
          <p>{op.emptyDesc}</p>
          <button className="btn btn-primary" onClick={start} disabled={busy}>{op.startFirst}</button>
        </div></div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>{op.thNumber}</th><th>{op.thDate}</th><th>{op.thCounted}</th><th>{op.thDiff}</th><th>{op.thStatus}</th><th></th>
            </tr></thead>
            <tbody>
              {list.map((s) => {
                const st = SO_STATUS[s.status] || SO_STATUS.draft
                const sum = opnameSummary(s.items)
                return (
                  <tr key={s.id}>
                    <td><b>{s.opname_number}</b></td>
                    <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{fmtDate(s.posted_at || s.created_at)}</td>
                    <td>{sum.counted} / {sum.total}</td>
                    <td>
                      {sum.diffs.length === 0
                        ? <span className="muted-sm">{op.noDiff}</span>
                        : <span>{sum.plus > 0 && <span className="amt-in">+{sum.plus} {op.productsUnit}</span>}{sum.plus > 0 && sum.minus > 0 && ' · '}{sum.minus > 0 && <span className="amt-out">−{sum.minus} {op.productsUnit}</span>}</span>}
                    </td>
                    <td><span className={`badge ${st.cls}`}>{soStatusLabel(s.status)}</span></td>
                    <td>
                      <div className="row-actions">
                        <button className="linklike" onClick={() => { setMsg(''); setErr(''); setDetail(s) }}>
                          {s.status === 'draft' ? op.continueLink : op.viewLink}
                        </button>
                        {s.status === 'draft' && (
                          <button className="icon-btn danger" title={op.cancelSessionTitle} aria-label={op.cancelSessionTitle} onClick={() => cancelSession(s)}><Trash2 size={15} /></button>
                        )}
                        {s.status === 'cancelled' && (
                          <button className="icon-btn danger" title={op.delHistoryTitle} aria-label={op.delHistoryTitle} onClick={() => removeSession(s)}><Trash2 size={15} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
