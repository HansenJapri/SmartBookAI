-- ============================================================
-- Pisahkan data operasional (cron/heartbeat) dari schema produksi.
--
-- MASALAH: `service_heartbeat` dan `service_config` dibuat di schema `public`.
-- RLS memang memblokir pembacaannya, tetapi `public` ADALAH schema yang
-- diekspos PostgREST — sehingga kedua tabel itu tetap muncul di introspeksi
-- skema/OpenAPI proyek. Pengguna aplikasi tidak bisa membaca isinya, tapi bisa
-- MENGETAHUI keberadaannya, dan tabel rekam-medis server tidak punya urusan
-- apa pun dengan permukaan API yang dipakai pemilik warung.
--
-- Selain itu, mencampur tabel operasional dengan tabel bisnis di satu schema
-- membuat batas "mana data pengguna, mana data mesin" hanya bergantung pada
-- ingatan orang yang membaca daftar tabel.
--
-- SOLUSI: schema `ops`, TIDAK didaftarkan di PostgREST (Supabase hanya
-- mengekspos `public` dan `graphql_public` secara bawaan). Konsekuensinya
-- tabel-tabel ini tidak bisa disentuh lewat REST API sama sekali — bukan
-- "diblokir policy", melainkan tidak punya endpoint sama sekali. Aksesnya hanya
-- lewat service role dari Edge Function dan lewat SQL Editor.
--
-- RETENSI: 3 bulan (sebelumnya 1 tahun), sesuai keputusan pemilik produk.
-- ============================================================

create schema if not exists ops;

comment on schema ops is
  'Data operasional server (heartbeat cron, konfigurasi internal). SENGAJA tidak diekspos PostgREST: bukan bagian dari permukaan API aplikasi, dan tidak boleh tercampur dengan data bisnis pengguna di schema public.';

-- Kunci rapat: tidak ada peran publik yang boleh menyentuh schema ini.
revoke all on schema ops from public;
revoke all on schema ops from anon;
revoke all on schema ops from authenticated;
grant usage on schema ops to service_role;

-- ---------- Pindahkan tabel yang terlanjur dibuat di public ----------
-- Memakai ALTER ... SET SCHEMA, bukan create-baru-lalu-copy: data heartbeat
-- yang sudah ada ikut pindah utuh beserta indeks dan sequence-nya.
do $blok$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'service_heartbeat') then
    execute 'alter table public.service_heartbeat set schema ops';
  end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'service_config') then
    execute 'alter table public.service_config set schema ops';
  end if;
end
$blok$;

-- Policy lama tidak lagi relevan: tanpa endpoint REST, tidak ada permintaan
-- ber-RLS yang bisa sampai ke sini. RLS tetap dinyalakan sebagai lapis kedua
-- kalau suatu saat schema ini keliru diekspos.
drop policy if exists "admin baca heartbeat" on ops.service_heartbeat;

alter table ops.service_heartbeat enable row level security;
alter table ops.service_config    enable row level security;

revoke all on all tables in schema ops from public;
revoke all on all tables in schema ops from anon;
revoke all on all tables in schema ops from authenticated;
grant select, insert, update, delete on all tables in schema ops to service_role;
grant usage, select on all sequences in schema ops to service_role;

-- ---------- Fungsi ikut pindah ----------
drop function if exists public.pangkas_heartbeat();

-- Retensi 3 bulan. Cron menulis ~15 baris per 3 bulan, jadi tabel ini praktis
-- tidak pernah tumbuh; batas ini ada supaya pemanggilan manual yang beruntun
-- pun tidak bisa menumbuhkannya tanpa batas.
create or replace function ops.pangkas_heartbeat()
returns integer
language plpgsql
security definer
set search_path = ops, public
as $fn$
declare
  v_hapus integer;
begin
  delete from ops.service_heartbeat where beat_at < now() - interval '3 months';
  get diagnostics v_hapus = row_count;
  return v_hapus;
end;
$fn$;

revoke all on function ops.pangkas_heartbeat() from public;
revoke all on function ops.pangkas_heartbeat() from anon;
revoke all on function ops.pangkas_heartbeat() from authenticated;
grant execute on function ops.pangkas_heartbeat() to service_role;

-- ringkasan_kesehatan() MEMBACA tabel bisnis di public, jadi ia tetap perlu
-- akses ke sana — tapi ia sendiri bukan API pengguna. Dipindah ke ops dan
-- dicabut dari `authenticated`: satu-satunya pemanggil sahnya adalah Edge
-- Function keepalive yang memakai service role.
drop function if exists public.ringkasan_kesehatan();

create or replace function ops.ringkasan_kesehatan()
returns jsonb
language sql
stable
security definer
set search_path = ops, public
as $fn$
  select jsonb_build_object(
    'diperiksa_pada', now(),
    'makro_run_terakhir', (select max(run_date) from public.macro_runs),
    'makro_ai_status_terakhir', (select ai_status from public.macro_runs order by run_date desc limit 1),
    'makro_ai_terakhir_ok', (select max(run_date) from public.macro_runs where ai_status = 'ok'),
    'makro_hari_sejak_ai_ok', (select (current_date - max(run_date)) from public.macro_runs where ai_status = 'ok'),
    'harga_price_date_terakhir', (select max(price_date) from public.commodity_prices),
    'harga_baris_hari_ini', (
      select count(*) from public.commodity_prices
      where run_date = (select max(run_date) from public.commodity_prices)
    ),
    'kurs_tanggal_terakhir', (select max(rate_date) from public.exchange_rates),
    'inflasi_bulan_terakhir', (select max(month) from public.macro_config),
    'transaksi_terakhir', (select max(created_at) from public.transactions),
    'event_terakhir', (select max(created_at) from public.app_events)
  );
$fn$;

revoke all on function ops.ringkasan_kesehatan() from public;
revoke all on function ops.ringkasan_kesehatan() from anon;
revoke all on function ops.ringkasan_kesehatan() from authenticated;
grant execute on function ops.ringkasan_kesehatan() to service_role;

-- panggil_keepalive() dipanggil pg_cron (berjalan sebagai postgres), jadi ia
-- boleh tinggal di ops dan tidak perlu terlihat dari mana pun.
drop function if exists public.panggil_keepalive(text);

create or replace function ops.panggil_keepalive(p_sumber text default 'cron-6-hari')
returns bigint
language plpgsql
security definer
set search_path = ops, public, extensions
as $fn$
declare
  v_token text;
  v_req   bigint;
begin
  select nilai into v_token from ops.service_config where kunci = 'keepalive_token';
  if v_token is null or length(v_token) < 24 then
    raise exception 'keepalive_token belum ada di ops.service_config';
  end if;

  select net.http_post(
    url     := 'https://vbzmtnpmtgrhovmwjqqk.supabase.co/functions/v1/keepalive?sumber=' || p_sumber,
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-keepalive-token', v_token
    )
  ) into v_req;

  return v_req;
end;
$fn$;

revoke all on function ops.panggil_keepalive(text) from public;
revoke all on function ops.panggil_keepalive(text) from anon;
revoke all on function ops.panggil_keepalive(text) from authenticated;

-- ---------- Jadwal ----------
-- Detak: tanggal 1,7,13,19,25,31 pukul 02.00 UTC (09.00 WIB).
-- Jarak terjauh 6 hari — selalu di bawah ambang jeda 7 hari Supabase.
select cron.unschedule('keepalive-supabase-6hari')
where exists (select 1 from cron.job where jobname = 'keepalive-supabase-6hari');

select cron.schedule(
  'keepalive-supabase-6hari',
  '0 2 1,7,13,19,25,31 * *',
  $cron$ select ops.panggil_keepalive('cron-6-hari') $cron$
);

-- Pembersihan retensi 3 bulan: tanggal 1 tiap bulan, 03.00 UTC.
--
-- Dijadikan cron TERSENDIRI, bukan diselipkan ke dalam keepalive secara
-- probabilistik seperti versi sebelumnya. Pembersihan yang hanya jalan
-- "kira-kira 1 dari 10 kali" adalah pembersihan yang tidak pernah bisa
-- dibuktikan sudah berjalan.
select cron.unschedule('pangkas-heartbeat-3bulan')
where exists (select 1 from cron.job where jobname = 'pangkas-heartbeat-3bulan');

select cron.schedule(
  'pangkas-heartbeat-3bulan',
  '0 3 1 * *',
  $cron$ select ops.pangkas_heartbeat() $cron$
);
