// ============================================================
// APAKAH ANGKA INI PUNYA DASAR DI KALIMAT PENGGUNA?
//
// Penjaga field wajib di crud-tools.ts hanya bisa melihat satu keadaan: field
// yang KOSONG. Ia bertanya bila model tidak mengisi apa-apa.
//
// Keadaan yang jauh lebih berbahaya tidak pernah terlihat olehnya: model
// MENGISI angka yang tidak pernah disebut siapa pun. "kejual kue 5 pcs" tidak
// memuat satu pun harga, tapi model menjawab Nominal Rp5.000 — dan karena
// field-nya terisi, penjaga diam, kartu ringkasan tampil meyakinkan, lalu
// pengguna menekan Simpan. Yang masuk ke pembukuan adalah angka karangan yang
// tidak pernah dikatakan, tidak pernah ditanyakan, dan tidak pernah disadari.
//
// Untuk aplikasi pembukuan, kegagalan itu lebih buruk daripada gagal mencatat
// sama sekali. Transaksi yang gagal tersimpan akan diulang penggunanya;
// transaksi dengan nominal karangan akan diam di laporan sampai tutup buku,
// lalu menjadi selisih yang tidak bisa dijelaskan.
//
// Modul ini menjawab satu pertanyaan sempit: apakah angka yang diusulkan model
// BISA DITURUNKAN dari kalimat penggunanya? Kalau tidak bisa, angka itu
// diperlakukan seperti field kosong — dan pertanyaannya diajukan, bukan
// ditebak.
//
// INI PEMERIKSAAN DETERMINISTIK, BUKAN INSTRUKSI PROMPT. Prompt sudah melarang
// mengarang angka; larangan itu tetap ada dan tetap berguna. Tapi larangan di
// prompt adalah permintaan, sedangkan ini adalah gerbang — dan untuk kolom yang
// menentukan uang orang, permintaan saja tidak cukup.
// ============================================================

/** Akhiran angka yang lazim ditulis pemilik UMKM. */
const PENGALI: Record<string, number> = {
  rb: 1_000, ribu: 1_000, k: 1_000,
  jt: 1_000_000, juta: 1_000_000,
  m: 1_000_000_000, miliar: 1_000_000_000, milyar: 1_000_000_000,
}

/**
 * Seluruh angka yang benar-benar muncul di kalimat, sudah dinormalkan.
 *
 * Format Indonesia: TITIK memisahkan ribuan, KOMA memisahkan desimal — kebalikan
 * dari konvensi Inggris. "45.000" adalah empat puluh lima ribu, bukan 45.
 * Salah membacanya di sini berarti menolak angka yang sah, lalu bertanya untuk
 * sesuatu yang sudah dijawab pengguna.
 */
export function angkaDalamTeks(teks: string): number[] {
  const out: number[] = []
  if (!teks) return out

  // \b setelah akhiran itu penting: tanpanya "5 kue" terbaca sebagai 5 × 1.000
  // karena "k" cocok dengan awalan "kue".
  const rx = /(\d[\d.,]*)\s*(rb|ribu|k|jt|juta|miliar|milyar|m)?\b/gi
  let m: RegExpExecArray | null
  while ((m = rx.exec(teks)) !== null) {
    const mentah = m[1]
    const suf = (m[2] || '').toLowerCase()

    let angka = mentah
    if (/^\d{1,3}(\.\d{3})+$/.test(mentah)) {
      angka = mentah.replace(/\./g, '')        // 45.000 -> 45000
    } else {
      angka = mentah.replace(/\.(?=\d{3}\b)/g, '')
    }
    angka = angka.replace(',', '.')            // 1,5jt -> 1.5jt

    const n = Number(angka)
    if (!Number.isFinite(n)) continue

    if (suf) {
      out.push(n * (PENGALI[suf] ?? 1))
      // Angka telanjangnya ikut dicatat: pada "5 ribu" yang dimaksud bisa saja
      // 5.000 (nominal) ATAU 5 (jumlah barang), dan keduanya sah.
      out.push(n)
    } else {
      out.push(n)
    }
  }
  return out
}

/**
 * Apakah `nilai` bisa diturunkan dari angka-angka yang ada di kalimat?
 *
 * Tiga bentuk turunan yang DIAKUI SAH, karena ketiganya benar-benar dipakai
 * pemilik warung sehari-hari:
 *
 *   sama persis   "laku 3 kue coklat total 45 ribu"  -> 45.000
 *   perkalian     "jual 5 kue @3000"                 -> 15.000
 *   penjumlahan   "beli gas 22rb sama plastik 10rb"  -> 32.000
 *
 * Yang SENGAJA tidak diakui: harga dari katalog produk. "kejual kue lotus 5
 * pcs" memang bisa dihitung dari harga jual yang tersimpan, tapi harga katalog
 * adalah harga DAFTAR — bukan harga yang benar-benar dibayar. Diskon, harga
 * teman, dan pembulatan membuat keduanya sering berbeda, dan menyamakannya
 * diam-diam menghasilkan angka yang tampak tepat justru karena tidak pernah
 * ditanyakan. Untuk kasus itu bertanya adalah jawaban yang benar.
 */
export function nilaiTerdukung(nilai: unknown, teks: string): boolean {
  const n = Number(nilai)
  if (!Number.isFinite(n)) return false

  const angka = angkaDalamTeks(teks)
  if (angka.length === 0) return false

  // Toleransi setengah rupiah menutup pembulatan, bukan perbedaan sungguhan.
  const sama = (a: number, b: number) => Math.abs(a - b) < 0.5

  if (angka.some((a) => sama(a, n))) return true

  for (let i = 0; i < angka.length; i++) {
    for (let j = 0; j < angka.length; j++) {
      if (i === j) continue
      if (sama(angka[i] * angka[j], n)) return true
    }
  }

  for (let i = 0; i < angka.length; i++) {
    for (let j = i + 1; j < angka.length; j++) {
      if (sama(angka[i] + angka[j], n)) return true
    }
  }

  return false
}
