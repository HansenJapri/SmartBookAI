// Teks baku penafian "REFERENSI" untuk laporan KUR dan Pajak (task B2).
//
// Teks di bawah adalah TEKS HUKUM BAKU. Jangan diparafrase, dipersingkat, atau
// "dirapikan" — kalimatnya dipilih untuk membatasi tanggung jawab pada titik
// yang tepat (bank penyalur untuk KUR, DJP untuk pajak).
//
// Kenapa konstanta, bukan kunci i18n: teks ini ikut tercetak ke dalam berkas
// PDF/Excel yang diserahkan ke bank atau DJP — lembaga Indonesia. Seluruh isi
// dokumen ekspor di Reports.jsx memang selalu Bahasa Indonesia terlepas dari
// bahasa antarmuka (lihat judul dan dasar hukum di generateSPT). Menampilkan
// teks yang sama di layar memastikan pengguna membaca persis apa yang akan
// dibaca penerima dokumen. Yang mengikuti useLang() hanya kelengkapan
// antarmuka di sekelilingnya: label lencana, judul dialog, dan tombol.

export const DISCLAIMER_PAJAK = `REFERENSI — BUKAN DOKUMEN RESMI PERPAJAKAN.
Perhitungan ini adalah estimasi alat bantu berdasarkan PP 55/2022 dan UU 7/2021 (HPP), dihitung dari data yang Anda masukkan sendiri. Angka dapat berbeda dari kewajiban pajak sebenarnya. Wajib diverifikasi ulang dengan DJP atau konsultan pajak sebelum digunakan untuk pelaporan apa pun. SmartBook AI tidak bertanggung jawab atas keputusan perpajakan yang diambil berdasarkan dokumen ini.`

export const DISCLAIMER_KUR = `REFERENSI — BUKAN JAMINAN PERSETUJUAN KREDIT.
Laporan ini disusun dari data yang Anda masukkan sendiri dan dapat dilampirkan sebagai dokumen pendukung. Keputusan pemberian KUR sepenuhnya ada pada bank penyalur dan mengacu pada penilaian SLIK OJK serta kebijakan internal bank. Kelengkapan laporan ini tidak menentukan kelolosan pengajuan. Verifikasi kembali seluruh angka sebelum diserahkan ke pihak mana pun.`

// Setiap berkas keluaran diawali penanda ini agar statusnya terbaca dari nama
// berkas saja — termasuk saat sudah berpindah tangan lewat WhatsApp atau surel.
export const REFERENSI_PREFIX = 'Referensi-'

export const refFile = (nama) => `${REFERENSI_PREFIX}${nama}`

// Tinggi area penafian di kaki halaman PDF (mm). Dipakai juga sebagai
// margin bawah autoTable supaya tabel tidak pernah menimpa penafian.
export const PDF_FOOTER_H = 26

// Menstempel penafian di KAKI SETIAP HALAMAN, bukan hanya halaman terakhir.
// Dipanggil setelah seluruh isi selesai digambar, karena jumlah halaman baru
// diketahui di akhir.
export function stampPdfDisclaimer(doc, text) {
  const total = doc.internal.getNumberOfPages()
  const w = doc.internal.pageSize.width
  const h = doc.internal.pageSize.height

  doc.setFontSize(7)
  doc.setFont(undefined, 'normal')
  const lines = doc.splitTextToSize(text, w - 28)

  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    const top = h - PDF_FOOTER_H

    doc.setDrawColor(245, 158, 11)
    doc.setLineWidth(0.5)
    doc.line(14, top, w - 14, top)

    doc.setFontSize(7)
    doc.setFont(undefined, 'normal')
    doc.setTextColor(146, 104, 12)
    doc.text(lines, 14, top + 4)

    doc.setTextColor(150, 150, 150)
    doc.text(`Halaman ${i} dari ${total}`, w - 14, h - 5, { align: 'right' })
  }

  doc.setTextColor(30, 30, 30)
}

// Lencana REFERENSI di kanan atas header PDF.
export function stampPdfBadge(doc) {
  const w = doc.internal.pageSize.width
  doc.setFillColor(245, 158, 11)
  doc.roundedRect(w - 52, 6.5, 38, 10, 2, 2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(9)
  doc.setFont(undefined, 'bold')
  doc.text('REFERENSI', w - 33, 13.2, { align: 'center' })
  doc.setFont(undefined, 'normal')
}

// Memotong teks panjang di batas kata supaya satu sel Excel tetap terbaca
// tanpa perlu melebarkan kolom.
function wrapKata(s, maks) {
  const out = []
  let baris = ''
  for (const kata of s.split(' ')) {
    if (baris && (`${baris} ${kata}`).length > maks) { out.push(baris); baris = kata }
    else baris = baris ? `${baris} ${kata}` : kata
  }
  if (baris) out.push(baris)
  return out
}

// Baris penafian untuk ditaruh DI ATAS data pada sheet pertama Excel.
export function disclaimerAoa(text) {
  const [judul, ...sisa] = text.split('\n')
  return [[judul], ...wrapKata(sisa.join(' '), 95).map((b) => [b]), []]
}
