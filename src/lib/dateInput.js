// Pembatas input tanggal.
//
// Masalah nyata yang ditutup di sini: <input type="date"> bawaan browser memang
// memecah isian jadi tiga ruas (hari, bulan, tahun) dan sudah membatasi ruas
// hari & bulan ke dua digit — tapi ruas TAHUN menerima sampai enam digit.
// Mengetik "20266" menghasilkan tanggal tahun 20266, yang lolos ke database
// sebagai timestamp sah lalu merusak semua pengurutan, rekap bulanan, dan
// perhitungan umur piutang tanpa pesan galat apa pun.
//
// Karena itu pembatasan dilakukan di dua lapis:
//   1. atribut min/max  -> ruas tahun di pemilih tanggal ikut dibatasi,
//                          dan form yang divalidasi browser menolak isian di luar rentang;
//   2. bersihkanTanggal -> jaring pengaman di jalur onChange, untuk kasus
//                          pengguna mengetik manual (dan untuk tempel/paste).

export const TAHUN_MIN = 1900
export const TAHUN_MAX = 2100

// Disebar ke elemen input: <input type="date" {...BATAS_DATE} ... />
export const BATAS_DATE = { min: `${TAHUN_MIN}-01-01`, max: `${TAHUN_MAX}-12-31` }
export const BATAS_DATETIME = { min: `${TAHUN_MIN}-01-01T00:00`, max: `${TAHUN_MAX}-12-31T23:59` }
export const BATAS_MONTH = { min: `${TAHUN_MIN}-01`, max: `${TAHUN_MAX}-12` }

// Membersihkan nilai dari <input type="date|datetime-local|month">.
//
// Nilai input tanggal HTML selalu berpola "YYYY-MM-DD[THH:mm]" atau "YYYY-MM".
// Yang dilakukan:
//   - tahun lebih dari 4 digit dipotong ke 4 digit pertama;
//   - tahun di luar 1900..2100 dijepit ke batas terdekat;
//   - hari & bulan dijepit ke dua digit (jaga-jaga bila nilai datang dari paste);
//   - nilai kosong tetap kosong — mengosongkan tanggal itu aksi yang sah.
export function bersihkanTanggal(nilai) {
  if (!nilai) return ''
  const s = String(nilai)

  // Pisahkan bagian tanggal dari bagian jam (kalau ada).
  const pisah = s.indexOf('T')
  const bagianTanggal = pisah === -1 ? s : s.slice(0, pisah)
  const bagianJam = pisah === -1 ? '' : s.slice(pisah)

  const ruas = bagianTanggal.split('-')
  if (!ruas[0]) return ''

  // Tahun: ambil digit saja, potong di 4 digit.
  const digitTahun = ruas[0].replace(/\D/g, '').slice(0, 4)
  if (!digitTahun) return ''
  let tahun = Number(digitTahun)

  // Batas ATAS dijepit; batas BAWAH SENGAJA TIDAK.
  //
  // Menjepit ke bawah di jalur onChange mematahkan pengetikan manual, dan itu
  // bukan teori: dilaporkan 9 September 2026. <input type="date"> selalu
  // mengirim tahun ter-pad empat digit, jadi menekan "2" sebagai digit pertama
  // menghasilkan nilai "0002-09-09". Penjepit lama membacanya sebagai tahun 2,
  // mengubahnya jadi 1900, dan menuliskannya kembali ke input — ketikan
  // terputus di digit pertama dan tahun tidak akan pernah bisa diselesaikan.
  //
  // Setiap tahun yang diketik manusia melewati keadaan "terlalu kecil" dalam
  // perjalanannya: 0002 -> 0020 -> 0202 -> 2026. Penjepit bawah menghukum
  // ketiga langkah pertama demi mencegah keadaan yang tidak pernah benar-benar
  // menjadi tujuan siapa pun.
  //
  // Yang tetap menahan tahun tak masuk akal sampai ke database:
  //   - pemotongan 4 digit di atas (kasus asal mula penjaga ini: "20266");
  //   - atribut min/max pada input, yang membuat form ditolak validasi browser;
  //   - finalkanTanggal() di bawah, untuk jalur simpan yang ingin menjepit sendiri.
  if (tahun > TAHUN_MAX) tahun = TAHUN_MAX
  const keluar = [String(tahun).padStart(4, '0')]

  if (ruas.length > 1) {
    const bulan = Math.min(12, Math.max(1, Number(ruas[1].replace(/\D/g, '').slice(0, 2)) || 1))
    keluar.push(String(bulan).padStart(2, '0'))
  }
  if (ruas.length > 2) {
    const hari = Math.min(31, Math.max(1, Number(ruas[2].replace(/\D/g, '').slice(0, 2)) || 1))
    keluar.push(String(hari).padStart(2, '0'))
  }

  return keluar.join('-') + bagianJam
}

/**
 * Versi TEGAS untuk jalur simpan / onBlur: menjepit tahun ke 1900..2100.
 *
 * Dipisah dari bersihkanTanggal() dengan sengaja. Yang satu dipanggil pada
 * SETIAP ketukan tombol dan karenanya harus membiarkan keadaan setengah jadi;
 * yang ini dipanggil ketika pengguna sudah selesai, dan di titik itu menjepit
 * tidak lagi mengganggu siapa pun.
 */
export function finalkanTanggal(nilai) {
  const bersih = bersihkanTanggal(nilai)
  if (!bersih) return ''
  const pisah = bersih.indexOf('T')
  const tanggal = pisah === -1 ? bersih : bersih.slice(0, pisah)
  const jam = pisah === -1 ? '' : bersih.slice(pisah)
  const ruas = tanggal.split('-')
  let tahun = Number(ruas[0])
  if (!Number.isFinite(tahun)) return ''
  if (tahun < TAHUN_MIN) tahun = TAHUN_MIN
  if (tahun > TAHUN_MAX) tahun = TAHUN_MAX
  ruas[0] = String(tahun).padStart(4, '0')
  return ruas.join('-') + jam
}
