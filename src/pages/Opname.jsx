import { useEffect, useState } from 'react'
import { ClipboardCheck, ArrowLeft, Trash2 } from 'lucide-react'
import {
  fetchOpnames, addOpname, updateOpname, deleteOpname, postOpname, fetchProducts,
} from '../lib/api'
import { nextDocNumber, buildOpnameItems, opnameDiff, opnameSummary, SO_STATUS } from '../lib/gudang'
import { fmtDate } from '../lib/format'

// Stock Opname bersesi: Draf (isi hitung fisik, bisa disimpan berkali-kali)
// -> Posting (stok sistem DISET = hasil hitung; sesi terkunci) / Batal.
export default function Opname() {
  const [list, setList] = useState(null)
  const [detail, setDetail] = useState(null)   // sesi yang sedang dibuka
  const [confirmPost, setConfirmPost] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const load = () => fetchOpnames().then(setList).catch(() => setList([]))
  useEffect(() => { load() }, [])

  const draft = (list || []).find((s) => s.status === 'draft')

  const start = async () => {
    setErr(''); setMsg('')
    if (draft) { setDetail(draft); return } // satu draf aktif dalam satu waktu
    setBusy(true)
    try {
      const products = await fetchProducts()
      if (!products.length) { setErr('Belum ada produk. Tambahkan produk di menu Stok Produk dulu.'); return }
      const created = await addOpname({
        opname_number: nextDocNumber('SO', (list || []).map((x) => x.opname_number)),
        status: 'draft',
        items: buildOpnameItems(products),
      })
      setList((prev) => [created, ...(prev || [])])
      setDetail(created)
      setMsg(`${created.opname_number} dimulai. Isi kolom "Stok fisik" sesuai hasil hitung di gudang.`)
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
      setMsg('Draf tersimpan. Anda bisa melanjutkan hitung kapan saja.')
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
          ? `${res.opname.opname_number} diposting. Tidak ada selisih — stok sistem sudah akurat. 👍`
          : `${res.opname.opname_number} diposting. Stok dikoreksi: ` +
            res.changes.map((c) => `${c.name} ${c.before} → ${c.after} ${c.unit}`).join('; ') + '.'
      )
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const cancelSession = async (s) => {
    if (!confirm(`Batalkan ${s.opname_number}? Hasil hitung di sesi ini dibuang, stok tidak berubah.`)) return
    try {
      const upd = await updateOpname(s.id, { status: 'cancelled' })
      setList((prev) => prev.map((x) => (x.id === upd.id ? upd : x)))
      if (detail?.id === s.id) setDetail(null)
    } catch (e2) { setErr(e2.message) }
  }

  const removeSession = async (s) => {
    if (!confirm(`Hapus ${s.opname_number} dari riwayat?`)) return
    try {
      await deleteOpname(s.id)
      setList((prev) => prev.filter((x) => x.id !== s.id))
      if (detail?.id === s.id) setDetail(null)
    } catch (e2) { setErr(e2.message) }
  }

  if (!list) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  // ---------- TAMPILAN DETAIL SESI ----------
  if (detail) {
    const editable = detail.status === 'draft'
    const sum = opnameSummary(detail.items)
    return (
      <>
        {msg && <div className="alert alert-ok" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{msg}</span><button className="icon-btn" onClick={() => setMsg('')} aria-label="Tutup">✕</button></div>}
        {err && <div className="alert alert-err">{err}</div>}

        <div className="toolbar">
          <button className="btn btn-ghost" onClick={() => { setDetail(null); setMsg('') }}>
            <ArrowLeft size={15} style={{ verticalAlign: '-3px', marginRight: 4 }} />Kembali
          </button>
          <b style={{ fontSize: 16 }}>{detail.opname_number}</b>
          <span className={`badge ${(SO_STATUS[detail.status] || SO_STATUS.draft).cls}`}>{(SO_STATUS[detail.status] || SO_STATUS.draft).label}</span>
          <span className="muted-sm">{fmtDate(detail.created_at)}</span>
          <div style={{ flex: 1 }} />
          {editable && (
            <>
              <button className="btn btn-ghost" onClick={saveDraft} disabled={busy}>Simpan Draf</button>
              <button className="btn btn-primary" onClick={() => { setErr(''); setConfirmPost(true) }} disabled={busy || sum.counted === 0}>
                Posting Opname
              </button>
            </>
          )}
        </div>

        <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>Produk</th><th>Satuan</th><th style={{ textAlign: 'right' }}>Stok sistem</th>
              <th>Stok fisik (hasil hitung)</th><th style={{ textAlign: 'right' }}>Selisih</th>
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
                          value={it.counted_qty ?? ''} placeholder="belum dihitung"
                          onChange={(e) => setCounted(it.product_id, e.target.value)} />
                      ) : (
                        <span>{it.counted_qty ?? <span className="muted-sm">tidak dihitung</span>}</span>
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
          {sum.counted} dari {sum.total} produk sudah dihitung · selisih lebih: {sum.plus} · selisih kurang: {sum.minus}.
          {editable && ' Baris yang tidak diisi akan dilewati saat posting (stok tidak berubah).'}
        </p>

        {/* Konfirmasi posting: tampilkan HANYA selisih agar keputusan jelas (HCI rule 4 & 5) */}
        {confirmPost && (
          <div className="modal-backdrop" onClick={() => setConfirmPost(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>Posting {detail.opname_number}?</h3>
                <button type="button" className="icon-btn" onClick={() => setConfirmPost(false)}>✕</button>
              </div>
              <div className="modal-body">
                {sum.diffs.length === 0 ? (
                  <p style={{ marginTop: 0 }}>Tidak ada selisih — stok sistem sudah sesuai hitung fisik. Sesi akan dikunci sebagai arsip.</p>
                ) : (
                  <>
                    <p style={{ marginTop: 0 }}>Stok sistem akan <b>diset mengikuti hasil hitung fisik</b> untuk {sum.diffs.length} produk:</p>
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
                <p className="muted-sm">Setelah diposting, sesi terkunci dan menjadi arsip pembanding opname berikutnya.</p>
                <div className="modal-foot">
                  <button type="button" className="btn btn-ghost btn-block" onClick={() => setConfirmPost(false)}>Batal</button>
                  <button className="btn btn-primary btn-block" disabled={busy} onClick={doPost}>
                    {busy ? 'Memproses...' : 'Ya, Posting'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  // ---------- TAMPILAN DAFTAR SESI ----------
  return (
    <>
      {msg && <div className="alert alert-ok" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{msg}</span><button className="icon-btn" onClick={() => setMsg('')} aria-label="Tutup">✕</button></div>}
      {err && <div className="alert alert-err">{err}</div>}

      <div className="toolbar">
        <p className="muted-sm" style={{ flex: 1, margin: 0 }}>
          Hitung stok fisik di gudang, cocokkan dengan sistem, lalu posting untuk mengoreksi stok. Satu sesi draf dalam satu waktu.
        </p>
        <button className="btn btn-primary" onClick={start} disabled={busy}>
          {draft ? 'Lanjutkan Draf' : '+ Mulai Opname'}
        </button>
      </div>

      {list.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="ee"><ClipboardCheck size={36} /></div>
          <h3>Belum ada sesi opname</h3>
          <p>Opname rutin (mis. tiap akhir bulan) menjaga stok sistem tetap sama dengan stok nyata di gudang.</p>
          <button className="btn btn-primary" onClick={start} disabled={busy}>+ Mulai Opname Pertama</button>
        </div></div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>No. Opname</th><th>Tanggal</th><th>Produk dihitung</th><th>Selisih</th><th>Status</th><th></th>
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
                        ? <span className="muted-sm">tidak ada</span>
                        : <span>{sum.plus > 0 && <span className="amt-in">+{sum.plus} produk</span>}{sum.plus > 0 && sum.minus > 0 && ' · '}{sum.minus > 0 && <span className="amt-out">−{sum.minus} produk</span>}</span>}
                    </td>
                    <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                    <td>
                      <div className="row-actions">
                        <button className="linklike" onClick={() => { setMsg(''); setErr(''); setDetail(s) }}>
                          {s.status === 'draft' ? 'Lanjutkan' : 'Lihat'}
                        </button>
                        {s.status === 'draft' && (
                          <button className="icon-btn danger" title="Batalkan sesi" aria-label="Batalkan sesi" onClick={() => cancelSession(s)}><Trash2 size={15} /></button>
                        )}
                        {s.status === 'cancelled' && (
                          <button className="icon-btn danger" title="Hapus dari riwayat" aria-label="Hapus dari riwayat" onClick={() => removeSession(s)}><Trash2 size={15} /></button>
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
