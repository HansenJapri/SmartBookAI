-- ============================================================
-- MIGRASI AUTH — jalankan SETELAH schema.sql
-- Supabase Dashboard → SQL Editor → New query → tempel → Run
-- Menambah: nomor telepon unik, status verifikasi, & fungsi cek ketersediaan.
-- ============================================================

-- 1) Kolom telepon & status verifikasi pada profil
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists phone_verified boolean not null default false;

-- Unik: 1 nomor telepon hanya untuk 1 akun (NULL boleh banyak)
create unique index if not exists profiles_phone_unique on public.profiles (phone) where phone is not null;

-- 2) Update trigger pembuatan profil agar ikut menyimpan telepon
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, business_name, owner_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'business_name', 'Usaha Saya'),
    coalesce(new.raw_user_meta_data->>'owner_name', ''),
    nullif(new.raw_user_meta_data->>'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 3) Fungsi cek ketersediaan email & telepon (dipakai sebelum daftar)
--    SECURITY DEFINER agar bisa dipanggil tamu (anon) tanpa membuka data orang lain.
create or replace function public.check_phone_available(p_phone text)
returns boolean language sql security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where phone = p_phone);
$$;

create or replace function public.check_email_available(p_email text)
returns boolean language sql security definer set search_path = public as $$
  select not exists (select 1 from auth.users where lower(email) = lower(p_email));
$$;

grant execute on function public.check_phone_available(text) to anon, authenticated;
grant execute on function public.check_email_available(text) to anon, authenticated;
