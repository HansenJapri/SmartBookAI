-- ============================================================
-- MIGRASI v3 - alamat usaha (untuk invoice) & harga modal produk (HPP)
-- Jalankan SETELAH migration_invoice.sql
-- Supabase Dashboard, SQL Editor, New query, tempel, Run. Aman diulang.
-- ============================================================

-- Alamat usaha penjual: komponen invoice yang baik menurut kaidah Indonesia.
alter table public.profiles add column if not exists business_address text;

-- Harga modal / Harga Pokok per produk (untuk hitung HPP & margin).
alter table public.products add column if not exists cost_price numeric(14,2) not null default 0;

-- ============================================================
-- SELESAI.
-- ============================================================
