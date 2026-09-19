import { describe, it, expect } from 'vitest'
import {
  objekMigrasi, periksaSkemaTerkini, laporanSkemaTerkini, BELUM_DITERAPKAN,
} from '../../../scripts/cekSkemaTerkini.mjs'

// Gerbang DB membangun skemanya dari supabase/schema.sql. Kalau dump itu basi,
// CI menguji skema yang bukan skema produksi — dan tetap hijau. Penjaga ini
// yang mencegahnya, jadi ia sendiri harus teruji.

describe('objekMigrasi', () => {
  it('mengambil nama fungsi dan tabel yang dibuat', () => {
    const { objek } = objekMigrasi([
      'create or replace function public.batalkan_transaksi(p_id uuid)',
      'create table if not exists public.stock_movements (',
    ].join('\n'))
    expect(objek).toContain('batalkan_transaksi')
    expect(objek).toContain('stock_movements')
  })

  it('mengambil kolom yang ditambahkan ke tabel yang sudah ada', () => {
    // Objeknya tidak baru, jadi nama tabelnya saja tidak membuktikan apa-apa;
    // nama KOLOM-nya yang harus muncul di dump.
    const { kolom } = objekMigrasi(
      'alter table public.transactions add column if not exists alasan_batal text;',
    )
    expect(kolom).toContain('alasan_batal')
  })

  it('MENGABAIKAN yang ada di dalam komentar', () => {
    // Repo ini memuat berkas "migrasi" yang isinya MURNI komentar — catatan
    // tentang fungsi yang dipasang di tempat lain. Tanpa ini, kalimat semacam
    // itu dibaca sebagai objek yang wajib ada, dan penjaganya menuduh dump yang
    // sebenarnya benar.
    const { objek } = objekMigrasi([
      '-- create or replace function public.fungsi_yang_hilang()',
      '-- Dulu ada di project lama.',
      'create or replace function public.fungsi_asli()',
    ].join('\n'))
    expect(objek).toEqual(['fungsi_asli'])
  })
})

describe('periksaSkemaTerkini', () => {
  it('menangkap objek migrasi yang tidak ada di dump', () => {
    const { kurang } = periksaSkemaTerkini(
      [{ path: 'supabase/migration_baru.sql', isi: 'create table public.tabel_baru (' }],
      'CREATE TABLE "public"."tabel_lama" (',
    )
    expect(kurang).toHaveLength(1)
    expect(kurang[0].hilang).toContain('tabel_baru')
  })

  it('menerima dump yang memuat objeknya, apa pun huruf besar-kecilnya', () => {
    const { kurang } = periksaSkemaTerkini(
      [{ path: 'supabase/migration_baru.sql', isi: 'create table public.stock_movements (' }],
      'CREATE TABLE IF NOT EXISTS "public"."STOCK_MOVEMENTS" (',
    )
    expect(kurang).toEqual([])
  })

  it('memisahkan "dump basi" dari objek yang memang di luar jangkauan dump', () => {
    // Dua masalah berbeda. Menggabungkannya membuat utang lama memblokir setiap
    // perubahan yang tidak ada hubungannya — cara tercepat mengajari orang
    // mengabaikan warna merah.
    //
    // Peta pengecualiannya disuntikkan, bukan diambil dari konstanta modul,
    // supaya test ini tetap menguji MEKANISMENYA walau daftar aslinya kosong.
    const jalur = 'supabase/migration_contoh.sql'
    const { kurang, dikecualikan } = periksaSkemaTerkini(
      [{ path: jalur, isi: 'create or replace function public.objek_yang_tidak_ada_di_dump()' }],
      'dump tanpa apa pun',
      { [jalur]: 'alasan yang cukup panjang untuk menjelaskan kenapa dikecualikan' },
    )
    expect(kurang).toEqual([])
    expect(dikecualikan).toEqual([jalur])
  })

  it('setiap pengecualian yang TERDAFTAR wajib menyertakan alasan yang bisa dibaca', () => {
    // Daftar pengecualian tanpa alasan berubah jadi tempat sampah dalam
    // beberapa bulan. Saat ini daftarnya sengaja kosong — utang skema ops
    // sudah lunas sejak dump menyertakan --schema ops.
    for (const [jalur, alasan] of Object.entries(BELUM_DITERAPKAN)) {
      expect(jalur).toMatch(/^supabase\/migration_.*\.sql$/)
      expect(alasan.length).toBeGreaterThan(40)
    }
  })

  it('pengecualian TIDAK berlaku untuk berkas yang tidak terdaftar', () => {
    // Penjaga yang mengecualikan terlalu longgar sama saja dengan tidak ada.
    const { kurang, dikecualikan } = periksaSkemaTerkini(
      [{ path: 'supabase/migration_lain.sql', isi: 'create table public.tabel_hilang (' }],
      'dump tanpa apa pun',
      { 'supabase/migration_contoh.sql': 'alasan panjang yang tidak berlaku di sini sama sekali' },
    )
    expect(dikecualikan).toEqual([])
    expect(kurang).toHaveLength(1)
  })
})

describe('laporanSkemaTerkini', () => {
  it('menyebut pengecualian WALAU hasilnya bersih', () => {
    // Utang yang tidak pernah terbaca di log perlahan berubah jadi keadaan
    // normal.
    const teks = laporanSkemaTerkini([], ['supabase/migration_x.sql'])
    expect(teks).toMatch(/Bersih/)
    expect(teks).toContain('supabase/migration_x.sql')
  })

  it('menyebut perintah dump saat ada yang tertinggal', () => {
    const teks = laporanSkemaTerkini([{ path: 'supabase/migration_x.sql', hilang: ['a'] }])
    expect(teks).toMatch(/supabase db dump/)
    expect(teks).toContain('supabase/migration_x.sql')
  })
})
