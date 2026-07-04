-- ============================================================
-- BukuPintar AI — Skema Database Supabase
-- Jalankan seluruh isi file ini di Supabase Dashboard:
--   Project → SQL Editor → New query → tempel → Run
-- ============================================================

-- ---------- PROFIL USAHA ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  business_name text,
  owner_name  text,
  business_type text,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- ---------- TRANSAKSI ----------
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  description text not null,
  amount      numeric(14,2) not null check (amount >= 0),
  direction   text not null check (direction in ('in','out')),
  category    text not null default 'Lain-lain',
  channel     text not null default 'manual',
  source_ref  text,
  raw         text,
  is_duplicate boolean not null default false,
  dismissed_dup boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists transactions_user_date_idx
  on public.transactions (user_id, occurred_at desc);

alter table public.transactions enable row level security;

drop policy if exists "own transactions" on public.transactions;
create policy "own transactions" on public.transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- ATURAN KATEGORI (rule engine, bisa diedit user) ----------
create table if not exists public.categorization_rules (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  keyword   text not null,
  category  text not null,
  direction text check (direction in ('in','out')),
  created_at timestamptz not null default now()
);

alter table public.categorization_rules enable row level security;

drop policy if exists "own rules" on public.categorization_rules;
create policy "own rules" on public.categorization_rules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- AUTO-BUAT PROFIL SAAT SIGNUP ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, business_name, owner_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'business_name', 'Usaha Saya'),
    coalesce(new.raw_user_meta_data->>'owner_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
