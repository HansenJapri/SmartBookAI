import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseImportFile, rowsToTransactions } from '../lib/csvImport'
import { expandMarketplaceReport, PLATFORM_LABEL } from '../lib/marketplaceFees'
import { addTransactionsBulk, fetchRules } from '../lib/api'
import { rupiah, fmtDate } from '../lib/format'
import { Upload, FileText, Smartphone, Store } from 'lucide-react'
import { useCatalog } from '../context/CatalogContext'
import { useLang } from '../context/LangContext'
import { BATAS_DATE, bersihkanTanggal } from '../lib/dateInput'

export default function Import() {
  const nav = useNavigate()
  const fileRef = useRef()
  const { catNames } = useCatalog()
  const { t } = useLang()
  const i = t.importPage
  const CHANNELS = [
    { id: 'bank', Icon: FileText, label: i.chBank, hint: i.chBankHint },
    { id: 'qris', Icon: Smartphone, label: i.chQris, hint: i.chQrisHint },
    { id: 'marketplace', Icon: Store, label: i.chMp, hint: i.chMpHint },
  ]
  const [channel, setChannel] = useState('bank')
  const [platform, setPlatform] = useState('shopee')
  const [parsed, setParsed] = useState(null)
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)
  const [diag, setDiag] = useState(null)   // diagnostik impor marketplace (C3)
  const [tersalin, setTersalin] = useState(false)

  const handleFile = async (file) => {
    if (!file) return
    setErr(''); setDone(0); setFileName(file.name); setDiag(null); setTersalin(false)
    try {
      const rules = await fetchRules().catch(() => [])
      const { rows, headers } = await parseImportFile(file)
      if (!rows.length) { setErr(i.errEmpty); return }
      let txs
      if (channel === 'marketplace') {
        const { transactions, diagnostics } = expandMarketplaceReport(rows, headers, platform)
        txs = transactions
        if (txs.length) {
          setDiag(diagnostics)
          // Keyakinan ikut tersimpan pada barisnya, bukan hanya ditampilkan
          // sekali saat impor. Angka periode ini akan dibaca berkali-kali
          // sesudahnya, dan tanpa jejak ini tidak ada cara tahu bahwa satu bulan
          // tertentu berasal dari berkas yang kolom biayanya tidak lengkap.
          txs = txs.map((t) => ({ ...t, import_confidence: diagnostics.confidence }))
        } else {
          // Bukan format laporan pesanan — jatuh ke parser umum. Diagnostik
          // kolom biaya tidak berlaku di jalur ini, jadi sengaja tidak diisi.
          txs = rowsToTransactions(rows, headers, 'marketplace', rules)
        }
      } else {
        txs = rowsToTransactions(rows, headers, channel, rules)
      }
      if (!txs.length) {
        setErr(i.errNoTx)
        setHeaders(headers); return
      }
      setHeaders(headers)
      setParsed(txs.map((tt, idx) => ({ ...tt, _id: idx, _include: true })))
    } catch (e) {
      setErr(i.errRead + e.message)
    }
  }

  const onDrop = (e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }

  const toggle = (id) => setParsed((p) => p.map((tt) => tt._id === id ? { ...tt, _include: !tt._include } : tt))
  const setCat = (id, cat) => setParsed((p) => p.map((tt) => tt._id === id ? { ...tt, category: cat } : tt))
  const setDir = (id, dir) => setParsed((p) => p.map((tt) => tt._id === id ? { ...tt, direction: dir, category: (catNames(dir)[0] || tt.category) } : tt))

  // ---------- BARIS BERTANGGAL MERAGUKAN (task B6) ----------
  // Hanya baris yang MASIH ikut disimpan yang perlu diselesaikan; baris yang
  // sudah dilewati pengguna tidak lagi mengancam kebenaran periode laporan.
  const raguTanggal = parsed?.filter((tt) => tt._dateUncertain && tt._include) || []

  // Memakai tengah malam waktu lokal, sama seperti parseDateInfo(), supaya
  // monthKey() (yang juga membaca waktu lokal) menempatkannya di bulan yang benar.
  const keYmd = (iso) => {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const perbaikiTanggal = (id, ymd) => setParsed((p) => p.map((tt) => {
    if (tt._id !== id || !ymd) return tt
    const [y, m, d] = ymd.split('-').map(Number)
    return { ...tt, occurred_at: new Date(y, m - 1, d).toISOString(), _dateUncertain: false }
  }))

  const pakaiHariIni = (ids) => setParsed((p) => p.map((tt) => (
    ids.includes(tt._id) ? { ...tt, occurred_at: new Date().toISOString(), _dateUncertain: false } : tt
  )))

  const lewatiBaris = (ids) => setParsed((p) => p.map((tt) => (
    ids.includes(tt._id) ? { ...tt, _include: false } : tt
  )))

  const selected = parsed?.filter((tt) => tt._include) || []
  const totalIn = selected.filter((tt) => tt.direction === 'in').reduce((s, tt) => s + tt.amount, 0)
  const totalOut = selected.filter((tt) => tt.direction === 'out').reduce((s, tt) => s + tt.amount, 0)

  const doImport = async () => {
    if (busy) return
    setBusy(true); setErr('')
    const terpilih = selected
    try {
      const payload = terpilih.map(({ _id, _include, _dateUncertain, _dateReason, _dateRaw, ...tt }) => tt)
      await addTransactionsBulk(payload)
      setDone(payload.length)
      setParsed(null)
    } catch (e) {
      setErr(i.errSave + e.message)
      // KEGAGALAN SEPARUH JALAN adalah kasus yang paling mahal di halaman ini.
      // addTransactionsBulk() menyimpan per batch 200 baris, jadi gagal di baris
      // ke-450 berarti 400 baris SUDAH masuk. Sebelumnya daftar pratinjau
      // dibiarkan utuh dan tombol Impor menyala lagi — pengguna yang panik
      // menekannya sekali lagi menggandakan 400 baris pertama, dan laporan
      // bulanannya rusak dengan cara yang sangat sulit dibersihkan.
      //
      // `e.tersimpan` dikirim oleh api.js persis untuk ini: baris yang sudah
      // masuk dibuang dari daftar, sehingga mengulang impor hanya mengirim
      // sisanya. Batas sejati (kunci idempoten di database) masih pekerjaan
      // terpisah; ini menutup jalur yang bisa ditempuh pengguna hari ini.
      if (Number(e.tersimpan) > 0) {
        const sisa = terpilih.slice(e.tersimpan)
        setParsed(sisa.length ? sisa : null)
        if (!sisa.length) setDone(e.tersimpan)
      }
    }
    finally { setBusy(false) }
  }

  return (
    <>
      {done > 0 && (
        <div className="alert alert-ok" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{i.doneA} {done} {i.doneB}</span>
          <button className="btn btn-primary" onClick={() => nav('/app/transaksi')}>{i.seeTx}</button>
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <h3 className="card-title">{i.step1}</h3>
        <div className="card-sub">{i.step1sub}</div>
        <div className="chan-pick">
          {CHANNELS.map((c) => { const I = c.Icon; return (
            <button key={c.id} className={channel === c.id ? 'active' : ''} onClick={() => setChannel(c.id)}>
              <I size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} /> {c.label}
            </button>
          ) })}
        </div>
        <p className="muted-sm">{CHANNELS.find((c) => c.id === channel).hint}</p>
        {channel === 'marketplace' && (
          <div style={{ marginTop: 12 }}>
            <div className="muted-sm" style={{ marginBottom: 6 }}>{i.mpPick}</div>
            <div className="chan-pick">
              {Object.entries(PLATFORM_LABEL).filter(([k]) => k !== 'marketplace').map(([k, lbl]) => (
                <button key={k} className={platform === k ? 'active' : ''} onClick={() => setPlatform(k)}>{lbl}</button>
              ))}
              <button className={platform === 'marketplace' ? 'active' : ''} onClick={() => setPlatform('marketplace')}>{i.mpOther}</button>
            </div>
          </div>
        )}
      </div>

      {err && <div className="alert alert-err">{err}{headers.length > 0 && <div style={{ marginTop: 6, fontSize: 12 }}>{i.colsRead}{headers.join(', ')}</div>}</div>}

      {!parsed && (
        <>
          <div className="card card-pad" style={{ marginBottom: 14 }}>
            <h3 className="card-title">{i.step2}</h3>
            <div className="card-sub">{i.step2sub}</div>
            <div className="drop" onClick={() => fileRef.current.click()}
              onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
              <div className="di"><Upload size={32} /></div>
              <h3>{fileName || i.dropHere}</h3>
              <p>{i.dropFmt}</p>
            </div>
            <input ref={fileRef} type="file"
              accept=".csv,.tsv,.txt,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden
              onChange={(e) => handleFile(e.target.files[0])} />
          </div>
          <button className="btn btn-ghost" onClick={downloadSample}>{i.sampleBtn}</button>
        </>
      )}

      {parsed && (
        <>
          <div className="card card-pad" style={{ marginBottom: 14 }}>
            <div className="flex between">
              <div>
                <h3 className="card-title">{i.reviewA}{parsed.length} {i.reviewB}</h3>
                <div className="card-sub">{fileName}. {i.reviewSub}</div>
              </div>
              <button className="btn btn-ghost" onClick={() => { setParsed(null); setFileName('') }}>{i.changeFile}</button>
            </div>
            <div className="flex gap mt">
              <span className="badge badge-green">{i.badgeIn} {rupiah(totalIn)}</span>
              <span className="badge badge-amber">{i.badgeOut} {rupiah(totalOut)}</span>
              <span className="badge badge-indigo">{selected.length} {i.badgeSel}</span>
            </div>
          </div>

          {/* Diagnostik deteksi kolom (task C3). Deteksi sinonim selama ini diam
              saat gagal: kolom biaya yang tak dikenali membuat angka kebocoran
              terlalu kecil tanpa satu pun tanda. Panel ini yang membuat
              kegagalan itu terlihat. */}
          {diag && (
            <div className={`card card-pad diag${diag.confidence === 'rendah' ? ' diag-rendah' : ''}`} style={{ marginBottom: 14 }}>
              <div className="flex between gap" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div>
                  <h3 className="card-title">{i.diagTitle}</h3>
                  <div className="card-sub">
                    {i.diagRows.replace('{n}', diag.rowCount)}
                    {diag.skippedRows > 0 && ` · ${i.diagSkipped.replace('{n}', diag.skippedRows)}`}
                  </div>
                </div>
                <span className={`badge badge-${diag.confidence === 'tinggi' ? 'green' : diag.confidence === 'sedang' ? 'amber' : 'red'}`}>
                  {i.diagConfidence} {i.confidenceLabel[diag.confidence]}
                </span>
              </div>

              {diag.confidence === 'rendah' && (
                <div className="alert alert-err" style={{ marginTop: 12, marginBottom: 0 }}>{i.diagWarnLow}</div>
              )}

              <div className="diag-cols">
                <div>
                  <div className="diag-head">{i.diagMatched}</div>
                  <div className="flex gap" style={{ flexWrap: 'wrap' }}>
                    {Object.entries(diag.matched).map(([peran, header]) => (
                      <span key={peran} className="badge badge-green" title={header}>
                        {i.roleLabel[peran] || peran}: {header}
                      </span>
                    ))}
                  </div>
                </div>
                {diag.unmatched.length > 0 && (
                  <div>
                    <div className="diag-head">{i.diagUnmatched}</div>
                    <div className="flex gap" style={{ flexWrap: 'wrap' }}>
                      {diag.unmatched.map((peran) => (
                        <span key={peran} className="badge badge-amber">{i.roleLabel[peran] || peran}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {diag.unexplainedAmount > 0 && (
                <p className="muted-sm" style={{ marginTop: 10, marginBottom: 0 }}>
                  {i.diagUnexplained.replace('{amount}', rupiah(diag.unexplainedAmount))}
                </p>
              )}

              {diag.unknownColumns.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="flex between gap" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <div className="diag-head" style={{ marginBottom: 0 }}>{i.diagUnknown}</div>
                    <button className="btn btn-ghost" onClick={() => {
                      navigator.clipboard?.writeText(diag.unknownColumns.join('\n'))
                        .then(() => { setTersalin(true); setTimeout(() => setTersalin(false), 2000) })
                        .catch(() => { /* abaikan */ })
                    }}>{tersalin ? i.diagCopied : i.diagCopy}</button>
                  </div>
                  <p className="muted-sm" style={{ marginTop: 6, marginBottom: 0, wordBreak: 'break-word' }}>
                    {diag.unknownColumns.join(' · ')}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Baris bertanggal meragukan dikelompokkan terpisah dan dikeluarkan dari
              tabel utama sampai diselesaikan, supaya tidak tenggelam di antara
              ratusan baris yang sehat. */}
          {raguTanggal.length > 0 && (
            <div className="card card-pad date-fix" style={{ marginBottom: 14 }}>
              <div className="flex between gap" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div>
                  <h3 className="card-title">{i.dateFixTitle.replace('{n}', raguTanggal.length)}</h3>
                  <div className="card-sub">{i.dateFixSub}</div>
                </div>
                <div className="flex gap" style={{ flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost" onClick={() => pakaiHariIni(raguTanggal.map((x) => x._id))}>{i.dateUseTodayAll}</button>
                  <button className="btn btn-ghost" onClick={() => lewatiBaris(raguTanggal.map((x) => x._id))}>{i.dateSkipAll}</button>
                </div>
              </div>
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{i.thDateRaw}</th><th>{i.thWhy}</th><th>{i.thDesc}</th>
                      <th style={{ textAlign: 'right' }}>{i.thAmount}</th>
                      <th>{i.thFix}</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {raguTanggal.map((tt) => (
                      <tr key={tt._id}>
                        <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>{tt._dateRaw || <i>{i.dateEmpty}</i>}</td>
                        <td className="muted-sm">{i.dateReason[tt._dateReason] || i.dateReason.unknown}</td>
                        <td style={{ maxWidth: 240 }}>{tt.description}</td>
                        <td style={{ textAlign: 'right' }} className={tt.direction === 'in' ? 'amt-in' : 'amt-out'}>{rupiah(tt.amount)}</td>
                        <td>
                          <input type="date" {...BATAS_DATE} className="input" style={{ padding: '5px 8px', fontSize: 13 }}
                            value={keYmd(tt.occurred_at)} onChange={(e) => perbaikiTanggal(tt._id, bersihkanTanggal(e.target.value))}
                            aria-label={i.thFix} />
                        </td>
                        <td><button className="btn btn-ghost" onClick={() => lewatiBaris([tt._id])}>{i.dateSkipOne}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="table-wrap" style={{ marginBottom: 16 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th><th>{i.thDate}</th><th>{i.thDesc}</th>
                  <th>{i.thType}</th><th>{i.thCat}</th><th style={{ textAlign: 'right' }}>{i.thAmount}</th>
                </tr>
              </thead>
              <tbody>
                {parsed.filter((tt) => !(tt._dateUncertain && tt._include)).map((tt) => (
                  <tr key={tt._id} style={{ opacity: tt._include ? 1 : 0.4 }}>
                    <td><input type="checkbox" checked={tt._include} onChange={() => toggle(tt._id)} /></td>
                    <td className="muted-sm" style={{ whiteSpace: 'nowrap' }}>
                      {fmtDate(tt.occurred_at)}
                      {tt._dateUncertain && <span className="badge badge-amber" title={i.dateBadgeTitle} style={{ marginLeft: 6 }}>{i.dateBadge}</span>}
                    </td>
                    <td style={{ maxWidth: 280 }}>{tt.description}</td>
                    <td>
                      <select className="input" style={{ padding: '5px 8px', fontSize: 13 }} value={tt.direction} onChange={(e) => setDir(tt._id, e.target.value)}>
                        <option value="in">{i.typeIn}</option><option value="out">{i.typeOut}</option>
                      </select>
                    </td>
                    <td>
                      <select className="input" style={{ padding: '5px 8px', fontSize: 13, minWidth: 150 }} value={tt.category} onChange={(e) => setCat(tt._id, e.target.value)}>
                        {(() => { const opts = catNames(tt.direction); return [...new Set([tt.category, ...opts])].filter(Boolean).map((c) => <option key={c} value={c}>{c}</option>) })()}
                      </select>
                    </td>
                    <td style={{ textAlign: 'right' }} className={tt.direction === 'in' ? 'amt-in' : 'amt-out'}>
                      {rupiah(tt.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Menyimpan ditahan selama masih ada baris meragukan. Ketiga pilihannya
              masing-masing satu klik, jadi ini bukan jalan buntu — tujuannya
              memastikan periode yang salah tidak pernah masuk tanpa disadari. */}
          {raguTanggal.length > 0 && (
            <div className="alert alert-err" style={{ marginBottom: 12 }}>
              {i.dateBlock.replace('{n}', raguTanggal.length)}
            </div>
          )}
          <div className="flex gap">
            <button className="btn btn-primary btn-lg" disabled={busy || selected.length === 0 || raguTanggal.length > 0} onClick={doImport}>
              {busy ? i.importing : `${i.importBtn} ${selected.length} ${i.txWord}`}
            </button>
            <button className="btn btn-ghost btn-lg" onClick={() => { setParsed(null); setFileName('') }}>{i.cancel}</button>
          </div>
        </>
      )}
    </>
  )
}

function downloadSample() {
  const csv = [
    'Tanggal,Keterangan,Debit,Kredit',
    '01/06/2026,Transfer masuk dari Bu Sari,,250000',
    '01/06/2026,QRIS pembayaran pelanggan,,27500',
    '02/06/2026,Belanja stok Pasar Induk,350000,',
    '02/06/2026,Token PLN,100000,',
    '03/06/2026,Penjualan Shopee Order SP-2291,,189000',
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'contoh-mutasi.csv'
  a.click()
}
