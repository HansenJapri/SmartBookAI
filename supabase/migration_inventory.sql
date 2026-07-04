-- ============================================================
-- MIGRASI STOK, SUPPLIER, SATUAN, KATEGORI PRODUK
-- Jalankan SETELAH migration_consent.sql
-- Supabase Dashboard, SQL Editor, New query, tempel, Run.
--
-- Menambah:
--   1) suppliers          : data pemasok milik user
--   2) products           : produk/stok milik user (+ peringatan stok menipis)
--   3) units              : satuan produk (bisa CRUD, ada default dari aplikasi)
--   4) product_categories : kategori produk (bisa CRUD, ada default)
-- Semua dilindungi RLS: user hanya melihat datanya sendiri; admin boleh semua.
-- ============================================================

-- ------------------------------------------------------------
-- 1) SUPPLIER
-- ------------------------------------------------------------
create table if not exists public.suppliers (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  phone      text,
  email      text,
  address    text,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists suppliers_user_idx on public.suppliers (user_id);
alter table public.suppliers enable row level security;

drop policy if exists "own suppliers" on public.suppliers;
create policy "own suppliers" on public.suppliers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "admin all suppliers" on public.suppliers;
create policy "admin all suppliers" on public.suppliers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 2) PRODUK / STOK
--    stock     : jumlah stok saat ini
--    min_stock : ambang batas; bila stock <= min_stock => peringatan menipis
-- ------------------------------------------------------------
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  sku         text,
  category    text,
  unit        text not null default 'pcs',
  stock       numeric(14,2) not null default 0,
  min_stock   numeric(14,2) not null default 0,
  price       numeric(14,2) not null default 0,
  supplier_id uuid references public.suppliers(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists products_user_idx on public.products (user_id);
alter table public.products enable row level security;

drop policy if exists "own products" on public.products;
create policy "own products" on public.products
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "admin all products" on public.products;
create policy "admin all products" on public.products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 3) SATUAN PRODUK (bisa CRUD oleh user; default di-seed aplikasi)
-- ------------------------------------------------------------
create table if not exists public.units (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
alter table public.units enable row level security;

drop policy if exists "own units" on public.units;
create policy "own units" on public.units
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "admin all units" on public.units;
create policy "admin all units" on public.units
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 4) KATEGORI PRODUK (bisa CRUD oleh user; default di-seed aplikasi)
-- ------------------------------------------------------------
create table if not exists public.product_categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
alter table public.product_categories enable row level security;

drop policy if exists "own product_categories" on public.product_categories;
create policy "own product_categories" on public.product_categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "admin all product_categories" on public.product_categories;
create policy "admin all product_categories" on public.product_categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- SELESAI. Satuan & kategori produk default akan dibuat otomatis oleh
-- aplikasi saat pertama kali membuka menu Stok.
-- ============================================================
