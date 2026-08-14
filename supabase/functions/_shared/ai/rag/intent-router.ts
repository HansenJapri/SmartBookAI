// ============================================================
// ROUTER NIAT — pertanyaan pengguna -> domain data yang perlu diambil.
//
// Kenapa deterministik (kata kunci), bukan panggilan AI kedua:
//   - Kuota. checkQuota() di BukuPencatatan/index.ts membatasi pemakaian
//     harian PER WORKSPACE. Router ber-AI menggandakan konsumsinya, jadi
//     pengguna kena batas harian di tengah hari untuk jumlah pertanyaan yang
//     sama.
//   - Latensi. Jalur ini sudah dibatasi 45 detik di src/lib/ai.js. Menambah
//     satu perjalanan bolak-balik ke Gemini sebelum query database bahkan
//     dimulai memakan anggaran waktu yang tidak ada.
//   - Bisa diuji. Fungsi murni tanpa I/O; kegagalan routing tampak sebagai
//     test merah, bukan sebagai jawaban AI yang aneh sesekali.
//
// PENTING — routing BUKAN otorisasi. Router ini dengan senang hati mengembalikan
// domain 'lainnya' untuk staf biasa. Yang menolaknya adalah gerbang hak akses di
// domains.ts/retrievers.ts (scope.can + scope.isOwner), SEBELUM satu query pun
// jalan. Jangan pernah memakai keluaran router sebagai penentu boleh-tidaknya.
// ============================================================

/**
 * Tujuh domain data. Berkas ini yang memegang identitas domain; domains.ts
 * (peta tabel & kolom) mengimpor dari sini supaya daftarnya tidak pernah ada
 * dua versi yang bisa berbeda diam-diam.
 */
export const SEMUA_DOMAIN = [
  'ringkasan',
  'operasional',
  'transaksi',
  'produk',
  'hr',
  'analisis',
  'lainnya',
] as const

export type DomainKey = (typeof SEMUA_DOMAIN)[number]

/**
 * Batas jumlah domain pendukung.
 *
 * Tanpa batas, pertanyaan yang menyentuh banyak kata kunci ("gimana kondisi
 * usaha saya, stok, karyawan, sama tagihan?") menarik keenam domain sekaligus.
 * Masing-masing membawa beberapa tabel, dan prompt membengkak justru pada
 * pertanyaan yang jawabannya paling butuh ketajaman.
 *
 * 'ringkasan' tidak dihitung terhadap batas ini — isinya agregat, beberapa
 * baris saja, dan menjadi dasar hampir setiap jawaban.
 */
export const MAKS_PENDUKUNG = 3

// ------------------------------------------------------------
// Normalisasi
// ------------------------------------------------------------

/**
 * Klitik Bahasa Indonesia yang menempel di akhir kata.
 *
 * Ini bukan kehalusan linguistik — ini penyebab kegagalan yang persis dilaporkan
 * pengguna. Pertanyaan aslinya "listkan semua produk saya dan sisa STOKNYA".
 * Pencocokan batas-kata biasa (\bstok\b) TIDAK cocok dengan "stoknya", karena
 * huruf setelahnya masih huruf. Tanpa pengupasan ini, router meleset justru pada
 * bentuk kalimat yang paling wajar diucapkan pemilik warung: "gajinya",
 * "karyawannya", "tugasnya", "harganya".
 *
 * Diurut dari yang terpanjang supaya "apakah" tidak salah dipotong sebagai "ku".
 */
const KLITIK = ['nya', 'kah', 'lah', 'pun', 'ku', 'mu']

/**
 * Kupas klitik, tapi hanya bila sisa katanya masih >= 3 huruf.
 *
 * Syarat panjang itu yang menjaga kata-kata biasa tetap utuh: "punya" tidak
 * jadi "pu", "buku" tidak jadi "bu", "kamu" tidak jadi "ka". Tanpa syarat ini
 * normalisasi merusak lebih banyak daripada yang diperbaikinya.
 */
function bakukan(kata: string): string {
  for (const k of KLITIK) {
    if (kata.length > k.length + 2 && kata.endsWith(k)) return kata.slice(0, -k.length)
  }
  return kata
}

/**
 * Pesan -> deret token baku, diapit spasi di kedua ujung.
 *
 * Diapit spasi supaya pencocokan kata dan frasa memakai cara yang SAMA:
 * cukup cari ' kata ' atau ' dua kata '. Tanpa itu, kata kunci "po" ikut
 * tercocok di dalam "toko" dan "produk" — dan kesalahan seperti itu tidak
 * kelihatan sampai ada pengguna yang bertanya soal tokonya.
 */
export function normalisasi(pesan: unknown): string {
  const token = String(pesan ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(bakukan)
  return token.length ? ` ${token.join(' ')} ` : ' '
}

// ------------------------------------------------------------
// Kata kunci
// ------------------------------------------------------------
//
// Semua entri WAJIB sudah dalam bentuk baku (huruf kecil, tanpa klitik, tanpa
// tanda baca) — dijaga oleh test invarian. Tumpang tindih antar-domain
// disengaja: "pembelian" masuk akal untuk produk maupun transaksi, dan
// penilaian berbasis jumlah kecocokan yang memutuskan mana yang menang.

export const KATA_KUNCI: Record<DomainKey, string[]> = {
  ringkasan: [
    'laba', 'rugi', 'untung', 'profit', 'omzet', 'omset', 'margin',
    'pendapatan', 'performa', 'kinerja usaha', 'target', 'ringkasan',
    'dashboard', 'tren', 'perkembangan', 'kondisi usaha', 'sehat',
    'bulan ini', 'hari ini', 'minggu ini', 'gimana usaha', 'bagaimana usaha',
  ],
  operasional: [
    'tugas', 'task', 'pekerjaan', 'kerjaan', 'antre', 'antri', 'dikerjakan',
    'papan tugas', 'pengingat', 'reminder', 'jadwal', 'deadline', 'agenda',
    'todo', 'to do', 'petugas', 'assignee',
  ],
  transaksi: [
    'transaksi', 'penjualan', 'jual', 'jualan', 'laku', 'terjual', 'pemasukan',
    'pengeluaran', 'belanja', 'piutang', 'utang', 'hutang', 'lunas',
    'tagih', 'menagih', 'struk', 'nota', 'invoice', 'pelanggan', 'customer',
    'kasir', 'bayar', 'pembayaran', 'rekonsiliasi', 'duplikat', 'mutasi',
    'import', 'jatuh tempo', 'belum bayar', 'kategori pengeluaran',
  ],
  produk: [
    'stok', 'stock', 'produk', 'barang', 'item', 'sku', 'sisa', 'menipis',
    'habis', 'inventaris', 'inventory', 'gudang', 'po', 'purchase order',
    'opname', 'pemasok', 'supplier', 'hpp', 'modal', 'bom', 'komposisi',
    'bahan baku', 'satuan', 'kemasan', 'restock', 'pembelian',
    // 'harga' polos ada di sini, bukan di analisis: ia kolom milik produk.
    // Frasa 'harga bahan'/'harga pasar' di analisis tetap menang karena
    // mencocokkan dua kata kunci sekaligus, jadi "harga bahan pokok naik"
    // tidak tertarik ke domain produk.
    'harga',
  ],
  hr: [
    'karyawan', 'pegawai', 'staf', 'staff', 'employee', 'absen', 'absensi',
    'kehadiran', 'hadir', 'cuti', 'sakit', 'alpa', 'gaji', 'gajian',
    'payroll', 'penggajian', 'upah', 'kpi', 'bonus', 'potongan', 'tunjangan',
    'lembur', 'shift', 'tim',
  ],
  analisis: [
    'radar', 'harga bahan', 'harga pasar', 'bahan pokok', 'bapok', 'inflasi',
    'kurs', 'dolar', 'dollar', 'usd', 'prediksi harga', 'tren harga',
    'laporan', 'pajak', 'kebocoran', 'marketplace', 'komisi', 'pihps',
    'sp2kp', 'provinsi',
  ],
  lainnya: [
    'audit', 'log', 'riwayat', 'riwayat perubahan', 'siapa mengubah',
    'siapa yang mengubah', 'siapa yang hapus', 'siapa yang menghapus',
    'hak akses', 'undang', 'undangan', 'pengguna', 'izin akses', 'pengaturan',
    'setting', 'profil usaha', 'channel', 'feedback', 'masukan',
  ],
}

/**
 * Urutan penentu saat skor seri.
 *
 * Tanpa aturan ini, dua domain berskor sama diputuskan oleh urutan iterasi
 * objek — stabil hari ini, bisa berubah saat daftar disusun ulang, dan
 * gejalanya adalah routing yang berpindah sendiri tanpa satu baris pun diubah.
 * Urutannya: yang paling spesifik lebih dulu, 'ringkasan' paling akhir karena
 * ia toh selalu ikut sebagai pendukung.
 */
const URUTAN_SERI: DomainKey[] = [
  'produk', 'hr', 'transaksi', 'operasional', 'analisis', 'lainnya', 'ringkasan',
]

// ------------------------------------------------------------
// Routing
// ------------------------------------------------------------

export interface HasilRute {
  /** Domain utama; dapat jatah baris terbesar. */
  fokus: DomainKey
  /** Domain konteks tambahan; jatah baris kecil. Tidak pernah memuat `fokus`. */
  pendukung: DomainKey[]
  /** Jumlah kata kunci yang cocok per domain. Diekspos untuk test & penelusuran. */
  skor: Record<DomainKey, number>
}

/** Hitung kecocokan kata kunci per domain. */
function hitungSkor(baku: string): Record<DomainKey, number> {
  const skor = {} as Record<DomainKey, number>
  for (const domain of SEMUA_DOMAIN) {
    let n = 0
    for (const kk of KATA_KUNCI[domain]) {
      if (baku.includes(` ${kk} `)) n++
    }
    skor[domain] = n
  }
  return skor
}

/**
 * Tentukan domain mana yang perlu diambil untuk menjawab sebuah pertanyaan.
 *
 * Saat tidak ada kata kunci yang cocok sama sekali, hasilnya sengaja dibuat
 * PERSIS seperti perilaku asisten hari ini: agregat + transaksi + produk. Jadi
 * untuk pertanyaan yang tak terduga, terburuknya adalah tidak lebih buruk dari
 * sekarang — bukan lebih buruk.
 */
export function routeIntent(pesan: unknown): HasilRute {
  const baku = normalisasi(pesan)
  const skor = hitungSkor(baku)

  const kena = URUTAN_SERI.filter((d) => skor[d] > 0)
    .sort((a, b) => skor[b] - skor[a] || URUTAN_SERI.indexOf(a) - URUTAN_SERI.indexOf(b))

  // 'ringkasan' SENDIRIAN bukan sinyal niat.
  //
  // Sebagian kata kuncinya cuma keterangan waktu — "hari ini", "bulan ini",
  // "minggu ini" — yang menempel di hampir semua pertanyaan apa pun topiknya.
  // "budi udah masuk belum hari ini" mencocokkan 'hari ini' dan tidak
  // mencocokkan yang lain; kalau itu dihitung sebagai kecocokan, fallback tidak
  // pernah menyala dan pengguna dikirimi AGREGAT SAJA — lebih sedikit daripada
  // yang diberikan asisten hari ini (yang selalu membawa transaksi + produk).
  //
  // Jadi: kalau tidak ada domain selain 'ringkasan' yang cocok, kita sebenarnya
  // belum tahu apa-apa tentang niat pengguna. Perlakukan sebagai tidak cocok
  // sama sekali, dan pakai konteks bawaan.
  const kenaBerarti = kena.filter((d) => d !== 'ringkasan')

  if (!kenaBerarti.length) {
    return { fokus: 'ringkasan', pendukung: ['transaksi', 'produk'], skor }
  }

  const fokus = kenaBerarti[0]
  // Anotasi DomainKey[] disengaja. Tanpa itu TypeScript mempersempit tipe
  // elemennya menjadi "semua domain KECUALI ringkasan" — kesimpulan yang benar
  // dari filter di atas — lalu menolak push('ringkasan') di bawah. Penyempitan
  // itu justru bukti invariannya berlaku: saat cabang ini jalan, 'ringkasan'
  // dijamin bukan fokus, jadi ia aman ditambahkan sebagai pendukung.
  const pendukung: DomainKey[] = kenaBerarti.slice(1, 1 + MAKS_PENDUKUNG)

  // 'ringkasan' selalu ikut: laba, omzet, dan margin adalah latar dari hampir
  // setiap jawaban, termasuk saat yang ditanya cuma stok ("apakah stok menipis
  // ini yang bikin omzet turun?"). Biayanya beberapa baris agregat.
  pendukung.push('ringkasan')

  return { fokus, pendukung, skor }
}
