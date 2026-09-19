// Bagian MURNI dari scripts/uji-db.mjs — penguraian keluaran psql dan penilaian
// lulus/gagal. Dipisah supaya bisa diuji vitest di setiap push.
//
// Kenapa dipisah: bagian yang memanggil psql tidak bisa diuji di mesin Windows
// (execFile tidak menjalankan .cmd tanpa shell, dan psql sendiri tidak selalu
// terpasang). Yang benar-benar punya logika justru bagian ini — ekstraksi baris
// JSON di antara tag BEGIN/ROLLBACK, penolakan nol kasus, dan penghitungan
// kegagalan. Membiarkannya tidak teruji berarti gerbang CI database bergantung
// pada kode yang tidak pernah diperiksa siapa pun.

/**
 * Mengambil baris JSON dari keluaran psql.
 *
 * psql mencetak tag perintah ("BEGIN", "ROLLBACK") dan kadang notice ke stdout.
 * Menguraikan seluruh keluaran mentah akan gagal begitu ada satu baris tambahan,
 * jadi yang dicari adalah baris pertama yang berbentuk array JSON.
 *
 * @throws {Error} bila tidak ada baris JSON, atau JSON-nya rusak.
 */
export function uraikanKeluaran(keluaran) {
  const barisJson = String(keluaran || '')
    .split('\n')
    .map((s) => s.trim())
    .find((s) => s.startsWith('['))

  if (!barisJson) {
    throw new Error('Tidak menemukan baris JSON pada keluaran psql.')
  }

  let baris
  try {
    baris = JSON.parse(barisJson)
  } catch {
    throw new Error('Baris JSON tidak bisa diurai.')
  }

  if (!Array.isArray(baris)) {
    throw new Error('Keluaran JSON bukan array kasus uji.')
  }
  return baris
}

/**
 * Menilai hasil. Nol kasus adalah KEGAGALAN, bukan kelulusan — sama seperti
 * "Test Files: no tests" di vitest yang dulu membuat gerbang unit merah selama
 * berhari-hari tanpa satu pun test pernah berjalan.
 */
export function nilaiHasil(baris) {
  if (baris.length === 0) {
    return {
      total: 0,
      gagal: 0,
      lulus: false,
      alasan: 'NOL kasus dijalankan — gerbang ini tidak menguji apa pun. '
        + 'Periksa apakah public.test_semua() masih ada di database.',
    }
  }
  const gagal = baris.filter((b) => !b.lulus)
  return {
    total: baris.length,
    gagal: gagal.length,
    lulus: gagal.length === 0,
    alasan: gagal.length ? `${gagal.length} kasus GAGAL.` : null,
  }
}

/**
 * Memeriksa dan merapikan SUPABASE_DB_URL sebelum diserahkan ke psql.
 *
 * KENAPA INI ADA — kegagalan CI 19 Sep 2026.
 * psql memperlakukan argumen pertama yang TIDAK diawali `postgresql://` sebagai
 * NAMA DATABASE, bukan connection string. Satu spasi atau baris baru yang ikut
 * terbawa saat menyalin secret sudah cukup: psql diam-diam beralih ke socket
 * Unix lokal dan gagal dengan
 *
 *   connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed
 *
 * Pesan itu tidak menyebut Supabase, tidak menyebut secret, dan mengirim
 * pembacanya berburu server Postgres yang memang tidak pernah ada di runner.
 * Memeriksanya di sini mengubah satu jam kebingungan jadi satu baris log.
 *
 * TIDAK PERNAH mencetak isi URL-nya: di dalamnya ada password database. Yang
 * dilaporkan hanya BENTUKNYA — panjang, dan apakah ada spasi terbawa.
 */
/**
 * Memutuskan apa arti "SUPABASE_DB_URL tidak ada" untuk run yang sedang jalan.
 *
 * KENAPA INI ADA — hijau palsu 19 Sep 2026.
 * Jalur "dilewati" dibuat untuk PR dari fork, yang memang tidak punya akses
 * rahasia; menggagalkan CI di sana hanya mengajari orang mengabaikan warna
 * merah. Tapi jalur yang sama juga menelan kesalahan konfigurasi di repo
 * SENDIRI: waktu secret ter-set jadi kosong, gerbang DB melewati dirinya
 * sendiri, mencetak "DILEWATI", lalu keluar dengan kode 0. Seluruh run
 * dilaporkan HIJAU tanpa satu pun kasus SQL pernah dijalankan.
 *
 * Itu kegagalan yang sama persis dengan "Test Files: no tests" milik vitest,
 * dan workflow ini sudah punya penjaga khusus untuknya di job unit. Job db
 * tidak punya — sampai sekarang.
 *
 * Aturannya: kalau run-nya PUNYA hak atas rahasia (push, atau PR dari repo
 * sendiri), rahasia yang hilang adalah KONFIGURASI RUSAK, bukan keadaan yang
 * bisa dimaklumi. Merah.
 */
export function putuskanTanpaUrl(wajib) {
  // Datang dari ekspresi YAML, jadi bentuknya string 'true'/'false' — bukan
  // boolean. `Boolean('false')` bernilai true, dan kekeliruan itu akan
  // mengembalikan lubangnya persis seperti semula.
  const harus = wajib === true || String(wajib).toLowerCase() === 'true'
  if (!harus) {
    return {
      kode: 0,
      pesan: 'SUPABASE_DB_URL tidak diset — pengujian database DILEWATI. '
        + 'Ini bukan kelulusan; run ini memang tidak berhak atas rahasia (PR dari fork).',
    }
  }
  return {
    kode: 1,
    pesan: 'SUPABASE_DB_URL KOSONG padahal run ini berhak atas rahasia repo. '
      + 'Gerbang database tidak menguji apa pun, jadi ia MERAH — bukan dilewati. '
      + 'Periksa secret SUPABASE_DB_URL: nilai kosong bisa terjadi bila tempelan '
      + 'ke prompt `gh secret set` tidak terbaca.',
  }
}

export function normalisasiUrlDb(mentah) {
  const asli = String(mentah ?? '')
  const url = asli.trim()

  if (!url) return { ada: false }

  if (!/^postgres(ql)?:\/\//i.test(url)) {
    return {
      ada: true,
      sah: false,
      alasan:
        'SUPABASE_DB_URL tidak diawali "postgresql://" atau "postgres://". '
        + `Panjang nilainya ${url.length} karakter. `
        + 'psql akan menganggapnya NAMA DATABASE dan mencoba socket lokal — '
        + 'itulah asal pesan "/var/run/postgresql/.s.PGSQL.5432". '
        + 'Salin ulang dari Supabase Dashboard > Connect > Session pooler.',
    }
  }

  let port = null
  try {
    port = new URL(url).port
  } catch {
    return {
      ada: true,
      sah: false,
      alasan: 'SUPABASE_DB_URL berawalan benar tapi bukan URL yang bisa diurai.',
    }
  }

  return {
    ada: true,
    sah: true,
    url,
    dirapikan: url !== asli,
    // Port 6543 = transaction pooler. uji-db.mjs memakai BEGIN ... ROLLBACK
    // eksplisit, dan di mode transaksi tiap pernyataan bisa mendarat di koneksi
    // backend yang berbeda — ROLLBACK-nya lalu membatalkan transaksi yang salah,
    // atau tidak ada transaksi sama sekali. Hasil ujinya jadi tidak bisa
    // dipercaya justru pada bagian yang menjaga agar data uji tidak ter-commit.
    peringatan:
      port === '6543'
        ? 'SUPABASE_DB_URL memakai port 6543 (transaction pooler). Gerbang ini '
          + 'butuh Session pooler (5432) karena memakai BEGIN/ROLLBACK eksplisit.'
        : null,
  }
}

/** Satu baris ringkas per kasus, untuk log CI. */
export function formatBaris(b) {
  return `${b.lulus ? '  ok  ' : '  GAGAL'} [${b.suite}] ${b.kasus} -> ${b.hasil}`
}
