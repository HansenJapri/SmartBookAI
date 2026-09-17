-- ============================================================
-- KESIAPAN LAPOR 72 JAM (UU PDP) + PENGHAPUSAN AKUN YANG BERJEJAK
--
-- Jalankan SETELAH migration_admin.sql, migration_audit.sql, dan
-- migration_audit_ai.sql. Aman diulang (idempotent).
--
-- ------------------------------------------------------------
-- KEWAJIBAN YANG DIJAWAB
-- ------------------------------------------------------------
-- UU 27/2022 Pasal 46: bila terjadi kegagalan pelindungan data pribadi,
-- pengendali wajib memberitahukan secara tertulis kepada Subjek Data Pribadi
-- DAN kepada lembaga, paling lambat 3x24 jam. Pemberitahuannya harus memuat
-- data pribadi apa yang terungkap, kapan dan bagaimana, serta upaya
-- penanganannya.
--
-- Tiga hal yang tidak dipunyai sistem ini sebelum migrasi ini, dan ketiganya
-- adalah yang menentukan apakah tenggat itu bisa dipenuhi:
--
--   1. TIDAK ADA JAM NOL. "3x24 jam sejak diketahui" butuh satu momen tercatat
--      resmi. Tanpa itu, yang tersisa saat audit adalah perdebatan tentang
--      kapan sebenarnya tim "tahu" — dan perdebatan itu selalu dimenangkan
--      oleh pihak yang memegang catatan.
--
--   2. KORBAN TIDAK BISA DIDAFTAR CEPAT. Jejak aktivitas memang ada
--      (app_events, audit_logs, ai_activity_log), tapi tersebar di tiga tabel
--      dengan nama kolom pemilik yang berbeda-beda (user_id vs owner_id).
--      Menyusun daftar "siapa saja yang datanya tersentuh antara pukul sekian
--      dan sekian" berarti menulis SQL gabungan dengan tangan — di tengah
--      insiden, di bawah tekanan, dengan tenggat berjalan.
--
--   3. PENGHAPUSAN AKUN MENGHAPUS BUKTINYA SENDIRI. admin_delete_user() lama
--      memanggil `delete from auth.users`, dan cascade ikut membawa seluruh
--      app_events milik akun itu. Kalau sebuah akun dihapus sehari sebelum
--      kebocoran ketahuan, tidak ada lagi cara mengetahui bahwa ia termasuk
--      terdampak — atau bahkan bahwa ia pernah ada.
--
-- ------------------------------------------------------------
-- BATAS KEJUJURAN
-- ------------------------------------------------------------
-- Migrasi ini membuat pelaporan 72 jam MUNGKIN DILAKUKAN; ia tidak membuatnya
-- otomatis, dan tidak mendeteksi kebocoran. Deteksi tetap pekerjaan manusia
-- dan pemantauan. Yang dijamin di sini hanya: begitu ada yang menyadari,
-- jam nol tercatat, hitungan mundurnya terlihat, dan daftar korbannya bisa
-- ditarik dalam hitungan detik, bukan hari.
-- ============================================================

-- pgcrypto dibutuhkan untuk digest(): sidik email akun yang dihapus.
-- `if not exists` berarti pemasangan yang sudah ada — di skema mana pun —
-- dibiarkan apa adanya; pemanggilannya di bawah sengaja tanpa kualifikasi
-- skema supaya keduanya sama-sama bekerja.
create extension if not exists pgcrypto;

-- ============================================================
-- BAGIAN A — NISAN AKUN: penghapusan yang meninggalkan jejak
-- ============================================================

-- Baris di sini sengaja PSEUDONIM, dan itu bukan setengah hati.
--
-- Hak penghapusan (Pasal 8 UU PDP) dan kewajiban jejak audit saling menarik ke
-- arah berlawanan. Menyimpan email asli akun yang sudah dihapus berarti
-- penghapusannya tidak pernah benar-benar terjadi. Tidak menyimpan apa pun
-- berarti akun itu lenyap dari sejarah, dan pertanyaan "apakah akun yang
-- dihapus Selasa lalu termasuk terdampak?" tidak bisa dijawab siapa pun.
--
-- Jalan tengahnya: simpan SIDIK email (sha256), bukan emailnya. Sidik itu
-- cukup untuk MENCOCOKKAN — bila kelak muncul dump data berisi alamat email,
-- kita bisa membuktikan apakah alamat itu pernah terdaftar di sini — tapi
-- tidak cukup untuk MENGHUBUNGI atau memasarkan. Topeng emailnya disimpan
-- terpisah, hanya sebanyak yang dibutuhkan manusia untuk mengenali baris mana
-- yang sedang dibicarakan di ruang rapat.
--
-- Nama pemilik dan nomor telepon TIDAK disimpan sama sekali.
create table if not exists public.deleted_accounts (
  id                 bigint generated always as identity primary key,
  -- TANPA foreign key, dan itu justru inti tabelnya: barisnya harus hidup
  -- lebih lama daripada akun yang diacunya.
  user_id            uuid not null,
  email_hash         text not null,
  email_mask         text,
  business_type      text,
  account_created_at timestamptz,
  deleted_by         uuid not null,
  reason             text not null,
  -- Berapa baris per tabel yang ikut lenyap. Inilah yang menjawab
  -- "data pribadi jenis apa yang terdampak" di surat pemberitahuan, tanpa
  -- perlu menyimpan datanya.
  data_summary       jsonb not null default '{}'::jsonb,
  deleted_at         timestamptz not null default now()
);

alter table public.deleted_accounts enable row level security;

drop policy if exists "deleted accounts admin read" on public.deleted_accounts;
create policy "deleted accounts admin read" on public.deleted_accounts
  for select to authenticated using (public.is_admin());

-- Tanpa policy insert/update/delete: hanya ditulis oleh admin_delete_user().

create index if not exists idx_deleted_accounts_at   on public.deleted_accounts (deleted_at desc);
create index if not exists idx_deleted_accounts_hash on public.deleted_accounts (email_hash);

grant select on public.deleted_accounts to authenticated;

-- Topeng email: "andi.wijaya@gmail.com" → "an***ya@gmail.com".
-- Domain dibiarkan utuh karena ia bukan pengenal perorangan dan sering menjadi
-- petunjuk pertama saat menelusuri ("semuanya akun @sekolah tertentu").
create or replace function public.topeng_email(p_email text)
returns text
language sql
immutable
as $$
  select case
    when p_email is null or position('@' in p_email) = 0 then null
    else
      case when length(split_part(p_email, '@', 1)) <= 3
           then left(split_part(p_email, '@', 1), 1) || '***'
           else left(split_part(p_email, '@', 1), 2) || '***' || right(split_part(p_email, '@', 1), 2)
      end || '@' || split_part(p_email, '@', 2)
  end;
$$;

grant execute on function public.topeng_email(text) to authenticated;

-- Hitung baris milik seorang user pada satu tabel, apa pun nama kolom
-- pemiliknya, dan aman bila tabelnya belum ada di instalasi ini.
--
-- Dinamis karena daftar tabel berbeda antar tahap migrasi proyek ini, dan
-- fungsi penghapusan TIDAK BOLEH gagal hanya karena satu tabel opsional belum
-- pernah dibuat. Yang tidak ada dihitung 0, bukan dilempar sebagai error.
create or replace function public.hitung_baris_milik(
  p_table  text,
  p_kolom  text,
  p_uid    uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  n bigint := 0;
begin
  if to_regclass('public.' || p_table) is null then
    return 0;
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = p_table and column_name = p_kolom
  ) then
    return 0;
  end if;

  execute format('select count(*) from public.%I where %I = $1', p_table, p_kolom)
    into n using p_uid;
  return coalesce(n, 0);
exception when others then
  return 0;
end;
$$;

revoke all on function public.hitung_baris_milik(text, text, uuid) from public, authenticated;

-- ------------------------------------------------------------
-- admin_delete_user() — versi berjejak
-- ------------------------------------------------------------
--
-- Perbedaan dengan versi lama, semuanya disengaja:
--
--   • ALASAN WAJIB. Penghapusan permanen lintas-tabel adalah tindakan yang
--     tidak bisa dibatalkan; ia harus bisa dijelaskan berbulan-bulan kemudian
--     kepada orang yang tidak ada di ruangan saat itu.
--   • NISAN DITULIS LEBIH DULU, di transaksi yang sama. Kalau pencatatannya
--     gagal, penghapusannya ikut batal — bukan sebaliknya.
--   • RINGKASAN DATA dihitung SEBELUM cascade, karena sesudahnya tidak ada
--     lagi yang bisa dihitung.
--   • JEJAK ADMIN ditulis di sini, bukan dari browser. admin_audit_log lama
--     diisi "fire-and-forget" dari sisi klien: bila tab tertutup di detik yang
--     salah, akunnya lenyap tanpa satu baris pun yang menyebutkannya.
--
-- Tanda tangannya menerima p_reason dengan DEFAULT null supaya pemanggil lama
-- tetap bisa dikompilasi — lalu ditolak saat dijalankan, dengan pesan yang
-- menjelaskan apa yang kurang. Gagal dengan penjelasan, bukan gagal diam-diam.
-- Versi lama (satu argumen) dihapus LEBIH DULU, bukan sesudahnya: selama
-- keduanya ada, panggilan admin_delete_user(uuid) menjadi ambigu dan gagal.
drop function if exists public.admin_delete_user(uuid);

create or replace function public.admin_delete_user(
  p_uid    uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  u_email   text;
  p_row     public.profiles%rowtype;
  ringkas   jsonb;
  alasan    text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Tidak diizinkan: bukan admin' using errcode = 'insufficient_privilege';
  end if;

  if alasan is null then
    raise exception 'Alasan penghapusan wajib diisi. Penghapusan akun bersifat permanen dan wajib dapat dipertanggungjawabkan (UU PDP Pasal 46).'
      using errcode = 'invalid_parameter_value';
  end if;
  if length(alasan) < 10 then
    raise exception 'Alasan terlalu pendek. Tulis minimal 10 karakter yang menjelaskan mengapa akun ini dihapus.'
      using errcode = 'invalid_parameter_value';
  end if;

  if exists (select 1 from public.admins where user_id = p_uid) then
    raise exception 'Akun admin tidak boleh dihapus' using errcode = 'insufficient_privilege';
  end if;

  select email into u_email from auth.users where id = p_uid;
  if u_email is null then
    raise exception 'Akun % tidak ditemukan', p_uid using errcode = 'no_data_found';
  end if;

  select * into p_row from public.profiles where id = p_uid;

  -- Dihitung SEBELUM penghapusan. Sesudahnya, angka-angka ini tidak ada lagi
  -- di mana pun — dan justru angka inilah isi surat pemberitahuan ke otoritas
  -- bila kelak akun ini termasuk terdampak insiden.
  ringkas := jsonb_build_object(
    'transactions',        public.hitung_baris_milik('transactions',        'user_id',  p_uid),
    'feedback',            public.hitung_baris_milik('feedback',            'user_id',  p_uid),
    'app_events',          public.hitung_baris_milik('app_events',          'user_id',  p_uid),
    'audit_logs',          public.hitung_baris_milik('audit_logs',          'owner_id', p_uid),
    'ai_activity_log',     public.hitung_baris_milik('ai_activity_log',     'owner_id', p_uid),
    'workspace_ai_usage',  public.hitung_baris_milik('workspace_ai_usage',  'workspace_id', p_uid),
    'staff_members',       public.hitung_baris_milik('staff_members',       'owner_id', p_uid),
    'products',            public.hitung_baris_milik('products',            'user_id',  p_uid),
    'customers',           public.hitung_baris_milik('customers',           'user_id',  p_uid),
    'employees',           public.hitung_baris_milik('employees',           'user_id',  p_uid)
  );

  insert into public.deleted_accounts
    (user_id, email_hash, email_mask, business_type, account_created_at,
     deleted_by, reason, data_summary)
  values
    (p_uid,
     encode(digest(lower(u_email), 'sha256'), 'hex'),
     public.topeng_email(u_email),
     p_row.business_type,
     p_row.created_at,
     auth.uid(),
     alasan,
     ringkas);

  -- Jejak admin ditulis di sisi server, bukan dititipkan ke browser.
  insert into public.admin_audit_log (admin_id, action, target_table, target_id, meta)
  values (auth.uid(), 'user_deleted', 'auth.users', p_uid::text,
          jsonb_build_object('reason', alasan, 'data_summary', ringkas));

  delete from auth.users where id = p_uid;  -- cascade ke seluruh data miliknya

  return jsonb_build_object(
    'user_id', p_uid,
    'email_mask', public.topeng_email(u_email),
    'data_summary', ringkas,
    'deleted_at', now()
  );
end;
$$;

grant execute on function public.admin_delete_user(uuid, text) to authenticated;

-- Catatan: versi satu-argumen sengaja TIDAK dihidupkan kembali. Membiarkannya
-- ada berarti menyisakan jalur penghapusan permanen yang tidak menulis nisan,
-- tidak meminta alasan, dan tidak tercatat di mana pun — persis lubang yang
-- ditutup migrasi ini. Klien lama yang masih memanggilnya harus gagal dengan
-- jelas, bukan berhasil diam-diam.

-- ============================================================
-- BAGIAN B — REGISTER INSIDEN & HITUNG MUNDUR 72 JAM
-- ============================================================

create table if not exists public.security_incidents (
  id              bigint generated always as identity primary key,
  ref             text not null unique,
  judul           text not null check (char_length(btrim(judul)) between 3 and 200),
  ringkasan       text not null check (char_length(btrim(ringkasan)) >= 10),
  kategori        text not null default 'kebocoran_data' check (kategori in (
                    'kebocoran_data', 'akses_tidak_sah', 'kehilangan_data',
                    'perubahan_tidak_sah', 'malware', 'lainnya')),
  tingkat         text not null default 'sedang' check (tingkat in ('rendah','sedang','tinggi','kritis')),

  -- Jendela kejadian: dipakai untuk MENDAFTAR KORBAN, bukan untuk menghitung
  -- tenggat. Sering baru diketahui belakangan dan boleh direvisi.
  terjadi_mulai   timestamptz,
  terjadi_sampai  timestamptz,

  -- JAM NOL. Tenggat 3x24 jam dihitung dari "saat diketahui", bukan saat
  -- terjadi maupun saat dicatat. Dibedakan dari created_at dengan sengaja:
  -- insiden yang terdeteksi Jumat malam dan baru dicatat Senin pagi tetap
  -- punya tenggat yang jatuh pada Senin malam, dan sistem harus menunjukkan
  -- itu apa adanya — bukan memberi kelonggaran tiga hari yang tidak ada.
  --
  -- batas_lapor adalah kolom BIASA yang diisi trigger, bukan kolom generated.
  -- Bukan pilihan gaya: PostgreSQL menolak `generated always as
  -- (diketahui_pada + interval '72 hours') stored` karena penjumlahan
  -- timestamptz dengan interval berstatus STABLE, bukan IMMUTABLE — hasilnya
  -- bergantung pada zona waktu sesi. Trigger di bawah menghasilkan jaminan
  -- yang sama (kolomnya tidak bisa diisi sembarangan dari luar) tanpa
  -- menabrak batasan itu.
  diketahui_pada  timestamptz not null,
  batas_lapor     timestamptz not null default now(),

  status          text not null default 'terbuka' check (status in (
                    'terbuka', 'investigasi', 'dilaporkan', 'selesai', 'bukan_insiden')),

  -- Siapa yang terdampak. 'aktivitas' = siapa pun yang datanya tersentuh pada
  -- jendela kejadian; 'semua' = seluruh pengguna terdaftar (dipakai saat
  -- cakupannya tidak bisa dipersempit, mis. basis data utuh yang terekspos);
  -- 'terpilih' = daftar yang ditentukan manual.
  lingkup         text not null default 'aktivitas' check (lingkup in ('aktivitas','semua','terpilih')),
  workspace_ids   uuid[],

  -- Jenis data pribadi yang terungkap. Ini isi wajib surat pemberitahuan,
  -- bukan hiasan: "data pribadi yang terungkap" adalah butir pertama Pasal 46.
  kategori_data   text[],

  jumlah_korban       int check (jumlah_korban is null or jumlah_korban >= 0),
  lapor_otoritas_pada timestamptz,
  lapor_otoritas_ref  text,
  lapor_korban_pada   timestamptz,
  tindakan            text,

  dibuat_oleh     uuid not null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Tenggat 72 jam dihitung ulang oleh database setiap kali barisnya ditulis,
-- dan nilai yang dikirim pemanggil selalu diabaikan. Tanpa ini, batas_lapor
-- hanyalah kolom biasa yang bisa diisi angka apa pun — dan tenggat hukum yang
-- bisa diketik sendiri bukan tenggat.
create or replace function public.insiden_hitung_batas()
returns trigger
language plpgsql
as $$
begin
  new.batas_lapor := new.diketahui_pada + interval '72 hours';
  return new;
end;
$$;

drop trigger if exists trg_insiden_batas on public.security_incidents;
create trigger trg_insiden_batas
  before insert or update on public.security_incidents
  for each row execute function public.insiden_hitung_batas();

alter table public.security_incidents enable row level security;

drop policy if exists "incidents admin read" on public.security_incidents;
create policy "incidents admin read" on public.security_incidents
  for select to authenticated using (public.is_admin());

-- Tanpa policy tulis: seluruh perubahan lewat RPC di bawah, yang mencatat
-- jejaknya ke admin_audit_log. Register insiden yang bisa disunting tanpa
-- jejak tidak bernilai sebagai bukti kepatuhan.

create index if not exists idx_insiden_batas  on public.security_incidents (batas_lapor);
create index if not exists idx_insiden_status on public.security_incidents (status, diketahui_pada desc);

grant select on public.security_incidents to authenticated;

-- Nomor rujukan: INS-2026-0007. Dipakai di surat ke otoritas dan di
-- korespondensi internal, jadi ia harus pendek, urut, dan tidak berulang.
create or replace function public.insiden_ref_baru()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'INS-' || to_char(now(), 'YYYY') || '-' ||
         lpad((
           coalesce(max(substring(ref from 'INS-\d{4}-(\d+)')::int), 0) + 1
         )::text, 4, '0')
    from public.security_incidents
   where ref like 'INS-' || to_char(now(), 'YYYY') || '-%';
$$;

revoke all on function public.insiden_ref_baru() from public, authenticated;

-- ------------------------------------------------------------
-- RPC: catat insiden baru
-- ------------------------------------------------------------
create or replace function public.admin_insiden_buat(
  p_judul          text,
  p_ringkasan      text,
  p_kategori       text default 'kebocoran_data',
  p_tingkat        text default 'sedang',
  p_diketahui_pada timestamptz default now(),
  p_terjadi_mulai  timestamptz default null,
  p_terjadi_sampai timestamptz default null,
  p_lingkup        text default 'aktivitas',
  p_kategori_data  text[] default null
)
returns public.security_incidents
language plpgsql
security definer
set search_path = public
as $$
declare
  baris public.security_incidents%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Tidak diizinkan: bukan admin' using errcode = 'insufficient_privilege';
  end if;

  -- Jam nol di masa depan akan memberi tenggat yang lebih longgar daripada
  -- yang sebenarnya. Itu bukan kesalahan ketik yang boleh lolos diam-diam:
  -- seluruh gunanya kolom ini adalah menjadi angka yang tidak bisa digeser.
  if p_diketahui_pada > now() + interval '5 minutes' then
    raise exception 'Waktu "diketahui pada" tidak boleh di masa depan'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.security_incidents
    (ref, judul, ringkasan, kategori, tingkat, diketahui_pada,
     terjadi_mulai, terjadi_sampai, lingkup, kategori_data)
  values
    (public.insiden_ref_baru(), btrim(p_judul), btrim(p_ringkasan),
     p_kategori, p_tingkat, p_diketahui_pada,
     p_terjadi_mulai, p_terjadi_sampai, p_lingkup, p_kategori_data)
  returning * into baris;

  insert into public.admin_audit_log (admin_id, action, target_table, target_id, meta)
  values (auth.uid(), 'insiden_dibuat', 'security_incidents', baris.id::text,
          jsonb_build_object('ref', baris.ref, 'tingkat', baris.tingkat,
                             'batas_lapor', baris.batas_lapor));

  return baris;
end;
$$;

revoke all on function public.admin_insiden_buat(text, text, text, text, timestamptz, timestamptz, timestamptz, text, text[]) from public;
grant execute on function public.admin_insiden_buat(text, text, text, text, timestamptz, timestamptz, timestamptz, text, text[]) to authenticated;

-- ------------------------------------------------------------
-- RPC: perbarui insiden
-- ------------------------------------------------------------
--
-- `diketahui_pada` TIDAK bisa diubah lewat fungsi ini, dan itu keputusan yang
-- disengaja. Jam nol yang bisa digeser belakangan bukan jam nol — ia hanya
-- akan menjadi angka yang selalu kebetulan pas dengan kapan laporan akhirnya
-- dikirim. Bila memang salah catat, perbaikannya lewat SQL Editor, dengan
-- jejak dan alasan yang tertulis di luar sistem.
create or replace function public.admin_insiden_ubah(
  p_id                 bigint,
  p_status             text default null,
  p_tingkat            text default null,
  p_ringkasan          text default null,
  p_tindakan           text default null,
  p_terjadi_mulai      timestamptz default null,
  p_terjadi_sampai     timestamptz default null,
  p_lingkup            text default null,
  p_kategori_data      text[] default null,
  p_jumlah_korban      int default null,
  p_lapor_otoritas_pada timestamptz default null,
  p_lapor_otoritas_ref text default null,
  p_lapor_korban_pada  timestamptz default null
)
returns public.security_incidents
language plpgsql
security definer
set search_path = public
as $$
declare
  lama  public.security_incidents%rowtype;
  baris public.security_incidents%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Tidak diizinkan: bukan admin' using errcode = 'insufficient_privilege';
  end if;

  select * into lama from public.security_incidents where id = p_id;
  if lama.id is null then
    raise exception 'Insiden % tidak ditemukan', p_id using errcode = 'no_data_found';
  end if;

  -- Menutup insiden sebagai "dilaporkan" tanpa mencatat KAPAN dilaporkan akan
  -- menghasilkan register yang tampak patuh tapi tidak bisa membuktikan
  -- apa pun. Justru tanggal itulah satu-satunya yang ditanyakan saat audit.
  if coalesce(p_status, lama.status) = 'dilaporkan'
     and coalesce(p_lapor_otoritas_pada, lama.lapor_otoritas_pada) is null then
    raise exception 'Status "dilaporkan" membutuhkan tanggal pelaporan ke otoritas'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.security_incidents set
    status              = coalesce(p_status, status),
    tingkat             = coalesce(p_tingkat, tingkat),
    ringkasan           = coalesce(nullif(btrim(p_ringkasan), ''), ringkasan),
    tindakan            = coalesce(p_tindakan, tindakan),
    terjadi_mulai       = coalesce(p_terjadi_mulai, terjadi_mulai),
    terjadi_sampai      = coalesce(p_terjadi_sampai, terjadi_sampai),
    lingkup             = coalesce(p_lingkup, lingkup),
    kategori_data       = coalesce(p_kategori_data, kategori_data),
    jumlah_korban       = coalesce(p_jumlah_korban, jumlah_korban),
    lapor_otoritas_pada = coalesce(p_lapor_otoritas_pada, lapor_otoritas_pada),
    lapor_otoritas_ref  = coalesce(nullif(btrim(p_lapor_otoritas_ref), ''), lapor_otoritas_ref),
    lapor_korban_pada   = coalesce(p_lapor_korban_pada, lapor_korban_pada),
    updated_at          = now()
  where id = p_id
  returning * into baris;

  insert into public.admin_audit_log (admin_id, action, target_table, target_id, meta)
  values (auth.uid(), 'insiden_diubah', 'security_incidents', p_id::text,
          jsonb_build_object(
            'ref', baris.ref,
            'status', jsonb_build_array(lama.status, baris.status),
            'tingkat', jsonb_build_array(lama.tingkat, baris.tingkat)));

  return baris;
end;
$$;

revoke all on function public.admin_insiden_ubah(bigint, text, text, text, text, timestamptz, timestamptz, text, text[], int, timestamptz, text, timestamptz) from public;
grant execute on function public.admin_insiden_ubah(bigint, text, text, text, text, timestamptz, timestamptz, text, text[], int, timestamptz, text, timestamptz) to authenticated;

-- ------------------------------------------------------------
-- RPC: daftar insiden + sisa waktu
-- ------------------------------------------------------------
--
-- Sisa waktu dihitung di DATABASE, bukan di browser. Jam browser admin bisa
-- meleset, salah zona, atau sengaja diubah — dan satu-satunya angka yang
-- penting di halaman ini adalah berapa jam lagi tenggat hukum jatuh.
create or replace function public.admin_list_insiden(p_limit int default 200)
returns table (
  id                  bigint,
  ref                 text,
  judul               text,
  ringkasan           text,
  kategori            text,
  tingkat             text,
  status              text,
  lingkup             text,
  kategori_data       text[],
  terjadi_mulai       timestamptz,
  terjadi_sampai      timestamptz,
  diketahui_pada      timestamptz,
  batas_lapor         timestamptz,
  sisa_menit          int,
  terlambat           boolean,
  jumlah_korban       int,
  lapor_otoritas_pada timestamptz,
  lapor_otoritas_ref  text,
  lapor_korban_pada   timestamptz,
  tindakan            text,
  dibuat_oleh_email   text,
  created_at          timestamptz,
  updated_at          timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Tidak diizinkan: bukan admin' using errcode = 'insufficient_privilege';
  end if;

  return query
  select i.id, i.ref, i.judul, i.ringkasan, i.kategori, i.tingkat, i.status,
         i.lingkup, i.kategori_data,
         i.terjadi_mulai, i.terjadi_sampai, i.diketahui_pada, i.batas_lapor,
         (extract(epoch from (i.batas_lapor - now())) / 60)::int,
         -- "Terlambat" hanya berlaku bila laporannya memang belum dikirim.
         -- Insiden yang sudah dilaporkan tepat waktu tidak boleh berubah
         -- menjadi merah hanya karena tenggatnya lewat kemarin.
         (now() > i.batas_lapor
          and i.lapor_otoritas_pada is null
          and i.status not in ('selesai', 'bukan_insiden')),
         i.jumlah_korban, i.lapor_otoritas_pada, i.lapor_otoritas_ref,
         i.lapor_korban_pada, i.tindakan,
         au.email::text, i.created_at, i.updated_at
    from public.security_incidents i
    left join auth.users au on au.id = i.dibuat_oleh
   order by
     -- Yang masih berjalan dan paling mepet tenggatnya, di paling atas.
     (i.status in ('selesai','bukan_insiden')) asc,
     i.batas_lapor asc
   limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

revoke all on function public.admin_list_insiden(int) from public;
grant execute on function public.admin_list_insiden(int) to authenticated;

-- ------------------------------------------------------------
-- RPC: DAFTAR KORBAN — inti dari kewajiban 72 jam
-- ------------------------------------------------------------
--
-- Mengembalikan siapa saja yang harus diberitahu, lengkap dengan alamat untuk
-- memberitahunya. Ini satu-satunya fungsi di berkas ini yang sengaja
-- mengembalikan data pribadi utuh (email, telepon) — karena memberitahu orang
-- tanpa cara menghubunginya adalah kewajiban yang tidak mungkin dipenuhi.
--
-- Tiga jejak digabung di sini karena ketiganya menjawab pertanyaan yang sama
-- dari sudut berbeda, dan nama kolom pemiliknya berbeda-beda:
--   app_events.user_id       → pemakaian aplikasi
--   audit_logs.owner_id      → perubahan data
--   ai_activity_log.owner_id → pemakaian fitur AI
create or replace function public.admin_insiden_korban(p_id bigint)
returns table (
  workspace_id  uuid,
  email         text,
  owner_name    text,
  business_name text,
  phone         text,
  jejak_app     bigint,
  jejak_audit   bigint,
  jejak_ai      bigint,
  aktivitas_awal  timestamptz,
  aktivitas_akhir timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ins   public.security_incidents%rowtype;
  mulai timestamptz;
  sampai timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Tidak diizinkan: bukan admin' using errcode = 'insufficient_privilege';
  end if;

  select * into ins from public.security_incidents where id = p_id;
  if ins.id is null then
    raise exception 'Insiden % tidak ditemukan', p_id using errcode = 'no_data_found';
  end if;

  -- Jendela yang belum diisi diperlakukan TERBUKA, bukan kosong.
  --
  -- Kalau batas kejadian belum diketahui — keadaan paling lazim di jam-jam
  -- pertama sebuah insiden — daftar korban harus berisi SEMUA yang mungkin
  -- terdampak, bukan nol orang. Daftar yang terlalu luas bisa dipersempit
  -- nanti; daftar kosong yang tampak meyakinkan tidak bisa diperbaiki, karena
  -- tidak ada yang menyadari ia salah.
  mulai  := coalesce(ins.terjadi_mulai, '-infinity'::timestamptz);
  sampai := coalesce(ins.terjadi_sampai, now());

  if ins.lingkup = 'terpilih' then
    return query
    select p.id, u.email::text, p.owner_name, p.business_name, p.phone,
           0::bigint, 0::bigint, 0::bigint, null::timestamptz, null::timestamptz
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.id = any(coalesce(ins.workspace_ids, '{}'::uuid[]))
     order by p.business_name nulls last;
    return;
  end if;

  if ins.lingkup = 'semua' then
    return query
    select p.id, u.email::text, p.owner_name, p.business_name, p.phone,
           0::bigint, 0::bigint, 0::bigint, null::timestamptz, null::timestamptz
      from public.profiles p
      join auth.users u on u.id = p.id
     order by p.business_name nulls last;
    return;
  end if;

  -- lingkup = 'aktivitas'
  return query
  with jejak as (
    select e.user_id as uid, e.created_at as at, 'app'::text as sumber
      from public.app_events e
     where e.user_id is not null and e.created_at between mulai and sampai
    union all
    select a.owner_id, a.created_at, 'audit'
      from public.audit_logs a
     where a.owner_id is not null and a.created_at between mulai and sampai
    union all
    select l.owner_id, l.created_at, 'ai'
      from public.ai_activity_log l
     where l.owner_id is not null and l.created_at between mulai and sampai
  ),
  ringkas as (
    select j.uid,
           count(*) filter (where j.sumber = 'app')   as n_app,
           count(*) filter (where j.sumber = 'audit') as n_audit,
           count(*) filter (where j.sumber = 'ai')    as n_ai,
           min(j.at) as awal, max(j.at) as akhir
      from jejak j
     group by j.uid
  )
  select p.id, u.email::text, p.owner_name, p.business_name, p.phone,
         r.n_app, r.n_audit, r.n_ai, r.awal, r.akhir
    from ringkas r
    join public.profiles p on p.id = r.uid
    join auth.users u on u.id = p.id
   order by r.akhir desc;
end;
$$;

revoke all on function public.admin_insiden_korban(bigint) from public;
grant execute on function public.admin_insiden_korban(bigint) to authenticated;

-- ------------------------------------------------------------
-- RPC: akun terhapus yang juga masuk jendela insiden
-- ------------------------------------------------------------
--
-- Melengkapi admin_insiden_korban(), yang menurut definisinya hanya bisa
-- melihat akun yang MASIH ADA. Akun yang dihapus sebelum insiden ketahuan
-- tetap perlu disebut dalam laporan ke otoritas — datanya nyata pernah ada
-- dan ikut terekspos — meski subjeknya tidak bisa lagi dihubungi dari sini.
create or replace function public.admin_insiden_akun_terhapus(p_id bigint)
returns table (
  user_id      uuid,
  email_mask   text,
  email_hash   text,
  reason       text,
  data_summary jsonb,
  deleted_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ins public.security_incidents%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Tidak diizinkan: bukan admin' using errcode = 'insufficient_privilege';
  end if;

  select * into ins from public.security_incidents where id = p_id;
  if ins.id is null then
    raise exception 'Insiden % tidak ditemukan', p_id using errcode = 'no_data_found';
  end if;

  return query
  select d.user_id, d.email_mask, d.email_hash, d.reason, d.data_summary, d.deleted_at
    from public.deleted_accounts d
   -- Yang relevan adalah akun yang dihapus SESUDAH kejadian mulai: datanya
   -- masih hidup di sistem saat jendela insiden berjalan.
   where d.deleted_at >= coalesce(ins.terjadi_mulai, ins.diketahui_pada - interval '30 days')
   order by d.deleted_at desc;
end;
$$;

revoke all on function public.admin_insiden_akun_terhapus(bigint) from public;
grant execute on function public.admin_insiden_akun_terhapus(bigint) to authenticated;

-- ------------------------------------------------------------
-- RPC: jejak lengkap satu akun
-- ------------------------------------------------------------
--
-- "Sistem wajib punya catatan aktivitas yang rapi agar korban bisa
-- teridentifikasi cepat." Rapi di sini berarti: satu pertanyaan, satu
-- jawaban, terurut waktu — bukan tiga tabel dengan tiga nama kolom pemilik
-- yang harus digabung dengan tangan saat tenggat berjalan.
create or replace function public.admin_jejak_akun(
  p_uid   uuid,
  p_sejak timestamptz default null,
  p_limit int default 500
)
returns table (
  waktu    timestamptz,
  sumber   text,
  aksi     text,
  detail   jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  sejak timestamptz := coalesce(p_sejak, now() - interval '90 days');
begin
  if not public.is_admin() then
    raise exception 'Tidak diizinkan: bukan admin' using errcode = 'insufficient_privilege';
  end if;

  return query
  select * from (
    select e.created_at, 'aplikasi'::text, e.type, e.meta
      from public.app_events e
     where e.user_id = p_uid and e.created_at >= sejak
    union all
    select a.created_at, 'data'::text,
           a.table_name || ' · ' || a.action,
           jsonb_build_object('row_id', a.row_id, 'via', a.via, 'actor_id', a.actor_id)
      from public.audit_logs a
     where a.owner_id = p_uid and a.created_at >= sejak
    union all
    select l.created_at, 'ai'::text,
           l.feature || ' · ' || l.outcome,
           l.meta
      from public.ai_activity_log l
     where l.owner_id = p_uid and l.created_at >= sejak
    union all
    select q.created_at, 'admin'::text, q.action,
           jsonb_build_object('feature', q.feature, 'before', q.before_value,
                              'after', q.after_value, 'note', q.note)
      from public.admin_quota_actions q
     where q.workspace_id = p_uid and q.created_at >= sejak
  ) t(waktu, sumber, aksi, detail)
  order by t.waktu desc
  limit least(greatest(coalesce(p_limit, 500), 1), 2000);
end;
$$;

revoke all on function public.admin_jejak_akun(uuid, timestamptz, int) from public;
grant execute on function public.admin_jejak_akun(uuid, timestamptz, int) to authenticated;

-- ------------------------------------------------------------
-- RPC: lonceng kesiapan untuk Overview
-- ------------------------------------------------------------
create or replace function public.admin_insiden_ringkas()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'terbuka', (select count(*) from public.security_incidents
                 where status not in ('selesai','bukan_insiden')),
    'terlambat', (select count(*) from public.security_incidents
                   where now() > batas_lapor and lapor_otoritas_pada is null
                     and status not in ('selesai','bukan_insiden')),
    -- Insiden paling mepet yang belum dilaporkan. null = tidak ada yang
    -- sedang berjalan, dan itu memang keadaan yang diharapkan.
    'tenggat_terdekat', (select min(batas_lapor) from public.security_incidents
                          where lapor_otoritas_pada is null
                            and status not in ('selesai','bukan_insiden')),
    'akun_dihapus_30h', (select count(*) from public.deleted_accounts
                          where deleted_at > now() - interval '30 days')
  );
end;
$$;

revoke all on function public.admin_insiden_ringkas() from public;
grant execute on function public.admin_insiden_ringkas() to authenticated;

-- ============================================================
-- SELESAI.
--
-- CATATAN DEPLOY: admin_delete_user berganti tanda tangan
-- (uuid) → (uuid, text). Dashboard admin harus ikut di-deploy, karena versi
-- lama yang memanggil tanpa alasan akan menerima error "function does not
-- exist" — disengaja, supaya tidak ada penghapusan tanpa jejak yang lolos.
-- ============================================================
