// Pemformatan angka untuk berkas ekspor (Excel & CSV).
//
// Kebutuhan produk: setiap kolom nominal di berkas ekspor harus terbaca dengan
// pemisah ribuan berupa TITIK — 1200000 tampil sebagai "1.200.000".
//
// Ada dua jalur, karena dua format berkas ini beda sifat:
//
// 1. EXCEL (.xlsx) — sel tetap ANGKA, yang diubah hanya format tampilannya.
//    Menulis "1.200.000" sebagai teks memang menjamin titiknya terlihat, tapi
//    merusak fungsi utama spreadsheet: SUM, filter, dan grafik berhenti bekerja,
//    dan bank/konsultan yang menerima berkasnya tidak bisa mengolah angkanya.
//    Kode format Excel `#,##0` sendiri bersifat lokal — pemisahnya mengikuti
//    setelan Windows si pembuka berkas, jadi di Excel berbahasa Inggris akan
//    muncul koma. Awalan `[$-421]` (LCID Indonesia) memaksa Excel & LibreOffice
//    merender baris itu dengan aturan Indonesia, sehingga titiknya konsisten
//    tanpa mengorbankan tipe angka.
//
// 2. CSV — tidak punya lapisan format sama sekali; satu-satunya cara adalah
//    menulis teks yang sudah diformat. Dipakai lewat formatRibuan().

// LCID 0x421 = Indonesian (Indonesia).
export const NUMFMT_RUPIAH = '[$-421]#,##0'
export const NUMFMT_RUPIAH_DESIMAL = '[$-421]#,##0.00'

// Teks angka bergaya Indonesia: 1200000 -> "1.200.000".
// Dipakai untuk CSV dan untuk sel Excel yang memang harus berupa teks.
export const formatRibuan = (n) => {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(v))
}

// Versi dengan desimal (mis. persentase atau qty pecahan).
export const formatRibuanDesimal = (n, desimal = 2) => {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: desimal,
  }).format(v)
}

// Menstempel format ribuan Indonesia pada SEMUA sel bertipe angka di sebuah
// worksheet SheetJS. Sengaja menyapu seluruh sel, bukan daftar kolom tertentu:
// kolom laporan sering bergeser saat isinya berubah, dan sel non-angka
// (judul, label, tanggal-sebagai-teks) tidak tersentuh karena `t !== 'n'`.
export function terapkanFormatRibuan(ws, { format = NUMFMT_RUPIAH } = {}) {
  for (const alamat of Object.keys(ws)) {
    if (alamat[0] === '!') continue        // properti sheet (!ref, !cols, ...)
    const sel = ws[alamat]
    if (sel && sel.t === 'n') sel.z = format
  }
  return ws
}

// Membuat worksheet dari array-of-arrays sekaligus mengatur lebar kolom dan
// format ribuan — supaya setiap pemanggil tidak lupa salah satunya.
export function sheetRibuan(XLSX, aoa, cols) {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  if (cols) ws['!cols'] = cols
  return terapkanFormatRibuan(ws)
}
