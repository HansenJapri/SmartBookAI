-- ============================================================
-- PENGGUNA & AKSES: KOLOM NAMA + PENGUNCIAN PERAN
-- Jalankan SETELAH migration_rbac_invite_hardening.sql. Aman diulang.
--
-- 1) `name` — halaman Pengguna & Akses kini menampilkan Nama Pengguna, bukan
--    email. Undangan tetap berbasis email (itu satu-satunya identitas yang ada
--    sebelum staf mendaftar), tetapi alamatnya tidak lagi dipampang di tabel.
-- 2) CHECK pada `role` — kolomnya sudah ada sejak fase 3 TANPA batasan nilai
--    apa pun, jadi insert yang dibuat tangan bisa menuliskan role = 'owner'.
--    Belum ada kode yang membaca role untuk otorisasi (status owner ditentukan
--    dari workspace yang dibuka, lihat isOwnerView di src/lib/rbac.js), jadi
--    ini menutup celah sebelum sempat dipakai — bukan menambal celah aktif.
-- ============================================================

-- 1) Nama pengguna. Boleh kosong: baris lama tidak punya nama dan UI jatuh
--    kembali ke bagian lokal email (staffDisplayName di src/lib/rbac.js).
alter table public.staff_members add column if not exists name text;

-- Batasi panjang agar sejalan dengan STAFF_NAME_MAX di src/lib/api.js.
alter table public.staff_members drop constraint if exists staff_members_name_len_check;
alter table public.staff_members add constraint staff_members_name_len_check
  check (name is null or char_length(name) <= 60);

-- 2) Kunci nilai `role`. 'owner' sengaja TIDAK ada dalam daftar: kepemilikan
--    berasal dari staff_members.owner_id, bukan dari baris keanggotaan.
update public.staff_members set role = 'staf' where role is null or role not in ('staf');
alter table public.staff_members drop constraint if exists staff_members_role_check;
alter table public.staff_members add constraint staff_members_role_check
  check (role in ('staf'));

-- 3) Trigger penjaga: `name` hanya boleh ditulis oleh owner baris tersebut.
--    Policy sm_member_select hanya memberi staf hak SELECT, jadi ini terutama
--    pertahanan berlapis bila kelak ada policy UPDATE untuk anggota
--    (mis. accept_invitation) yang tidak sengaja kebablasan.
create or replace function public.staff_members_name_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.name is distinct from old.name
     and old.owner_id <> auth.uid() then
    raise exception 'Hanya pemilik usaha yang boleh mengubah nama pengguna.';
  end if;
  return new;
end $$;

drop trigger if exists trg_staff_members_name_guard on public.staff_members;
create trigger trg_staff_members_name_guard
  before update of name on public.staff_members
  for each row execute function public.staff_members_name_guard();
