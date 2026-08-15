-- ============================================================
-- FASE 0 — TELEMETRI TOKEN & LATENCY AI
--
-- Jalankan SETELAH migration_ai_workspace_quota.sql dan migration_audit_ai.sql.
-- Aman diulang (idempotent).
--
-- MASALAH YANG DIPERBAIKI: sampai sekarang tidak ada SATU TOKEN PUN yang
-- dicatat. `ai_quota_commit` menghitung JUMLAH PANGGILAN, dan `GenerateResult`
-- di gemini-client.ts tidak pernah membaca `usageMetadata` dari Google.
-- Akibatnya biaya nyata per workspace hanya bisa ditebak dari rata-rata —
-- dan tebakan tidak boleh dipakai untuk menagih siapa pun.
--
-- Migrasi ini MURNI ADITIF. Semua kolom baru punya default, dan seluruh
-- parameter baru pada RPC punya nilai bawaan, sehingga Edge Function versi
-- LAMA yang masih ter-deploy tetap berjalan tanpa perubahan perilaku.
-- Urutan deploy karena itu bebas: migrasi dulu atau fungsi dulu, sama saja.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Kolom token pada penghitung pemakaian
-- ------------------------------------------------------------
-- Angka-angka ini adalah BASIS PENAGIHAN, bukan telemetri diagnostik. Ia tidak
-- pernah dihapus oleh job retensi (lihat catatan di bagian 5).
alter table public.workspace_ai_usage
  add column if not exists prompt_tokens     bigint not null default 0,
  add column if not exists completion_tokens bigint not null default 0,
  add column if not exists thinking_tokens   bigint not null default 0,
  add column if not exists total_tokens      bigint not null default 0,
  -- Token yang terbakar pada percobaan yang dibuang (jawaban datang tapi gagal
  -- validasi, lalu diulang ke model lain). Google tetap menagihnya. Dipisah
  -- dari total_tokens supaya biaya retry tidak menyamar jadi biaya normal.
  add column if not exists wasted_tokens     bigint not null default 0,
  -- Model terakhir yang dipakai pada hari itu. Bukan riwayat lengkap — untuk
  -- itu ada ai_activity_log. Cukup untuk menjawab "hari itu fitur ini jalan di
  -- model apa" tanpa join.
  add column if not exists last_model        text;

comment on column public.workspace_ai_usage.thinking_tokens is
  'Token "thinking" ditagih Google walau tidak satu huruf pun sampai ke pengguna. '
  'Dipisah karena pernah memakan habis maxOutputTokens di makro-harian sehingga '
  'JSON terpotong dan seluruh sinyal jatuh ke "stabil" tanpa satu error pun muncul.';

-- ------------------------------------------------------------
-- 2) Kolom telemetri pada jejak aktivitas
-- ------------------------------------------------------------
-- Kolom TERPISAH, bukan diselipkan ke `meta` jsonb: angka yang akan diagregasi
-- (p95 latency, total token, fallback rate) harus bisa di-index dan dijumlahkan
-- SQL biasa. Di dalam jsonb, setiap grafik admin membayar ongkos parse per baris.
alter table public.ai_activity_log
  add column if not exists model         text,
  add column if not exists key_slot      text,
  add column if not exists latency_ms    int,
  add column if not exists tokens_in     int,
  add column if not exists tokens_out    int,
  add column if not exists used_fallback boolean,
  add column if not exists error_code    text;

-- Baris lama tetap NULL — artinya "tidak terukur", BUKAN "nol". Membedakan
-- keduanya penting: nol di kolom biaya terbaca sebagai gratis.

-- Index untuk agregasi dashboard admin (tren per fitur, p95 latency per model).
create index if not exists idx_ai_activity_feature_time
  on public.ai_activity_log (feature, created_at desc);

create index if not exists idx_ai_activity_model_time
  on public.ai_activity_log (model, created_at desc)
  where model is not null;

-- Pemburuan masalah: hanya baris yang gagal atau kena limit.
create index if not exists idx_ai_activity_outcome_time
  on public.ai_activity_log (outcome, created_at desc)
  where outcome <> 'ok';

-- ------------------------------------------------------------
-- 3) RPC ai_quota_commit — versi bertelemetri
-- ------------------------------------------------------------
-- Fungsi LAMA harus di-DROP lebih dulu. `create or replace` dengan parameter
-- tambahan TIDAK mengganti fungsi lama melainkan membuat fungsi KEDUA, dan
-- pemanggilan `ai_quota_commit(p_feature, p_units)` lalu menjadi ambigu
-- (SQLSTATE 42725) — seluruh fitur AI mati serentak. Drop + create di dalam
-- satu skrip migrasi ini berjalan dalam satu transaksi.
drop function if exists public.ai_quota_commit(text, int);

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
  -- p_units = 0 BOLEH, dan artinya khusus: "catat tokennya saja, jangan
  -- naikkan penghitung kuota". Dipakai saat Gemini menjawab tapi jawabannya
  -- dibuang (narasi terpotong MAX_TOKENS, bahasa salah, checksum struk gagal).
  -- Pengguna tidak boleh tertagih kuota untuk sesuatu yang tidak mereka terima,
  -- tapi Google TETAP menagih tokennya — dan biaya itu harus tetap terlihat.
  -- Batas bawahnya 0, bukan 1 seperti versi lama; default parameter tetap 1
  -- sehingga seluruh pemanggil lama berperilaku persis sama.
  units   int  := greatest(0, coalesce(p_units, 1));
  -- BATAS KEWARASAN. Fungsi ini di-grant ke `authenticated`, dan Edge Function
  -- memanggilnya dengan JWT pengguna — jadi klien yang dimodifikasi bisa
  -- memanggilnya langsung dengan angka karangan. Ia tidak bisa MENGURANGI
  -- pemakaiannya sendiri (operasinya penjumlahan), tapi tanpa batas ini ia bisa
  -- mengotori data biaya dengan angka absurd. 2 juta token jauh di atas
  -- panggilan nyata mana pun di aplikasi ini.
  maks    int  := 2000000;
  tin     int  := least(greatest(0, coalesce(p_prompt_tokens, 0)), maks);
  tout    int  := least(greatest(0, coalesce(p_completion_tokens, 0)), maks);
  tthink  int  := least(greatest(0, coalesce(p_thinking_tokens, 0)), maks);
  ttotal  int  := least(greatest(0, coalesce(p_total_tokens, 0)), maks);
  twaste  int  := least(greatest(0, coalesce(p_wasted_tokens, 0)), maks);
begin
  if ws is null then return 0; end if;

  -- Bila pemanggil tidak mengirim total (Edge Function versi lama), susun
  -- sendiri dari komponennya. Nol yang dibiarkan lolos akan terbaca "gratis".
  if ttotal = 0 then
    ttotal := least(tin + tout + tthink, maks);
  end if;

  if p_feature = 'voice' then
    insert into public.workspace_ai_usage (
      workspace_id, feature, day, seconds_used,
      prompt_tokens, completion_tokens, thinking_tokens, total_tokens,
      wasted_tokens, last_model, updated_at
    )
    values (ws, p_feature, d, units, tin, tout, tthink, ttotal, twaste,
            coalesce(p_model, null), now())
    on conflict (workspace_id, feature, day)
    do update set
      seconds_used      = public.workspace_ai_usage.seconds_used + units,
      prompt_tokens     = public.workspace_ai_usage.prompt_tokens + tin,
      completion_tokens = public.workspace_ai_usage.completion_tokens + tout,
      thinking_tokens   = public.workspace_ai_usage.thinking_tokens + tthink,
      total_tokens      = public.workspace_ai_usage.total_tokens + ttotal,
      wasted_tokens     = public.workspace_ai_usage.wasted_tokens + twaste,
      last_model        = coalesce(p_model, public.workspace_ai_usage.last_model),
      updated_at        = now()
    returning seconds_used into newval;
  else
    insert into public.workspace_ai_usage (
      workspace_id, feature, day, count,
      prompt_tokens, completion_tokens, thinking_tokens, total_tokens,
      wasted_tokens, last_model, updated_at
    )
    values (ws, p_feature, d, units, tin, tout, tthink, ttotal, twaste,
            coalesce(p_model, null), now())
    on conflict (workspace_id, feature, day)
    do update set
      count             = public.workspace_ai_usage.count + units,
      prompt_tokens     = public.workspace_ai_usage.prompt_tokens + tin,
      completion_tokens = public.workspace_ai_usage.completion_tokens + tout,
      thinking_tokens   = public.workspace_ai_usage.thinking_tokens + tthink,
      total_tokens      = public.workspace_ai_usage.total_tokens + ttotal,
      wasted_tokens     = public.workspace_ai_usage.wasted_tokens + twaste,
      last_model        = coalesce(p_model, public.workspace_ai_usage.last_model),
      updated_at        = now()
    returning count into newval;
  end if;

  return newval;
end;
$$;

revoke all on function public.ai_quota_commit(text, int, int, int, int, int, int, text) from public;
grant execute on function public.ai_quota_commit(text, int, int, int, int, int, int, text) to authenticated;

-- ------------------------------------------------------------
-- 4) Ringkasan telemetri untuk dashboard admin
-- ------------------------------------------------------------
-- Sejalan pola admin_metrics() yang sudah ada: satu jsonb, dijaga is_admin(),
-- non-admin tidak mendapat baris apa pun.
create or replace function public.admin_ai_telemetry(p_days int default 30)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then '{}'::jsonb else jsonb_build_object(
    'periode_hari', greatest(1, least(coalesce(p_days, 30), 365)),

    'total_panggilan', (
      select count(*) from public.ai_activity_log
       where created_at > now() - (greatest(1, least(coalesce(p_days,30),365)) || ' days')::interval),

    'total_token', (
      select coalesce(sum(total_tokens), 0) from public.workspace_ai_usage
       where day > (public.ai_today_pacific() - greatest(1, least(coalesce(p_days,30),365)))),

    'token_terbuang', (
      select coalesce(sum(wasted_tokens), 0) from public.workspace_ai_usage
       where day > (public.ai_today_pacific() - greatest(1, least(coalesce(p_days,30),365)))),

    -- Rasio outcome: dasar kartu "Error & Fallback Rate".
    'outcome', (
      select coalesce(jsonb_object_agg(outcome, n), '{}'::jsonb) from (
        select outcome, count(*) n from public.ai_activity_log
         where created_at > now() - (greatest(1, least(coalesce(p_days,30),365)) || ' days')::interval
         group by outcome) s),

    -- Sinyal paling dini bahwa Google memangkas sebuah model: fallback naik
    -- sebelum ada satu pun error sampai ke pengguna.
    'fallback_rate', (
      select case when count(*) = 0 then 0
             else round(count(*) filter (where used_fallback) * 100.0 / count(*), 2) end
        from public.ai_activity_log
       where used_fallback is not null
         and created_at > now() - (greatest(1, least(coalesce(p_days,30),365)) || ' days')::interval),

    'per_fitur', (
      select coalesce(jsonb_object_agg(feature, d), '{}'::jsonb) from (
        select u.feature, jsonb_build_object(
                 'panggilan',  sum(u.count),
                 'detik_voice', sum(u.seconds_used),
                 'token',      sum(u.total_tokens),
                 'token_thinking', sum(u.thinking_tokens),
                 'token_terbuang', sum(u.wasted_tokens),
                 'workspace_aktif', count(distinct u.workspace_id)) d
          from public.workspace_ai_usage u
         where u.day > (public.ai_today_pacific() - greatest(1, least(coalesce(p_days,30),365)))
         group by u.feature) s),

    'latency_per_model', (
      select coalesce(jsonb_object_agg(model, d), '{}'::jsonb) from (
        select model, jsonb_build_object(
                 'n',   count(*),
                 'p50', percentile_disc(0.50) within group (order by latency_ms),
                 'p95', percentile_disc(0.95) within group (order by latency_ms)) d
          from public.ai_activity_log
         where model is not null and latency_ms is not null
           and created_at > now() - (greatest(1, least(coalesce(p_days,30),365)) || ' days')::interval
         group by model) s),

    'workspace_termahal', (
      select coalesce(jsonb_agg(r), '[]'::jsonb) from (
        select u.workspace_id, sum(u.total_tokens) token, sum(u.count) panggilan
          from public.workspace_ai_usage u
         where u.day > (public.ai_today_pacific() - greatest(1, least(coalesce(p_days,30),365)))
         group by u.workspace_id
         order by sum(u.total_tokens) desc
         limit 10) r)
  ) end;
$$;

grant execute on function public.admin_ai_telemetry(int) to authenticated;

-- ------------------------------------------------------------
-- 5) Catatan retensi (BELUM diaktifkan — sengaja)
-- ------------------------------------------------------------
-- Kebijakan yang disepakati:
--   ai_activity_log      → mentah 90 hari, lalu purge
--   workspace_ai_usage   → PERMANEN (basis penagihan, ukurannya kecil)
--   admin_quota_actions  → PERMANEN, tanpa jalur hapus (belum dibuat, Fase 4)
--
-- Job purge TIDAK dipasang di sini dengan sengaja. Rollup bulanan belum ada,
-- jadi menghapus baris mentah sekarang berarti membuang data yang belum pernah
-- teragregasi — dan itu tidak bisa dibatalkan. Pasang purge pada Fase 4,
-- SETELAH backfill rollup berjalan.

-- ============================================================
-- SELESAI. Setelah dijalankan, DEPLOY ULANG seluruh Edge Function AI agar
-- mulai mengirim telemetri. Tanpa deploy, semuanya tetap berjalan normal —
-- kolom baru hanya akan tetap 0.
-- ============================================================
