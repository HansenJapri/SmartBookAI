import { useEffect, useMemo, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { listTransactions, listUsers, updateTransaction, deleteTransaction, subscribe } from '../lib/adminApi'
import { rupiah, rupiahShort, num, fmtDateTime } from '../lib/format'
import { Modal, Spinner } from '../components/ui'

export default function Transactions() {
  const [params, setParams] = useSearchParams()
  const [users, setUsers] = useState(null)
  const [userId, setUserId] = useState(params.get('user') || '')
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [dir, setDir] = useState('all')
  const [edit, setEdit] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // Daftar akun (sekali) - untuk pemilih akun.
  useEffect(() => {
    listUsers().then((u) => {
      setUsers(u)
      setUserId((cur) => cur || (u[0]?.id ?? ''))
    }).catch((e) => { console.error(e); setUsers([]) })
  }, [])

  // Transaksi HANYA untuk akun terpilih + realtime.
  const loadTx = useCallback(async () => {
    if (!userId) { setRows([]); return }
    try { setRows(await listTransactions({ userId, limit: 2000 })) }
    catch (e) { console.error(e); setRows([]) }
  }, [userId])

  useEffect(() => {
    setRows(null)
    loadTx()
    const unsub = subscribe('transactions', loadTx)
    return unsub
  }, [loadTx])

  // Simpan pilihan akun ke URL (bisa di-bookmark / dibuka dari halaman Pengguna).
  useEffect(() => {
    if (userId) setParams((p) => { p.set('user', userId); return p }, { replace: true })
  }, [userId]) // eslint-disable-line

  const selectedUser = useMemo(() => users?.find((u) => u.id === userId) || null, [users, userId])

  const filtered = useMemo(() => {
    if (!rows) return []
    const s = q.trim().toLowerCase()
    return rows.filter((r) =>
      (dir === 'all' || r.direction === dir) &&
      (!s || (r.description || '').toLowerCase().includes(s) || (r.category || '').toLowerCase().includes(s)))
  }, [rows, q, dir])

  const summary = useMemo(() => {
    let income = 0, expense = 0
    for (const r of rows || []) (r.direction === 'in' ? (income += Number(r.amount)) : (expense += Number(r.amount)))
    return { income, expense, balance: income - expense, count: (rows || []).length }
  }, [rows])

  const save = async (e) => {
    e.preventDefault(); setSaving(true); setErr('')
    try {
      await updateTransaction(edit.id, {
        description: edit.description, amount: Number(edit.amount),
        direction: edit.direction, category: edit.category,
      })
      setEdit(null); await loadTx()
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  const remove = async (r) => {
    if (!confirm(`Hapus transaksi "${r.description}" (${rupiah(r.amount)})?`)) return
    try { await deleteTransaction(r.id); await loadTx() } catch (e) { alert(e.message) }
  }

  if (!users) return <Spinner />
  if (users.length === 0) {
    return <div className="card"><div className="empty"><div className="ee">👥</div><h3>Belum ada pengguna</h3><p>Belum ada akun yang bisa ditampilkan transaksinya.</p></div></div>
  }

  const label = (u) => `${u.business_name || u.owner_name || 'Tanpa nama'} - ${u.email} (${num(u.tx_count)} tx)`

  return (
    <>
      {/* PEMILIH AKUN - transaksi ditampilkan per-akun, bukan semua sekaligus */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>📂 Pilih akun yang ingin dilihat transaksinya</label>
          <select className="input" value={userId} onChange={(e) => { setUserId(e.target.value); setQ(''); setDir('all') }}>
            {users.map((u) => <option key={u.id} value={u.id}>{label(u)}</option>)}
          </select>
        </div>
      </div>

      {/* RINGKASAN AKUN TERPILIH */}
      {selectedUser && (
        <div className="kpi-grid" style={{ marginBottom: 18 }}>
          <div className="kpi">
            <div className="k-l">🏪 Akun</div>
            <div className="k-v" style={{ fontSize: 18 }}>{selectedUser.business_name || selectedUser.owner_name || '-'}</div>
            <div className="k-d">{selectedUser.email}</div>
          </div>
          <div className="kpi"><div className="k-l">🧾 Jumlah Transaksi</div><div className="k-v">{num(summary.count)}</div><div className="k-d">akun ini</div></div>
          <div className="kpi"><div className="k-l">⬇️ Pemasukan</div><div className="k-v" style={{ color: 'var(--green)' }}>{rupiahShort(summary.income)}</div></div>
          <div className="kpi"><div className="k-l">⬆️ Pengeluaran</div><div className="k-v" style={{ color: 'var(--red)' }}>{rupiahShort(summary.expense)}</div></div>
          <div className="kpi"><div className="k-l">💼 Saldo</div><div className="k-v" style={{ color: summary.balance >= 0 ? 'var(--green)' : 'var(--red)' }}>{rupiahShort(summary.balance)}</div></div>
        </div>
      )}

      <div className="toolbar">
        <input className="input" placeholder="🔎 Cari keterangan / kategori di akun ini..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: 160, flex: 'none' }} value={dir} onChange={(e) => setDir(e.target.value)}>
          <option value="all">Semua arah</option>
          <option value="in">Pemasukan</option>
          <option value="out">Pengeluaran</option>
        </select>
        <span className="muted-sm grow" style={{ textAlign: 'right' }}>{num(filtered.length)} transaksi ditampilkan</span>
      </div>

      {rows === null ? <Spinner /> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Tanggal</th><th>Keterangan</th><th>Kategori</th><th>Channel</th><th className="num">Nominal</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.slice(0, 500).map((r) => (
                <tr key={r.id}>
                  <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.occurred_at)}</td>
                  <td>{r.description}</td>
                  <td><span className="pill">{r.category}</span></td>
                  <td className="muted-sm">{r.channel}</td>
                  <td className="num" style={{ color: r.direction === 'in' ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                    {r.direction === 'in' ? '+' : '-'}{rupiah(r.amount)}
                  </td>
                  <td>
                    <div className="t-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ ...r })}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(r)}>Hapus</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6}><div className="empty"><div className="ee">🧾</div><p>Akun ini belum punya transaksi yang cocok.</p></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > 500 && <p className="muted-sm" style={{ marginTop: 10 }}>Menampilkan 500 teratas. Persempit dengan pencarian.</p>}

      {edit && (
        <Modal title="Edit Transaksi" onClose={() => setEdit(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>Batal</button>
            <button className="btn btn-primary" form="edit-tx" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
          </>}>
          <form id="edit-tx" onSubmit={save}>
            {err && <div className="alert alert-err">{err}</div>}
            <div className="muted-sm" style={{ marginBottom: 12 }}>Akun: <b>{selectedUser?.business_name || selectedUser?.email}</b></div>
            <div className="field"><label>Keterangan</label>
              <input className="input" value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} required /></div>
            <div className="grid-2">
              <div className="field"><label>Nominal</label>
                <input className="input" type="number" min="0" step="0.01" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} required /></div>
              <div className="field"><label>Arah</label>
                <select className="input" value={edit.direction} onChange={(e) => setEdit({ ...edit, direction: e.target.value })}>
                  <option value="in">Pemasukan</option>
                  <option value="out">Pengeluaran</option>
                </select></div>
            </div>
            <div className="field"><label>Kategori</label>
              <input className="input" value={edit.category || ''} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></div>
          </form>
        </Modal>
      )}
    </>
  )
}
