-- ============================================================
-- RADAR PER PROVINSI + FITUR PENGINGAT
-- (salinan repo; sudah diterapkan sebagai migrasi `radar_provinsi_pengingat_v1`)
--
-- 1) commodity_prices.province_id: 0 = rata-rata nasional (perilaku lama),
--    1..34 = id provinsi resmi PIHPS Bank Indonesia. Kunci unik diganti
--    (run_date, variant_name, province_id) agar cache harga per provinsi
--    per hari bisa disimpan berdampingan. Diisi Edge Function harga-daerah
--    saat pengguna memilih provinsi (sekali per provinsi per hari).
-- 2) reminders: pengingat pengguna (mis. ambil stok jam 3 sore) — tampil
--    sebagai notifikasi di Dashboard sampai pengguna menekan silang;
--    wa_number opsional untuk tombol kirim ke WhatsApp sendiri.
--    RLS: owner + staf modul 'operasional' (pola sama dengan tasks).
-- ============================================================

alter table public.commodity_prices
  add column if not exists province_id int not null default 0;

alter table public.commodity_prices
  drop constraint if exists commodity_prices_run_date_variant_name_key;
create unique index if not exists commodity_prices_run_variant_prov_key
  on public.commodity_prices (run_date, variant_name, province_id);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  note text,
  remind_at timestamptz not null,
  wa_number text,
  status text not null default 'aktif' check (status in ('aktif','selesai')),
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.reminders enable row level security;
create policy "rem_own" on public.reminders for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "staff_operasional" on public.reminders for all
  using (public.has_access(user_id,'operasional')) with check (public.has_access(user_id,'operasional'));
create index if not exists idx_reminders_user_status on public.reminders (user_id, status, remind_at);
