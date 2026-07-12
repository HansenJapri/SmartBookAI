-- ============================================================
-- MIGRASI RADAR HARGA v2
-- Jalankan SETELAH migration_masa_depan.sql. Aman diulang.
--
-- 1) commodity_prices : harga bahan pokok RESMI harian (sumber: PIHPS
--    Bank Indonesia — endpoint publik tanpa kunci), diisi Edge Function
--    makro-harian via service role. Semua pengguna membaca cache yang sama.
-- 2) pg_cron + pg_net : menjadwalkan makro-harian tiap 06.00 WIB (23.00 UTC)
--    sehingga data selalu "hasil tarikan jam 6 pagi terbaru".
-- ============================================================

create table if not exists public.commodity_prices (
  id            uuid primary key default gen_random_uuid(),
  run_date      date not null,               -- kunci hari data (batas hari = 06.00 WIB)
  commodity_key text not null,               -- kelompok (beras, telur, ...)
  variant_name  text not null,               -- nama varian resmi PIHPS
  is_group      boolean not null default false, -- true = baris rata-rata kelompok
  price         numeric(14,2) not null,
  prev_price    numeric(14,2),
  price_date    date,                        -- tanggal harga terakhir yang tersedia
  unit          text not null default 'Rp/kg',
  source_name   text not null default 'PIHPS Bank Indonesia',
  source_url    text,                        -- URL endpoint resmi yang BISA dibuka
  created_at    timestamptz not null default now(),
  unique (run_date, variant_name)
);
create index if not exists commodity_prices_run_idx on public.commodity_prices (run_date desc);
alter table public.commodity_prices enable row level security;
drop policy if exists "read commodity_prices" on public.commodity_prices;
create policy "read commodity_prices" on public.commodity_prices
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- Penjadwalan 06.00 WIB (= 23.00 UTC hari sebelumnya)
-- ------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $guard$
begin
  if exists (select 1 from cron.job where jobname = 'makro-harian-6wib') then
    perform cron.unschedule('makro-harian-6wib');
  end if;
end
$guard$;

select cron.schedule(
  'makro-harian-6wib',
  '0 23 * * *',
  $cron$
  select net.http_post(
    url     := 'https://hexaidoxmeycctpwfbst.supabase.co/functions/v1/makro-harian',
    body    := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )
  $cron$
);

-- ============================================================
-- SELESAI.
-- ============================================================
