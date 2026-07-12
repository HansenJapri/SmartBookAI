-- ============================================================
-- FASE 3: RBAC (staf per modul) + AUDIT LOG permanen
-- (salinan repo; sudah diterapkan sebagai migrasi `rbac_audit_fase3`)
--
-- RBAC: owner mengundang staf via email. Saat staf login dengan email
-- tersebut, baris keanggotaan di-klaim (member_id terisi) dan berstatus
-- aktif. Fungsi has_access(owner, modul) dipakai policy tambahan di tiap
-- tabel: staf hanya bisa membaca/menulis data owner pada modul yang
-- diizinkan ('transaksi' | 'produk' | 'analisis'). Policy lama
-- (auth.uid() = user_id) tetap berlaku untuk owner.
--
-- AUDIT: audit_logs hanya bisa DIBACA owner; tidak ada policy tulis untuk
-- klien — baris hanya ditulis trigger log_audit() (security definer) yang
-- terpasang di 6 tabel inti. UPDATE menyimpan diff per kolom [lama, baru].
-- ============================================================

create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  member_id uuid references auth.users(id) on delete set null,
  role text not null default 'staf',
  modules text[] not null default '{}',
  status text not null default 'invited' check (status in ('invited','active','revoked')),
  created_at timestamptz not null default now(),
  unique (owner_id, email)
);
alter table public.staff_members enable row level security;
create policy "sm_owner_all" on public.staff_members for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "sm_member_select" on public.staff_members for select
  using (member_id = auth.uid() or lower(email) = lower(coalesce(auth.jwt()->>'email','')));
create policy "sm_member_claim" on public.staff_members for update
  using (member_id is null and status = 'invited' and lower(email) = lower(coalesce(auth.jwt()->>'email','')))
  with check (member_id = auth.uid());

create or replace function public.has_access(owner uuid, module text)
returns boolean language sql stable security definer set search_path = public as $$
  select owner = auth.uid() or exists (
    select 1 from public.staff_members m
    where m.owner_id = owner and m.member_id = auth.uid()
      and m.status = 'active' and module = any(m.modules)
  );
$$;

-- Policy staf per modul (lihat migrasi terpasang untuk daftar lengkap):
--   transaksi: transactions, categories, channels, categorization_rules
--   produk   : products, suppliers, units, product_categories,
--              purchase_orders, stock_opnames, ingredients, product_boms
--   analisis : sales_targets, ai_insights
--   profiles : staf aktif boleh SELECT profil owner-nya

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  owner_id uuid not null,
  actor_id uuid,
  table_name text not null,
  action text not null,
  row_id text,
  changed jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_logs enable row level security;
create policy "audit_owner_read" on public.audit_logs for select using (owner_id = auth.uid());
create index if not exists idx_audit_owner_created on public.audit_logs (owner_id, created_at desc);

create or replace function public.log_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o uuid; rid text; ch jsonb := '{}'::jsonb; k text; nj jsonb; oj jsonb;
begin
  if tg_op = 'DELETE' then
    o := old.user_id; rid := old.id::text; ch := to_jsonb(old);
  elsif tg_op = 'INSERT' then
    o := new.user_id; rid := new.id::text; ch := to_jsonb(new);
  else
    o := new.user_id; rid := new.id::text;
    nj := to_jsonb(new); oj := to_jsonb(old);
    for k in select jsonb_object_keys(nj) loop
      if k not in ('updated_at','created_at') and (nj->k) is distinct from (oj->k) then
        ch := ch || jsonb_build_object(k, jsonb_build_array(oj->k, nj->k));
      end if;
    end loop;
  end if;
  insert into public.audit_logs (owner_id, actor_id, table_name, action, row_id, changed)
  values (o, auth.uid(), tg_table_name, tg_op, rid, ch);
  return coalesce(new, old);
end $$;

-- Trigger terpasang di: transactions, products, suppliers,
-- purchase_orders, stock_opnames, categories.
