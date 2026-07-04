-- ============================================================
-- MIGRASI v2 — jalankan SETELAH schema.sql & migration_auth.sql
-- Supabase Dashboard → SQL Editor → New query → tempel → Run
-- Menambah: kategori & channel milik user, lampiran struk (foto/PDF),
--           jenis Wajib Pajak, dan storage bucket untuk struk.
-- ============================================================

-- 1) KATEGORI milik user (bisa ditambah/diedit/dihapus sendiri)
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  direction  text not null check (direction in ('in','out')),
  created_at timestamptz not null default now(),
  unique (user_id, name, direction)
);
alter table public.categories enable row level security;
drop policy if exists "own categories" on public.categories;
create policy "own categories" on public.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2) CHANNEL/sumber milik user
create table if not exists public.channels (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  value      text not null,
  label      text not null,
  icon       text not null default '🏷️',
  created_at timestamptz not null default now(),
  unique (user_id, value)
);
alter table public.channels enable row level security;
drop policy if exists "own channels" on public.channels;
create policy "own channels" on public.channels
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3) Lampiran struk pada transaksi + jenis Wajib Pajak pada profil
alter table public.transactions add column if not exists receipt_url text;
alter table public.profiles add column if not exists taxpayer_type text not null default 'pribadi'
  check (taxpayer_type in ('pribadi','badan'));

-- 4) STORAGE BUCKET untuk foto/PDF struk (privat)
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- Kebijakan: tiap user hanya bisa akses file di foldernya sendiri (uid/...)
drop policy if exists "receipts read own" on storage.objects;
create policy "receipts read own" on storage.objects for select
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "receipts insert own" on storage.objects;
create policy "receipts insert own" on storage.objects for insert
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "receipts delete own" on storage.objects;
create policy "receipts delete own" on storage.objects for delete
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
