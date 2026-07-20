-- ============================================================
-- PEMBERSIHAN AKUN TESTER (pra-produksi)
-- Jalankan di: Supabase Dashboard -> SQL Editor -> Run
-- Menghapus SEMUA data milik tester@bukupintar.local dari tabel
-- publik (user_id/owner_id), lalu akun auth-nya.
-- Aman diulang (idempoten); tidak menyentuh akun lain.
-- Setelah sukses, file ini boleh dihapus.
-- ============================================================
do $$
declare
  uid uuid;
  r record;
  pass int;
  failed int;
begin
  select id into uid from auth.users where email = 'tester@bukupintar.local';
  if uid is null then
    raise notice 'Akun tester tidak ditemukan - tidak ada yang dihapus.';
    return;
  end if;

  -- Multi-pass: tabel anak dengan FK RESTRICT sukses di pass berikutnya.
  for pass in 1..5 loop
    failed := 0;
    for r in
      select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = 'public' and t.table_name = c.table_name
       and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.column_name in ('user_id', 'owner_id')
    loop
      begin
        execute format('delete from public.%I where %I = $1', r.table_name, r.column_name) using uid;
      exception when others then
        failed := failed + 1;
      end;
    end loop;
    exit when failed = 0;
  end loop;

  delete from auth.users where id = uid;
  raise notice 'Akun tester & seluruh datanya terhapus.';
end $$;

-- Verifikasi (harus 0 baris):
select 'auth' as sisa, count(*) from auth.users where email = 'tester@bukupintar.local';
