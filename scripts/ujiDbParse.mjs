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

/** Satu baris ringkas per kasus, untuk log CI. */
export function formatBaris(b) {
  return `${b.lulus ? '  ok  ' : '  GAGAL'} [${b.suite}] ${b.kasus} -> ${b.hasil}`
}
