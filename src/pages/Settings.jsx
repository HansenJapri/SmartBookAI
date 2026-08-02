import { useEffect, useState, useRef } from 'react'
import {
  fetchProfile, updateProfile, fetchRules, addRule, deleteRule,
  addCategory, updateCategory, deleteCategory, addChannel, updateChannel, deleteChannel,
  exportMyData, deleteMyData,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useCatalog } from '../context/CatalogContext'
import { useLang } from '../context/LangContext'
import { normalizePhone } from '../lib/validators'
import { fmtDateTime } from '../lib/format'
import { TERMS_VERSION } from '../lib/legal'
import { Link } from 'react-router-dom'
import { Pencil, Trash2 } from 'lucide-react'
import CrudList from '../components/CrudList'
import PinManager from '../components/PinManager'
import TwoFactor from '../components/TwoFactor'

const slug = (s) => (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || ('ch-' + Date.now())

// Memperkecil gambar logo lalu mengubahnya jadi data URL agar ringan disimpan.
function resizeImageToDataURL(file, max = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        let { width, height } = img
        if (width >= height && width > max) { height = Math.round(height * max / width); width = max }
        else if (height > max) { width = Math.round(width * max / height); height = max }
        const canvas = document.createElement('canvas')
        canvas.width = width; canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

// Kategori untuk satu jenis (pemasukan/pengeluaran).
function CatList({ direction, title, hint, items, reload, placeholder, dupMsg }) {
  return (
    <CrudList
      title={title} hint={hint} items={items}
      placeholder={placeholder}
      dupMsg={dupMsg}
      onAdd={async (n) => { await addCategory({ name: n, direction }); await reload() }}
      onRename={async (id, n) => { await updateCategory(id, { name: n, direction }); await reload() }}
      onDelete={async (id) => { await deleteCategory(id); await reload() }}
    />
  )
}

export default function Settings() {
  const { user } = useAuth()
  const { t } = useLang()
  const sg = t.settings
  const { categories, channels, reload, catNames } = useCatalog()
  const [profile, setProfile] = useState({ business_name: '', owner_name: '', business_type: '', phone: '', phone_verified: false, taxpayer_type: 'pribadi' })
  const [savedMsg, setSavedMsg] = useState('')

  const [rules, setRules] = useState([])
  const allCats = [...catNames('in'), ...catNames('out')]
  const [newRule, setNewRule] = useState({ keyword: '', category: '', direction: '' })

  const [newCh, setNewCh] = useState({ label: '', icon: '🏷️' })
  const [editChId, setEditChId] = useState(null)
  const [msg, setMsg] = useState('')
  const [notaMsg, setNotaMsg] = useState('')
  const logoRef = useRef()
  const [dataMsg, setDataMsg] = useState('')
  const [delText, setDelText] = useState('')
  const [delBusy, setDelBusy] = useState(false)

  useEffect(() => {
    fetchProfile().then((p) => p && setProfile((s) => ({ ...s, ...p }))).catch(() => {})
    fetchRules().then(setRules).catch(() => {})
  }, [])

  const saveProfile = async (e) => {
    e.preventDefault(); setSavedMsg('')
    const patch = {
      business_name: profile.business_name, owner_name: profile.owner_name,
      business_type: profile.business_type, taxpayer_type: profile.taxpayer_type,
      business_address: profile.business_address || null,
    }
    // Telepon opsional (task B5). Mengosongkan field lalu menyimpan HARUS
    // benar-benar menghapus nomornya: sebelumnya blok ini dilewati saat nilainya
    // kosong, sehingga nomor lama diam-diam bertahan dan tidak ada cara mencabut
    // data yang terlanjur diberikan — bertentangan dengan hak penghapusan data
    // pribadi (UU PDP 27/2022) sekaligus alasan telepon dijadikan opsional.
    const teleponDiisi = (profile.phone || '').trim()
    if (teleponDiisi) {
      const norm = normalizePhone(teleponDiisi)
      if (!norm) { setSavedMsg(sg.invalidPhone); return }
      patch.phone = norm
    } else {
      patch.phone = null
      patch.phone_verified = false // tanpa nomor, status verifikasi tidak punya arti
    }
    try { await updateProfile(patch); setSavedMsg(sg.profileSaved) }
    catch (err) { setSavedMsg(err.code === '23505' ? sg.phoneTaken : '⚠ ' + err.message) }
    setTimeout(() => setSavedMsg(''), 3000)
  }

  const onLogo = async (e) => {
    const f = e.target.files?.[0]; if (!f) return
    if (!f.type.startsWith('image/')) { setNotaMsg(sg.logoMustImage); return }
    if (f.size > 3 * 1024 * 1024) { setNotaMsg(sg.logoMaxSize); return }
    try { const dataUrl = await resizeImageToDataURL(f, 256); setProfile((p) => ({ ...p, logo_url: dataUrl })) }
    catch { setNotaMsg(sg.logoFail) }
  }

  const saveNota = async (e) => {
    e.preventDefault(); setNotaMsg('')
    try {
      await updateProfile({
        logo_url: profile.logo_url || null,
        invoice_server_label: profile.invoice_server_label || null,
        invoice_server_value: profile.invoice_server_value || null,
        invoice_show_server: !!profile.invoice_show_server,
        invoice_tax_percent: Number(profile.invoice_tax_percent) || 0,
        invoice_service_percent: Number(profile.invoice_service_percent) || 0,
      })
      setNotaMsg(sg.notaSaved)
    } catch (err) { setNotaMsg('⚠ ' + err.message) }
    setTimeout(() => setNotaMsg(''), 3000)
  }

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  const createCh = async (e) => {
    e.preventDefault()
    if (!newCh.label.trim()) return
    try {
      // Saat edit, nilai (slug) channel tidak diubah agar transaksi lama tetap cocok.
      if (editChId) { await updateChannel(editChId, { label: newCh.label.trim(), icon: newCh.icon }); flash(sg.chUpdated) }
      else { await addChannel({ value: slug(newCh.label), label: newCh.label, icon: newCh.icon }); flash(sg.chAdded) }
      setNewCh({ label: '', icon: '🏷️' }); setEditChId(null); await reload()
    } catch (err) { flash(err.code === '23505' ? sg.chDup : '⚠ ' + err.message) }
  }
  const startEditCh = (c) => { setEditChId(c.id); setNewCh({ label: c.label, icon: c.icon }) }
  const cancelEditCh = () => { setEditChId(null); setNewCh({ label: '', icon: '🏷️' }) }
  const removeCh = async (id) => { if (editChId === id) cancelEditCh(); await deleteChannel(id); await reload() }

  const createRule = async (e) => {
    e.preventDefault()
    if (!newRule.keyword.trim()) return
    const r = await addRule({ keyword: newRule.keyword.trim(), category: newRule.category || allCats[0], direction: newRule.direction || null })
    setRules((p) => [...p, r]); setNewRule({ keyword: '', category: '', direction: '' })
  }
  const removeRule = async (id) => { await deleteRule(id); setRules((p) => p.filter((r) => r.id !== id)) }

  const doExport = async () => {
    setDataMsg(sg.preparingFile)
    try {
      const all = await exportMyData()
      const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `SmartBook-DataSaya-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      setDataMsg(sg.dataDownloaded)
    } catch (e) { setDataMsg('⚠ ' + e.message) }
    setTimeout(() => setDataMsg(''), 3500)
  }

  const doDeleteAll = async () => {
    if (delText !== 'HAPUS') { setDataMsg(sg.typeHapus); return }
    setDelBusy(true); setDataMsg('')
    try {
      await deleteMyData()
      window.location.href = '/app' // muat ulang; data default dibuat ulang otomatis
    } catch (e) { setDataMsg('⚠ ' + e.message); setDelBusy(false) }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      {msg && <div className="alert alert-ok">{msg}</div>}

      {/* PROFIL */}
      <form className="card card-pad" onSubmit={saveProfile} style={{ marginBottom: 20 }}>
        <h3 className="card-title">{sg.profileTitle}</h3>
        <div className="card-sub">{sg.profileSub}</div>
        {savedMsg && <div className={savedMsg.startsWith('⚠') ? 'alert alert-err' : 'alert alert-ok'}>{savedMsg}</div>}
        <div className="field"><label htmlFor="set-business-name">{sg.lBusinessName}</label>
          <input id="set-business-name" className="input" value={profile.business_name || ''} onChange={(e) => setProfile({ ...profile, business_name: e.target.value })} /></div>
        <div className="field"><label htmlFor="set-owner-name">{sg.lOwnerName}</label>
          <input id="set-owner-name" className="input" value={profile.owner_name || ''} onChange={(e) => setProfile({ ...profile, owner_name: e.target.value })} /></div>
        <div className="field"><label htmlFor="set-business-type">{sg.lBusinessType}</label>
          <input id="set-business-type" className="input" placeholder={sg.businessTypePh} value={profile.business_type || ''} onChange={(e) => setProfile({ ...profile, business_type: e.target.value })} /></div>
        <div className="field"><label htmlFor="set-business-address">{sg.lBusinessAddress} <span className="muted-sm">{sg.addressHint}</span></label>
          <textarea id="set-business-address" className="input" rows={2} placeholder={sg.addressPh} value={profile.business_address || ''} onChange={(e) => setProfile({ ...profile, business_address: e.target.value })} /></div>
        <div className="field">
          <label htmlFor="set-taxpayer-type">{sg.lTaxpayerType} <span className="muted-sm">{sg.taxpayerHint}</span></label>
          <select id="set-taxpayer-type" className="input" value={profile.taxpayer_type} onChange={(e) => setProfile({ ...profile, taxpayer_type: e.target.value })}>
            <option value="pribadi">{sg.taxpayerPribadi}</option>
            <option value="badan">{sg.taxpayerBadan}</option>
          </select>
        </div>
        <div className="field"><label htmlFor="set-phone">{sg.lPhone}</label>
          <div className="flex gap" style={{ alignItems: 'center' }}>
            <input id="set-phone" className="input" value={profile.phone || ''} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} placeholder="081234567890" />
            {profile.phone && (profile.phone_verified
              ? <span className="badge badge-green" style={{ whiteSpace: 'nowrap' }}>{sg.verified}</span>
              : <span className="badge badge-amber" style={{ whiteSpace: 'nowrap' }}>{sg.notVerified}</span>)}
          </div>
        </div>
        <div className="field"><label htmlFor="set-email">{sg.lEmail} <span className="badge badge-green" style={{ marginLeft: 6 }}>{sg.verified}</span></label>
          <input id="set-email" className="input" value={user?.email || ''} disabled style={{ background: 'var(--bg)', color: 'var(--muted)' }} /></div>
        <button className="btn btn-primary">{sg.saveProfile}</button>
      </form>

      {/* STATUS PERSETUJUAN */}
      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <h3 className="card-title">{sg.consentTitle}</h3>
        {profile.accepted_terms && profile.terms_version === TERMS_VERSION ? (
          <div className="alert alert-ok" style={{ marginBottom: 12 }}>
            {sg.consentOk}
            {profile.accepted_terms_at ? <> {sg.consentOkAt} <b>{fmtDateTime(profile.accepted_terms_at)}</b></> : null}.
          </div>
        ) : (
          <div className="alert alert-err" style={{ marginBottom: 12 }}>
            {sg.consentBad}
          </div>
        )}
        <div className="card-sub">
          {sg.consentRead} <Link to="/ketentuan" target="_blank" rel="noreferrer">{sg.consentTerms}</Link>
          {' '}{sg.consentAnd} <Link to="/privasi" target="_blank" rel="noreferrer">{sg.consentPrivacy}</Link>.
        </div>
      </div>

      {/* DATA & PRIVASI - hak subjek data (UU PDP): ekspor & hapus */}
      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <h3 className="card-title">{sg.dataTitle}</h3>
        <div className="card-sub">{sg.dataSub}</div>
        {dataMsg && <div className={dataMsg.startsWith('⚠') ? 'alert alert-err' : 'alert alert-ok'}>{dataMsg}</div>}
        <div className="flex gap" style={{ flexWrap: 'wrap', margin: '4px 0 16px' }}>
          <button type="button" className="btn btn-ghost" onClick={doExport}>{sg.downloadData}</button>
        </div>
        <div className="danger-zone">
          <b>{sg.dangerTitle}</b>
          <p className="muted-sm">{sg.dangerDesc}</p>
          <div className="flex gap" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="input" style={{ maxWidth: 220 }} placeholder={sg.typeHapusPh} aria-label={sg.typeHapusAria} value={delText} onChange={(e) => setDelText(e.target.value)} />
            <button type="button" className="btn btn-danger" disabled={delBusy || delText !== 'HAPUS'} onClick={doDeleteAll}>
              {delBusy ? sg.deleting : sg.deleteAllData}
            </button>
          </div>
        </div>
      </div>

      {/* PENGATURAN NOTA / INVOICE */}
      <form className="card card-pad" onSubmit={saveNota} style={{ marginBottom: 20 }}>
        <h3 className="card-title">{sg.notaTitle}</h3>
        <div className="card-sub">{sg.notaSub}</div>
        {notaMsg && <div className={notaMsg.startsWith('⚠') ? 'alert alert-err' : 'alert alert-ok'}>{notaMsg}</div>}
        <div className="field">
          <label id="set-logo-label">{sg.lLogo} <span className="muted-sm">{sg.logoHint}</span></label>
          <div className="flex gap" role="group" aria-labelledby="set-logo-label" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            {profile.logo_url
              ? <img src={profile.logo_url} alt="logo" style={{ width: 56, height: 56, objectFit: 'contain', borderRadius: 10, border: '1px solid var(--line)' }} />
              : <div style={{ width: 56, height: 56, borderRadius: 10, border: '1px dashed var(--line)', display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 11 }}>{sg.logoPlaceholder}</div>}
            <input type="file" accept="image/*" ref={logoRef} hidden onChange={onLogo} />
            <button type="button" className="btn btn-ghost" onClick={() => logoRef.current.click()}>{sg.uploadLogo}</button>
            {profile.logo_url && <button type="button" className="btn btn-ghost" onClick={() => setProfile((p) => ({ ...p, logo_url: null }))}>{sg.removeLogo}</button>}
          </div>
        </div>
        <label className="agree" style={{ margin: '4px 0 10px' }}>
          <input type="checkbox" checked={!!profile.invoice_show_server} onChange={(e) => setProfile((p) => ({ ...p, invoice_show_server: e.target.checked }))} />
          <span>{sg.showServerLine}</span>
        </label>
        {profile.invoice_show_server && (
          <div className="grid-2">
            <div className="field"><label htmlFor="set-server-label">{sg.lLabel}</label>
              <input id="set-server-label" className="input" value={profile.invoice_server_label || ''} onChange={(e) => setProfile((p) => ({ ...p, invoice_server_label: e.target.value }))} placeholder={sg.serverLabelPh} /></div>
            <div className="field"><label htmlFor="set-server-value">{sg.lName}</label>
              <input id="set-server-value" className="input" value={profile.invoice_server_value || ''} onChange={(e) => setProfile((p) => ({ ...p, invoice_server_value: e.target.value }))} placeholder={sg.serverValuePh} /></div>
          </div>
        )}
        <div className="grid-2">
          <div className="field"><label htmlFor="set-tax-percent">{sg.lTaxPercent} <span className="muted-sm">{sg.percentHint}</span></label>
            <input id="set-tax-percent" className="input" type="number" min="0" max="100" step="0.1" value={profile.invoice_tax_percent ?? 0} onChange={(e) => setProfile((p) => ({ ...p, invoice_tax_percent: e.target.value }))} /></div>
          <div className="field"><label htmlFor="set-service-percent">{sg.lServicePercent} <span className="muted-sm">{sg.percentHint}</span></label>
            <input id="set-service-percent" className="input" type="number" min="0" max="100" step="0.1" value={profile.invoice_service_percent ?? 0} onChange={(e) => setProfile((p) => ({ ...p, invoice_service_percent: e.target.value }))} /></div>
        </div>
        <p className="muted-sm" style={{ marginBottom: 12 }}>{sg.notaHint}</p>
        <button className="btn btn-primary">{sg.saveNota}</button>
      </form>

      <TwoFactor />

      <PinManager />

      {/* PENGATURAN LANJUTAN - disembunyikan agar pemula tidak kewalahan (default sudah cukup) */}
      <details className="adv-settings">
        <summary>{sg.advSummary}</summary>

      {/* KATEGORI - dipisah agar pemasukan dan pengeluaran tidak tercampur */}
      <CatList direction="in" title={sg.catInTitle}
        hint={sg.catInHint} placeholder={sg.catInPh} dupMsg={sg.catDupMsg}
        items={categories.filter((c) => c.direction === 'in')} reload={reload} />
      <CatList direction="out" title={sg.catOutTitle}
        hint={sg.catOutHint} placeholder={sg.catOutPh} dupMsg={sg.catDupMsg}
        items={categories.filter((c) => c.direction === 'out')} reload={reload} />

      {/* CHANNEL */}
      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <h3 className="card-title">{sg.chTitle}</h3>
        <div className="card-sub">{sg.chSub}</div>
        <form className="crud-add" onSubmit={createCh}>
          <input className="input" style={{ width: 64, flex: 'none', textAlign: 'center' }} value={newCh.icon} maxLength={2}
            onChange={(e) => setNewCh({ ...newCh, icon: e.target.value })} title={sg.chIconTitle}
            aria-label={sg.chIconAria} />
          <input className="input" value={newCh.label} onChange={(e) => setNewCh({ ...newCh, label: e.target.value })} placeholder={sg.chNamePh} aria-label={sg.chNameAria} />
          <button className="btn btn-primary">{editChId ? sg.chSaveBtn : sg.chAddBtn}</button>
          {editChId && <button type="button" className="btn btn-ghost" onClick={cancelEditCh}>{sg.chCancelBtn}</button>}
        </form>
        <div className="crud-list">
          {channels.length === 0 && <p className="muted-sm">{sg.chEmpty}</p>}
          {channels.map((c) => (
            <div className={`crud-item ${editChId === c.id ? 'editing' : ''}`} key={c.id}>
              <span className="crud-name">{c.icon} {c.label}</span>
              <button type="button" className="icon-btn" title={sg.chEditTitle} onClick={() => startEditCh(c)}><Pencil size={15} /></button>
              <button type="button" className="icon-btn danger" title={sg.chDelTitle} onClick={() => removeCh(c.id)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* ATURAN AUTO-KATEGORI */}
      <div className="card card-pad">
        <h3 className="card-title">{sg.ruleTitle}</h3>
        <div className="card-sub">{sg.ruleSub}</div>
        <form className="flex gap" onSubmit={createRule} style={{ flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
          <div className="field" style={{ flex: 1, minWidth: 150, marginBottom: 0 }}>
            <label htmlFor="set-rule-keyword">{sg.lRuleKeyword}</label>
            <input id="set-rule-keyword" className="input" placeholder={sg.ruleKeywordPh} value={newRule.keyword} onChange={(e) => setNewRule({ ...newRule, keyword: e.target.value })} />
          </div>
          <div className="field" style={{ minWidth: 170, marginBottom: 0 }}>
            <label htmlFor="set-rule-category">{sg.lRuleCategory}</label>
            <select id="set-rule-category" className="input" value={newRule.category} onChange={(e) => setNewRule({ ...newRule, category: e.target.value })}>
              {allCats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button className="btn btn-primary">{sg.ruleAddBtn}</button>
        </form>
        {rules.length === 0 ? (
          <p className="muted-sm">{sg.ruleEmpty}</p>
        ) : rules.map((r) => (
          <div className="rule-row" key={r.id}>
            <span className="rk">"{r.keyword}"</span><span className="arrow">→</span>
            <span className="pill pill-cat">{r.category}</span>
            {r.direction && <span className="badge badge-indigo">{r.direction === 'in' ? sg.ruleIn : sg.ruleOut}</span>}
            <button className="icon-btn danger" style={{ marginLeft: 'auto' }} title={sg.ruleDelTitle} onClick={() => removeRule(r.id)}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
      </details>
    </div>
  )
}
