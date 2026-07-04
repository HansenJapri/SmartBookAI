-- ============================================================
-- MIGRASI INVOICE / STATUS PEMBAYARAN
-- Jalankan SETELAH migration_inventory.sql
-- Supabase Dashboard, SQL Editor, New query, tempel, Run.
--
-- Menambah kolom pada transactions untuk kebutuhan invoice penjualan:
--   payment_status  : 'lunas' atau 'belum' (khusus transaksi pemasukan)
--   customer_name   : nama pelanggan pada invoice (opsional)
--   customer_contact: kontak pelanggan, mis. nomor WhatsApp (opsional)
-- Aman dijalankan berulang (idempoten).
-- ============================================================

alter table public.transactions
  add column if not exists payment_status text not null default 'lunas'
  check (payment_status in ('lunas', 'belum'));

alter table public.transactions add column if not exists customer_name    text;
alter table public.transactions add column if not exists customer_contact text;

-- Indeks untuk memfilter cepat penjualan yang belum lunas.
create index if not exists transactions_unpaid_idx
  on public.transactions (user_id) where payment_status = 'belum';

-- ============================================================
-- SELESAI. Status lunas/belum dipilih saat mencatat pemasukan,
-- dan transaksi otomatis terkelompok berdasarkan status ini.
-- ============================================================
