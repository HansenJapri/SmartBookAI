// Konstanta legal dipakai di halaman Ketentuan, Kebijakan Privasi, dialog
// persetujuan, dan metadata akun.

export const APP_NAME = 'SmartBook AI'

// Versi dokumen persetujuan (gabungan Syarat & Ketentuan + Kebijakan Privasi).
// Dicatat pada profil sebagai jejak versi yang disetujui saat akun dibuat.
// Persetujuan hanya diminta SEKALI, yaitu di halaman Daftar; menaikkan versi
// TIDAK memunculkan dialog persetujuan ulang di dalam aplikasi.
export const TERMS_VERSION = 'v4'
export const TERMS_EFFECTIVE = '2 Agustus 2026'

// Identitas Pengendali Data dan kontak resmi.
//
// Bentuk usaha saat ini PERORANGAN, belum badan hukum. UU PDP 27/2022 mengakui
// orang perseorangan sebagai Pengendali Data, jadi nilai di bawah sah dipakai.
// JANGAN menulis awalan "PT" di sini sebelum SK pengesahan Kemenkumham terbit:
// PT baru berstatus badan hukum sejak tanggal SK (UU 40/2007 Pasal 7 ayat 4),
// dan mencantumkan status badan hukum yang belum ada membuat Kebijakan Privasi
// serta Syarat & Ketentuan memuat pernyataan yang tidak benar.
//
// TODO(sebelum rilis publik): CONTACT_EMAIL masih Gmail pribadi. Ganti ke surel
// berdomain usaha. Alamat ini adalah kanal resmi pelaksanaan hak subjek data
// (akses, koreksi, penghapusan); kehilangan akses ke akun Gmail berarti
// kewajiban UU PDP terputus tanpa jalur pemulihan.
export const CONTROLLER_NAME = 'Sovralytics Technology (usaha perorangan)'
export const CONTACT_EMAIL = 'sovralyticstech@gmail.com'

// Kanal sales via WhatsApp. Nomor ditulis format internasional tanpa "+" karena
// itu yang diterima wa.me. Pesan awal di-encode lewat encodeURIComponent supaya
// spasi, koma, dan tanda baca tidak memutus query string di sebagian peramban
// ponsel (menempelkan string yang sudah di-encode manual berisiko double-encode).
export const SALES_WHATSAPP = '6289527058398'
export const SALES_WHATSAPP_MESSAGE =
  'Halo tim SmartBook AI, saya tertarik untuk konsultasi fitur dan implementasinya'
export const SALES_WHATSAPP_URL =
  `https://wa.me/${SALES_WHATSAPP}?text=${encodeURIComponent(SALES_WHATSAPP_MESSAGE)}`
