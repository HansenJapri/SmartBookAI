import { useEffect, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { fetchBaseline, saveBaseline } from '../lib/api'
import { useLang } from '../context/LangContext'

// Tiga pertanyaan baseline (task C2), ditanyakan sekali di layar pertama
// setelah masuk.
//
// Kenapa di sini dan bukan di Setup.jsx seperti tertulis di spec: Setup.jsx
// bukan alur onboarding pengguna sama sekali — isinya instruksi developer
// menghubungkan Supabase, dan hanya muncul ketika aplikasi BELUM dikonfigurasi.
// Pengguna sungguhan tidak pernah melihatnya, jadi pertanyaan yang ditaruh di
// sana tidak akan pernah dijawab siapa pun.
//
// Waktunya penting: tebakan hanya bernilai kalau direkam SEBELUM mereka melihat
// angka aslinya di Reveal. Sesudah itu jawabannya sudah terkontaminasi.
export const BIAYA_DIKENAL = ['admin', 'ongkir', 'iklan', 'gratis_ongkir', 'lainnya']

export default function BaselineAsk() {
  const { t } = useLang()
  const b = t.baseline
  const [tampil, setTampil] = useState(false)
  const [margin, setMargin] = useState('')
  const [jam, setJam] = useState('')
  const [biaya, setBiaya] = useState([])
  const [sibuk, setSibuk] = useState(false)

  useEffect(() => {
    let hidup = true
    // Baris yang sudah ada — termasuk baris kosong hasil "lewati" — berarti
    // pertanyaan ini sudah pernah diajukan. Jangan tanya lagi.
    fetchBaseline()
      .then((row) => { if (hidup) setTampil(!row) })
      .catch(() => { if (hidup) setTampil(false) })
    return () => { hidup = false }
  }, [])

  if (!tampil) return null

  const toggleBiaya = (k) => setBiaya((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))

  const angka = (v) => (v === '' || v == null ? null : Number(v))

  const simpan = async (isi) => {
    setSibuk(true)
    try {
      // Melewati tetap menulis baris (semua kolom null). Itu membedakan
      // "ditanya lalu menolak" dari "belum pernah ditanya" — keduanya perlu
      // dibedakan kalau angka ini mau dipakai sebagai bukti.
      await saveBaseline(isi ? {
        margin_perceived: angka(margin),
        hours_monthly: angka(jam),
        fees_known: biaya.length ? biaya : null,
      } : {
        margin_perceived: null, hours_monthly: null, fees_known: null,
      })
    } catch { /* jangan menghalangi dashboard kalau gagal */ }
    setTampil(false)
  }

  return (
    <div className="card card-pad baseline-ask" style={{ marginBottom: 18 }}>
      <div className="flex gap" style={{ alignItems: 'flex-start' }}>
        <HelpCircle size={20} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <h3 className="card-title">{b.title}</h3>
          <div className="card-sub">{b.sub}</div>

          <div className="baseline-grid">
            <div className="field">
              <label htmlFor="bl-margin">{b.qMargin}</label>
              <input id="bl-margin" className="input" type="number" inputMode="numeric"
                min="-100" max="100" placeholder={b.phMargin}
                value={margin} onChange={(e) => setMargin(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="bl-jam">{b.qHours}</label>
              <input id="bl-jam" className="input" type="number" inputMode="numeric"
                min="0" max="744" placeholder={b.phHours}
                value={jam} onChange={(e) => setJam(e.target.value)} />
            </div>
          </div>

          <div className="field" style={{ marginTop: 4 }}>
            <label>{b.qFees}</label>
            <div className="flex gap" style={{ flexWrap: 'wrap', marginTop: 6 }}>
              {BIAYA_DIKENAL.map((k) => (
                <label key={k} className={`chip-pick${biaya.includes(k) ? ' active' : ''}`}>
                  <input type="checkbox" checked={biaya.includes(k)} onChange={() => toggleBiaya(k)} />
                  {b.fees[k]}
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap" style={{ marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={sibuk} onClick={() => simpan(true)}>{b.save}</button>
            <button className="btn btn-ghost" disabled={sibuk} onClick={() => simpan(false)}>{b.skip}</button>
          </div>
          <p className="muted-sm" style={{ marginTop: 10, marginBottom: 0 }}>{b.note}</p>
        </div>
      </div>
    </div>
  )
}
