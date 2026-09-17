// ============================================================
// SATU PESAN = SATU KEJADIAN
//
// Aturan yang ditegakkan berkas ini, dan perbedaan halus yang menjadi seluruh
// isinya:
//
//   BOLEH    "beli stok indomie 24 bungkus"
//            → transaksi pengeluaran + catatan stok produk
//            Dua JENIS catatan, satu kejadian nyata. Memaksa pengguna
//            mengetiknya dua kali hanya menyusahkan tanpa menambah ketelitian.
//
//   DILARANG "kopi hitam 5pcs dan kopi latte 2pcs"
//            → dua penjualan
//            Satu JENIS catatan, dua kejadian berbeda.
//
// KENAPA YANG KEDUA DILARANG. Tiap aksi menjadi satu kartu yang harus
// diperiksa manusia sebelum tersimpan. Dua kartu penjualan yang muncul
// bersamaan terlihat nyaris identik — nominal dan nama produk berbeda, sisanya
// sama — dan di situlah persetujuan berubah jadi refleks: pengguna menekan
// Simpan dua kali tanpa benar-benar membaca yang kedua. Kalau model salah
// menafsirkan salah satunya, kesalahan itu baru ketahuan saat tutup buku,
// ketika sumbernya sudah tidak bisa ditelusuri lagi.
//
// Satu kartu per pesan memaksa pemeriksaan yang sebenarnya.
//
// DITEGAKKAN DI SERVER, BUKAN DI PROMPT. Prompt sudah meminta hal yang sama,
// tapi prompt adalah permintaan, bukan jaminan — dan ia akan bocor persis pada
// kalimat paling ambigu, yaitu kalimat yang paling butuh dijaga.
// ============================================================

/**
 * Penjaga satu-kejadian untuk satu pesan.
 *
 * Dibuat sebagai penutup (closure) yang menyimpan keadaannya sendiri, bukan
 * fungsi penyaring atas sebuah array, karena pemanggil terbesarnya (ai-crud)
 * memutuskan entitas sebuah aksi hanya SETELAH validasi async berjalan. Ia
 * tidak punya daftar lengkap di muka untuk disaring — ia menilai satu per satu
 * di dalam perulangan.
 *
 * Contoh:
 *   const penjaga = penjagaSatuKejadian()
 *   penjaga.terima('transaksi')  // true  — dicatat
 *   penjaga.terima('produk')     // true  — jenis lain, kejadian yang sama
 *   penjaga.terima('transaksi')  // false — kejadian kedua, dilewati
 *   penjaga.dilewati             // ['transaksi']
 */
export interface PenjagaSatuKejadian {
  /** true = aksi boleh diproses. false = jenis ini sudah terpakai di pesan ini. */
  terima(jenis: string): boolean
  /** Jenis yang ditolak, berurutan. Dipakai untuk memberi tahu pengguna. */
  readonly dilewati: string[]
}

export function penjagaSatuKejadian(): PenjagaSatuKejadian {
  const terpakai = new Set<string>()
  const dilewati: string[] = []
  return {
    terima(jenis: string) {
      // Jenis kosong/tidak dikenal tidak pernah dijadikan kunci: menganggap
      // semuanya satu jenis "" akan membuang aksi sah yang kebetulan tidak
      // membawa nama entitas. Gagal ke arah MEMPROSES, karena aksi tetap harus
      // dikonfirmasi manusia sebelum tersimpan — sedangkan aksi yang dibuang
      // diam-diam tidak pernah bisa dikoreksi siapa pun.
      const k = String(jenis || '').trim()
      if (!k) return true
      if (terpakai.has(k)) {
        dilewati.push(k)
        return false
      }
      terpakai.add(k)
      return true
    },
    get dilewati() {
      return dilewati
    },
  }
}

/**
 * Kalimat pemberitahuan untuk pengguna.
 *
 * Sengaja TIDAK menyamakan diri dengan pesan "kalimatnya terlalu panjang".
 * Keduanya sama-sama berarti "ada yang tidak diproses", tapi menuntut tindakan
 * berbeda: yang satu meminta pengguna memperpendek kalimat, yang satu
 * memberitahunya bahwa ia baru saja menggabungkan dua kejadian yang memang
 * harus dipisah. Menyamakannya mengajarkan kebiasaan yang salah.
 */
export function pesanDilewati(jumlah: number): string {
  if (jumlah <= 0) return ''
  return 'Sepertinya ada lebih dari satu kejadian di kalimat itu. '
    + 'Satu pesan hanya untuk satu kejadian, jadi saya catat yang pertama saja — '
    + 'kirim sisanya di pesan terpisah ya.'
}
