-- ============================================================
-- Jejak error & bug — sumber tunggal untuk tab "Log Error" di admin dashboard.
--
-- KENAPA ADA: sepanjang Agustus–September 2026 setiap kegagalan di sistem ini
-- ditemukan oleh PENGGUNA, bukan oleh pemiliknya. Kunci Gemini yang dicabut
-- butuh 32 hari. CORS yang memblokir seluruh Edge Function butuh laporan
-- keluhan. Tanggal jatuh tempo yang ditolak diam-diam butuh tangkapan layar.
-- Ketiganya meninggalkan jejak — di log Supabase, di konsol browser — tetapi
-- tidak ada satu tempat pun yang bisa dibuka untuk bertanya "ada yang rusak?".
--
-- Tabel ini tempat itu.
--
-- DEDUPLIKASI lewat `sidik` (fingerprint). Satu bug yang terjadi 500 kali
-- adalah SATU baris dengan jumlah=500, bukan 500 baris. Tanpa ini, error yang
-- sering justru menenggelamkan error yang jarang — dan yang jarang sering kali
-- yang paling merusak (gagal simpan transaksi, kebocoran akses).
--
-- Baris yang MUNCUL LAGI setelah ditandai 'ditangani' otomatis kembali ke
-- 'baru'. Perbaikan yang tidak benar-benar memperbaiki harus terlihat.
-- ============================================================

create table if not exists public.error_logs (
  id             bigserial primary key,

  -- Sidik jari untuk menggabungkan kejadian yang sama. Dihitung di pemanggil
  -- dari (sumber + fitur + kode + potongan pesan yang sudah dinormalkan).
  sidik          text        not null unique,

  -- Waktu, sampai detik. Dua kolom karena dua pertanyaan berbeda:
  -- "sejak kapan ini mulai?" dan "masih terjadi tidak?".
  pertama_pada   timestamptz not null default now(),
  terakhir_pada  timestamptz not null default now(),
  jumlah         integer     not null default 1,

  -- DI MANA. `fitur` = nama fitur yang dipakai orang ("Radar Harga",
  -- "AI Catat", "Simulasi HPP"), bukan nama berkas — yang membaca tabel ini
  -- adalah pemilik produk, bukan hanya pengembangnya.
  sumber         text        not null default 'frontend',   -- frontend | edge | cron | db
  fitur          text        not null default 'tidak diketahui',
  halaman        text,                                       -- rute/URL saat error

  -- DALAM KONDISI APA. `aksi` = yang sedang dilakukan pengguna
  -- ("menyimpan transaksi piutang"), `konteks` = keadaan sekitarnya.
  aksi           text,
  konteks        jsonb       not null default '{}'::jsonb,

  -- APA yang terjadi.
  tingkat        text        not null default 'error',       -- error | fatal | warn
  kode           text,                                       -- PGRST205, 42501, INVALID_KEY, ...
  pesan          text        not null,
  jejak          text,                                       -- stack trace (dipotong)

  -- SIAPA. email disalin (denormalisasi) supaya baris tetap terbaca setelah
  -- akunnya dihapus — jejak error yang kehilangan identitasnya saat akun hilang
  -- justru menghapus bukti pada kasus yang paling perlu ditelusuri.
  user_id        uuid,
  email          text,
  workspace_id   uuid,
  user_agent     text,

  -- Triase.
  status         text        not null default 'baru',        -- baru | ditangani | diabaikan
  catatan_admin  text
);

comment on table public.error_logs is
  'Jejak error & bug seluruh sistem (frontend, Edge Function, cron). Dibaca tab Log Error di admin dashboard. Ditulis lewat catat_error(); dibaca HANYA oleh admin.';
comment on column public.error_logs.sidik is
  'Fingerprint penggabung. Kejadian berulang menaikkan `jumlah`, bukan menambah baris.';
comment on column public.error_logs.status is
  'baru | ditangani | diabaikan. Baris yang muncul lagi setelah "ditangani" otomatis kembali ke "baru" — perbaikan yang gagal harus terlihat.';

create index if not exists error_logs_terakhir_idx on public.error_logs (terakhir_pada desc);
create index if not exists error_logs_status_idx   on public.error_logs (status, terakhir_pada desc);
create index if not exists error_logs_fitur_idx    on public.error_logs (fitur, terakhir_pada desc);

alter table public.error_logs enable row level security;

-- BACA: admin saja. Isinya memuat pesan error mentah, potongan konteks, dan
-- email pengguna — bukan sesuatu yang boleh dilihat pengguna aplikasi.
drop policy if exists "admin baca error_logs" on public.error_logs;
create policy "admin baca error_logs" on public.error_logs
  for select using (public.is_admin());

-- UBAH (triase): admin saja.
drop policy if exists "admin ubah error_logs" on public.error_logs;
create policy "admin ubah error_logs" on public.error_logs
  for update using (public.is_admin()) with check (public.is_admin());

-- TIDAK ADA policy INSERT. Penulisan hanya lewat catat_error() di bawah,
-- supaya bentuk barisnya terkendali dan tidak ada yang bisa menyuntikkan
-- status/jumlah palsu langsung ke tabel.

-- ============================================================
-- catat_error() — satu-satunya pintu tulis
--
-- Boleh dipanggil anon: error pada layar Masuk/Daftar terjadi SEBELUM ada sesi,
-- dan justru itu kelas error yang paling membuat orang berhenti memakai
-- aplikasi. Menolaknya berarti membutakan diri pada bagian corong yang paling
-- rapuh.
--
-- Yang menahan penyalahgunaan: seluruh teks dipotong keras, `jumlah` hanya bisa
-- naik satu per panggilan, dan kolom triase tidak bisa disentuh dari sini.
-- ============================================================
create or replace function public.catat_error(
  p_sidik     text,
  p_pesan     text,
  p_sumber    text default 'frontend',
  p_fitur     text default 'tidak diketahui',
  p_aksi      text default null,
  p_kode      text default null,
  p_tingkat   text default 'error',
  p_halaman   text default null,
  p_jejak     text default null,
  p_konteks   jsonb default '{}'::jsonb,
  p_user_agent text default null
)
returns bigint
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_id    bigint;
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if coalesce(trim(p_sidik), '') = '' or coalesce(trim(p_pesan), '') = '' then
    return null;
  end if;

  if v_uid is not null then
    select email into v_email from auth.users where id = v_uid;
  end if;

  insert into public.error_logs (
    sidik, pesan, sumber, fitur, aksi, kode, tingkat, halaman, jejak, konteks,
    user_id, email, user_agent
  ) values (
    left(trim(p_sidik), 120),
    left(p_pesan, 2000),
    left(coalesce(p_sumber, 'frontend'), 20),
    left(coalesce(p_fitur, 'tidak diketahui'), 80),
    left(p_aksi, 160),
    left(p_kode, 60),
    case when p_tingkat in ('error', 'fatal', 'warn') then p_tingkat else 'error' end,
    left(p_halaman, 200),
    left(p_jejak, 4000),
    coalesce(p_konteks, '{}'::jsonb),
    v_uid,
    v_email,
    left(p_user_agent, 300)
  )
  on conflict (sidik) do update set
    jumlah        = public.error_logs.jumlah + 1,
    terakhir_pada = now(),
    -- Pesan & konteks diperbarui ke kejadian TERBARU: saat menelusuri, yang
    -- dibutuhkan adalah keadaan terakhir, bukan yang pertama kali berbulan lalu.
    pesan         = left(excluded.pesan, 2000),
    konteks       = excluded.konteks,
    jejak         = coalesce(left(excluded.jejak, 4000), public.error_logs.jejak),
    halaman       = coalesce(excluded.halaman, public.error_logs.halaman),
    user_id       = coalesce(excluded.user_id, public.error_logs.user_id),
    email         = coalesce(excluded.email, public.error_logs.email),
    -- Muncul lagi setelah dianggap selesai = perbaikannya tidak bekerja.
    status        = case when public.error_logs.status = 'ditangani'
                         then 'baru' else public.error_logs.status end
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.catat_error(text, text, text, text, text, text, text, text, text, jsonb, text) from public;
grant execute on function public.catat_error(text, text, text, text, text, text, text, text, text, jsonb, text) to anon;
grant execute on function public.catat_error(text, text, text, text, text, text, text, text, text, jsonb, text) to authenticated;
grant execute on function public.catat_error(text, text, text, text, text, text, text, text, text, jsonb, text) to service_role;

-- ============================================================
-- Ringkasan untuk lonceng "ada yang rusak?" di admin dashboard.
-- ============================================================
create or replace function public.admin_error_ringkas()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select case when not public.is_admin() then '{}'::jsonb else jsonb_build_object(
    'baru',            (select count(*) from public.error_logs where status = 'baru'),
    'fatal_baru',      (select count(*) from public.error_logs where status = 'baru' and tingkat = 'fatal'),
    'kejadian_24jam',  (select coalesce(sum(jumlah), 0) from public.error_logs where terakhir_pada > now() - interval '24 hours'),
    'terakhir_pada',   (select max(terakhir_pada) from public.error_logs),
    'fitur_terparah',  (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select fitur, sum(jumlah) as kejadian
        from public.error_logs
        where terakhir_pada > now() - interval '7 days'
        group by fitur order by kejadian desc limit 5
      ) x
    )
  ) end;
$fn$;

revoke all on function public.admin_error_ringkas() from public;
revoke all on function public.admin_error_ringkas() from anon;
grant execute on function public.admin_error_ringkas() to authenticated;
grant execute on function public.admin_error_ringkas() to service_role;

-- ============================================================
-- Retensi 90 hari untuk baris yang SUDAH selesai ditriase.
--
-- Baris berstatus 'baru' TIDAK pernah dibuang otomatis, setua apa pun. Error
-- yang belum pernah dilihat siapa pun adalah justru yang paling tidak boleh
-- hilang diam-diam — itu persis pola kegagalan yang membuat tabel ini ada.
-- ============================================================
create or replace function public.pangkas_error_logs()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare v_hapus integer;
begin
  delete from public.error_logs
  where status in ('ditangani', 'diabaikan')
    and terakhir_pada < now() - interval '90 days';
  get diagnostics v_hapus = row_count;
  return v_hapus;
end;
$fn$;

revoke all on function public.pangkas_error_logs() from public;
revoke all on function public.pangkas_error_logs() from anon;
revoke all on function public.pangkas_error_logs() from authenticated;
grant execute on function public.pangkas_error_logs() to service_role;

select cron.unschedule('pangkas-error-logs')
where exists (select 1 from cron.job where jobname = 'pangkas-error-logs');

select cron.schedule(
  'pangkas-error-logs',
  '30 3 1 * *',
  $cron$ select public.pangkas_error_logs() $cron$
);
