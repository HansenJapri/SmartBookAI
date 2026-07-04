import { useEffect, useMemo, useState } from 'react'
import { Save, Eye, Pencil, RotateCcw } from 'lucide-react'
import { getLegalDocs, saveLegalDoc } from '../lib/adminApi'
import { renderLegalMarkdown } from '../lib/legalRender'
import { fmtDateTime } from '../lib/format'
import { Spinner } from '../components/ui'

const TABS = [
  { slug: 'terms', title: 'Syarat dan Ketentuan' },
  { slug: 'privacy', title: 'Kebijakan Privasi' },
]

export default function LegalAdmin() {
  const [docs, setDocs] = useState(null)        // { terms: {...}, privacy: {...} }
  const [active, setActive] = useState('terms')
  const [draft, setDraft] = useState('')        // isi yang sedang diedit
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [mobileView, setMobileView] = useState('edit') // 'edit' | 'preview' (untuk layar kecil)

  const load = () =>
    getLegalDocs()
      .then((rows) => {
        const map = {}
        rows.forEach((r) => { map[r.slug] = r })
        setDocs(map)
      })
      .catch((e) => { console.error(e); setDocs({}) })

  useEffect(() => { load() }, [])

  // Saat ganti tab atau data dimuat, isi ulang draft dari dokumen aktif.
  useEffect(() => {
    if (docs) setDraft(docs[active]?.content || '')
    setMsg('')
  }, [docs, active])

  const current = docs?.[active]
  const dirty = useMemo(() => current && draft !== (current.content || ''), [current, draft])
  const previewHtml = useMemo(() => renderLegalMarkdown(draft), [draft])

  const save = async () => {
    setBusy(true); setMsg('')
    try {
      const title = current?.title || TABS.find((t) => t.slug === active)?.title || active
      const saved = await saveLegalDoc(active, title, draft)
      setDocs((d) => ({ ...d, [active]: saved }))
      setMsg('Tersimpan. Perubahan langsung tampil di sisi pengguna.')
    } catch (e) {
      setMsg('Gagal menyimpan: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const reset = () => { if (current) setDraft(current.content || '') }

  if (!docs) return <Spinner />

  return (
    <div className="legal-admin">
      <div className="card legal-help">
        <b>Cara menulis</b>
        <p className="muted-sm">
          Gunakan format sederhana berikut. Perubahan yang disimpan langsung tampil di halaman
          Syarat &amp; Ketentuan dan Kebijakan Privasi milik pengguna secara real-time.
        </p>
        <ul className="muted-sm">
          <li><code>## Judul Bagian</code> untuk judul (mis. "## 1. Definisi")</li>
          <li><code>### Subjudul</code> untuk sub-bagian</li>
          <li><code>**teks tebal**</code> untuk menebalkan kata penting</li>
          <li><code>- item</code> di awal baris untuk daftar berpoin</li>
          <li><code>[teks tautan](https://...)</code> untuk membuat tautan</li>
          <li>Baris kosong memisahkan paragraf</li>
        </ul>
      </div>

      <div className="toolbar legal-tabs">
        {TABS.map((t) => (
          <button key={t.slug}
            className={`btn btn-sm ${active === t.slug ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActive(t.slug)}>
            {t.title}{docs[t.slug] ? '' : ' (belum ada)'}
          </button>
        ))}
        <span className="grow" />
        {current?.updated_at && (
          <span className="muted-sm">Terakhir diperbarui {fmtDateTime(current.updated_at)}</span>
        )}
      </div>

      {/* Pengalih tampilan untuk layar kecil */}
      <div className="legal-seg">
        <button className={mobileView === 'edit' ? 'on' : ''} onClick={() => setMobileView('edit')}>
          <Pencil size={15} /> Tulis
        </button>
        <button className={mobileView === 'preview' ? 'on' : ''} onClick={() => setMobileView('preview')}>
          <Eye size={15} /> Pratinjau
        </button>
      </div>

      <div className="legal-grid">
        <div className={`card legal-pane ${mobileView === 'edit' ? '' : 'hide-sm'}`}>
          <div className="legal-pane-head"><Pencil size={15} /> Tulis (format sederhana)</div>
          <textarea className="input legal-area" value={draft}
            onChange={(e) => setDraft(e.target.value)} spellCheck={false}
            placeholder="Tulis isi dokumen di sini..." />
        </div>

        <div className={`card legal-pane ${mobileView === 'preview' ? '' : 'hide-sm'}`}>
          <div className="legal-pane-head"><Eye size={15} /> Pratinjau (tampilan pengguna)</div>
          <div className="legal-preview legal-doc" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      </div>

      <div className="legal-actions">
        <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>
          <Save size={16} /> {busy ? 'Menyimpan...' : 'Simpan & terbitkan'}
        </button>
        <button className="btn btn-ghost" onClick={reset} disabled={busy || !dirty}>
          <RotateCcw size={16} /> Batalkan perubahan
        </button>
        {dirty && <span className="muted-sm" style={{ color: 'var(--amber, #b45309)' }}>Ada perubahan belum disimpan</span>}
        {msg && <span className="muted-sm">{msg}</span>}
      </div>
    </div>
  )
}
