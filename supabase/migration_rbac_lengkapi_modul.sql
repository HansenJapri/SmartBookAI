-- ============================================================
-- MELENGKAPI RBAC: policy staf untuk modul `produk`, `transaksi`, `dashboard`
--
-- TEMUAN (9 September 2026, dari laporan nyata): owner memberi staf akses
-- "Operasional" dan "Gudang & Produk". Staf bisa membuka menu Stok Produk —
-- tapi isinya kosong, padahal owner punya produk.
--
-- Sebabnya bukan data, bukan sesi, bukan cache. Audit seluruh tabel berpemilik:
--
--     11 dari 33 tabel punya policy staf. 22 sisanya tidak.
--
-- Modul `hr`, `operasional`, dan sebagian `transaksi`/`analisis` dilengkapi saat
-- fase RBAC dulu. Modul `produk` TIDAK PERNAH mendapat satu policy pun, dan
-- modul `transaksi` hanya sampai tabel `customers` — tabel `transactions`
-- sendiri terlewat.
--
-- Akibatnya UI dan database berbeda pendapat: menu Gudang & Produk MUNCUL
-- karena PATH_MODULE di rbac.js mengizinkannya, lalu setiap kuerinya
-- dikembalikan kosong oleh RLS. Dari layar staf, itu tidak bisa dibedakan dari
-- "usahanya memang belum punya produk" — kegagalan yang menyamar jadi keadaan
-- normal, persis pola yang sama dengan sinyal AI "stabil" palsu bulan lalu.
--
-- Daftar modul di src/lib/rbac.js adalah JANJI kepada owner tentang apa yang
-- ia berikan. Migrasi ini membuat database menepatinya.
--
-- POLA: sama persis dengan staff_operasional/staff_hr yang sudah ada —
--   for all using (has_access(user_id,'<modul>')) with check (sama)
-- `for all`, bukan hanya select: staf diberi modul untuk BEKERJA, bukan
-- menonton. Owner yang hanya ingin memberi hak baca mencabut modulnya.
--
-- has_access() sudah memeriksa status keanggotaan aktif dan daftar modul di
-- staff_members, jadi policy ini tidak pernah lebih longgar dari yang
-- benar-benar diberikan owner.
-- ============================================================

-- ---------- MODUL `produk` — Gudang & Produk ----------
-- Rute: /app/stok, /app/stok/histori, /app/po, /app/opname, /app/hpp, /app/supplier

drop policy if exists "staff_produk" on public.products;
create policy "staff_produk" on public.products for all
  using (public.has_access(user_id, 'produk')) with check (public.has_access(user_id, 'produk'));

drop policy if exists "staff_produk" on public.product_categories;
create policy "staff_produk" on public.product_categories for all
  using (public.has_access(user_id, 'produk')) with check (public.has_access(user_id, 'produk'));

drop policy if exists "staff_produk" on public.units;
create policy "staff_produk" on public.units for all
  using (public.has_access(user_id, 'produk')) with check (public.has_access(user_id, 'produk'));

drop policy if exists "staff_produk" on public.suppliers;
create policy "staff_produk" on public.suppliers for all
  using (public.has_access(user_id, 'produk')) with check (public.has_access(user_id, 'produk'));

drop policy if exists "staff_produk" on public.purchase_orders;
create policy "staff_produk" on public.purchase_orders for all
  using (public.has_access(user_id, 'produk')) with check (public.has_access(user_id, 'produk'));

drop policy if exists "staff_produk" on public.stock_opnames;
create policy "staff_produk" on public.stock_opnames for all
  using (public.has_access(user_id, 'produk')) with check (public.has_access(user_id, 'produk'));

-- Bahan baku & komposisi HPP. Ikut modul `produk` karena /app/hpp ada di
-- bawahnya menurut PATH_MODULE.
drop policy if exists "staff_produk" on public.ingredients;
create policy "staff_produk" on public.ingredients for all
  using (public.has_access(user_id, 'produk')) with check (public.has_access(user_id, 'produk'));

drop policy if exists "staff_produk" on public.product_boms;
create policy "staff_produk" on public.product_boms for all
  using (public.has_access(user_id, 'produk')) with check (public.has_access(user_id, 'produk'));

-- ---------- MODUL `transaksi` — Transaksi & Keuangan ----------
-- Rute: /app/transaksi, /app/struk, /app/import, /app/rekonsiliasi, /app/piutang
--
-- `customers` sudah punya policinya sejak migration_customers_p2. Yang terlewat
-- justru tabel intinya: transactions. Staf yang diberi modul ini sebelumnya
-- tidak bisa melihat SATU PUN transaksi.

drop policy if exists "staff_transaksi" on public.transactions;
create policy "staff_transaksi" on public.transactions for all
  using (public.has_access(user_id, 'transaksi')) with check (public.has_access(user_id, 'transaksi'));

-- Kategori & channel adalah master data yang dipakai form transaksi. Tanpa
-- keduanya, halaman Transaksi terbuka tetapi dropdown kategorinya kosong dan
-- penyimpanan ditolak — bentuk kegagalan yang lebih membingungkan daripada
-- menu yang tidak muncul sama sekali.
drop policy if exists "staff_transaksi" on public.categories;
create policy "staff_transaksi" on public.categories for all
  using (public.has_access(user_id, 'transaksi')) with check (public.has_access(user_id, 'transaksi'));

drop policy if exists "staff_transaksi" on public.channels;
create policy "staff_transaksi" on public.channels for all
  using (public.has_access(user_id, 'transaksi')) with check (public.has_access(user_id, 'transaksi'));

drop policy if exists "staff_transaksi" on public.categorization_rules;
create policy "staff_transaksi" on public.categorization_rules for all
  using (public.has_access(user_id, 'transaksi')) with check (public.has_access(user_id, 'transaksi'));

-- ---------- MODUL `dashboard` ----------
-- Kartu Target Penjualan dan Insight AI di halaman depan.
--
-- Sengaja `dashboard`, bukan `analisis`: SECTION_MODULE memetakan seksi
-- `ringkasan` (halaman depan) ke modul dashboard, dan owner memang bisa
-- memberi staf halaman depan tanpa memberi Laporan.

drop policy if exists "staff_dashboard" on public.sales_targets;
create policy "staff_dashboard" on public.sales_targets for all
  using (public.has_access(user_id, 'dashboard')) with check (public.has_access(user_id, 'dashboard'));

drop policy if exists "staff_dashboard" on public.ai_insights;
create policy "staff_dashboard" on public.ai_insights for all
  using (public.has_access(user_id, 'dashboard')) with check (public.has_access(user_id, 'dashboard'));

-- ---------- YANG SENGAJA TIDAK DIBERI POLICY STAF ----------
--
--   admins, error_logs            -> milik admin platform, bukan usaha mana pun
--   audit_logs, app_events        -> jejak audit; staf tidak boleh membaca
--   ai_usage, ai_activity_log     -> pembukuan pemakaian & biaya AI milik owner
--   feedback                      -> OWNER_ONLY_KEYS di rbac.js
--   staff_members                 -> sudah punya sm_owner_all / sm_member_select
--   profiles                      -> identitas akun, bukan data usaha
--
-- Daftar ini ditulis eksplisit supaya "belum dikerjakan" tidak pernah lagi
-- tertukar dengan "sengaja dibiarkan" — kekeliruan yang justru melahirkan
-- migrasi ini.
