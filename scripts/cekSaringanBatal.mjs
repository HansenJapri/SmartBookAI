// Penjaga: tidak ada pembacaan tabel `transactions` yang lolos tanpa
// memutuskan apa yang dilakukan terhadap baris BATAL.
//
// KENAPA PENJAGA, BUKAN SEKADAR MENYARING SEKALI
// Menyaring di ~10 tempat yang ada sekarang menyelesaikan hari ini dan tidak
// menyelesaikan apa pun setelahnya. Pembacaan ke-11 akan ditulis bulan depan
// oleh orang yang tidak pernah membaca keputusan ini, tidak akan menyaring
// status, dan akan menghitung nota batal sebagai pendapatan nyata — tanpa
// error, tanpa test merah, tanpa satu pun tanda. Selisihnya baru ketahuan saat
// ada yang mencocokkan laporan dengan uang di tangan, dan pada titik itu tidak
// ada yang tahu sejak kapan angkanya salah.
//
// Repo ini sudah dua kali kehilangan penjaga karena bersandar pada ingatan.
// Ini yang ketiga, dan ia tidak bersandar pada ingatan.
//
// ATURANNYA
//   supabase/functions/**  : DILARANG menyentuh from('transactions') langsung.
//                            Harus lewat scopedSelect(), yang menyaring di satu
//                            tempat untuk seluruh lapisan AI.
//   src/**                 : hanya boleh di src/lib/api.js, dan setiap
//                            pembacaan di sana wajib menyebut `status` —
//                            entah menyaringnya, entah sengaja mengikutkan
//                            baris batal lewat `termasukBatal`.
//
// Yang TIDAK diperiksa: INSERT. Menambah transaksi baru tidak pernah
// berurusan dengan status (default-nya 'aktif' di database), dan memaksa
// penulis INSERT menyebut status hanya akan melahirkan `status: 'aktif'`
// hafalan yang disalin tanpa dipikir.

const POLA_AKSES = /\.from\(\s*['"`]transactions['"`]\s*\)/g

/** Baris tempat `from('transactions')` muncul, 1-indeks. */
function barisAkses(isi) {
  const hasil = []
  const baris = String(isi).split('\n')
  baris.forEach((t, i) => {
    POLA_AKSES.lastIndex = 0
    if (POLA_AKSES.test(t)) hasil.push(i + 1)
  })
  return hasil
}

/**
 * Apakah pembacaan di sekitar baris ini sudah memutuskan soal status?
 *
 * Jendela beberapa baris ke bawah, karena query Supabase dirangkai
 * berantai lintas baris:
 *
 *   wsSelect(owner, 'transactions')
 *     .eq('status', 'aktif')
 *     .order(...)
 */
function memutuskanStatus(baris, mulai, jendela = 8) {
  const potongan = baris.slice(Math.max(0, mulai - 1), mulai - 1 + jendela).join('\n')
  return /status/.test(potongan) || /termasukBatal/.test(potongan)
}

/** Penambahan baris, bukan pembacaan — `.insert(` dalam rantai yang sama. */
function adalahInsert(baris, mulai, jendela = 4) {
  const potongan = baris.slice(Math.max(0, mulai - 1), mulai - 1 + jendela).join('\n')
  return /\.insert\s*\(/.test(potongan)
}

/**
 * @param {{path: string, isi: string}[]} berkas
 * @returns {{path: string, baris: number, alasan: string}[]} pelanggaran
 */
export function periksaSaringanBatal(berkas) {
  const pelanggaran = []

  for (const { path, isi } of berkas) {
    const jalur = String(path).replace(/\\/g, '/')

    // Berkas penjaga ini sendiri, dan testnya, memuat pola itu sebagai teks.
    if (jalur.includes('cekSaringanBatal')) continue
    // Berkas palsu untuk test Edge Function memang mensimulasikan tabelnya.
    if (jalur.includes('uji-supabase-palsu')) continue

    const semuaBaris = String(isi).split('\n')

    for (const n of barisAkses(isi)) {
      // INSERT dilewati. Menambah transaksi tidak pernah berurusan dengan
      // status — default-nya 'aktif' di database — dan memaksa penulisnya
      // menyebut status hanya melahirkan `status: 'aktif'` hafalan yang
      // disalin tanpa dipikir, lalu suatu hari disalin ke tempat yang salah.
      if (adalahInsert(semuaBaris, n)) continue

      if (jalur.startsWith('src/') && !jalur.endsWith('src/lib/api.js')) {
        pelanggaran.push({
          path: jalur,
          baris: n,
          alasan: 'Tabel transactions hanya boleh diakses lewat src/lib/api.js, '
            + 'supaya keputusan soal baris batal terkumpul di satu berkas.',
        })
        continue
      }

      if (!memutuskanStatus(semuaBaris, n)) {
        pelanggaran.push({
          path: jalur,
          baris: n,
          alasan: 'Pembacaan transactions tidak menyebut `status`. Saring '
            + "`.eq('status','aktif')`, atau sebutkan `termasukBatal` bila baris "
            + 'batal memang sengaja diikutkan.'
            + (jalur.includes('supabase/functions/')
              ? ' Di Edge Function, jalur yang disarankan adalah scopedSelect(),'
                + ' yang menyaringnya untuk seluruh lapisan AI sekaligus.'
              : ''),
        })
      }
    }
  }

  return pelanggaran
}

/** Laporan siap cetak untuk log CI. */
export function laporanSaringanBatal(pelanggaran) {
  if (!pelanggaran.length) return 'Bersih: setiap pembacaan transactions sudah memutuskan soal baris batal.'
  return pelanggaran
    .map((p) => `${p.path}:${p.baris} — ${p.alasan}`)
    .join('\n')
}
