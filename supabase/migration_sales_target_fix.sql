-- ============================================================
-- PERBAIKAN TARGET PENJUALAN (sales_targets)
-- Jalankan SETELAH migration_masa_depan.sql. Aman diulang.
--
-- Latar belakang
-- --------------
-- Skema produksi sudah menyimpang dari berkas migrasi: kolom `revenue_target`
-- dan `profit_target` dipakai kode (src/lib/api.js: addTarget/fetchActiveTarget,
-- src/pages/Dashboard.jsx: computeTargetProgress) tetapi tidak pernah dibuat
-- oleh migrasi mana pun, dan `amount` sudah tidak NOT NULL lagi di produksi.
-- Akibatnya lingkungan baru (staging / instalasi ulang) gagal dengan
--   PGRST204: column "revenue_target" does not exist
-- Migrasi ini menyamakan berkas dengan produksi supaya keduanya bertemu.
-- ============================================================

-- 1) Dua kolom target yang selama ini hanya ada di produksi.
--    `amount` dipertahankan demi kode/insight lama; nilainya = revenue ?? profit.
alter table public.sales_targets add column if not exists revenue_target numeric(14,2);
alter table public.sales_targets add column if not exists profit_target  numeric(14,2);

-- 2) `amount` boleh kosong untuk baris lama; baris baru selalu diisi oleh
--    addTarget(). CHECK (amount > 0) dari migrasi awal tetap berlaku dan
--    tidak menolak NULL, jadi tidak perlu dibongkar.
alter table public.sales_targets alter column amount drop not null;

-- 3) Setidaknya satu angka target harus terisi. Tanpa ini, target "kosong"
--    bisa masuk dan Dashboard menampilkan progres 0% tanpa metrik apa pun.
alter table public.sales_targets drop constraint if exists sales_targets_has_goal_check;
alter table public.sales_targets add constraint sales_targets_has_goal_check
  check (revenue_target is not null or profit_target is not null or amount is not null);

-- 4) Isi mundur baris lama yang hanya punya `amount` supaya kartu target
--    tetap menampilkan metrik omset, bukan kartu tanpa baris apa pun.
update public.sales_targets
   set revenue_target = amount
 where revenue_target is null and profit_target is null and amount is not null;

-- 5) Hanya SATU target aktif per workspace.
--    addTarget() menonaktifkan target lama sebelum menyisipkan yang baru, tapi
--    itu dua perintah terpisah — kalau yang kedua gagal di tengah, workspace
--    bisa punya dua baris is_active. Indeks ini menutup celah tersebut di
--    tingkat basis data, bukan hanya di klien.
create unique index if not exists sales_targets_one_active_idx
  on public.sales_targets (user_id) where is_active;

-- 6) fetchActiveTarget() memfilter is_active lalu mengurutkan created_at desc.
create index if not exists sales_targets_active_idx
  on public.sales_targets (user_id, is_active, created_at desc);
