import { useEffect, useMemo, useState } from 'react'
import { fetchTransactions, fetchProfile, fetchTxCount, track } from '../lib/api'
import { rupiah, fmtDate, fmtDateTime, monthKey } from '../lib/format'
import { sheetRibuan } from '../lib/excelFormat'
import { summarize, monthlyBreakdown, expenseByCategory, taxSummaryForYear, TAX } from '../lib/analytics'
import Accordion from '../components/Accordion'
import Modal from '../components/Modal'
import { Landmark, Receipt, FileText, AlertTriangle } from 'lucide-react'
import { EDU } from '../lib/eduContent'
import { useLang } from '../context/LangContext'
import {
  DISCLAIMER_KUR, DISCLAIMER_PAJAK, PDF_FOOTER_H,
  disclaimerAoa, refFile, stampPdfBadge, stampPdfDisclaimer,
} from '../lib/reportDisclaimer'

// Persetujuan penafian cukup sekali per sesi peramban: menahan setiap unduhan
// akan berubah jadi kebiasaan klik tanpa baca, yang justru melemahkan tujuannya.
const REF_ACK_KEY = 'sb_ref_ack'

export default function Reports() {
  const { t } = useLang()
  const r = t.reports
  const MONTHS = t.common.months
  const monthLabel = (k) => { const [y, m] = k.split('-'); return `${MONTHS[Number(m) - 1]} ${y}` }
  const [tx, setTx] = useState(null)
  const [profile, setProfile] = useState(null)
  const [period, setPeriod] = useState('all')
  const [txTotal, setTxTotal] = useState(0)
  // Unduhan yang tertahan menunggu pengakuan penafian: { jalankan, teks }.
  const [pendingUnduh, setPendingUnduh] = useState(null)

  useEffect(() => {
    fetchTransactions().then(setTx).catch(() => setTx([]))
    fetchProfile().then(setProfile).catch(() => {})
    fetchTxCount().then(setTxTotal).catch(() => {})
  }, [])

  const months = useMemo(() => {
    if (!tx) return []
    return [...new Set(tx.map((t) => monthKey(t.occurred_at)))].sort().reverse()
  }, [tx])

  const scoped = useMemo(() => {
    if (!tx) return []
    if (period === 'all') return tx
    return tx.filter((t) => monthKey(t.occurred_at) === period)
  }, [tx, period])

  const sum = useMemo(() => summarize(scoped), [scoped])
  const byCat = useMemo(() => expenseByCategory(scoped), [scoped])
  const monthly = useMemo(() => monthlyBreakdown(tx || []), [tx])

  // Rincian per transaksi. Laporan yang hanya memuat total tidak bisa
  // ditelusuri oleh analis kredit maupun konsultan pajak — mereka selalu minta
  // buktinya per baris. Diurutkan dari yang terlama supaya terbaca seperti
  // buku kas.
  const rincian = useMemo(
    () => scoped.slice().sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at)),
    [scoped],
  )

  const taxpayerType = profile?.taxpayer_type || 'pribadi'
  // Tahun pajak: jika periode = bulan tertentu pakai tahunnya; jika 'all' pakai 'all'
  const taxYear = period === 'all' ? 'all' : period.slice(0, 4)
  // Pajak dihitung dari SEMUA transaksi (peredaran bruto setahun), bukan hanya periode terpilih
  const taxInfo = useMemo(
    () => taxSummaryForYear(monthly, taxYear, taxpayerType),
    [monthly, taxYear, taxpayerType]
  )
  const pphFinal = taxInfo.pphTotal
  const periodLabel = period === 'all' ? r.allPeriods : monthLabel(period)
  const bizName = profile?.business_name || t.app.business
  const wpLabelOn = taxpayerType === 'pribadi' ? r.wpPribadi : r.wpBadan
  const yearLabel = taxYear === 'all' ? r.taxTotal : taxYear

  if (!tx) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  if (tx.length === 0) {
    return <div className="card"><div className="empty">
      <div className="ee"><FileText size={36} /></div><h3>{r.emptyTitle}</h3>
      <p>{r.emptyDesc}</p>
    </div></div>
  }

  // ---------- RINCIAN TRANSAKSI (dipakai PDF maupun Excel) ----------
  const RINCIAN_HEAD = ['Tanggal', 'Jenis', 'Deskripsi', 'Kategori', 'Saluran', 'Status Bayar', 'Pihak', 'Nominal (Rp)']
  // Nominal dikembalikan sebagai ANGKA agar sel Excel tetap bisa dijumlahkan;
  // versi PDF membungkusnya dengan rupiah() saat dirender.
  const rincianRow = (t2) => [
    fmtDateTime(t2.occurred_at),
    t2.direction === 'in' ? 'Pemasukan' : 'Pengeluaran',
    t2.description || '-',
    t2.category || '-',
    t2.channel || 'manual',
    (t2.payment_status || 'lunas') === 'belum' ? 'Belum Lunas' : 'Lunas',
    t2.customer_name || '-',
    Math.round(Number(t2.amount) || 0),
  ]

  // ---------- PDF GENERATORS ----------
  const pdfHeader = (doc, title) => {
    doc.setFillColor(79, 70, 229)
    doc.rect(0, 0, 210, 26, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(15); doc.setFont(undefined, 'bold')
    doc.text('SmartBook AI', 14, 12)
    doc.setFontSize(10); doc.setFont(undefined, 'normal')
    doc.text(title, 14, 19)
    stampPdfBadge(doc)
    doc.setTextColor(30, 30, 30)
    doc.setFontSize(11); doc.setFont(undefined, 'bold')
    doc.text(bizName, 14, 36)
    doc.setFont(undefined, 'normal'); doc.setFontSize(9); doc.setTextColor(110, 110, 110)
    doc.text(`Periode: ${periodLabel}`, 14, 42)
    doc.text(`Dicetak: ${fmtDate(new Date())}`, 14, 47)
    doc.setTextColor(30, 30, 30)
  }

  const loadPdf = async () => {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'), import('jspdf-autotable'),
    ])
    return { jsPDF, autoTable }
  }

  // Laporan Laba Rugi mengikuti format SAK EMKM: Pendapatan, Beban per pos,
  // lalu Laba (Rugi) Bersih. Dapat dilampirkan untuk pengajuan KUR.
  const generateLabaRugi = async () => {
    const { jsPDF, autoTable } = await loadPdf()
    const doc = new jsPDF()
    pdfHeader(doc, 'Laporan Laba Rugi')
    const B = (t) => ({ content: t, styles: { fontStyle: 'bold' } })
    const body = [
      [B('PENDAPATAN'), ''],
      ['Pendapatan Usaha (Penjualan)', rupiah(sum.income)],
      [B('Jumlah Pendapatan'), { content: rupiah(sum.income), styles: { fontStyle: 'bold' } }],
      [B('BEBAN USAHA'), ''],
      ...(byCat.length ? byCat.map((c) => [c.name, rupiah(c.value)]) : [['(belum ada beban tercatat)', rupiah(0)]]),
      [B('Jumlah Beban Usaha'), { content: rupiah(sum.expense), styles: { fontStyle: 'bold' } }],
      [
        { content: 'LABA (RUGI) BERSIH', styles: { fontStyle: 'bold', fillColor: [238, 242, 255] } },
        { content: rupiah(sum.profit), styles: { fontStyle: 'bold', fillColor: [238, 242, 255] } },
      ],
    ]
    // Catatan format dipindah ke bawah header: kaki halaman kini sepenuhnya
    // dipakai penafian REFERENSI, dan mengulang "verifikasi dulu" di dua tempat
    // justru mengencerkan pesannya.
    doc.setFontSize(8); doc.setTextColor(110, 110, 110)
    doc.text('Disusun mengacu format Laporan Laba Rugi SAK EMKM. Alat bantu, bukan laporan teraudit.', 14, 52)
    doc.setTextColor(30, 30, 30)
    autoTable(doc, {
      startY: 57,
      margin: { bottom: PDF_FOOTER_H + 4 },
      head: [['Uraian', 'Jumlah (Rp)']],
      body,
      theme: 'plain',
      headStyles: { fillColor: [79, 70, 229], textColor: 255 },
      columnStyles: { 1: { halign: 'right' } },
      styles: { fontSize: 10, cellPadding: 4 },
    })
    if (monthly.length) {
      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 10,
        margin: { bottom: PDF_FOOTER_H + 4 },
        head: [['Arus Kas per Bulan', 'Pemasukan', 'Pengeluaran', 'Laba Bersih']],
        body: monthly.map((m) => [monthLabel(m.month), rupiah(m.income), rupiah(m.expense), rupiah(m.profit)]),
        theme: 'grid', headStyles: { fillColor: [100, 116, 139] }, styles: { fontSize: 9 },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      })
    }
    // Rincian per transaksi — bukan sekadar total agregat. Dimulai di halaman
    // baru supaya lampirannya bisa dirobek/di-scan terpisah saat diserahkan.
    if (rincian.length) {
      doc.addPage()
      doc.setFontSize(11); doc.setFont(undefined, 'bold')
      doc.text(`Rincian Transaksi — ${periodLabel}`, 14, 16)
      doc.setFont(undefined, 'normal'); doc.setFontSize(8); doc.setTextColor(110, 110, 110)
      doc.text(`${rincian.length} transaksi, diurutkan dari yang terlama.`, 14, 21)
      doc.setTextColor(30, 30, 30)
      autoTable(doc, {
        startY: 25,
        margin: { bottom: PDF_FOOTER_H + 4, left: 10, right: 10 },
        head: [RINCIAN_HEAD],
        body: rincian.map((t2) => {
          const row = rincianRow(t2)
          return [...row.slice(0, 7), rupiah(row[7])]
        }),
        theme: 'grid',
        headStyles: { fillColor: [79, 70, 229], fontSize: 7.5 },
        styles: { fontSize: 7, cellPadding: 1.6, overflow: 'linebreak' },
        columnStyles: {
          0: { cellWidth: 26 }, 1: { cellWidth: 20 }, 2: { cellWidth: 48 },
          3: { cellWidth: 26 }, 4: { cellWidth: 20 }, 5: { cellWidth: 18 },
          6: { cellWidth: 22 }, 7: { halign: 'right' },
        },
      })
    }
    stampPdfDisclaimer(doc, DISCLAIMER_KUR)
    doc.save(refFile(`Laporan-LabaRugi-${bizName}-${period}.pdf`))
    track('report_generated', { type: 'labarugi_pdf', period })
  }

  // Ekspor laporan laba/rugi ke Excel yang rapi (3 lembar: ringkasan, rekap
  // bulanan, pengeluaran per kategori) dengan lebar kolom yang sudah diatur.
  const generateExcel = async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()

    const ringkasan = [
      ...disclaimerAoa(DISCLAIMER_KUR),
      ['LAPORAN LABA RUGI'],
      ['Usaha', bizName],
      ['Periode', periodLabel],
      ['Dicetak', fmtDate(new Date())],
      [],
      ['Ringkasan', 'Nilai (Rp)'],
      ['Total Pendapatan (Omzet)', Math.round(sum.income)],
      ['Total Pengeluaran', Math.round(sum.expense)],
      ['Laba Bersih', Math.round(sum.profit)],
      ['Margin Laba (%)', sum.income ? Math.round(sum.profit / sum.income * 100) : 0],
      ['Jumlah Transaksi', sum.count],
    ]
    XLSX.utils.book_append_sheet(wb, sheetRibuan(XLSX, ringkasan, [{ wch: 34 }, { wch: 20 }]), 'Ringkasan')

    const monthlyAoa = [
      ['Bulan', 'Pemasukan', 'Pengeluaran', 'Laba Bersih'],
      ...monthly.map((m) => [monthLabel(m.month), Math.round(m.income), Math.round(m.expense), Math.round(m.profit)]),
    ]
    XLSX.utils.book_append_sheet(
      wb, sheetRibuan(XLSX, monthlyAoa, [{ wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 16 }]), 'Rekap Bulanan',
    )

    const catAoa = [
      ['Kategori Pengeluaran', 'Total (Rp)'],
      ...byCat.map((c) => [c.name, Math.round(c.value)]),
    ]
    XLSX.utils.book_append_sheet(
      wb, sheetRibuan(XLSX, catAoa, [{ wch: 30 }, { wch: 18 }]), 'Pengeluaran per Kategori',
    )

    // Rincian per transaksi — inti dari laporan yang bisa diverifikasi.
    const rincianAoa = [
      [`Rincian Transaksi — ${periodLabel} (${rincian.length} transaksi)`],
      [],
      RINCIAN_HEAD,
      ...rincian.map(rincianRow),
    ]
    XLSX.utils.book_append_sheet(
      wb,
      sheetRibuan(XLSX, rincianAoa, [
        { wch: 20 }, { wch: 13 }, { wch: 44 }, { wch: 22 },
        { wch: 14 }, { wch: 13 }, { wch: 22 }, { wch: 18 },
      ]),
      'Rincian Transaksi',
    )

    XLSX.writeFile(wb, refFile(`Laporan-LabaRugi-${bizName}-${period}.xlsx`))
    track('report_generated', { type: 'labarugi_excel', period })
  }

  const generateSPT = async () => {
    const { jsPDF, autoTable } = await loadPdf()
    const doc = new jsPDF()
    pdfHeader(doc, 'Rekap PPh Final UMKM 0,5% (PP 55/2022)')
    const wpLabel = taxpayerType === 'pribadi' ? 'Orang Pribadi' : 'Badan'
    autoTable(doc, {
      startY: 54,
      margin: { bottom: PDF_FOOTER_H + 4 },
      head: [['Komponen Pajak', 'Nilai']],
      body: [
        ['Jenis Wajib Pajak', wpLabel],
        ['Peredaran Bruto (Omzet) setahun', rupiah(taxInfo.annualTurnover)],
        ['Omzet tidak kena pajak (Rp 500 juta, khusus Orang Pribadi)', rupiah(taxInfo.exemption)],
        ['Dasar Pengenaan Pajak', rupiah(taxInfo.taxable)],
        ['Tarif PPh Final', '0,5%'],
        ['PPh Final Terutang (estimasi)', rupiah(taxInfo.pphTotal)],
        ['Memenuhi syarat tarif final', taxInfo.eligibleFinal ? 'Ya, omzet sampai Rp 4,8 miliar' : 'Tidak, omzet di atas Rp 4,8 miliar (pakai tarif normal)'],
        ['Tahun pajak', taxYear === 'all' ? 'Seluruh data tercatat' : taxYear],
      ],
      theme: 'striped', headStyles: { fillColor: [22, 163, 74] },
      columnStyles: { 1: { halign: 'right' } },
    })
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 8,
      margin: { bottom: PDF_FOOTER_H + 4 },
      head: [['Bulan', 'Peredaran Bruto', 'Bebas Pajak', 'Dasar Kena Pajak', 'PPh 0,5%']],
      body: taxInfo.rows.map((r) => [monthLabel(r.month), rupiah(r.income), rupiah(r.exemptApplied), rupiah(r.taxable), rupiah(r.pph)]),
      theme: 'grid', headStyles: { fillColor: [22, 163, 74] }, styles: { fontSize: 8.5 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    })
    // Dasar hukum dan perintah verifikasi sudah termuat di DISCLAIMER_PAJAK,
    // yang kini tercetak di setiap halaman — tidak perlu diulang di sini.
    stampPdfDisclaimer(doc, DISCLAIMER_PAJAK)
    doc.save(refFile(`Rekap-Pajak-${bizName}-${taxYear}.pdf`))
    track('report_generated', { type: 'pajak', year: taxYear })
  }

  // Ekspor rekap pajak ke Excel.
  const generateTaxExcel = async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const wpLabel = taxpayerType === 'pribadi' ? 'Orang Pribadi' : 'Badan'
    const info = [
      ...disclaimerAoa(DISCLAIMER_PAJAK),
      ['REKAP PPh FINAL UMKM 0,5% (PP 55/2022)'],
      ['Usaha', bizName],
      ['Jenis Wajib Pajak', wpLabel],
      ['Tahun pajak', taxYear === 'all' ? 'Seluruh data tercatat' : taxYear],
      [],
      ['Komponen', 'Nilai (Rp)'],
      ['Peredaran Bruto (Omzet) setahun', Math.round(taxInfo.annualTurnover)],
      ['Omzet tidak kena pajak (khusus OP)', Math.round(taxInfo.exemption)],
      ['Dasar Pengenaan Pajak', Math.round(taxInfo.taxable)],
      ['PPh Final Terutang (estimasi)', Math.round(taxInfo.pphTotal)],
    ]
    XLSX.utils.book_append_sheet(wb, sheetRibuan(XLSX, info, [{ wch: 40 }, { wch: 20 }]), 'Ringkasan Pajak')
    const rowsAoa = [
      ['Bulan', 'Peredaran Bruto', 'Bebas Pajak', 'Dasar Kena Pajak', 'PPh 0,5%'],
      ...taxInfo.rows.map((r) => [monthLabel(r.month), Math.round(r.income), Math.round(r.exemptApplied), Math.round(r.taxable), Math.round(r.pph)]),
    ]
    XLSX.utils.book_append_sheet(
      wb, sheetRibuan(XLSX, rowsAoa, [{ wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }]), 'Rincian Bulanan',
    )

    // Dasar peredaran bruto ada di transaksi pemasukan — dilampirkan per baris
    // supaya angka omzet di sheet ringkasan bisa ditelusuri sampai sumbernya.
    const pemasukan = rincian.filter((t2) => t2.direction === 'in')
    const omzetAoa = [
      [`Rincian Pemasukan (dasar peredaran bruto) — ${pemasukan.length} transaksi`],
      [],
      RINCIAN_HEAD,
      ...pemasukan.map(rincianRow),
    ]
    XLSX.utils.book_append_sheet(
      wb,
      sheetRibuan(XLSX, omzetAoa, [
        { wch: 20 }, { wch: 13 }, { wch: 44 }, { wch: 22 },
        { wch: 14 }, { wch: 13 }, { wch: 22 }, { wch: 18 },
      ]),
      'Rincian Pemasukan',
    )
    XLSX.writeFile(wb, refFile(`Rekap-Pajak-${bizName}-${taxYear}.xlsx`))
    track('report_generated', { type: 'pajak_excel', year: taxYear })
  }

  // Tidak ada tombol unduh yang memanggil generator secara langsung — semuanya
  // lewat gerbang ini, supaya tidak ada jalur keluaran yang lolos tanpa penafian.
  const mintaUnduh = (jalankan, teks) => () => {
    let sudah = false
    try { sudah = sessionStorage.getItem(REF_ACK_KEY) === '1' } catch { /* mode privat */ }
    if (sudah) { jalankan(); return }
    setPendingUnduh({ jalankan, teks })
  }

  const setujuUnduh = () => {
    try { sessionStorage.setItem(REF_ACK_KEY, '1') } catch { /* mode privat */ }
    const tertahan = pendingUnduh
    setPendingUnduh(null)
    tertahan?.jalankan()
  }

  return (
    <>
      {txTotal > tx.length && (
        <div className="alert alert-err" style={{ marginBottom: 16 }}>
          {r.truncWarn.replace('{loaded}', tx.length.toLocaleString()).replace('{total}', txTotal.toLocaleString())}
        </div>
      )}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="flex between gap" style={{ flexWrap: 'wrap' }}>
          <div>
            <h3 className="card-title">{r.title}</h3>
            <div className="card-sub">{r.sub}</div>
          </div>
          <div className="flex gap" style={{ alignItems: 'center' }}>
            <label className="muted-sm">{r.period}</label>
            <select className="input" style={{ width: 'auto' }} value={period} onChange={(e) => setPeriod(e.target.value)} aria-label={r.period}>
              <option value="all">{r.allPeriods}</option>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="grid-kpi">
        <div className="card"><div className="kpi-l">{r.kIncome}</div><div className="kpi-v" style={{ color: 'var(--green)' }}>{rupiah(sum.income)}</div></div>
        <div className="card"><div className="kpi-l">{r.kExpense}</div><div className="kpi-v" style={{ color: 'var(--red)' }}>{rupiah(sum.expense)}</div></div>
        <div className="card"><div className="kpi-l">{r.kProfit}</div><div className="kpi-v">{rupiah(sum.profit)}</div></div>
        <div className="card">
          <div className="kpi-l">{r.kTax.replace('{year}', yearLabel)}</div>
          <div className="kpi-v">{rupiah(pphFinal)}</div>
          <div className="kpi-d muted-sm" style={{ color: 'var(--muted)' }}>{r.wpPrefix} {wpLabelOn}</div>
        </div>
      </div>

      {!taxInfo.eligibleFinal && (
        <div className="alert alert-err mt">{r.alertOver}</div>
      )}
      {taxpayerType === 'pribadi' && taxInfo.annualTurnover <= TAX.OMZET_BEBAS_PAJAK && taxInfo.annualTurnover > 0 && (
        <div className="alert alert-ok mt">{r.alertUnder}</div>
      )}

      <div className="rep-grid mt">
        <div className="rep-card">
          <div className="rh"><div className="ri"><Landmark size={22} /></div><div><h4>{r.cardPnlTitle} <span className="badge badge-amber">{r.refBadge}</span></h4><p>{r.cardPnlDesc}</p></div></div>
          <div className="rep-line"><span>{r.lTotalIncome}</span><b>{rupiah(sum.income)}</b></div>
          <div className="rep-line"><span>{r.lTotalExpense}</span><b>{rupiah(sum.expense)}</b></div>
          <div className="rep-line"><span>{r.lNetProfit}</span><b>{rupiah(sum.profit)}</b></div>
          <div className="ref-note" role="note"><AlertTriangle size={15} aria-hidden="true" /><p>{DISCLAIMER_KUR}</p></div>
          <div className="flex gap" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={mintaUnduh(generateLabaRugi, DISCLAIMER_KUR)}>{r.downloadPdf}</button>
            <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={mintaUnduh(generateExcel, DISCLAIMER_KUR)}>{r.downloadExcel}</button>
          </div>
        </div>

        <div className="rep-card">
          <div className="rh"><div className="ri"><Receipt size={22} /></div><div><h4>{r.cardTaxTitle} <span className="badge badge-amber">{r.refBadge}</span></h4><p>{r.cardTaxDesc}</p></div></div>
          <div className="rep-line"><span>{r.lGrossTurnover.replace('{year}', yearLabel)}</span><b>{rupiah(taxInfo.annualTurnover)}</b></div>
          <div className="rep-line"><span>{r.lExemptOP}</span><b>{rupiah(taxInfo.exemption)}</b></div>
          <div className="rep-line"><span>{r.lTaxable}</span><b>{rupiah(taxInfo.taxable)}</b></div>
          <div className="rep-line"><span>{r.lPphEst}</span><b>{rupiah(taxInfo.pphTotal)}</b></div>
          <div className="ref-note" role="note"><AlertTriangle size={15} aria-hidden="true" /><p>{DISCLAIMER_PAJAK}</p></div>
          <div className="flex gap" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={mintaUnduh(generateSPT, DISCLAIMER_PAJAK)}>{r.downloadPdf}</button>
            <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={mintaUnduh(generateTaxExcel, DISCLAIMER_PAJAK)}>{r.downloadExcel}</button>
          </div>
        </div>
      </div>

      {/* ISI LAPORAN DI LAYAR — Laba Rugi, Rekap Bulanan, Pengeluaran per Kategori.
          Sebelumnya isi ini hanya muncul di file PDF/Excel; sekarang bisa dilihat langsung. */}
      <div className="card card-pad mt">
        <h3 className="card-title">{r.pnlOnTitle.replace('{period}', periodLabel)}</h3>
        <div className="card-sub">{r.pnlOnSub}</div>
        <div className="pnl">
          <div className="pnl-row pnl-strong"><span>{r.pnlIncome}</span><b className="amt-in">{rupiah(sum.income)}</b></div>
          <div className="pnl-sub">{r.pnlExpenseHead}</div>
          {byCat.length ? byCat.map((c) => (
            <div className="pnl-row" key={c.name}><span>{c.name}</span><b>{rupiah(c.value)}</b></div>
          )) : (
            <div className="pnl-row"><span className="muted-sm">{r.pnlNoExpense}</span><b>{rupiah(0)}</b></div>
          )}
          <div className="pnl-row pnl-strong pnl-line"><span>{r.pnlTotalExpense}</span><b className="amt-out">{rupiah(sum.expense)}</b></div>
          <div className="pnl-row pnl-net"><span>{r.pnlNet}</span><b>{rupiah(sum.profit)}</b></div>
          <div className="pnl-row"><span className="muted-sm">{r.pnlMargin}</span><b>{sum.income ? Math.round(sum.profit / sum.income * 100) : 0}%</b></div>
        </div>
      </div>

      {monthly.length > 0 && (
        <div className="card card-pad mt">
          <h3 className="card-title">{r.monthlyTitle}</h3>
          <div className="card-sub">{r.monthlySub}</div>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>{r.thMonth}</th>
                  <th style={{ textAlign: 'right' }}>{r.thIncome}</th>
                  <th style={{ textAlign: 'right' }}>{r.thExpense}</th>
                  <th style={{ textAlign: 'right' }}>{r.thProfit}</th>
                </tr>
              </thead>
              <tbody>
                {monthly.slice().reverse().map((m) => (
                  <tr key={m.month}>
                    <td>{monthLabel(m.month)}</td>
                    <td style={{ textAlign: 'right' }} className="amt-in">{rupiah(m.income)}</td>
                    <td style={{ textAlign: 'right' }} className="amt-out">{rupiah(m.expense)}</td>
                    <td style={{ textAlign: 'right' }}><b>{rupiah(m.profit)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {byCat.length > 0 && (
        <div className="card card-pad mt">
          <h3 className="card-title">{r.catTitle.replace('{period}', periodLabel)}</h3>
          <div className="card-sub">{r.catSub}</div>
          <div className="cat-bars">
            {byCat.map((c) => {
              const pct = sum.expense > 0 ? Math.round(c.value / sum.expense * 100) : 0
              return (
                <div className="cat-bar" key={c.name}>
                  <div className="cat-bar-top"><span>{c.name}</span><b>{rupiah(c.value)} · {pct}%</b></div>
                  <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <p className="disclaimer mt">{r.disclaimer}</p>

      <div className="card card-pad mt">
        <h3 className="card-title">{r.eduTitle}</h3>
        <div className="card-sub">{r.eduSub}</div>
        <Accordion items={EDU} />
      </div>

      {pendingUnduh && (
        <Modal onClose={() => setPendingUnduh(null)} labelledBy="refAckTitle">
          <div className="modal-head">
            <h3 id="refAckTitle">{r.refModalTitle}</h3>
            <span className="badge badge-amber">{r.refBadge}</span>
          </div>
          <div className="modal-body">
            <p className="ref-modal-text">{pendingUnduh.teks}</p>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setPendingUnduh(null)}>{r.refModalCancel}</button>
              <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={setujuUnduh}>{r.refModalOk}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
