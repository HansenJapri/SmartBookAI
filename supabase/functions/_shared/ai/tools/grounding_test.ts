// deno test — angka yang diusulkan model harus punya dasar di kalimat pengguna.
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { angkaDalamTeks, nilaiTerdukung } from './grounding.ts'
import { validateDraft } from './crud-tools.ts'
import type { ValidatedDraft } from './crud-tools.ts'

// ---------- Pembacaan angka ----------

Deno.test('titik adalah pemisah RIBUAN, bukan desimal', () => {
  // Salah membaca ini berarti menolak angka yang sah lalu bertanya untuk
  // sesuatu yang sudah dijawab pengguna.
  assertEquals(angkaDalamTeks('total 45.000').includes(45000), true)
  assertEquals(angkaDalamTeks('total 1.250.000').includes(1250000), true)
})

Deno.test('akhiran informal yang dipakai pemilik warung', () => {
  assertEquals(angkaDalamTeks('45rb').includes(45000), true)
  assertEquals(angkaDalamTeks('45 ribu').includes(45000), true)
  assertEquals(angkaDalamTeks('1,5jt').includes(1500000), true)
  assertEquals(angkaDalamTeks('50k').includes(50000), true)
})

Deno.test('"5 kue" TIDAK boleh terbaca 5.000 — "k" milik kata "kue"', () => {
  const a = angkaDalamTeks('kejual 5 kue')
  assertEquals(a.includes(5), true)
  assertEquals(a.includes(5000), false)
})

Deno.test('angka berakhiran tetap menyumbang angka telanjangnya', () => {
  // "5 ribu" bisa berarti nominal 5.000 ATAU jumlah 5; keduanya sah.
  const a = angkaDalamTeks('5 ribu')
  assertEquals(a.includes(5000), true)
  assertEquals(a.includes(5), true)
})

// ---------- Dukungan nilai ----------

Deno.test('nilai yang disebut persis = terdukung', () => {
  assertEquals(nilaiTerdukung(45000, 'laku 3 kue coklat total 45 ribu'), true)
})

Deno.test('perkalian qty x harga satuan = terdukung', () => {
  assertEquals(nilaiTerdukung(15000, 'jual 5 kue @3000'), true)
})

Deno.test('penjumlahan dua angka di satu kalimat = terdukung', () => {
  assertEquals(nilaiTerdukung(32000, 'beli gas 22rb sama plastik 10rb'), true)
})

Deno.test('KASUS NYATA: "kejual kue 5 pcs" tidak mendukung nominal apa pun', () => {
  // Bug yang memicu seluruh berkas ini: model menjawab Rp5.000 untuk kalimat
  // yang tidak memuat satu pun harga.
  assertEquals(nilaiTerdukung(5000, 'kejual kue 5 pcs'), false)
  assertEquals(nilaiTerdukung(15000, 'kejual kue 5 pcs'), false)
})

Deno.test('kalimat tanpa angka sama sekali tidak mendukung apa pun', () => {
  assertEquals(nilaiTerdukung(10000, 'kejual kue'), false)
})

// ---------- Gerbang di validateDraft ----------

function draf(args: Record<string, unknown>, teks?: string) {
  return validateDraft('create_transaksi', args, teks) as ValidatedDraft
}

Deno.test('nominal karangan diperlakukan seperti KOSONG, lalu ditanyakan', () => {
  const d = draf({
    direction: 'in', amount: 5000, description: 'kejual kue 5 pcs', category: 'Penjualan',
  }, 'kejual kue 5 pcs')

  assertEquals(d.values.amount, undefined)
  assertEquals(d.ok, false)
  assertEquals(d.missingRequired.some((q) => q.field === 'amount'), true)
})

Deno.test('nominal yang benar-benar disebut TIDAK ikut dibuang', () => {
  const d = draf({
    direction: 'in', amount: 45000, description: 'laku 3 kue coklat total 45 ribu', category: 'Penjualan',
  }, 'laku 3 kue coklat total 45 ribu')

  assertEquals(d.values.amount, 45000)
  assertEquals(d.missingRequired.some((q) => q.field === 'amount'), false)
})

Deno.test('jumlah (qty) yang disebut pengguna tetap lolos', () => {
  const d = draf({
    direction: 'in', amount: 45000, description: 'laku 3 kue 45rb', category: 'Penjualan', qty: 3,
  }, 'laku 3 kue 45rb')

  assertEquals(d.values.qty, 3)
})

Deno.test('tanpa teks pengguna, gerbang TIDAK aktif — pemanggil lama tidak patah', () => {
  const d = draf({
    direction: 'in', amount: 5000, description: 'kejual kue 5 pcs', category: 'Penjualan',
  })
  assertEquals(d.values.amount, 5000)
})
