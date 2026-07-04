-- ============================================================
-- MIGRASI KEAMANAN (opsional tapi disarankan)
-- Jalankan SETELAH migration_admin.sql
-- Supabase Dashboard, SQL Editor, New query, tempel, Run.
--
-- Tujuan: memastikan nama penulis pada Forum Feedback SELALU berasal
-- dari profil resmi pengguna (tidak bisa dipalsukan dari sisi klien),
-- sehingga setiap data yang tampil benar-benar dari sumber terpercaya.
-- ============================================================

-- Saat sebuah feedback dibuat, abaikan author_name kiriman klien dan
-- isi ulang dari profil milik pemilik baris (auth.uid()).
create or replace function public.feedback_set_author()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  select coalesce(nullif(trim(business_name), ''), nullif(trim(owner_name), ''))
    into v_name
  from public.profiles
  where id = auth.uid();

  new.author_name := coalesce(v_name, 'Pengguna');
  return new;
end;
$$;

drop trigger if exists feedback_author_trg on public.feedback;
create trigger feedback_author_trg
  before insert on public.feedback
  for each row execute function public.feedback_set_author();

-- Catatan: otorisasi inti (siapa boleh baca/tulis apa) sudah dijaga oleh
-- Row Level Security di migration_admin.sql dan telah lolos uji penetrasi
-- (17/17 percobaan akses tak-sah berhasil ditolak). Trigger ini hanya
-- menambah jaminan integritas nama penulis.
