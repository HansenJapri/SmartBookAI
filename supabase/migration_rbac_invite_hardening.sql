-- ============================================================
-- PENGERASAN RBAC UNDANGAN STAF
-- Menutup tiga lubang pada migrasi `rbac_audit_fase3`:
--
-- 1. KEBOCORAN BACA. Policy `sm_member_select` mengizinkan siapa pun membaca
--    SEMUA kolom baris staff_members yang emailnya sama dengan email JWT-nya.
--    Halaman "Pengguna & Akses" (fetchStaff) memanggil select('*') tanpa filter
--    owner_id, sehingga baris undangan milik workspace ORANG LAIN muncul di
--    tabel pengelolaan staf si penerima undangan — lengkap dengan tombol
--    Cabut/Ubah/Hapus. Di sini email-match dicabut; undangan yang menunggu
--    dibaca lewat RPC yang hanya memaparkan kolom aman.
--
-- 2. PRIVILEGE ESCALATION. Policy `sm_member_claim` mengizinkan UPDATE oleh
--    calon staf dengan WITH CHECK hanya `member_id = auth.uid()` — kolom lain
--    tidak divalidasi. Artinya penerima undangan bisa menaikkan `modules`
--    dirinya sendiri (mis. menambahkan 'hr') sambil mengklaim undangan, atau
--    men-'active'-kan dirinya tanpa melewati alur terima. Policy dicabut;
--    penerimaan undangan dipindah ke RPC yang HANYA menulis member_id+status.
--
-- 3. SELF-INVITE. Tidak ada yang mencegah owner mengundang emailnya sendiri,
--    menghasilkan baris rancu (owner sekaligus calon staf). Dicegah trigger.
--
-- Setelah migrasi ini, satu-satunya jalur tulis bagi calon staf ke
-- staff_members adalah accept_invitation() / decline_invitation(). Semua
-- UPDATE/DELETE lain owner-only, dijaga policy DAN filter owner_id di klien.
-- ============================================================

-- ---------- 0. Kolom penolakan undangan ----------
-- Sebelumnya penolakan hanya disimpan di localStorage browser, jadi sekali
-- staf menekan "Nanti" undangan hilang selamanya tanpa cara memunculkannya
-- kembali. Sekarang penolakan tercatat di server dan owner bisa melihatnya.
alter table public.staff_members
  add column if not exists declined_at timestamptz;

-- ---------- 1. Cabut policy yang bocor ----------
drop policy if exists "sm_member_select" on public.staff_members;
drop policy if exists "sm_member_claim" on public.staff_members;

-- Staf hanya boleh membaca baris keanggotaannya SENDIRI yang sudah diklaim.
-- Undangan yang belum diklaim (member_id masih null) TIDAK terbaca lewat
-- tabel — hanya lewat RPC my_pending_invitations() di bawah.
create policy "sm_member_select" on public.staff_members for select
  using (member_id = auth.uid());

-- Catatan: policy `sm_owner_all` dari migrasi fase 3 tetap berlaku dan kini
-- menjadi SATU-SATUNYA jalur tulis langsung ke tabel (owner_id = auth.uid()).

-- ---------- 2. Cegah owner mengundang dirinya sendiri ----------
create or replace function public.staff_members_guard() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare owner_email text;
begin
  new.email := lower(trim(new.email));
  select u.email into owner_email from auth.users u where u.id = new.owner_id;
  if owner_email is not null and new.email = lower(owner_email) then
    raise exception 'Tidak bisa mengundang email Anda sendiri sebagai staf'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_staff_members_guard on public.staff_members;
create trigger trg_staff_members_guard
  before insert or update of email on public.staff_members
  for each row execute function public.staff_members_guard();

-- ---------- 3. Baca undangan yang menunggu (kolom aman saja) ----------
-- Dipanggil calon staf. Mengembalikan HANYA yang dibutuhkan kartu undangan:
-- id, siapa pengundangnya, dan modul yang ditawarkan. Tidak memaparkan baris
-- staf lain di workspace itu, tidak memaparkan member_id maupun role.
create or replace function public.my_pending_invitations()
returns table (
  id uuid,
  owner_id uuid,
  business_name text,
  owner_email text,
  modules text[],
  created_at timestamptz
)
language sql stable security definer set search_path = public, auth as $$
  select m.id, m.owner_id,
         coalesce(nullif(trim(p.business_name), ''), 'Usaha tanpa nama') as business_name,
         u.email::text as owner_email,
         m.modules, m.created_at
  from public.staff_members m
  left join public.profiles p on p.id = m.owner_id
  left join auth.users u on u.id = m.owner_id
  where m.member_id is null
    and m.status = 'invited'
    and m.declined_at is null
    and auth.uid() is not null
    and lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  order by m.created_at desc;
$$;

revoke all on function public.my_pending_invitations() from public;
grant execute on function public.my_pending_invitations() to authenticated;

-- ---------- 4. Daftar workspace yang bisa dibuka staf ----------
-- Menggantikan query tabel di klien supaya nama usaha ikut terbawa tanpa
-- bergantung pada policy SELECT di `profiles`.
create or replace function public.my_workspaces()
returns table (
  id uuid,
  owner_id uuid,
  business_name text,
  owner_email text,
  modules text[],
  role text
)
language sql stable security definer set search_path = public, auth as $$
  select m.id, m.owner_id,
         coalesce(nullif(trim(p.business_name), ''), 'Usaha tanpa nama') as business_name,
         u.email::text as owner_email,
         m.modules, m.role
  from public.staff_members m
  left join public.profiles p on p.id = m.owner_id
  left join auth.users u on u.id = m.owner_id
  where m.member_id = auth.uid()
    and m.status = 'active'
  order by 3 nulls last;
$$;

revoke all on function public.my_workspaces() from public;
grant execute on function public.my_workspaces() to authenticated;

-- ---------- 5. Terima undangan (satu-satunya jalur klaim) ----------
-- HANYA menulis member_id dan status. `modules`, `role`, `owner_id`, dan
-- `email` tidak bisa disentuh calon staf lewat jalur ini — itulah inti
-- perbaikan privilege escalation. Idempoten: memanggil dua kali tidak error
-- selama baris sudah menjadi milik pemanggil.
create or replace function public.accept_invitation(p_invite_id uuid)
returns table (
  id uuid,
  owner_id uuid,
  business_name text,
  modules text[],
  role text
)
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_uid uuid := auth.uid();
  v_row public.staff_members;
begin
  if v_uid is null or v_email = '' then
    raise exception 'Harus masuk (login) untuk menerima undangan'
      using errcode = 'insufficient_privilege';
  end if;

  -- Kunci baris agar dua tab/perangkat tidak mengklaim bersamaan.
  select * into v_row from public.staff_members m
   where m.id = p_invite_id and lower(m.email) = v_email
   for update;

  if v_row.id is null then
    raise exception 'Undangan tidak ditemukan atau bukan untuk email Anda'
      using errcode = 'no_data_found';
  end if;

  if v_row.status = 'revoked' then
    raise exception 'Undangan ini sudah dicabut oleh pemilik usaha'
      using errcode = 'insufficient_privilege';
  end if;

  if v_row.member_id is not null and v_row.member_id <> v_uid then
    raise exception 'Undangan ini sudah diklaim akun lain'
      using errcode = 'insufficient_privilege';
  end if;

  update public.staff_members m
     set member_id = v_uid, status = 'active', declined_at = null
   where m.id = p_invite_id;

  return query
    select m.id, m.owner_id,
           coalesce(nullif(trim(p.business_name), ''), 'Usaha tanpa nama') as business_name,
           m.modules, m.role
    from public.staff_members m
    left join public.profiles p on p.id = m.owner_id
    where m.id = p_invite_id;
end $$;

revoke all on function public.accept_invitation(uuid) from public;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- ---------- 6. Tolak undangan ----------
-- Owner tetap melihat barisnya (dengan penanda ditolak) dan bisa mengundang
-- ulang dengan mengosongkan declined_at.
create or replace function public.decline_invitation(p_invite_id uuid)
returns boolean
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_n int;
begin
  if auth.uid() is null or v_email = '' then
    raise exception 'Harus masuk (login)' using errcode = 'insufficient_privilege';
  end if;
  update public.staff_members m
     set declined_at = now()
   where m.id = p_invite_id
     and lower(m.email) = v_email
     and m.member_id is null
     and m.status = 'invited';
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

revoke all on function public.decline_invitation(uuid) from public;
grant execute on function public.decline_invitation(uuid) to authenticated;

-- ---------- 7. Indeks pendukung ----------
create index if not exists idx_staff_members_email_lower
  on public.staff_members (lower(email));
create index if not exists idx_staff_members_member_status
  on public.staff_members (member_id, status);
