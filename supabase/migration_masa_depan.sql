-- ============================================================
-- MIGRASI "ASISTEN KEUANGAN UMKM MASA DEPAN" (v1)
-- Jalankan SETELAH migration_ai_usage.sql. Aman diulang.
--
-- Menambah:
--   1) sales_targets   : target penjualan (untuk prediksi regresi 3 skenario)
--   2) ai_insights     : cache narasi insight harian per user (hemat biaya AI)
--   3) ingredients     : komponen biaya/bahan milik user (untuk HPP)
--   4) product_boms    : komposisi bahan per produk (Bill of Materials)
--   5) macro_signals   : sinyal harga komoditas dari berita (BERSAMA, ditulis
--                        service role oleh Edge Function makro-harian)
--   6) exchange_rates  : riwayat kurs USD/IDR harian (BERSAMA)
--   7) macro_config    : inflasi BPS bulanan (input manual admin)
--   8) macro_runs      : kunci proses batch makro 1x/hari
--   + kolom transactions.product_id & qty (opsional, granularitas produk)
-- ============================================================

-- ------------------------------------------------------------
-- 1) TARGET PENJUALAN
-- ------------------------------------------------------------
create table if not exists public.sales_targets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  amount     numeric(14,2) not null check (amount > 0),
  start_date date not null default current_date,
  deadline   date,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists sales_targets_user_idx on public.sales_targets (user_id);
alter table public.sales_targets enable row level security;
drop policy if exists "own sales_targets" on public.sales_targets;
create policy "own sales_targets" on public.sales_targets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 2) CACHE INSIGHT AI HARIAN
-- ------------------------------------------------------------
create table if not exists public.ai_insights (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  insight_date date not null default current_date,
  kind         text not null default 'harian',
  content      text not null,
  payload      jsonb,
  created_at   timestamptz not null default now(),
  unique (user_id, insight_date, kind)
);
alter table public.ai_insights enable row level security;
drop policy if exists "own ai_insights" on public.ai_insights;
create policy "own ai_insights" on public.ai_insights
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3) BAHAN / KOMPONEN BIAYA (generik lintas jenis UMKM)
-- ------------------------------------------------------------
create table if not exists public.ingredients (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  name             text not null,
  type             text not null default 'bahan' check (type in ('bahan','kemasan','energi','tenaga','lainnya')),
  unit             text not null default 'gram',
  price_per_unit   numeric(14,4) not null default 0,
  price_source     text not null default 'manual' check (price_source in ('manual','struk','estimasi_ai')),
  commodity_key    text,
  import_exposure  text not null default 'rendah' check (import_exposure in ('tinggi','sedang','rendah')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ingredients_user_idx on public.ingredients (user_id);
alter table public.ingredients enable row level security;
drop policy if exists "own ingredients" on public.ingredients;
create policy "own ingredients" on public.ingredients
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 4) KOMPOSISI PER PRODUK (BoM)
-- ------------------------------------------------------------
create table if not exists public.product_boms (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  ingredient_id   uuid not null references public.ingredients(id) on delete cascade,
  qty_per_unit    numeric(14,4) not null default 0,
  is_ai_estimated boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (product_id, ingredient_id)
);
create index if not exists product_boms_user_idx on public.product_boms (user_id);
create index if not exists product_boms_product_idx on public.product_boms (product_id);
alter table public.product_boms enable row level security;
drop policy if exists "own product_boms" on public.product_boms;
create policy "own product_boms" on public.product_boms
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 5) SINYAL MAKRO BERSAMA (ditulis Edge Function via service role)
-- ------------------------------------------------------------
create table if not exists public.macro_signals (
  id              uuid primary key default gen_random_uuid(),
  run_date        date not null,
  commodity_key   text not null,
  commodity_label text not null,
  direction       text not null default 'stabil' check (direction in ('naik','turun','stabil')),
  est_pct_min     numeric(6,2) not null default 0,
  est_pct_max     numeric(6,2) not null default 0,
  confidence      text not null default 'rendah' check (confidence in ('rendah','sedang','tinggi')),
  drivers         jsonb,
  sources         jsonb,
  created_at      timestamptz not null default now(),
  unique (run_date, commodity_key)
);
create index if not exists macro_signals_date_idx on public.macro_signals (run_date desc);
alter table public.macro_signals enable row level security;
drop policy if exists "read macro_signals" on public.macro_signals;
create policy "read macro_signals" on public.macro_signals
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- 6) KURS USD/IDR HARIAN (bersama)
-- ------------------------------------------------------------
create table if not exists public.exchange_rates (
  rate_date  date primary key,
  usd_idr    numeric(14,4) not null,
  source     text,
  created_at timestamptz not null default now()
);
alter table public.exchange_rates enable row level security;
drop policy if exists "read exchange_rates" on public.exchange_rates;
create policy "read exchange_rates" on public.exchange_rates
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- 7) KONFIGURASI MAKRO BULANAN (inflasi BPS, diisi manual admin)
-- ------------------------------------------------------------
create table if not exists public.macro_config (
  month              text primary key,          -- 'YYYY-MM'
  inflation_yoy      numeric(6,2),              -- inflasi umum tahunan (%)
  inflation_food_yoy numeric(6,2),              -- inflasi pangan/bergejolak (%)
  note               text,
  updated_at         timestamptz not null default now()
);
alter table public.macro_config enable row level security;
drop policy if exists "read macro_config" on public.macro_config;
create policy "read macro_config" on public.macro_config
  for select to authenticated using (true);
drop policy if exists "admin write macro_config" on public.macro_config;
create policy "admin write macro_config" on public.macro_config
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 8) KUNCI PROSES BATCH MAKRO (1 baris per hari)
-- ------------------------------------------------------------
create table if not exists public.macro_runs (
  run_date    date primary key,
  status      text not null default 'running',
  detail      text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.macro_runs enable row level security;
drop policy if exists "read macro_runs" on public.macro_runs;
create policy "read macro_runs" on public.macro_runs
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- Kolom opsional pada transactions: granularitas produk terjual
-- ------------------------------------------------------------
alter table public.transactions add column if not exists product_id uuid references public.products(id) on delete set null;
alter table public.transactions add column if not exists qty numeric(14,2);

-- ============================================================
-- SELESAI.
-- ============================================================
