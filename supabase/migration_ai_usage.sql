-- ============================================================
-- MIGRASI BATAS PEMAKAIAN AI (kontrol biaya)
-- Membatasi jumlah pemanggilan AI per akun per hari, agar biaya layanan AI
-- tidak membengkak karena pemakaian berlebih. Aman diulang.
-- Jalankan, lalu DEPLOY ULANG Edge Function ai (BukuPencatatan) & ai-struk
-- (BukuPencatatanStruk) yang sudah memanggil bump_ai_usage.
-- ============================================================

create table if not exists public.ai_usage (
  user_id uuid not null default auth.uid(),
  day     date not null default (now() at time zone 'utc')::date,
  kind    text not null,                    -- 'chat' atau 'struk'
  count   int  not null default 0,
  primary key (user_id, day, kind)
);

alter table public.ai_usage enable row level security;

-- Pengguna boleh melihat pemakaiannya sendiri (transparansi). Penulisan hanya
-- lewat RPC SECURITY DEFINER di bawah, bukan langsung dari klien.
drop policy if exists "ai_usage select own" on public.ai_usage;
create policy "ai_usage select own" on public.ai_usage
  for select to authenticated using (user_id = auth.uid());

-- Menaikkan penghitung pemakaian hari ini lalu mengembalikan apakah MASIH dalam
-- batas. true = boleh lanjut, false = melebihi batas harian.
create or replace function public.bump_ai_usage(p_kind text, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
  newcount int;
begin
  if uid is null then return false; end if;
  insert into public.ai_usage (user_id, day, kind, count)
  values (uid, today, p_kind, 1)
  on conflict (user_id, day, kind)
  do update set count = public.ai_usage.count + 1
  returning count into newcount;
  return newcount <= p_limit;
end;
$$;

revoke all on function public.bump_ai_usage(text, int) from public;
grant execute on function public.bump_ai_usage(text, int) to authenticated;

-- ============================================================
-- SELESAI.
-- ============================================================
