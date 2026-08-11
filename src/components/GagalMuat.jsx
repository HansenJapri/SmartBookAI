import { CloudOff, RefreshCw } from 'lucide-react'
import { useLang } from '../context/LangContext'
import { useOnline } from '../lib/useOnline'

// ============================================================
// Layar "data gagal dimuat" — pengganti empty state palsu.
//
// Satu kalimat di sini memikul beban paling berat di seluruh aplikasi:
// meyakinkan pemilik usaha bahwa CATATANNYA MASIH ADA. Karena itu jaminan
// tersebut ditulis eksplisit, bukan disiratkan. Tanpa kalimat itu, layar galat
// dan layar kosong sama-sama terbaca sebagai "data saya hilang".
//
// Penyebabnya juga dibedakan: kalau perangkat memang sedang offline, itulah
// yang disebut — bukan pesan galat teknis dari Supabase yang tidak bisa
// ditindaklanjuti siapa pun.
// ============================================================

export default function GagalMuat({ galat, onRetry, memuat = false }) {
  const { t } = useLang()
  const g = t.gagalMuat
  const online = useOnline()

  const pesanTeknis = String(galat?.message || '').slice(0, 200)

  return (
    <div className="card card-pad" style={{ textAlign: 'center', padding: '32px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--muted)' }}>
        <CloudOff size={40} />
      </div>
      <h3 style={{ margin: '12px 0 6px', fontSize: 17 }}>
        {online ? g.judul : g.judulOffline}
      </h3>
      <p className="muted-sm" style={{ maxWidth: 420, margin: '0 auto 4px', lineHeight: 1.6 }}>
        {online ? g.pesan : g.pesanOffline}
      </p>
      {/* Jaminan yang membuat layar ini berbeda dari "data hilang". */}
      <p style={{ maxWidth: 420, margin: '0 auto 18px', fontWeight: 600, fontSize: 13.5 }}>
        {g.aman}
      </p>
      <button className="btn btn-primary" onClick={onRetry} disabled={memuat}>
        <RefreshCw size={15} style={{ verticalAlign: '-3px', marginRight: 6 }} />
        {memuat ? g.mencoba : g.coba}
      </button>
      {pesanTeknis && (
        <details style={{ marginTop: 16, textAlign: 'left', maxWidth: 420, marginInline: 'auto' }}>
          <summary className="muted-sm" style={{ cursor: 'pointer' }}>{g.detail}</summary>
          <p className="muted-sm" style={{ marginTop: 6, wordBreak: 'break-word' }}>{pesanTeknis}</p>
        </details>
      )}
    </div>
  )
}
