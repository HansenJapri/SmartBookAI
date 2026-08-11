import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ============================================================
// Penjaga invarian PRIVASI BARIS di sisi KLIEN — pasangan dari
// public.rls_lint() di sisi database.
//
// Latar belakang nyata: policy "feedback read all (login)" memakai USING (true)
// pada tabel yang punya kolom user_id, sehingga SETIAP pengguna yang login bisa
// membaca feedback pengguna lain lewat PostgREST — termasuk isi pesan yang
// sering memuat nama usaha, angka omzet, dan keluhan operasional.
//
// Ia lolos lama sekali karena tidak ada yang memeriksanya: antarmuka memang
// hanya menampilkan milik sendiri, dan tak satu pun test membuka endpoint-nya
// langsung. Perbaikan satu policy hanya bertahan selama semua orang ingat
// aturannya, jadi aturannya dijadikan mesin — di dua sisi:
//
//   sisi database : public.rls_lint()  (lihat supabase/migration_rls_lint.sql)
//   sisi klien    : berkas ini
//
// Kenapa perlu DUA sisi. rls_lint() lebih kuat karena menjaga sumber
// kebenarannya, tapi CI tidak punya akses ke database produksi. Penjaga di sini
// berjalan di setiap push dan menangkap kelas kesalahan yang paling sering:
// query baru yang lupa memfilter pemilik baris.
//
// CATATAN: `feedback` sengaja TIDAK ada di tenancy.guard.test.js. Berkas itu
// menjaga isolasi antar-WORKSPACE (owner + stafnya berbagi data), sedangkan
// feedback bersifat pribadi per-PENGGUNA — staf pun tidak boleh membaca
// feedback milik ownernya. Dua invarian berbeda, dua penjaga berbeda.
// ============================================================

const API = readFileSync(join(process.cwd(), 'src', 'lib', 'api.js'), 'utf8')

// Tabel yang barisnya milik SATU PENGGUNA, bukan satu workspace.
// Setiap query ke sini wajib menyaring pemiliknya secara eksplisit di klien,
// terlepas dari RLS — pertahanan berlapis, dan membuat maksudnya terbaca
// dari kode tanpa harus membuka dashboard database.
const TABEL_PRIBADI = ['feedback']

// Mengambil potongan kode SATU rantai query, mulai dari .from('<tabel>') sampai
// rantainya berhenti.
//
// Batasnya ditentukan bentuk rantai, bukan jumlah karakter. Versi pertama
// mengambil 500 karakter dari titik .from(), dan itu merembes ke fungsi
// berikutnya: begitu ada .insert( di sana, pemeriksaan mengambil cabang yang
// salah dan menuduh query yang sebenarnya sudah benar. Kegagalan palsu pada
// penjaga keamanan lebih berbahaya daripada tidak punya penjaga — ia mengajari
// orang mengabaikan warna merahnya.
//
// Pemindaian sadar kedalaman kurung. Aturan "berhenti di baris yang tidak
// diawali titik" saja tidak cukup: argumen .insert({ ... }) menyeberang beberapa
// baris yang isinya `user_id: user.id,` — justru bagian yang harus terbaca.
//
// Jadi rantainya berakhir pada pergantian baris yang terjadi di kedalaman NOL
// dan tidak disambung baris berikutnya dengan titik.
function rantaiQuery(kode, tabel) {
  const out = []
  const re = new RegExp(`\\.from\\(\\s*['"\`]${tabel}['"\`]\\s*\\)`, 'g')
  let m
  while ((m = re.exec(kode)) !== null) {
    let depth = 0
    let quote = null
    let i = m.index
    for (; i < kode.length; i++) {
      const c = kode[i]
      if (quote) {
        if (c === '\\') { i++; continue }
        if (c === quote) quote = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue }
      if (c === '(' || c === '[' || c === '{') { depth++; continue }
      if (c === ')' || c === ']' || c === '}') { depth--; continue }
      if (c === '\n' && depth <= 0) {
        const lanjut = kode.slice(i + 1).match(/^\s*\./)
        if (!lanjut) break
      }
    }
    out.push({
      baris: kode.slice(0, m.index).split('\n').length,
      kode: kode.slice(m.index, i),
    })
    re.lastIndex = Math.max(re.lastIndex, i)
  }
  return out
}

// INSERT dan operasi lain punya cara berbeda menyatakan kepemilikan, dan
// menyamakan keduanya menghasilkan tuduhan palsu: addFeedback() menulis
// `user_id: user.id` di dalam payload, bukan lewat .eq(). Versi pertama
// penjaga ini menandai baris itu sebagai pelanggaran padahal justru benar.
const menyaringPemilik = (kode) => (
  /\.insert\(/.test(kode)
    ? /user_id\s*:/.test(kode)                 // kepemilikan ditulis di payload
    : /\.eq\(\s*['"`]user_id['"`]/.test(kode)  // kepemilikan disaring di query
)

describe('invarian privasi baris (klien)', () => {
  it.each(TABEL_PRIBADI)('setiap query ke "%s" menyaring pemilik barisnya', (tabel) => {
    const rantai = rantaiQuery(API, tabel)

    // Kalau tabelnya tidak lagi diakses, invariannya kehilangan makna —
    // lebih baik test ini gagal keras daripada diam-diam jadi hijau kosong.
    expect(rantai.length).toBeGreaterThan(0)

    const pelanggaran = rantai
      .filter((r) => !menyaringPemilik(r.kode))
      .map((r) => `src/lib/api.js:${r.baris}`)

    expect(pelanggaran).toEqual([])
  })

  it('fetchFeedback menolak berjalan tanpa sesi, bukan mengembalikan semua baris', () => {
    // Tanpa penjagaan ini, pemanggilan sebelum sesi siap akan mengirim query
    // tanpa filter user_id dan bergantung sepenuhnya pada RLS.
    const fn = API.slice(API.indexOf('export async function fetchFeedback'))
      .slice(0, 600)
    expect(fn).toMatch(/if\s*\(!user\)\s*return\s*\[\]/)
  })

  it('deleteFeedback membatasi penghapusan ke baris milik pemanggil', () => {
    const fn = API.slice(API.indexOf('export async function deleteFeedback'))
      .slice(0, 500)
    expect(fn).toMatch(/\.eq\(\s*['"`]user_id['"`]/)
  })
})
