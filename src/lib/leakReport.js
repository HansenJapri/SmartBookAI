// ---------- LAPORAN KEBOCORAN 1 HALAMAN (task C1) ----------
//
// Aset penjualan utama: hasil "audit kebocoran gratis" yang diserahkan ke calon
// pengguna. Karena itu urutannya tetap dan angka terbesarnya adalah kerugian,
// bukan omzet.
//
// Digambar sebagai teks jsPDF, bukan tangkapan layar html2canvas seperti
// invoice.js. Tiga alasan: teks tetap tajam saat di-zoom di layar HP, berkasnya
// jauh lebih ringan untuk dikirim lewat WhatsApp, dan tidak ada ketergantungan
// pada DOM sehingga mode demo (/demo, tanpa login) memakai jalur yang sama persis.

import { rupiah } from './format'

const INDIGO = [79, 70, 229]
const MERAH = [225, 29, 72]
const HIJAU = [22, 163, 74]
const ABU = [110, 110, 110]
const GELAP = [30, 30, 30]

// Pembulatan DISAMAKAN dengan Reveal.jsx supaya angka di PDF tidak pernah
// berbeda satu digit pun dari yang dilihat pengguna di layar.
export function leakFigures(r) {
  const marginAsli = Math.round(r.marginAsli * 1000) / 10
  const marginDikira = Math.round(r.marginDikira * 1000) / 10
  return {
    marginAsli,
    marginDikira,
    // Selisihnya secara matematis selalu sama dengan porsi kebocoran; dihitung
    // dari nilai yang SUDAH dibulatkan agar ketiganya konsisten di halaman.
    selisih: Math.round((marginDikira - marginAsli) * 10) / 10,
    leakPct: r.grossOmzet ? Math.round((r.leak / r.grossOmzet) * 100) : 0,
  }
}

// Kalimat kesimpulan otomatis. Template ini ditetapkan di spec C1 dan sengaja
// berbeda dari leakInsight() di reveal.js: yang itu untuk disalin ke chat,
// yang ini untuk dibaca di dokumen cetak.
export function leakConclusion(r) {
  if (!r || !r.grossOmzet) {
    return 'Belum ada data penjualan pada periode ini untuk dianalisis.'
  }
  const f = leakFigures(r)
  return `Dari omzet kotor ${rupiah(r.grossOmzet)}, sebanyak ${rupiah(r.leak)} (${f.leakPct}%) `
    + `habis sebelum masuk rekening. Margin aslimu ${f.marginAsli}%, bukan ${f.marginDikira}%.`
}

// Maksimal channel yang dicetak. Dibatasi agar laporan DIJAMIN satu halaman;
// sisanya diringkas jadi satu baris supaya totalnya tetap jujur.
const MAKS_CHANNEL = 6

export function channelRows(perChannel) {
  const urut = [...(perChannel || [])].sort((a, b) => b.fee - a.fee)
  if (urut.length <= MAKS_CHANNEL) return { tampil: urut, sisa: null }
  const tampil = urut.slice(0, MAKS_CHANNEL)
  const sisaArr = urut.slice(MAKS_CHANNEL)
  const sisa = sisaArr.reduce(
    (acc, c) => ({ jml: acc.jml + 1, gross: acc.gross + c.gross, fee: acc.fee + c.fee }),
    { jml: 0, gross: 0, fee: 0 },
  )
  return { tampil, sisa }
}

const pct = (bagian, total) => (total ? Math.round((bagian / total) * 1000) / 10 : 0)

export async function buildLeakReport({ reveal, bizName, periodLabel }) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'),
  ])
  const doc = new jsPDF()
  const W = doc.internal.pageSize.width
  const H = doc.internal.pageSize.height
  const f = leakFigures(reveal)

  // ---------- HEADER ----------
  doc.setFillColor(...INDIGO)
  doc.rect(0, 0, W, 30, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16); doc.setFont(undefined, 'bold')
  doc.text('SmartBook AI', 14, 13)
  doc.setFontSize(11); doc.setFont(undefined, 'normal')
  doc.text('Laporan Kebocoran', 14, 21)
  doc.setFontSize(9)
  doc.text(periodLabel, W - 14, 13, { align: 'right' })
  doc.text(`Dicetak ${new Date().toLocaleDateString('id-ID')}`, W - 14, 21, { align: 'right' })

  doc.setTextColor(...GELAP)
  doc.setFontSize(13); doc.setFont(undefined, 'bold')
  doc.text(bizName, 14, 41)

  // ---------- ANGKA UTAMA ----------
  // Yang paling besar di halaman adalah uang yang hilang. Ini seluruh alasan
  // dokumen ini dibuat; omzet justru dikecilkan jadi konteks.
  doc.setFillColor(254, 242, 242)
  doc.roundedRect(14, 47, W - 28, 34, 3, 3, 'F')
  doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(...ABU)
  doc.text('TOTAL KEBOCORAN', 20, 56)
  doc.setFontSize(28); doc.setFont(undefined, 'bold'); doc.setTextColor(...MERAH)
  doc.text(rupiah(reveal.leak), 20, 70)
  doc.setFontSize(11); doc.setFont(undefined, 'bold')
  doc.text(`${f.leakPct}% dari omzet kotor`, 20, 77)
  doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(...ABU)
  doc.text(`Omzet kotor ${rupiah(reveal.grossOmzet)}`, W - 20, 56, { align: 'right' })
  doc.text(`Masuk rekening ${rupiah(reveal.netReceived)}`, W - 20, 63, { align: 'right' })

  // ---------- PERBANDINGAN MARGIN ----------
  const kotakY = 87
  const kotakW = (W - 28 - 6) / 2
  doc.setFillColor(245, 245, 245)
  doc.roundedRect(14, kotakY, kotakW, 26, 3, 3, 'F')
  doc.setFillColor(240, 253, 244)
  doc.roundedRect(14 + kotakW + 6, kotakY, kotakW, 26, 3, 3, 'F')

  doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(...ABU)
  doc.text('Margin yang DIKIRA', 20, kotakY + 9)
  doc.text('Margin ASLI', 20 + kotakW + 6, kotakY + 9)
  doc.setFontSize(20); doc.setFont(undefined, 'bold'); doc.setTextColor(...ABU)
  doc.text(`${f.marginDikira}%`, 20, kotakY + 21)
  doc.setTextColor(...HIJAU)
  doc.text(`${f.marginAsli}%`, 20 + kotakW + 6, kotakY + 21)

  doc.setFillColor(...MERAH)
  doc.roundedRect(14, kotakY + 29, W - 28, 11, 2, 2, 'F')
  doc.setTextColor(255, 255, 255); doc.setFontSize(10); doc.setFont(undefined, 'bold')
  doc.text(`Selisih ${f.selisih} poin persen — inilah yang hilang sebelum uangnya sampai ke kamu.`, W / 2, kotakY + 36.5, { align: 'center' })

  // ---------- RINCIAN BIAYA ----------
  autoTable(doc, {
    startY: kotakY + 46,
    head: [['Rincian biaya penjualan', 'Nominal', '% dari omzet kotor']],
    body: [
      ['Biaya Admin & Komisi', rupiah(reveal.feeAdmin), `${pct(reveal.feeAdmin, reveal.grossOmzet)}%`],
      ['Ongkir Ditanggung Penjual', rupiah(reveal.feeOngkir), `${pct(reveal.feeOngkir, reveal.grossOmzet)}%`],
      ['Iklan & Promosi', rupiah(reveal.feeIklan), `${pct(reveal.feeIklan, reveal.grossOmzet)}%`],
    ],
    theme: 'striped',
    headStyles: { fillColor: INDIGO, textColor: 255, fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 2.6 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })

  // ---------- TABEL PER CHANNEL ----------
  const { tampil, sisa } = channelRows(reveal.perChannel)
  const body = tampil.map((c) => [
    c.name, rupiah(c.gross), rupiah(c.fee), rupiah(c.net), `${Math.round(c.pct * 100)}%`,
  ])
  if (sisa) {
    body.push([
      `${sisa.jml} channel lainnya`, rupiah(sisa.gross), rupiah(sisa.fee),
      rupiah(sisa.gross - sisa.fee), `${pct(sisa.fee, sisa.gross)}%`,
    ])
  }
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 6,
    head: [['Channel', 'Omzet', 'Potongan', 'Bersih', '%']],
    body: body.length ? body : [['Belum ada channel tercatat', '-', '-', '-', '-']],
    theme: 'grid',
    headStyles: { fillColor: [100, 116, 139], textColor: 255, fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 2.6 },
    columnStyles: {
      1: { halign: 'right' }, 2: { halign: 'right', textColor: MERAH },
      3: { halign: 'right' }, 4: { halign: 'right' },
    },
    margin: { left: 14, right: 14 },
  })

  // ---------- KALIMAT KESIMPULAN ----------
  const kesimpulanY = doc.lastAutoTable.finalY + 7
  doc.setFillColor(255, 251, 235)
  doc.setDrawColor(253, 230, 138)
  doc.setLineWidth(0.4)
  doc.roundedRect(14, kesimpulanY, W - 28, 20, 3, 3, 'FD')
  doc.setTextColor(...GELAP); doc.setFontSize(10); doc.setFont(undefined, 'bold')
  const baris = doc.splitTextToSize(leakConclusion(reveal), W - 40)
  doc.text(baris, 20, kesimpulanY + 8)

  // ---------- FOOTER ----------
  doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.4)
  doc.line(14, H - 16, W - 14, H - 16)
  doc.setFontSize(8); doc.setFont(undefined, 'normal'); doc.setTextColor(...ABU)
  doc.text('Dihitung dari data yang Anda masukkan. Verifikasi dengan laporan resmi marketplace.', 14, H - 10)

  return doc
}

export const leakReportFileName = (bizName, periode) =>
  `Laporan-Kebocoran-${bizName}-${periode}.pdf`

export async function downloadLeakReport(opts) {
  const doc = await buildLeakReport(opts)
  doc.save(leakReportFileName(opts.bizName, opts.periodeFile ?? opts.periodLabel))
}
