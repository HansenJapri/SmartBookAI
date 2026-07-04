-- ============================================================
-- MIGRASI v4 - Logo usaha & pengaturan nota/invoice
-- Jalankan SETELAH migration_v3.sql
-- Supabase Dashboard, SQL Editor, New query, tempel, Run. Aman diulang.
-- ============================================================

-- Logo/foto profil usaha (disimpan sebagai data URL base64, ukuran kecil).
alter table public.profiles add column if not exists logo_url text;

-- Baris "dilayani oleh" pada nota: label bisa dikustom, nilai, dan tampil/tidak.
alter table public.profiles add column if not exists invoice_server_label text;
alter table public.profiles add column if not exists invoice_server_value text;
alter table public.profiles add column if not exists invoice_show_server boolean not null default false;

-- PPN dan biaya layanan (persen) untuk grand total pada nota. 0 = tidak dipakai.
alter table public.profiles add column if not exists invoice_tax_percent     numeric(5,2) not null default 0;
alter table public.profiles add column if not exists invoice_service_percent numeric(5,2) not null default 0;

-- ============================================================
-- SELESAI.
-- ============================================================
