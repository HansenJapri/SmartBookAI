// Penjaga: supabase/schema.sql tidak boleh tertinggal di belakang
// berkas migrasi yang sudah dikomit.
//
// KENAPA PENJAGA INI ADA
// Gerbang DB sekarang membangun skema dari supabase/schema.sql di Postgres
// sekali pakai. Itu menghapus kredensial produksi dari CI — tapi menukarnya
// dengan risiko baru: schema.sql adalah SALINAN. Kalau seseorang menulis
// migrasi baru, menerapkannya ke produksi, lalu lupa memperbarui dump-nya, CI
// akan tetap hijau sambil menguji skema yang sudah basi. Hijau yang tidak
// berarti apa-apa adalah keadaan yang paling berbahaya dari ketiga warna.
//
// CARA KERJANYA
// Mengambil nama objek yang DIBUAT berkas migrasi (tabel, fungsi, kolom), lalu
// memastikan nama itu benar-benar muncul di schema.sql. Ini pemeriksaan
// tekstual, bukan pembandingan skema penuh — ia tidak menangkap perubahan
// badan fungsi, dan memang tidak berpura-pura bisa. Yang ditangkapnya adalah
// kelalaian yang paling sering terjadi dan paling mahal: objek baru yang tidak
// pernah sampai ke dump.

const POLA = [
  // create [or replace] function public.nama(
  /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi,
  // create table [if not exists] public.nama (
  /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi,
]

// Kolom yang ditambahkan ke tabel yang sudah ada. Objeknya tidak baru, jadi
// namanya saja tidak cukup — nama kolomnya yang harus muncul di dump.
const POLA_KOLOM =
  /add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi

/** Nama objek dan kolom yang dibuat sebuah berkas migrasi. */
export function objekMigrasi(isi) {
  const teks = buangKomentar(String(isi))
  const objek = new Set()
  for (const pola of POLA) {
    pola.lastIndex = 0
    let m
    while ((m = pola.exec(teks)) !== null) objek.add(m[1].toLowerCase())
  }
  const kolom = new Set()
  POLA_KOLOM.lastIndex = 0
  let m
  while ((m = POLA_KOLOM.exec(teks)) !== null) kolom.add(m[1].toLowerCase())
  return { objek: [...objek], kolom: [...kolom] }
}

/**
 * Komentar SQL dibuang lebih dulu.
 *
 * Repo ini memuat berkas "migrasi" yang isinya MURNI komentar — catatan yang
 * menjelaskan fungsi yang dipasang di tempat lain. Tanpa langkah ini, kalimat
 * seperti "create function public.test_bom() dulu ada di project lama" akan
 * dibaca sebagai objek yang wajib ada, dan penjaganya menuduh dump yang
 * sebenarnya benar.
 */
function buangKomentar(teks) {
  return teks
    .split('\n')
    .map((b) => b.replace(/--.*$/, ''))
    .join('\n')
}

/**
 * @param {{path: string, isi: string}[]} migrasi
 * @param {string} dump isi supabase/schema.sql
 * @returns {{path: string, hilang: string[]}[]}
 */
/**
 * Migrasi yang memang BELUM diterapkan ke produksi.
 *
 * Ini masalah yang BERBEDA dari yang dijaga berkas ini. Penjaga ini menanyakan
 * "apakah dump-nya segar?"; migrasi yang tidak pernah dijalankan menanyakan
 * "kenapa ini tidak pernah dijalankan?". Menggabungkan keduanya akan membuat
 * utang lama memblokir setiap perubahan yang tidak ada hubungannya, dan itu
 * cara tercepat mengajari orang mengabaikan warna merah.
 *
 * Memasukkan nama ke sini adalah tindakan SENGAJA dan wajib menyebut alasannya.
 * Daftar yang tumbuh adalah utang yang terlihat — jauh lebih baik daripada
 * utang yang tidak terlihat.
 */
export const BELUM_DITERAPKAN = {
  'supabase/migration_heartbeat_dan_provenance_ai.sql':
    'pangkas_heartbeat() dan panggil_keepalive() tidak ada di project '
    + 'vbzmtnpmtgrhovmwjqqk (diperiksa 19 Sep 2026). Migrasinya tampaknya hanya '
    + 'pernah diterapkan ke project lama yang sudah dihapus. Utang terbuka: '
    + 'putuskan apakah keepalive-nya masih dibutuhkan, lalu terapkan dan '
    + 'perbarui dump — atau hapus berkasnya.',
}

/**
 * @param {{path: string, isi: string}[]} migrasi
 * @param {string} dump isi supabase/schema.sql
 * @returns {{kurang: {path: string, hilang: string[]}[], dikecualikan: string[]}}
 */
export function periksaSkemaTerkini(migrasi, dump) {
  const teksDump = String(dump).toLowerCase()
  const kurang = []
  const dikecualikan = []

  for (const { path, isi } of migrasi) {
    const jalur = String(path).replace(/\\/g, '/')
    const { objek, kolom } = objekMigrasi(isi)
    const hilang = [...objek, ...kolom].filter((n) => !teksDump.includes(n))
    if (!hilang.length) continue
    if (BELUM_DITERAPKAN[jalur]) {
      dikecualikan.push(jalur)
      continue
    }
    kurang.push({ path: jalur, hilang })
  }
  return { kurang, dikecualikan }
}

/** Laporan siap cetak untuk log CI. */
export function laporanSkemaTerkini(kurang, dikecualikan = []) {
  // Pengecualian SELALU disebut, juga saat hasilnya bersih. Utang yang tidak
  // pernah terbaca di log adalah utang yang perlahan berubah jadi keadaan
  // normal.
  const catatan = dikecualikan.length
    ? ['', `Dikecualikan (belum diterapkan ke produksi): ${dikecualikan.join(', ')}`,
       'Lihat BELUM_DITERAPKAN di scripts/cekSkemaTerkini.mjs untuk alasannya.'].join('\n')
    : ''

  if (!kurang.length) {
    return 'Bersih: setiap objek migrasi sudah ada di supabase/schema.sql.' + catatan
  }
  return [
    'supabase/schema.sql TERTINGGAL di belakang berkas migrasi berikut.',
    'Gerbang DB membangun skemanya dari dump itu, jadi objek yang hilang di sana',
    'TIDAK PERNAH diuji — dan gerbangnya tetap hijau.',
    '',
    ...kurang.map((k) => `  ${k.path}\n    belum ada di dump: ${k.hilang.join(', ')}`),
    '',
    'Perbarui dengan:',
    '  npx supabase db dump --db-url "<url>" --schema public --schema auth -f supabase/schema.sql',
  ].join('\n') + catatan
}
