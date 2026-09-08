-- ============================================================
-- Migrasi: provenance AI + heartbeat keep-alive
--
-- Dua masalah berbeda yang lahir dari satu akar yang sama: tidak ada satu pun
-- baris di database ini yang bisa menjawab "apakah sistemnya sedang sehat?".
--
-- 1. PROVENANCE AI (macro_runs, macro_signals)
--    Antara 8 Agustus dan 8 September 2026, `makro-harian` gagal memanggil
--    Gemini setiap pagi (HTTP 401, kunci dicabut) namun tetap menulis 25 baris
--    sinyal "stabil" dan tetap menandai dirinya `done`. Baris hasil kegagalan
--    tersimpan SAMA PERSIS dengan baris "AI menilai harga memang stabil":
--    direction 'stabil', est 0..0, drivers []. Tidak ada kueri yang bisa
--    memisahkan keduanya, sehingga selama 32 hari Radar menampilkan perkiraan
--    fabrikasi sebagai analisis yang sah. Kolom ai_status menutup celah itu.
--
-- 2. HEARTBEAT (service_heartbeat)
--    Proyek Supabase gratis dijeda setelah 7 hari tanpa aktivitas. Dua proyek
--    lain di akun ini (`dashboard-database`, `Datasense AI`) sudah INACTIVE
--    justru karena tidak punya pekerjaan terjadwal apa pun. `SmartBookAi`
--    selamat bukan karena dirancang begitu, melainkan sebagai efek samping
--    cron `makro-harian`. Efek samping bukan jaminan: begitu cron itu dimatikan
--    atau diubah, proyek ini ikut rentan tanpa ada yang menyadarinya.
--    Heartbeat menjadikan perlindungan itu disengaja dan bisa diperiksa.
-- ============================================================

-- ---------- BAGIAN 1: provenance AI ----------

alter table public.macro_runs
  add column if not exists ai_status text,
  add column if not exists ai_detail text,
  add column if not exists ai_model  text,
  add column if not exists ai_tokens integer;

comment on column public.macro_runs.ai_status is
  'ok | kosong | gagal. "kosong" = model menjawab tapi JSON tidak terpakai; '
  '"gagal" = panggilan tidak pernah berhasil. Dibedakan karena penanganannya berbeda.';
comment on column public.macro_runs.ai_detail is
  'Sebab teknis apa adanya (kode error, HTTP status, model). Untuk admin, bukan pengguna.';

alter table public.macro_signals
  add column if not exists ai_status text;

comment on column public.macro_signals.ai_status is
  'Provenance baris ini. "ok" = arah & estimasi benar-benar dari Gemini. '
  'Selain itu = nilai bawaan, WAJIB tidak ditampilkan sebagai perkiraan di UI.';

-- Backfill BERDASARKAN DATA, bukan tebakan tanggal.
--
-- Sebuah run dianggap benar-benar menghasilkan AI bila hari itu ada minimal
-- satu komoditas yang arahnya bukan 'stabil' ATAU punya driver. Pemadaman total
-- menghasilkan 25 baris yang seluruhnya stabil-tanpa-driver, jadi kriteria ini
-- memisahkan keduanya tanpa perlu memercayai tanggal yang diingat siapa pun.
with run_hidup as (
  select run_date
  from public.macro_signals
  group by run_date
  having bool_or(direction <> 'stabil')
      or bool_or(jsonb_array_length(coalesce(drivers, '[]'::jsonb)) > 0)
)
update public.macro_signals s
set ai_status = case when r.run_date is not null then 'ok' else 'gagal' end
from (select distinct run_date from public.macro_signals) d
left join run_hidup r on r.run_date = d.run_date
where s.run_date = d.run_date
  and s.ai_status is null;

update public.macro_runs m
set ai_status = coalesce(
  (select s.ai_status from public.macro_signals s where s.run_date = m.run_date limit 1),
  'tidak_diketahui'
)
where m.ai_status is null;

-- ---------- BAGIAN 2: heartbeat keep-alive ----------

create table if not exists public.service_heartbeat (
  id          bigserial primary key,
  beat_at     timestamptz not null default now(),
  -- Siapa yang menulis: 'cron-6-hari', 'manual', 'deploy', dst.
  sumber      text        not null,
  -- Ringkasan kesehatan saat detak ini dibuat. Sengaja jsonb, bukan kolom
  -- tetap: isi yang perlu dipantau akan bertambah, dan menambah kolom setiap
  -- kali berarti migrasi setiap kali.
  kesehatan   jsonb       not null default '{}'::jsonb,
  -- true = semua pemeriksaan lolos. Kolom terpisah supaya "kapan terakhir
  -- sistem ini benar-benar sehat?" jadi satu kueri indeks, bukan pemindaian jsonb.
  sehat       boolean     not null default true,
  catatan     text
);

comment on table public.service_heartbeat is
  'Detak keep-alive + rekam medis berkala. Ditulis cron tiap <= 6 hari agar '
  'proyek Supabase gratis tidak pernah menyentuh ambang jeda 7 hari, sekaligus '
  'menjadi jejak historis kesehatan layanan (kunci AI, harga, kurs).';

create index if not exists service_heartbeat_beat_at_idx
  on public.service_heartbeat (beat_at desc);

-- RLS menyala tanpa satu pun policy untuk pengguna biasa: tabel ini HANYA
-- ditulis service role (Edge Function) dan dibaca admin. Pengguna aplikasi
-- tidak punya urusan dengan isi rekam medis server.
alter table public.service_heartbeat enable row level security;

drop policy if exists "admin baca heartbeat" on public.service_heartbeat;
create policy "admin baca heartbeat" on public.service_heartbeat
  for select using (public.is_admin());

-- Penjaga umur: simpan 1 tahun. Tabel ini tumbuh ~61 baris/tahun dari cron,
-- jadi batas ini longgar; ia ada supaya pemanggilan manual yang beruntun tidak
-- pernah bisa menumbuhkannya tanpa batas.
create or replace function public.pangkas_heartbeat()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.service_heartbeat where beat_at < now() - interval '1 year';
$$;

-- ---------- BAGIAN 3: pemeriksa kesehatan yang bisa dibaca manusia ----------
--
-- Satu kueri untuk pertanyaan "apakah semuanya masih jalan?". Dipakai Edge
-- Function keepalive, dan bisa dijalankan langsung dari SQL editor saat curiga.
create or replace function public.ringkasan_kesehatan()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'diperiksa_pada', now(),

    -- Pipeline makro: kapan terakhir jalan, dan apakah AI-nya benar-benar hidup.
    'makro_run_terakhir', (select max(run_date) from macro_runs),
    'makro_ai_status_terakhir', (
      select ai_status from macro_runs order by run_date desc limit 1
    ),
    'makro_ai_terakhir_ok', (
      select max(run_date) from macro_runs where ai_status = 'ok'
    ),
    'makro_hari_sejak_ai_ok', (
      select (current_date - max(run_date)) from macro_runs where ai_status = 'ok'
    ),

    -- Harga bapok: tanggal data SP2KP terbaru yang tersimpan.
    'harga_price_date_terakhir', (select max(price_date) from commodity_prices),
    'harga_baris_hari_ini', (
      select count(*) from commodity_prices
      where run_date = (select max(run_date) from commodity_prices)
    ),

    -- Kurs & inflasi.
    'kurs_tanggal_terakhir', (select max(rate_date) from exchange_rates),
    'inflasi_bulan_terakhir', (select max(month) from macro_config),

    -- Aktivitas pengguna — pembeda "sistem mati" dari "memang sedang sepi".
    'transaksi_terakhir', (select max(created_at) from transactions),
    'event_terakhir', (select max(created_at) from app_events)
  );
$$;

revoke all on function public.ringkasan_kesehatan() from public, anon;
grant execute on function public.ringkasan_kesehatan() to authenticated, service_role;
revoke all on function public.pangkas_heartbeat() from public, anon, authenticated;
grant execute on function public.pangkas_heartbeat() to service_role;

-- ---------- BAGIAN 4: token cron & jadwal 6 hari ----------
--
-- Rahasia internal server. RLS menyala TANPA satu pun policy: hanya service
-- role (Edge Function) dan pemilik database yang bisa membacanya.
create table if not exists public.service_config (
  kunci        text primary key,
  nilai        text not null,
  dibuat_pada  timestamptz not null default now()
);

alter table public.service_config enable row level security;
revoke all on public.service_config from anon, authenticated;

comment on table public.service_config is
  'Rahasia internal server (mis. token keepalive). Nilainya dibuat di dalam '
  'Postgres dan tidak pernah ditulis ke definisi cron, agar tidak ikut terbaca '
  'setiap kali jadwal cron dilihat atau diekspor.';

-- Token dibuat DI SINI, oleh Postgres, dan tidak pernah keluar dari database.
insert into public.service_config (kunci, nilai)
values ('keepalive_token', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (kunci) do nothing;

-- Perantara ini ada supaya token TIDAK tertulis di cron.job.command. Perintah
-- cron dibaca setiap kali seseorang memeriksa jadwal, dan rahasia yang tertanam
-- di sana ikut terbawa ke mana pun hasil bacaan itu ditempel.
create or replace function public.panggil_keepalive(p_sumber text default 'cron-6-hari')
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_req   bigint;
begin
  select nilai into v_token from public.service_config where kunci = 'keepalive_token';
  if v_token is null or length(v_token) < 24 then
    raise exception 'keepalive_token belum ada di service_config';
  end if;

  select net.http_post(
    url     := 'https://hexaidoxmeycctpwfbst.supabase.co/functions/v1/keepalive?sumber=' || p_sumber,
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-keepalive-token', v_token
    )
  ) into v_req;

  return v_req;
end;
$$;

revoke all on function public.panggil_keepalive(text) from public, anon, authenticated;

-- Jadwal: 02.00 UTC (09.00 WIB) pada tanggal 1, 7, 13, 19, 25, 31.
--
-- Jarak TERJAUH antar-detak dengan pola ini adalah 6 HARI (tanggal 25 ke
-- tanggal 1 bulan berikutnya pada bulan 30 hari). Selalu di bawah ambang jeda
-- 7 hari Supabase, menyisakan satu hari penuh sebagai margin bila satu
-- eksekusi gagal.
--
-- `*/6` pada ruas tanggal SENGAJA TIDAK dipakai walau terlihat lebih rapi:
-- pada bulan 31 hari ia menghasilkan lompatan 31 -> 1 yang hanya berjarak
-- sehari, dan pada Februari jaraknya berubah-ubah. Tanggal eksplisit membuat
-- jarak maksimumnya bisa dibuktikan dengan membaca, bukan dengan menyimulasi.
select cron.unschedule('keepalive-supabase-6hari')
where exists (select 1 from cron.job where jobname = 'keepalive-supabase-6hari');

select cron.schedule(
  'keepalive-supabase-6hari',
  '0 2 1,7,13,19,25,31 * *',
  $cron$ select public.panggil_keepalive('cron-6-hari') $cron$
);
