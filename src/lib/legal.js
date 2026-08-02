// Konstanta legal dipakai di halaman Ketentuan, Kebijakan Privasi, dialog
// persetujuan, dan metadata akun.

export const APP_NAME = 'SmartBook AI'

// Versi dokumen persetujuan (gabungan Syarat & Ketentuan + Kebijakan Privasi).
// Naikkan versi ini setiap kali isi dokumen berubah secara berarti, agar
// pengguna lama diminta menyetujui kembali versi terbaru.
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

// Kunci localStorage untuk menyimpan jejak persetujuan di perangkat ini.
// Sumber kebenaran utama tetap di database (kolom accepted_terms pada profil);
// nilai ini hanya cache agar dialog tidak berkedip saat memuat halaman.
export const TERMS_ACK_KEY = `bukupintar_terms_ack_${TERMS_VERSION}`
