-- ============================================================
-- Bucket storage: product-images
--
-- Berkas ini ada karena bucket ini DULU dibuat lewat Dashboard, bukan lewat
-- migrasi. Akibatnya ia tidak ikut ter-versi di repo, dan ketika proyek
-- Supabase terhapus pada 8 September 2026 tidak ada satu pun berkas yang bisa
-- membangunnya kembali — padahal seluruh tabel bisa. Sesuatu yang hanya hidup
-- di dashboard adalah sesuatu yang tidak bisa dipulihkan.
--
-- Bucket `receipts` sudah dibuat oleh migrasi lain, jadi tidak diulang di sini.
--
-- KONVENSI PATH: <user_id>/<uuid>.<ext>  (lihat uploadProductImage di
-- src/lib/api.js). Segmen pertama path DIPAKAI RLS untuk membatasi pemilik.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

-- Menulis/mengubah/menghapus: HANYA di folder milik sendiri.
drop policy if exists "product_images_owner_insert" on storage.objects;
create policy "product_images_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "product_images_owner_update" on storage.objects;
create policy "product_images_owner_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "product_images_owner_delete" on storage.objects;
create policy "product_images_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- SENGAJA TIDAK ADA policy SELECT publik.
--
-- Temuan P0 audit keamanan (security/AUDIT_KEAMANAN_P0.md): policy
-- `product_images_public_read` yang lama berbunyi `using (bucket_id =
-- 'product-images')` tanpa batasan pemilik, sehingga SIAPA PUN — termasuk anon —
-- bisa MELISTING seluruh objek milik semua pengguna lewat storage API.
--
-- Menghapusnya TIDAK mematahkan tampilan foto: bucket ini public, jadi
-- getPublicUrl() disajikan lewat endpoint publik yang tidak melewati RLS.
-- Yang hilang hanya kemampuan MENDAFTAR isi bucket — dan itu memang yang
-- seharusnya hilang.
