-- ============================================================
-- Harness uji meninggalkan jejak di tabel BERSAMA — dan invariant
-- yang membuat kelalaian itu mustahil terulang diam-diam.
--
-- TEMUAN (audit relasi, 19 Sep 2026)
-- Dua baris audit_logs dengan owner_id menunjuk akun yang sudah tidak ada.
-- Bukan bug aplikasi: itu residu test_kolom_transaksi. Harness-nya membuat
-- baris `customers`, trigger audit mencatat INSERT dan DELETE-nya, lalu kedua
-- catatan itu TETAP TINGGAL setelah akun sintetisnya dihapus.
--
-- Sebabnya masuk akal dan memang disengaja: audit_logs, ai_activity_log,
-- app_events dan error_logs TIDAK punya FK cascade ke auth.users, karena jejak
-- audit harus bertahan justru ketika akunnya dihapus. Itu benar untuk data
-- sungguhan — dan persis yang membuat data UJI menumpuk di sana, sedikit demi
-- sedikit, setiap kali gerbang DB berjalan. Tabel yang tugasnya menjadi bukti
-- adalah tabel yang paling tidak boleh dikotori data karangan.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Pembersih bersama
-- ------------------------------------------------------------
create or replace function public.uji_bersihkan(p_uid uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- URUTANNYA PENTING, dan versi pertama fungsi ini salah.
  --
  -- Menghapus audit_logs LEBIH DULU tidak menyelesaikan apa pun: penghapusan
  -- akun di bawah memicu cascade ke customers, trigger audit menulis baris
  -- DELETE yang baru, dan baris itu lahir SETELAH pembersihan lewat. Residunya
  -- justru diciptakan oleh pembersihnya sendiri. Terbukti saat dicoba: sisa
  -- turun dari 2 jadi 1, bukan 0.
  --
  -- Akun dulu, jejaknya kemudian.
  delete from public.profiles where id = p_uid;
  delete from auth.users      where id = p_uid;

  delete from public.audit_logs      where owner_id = p_uid or actor_id = p_uid;
  delete from public.ai_activity_log where owner_id = p_uid or actor_id = p_uid;
  delete from public.app_events      where user_id = p_uid;
  delete from public.error_logs      where user_id = p_uid or workspace_id = p_uid;
end
$function$;

comment on function public.uji_bersihkan(uuid) is
  'Membersihkan SELURUH jejak satu akun uji sintetis. Akun dihapus lebih dulu, jejak di tabel bersama dihapus SETELAHNYA — karena cascade penghapusan akun itu sendiri memicu trigger audit yang menulis baris baru.';

-- ------------------------------------------------------------
-- 2. P11 — invariant "harness tidak meninggalkan apa pun"
-- ------------------------------------------------------------
--
-- Membersihkan tabel yang HARI INI diketahui bermasalah hanya menyelesaikan
-- hari ini. Trigger audit berikutnya akan dipasang di tabel lain oleh orang
-- yang tidak pernah membaca catatan ini, dan residunya kembali menumpuk tanpa
-- satu pun tanda.
--
-- Karena itu yang dipasang bukan daftar tabel, melainkan SAPUAN: setiap tabel
-- public yang punya kolom uuid bernama user_id / owner_id / actor_id /
-- workspace_id / holder_id / admin_id ikut diperiksa, termasuk tabel yang
-- belum ada saat baris ini ditulis.
create or replace function public.test_sisa_harness()
returns table(suite text, kasus text, hasil text, lulus boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_n bigint;
  v_sisa text := '';
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and format_type(a.atttypid, null) = 'uuid'
  loop
    execute format(
      'select count(*) from public.%I where user_id::text like ''dbdbdbdb-%%''', r.relname)
      into v_n;
    if v_n > 0 then v_sisa := v_sisa || r.relname || '(' || v_n || ') '; end if;
  end loop;

  -- Tabel bersama memakai owner_id/actor_id, bukan user_id, dan sengaja tidak
  -- ikut cascade saat akun dihapus — justru di sinilah residu paling mungkin
  -- tertinggal tanpa ada yang menyadarinya.
  for r in
    select c.relname, a.attname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and a.attname in ('owner_id', 'actor_id', 'workspace_id', 'holder_id', 'admin_id')
      and format_type(a.atttypid, null) = 'uuid'
  loop
    execute format(
      'select count(*) from public.%I where %I::text like ''dbdbdbdb-%%''', r.relname, r.attname)
      into v_n;
    if v_n > 0 then v_sisa := v_sisa || r.relname || '.' || r.attname || '(' || v_n || ') '; end if;
  end loop;

  select count(*) into v_n from auth.users where id::text like 'dbdbdbdb-%';
  if v_n > 0 then v_sisa := v_sisa || 'auth.users(' || v_n || ') '; end if;

  return query select * from public.uji_kasus('sisa_harness',
    'P11 harness tidak meninggalkan satu baris pun',
    'tidak ada sisa',
    case when v_sisa = '' then 'tidak ada sisa' else 'TERTINGGAL: ' || btrim(v_sisa) end);
  return;
end
$function$;

comment on function public.test_sisa_harness() is
  'Menyapu SETIAP tabel public untuk baris milik akun uji sintetis (dbdbdbdb-%). Dijalankan PALING AKHIR di test_semua, setelah semua harness selesai.';

-- ------------------------------------------------------------
-- 3. test_kolom_transaksi memakai pembersih bersama
-- ------------------------------------------------------------
create or replace function public.test_kolom_transaksi()
returns table(suite text, kasus text, hasil text, lulus boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid  uuid := 'dbdbdbdb-0000-4000-8000-000000000004';
  v_cust uuid;
  v_hasil jsonb;
  v_tx   uuid;
  r      record;
  v_hilang text := '';
begin
  perform public.uji_bersihkan(v_uid);
  insert into auth.users (id, email) values (v_uid, 'uji-kolom@contoh.invalid');
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  insert into public.customers (user_id, name) values (v_uid, 'UJI Pelanggan')
  returning id into v_cust;

  v_hasil := public.add_transaction_with_stock(
    jsonb_build_object(
      'description','UJI kolom lengkap',
      'amount', 12345,
      'direction','out',
      'channel','struk',
      'receipt_url','uji/struk.jpg',
      'source_ref','struk.jpg',
      'customer_id', v_cust,
      'raw','teks mentah',
      'import_confidence','tinggi'),
    '[]'::jsonb, v_uid);
  v_tx := (v_hasil->'txn'->>'id')::uuid;

  select * into r from public.transactions where id = v_tx;

  if r.receipt_url       is distinct from 'uji/struk.jpg' then v_hilang := v_hilang || 'receipt_url '; end if;
  if r.source_ref        is distinct from 'struk.jpg'     then v_hilang := v_hilang || 'source_ref '; end if;
  if r.customer_id       is distinct from v_cust          then v_hilang := v_hilang || 'customer_id '; end if;
  if r.raw               is distinct from 'teks mentah'   then v_hilang := v_hilang || 'raw '; end if;
  if r.import_confidence is distinct from 'tinggi'        then v_hilang := v_hilang || 'import_confidence '; end if;

  return query select * from public.uji_kasus('kolom_transaksi',
    'P10 receipt_url/source_ref/customer_id/raw/import_confidence ikut tersimpan',
    'semua tersimpan',
    case when v_hilang = '' then 'semua tersimpan' else 'DIBUANG: ' || btrim(v_hilang) end);

  perform public.uji_bersihkan(v_uid);
  return;

exception when others then
  return query select * from public.uji_kasus('kolom_transaksi',
    'harness kolom gagal sebelum selesai', 'tanpa error', sqlstate || ' ' || sqlerrm);
  perform public.uji_bersihkan(v_uid);
  return;
end
$function$;

-- ------------------------------------------------------------
-- 4. test_semua memanggil P11 PALING AKHIR
-- ------------------------------------------------------------
create or replace function public.test_semua()
returns table(suite text, kasus text, hasil text, lulus boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_n bigint;
begin
  return query select * from public.test_bom();
  return query select * from public.test_pembatalan();
  return query select * from public.test_kolom_transaksi();

  select count(*) into v_n from public.rls_lint();
  if v_n = 0 then
    return query select * from public.uji_kasus('rls_lint',
      'tidak ada baris yang bocor lintas pengguna', '0 pelanggaran', '0 pelanggaran');
  else
    for r in select * from public.rls_lint() loop
      return query select * from public.uji_kasus('rls_lint',
        r.invarian || ' @ ' || r.objek, 'tidak ada pelanggaran', r.detail);
    end loop;
  end if;

  select count(*) into v_n from public.tenancy_lint();
  if v_n = 0 then
    return query select * from public.uji_kasus('tenancy_lint',
      'isolasi workspace utuh', '0 pelanggaran', '0 pelanggaran');
  else
    for r in select * from public.tenancy_lint() loop
      return query select * from public.uji_kasus('tenancy_lint',
        r.invarian || ' @ ' || r.objek, 'tidak ada pelanggaran', r.detail);
    end loop;
  end if;

  -- PALING AKHIR, dan itu disengaja: ia memeriksa sisa yang ditinggalkan
  -- harness DI ATASNYA. Menaruhnya lebih awal akan membuatnya selalu hijau.
  return query select * from public.test_sisa_harness();
  return;
end
$function$;
