// ============================================================
// deno test — peta domain, gerbang hak akses, dan jatah baris.
//
// Test invarian PII di berkas ini adalah yang paling penting di seluruh
// lapisan RAG. Daftar-izin kolom adalah satu-satunya hal yang memisahkan
// "nama produk dikirim ke Gemini" dari "nomor HP pelanggan dikirim ke Gemini",
// dan satu baris tambahan yang ceroboh sudah cukup untuk menyeberanginya.
// ============================================================
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { WorkspaceScope } from '../workspace-scope.ts'
import { ALL_MODULES } from '../workspace-scope.ts'
import {
  bolehAkses,
  DOMAIN,
  JATAH,
  jatahBaris,
  saringDomain,
  semuaKolomDideklarasikan,
} from './domains.ts'
import { SEMUA_DOMAIN } from './intent-router.ts'
import { kolomTerlarang } from './redact.ts'

/** Scope palsu: pemilik usaha. */
const owner = (): WorkspaceScope => ({
  owner: 'u-owner', modules: [...ALL_MODULES], isOwner: true, can: () => true,
})

/** Scope palsu: staf dengan modul tertentu saja. */
const staf = (...modules: string[]): WorkspaceScope => ({
  owner: 'u-owner',
  modules: modules as any,
  isOwner: false,
  can: (m: any) => modules.includes(m),
})

// ---------- INVARIAN PII ----------

Deno.test('INVARIAN: tidak ada kolom PII di daftar-izin domain mana pun', () => {
  const semua = semuaKolomDideklarasikan()
  assert(semua.length > 40, `hanya ${semua.length} kolom terbaca — peta domain tidak terimpor?`)

  const pelanggar = semua.filter((k) => kolomTerlarang([k.kolom]).length > 0)
  assertEquals(
    pelanggar, [],
    'kolom PII dideklarasikan: '
      + pelanggar.map((p) => `${p.domain}/${p.tabel}.${p.kolom}`).join(', '),
  )
})

Deno.test('INVARIAN: kolom yang sengaja dikecualikan benar-benar tidak ada', () => {
  // Daftar eksplisit, bukan hanya mengandalkan pola. Masing-masing punya
  // alasannya sendiri yang ditulis di domains.ts, dan kalau ada yang
  // memasukkannya kembali, test ini menyebut namanya.
  const haram = [
    'raw',              // baris mutasi bank mentah
    'customer_contact', // nomor HP pelanggan
    'wa_number',        // nomor WhatsApp pengingat
    'phone',            // telepon karyawan/pemasok
    'email',            // email staf
    'changed',          // salinan mentah baris audit; bisa memuat PII tabel apa pun
    'owner_name',       // nama pemilik di profiles
  ]
  const dideklarasikan = new Set(semuaKolomDideklarasikan().map((k) => k.kolom))
  for (const k of haram) {
    assert(!dideklarasikan.has(k), `kolom "${k}" masuk kembali ke daftar-izin`)
  }
})

Deno.test('INVARIAN: tidak ada daftar-izin yang memakai bintang', () => {
  for (const k of semuaKolomDideklarasikan()) {
    assert(k.kolom !== '*', `${k.domain}/${k.tabel} memakai select('*')`)
  }
})

// ---------- Kelengkapan peta ----------

Deno.test('setiap domain punya minimal satu tabel', () => {
  for (const d of SEMUA_DOMAIN) {
    assert(DOMAIN[d]?.tabel?.length > 0, `domain ${d} tidak punya tabel`)
  }
})

Deno.test('setiap tabel punya label dan kolom', () => {
  for (const d of SEMUA_DOMAIN) {
    for (const t of DOMAIN[d].tabel) {
      assert(t.label.length > 0, `${d}/${t.tabel} tanpa label`)
      assert(t.kolom.length > 0, `${d}/${t.tabel} tanpa kolom`)
    }
  }
})

Deno.test('tabel utama selalu punya urutan yang ditentukan', () => {
  // "50 baris pertama" tidak berarti apa-apa tanpa urutan. Tanpa .order(),
  // baris mana yang terbawa ditentukan database dan bisa berubah-ubah.
  for (const d of SEMUA_DOMAIN) {
    for (const t of DOMAIN[d].tabel) {
      if (t.utama) assert(t.urut, `${d}/${t.tabel} adalah tabel utama tanpa urutan`)
    }
  }
})

Deno.test('label blok unik di dalam satu domain', () => {
  // Dua blok berlabel sama membuat model tidak bisa membedakan sumbernya.
  for (const d of SEMUA_DOMAIN) {
    const label = DOMAIN[d].tabel.map((t) => t.label)
    assertEquals(new Set(label).size, label.length, `domain ${d} punya label ganda`)
  }
})

// ---------- Gerbang hak akses ----------

Deno.test('pemilik boleh membaca semua domain', () => {
  for (const d of SEMUA_DOMAIN) {
    assert(bolehAkses(d, owner()), `pemilik ditolak di domain ${d}`)
  }
})

Deno.test('staf hanya boleh membaca domain sesuai modulnya', () => {
  const s = staf('produk')
  assert(bolehAkses('produk', s), 'staf produk ditolak di domainnya sendiri')
  assert(!bolehAkses('hr', s), 'staf produk bisa membaca HR')
  assert(!bolehAkses('transaksi', s), 'staf produk bisa membaca transaksi')
  assert(!bolehAkses('ringkasan', s), 'staf produk bisa membaca ringkasan')
})

Deno.test('domain lainnya ditolak untuk staf berapa pun modulnya', () => {
  // Audit log, daftar staf, dan profil usaha berbicara atas nama pemilik.
  // Bahkan staf dengan SELURUH modul tidak boleh membukanya.
  assert(!bolehAkses('lainnya', staf(...ALL_MODULES)), 'staf bermodul penuh bisa membaca audit log')
})

Deno.test('GAGAL TERTUTUP: isOwner yang bukan true persis ditolak', () => {
  // Pola yang sama dengan canManageUsers() di src/lib/rbac.js. Nilai yang
  // belum termuat harus berarti TIDAK, bukan diam-diam berarti ya.
  const meragukan = [undefined, null, 1, 'true', {}, 'owner']
  for (const nilai of meragukan) {
    const s = { owner: 'u', modules: [], isOwner: nilai, can: () => true } as any
    assert(!bolehAkses('lainnya', s), `isOwner=${JSON.stringify(nilai)} diterima sebagai pemilik`)
  }
})

Deno.test('GAGAL TERTUTUP: scope tanpa fungsi can ditolak', () => {
  const s = { owner: 'u', modules: ['produk'], isOwner: false } as any
  assert(!bolehAkses('produk', s), 'scope tanpa can() diterima')
})

Deno.test('saringDomain membuang yang terlarang dan menjaga urutan', () => {
  const s = staf('produk', 'operasional')
  assertEquals(
    saringDomain(['hr', 'produk', 'lainnya', 'operasional', 'transaksi'], s),
    ['produk', 'operasional'],
  )
})

Deno.test('saringDomain untuk staf tanpa modul mengembalikan kosong', () => {
  assertEquals(saringDomain([...SEMUA_DOMAIN], staf()), [])
})

// ---------- Jatah baris ----------

Deno.test('tabel utama domain fokus dapat jatah terbesar', () => {
  const produk = DOMAIN.produk.tabel.find((t) => t.tabel === 'products')!
  assertEquals(jatahBaris(produk, 'fokus'), JATAH.FOKUS_UTAMA)
})

Deno.test('tabel sekunder domain fokus dapat jatah kecil', () => {
  const pemasok = DOMAIN.produk.tabel.find((t) => t.tabel === 'suppliers')!
  assertEquals(jatahBaris(pemasok, 'fokus'), JATAH.FOKUS_SEKUNDER)
})

Deno.test('domain pendukung selalu jatah kecil, termasuk tabel utamanya', () => {
  const produk = DOMAIN.produk.tabel.find((t) => t.tabel === 'products')!
  assertEquals(jatahBaris(produk, 'pendukung'), JATAH.PENDUKUNG)
})

Deno.test('transaksi memakai jatah khusus, bukan jatah utama biasa', () => {
  // Barisnya paling boros token (ada deskripsi teks bebas) dan angkanya sudah
  // terwakili agregat.
  const tx = DOMAIN.transaksi.tabel.find((t) => t.tabel === 'transactions')!
  assertEquals(jatahBaris(tx, 'fokus'), 30)
  assert(jatahBaris(tx, 'fokus') < JATAH.FOKUS_UTAMA)
})

Deno.test('jatah selalu bilangan positif', () => {
  for (const d of SEMUA_DOMAIN) {
    for (const t of DOMAIN[d].tabel) {
      for (const tingkat of ['fokus', 'pendukung'] as const) {
        assert(jatahBaris(t, tingkat) > 0, `${d}/${t.tabel} jatah ${tingkat} tidak positif`)
      }
    }
  }
})

// ---------- Tabel global ----------

Deno.test('hanya tabel milik bersama yang ditandai global', () => {
  // Salah menandai tabel ber-user_id sebagai global berarti membuang filter
  // .eq('user_id') — data usaha lain ikut terbaca. Ini kebocoran, bukan bug
  // tampilan.
  const global = SEMUA_DOMAIN.flatMap((d) => DOMAIN[d].tabel.filter((t) => t.global).map((t) => t.tabel))
  assertEquals(global.sort(), ['commodity_prices', 'exchange_rates', 'macro_signals'])
})
