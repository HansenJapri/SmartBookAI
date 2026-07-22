import { useEffect, useMemo, useState } from 'react'
import { fetchTransactions, fetchProfile, fetchTxCount, track } from '../lib/api'
import { rupiah, fmtDate, monthKey } from '../lib/format'
import { summarize, monthlyBreakdown, expenseByCategory, taxSummaryForYear, TAX } from '../lib/analytics'
import Accordion from '../components/Accordion'
import { Landmark, Receipt, FileText } from 'lucide-react'
import { EDU } from '../lib/eduContent'

const MONTH_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const monthLabel = (k) => { const [y, m] = k.split('-'); return `${MONTH_ID[Number(m) - 1]} ${y}` }

export default function Reports() {
  const [tx, setTx] = useState(null)
  const [profile, setProfile] = useState(null)
  const [period, setPeriod] = useState('all')
  const [txTotal, setTxTotal] = useState(0)

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

  const taxpayerType = profile?.taxpayer_type || 'pribadi'
  // Tahun pajak: jika periode = bulan tertentu pakai tahunnya; jika 'all' pakai 'all'
  const taxYear = period === 'all' ? 'all' : period.slice(0, 4)
  // Pajak dihitung dari SEMUA transaksi (peredaran bruto setahun), bukan hanya periode terpilih
  const taxInfo = useMemo(
    () => taxSummaryForYear(monthly, taxYear, taxpayerType),
    [monthly, taxYear, taxpayerType]
  )
  const pphFinal = taxInfo.pphTotal
  const periodLabel = period === 'all' ? 'Seluruh Periode' : monthLabel(period)
  const bizName = profile?.business_name || 'Usaha Saya'

  if (!tx) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  if (tx.length === 0) {
    return <div className="card"><div className="empty">
      <div className="ee"><FileText size={36} /></div><h3>Belum ada data untuk laporan</h3>
      <p>Tambahkan atau import transaksi terlebih dahulu untuk menghasilkan laporan.</p>
    </div></div>
  }

  // ---------- PDF GENERATORS ----------
  const pdfHeader = (doc, title) => {
    doc.setFillColor(79, 70, 229)
    doc.rect(0, 0, 210, 26, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(15); doc.setFont(undefined, 'bold')
    doc.text('SmartBook AI', 14, 12)
    doc.setFontSize(10); doc.setFont(undefined, 'normal')
    doc.text(title, 14, 19)
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
    autoTable(doc, {
      startY: 54,
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
        head: [['Arus Kas per Bulan', 'Pemasukan', 'Pengeluaran', 'Laba Bersih']],
        body: monthly.map((m) => [monthLabel(m.month), rupiah(m.income), rupiah(m.expense), rupiah(m.profit)]),
        theme: 'grid', headStyles: { fillColor: [100, 116, 139] }, styles: { fontSize: 9 },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      })
    }
    doc.setFontSize(8); doc.setTextColor(120, 120, 120)
    doc.text('Disusun mengacu format Laporan Laba Rugi SAK EMKM. Alat bantu, bukan laporan teraudit.', 14, doc.internal.pageSize.height - 13)
    doc.text('Verifikasi dengan akuntan atau pihak bank sebelum diajukan.', 14, doc.internal.pageSize.height - 8.5)
    doc.save(`Laporan-LabaRugi-${bizName}-${period}.pdf`)
    track('report_generated', { type: 'labarugi_pdf', period })
  }

  // Ekspor laporan laba/rugi ke Excel yang rapi (3 lembar: ringkasan, rekap
  // bulanan, pengeluaran per kategori) dengan lebar kolom yang sudah diatur.
  const generateExcel = async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()

    const ringkasan = [
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
    const ws1 = XLSX.utils.aoa_to_sheet(ringkasan)
    ws1['!cols'] = [{ wch: 34 }, { wch: 20 }]
    XLSX.utils.book_append_sheet(wb, ws1, 'Ringkasan')

    const monthlyAoa = [
      ['Bulan', 'Pemasukan', 'Pengeluaran', 'Laba Bersih'],
      ...monthly.map((m) => [monthLabel(m.month), Math.round(m.income), Math.round(m.expense), Math.round(m.profit)]),
    ]
    const ws2 = XLSX.utils.aoa_to_sheet(monthlyAoa)
    ws2['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 16 }]
    XLSX.utils.book_append_sheet(wb, ws2, 'Rekap Bulanan')

    const catAoa = [
      ['Kategori Pengeluaran', 'Total (Rp)'],
      ...byCat.map((c) => [c.name, Math.round(c.value)]),
    ]
    const ws3 = XLSX.utils.aoa_to_sheet(catAoa)
    ws3['!cols'] = [{ wch: 30 }, { wch: 18 }]
    XLSX.utils.book_append_sheet(wb, ws3, 'Pengeluaran per Kategori')

    XLSX.writeFile(wb, `Laporan-LabaRugi-${bizName}-${period}.xlsx`)
    track('report_generated', { type: 'labarugi_excel', period })
  }

  const generateSPT = async () => {
    const { jsPDF, autoTable } = await loadPdf()
    const doc = new jsPDF()
    pdfHeader(doc, 'Rekap PPh Final UMKM 0,5% (PP 55/2022)')
    const wpLabel = taxpayerType === 'pribadi' ? 'Orang Pribadi' : 'Badan'
    autoTable(doc, {
      startY: 54,
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
      head: [['Bulan', 'Peredaran Bruto', 'Bebas Pajak', 'Dasar Kena Pajak', 'PPh 0,5%']],
      body: taxInfo.rows.map((r) => [monthLabel(r.month), rupiah(r.income), rupiah(r.exemptApplied), rupiah(r.taxable), rupiah(r.pph)]),
      theme: 'grid', headStyles: { fillColor: [22, 163, 74] }, styles: { fontSize: 8.5 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    })
    doc.setFontSize(8); doc.setTextColor(130, 130, 130)
    doc.text('Dasar hukum: PP 55/2022 dan UU 7/2021 (HPP). Estimasi alat bantu, verifikasi dengan DJP atau konsultan pajak.', 14, doc.internal.pageSize.height - 10)
    doc.save(`Rekap-Pajak-${bizName}-${taxYear}.pdf`)
    track('report_generated', { type: 'pajak', year: taxYear })
  }

  // Ekspor rekap pajak ke Excel.
  const generateTaxExcel = async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const wpLabel = taxpayerType === 'pribadi' ? 'Orang Pribadi' : 'Badan'
    const info = [
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
    const ws1 = XLSX.utils.aoa_to_sheet(info); ws1['!cols'] = [{ wch: 40 }, { wch: 20 }]
    XLSX.utils.book_append_sheet(wb, ws1, 'Ringkasan Pajak')
    const rowsAoa = [
      ['Bulan', 'Peredaran Bruto', 'Bebas Pajak', 'Dasar Kena Pajak', 'PPh 0,5%'],
      ...taxInfo.rows.map((r) => [monthLabel(r.month), Math.round(r.income), Math.round(r.exemptApplied), Math.round(r.taxable), Math.round(r.pph)]),
    ]
    const ws2 = XLSX.utils.aoa_to_sheet(rowsAoa); ws2['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, ws2, 'Rincian Bulanan')
    XLSX.writeFile(wb, `Rekap-Pajak-${bizName}-${taxYear}.xlsx`)
    track('report_generated', { type: 'pajak_excel', year: taxYear })
  }

  return (
    <>
      {txTotal > tx.length && (
        <div className="alert alert-err" style={{ marginBottom: 16 }}>
          Laporan dihitung dari {tx.length.toLocaleString('id-ID')} transaksi terbaru dari total {txTotal.toLocaleString('id-ID')}. Untuk periode lama yang lengkap, persempit periode atau hubungi pengelola.
        </div>
      )}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="flex between gap" style={{ flexWrap: 'wrap' }}>
          <div>
            <h3 className="card-title">Laporan Keuangan</h3>
            <div className="card-sub">Dihitung otomatis dari data transaksi nyata Anda.</div>
          </div>
          <div className="flex gap" style={{ alignItems: 'center' }}>
            <label className="muted-sm">Periode:</label>
            <select className="input" style={{ width: 'auto' }} value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Pilih periode laporan">
              <option value="all">Seluruh Periode</option>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="grid-kpi">
        <div className="card"><div className="kpi-l">Pendapatan</div><div className="kpi-v" style={{ color: 'var(--green)' }}>{rupiah(sum.income)}</div></div>
        <div className="card"><div className="kpi-l">Pengeluaran</div><div className="kpi-v" style={{ color: 'var(--red)' }}>{rupiah(sum.expense)}</div></div>
        <div className="card"><div className="kpi-l">Laba Bersih</div><div className="kpi-v">{rupiah(sum.profit)}</div></div>
        <div className="card">
          <div className="kpi-l">Est. PPh Final ({taxYear === 'all' ? 'total' : taxYear})</div>
          <div className="kpi-v">{rupiah(pphFinal)}</div>
          <div className="kpi-d muted-sm" style={{ color: 'var(--muted)' }}>WP {taxpayerType === 'pribadi' ? 'Orang Pribadi' : 'Badan'}</div>
        </div>
      </div>

      {!taxInfo.eligibleFinal && (
        <div className="alert alert-err mt">
          Peredaran bruto tahun ini <b>melebihi Rp 4,8 miliar</b>, sehingga usaha tidak lagi memakai tarif final 0,5%
          melainkan tarif PPh normal (wajib pembukuan). Estimasi 0,5% tidak berlaku. Konsultasikan dengan DJP atau konsultan.
        </div>
      )}
      {taxpayerType === 'pribadi' && taxInfo.annualTurnover <= TAX.OMZET_BEBAS_PAJAK && taxInfo.annualTurnover > 0 && (
        <div className="alert alert-ok mt">
          Omzet tahun ini masih di bawah <b>Rp 500 juta</b>. Sebagai WP Orang Pribadi, <b>estimasi PPh Final = Rp 0</b>
          (memanfaatkan fasilitas omzet tidak kena pajak). Tetap catat dan laporkan SPT Tahunan.
        </div>
      )}

      <div className="rep-grid mt">
        <div className="rep-card">
          <div className="rh"><div className="ri"><Landmark size={22} /></div><div><h4>Laporan Laba Rugi</h4><p>Format SAK EMKM, lengkap dan siap dilampirkan saat mengajukan KUR</p></div></div>
          <div className="rep-line"><span>Total Pendapatan</span><b>{rupiah(sum.income)}</b></div>
          <div className="rep-line"><span>Total Beban</span><b>{rupiah(sum.expense)}</b></div>
          <div className="rep-line"><span>Laba (Rugi) Bersih</span><b>{rupiah(sum.profit)}</b></div>
          <div className="flex gap" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={generateLabaRugi}>Unduh PDF</button>
            <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={generateExcel}>Unduh Excel</button>
          </div>
        </div>

        <div className="rep-card">
          <div className="rh"><div className="ri"><Receipt size={22} /></div><div><h4>Rekap Pajak (PPh Final 0,5%)</h4><p>Sesuai PP 55/2022 dan UU 7/2021 (HPP)</p></div></div>
          <div className="rep-line"><span>Peredaran bruto ({taxYear === 'all' ? 'total' : taxYear})</span><b>{rupiah(taxInfo.annualTurnover)}</b></div>
          <div className="rep-line"><span>Omzet bebas pajak (OP)</span><b>{rupiah(taxInfo.exemption)}</b></div>
          <div className="rep-line"><span>Dasar kena pajak</span><b>{rupiah(taxInfo.taxable)}</b></div>
          <div className="rep-line"><span>Estimasi PPh Final 0,5%</span><b>{rupiah(taxInfo.pphTotal)}</b></div>
          <div className="flex gap" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={generateSPT}>Unduh PDF</button>
            <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={generateTaxExcel}>Unduh Excel</button>
          </div>
        </div>
      </div>

      <p className="disclaimer mt">Estimasi pajak mengacu PP 55/2022; untuk pelaporan resmi, verifikasi dengan konsultan atau DJP. Laporan ini adalah bahan lampiran. Keputusan KUR ditentukan bank berdasarkan penilaian dan riwayat kredit (SLIK OJK), bukan oleh aplikasi ini.</p>

      <div className="card card-pad mt">
        <h3 className="card-title">Pelajari: KUR dan Pajak UMKM</h3>
        <div className="card-sub">Penjelasan ringkas agar Anda paham cara memakai laporan di atas.</div>
        <Accordion items={EDU} />
      </div>
    </>
  )
}
