// Konstanta legal dipakai di halaman Ketentuan, Kebijakan Privasi, dialog
// persetujuan, dan metadata akun.

export const APP_NAME = 'BukuPintar AI'

// Versi dokumen persetujuan (gabungan Syarat & Ketentuan + Kebijakan Privasi).
// Naikkan versi ini setiap kali isi dokumen berubah secara berarti, agar
// pengguna lama diminta menyetujui kembali versi terbaru.
export const TERMS_VERSION = 'v3'
export const TERMS_EFFECTIVE = '4 Juni 2026'

// Identitas Pengendali Data dan kontak resmi.
// PENTING: ganti nilai di bawah dengan identitas dan email usaha Anda yang resmi
// agar dokumen hukum sah dan dapat dihubungi sesuai UU PDP.
export const CONTROLLER_NAME = 'Pengelola BukuPintar AI'
export const CONTACT_EMAIL = 'bukupintarai@gmail.com'

// Kunci localStorage untuk menyimpan jejak persetujuan di perangkat ini.
// Sumber kebenaran utama tetap di database (kolom accepted_terms pada profil);
// nilai ini hanya cache agar dialog tidak berkedip saat memuat halaman.
export const TERMS_ACK_KEY = `bukupintar_terms_ack_${TERMS_VERSION}`
