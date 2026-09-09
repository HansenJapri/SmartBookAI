import { useEffect, useMemo, useState } from 'react'
import { ScrollText, RefreshCw, Sparkles } from 'lucide-react'
import { fetchAuditLogs, fetchAiActivity, fetchStaff } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useLang } from '../context/LangContext'
import { fmtDateTime, rupiah } from '../lib/format'

const ACTION_CLS = { INSERT: 'badge-green', UPDATE: 'badge-amber', DELETE: 'badge-red' }

// Audit Log (owner): rekam jejak permanen siapa-mengubah-apa-kapan.
// Baris ditulis trigger database — aplikasi tidak bisa memalsukan/menghapusnya.
export default function Audit() {
  const { t } = useLang()
  const a = t.audit
  // Ringkasan mudah dibaca dari payload jsonb log.
  const summarize = (log) => {
    const c = log.changed || {}
    if (log.action === 'UPDATE') {
      const parts = Object.entries(c).slice(0, 3).map(([k, v]) => {
        const [oldV, newV] = Array.isArray(v) ? v : [null, v]
        const show = (x) => (x === null || x === undefined ? '-' : typeof x === 'object' ? '(data)' : String(x))
        return `${k}: ${show(oldV)} → ${show(newV)}`
      })
      const extra = Object.keys(c).length > 3 ? ` ${a.moreCols.replace('{n}', Object.keys(c).length - 3)}` : ''
      return parts.join('; ') + extra || a.noColChange
    }
    // Kolom yang menjadi "judul" sebuah baris BERBEDA per tabel, dan daftar
    // lama hanya memuat empat di antaranya. `tasks` menyimpan judulnya di
    // kolom `title` — tidak ada di daftar — sehingga setiap tugas yang dicatat
    // muncul sebagai "id b7cf7acf". Bagi pemilik usaha yang membuka Audit Log
    // untuk menelusuri siapa mengubah apa, potongan UUID tidak memberitahu
    // apa pun; ia justru membuat log terlihat rusak.
    const name = c.title || c.description || c.name || c.po_number
      || c.opname_number || c.label || c.keyword || c.email || c.month || ''
    const amt = c.amount ? ` — ${rupiah(Number(c.amount))}` : ''
    const ringkas = `${name}${amt}`.trim()
    // Fallback terakhir tetap ada, tapi kini menyebut JENIS datanya, bukan
    // hanya potongan id yang tidak bisa dibaca siapa pun.
    return ringkas || `${a.tables[log.table_name] || log.table_name} (${String(log.row_id || '').slice(0, 8)})`
  }
  const [logs, setLogs] = useState(null)
  const [staff, setStaff] = useState([])
  const [me, setMe] = useState(null)
  const [table, setTable] = useState('')
  const [action, setAction] = useState('')
  const [via, setVia] = useState('')
  const [aiRows, setAiRows] = useState([])
  const [err, setErr] = useState('')

  const load = () => {
    setErr('')
    fetchAuditLogs({ table, action, via }).then(setLogs).catch((e) => { setLogs([]); setErr(e.message) })
    // Aktivitas AI dimuat terpisah: ia BUKAN perubahan data, jadi ia tabel
    // tersendiri dengan bentuk baris yang berbeda. Lihat alasannya di
    // supabase/migration_audit_ai.sql.
    fetchAiActivity({ limit: 200 }).then(setAiRows).catch(() => setAiRows([]))
  }
  useEffect(() => { load() }, [table, action, via]) // eslint-disable-line
  useEffect(() => {
    fetchStaff().then(setStaff).catch(() => {})
    supabase.auth.getUser().then(({ data }) => setMe(data?.user?.id || null))
  }, [])

  const actorLabel = useMemo(() => (id) => {
    if (!id) return a.actorSystem
    if (id === me) return a.actorYou
    const s = staff.find((x) => x.member_id === id)
    // NAMA, bukan email. Audit Log dibaca pemilik usaha, dan yang ia kenali
    // adalah "Budi" — bukan alamat surel yang harus dicocokkan lebih dulu ke
    // orangnya. Email tetap ada di menu Pengguna & Akses bila perlu dipastikan.
    return s?.name || a.actorStaff
  }, [me, staff, a])

  if (!logs) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <>
      {err && <div className="alert alert-err">{err}</div>}
      <div className="toolbar">
        <select className="input" style={{ maxWidth: 200 }} value={table} onChange={(e) => setTable(e.target.value)} aria-label={a.allData}>
          <option value="">{a.allData}</option>
          {Object.entries(a.tables).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" style={{ maxWidth: 160 }} value={action} onChange={(e) => setAction(e.target.value)} aria-label={a.allActions}>
          <option value="">{a.allActions}</option>
          {Object.entries(a.actions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" style={{ maxWidth: 170 }} value={via} onChange={(e) => setVia(e.target.value)} aria-label={a.allVia}>
          <option value="">{a.allVia}</option>
          <option value="manual">{a.viaManual}</option>
          <option value="ai">{a.viaAi}</option>
        </select>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={load}>
          <RefreshCw size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />{a.reload}
        </button>
      </div>

      {logs.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="ee"><ScrollText size={36} /></div>
          <h3>{a.emptyTitle}</h3>
          <p>{a.emptyDesc}</p>
        </div></div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>{a.thTime}</th><th>{a.thAction}</th><th>{a.thData}</th><th>{a.thSummary}</th><th>{a.thActor}</th></tr></thead>
            <tbody>
              {logs.map((l) => {
                const label = a.actions[l.action] || l.action
                const cls = ACTION_CLS[l.action] || 'badge-indigo'
                return (
                  <tr key={l.id}>
                    <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(l.created_at)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className={`badge ${cls}`}>{label}</span>
                      {l.via === 'ai' && (
                        <span className="badge badge-indigo" style={{ marginLeft: 6 }} title={a.viaAiHint}>
                          <Sparkles size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />
                          {a.viaAi}
                        </span>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{a.tables[l.table_name] || l.table_name}</td>
                    <td style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis' }}>{summarize(l)}</td>
                    <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{actorLabel(l.actor_id)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted-sm mt">{a.footNote}</p>

      {/* ---- Aktivitas asisten AI ----
          Bagian TERPISAH, bukan baris tambahan di tabel atas. Mode Tanya tidak
          mengubah data apa pun: ia tidak punya table_name, action, atau baris
          yang berubah. Memaksanya masuk tabel di atas berarti mengarang nilai
          untuk kolom-kolom itu. */}
      <div className="card card-pad mt">
        <h3 className="card-title">
          <Sparkles size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />
          {a.aiTitle}
        </h3>
        <p className="muted-sm" style={{ marginTop: -4 }}>{a.aiHint}</p>
        {!aiRows.length ? (
          <p className="muted-sm">{a.aiEmpty}</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>{a.thTime}</th><th>{a.thAction}</th><th>{a.thData}</th><th>{a.thSummary}</th><th>{a.thActor}</th></tr></thead>
              <tbody>
                {aiRows.slice(0, 100).map((r) => {
                  // Bentuk baris aktivitas AI disamakan dengan tabel audit di
                  // atas: waktu, aksi, data, ringkasan, pelaku. Sebelumnya
                  // hanya fitur & hasil, sehingga "AI melakukan apa, pada data
                  // apa" tidak bisa dijawab tanpa membuka database.
                  const aksiList = Array.isArray(r.meta?.aksi) ? r.meta.aksi : []
                  const opLabel = { create: a.actions.INSERT, update: a.actions.UPDATE, delete: a.actions.DELETE }
                  const aksiTeks = aksiList.length
                    ? [...new Set(aksiList.map((x) => opLabel[x.operation] || x.operation))].join(', ')
                    : (a.aiFeatures[r.feature] || r.feature)
                  const dataTeks = aksiList.length
                    ? [...new Set(aksiList.map((x) => a.tables[x.entity] || x.entity))].join(', ')
                    : (r.meta?.fokus || '—')
                  return (
                  <tr key={r.id}>
                    <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.created_at)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{aksiTeks}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{dataTeks}</td>
                    <td>
                      <span className={`badge ${r.outcome === 'ok' ? 'badge-green' : r.outcome === 'limit' ? 'badge-amber' : 'badge-red'}`}>
                        {a.aiOutcomes[r.outcome] || r.outcome}
                      </span>
                      <span className="muted-sm" style={{ marginLeft: 6 }}>
                        {a.aiFeatures[r.feature] || r.feature}
                      </span>
                      {/* Domain yang DITOLAK hak akses ikut ditampilkan: itu
                          justru informasi audit yang paling berguna di sini —
                          ada yang mencoba menanyakan modul di luar haknya. */}
                      {Array.isArray(r.meta?.ditolak) && r.meta.ditolak.length > 0 && (
                        <span className="badge badge-red" style={{ marginLeft: 6 }}>
                          {a.aiDenied.replace('{modules}', r.meta.ditolak.join(', '))}
                        </span>
                      )}
                    </td>
                    <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{actorLabel(r.actor_id)}</td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted-sm mt">{a.aiFootNote}</p>
      </div>
    </>
  )
}
