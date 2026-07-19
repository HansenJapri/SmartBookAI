import { useEffect, useMemo, useState } from 'react'
import { Bell, Plus } from 'lucide-react'
import { fetchReminders, addReminder, updateReminder, deleteReminder } from '../lib/api'
import { normalizePhone } from '../lib/aging'
import { fmtDateTime } from '../lib/format'

// Pengingat penting (mis. "ambil stok jam 3 sore"). Yang sudah jatuh waktu
// tampil sebagai notifikasi di atas Dashboard TERUS-MENERUS sampai pengguna
// menekan silang. Tombol WA membuka WhatsApp ke nomor sendiri dengan teks
// pengingat siap kirim (diatur per pengingat).
export default function Reminders() {
  const [list, setList] = useState(null)
  const [form, setForm] = useState(null) // {title, note, remind_at(datetime-local), wa_number}
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [tick, setTick] = useState(0) // supaya status "jatuh waktu" ikut bergerak

  useEffect(() => { fetchReminders().then(setList).catch(() => setList([])) }, [])
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  const now = Date.now()
  // "tick" ikut dependensi agar daftar dievaluasi ulang tiap menit —
  // pengingat berpindah ke notifikasi tepat saat jatuh waktu.
  const due = useMemo(
    () => (list || []).filter((r) => new Date(r.remind_at).getTime() <= now),
    [list, tick], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const upcoming = useMemo(
    () => (list || []).filter((r) => new Date(r.remind_at).getTime() > now).slice(0, 5),
    [list, tick], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const dismiss = async (r) => {
    try {
      await updateReminder(r.id, { status: 'selesai', dismissed_at: new Date().toISOString() })
      setList((prev) => prev.filter((x) => x.id !== r.id))
    } catch (e) { setErr(e.message) }
  }

  const remove = async (r) => {
    if (!confirm(`Hapus pengingat "${r.title}"?`)) return
    try {
      await deleteReminder(r.id)
      setList((prev) => prev.filter((x) => x.id !== r.id))
    } catch (e) { setErr(e.message) }
  }

  const waHref = (r) => {
    const ph = normalizePhone(r.wa_number || '')
    if (!ph) return null
    const text = `Pengingat: ${r.title}${r.note ? ` — ${r.note}` : ''} (${fmtDateTime(r.remind_at)})`
    return `https://wa.me/${ph}?text=${encodeURIComponent(text)}`
  }

  const save = async (e) => {
    e.preventDefault()
    setErr('')
    if (!form.title.trim()) return setErr('Judul pengingat wajib diisi.')
    if (!form.remind_at) return setErr('Tanggal & jam pengingat wajib diisi.')
    setBusy(true)
    try {
      const created = await addReminder({
        title: form.title.trim(),
        note: form.note.trim() || null,
        remind_at: new Date(form.remind_at).toISOString(),
        wa_number: form.wa_number.trim() || null,
      })
      setList((prev) => [...(prev || []), created].sort((a, b) => a.remind_at < b.remind_at ? -1 : 1))
      setForm(null)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  if (!list) return null

  return (
    <>
      {err && <div className="alert alert-err">{err}</div>}

      {/* NOTIFIKASI JATUH WAKTU — bertahan sampai pengguna menekan silang */}
      {due.map((r) => (
        <div key={r.id} className="alert alert-warn" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Bell size={16} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 200 }}>
            <b>{r.title}</b>{r.note ? ` — ${r.note}` : ''} · {fmtDateTime(r.remind_at)}
          </span>
          {waHref(r) && (
            <a className="linklike" href={waHref(r)} target="_blank" rel="noreferrer noopener">Kirim ke WA</a>
          )}
          <button className="icon-btn" onClick={() => dismiss(r)} aria-label={`Tutup pengingat ${r.title}`}>✕</button>
        </div>
      ))}

      {/* KARTU KELOLA PENGINGAT */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="flex between" style={{ alignItems: 'center' }}>
          <div>
            <h3 className="card-title"><Bell size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />Pengingat</h3>
            <div className="card-sub">Muncul terus di sini saat jatuh waktu, sampai Anda menutupnya. Bisa dikirim ke WA sendiri.</div>
          </div>
          <button className="btn btn-ghost" onClick={() => { setErr(''); setForm({ title: '', note: '', remind_at: '', wa_number: '' }) }}>
            <Plus size={15} style={{ verticalAlign: '-2px' }} /> Pengingat
          </button>
        </div>
        {upcoming.length === 0 && due.length === 0 ? (
          <p className="muted-sm" style={{ margin: '10px 0 0' }}>
            Belum ada pengingat. Contoh: "Ambil stok di gudang" jam 15.00, atau "Antar pesanan Bu Sari" jam 17.00.
          </p>
        ) : upcoming.length > 0 && (
          <ul className="sig-drivers" style={{ marginTop: 10 }}>
            {upcoming.map((r) => (
              <li key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ flex: 1 }}><b>{r.title}</b> · {fmtDateTime(r.remind_at)}</span>
                <button className="linklike" style={{ color: 'var(--red)' }} onClick={() => remove(r)}>Hapus</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* MODAL TAMBAH PENGINGAT */}
      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <div className="modal-head">
              <h3>Tambah Pengingat</h3>
              <button type="button" className="icon-btn" onClick={() => setForm(null)}>✕</button>
            </div>
            <div className="modal-body">
              {err && <div className="alert alert-err">{err}</div>}
              <div className="field">
                <label>Judul</label>
                <input className="input" value={form.title} placeholder="cth: Ambil stok di gudang"
                  onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="field">
                <label>Catatan <span className="muted-sm">(opsional)</span></label>
                <input className="input" value={form.note} placeholder="cth: bawa mobil box"
                  onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Tanggal &amp; jam</label>
                  <input className="input" type="datetime-local" value={form.remind_at}
                    onChange={(e) => setForm({ ...form, remind_at: e.target.value })} />
                </div>
                <div className="field">
                  <label>No. WA sendiri <span className="muted-sm">(opsional)</span></label>
                  <input className="input" value={form.wa_number} placeholder="08xxxxxxxxxx"
                    onChange={(e) => setForm({ ...form, wa_number: e.target.value })} />
                </div>
              </div>
              <p className="muted-sm" style={{ margin: 0 }}>
                Bila No. WA diisi, saat pengingat jatuh waktu akan ada tombol "Kirim ke WA" — sekali tekan, teks
                pengingat terkirim ke WhatsApp Anda sendiri.
              </p>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost btn-block" onClick={() => setForm(null)}>Batal</button>
                <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
