// ============================================================
// deno test — router niat RAG.
//
// Tiga hal yang dijaga berkas ini, berurut kepentingannya:
//   1. Kalimat NYATA pemilik UMKM sampai ke domain yang benar — termasuk
//      bentuk berklitik ("stoknya", "gajinya") yang justru paling sering
//      diucapkan.
//   2. Fallback tidak pernah lebih buruk dari perilaku asisten hari ini.
//   3. Normalisasi tidak merusak kata biasa (punya -> pu, buku -> bu).
// ============================================================
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  type DomainKey,
  KATA_KUNCI,
  MAKS_PENDUKUNG,
  normalisasi,
  routeIntent,
  SEMUA_DOMAIN,
} from './intent-router.ts'

// ---------- Kasus pelapor ----------

Deno.test('KASUS PELAPOR: "listkan semua produk saya dan sisa stoknya" -> fokus produk', () => {
  // Pertanyaan persis yang dijawab "Data itu belum tercatat di aplikasi".
  // Perhatikan "stoknya" — berklitik. Ini alasan normalisasi ada.
  assertEquals(routeIntent('listkan semua produk saya dan sisa stoknya').fokus, 'produk')
})

Deno.test('KASUS PELAPOR: "sisa stok produk saya" -> fokus produk', () => {
  assertEquals(routeIntent('sisa stok produk saya').fokus, 'produk')
})

// ---------- Klitik ----------

Deno.test('bentuk berklitik dirutekan sama dengan bentuk dasarnya', () => {
  const pasangan: [string, string][] = [
    ['berapa sisa stok', 'berapa sisa stoknya'],
    ['berapa gaji budi', 'berapa gajinya budi'],
    ['daftar karyawan', 'daftar karyawannya'],
    ['status tugas', 'status tugasnya'],
    ['berapa harga bahan', 'berapa harga bahannya'],
  ]
  for (const [dasar, berklitik] of pasangan) {
    assertEquals(
      routeIntent(berklitik).fokus,
      routeIntent(dasar).fokus,
      `"${berklitik}" tidak dirutekan sama dengan "${dasar}"`,
    )
  }
})

Deno.test('normalisasi tidak merusak kata biasa yang berakhiran mirip klitik', () => {
  // Syarat "sisa kata >= 3 huruf" yang menjaga ini. Tanpa syarat itu,
  // normalisasi merusak lebih banyak daripada yang diperbaikinya.
  for (const kata of ['punya', 'buku', 'kamu', 'ilmu', 'hanya', 'ampun', 'salah']) {
    assert(
      normalisasi(kata).includes(` ${kata} `),
      `kata biasa "${kata}" ikut dikupas jadi "${normalisasi(kata).trim()}"`,
    )
  }
})

// ---------- Tiap domain punya pemicu ----------

Deno.test('setiap domain bisa dicapai dari kalimat wajar', () => {
  const contoh: Record<DomainKey, string[]> = {
    produk: [
      'berapa sisa stok indomie',
      'produk apa saja yang menipis',
      'buatkan po ke pemasok',
    ],
    hr: [
      'siapa yang absen hari ini',
      'berapa total gaji bulan ini',
      'skor kpi karyawan periode lalu',
    ],
    operasional: [
      'tugas apa yang masih antre',
      'ada pengingat apa hari ini',
      'papan tugas siapa yang kosong',
    ],
    transaksi: [
      'siapa yang masih punya piutang',
      'transaksi belum lunas ada berapa',
      'tagih pelanggan yang jatuh tempo',
    ],
    analisis: [
      'harga bahan pokok naik tidak',
      'berapa kurs dolar sekarang',
      'radar harga provinsi saya',
    ],
    lainnya: [
      'siapa yang mengubah data kemarin',
      'lihat audit log',
      'siapa saja pengguna dengan hak akses',
    ],
    ringkasan: [
      'berapa laba bersih bulan ini',
      'gimana margin usaha saya',
      'omzet minggu ini berapa',
    ],
  }

  for (const domain of SEMUA_DOMAIN) {
    for (const kalimat of contoh[domain]) {
      assertEquals(
        routeIntent(kalimat).fokus, domain,
        `"${kalimat}" seharusnya fokus ${domain}, dapat ${routeIntent(kalimat).fokus} (skor: ${
          JSON.stringify(routeIntent(kalimat).skor)
        })`,
      )
    }
  }
})

// ---------- Fallback ----------

Deno.test('tanpa kata kunci, fallback persis seperti perilaku asisten hari ini', () => {
  // Agregat + transaksi + produk = konteks yang dikirim BukuPencatatan
  // sebelum RAG. Untuk pertanyaan tak terduga, terburuknya tidak lebih buruk.
  const r = routeIntent('halo, apa kabar')
  assertEquals(r.fokus, 'ringkasan')
  assertEquals(r.pendukung, ['transaksi', 'produk'])
})

Deno.test('REGRESI: keterangan waktu saja tidak boleh mempersempit konteks', () => {
  // Ditemukan saat menguji kalimat nyata. "bulan ini rugi ga sih" mencocokkan
  // kata kunci ringkasan ('bulan ini', 'rugi') dan TIDAK mencocokkan yang lain.
  // Versi pertama router menganggap itu kecocokan yang sah, jadi fallback tidak
  // menyala dan pendukungnya KOSONG — pengguna dikirimi agregat saja, LEBIH
  // SEDIKIT daripada yang diberikan asisten sebelum RAG ada.
  //
  // Batas bawahnya: konteks tidak boleh pernah lebih sempit dari perilaku
  // hari ini.
  const kalimat = [
    'bulan ini rugi ga sih',
    'budi udah masuk belum hari ini',
    'gimana performa usaha saya',
    'berapa laba bersih bulan ini',
  ]
  for (const k of kalimat) {
    const r = routeIntent(k)
    const semua = [r.fokus, ...r.pendukung]
    assert(semua.includes('ringkasan'), `"${k}": ringkasan hilang`)
    assert(semua.includes('transaksi'), `"${k}": transaksi hilang — konteks menyempit`)
    assert(semua.includes('produk'), `"${k}": produk hilang — konteks menyempit`)
  }
})

Deno.test('REGRESI: setiap pertanyaan selalu membawa minimal satu domain data', () => {
  // Invarian menyeluruh: apa pun kalimatnya, tidak boleh ada hasil yang cuma
  // berisi 'ringkasan' tanpa satu pun domain berisi baris data.
  const kalimat = [
    '', 'halo', 'terima kasih', 'bulan ini', 'hari ini gimana',
    'sisa stoknya berapa', 'siapa yang absen', 'apa kabar usaha saya',
  ]
  for (const k of kalimat) {
    const semua = [routeIntent(k).fokus, ...routeIntent(k).pendukung]
    assert(
      semua.some((d) => d !== 'ringkasan'),
      `"${k}": tidak ada domain data sama sekali, hanya agregat`,
    )
  }
})

Deno.test('pesan kosong tidak melempar dan tetap memberi fallback', () => {
  for (const kosong of ['', '   ', null, undefined, 123, {}]) {
    const r = routeIntent(kosong)
    assertEquals(r.fokus, 'ringkasan', `input ${JSON.stringify(kosong)} tidak jatuh ke fallback`)
  }
})

// ---------- Pencocokan kata utuh ----------

Deno.test('kata kunci pendek tidak tercocok di dalam kata lain', () => {
  // "po" ada di dalam "toko" dan "pohon". Kalau pencocokannya substring bebas,
  // pertanyaan soal toko tiba-tiba menarik seluruh data purchase order — dan
  // itu tidak kelihatan sampai ada pengguna yang mengeluh.
  assertEquals(routeIntent('toko saya buka jam berapa').skor.produk, 0)
  // Sebaliknya, "po" sebagai kata utuh HARUS tercocok.
  assert(routeIntent('buat po baru').skor.produk > 0, '"po" sebagai kata utuh tidak tercocok')
})

Deno.test('tanda baca tidak menghalangi pencocokan', () => {
  assertEquals(routeIntent('stok? produk!').fokus, 'produk')
  assertEquals(routeIntent('STOK PRODUK').fokus, 'produk')
})

// ---------- Skor & pendukung ----------

Deno.test('domain dengan kecocokan terbanyak jadi fokus', () => {
  // Menyebut dua kata kunci produk dan satu kata kunci hr.
  const r = routeIntent('sisa stok produk dan gaji')
  assertEquals(r.fokus, 'produk')
  assert(r.pendukung.includes('hr'), `hr tidak jadi pendukung: ${r.pendukung.join(', ')}`)
})

Deno.test('ringkasan selalu ikut sebagai pendukung', () => {
  for (const kalimat of ['sisa stok produk', 'siapa yang absen', 'lihat audit log']) {
    const r = routeIntent(kalimat)
    assert(
      r.pendukung.includes('ringkasan'),
      `"${kalimat}" tidak membawa ringkasan: ${r.pendukung.join(', ')}`,
    )
  }
})

Deno.test('fokus tidak pernah ikut muncul di pendukung', () => {
  // Kalau bocor, domain itu di-query dua kali dengan dua jatah baris berbeda.
  for (const kalimat of ['laba bulan ini', 'sisa stok', 'gaji karyawan dan stok dan tugas']) {
    const r = routeIntent(kalimat)
    assert(!r.pendukung.includes(r.fokus), `"${kalimat}": fokus ${r.fokus} bocor ke pendukung`)
  }
})

Deno.test('jumlah domain pendukung dibatasi', () => {
  // Pertanyaan yang menyentuh semua domain sekaligus tidak boleh menarik
  // seluruh database ke dalam satu prompt.
  const r = routeIntent('gimana laba, stok, karyawan, tugas, piutang, dan harga bahan saya')
  const selainRingkasan = r.pendukung.filter((d) => d !== 'ringkasan')
  assert(
    selainRingkasan.length <= MAKS_PENDUKUNG,
    `pendukung ${selainRingkasan.length} melebihi batas ${MAKS_PENDUKUNG}: ${r.pendukung.join(', ')}`,
  )
})

Deno.test('urutan tie-break stabil, tidak bergantung urutan iterasi objek', () => {
  // Dua domain berskor sama harus selalu menghasilkan fokus yang sama,
  // berapa kali pun dipanggil dan bagaimanapun kalimatnya disusun ulang.
  const a = routeIntent('stok dan gaji')
  const b = routeIntent('gaji dan stok')
  assertEquals(a.fokus, b.fokus)
  assertEquals(routeIntent('stok dan gaji').fokus, a.fokus)
})

// ---------- Invarian daftar kata kunci ----------

Deno.test('INVARIAN: setiap kata kunci sudah dalam bentuk baku', () => {
  // Kata kunci yang ditulis "Stok", "stok," atau "stoknya" TIDAK AKAN PERNAH
  // cocok, karena pesan sudah dinormalisasi lebih dulu. Kegagalannya senyap:
  // domainnya sekadar tidak pernah terpilih. Test ini yang membuatnya berisik.
  let diperiksa = 0
  for (const domain of SEMUA_DOMAIN) {
    for (const kk of KATA_KUNCI[domain]) {
      assertEquals(
        normalisasi(kk).trim(), kk,
        `kata kunci "${kk}" di domain ${domain} bukan bentuk baku`,
      )
      diperiksa++
    }
  }
  // Penjaga anti-hijau-semu: kalau daftarnya kosong atau gagal terimpor, loop
  // di atas tidak pernah jalan dan test ini lulus tanpa memeriksa apa pun.
  assert(diperiksa > 100, `hanya ${diperiksa} kata kunci diperiksa — daftar tidak terbaca?`)
})

Deno.test('INVARIAN: setiap domain punya kata kunci', () => {
  // Domain tanpa kata kunci tidak akan pernah terpilih jadi fokus, dan
  // datanya tidak pernah sampai ke asisten — persis bug yang sedang diperbaiki.
  for (const domain of SEMUA_DOMAIN) {
    assert(KATA_KUNCI[domain]?.length > 0, `domain ${domain} tidak punya kata kunci`)
  }
})

Deno.test('INVARIAN: tidak ada kata kunci ganda di dalam satu domain', () => {
  // Duplikat membuat satu kecocokan dihitung dua kali, diam-diam menaikkan
  // skor domain itu di atas yang lain.
  for (const domain of SEMUA_DOMAIN) {
    const daftar = KATA_KUNCI[domain]
    const unik = new Set(daftar)
    assertEquals(
      unik.size, daftar.length,
      `domain ${domain} punya kata kunci ganda: ${daftar.filter((k, i) => daftar.indexOf(k) !== i).join(', ')}`,
    )
  }
})
