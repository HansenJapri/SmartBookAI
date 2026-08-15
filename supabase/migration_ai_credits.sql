-- ============================================================
-- FASE 1 — KREDIT: SATUAN KOMERSIAL YANG DILIHAT PELANGGAN
--
-- Jalankan SETELAH migration_ai_telemetry.sql. Aman diulang (idempotent).
--
-- Keputusan yang diwujudkan berkas ini:
--   • Pelanggan UMKM melihat KREDIT; admin melihat TOKEN + Rupiah.
--     "500.000 token" tidak berarti apa-apa bagi pemilik toko kue, dan harga
--     per token berubah tiap Google mengganti model. Kredit menyerap perubahan
--     itu di balik satu faktor konversi.
--   • Tarif kredit hidup di TABEL, bukan di kode. Alasannya sama persis dengan
--     alasan dailyCap harus keluar dari config.ts: mengubah harga tidak boleh
--     menuntut deploy ulang Edge Function.
--   • Kredit dihitung di RPC (server), bukan di Edge Function. Fungsi ini
--     di-grant ke `authenticated`, jadi angka apa pun yang datang dari klien
--     adalah angka yang bisa dikarang. Tarifnya harus dibaca dari database.
--
-- CATATAN PENTING — kredit BUKAN pengganti cap harian per fitur.
-- Cap harian melindungi RPD Google per key slot A/B/C (lihat FEATURE_ROUTES):
-- `ocr`, `crud`, dan `catat` semuanya di slot C. Kalau semuanya digabung jadi
-- satu kantong kredit, satu workspace bisa membakar seluruh RPD slot C lewat
-- OCR dan mematikan `catat` + `crud` untuk SEMUA workspace lain, sementara
-- slot A dan B menganggur. Keduanya harus tetap berdampingan, dan sebuah
-- permintaan wajib lolos DUA-DUANYA. Penegakan kredit sendiri baru dipasang
-- di Fase 2 bersama ai_plans; fase ini hanya membuat kredit MULAI TERAKUMULASI
-- supaya saat penegakannya lahir, riwayatnya sudah ada.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Kartu tarif kredit
-- ------------------------------------------------------------
-- Kunci primernya (feature, effective_from) supaya riwayat tarif TERSIMPAN,
-- bukan tertimpa. Pertanyaan "bulan lalu OCR dihargai berapa kredit?" harus
-- bisa dijawab database, bukan diingat orang.
create table if not exists public.ai_credit_rates (
  feature        text        not null,
  credit_cost    numeric(6,2) not null check (credit_cost >= 0),
  effective_from date        not null default current_date,
  note           text,
  primary key (feature, effective_from)
);

alter table public.ai_credit_rates enable row level security;

-- Semua pengguna yang login boleh MEMBACA tarif: pelanggan berhak tahu satu
-- kali baca struk berharga berapa kredit sebelum menekannya. Penulisan tidak
-- diberi policy apa pun → hanya lewat service_role / SQL Editor, sejalan
-- dengan pola tabel `admins`.
drop policy if exists "credit rates read all" on public.ai_credit_rates;
create policy "credit rates read all" on public.ai_credit_rates
  for select to authenticated using (true);

-- ------------------------------------------------------------
-- 2) Seed tarif
-- ------------------------------------------------------------
-- Bobot = kelas model × volume token khas, mengacu langsung ke FEATURE_ROUTES.
-- Flash-Lite ringan = 1; konteks besar atau kelas model lebih tinggi = 2;
-- gambar atau keluaran terstruktur = 3; voice per MENIT = 5.
--
-- effective_from DIPATOK ke tanggal tetap, bukan current_date. Kalau memakai
-- current_date, menjalankan ulang migrasi ini di hari lain akan menyisipkan
-- baris tarif BARU dan diam-diam membatalkan kalibrasi yang sudah dilakukan
-- admin. Dengan tanggal tetap + do nothing, migrasi yang diulang tidak pernah
-- menyentuh tarif yang sudah disesuaikan.
insert into public.ai_credit_rates (feature, credit_cost, effective_from, note) values
  ('chat',              1.00, date '2026-01-01', 'Flash-Lite, RAG ±1,5k in / 0,5k out'),
  ('crud',              1.00, date '2026-01-01', 'Flash-Lite + deklarasi tool'),
  ('insight_dashboard', 2.00, date '2026-01-01', 'Flash-Lite, konteks agregat besar'),
  ('insight_stok',      2.00, date '2026-01-01', 'Flash-Lite, konteks stok'),
  ('catat',             2.00, date '2026-01-01', 'Gemini 3.5 Flash — kelas model lebih tinggi'),
  ('ocr',               3.00, date '2026-01-01', 'Flash-Lite + gambar (token gambar mahal)'),
  ('hpp_draft',         3.00, date '2026-01-01', 'Gemini 3.5 Flash, keluaran terstruktur'),
  ('voice',             5.00, date '2026-01-01', 'Per MENIT sesi, bukan per panggilan')
on conflict (feature, effective_from) do nothing;

-- ------------------------------------------------------------
-- 3) Resolusi tarif yang berlaku
-- ------------------------------------------------------------
-- Tarif yang berlaku pada suatu tanggal = effective_from terbesar yang tidak
-- melewati tanggal itu. Fitur tanpa tarif mengembalikan NULL, BUKAN 0 — dan
-- perbedaannya penting: 0 berarti "fitur ini gratis", NULL berarti "tarifnya
-- belum ditetapkan". Yang pertama adalah kebijakan; yang kedua adalah lupa.
create or replace function public.ai_credit_rate(p_feature text, p_on date default null)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select r.credit_cost
    from public.ai_credit_rates r
   where r.feature = p_feature
     and r.effective_from <= coalesce(p_on, public.ai_today_pacific())
   order by r.effective_from desc
   limit 1;
$$;

grant execute on function public.ai_credit_rate(text, date) to authenticated;

-- ------------------------------------------------------------
-- 4) Kolom kredit pada penghitung pemakaian
-- ------------------------------------------------------------
alter table public.workspace_ai_usage
  add column if not exists credits_used numeric(12,2) not null default 0,
  -- Menandai baris yang kreditnya DITURUNKAN dari tarif hari ini, bukan
  -- dihitung saat pemakaian terjadi (lihat backfill di bagian 6). Tanpa
  -- penanda ini, angka hasil terkaan tidak bisa dibedakan dari angka hasil
  -- pengukuran — dan yang pertama tidak boleh dipakai menagih siapa pun.
  add column if not exists credits_estimated boolean not null default false;

comment on column public.workspace_ai_usage.credits_used is
  'Kredit yang DIBEKUKAN pada tarif saat commit. Perubahan tarif TIDAK PERNAH '
  'menghitung ulang baris lampau: tagihan yang berubah sendiri setelah '
  'diterbitkan adalah cara tercepat kehilangan kepercayaan pelanggan.';

-- ------------------------------------------------------------
-- 5) ai_quota_commit — kini ikut membekukan kredit
-- ------------------------------------------------------------
-- Tanda tangan TIDAK berubah dari versi Fase 0, jadi `create or replace` aman
-- dan tidak menimbulkan fungsi kembar (bandingkan catatan drop di Fase 0).
create or replace function public.ai_quota_commit(
  p_feature           text,
  p_units             int  default 1,
  p_prompt_tokens     int  default 0,
  p_completion_tokens int  default 0,
  p_thinking_tokens   int  default 0,
  p_total_tokens      int  default 0,
  p_wasted_tokens     int  default 0,
  p_model             text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  ws      uuid := public.ai_workspace_id();
  d       date := public.ai_today_pacific();
  newval  int;
  units   int  := greatest(0, coalesce(p_units, 1));
  maks    int  := 2000000;
  tin     int  := least(greatest(0, coalesce(p_prompt_tokens, 0)), maks);
  tout    int  := least(greatest(0, coalesce(p_completion_tokens, 0)), maks);
  tthink  int  := least(greatest(0, coalesce(p_thinking_tokens, 0)), maks);
  ttotal  int  := least(greatest(0, coalesce(p_total_tokens, 0)), maks);
  twaste  int  := least(greatest(0, coalesce(p_wasted_tokens, 0)), maks);
  tarif   numeric;
  kredit  numeric(12,2);
begin
  if ws is null then return 0; end if;

  if ttotal = 0 then
    ttotal := least(tin + tout + tthink, maks);
  end if;

  -- ---- Kredit ----
  -- Voice ditarifkan per MENIT sementara units-nya DETIK, jadi akrualnya
  -- PECAHAN, tidak dibulatkan ke atas per commit. Pembulatan ke atas terdengar
  -- wajar sampai diingat bahwa satu workspace bisa membuka banyak sesi pendek
  -- dalam sehari: empat sesi 30 detik akan ditagih 4 × 5 = 20 kredit untuk
  -- pemakaian yang sebenarnya 2 menit. Akrual pecahan tidak punya kejutan itu.
  --
  -- units = 0 (jalur "catat token tanpa menaikkan kuota") menghasilkan kredit
  -- 0 dengan sendirinya lewat perkalian ini. Itu memang yang diinginkan:
  -- pekerjaan yang dibuang tidak boleh ditagihkan ke pelanggan, walau
  -- tokennya tetap dicatat sebagai biaya kita sendiri.
  tarif := public.ai_credit_rate(p_feature, d);
  kredit := round(
    coalesce(tarif, 0) * (case when p_feature = 'voice' then units / 60.0 else units end),
    2
  );

  if p_feature = 'voice' then
    insert into public.workspace_ai_usage (
      workspace_id, feature, day, seconds_used,
      prompt_tokens, completion_tokens, thinking_tokens, total_tokens,
      wasted_tokens, credits_used, last_model, updated_at
    )
    values (ws, p_feature, d, units, tin, tout, tthink, ttotal, twaste,
            kredit, p_model, now())
    on conflict (workspace_id, feature, day)
    do update set
      seconds_used      = public.workspace_ai_usage.seconds_used + units,
      prompt_tokens     = public.workspace_ai_usage.prompt_tokens + tin,
      completion_tokens = public.workspace_ai_usage.completion_tokens + tout,
      thinking_tokens   = public.workspace_ai_usage.thinking_tokens + tthink,
      total_tokens      = public.workspace_ai_usage.total_tokens + ttotal,
      wasted_tokens     = public.workspace_ai_usage.wasted_tokens + twaste,
      credits_used      = public.workspace_ai_usage.credits_used + kredit,
      last_model        = coalesce(p_model, public.workspace_ai_usage.last_model),
      updated_at        = now()
    returning seconds_used into newval;
  else
    insert into public.workspace_ai_usage (
      workspace_id, feature, day, count,
      prompt_tokens, completion_tokens, thinking_tokens, total_tokens,
      wasted_tokens, credits_used, last_model, updated_at
    )
    values (ws, p_feature, d, units, tin, tout, tthink, ttotal, twaste,
            kredit, p_model, now())
    on conflict (workspace_id, feature, day)
    do update set
      count             = public.workspace_ai_usage.count + units,
      prompt_tokens     = public.workspace_ai_usage.prompt_tokens + tin,
      completion_tokens = public.workspace_ai_usage.completion_tokens + tout,
      thinking_tokens   = public.workspace_ai_usage.thinking_tokens + tthink,
      total_tokens      = public.workspace_ai_usage.total_tokens + ttotal,
      wasted_tokens     = public.workspace_ai_usage.wasted_tokens + twaste,
      credits_used      = public.workspace_ai_usage.credits_used + kredit,
      last_model        = coalesce(p_model, public.workspace_ai_usage.last_model),
      updated_at        = now()
    returning count into newval;
  end if;

  -- Tarif yang belum ditetapkan adalah kesalahan konfigurasi yang TIDAK
  -- boleh menggagalkan permintaan pengguna — tapi juga tidak boleh senyap.
  -- Fitur tanpa tarif berarti pemakaian AI gratis tanpa ada yang menyadarinya.
  if tarif is null then
    raise warning 'ai_quota_commit: fitur "%" belum punya tarif di ai_credit_rates — kredit dicatat 0.', p_feature;
  end if;

  return newval;
end;
$$;

revoke all on function public.ai_quota_commit(text, int, int, int, int, int, int, text) from public;
grant execute on function public.ai_quota_commit(text, int, int, int, int, int, int, text) to authenticated;

-- ------------------------------------------------------------
-- 6) Backfill kredit untuk pemakaian yang sudah terlanjur ada
-- ------------------------------------------------------------
-- Ini SATU-SATUNYA tempat kredit dihitung surut, dan hanya karena kolomnya
-- memang belum ada saat pemakaian itu terjadi. Barisnya ditandai
-- credits_estimated = true dan tidak boleh dipakai menagih.
--
-- Syarat `credits_used = 0 and not credits_estimated` membuatnya idempoten:
-- menjalankan ulang tidak menggandakan apa pun, dan tidak menyentuh baris yang
-- kreditnya sudah diukur sungguhan.
update public.workspace_ai_usage u
   set credits_used = round(
         coalesce(public.ai_credit_rate(u.feature, u.day), 0)
         * (case when u.feature = 'voice' then u.seconds_used / 60.0 else u.count end),
         2),
       credits_estimated = true
 where u.credits_used = 0
   and not u.credits_estimated
   and (u.count > 0 or u.seconds_used > 0);

-- ------------------------------------------------------------
-- 7) Ringkasan admin — kini dwi-satuan (kredit + token)
-- ------------------------------------------------------------
-- Tanda tangan sama dengan Fase 0, jadi ini benar-benar mengganti, bukan
-- menambah fungsi kedua.
create or replace function public.admin_ai_telemetry(p_days int default 30)
returns jsonb
language sql stable security definer set search_path = public as $$
  with p as (select greatest(1, least(coalesce(p_days, 30), 365)) as hari)
  select case when not public.is_admin() then '{}'::jsonb else jsonb_build_object(
    'periode_hari', (select hari from p),

    'total_panggilan', (
      select count(*) from public.ai_activity_log
       where created_at > now() - ((select hari from p) || ' days')::interval),

    'total_token', (
      select coalesce(sum(total_tokens), 0) from public.workspace_ai_usage
       where day > (public.ai_today_pacific() - (select hari from p))),

    'token_terbuang', (
      select coalesce(sum(wasted_tokens), 0) from public.workspace_ai_usage
       where day > (public.ai_today_pacific() - (select hari from p))),

    'total_kredit', (
      select coalesce(sum(credits_used), 0) from public.workspace_ai_usage
       where day > (public.ai_today_pacific() - (select hari from p))),

    -- Bagian kredit yang berasal dari backfill, bukan pengukuran. Selama angka
    -- ini belum mendekati nol, laporan biaya belum boleh dipakai menagih.
    'kredit_estimasi', (
      select coalesce(sum(credits_used), 0) from public.workspace_ai_usage
       where credits_estimated
         and day > (public.ai_today_pacific() - (select hari from p))),

    -- Token per kredit = dasar kartu "Harga Pokok per Kredit". Kalau angka ini
    -- naik terus, bobot kredit sebuah fitur kekurangan harga dan tarifnya harus
    -- dikalibrasi ulang di ai_credit_rates.
    'token_per_kredit', (
      select case when coalesce(sum(credits_used), 0) = 0 then null
             else round(sum(total_tokens)::numeric / sum(credits_used), 2) end
        from public.workspace_ai_usage
       where day > (public.ai_today_pacific() - (select hari from p))),

    'outcome', (
      select coalesce(jsonb_object_agg(outcome, n), '{}'::jsonb) from (
        select outcome, count(*) n from public.ai_activity_log
         where created_at > now() - ((select hari from p) || ' days')::interval
         group by outcome) s),

    'fallback_rate', (
      select case when count(*) = 0 then 0
             else round(count(*) filter (where used_fallback) * 100.0 / count(*), 2) end
        from public.ai_activity_log
       where used_fallback is not null
         and created_at > now() - ((select hari from p) || ' days')::interval),

    'per_fitur', (
      select coalesce(jsonb_object_agg(feature, d), '{}'::jsonb) from (
        select u.feature, jsonb_build_object(
                 'panggilan',      sum(u.count),
                 'detik_voice',    sum(u.seconds_used),
                 'token',          sum(u.total_tokens),
                 'token_thinking', sum(u.thinking_tokens),
                 'token_terbuang', sum(u.wasted_tokens),
                 'kredit',         sum(u.credits_used),
                 'tarif_kredit',   public.ai_credit_rate(u.feature),
                 'workspace_aktif', count(distinct u.workspace_id)) d
          from public.workspace_ai_usage u
         where u.day > (public.ai_today_pacific() - (select hari from p))
         group by u.feature) s),

    'latency_per_model', (
      select coalesce(jsonb_object_agg(model, d), '{}'::jsonb) from (
        select model, jsonb_build_object(
                 'n',   count(*),
                 'p50', percentile_disc(0.50) within group (order by latency_ms),
                 'p95', percentile_disc(0.95) within group (order by latency_ms)) d
          from public.ai_activity_log
         where model is not null and latency_ms is not null
           and created_at > now() - ((select hari from p) || ' days')::interval
         group by model) s),

    'workspace_termahal', (
      select coalesce(jsonb_agg(r), '[]'::jsonb) from (
        select u.workspace_id,
               sum(u.total_tokens)  token,
               sum(u.credits_used)  kredit,
               sum(u.count)         panggilan
          from public.workspace_ai_usage u
         where u.day > (public.ai_today_pacific() - (select hari from p))
         group by u.workspace_id
         order by sum(u.credits_used) desc
         limit 10) r)
  ) end;
$$;

grant execute on function public.admin_ai_telemetry(int) to authenticated;

-- ------------------------------------------------------------
-- 8) Ringkasan kredit untuk PEMILIK WORKSPACE (bukan admin)
-- ------------------------------------------------------------
-- Inilah angka yang akan ditampilkan ke pelanggan. Token sengaja TIDAK
-- disertakan: pemilik toko kue tidak punya intuisi soal token, dan menampilkan
-- dua satuan sekaligus hanya memindahkan kebingungan.
--
-- Alokasi/sisa kredit BELUM ada di sini — itu Fase 2 (ai_plans). Fase ini
-- hanya bisa menjawab "sudah terpakai berapa", belum "dari jatah berapa".
create or replace function public.my_ai_credits(p_days int default 30)
returns jsonb
language sql stable security definer set search_path = public as $$
  with p as (select greatest(1, least(coalesce(p_days, 30), 365)) as hari),
  ws as (select public.ai_workspace_id() as id)
  select case when (select id from ws) is null then '{}'::jsonb else jsonb_build_object(
    'periode_hari', (select hari from p),
    'kredit_terpakai', (
      select coalesce(sum(credits_used), 0) from public.workspace_ai_usage
       where workspace_id = (select id from ws)
         and day > (public.ai_today_pacific() - (select hari from p))),
    'kredit_hari_ini', (
      select coalesce(sum(credits_used), 0) from public.workspace_ai_usage
       where workspace_id = (select id from ws)
         and day = public.ai_today_pacific()),
    'per_fitur', (
      select coalesce(jsonb_object_agg(feature, kredit), '{}'::jsonb) from (
        select feature, sum(credits_used) kredit
          from public.workspace_ai_usage
         where workspace_id = (select id from ws)
           and day > (public.ai_today_pacific() - (select hari from p))
         group by feature) s)
  ) end;
$$;

grant execute on function public.my_ai_credits(int) to authenticated;

-- ============================================================
-- SELESAI.
--
-- TIDAK perlu deploy ulang Edge Function untuk fase ini: kredit dihitung
-- seluruhnya di dalam ai_quota_commit, dan tanda tangan RPC-nya tidak berubah.
-- Fungsi yang sudah ter-deploy akan langsung mulai mengakumulasi kredit.
--
-- Fase berikutnya (2): ai_plans + workspace_ai_policy + ai_quota_resolve(),
-- yang memberi kredit sebuah PLAFON — sampai saat itu kredit hanya bertambah,
-- belum membatasi apa pun.
-- ============================================================
