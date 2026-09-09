-- ============================================================
-- products.image_url — kolom foto produk yang tidak pernah dibuat migrasi.
--
-- Ditemukan 9 September 2026 lewat sapuan sistematis skema-vs-kode:
--
--     Stok.jsx -> products   HANTU: ['image_url']
--
-- Seluruh fitur foto produk sudah ada di frontend — unggah, ganti, hapus,
-- tampil di kartu & tabel inventaris (Stok.jsx baris 24, 120-129, 144, 155,
-- 172) — tetapi tidak satu pun berkas migrasi mendefinisikan kolomnya.
-- Kolom itu dulu dibuat manual lewat Dashboard, jadi ia hidup di database
-- lama tanpa jejak di repo, lalu lenyap ketika proyek dibangun ulang.
--
-- Pola yang SAMA PERSIS dengan bucket `product-images` (migration_storage_
-- buckets.sql) dan dengan `supplier_name`: sesuatu yang hanya hidup di
-- dashboard adalah sesuatu yang tidak bisa dipulihkan, dan ketiadaannya baru
-- terasa saat pengguna menekan Simpan.
--
-- Bentuk kegagalannya juga sama: PostgREST membalas
--   "Could not find the 'image_url' column of 'products' in the schema cache"
-- dan SELURUH penyimpanan produk gagal — termasuk produk yang tidak memakai
-- foto sama sekali, karena form selalu menyertakan field itu walau nilainya null.
-- ============================================================

alter table public.products
  add column if not exists image_url text;

comment on column public.products.image_url is
  'URL publik foto produk di bucket product-images. Path objeknya berpola <user_id>/<uuid>.<ext> (lihat uploadProductImage di src/lib/api.js).';
