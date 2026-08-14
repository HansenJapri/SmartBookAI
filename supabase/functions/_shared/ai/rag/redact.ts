// ============================================================
// REDAKSI PII untuk konteks RAG asisten.
//
// Aturan utamanya ada di domains.ts: setiap domain menyebut DAFTAR-IZIN kolom
// secara eksplisit, tidak pernah select('*'). Itu pertahanan yang benar —
// kolom baru yang ditambahkan ke tabel di masa depan tidak otomatis ikut
// terkirim ke Gemini.
//
// Berkas ini adalah JARING PENGAMAN di bawahnya, untuk kesalahan manusia yang
// pasti terjadi cepat atau lambat: seseorang menambah 'phone' ke daftar-izin
// domain hr karena sedang butuh, lalu lupa mencabutnya. Daftar-izin tetap
// pertahanan utama; ini yang menangkap saat pertahanan utama keliru diisi.
//
// Dua peran, sengaja dipisah:
//   - saringKolomAman()  dipakai SAAT JALAN. Gagal tertutup pada DATANYA:
//                        kolom PII dibuang diam-diam, permintaan tetap dilayani.
//                        Asisten yang mati total untuk semua pengguna karena
//                        satu kolom salah daftar adalah obat yang lebih buruk
//                        dari penyakitnya.
//   - kolomTerlarang()   dipakai TEST INVARIAN. Gagal keras di CI, supaya
//                        kekeliruannya diperbaiki di sumbernya, bukan hanya
//                        disaring diam-diam selamanya.
// ============================================================

/**
 * Pola nama kolom yang TIDAK BOLEH dikirim ke layanan AI.
 *
 * Semuanya memakai batas (^|_) dan (_|$) — bukan pencocokan substring bebas.
 * Alasannya konkret: pola /hp/ polos ikut mencocokkan `hpp_per_unit`, dan HPP
 * justru angka yang paling sering ditanyakan pemilik UMKM. Pola /pin/ polos
 * mencocokkan `pinjaman`. Daftar larangan yang terlalu rakus akan diam-diam
 * memakan kolom yang sah, dan gejalanya muncul sebagai "AI-nya bego" — bukan
 * sebagai error yang bisa dilacak.
 */
export const POLA_KOLOM_PII: RegExp[] = [
  /(^|_)(phone|telp|telpon|telepon|hp|wa|whatsapp|mobile|kontak|contact)(_|$)/i,
  /(^|_)e?mail(_|$)/i,
  /(^|_)(address|alamat|street|kelurahan|kecamatan)(_|$)/i,
  /(rekening|norek|bank_account|account_number|iban|card_number|kartu_kredit)/i,
  /(password|passwd|sandi|(^|_)pin(_|$)|token|secret|api_?key|otp)/i,
  /(^|_)(nik|ktp|npwp|passport|paspor|kk)(_|$)/i,
  /(^|_)raw(_|$)/i, // transactions.raw = baris mutasi bank mentah; bisa memuat nomor rekening
]

/** Kolom dari daftar yang melanggar aturan PII. Kosong = aman. */
export function kolomTerlarang(kolom: readonly string[]): string[] {
  return kolom.filter((k) => POLA_KOLOM_PII.some((p) => p.test(k)))
}

/** Versi daftar kolom yang sudah dibuang bagian PII-nya. */
export function saringKolomAman(kolom: readonly string[]): string[] {
  return kolom.filter((k) => !POLA_KOLOM_PII.some((p) => p.test(k)))
}

// ------------------------------------------------------------
// Pseudonimisasi
// ------------------------------------------------------------

/**
 * Hash FNV-1a 32-bit. Dipakai HANYA untuk membuat label yang stabil, bukan
 * untuk keamanan — dan memang tidak perlu: yang dilindungi adalah nama asli,
 * yang tidak pernah ikut dikirim sama sekali. Label ini cuma cara menyebut
 * "orang yang sama" tanpa menyebut siapa.
 */
function fnv1a(teks: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < teks.length; i++) {
    h ^= teks.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * Nama asli -> label samaran yang stabil, mis. "Pelanggan #4821".
 *
 * Diturunkan dari id lewat hash, BUKAN dari nomor urut hasil query. Nomor urut
 * akan berubah setiap kali daftarnya berubah — pelanggan yang tadi "#3" bisa
 * jadi "#5" di pertanyaan berikutnya, sementara riwayat percakapan yang dikirim
 * ke model masih memuat "#3". Model lalu bicara tentang dua orang berbeda
 * seolah satu orang. Hash membuat labelnya tetap sama antar-giliran maupun
 * antar-permintaan.
 */
export function samarkan(prefix: string, id: unknown): string {
  const kunci = String(id ?? '').trim()
  if (!kunci) return `${prefix} (tidak dikenal)`
  return `${prefix} #${1000 + (fnv1a(kunci) % 9000)}`
}
