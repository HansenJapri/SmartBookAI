-- ============================================================
-- MIGRASI PERSETUJUAN (CONSENT) - jalankan SETELAH migration_admin.sql
-- Supabase Dashboard, SQL Editor, New query, tempel, Run.
--
-- Tujuan: menyimpan bukti persetujuan Syarat & Ketentuan dan Kebijakan
-- Privasi secara permanen pada profil pengguna (bukan hanya di perangkat).
-- Ini menjadi catatan persetujuan elektronik yang sah sebagai alat bukti
-- sesuai UU ITE dan dasar pemrosesan data pribadi sesuai UU PDP No. 27/2022.
--
-- Menambah:
--   1) Kolom persetujuan pada profiles (status, waktu, versi)
--   2) Pembaruan trigger handle_new_user (menyalin persetujuan saat daftar)
--   3) RPC accept_terms() untuk mencatat persetujuan di dalam aplikasi
--      dengan stempel waktu dari server (tidak bisa dipalsukan klien)
--   4) Pengisian ulang (backfill) data persetujuan akun lama dari metadata
--   5) Pembaruan admin_list_users() agar status persetujuan terlihat admin
-- ============================================================

-- ------------------------------------------------------------
-- 1) KOLOM PERSETUJUAN PADA PROFIL
--    accepted_terms      : sudah menyetujui Syarat & Ketentuan
--    accepted_privacy    : sudah menyetujui Kebijakan Privasi
--    *_at                : stempel waktu persetujuan (dari server)
--    terms_version       : versi dokumen yang disetujui (mis. "v2")
-- ------------------------------------------------------------
alter table public.profiles add column if not exists accepted_terms      boolean not null default false;
alter table public.profiles add column if not exists accepted_terms_at    timestamptz;
alter table public.profiles add column if not exists accepted_privacy     boolean not null default false;
alter table public.profiles add column if not exists accepted_privacy_at  timestamptz;
alter table public.profiles add column if not exists terms_version        text;

-- ------------------------------------------------------------
-- 2) TRIGGER PEMBUATAN PROFIL: ikut menyimpan persetujuan saat daftar.
--    Saat mendaftar, pengguna mencentang persetujuan, lalu nilai itu
--    dikirim di metadata akun. Trigger menyalinnya ke profil.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_accepted boolean := coalesce((new.raw_user_meta_data->>'accepted_terms')::boolean, false);
  v_at       timestamptz := coalesce((new.raw_user_meta_data->>'accepted_terms_at')::timestamptz, now());
begin
  insert into public.profiles (
    id, business_name, owner_name, phone,
    accepted_terms, accepted_terms_at,
    accepted_privacy, accepted_privacy_at,
    terms_version
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'business_name', 'Usaha Saya'),
    coalesce(new.raw_user_meta_data->>'owner_name', ''),
    nullif(new.raw_user_meta_data->>'phone', ''),
    v_accepted, case when v_accepted then v_at end,
    v_accepted, case when v_accepted then v_at end,
    new.raw_user_meta_data->>'terms_version'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 3) RPC accept_terms(): mencatat persetujuan dari dalam aplikasi.
--    Penting: stempel waktu diambil dari server (now()), bukan dari
--    perangkat pengguna, sehingga catatan persetujuan tidak bisa
--    dimanipulasi waktunya dari sisi klien. Fungsi hanya memengaruhi
--    baris milik pengguna yang sedang login (auth.uid()).
-- ------------------------------------------------------------
create or replace function public.accept_terms(p_version text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Harus masuk (login) untuk menyetujui.';
  end if;
  if p_version is null or char_length(p_version) > 20 then
    raise exception 'Versi ketentuan tidak valid.';
  end if;

  update public.profiles set
    accepted_terms      = true,
    accepted_terms_at   = now(),
    accepted_privacy    = true,
    accepted_privacy_at = now(),
    terms_version       = p_version
  where id = auth.uid();
end;
$$;

grant execute on function public.accept_terms(text) to authenticated;

-- ------------------------------------------------------------
-- 4) BACKFILL: akun lama yang sudah menyetujui saat daftar (tersimpan di
--    metadata) ditandai sudah setuju pada kolom profil yang baru ini.
--    Akun yang belum punya catatan persetujuan dibiarkan "belum" sehingga
--    akan diminta menyetujui di dalam aplikasi.
-- ------------------------------------------------------------
update public.profiles p set
  accepted_terms      = true,
  accepted_terms_at   = coalesce((u.raw_user_meta_data->>'accepted_terms_at')::timestamptz, u.created_at),
  accepted_privacy    = true,
  accepted_privacy_at = coalesce((u.raw_user_meta_data->>'accepted_terms_at')::timestamptz, u.created_at),
  terms_version       = coalesce(u.raw_user_meta_data->>'terms_version', 'v1')
from auth.users u
where u.id = p.id
  and coalesce((u.raw_user_meta_data->>'accepted_terms')::boolean, false) = true
  and p.accepted_terms is not true;

-- ------------------------------------------------------------
-- 5) admin_list_users(): tambahkan status persetujuan agar admin bisa
--    melihat siapa yang sudah/belum menekan tombol setuju.
--    (Definisi diulang penuh karena tipe kembalian berubah.)
-- ------------------------------------------------------------
drop function if exists public.admin_list_users();
create or replace function public.admin_list_users()
returns table (
  id                  uuid,
  email               text,
  business_name       text,
  owner_name          text,
  business_type       text,
  phone               text,
  taxpayer_type       text,
  created_at          timestamptz,
  accepted_terms      boolean,
  accepted_terms_at   timestamptz,
  terms_version       text,
  tx_count            bigint,
  tx_volume           numeric,
  last_activity       timestamptz,
  feedback_count      bigint
)
language sql stable security definer set search_path = public as $$
  select
    p.id, u.email, p.business_name, p.owner_name, p.business_type,
    p.phone, p.taxpayer_type, p.created_at,
    coalesce(p.accepted_terms, false) as accepted_terms,
    p.accepted_terms_at,
    p.terms_version,
    coalesce(t.cnt, 0)   as tx_count,
    coalesce(t.vol, 0)   as tx_volume,
    t.last_at            as last_activity,
    coalesce(f.cnt, 0)   as feedback_count
  from public.profiles p
  join auth.users u on u.id = p.id
  left join (
    select user_id, count(*) cnt, sum(amount) vol, max(occurred_at) last_at
    from public.transactions group by user_id
  ) t on t.user_id = p.id
  left join (
    select user_id, count(*) cnt from public.feedback group by user_id
  ) f on f.user_id = p.id
  where public.is_admin()           -- non-admin tidak mendapat baris apa pun
  order by p.created_at desc;
$$;

grant execute on function public.admin_list_users() to authenticated;

-- ============================================================
-- SELESAI. Setelah dijalankan:
--   - Pengguna baru: persetujuan tercatat otomatis saat daftar.
--   - Pengguna lama tanpa catatan: diminta menyetujui sekali di aplikasi.
-- ============================================================
