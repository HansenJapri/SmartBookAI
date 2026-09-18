-- ============================================================
-- KUOTA AI DITAGIH KE WORKSPACE YANG SEDANG DIBUKA
--
-- Jalankan SETELAH migration_ai_quota_semua_pengguna.sql. Aman diulang.
-- WAJIB deploy ulang 8 Edge Function AI setelah ini (lihat kaki berkas).
-- ============================================================
-- BUG: satu permintaan AI bisa MEMBACA data workspace A tapi MENAGIH kuota
-- workspace B.
--
-- Tiga lapis menentukan "workspace mana", dan hanya dua yang sepakat:
--
--   effectiveOwnerId()  src/lib/api.js            → tanpa pilihan = SENDIRI
--   resolveScope()      _shared/ai/workspace-scope.ts → pilihan klien, diverifikasi
--   ai_workspace_id()   database                  → SELALU majikan bila staf aktif
--
-- Lapis ketiga mengabaikan workspace yang sedang dibuka:
--
--     select coalesce(
--       (select m.owner_id from staff_members m
--         where m.member_id = auth.uid() and m.status = 'active' limit 1),
--       auth.uid());
--
-- Akibatnya staf yang sedang membuka USAHANYA SENDIRI tetap memotong kredit,
-- token, dan batas harian majikannya — sementara jawabannya disusun dari data
-- usahanya sendiri. Aturan dasar aplikasi (src/lib/api.js) menyatakan setiap
-- pengguna SELALU memiliki workspace-nya sendiri dan keanggotaan staf bersifat
-- TAMBAHAN; ai_workspace_id() adalah sisa asumsi lama yang bertentangan.
--
-- Ada pula `limit 1` TANPA ORDER BY: bila seseorang menjadi staf aktif di
-- lebih dari satu workspace — yang menurut komentar di src/lib/api.js memang
-- sah — majikan mana yang tertagih tidak ditentukan oleh apa pun.
--
-- PERBAIKAN: kuota mengikuti workspace yang sama dengan yang dibaca, yaitu
-- `scope.owner` dari resolveScope(). Nilainya datang dari klien, jadi TIDAK
-- dipercaya begitu saja — resolve_owner() memverifikasi keanggotaan aktif dan
-- melempar insufficient_privilege bila tidak sah.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Satu tempat untuk aturannya
-- ------------------------------------------------------------
-- Tiga fungsi di bawah butuh resolusi yang sama. Menyalinnya tiga kali berarti
-- tiga salinan yang harus berubah bersama selamanya, dan yang ketiga selalu
-- tertinggal.
--
-- p_workspace NULL = pemanggil LAMA yang belum di-deploy ulang. Ia mundur ke
-- perilaku lama, bukan ke workspace sendiri, supaya jendela deploy tidak
-- mengubah penagihan di tengah jalan. Setelah kedelapan Edge Function
-- mengirimkan workspace-nya, cabang ini tidak pernah lagi tereksekusi.
create or replace function public.ai_scope_workspace(p_workspace uuid default null)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_workspace is null then public.ai_workspace_id()
    else public.resolve_owner(p_workspace)
  end;
$$;

revoke all on function public.ai_scope_workspace(uuid) from public;
grant execute on function public.ai_scope_workspace(uuid) to authenticated;

comment on function public.ai_scope_workspace(uuid) is
  'Workspace yang ditagih untuk satu permintaan AI. p_workspace diverifikasi resolve_owner(); NULL = jalur kompatibilitas untuk Edge Function yang belum di-deploy ulang.';

-- ------------------------------------------------------------
-- 2) Pemeriksaan kuota
-- ------------------------------------------------------------
-- DROP DULU. `create or replace` dengan parameter TAMBAHAN tidak mengganti
-- fungsi lama melainkan membuat fungsi KEDUA, lalu pemanggilan dua-argumen
-- menjadi ambigu (SQLSTATE 42725) dan seluruh fitur AI mati serentak. Persis
-- kejadian yang tercatat di kepala migration_ai_telemetry.sql.
drop function if exists public.ai_quota_resolve(text, int);

create or replace function public.ai_quota_resolve(
  p_feature      text,
  p_fallback_cap int,
  p_workspace    uuid default null
)
returns table (
  allowed          boolean,
  blocked_by       text,
  daily_used       int,
  daily_cap        int,
  daily_reset_at   timestamptz,
  credits_used     numeric,
  credits_cap      numeric,
  cycle_start      date,
  cycle_end        date,
  plan_code        text,
  tokens_day       bigint,
  tokens_day_cap   bigint,
  tokens_cycle     bigint,
  tokens_cycle_cap bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ws        uuid := public.ai_scope_workspace(p_workspace);
  d         date := public.ai_today_pacific();
  pol       public.workspace_ai_policy%rowtype;
  pl        public.ai_plans%rowtype;
  v_cap     int;
  v_used    int := 0;
  v_kredit_cap  numeric;
  v_kredit_used numeric := 0;
  v_mulai   date;
  v_akhir   date;
  v_blok    text := null;
  v_tok_hari      bigint := 0;
  v_tok_siklus    bigint := 0;
  v_tok_hari_cap  bigint;
  v_tok_siklus_cap bigint;
begin
  if ws is null then
    return query select false, 'no_workspace', 0, p_fallback_cap, now(),
                        0::numeric, null::numeric, d, d, 'free',
                        0::bigint, null::bigint, 0::bigint, null::bigint;
    return;
  end if;

  select * into pol from public.workspace_ai_policy where workspace_id = ws;
  select * into pl  from public.ai_plans where code = coalesce(pol.plan_code, 'free');
  if pl.code is null then
    select * into pl from public.ai_plans where code = 'free';
  end if;

  v_mulai := public.ai_cycle_start(coalesce(pol.cycle_anchor_day, 1));
  v_akhir := (v_mulai + interval '1 month' - interval '1 day')::date;

  v_cap := coalesce(
    nullif(pol.daily_caps_override ->> p_feature, '')::int,
    nullif(pl.daily_caps           ->> p_feature, '')::int,
    (select f.default_cap from public.ai_feature_defaults f where f.feature = p_feature),
    p_fallback_cap
  );

  select case when p_feature = 'voice' then u.seconds_used else u.count end
    into v_used
    from public.workspace_ai_usage u
   where u.workspace_id = ws and u.feature = p_feature and u.day = d;
  v_used := coalesce(v_used, 0);

  v_kredit_cap := coalesce(pol.monthly_credit_override, pl.monthly_credit_cap);

  select coalesce(sum(u.credits_used), 0)
    into v_kredit_used
    from public.workspace_ai_usage u
   where u.workspace_id = ws and u.day >= v_mulai and u.day <= d;

  select coalesce(sum(u.total_tokens), 0)
    into v_tok_hari
    from public.workspace_ai_usage u
   where u.workspace_id = ws and u.day = d;

  select coalesce(sum(u.total_tokens), 0)
    into v_tok_siklus
    from public.workspace_ai_usage u
   where u.workspace_id = ws and u.day >= v_mulai and u.day <= d;

  v_tok_hari_cap   := coalesce(pol.token_cap_daily,   pl.token_cap_daily);
  v_tok_siklus_cap := coalesce(pol.token_cap_monthly, pl.token_cap_monthly);

  if coalesce(pol.suspended, false) then
    v_blok := 'suspended';
  elsif v_tok_siklus_cap is not null and v_tok_siklus >= v_tok_siklus_cap then
    v_blok := 'tokens_monthly';
  elsif v_tok_hari_cap is not null and v_tok_hari >= v_tok_hari_cap then
    v_blok := 'tokens_daily';
  elsif v_kredit_cap is not null and v_kredit_used >= v_kredit_cap then
    v_blok := 'credits';
  elsif v_used >= v_cap then
    v_blok := 'daily';
  end if;

  return query select
    v_blok is null, v_blok, v_used, v_cap,
    (((d + 1)::text || ' 00:00:00')::timestamp at time zone 'America/Los_Angeles'),
    round(v_kredit_used, 2), v_kredit_cap, v_mulai, v_akhir, pl.code,
    v_tok_hari, v_tok_hari_cap, v_tok_siklus, v_tok_siklus_cap;
end;
$$;

revoke all on function public.ai_quota_resolve(text, int, uuid) from public;
grant execute on function public.ai_quota_resolve(text, int, uuid) to authenticated;

-- ------------------------------------------------------------
-- 3) Pencatatan pemakaian
-- ------------------------------------------------------------
drop function if exists public.ai_quota_commit(text, int, int, int, int, int, int, text);

create or replace function public.ai_quota_commit(
  p_feature           text,
  p_units             int  default 1,
  p_prompt_tokens     int  default 0,
  p_completion_tokens int  default 0,
  p_thinking_tokens   int  default 0,
  p_total_tokens      int  default 0,
  p_wasted_tokens     int  default 0,
  p_model             text default null,
  p_workspace         uuid default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  ws      uuid := public.ai_scope_workspace(p_workspace);
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

  -- Voice ditarifkan per MENIT sementara units-nya DETIK, jadi akrualnya
  -- PECAHAN, tidak dibulatkan ke atas per commit: empat sesi 30 detik akan
  -- ditagih 4 x 5 = 20 kredit untuk pemakaian yang sebenarnya 2 menit.
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

  if tarif is null then
    raise warning 'ai_quota_commit: fitur "%" belum punya tarif di ai_credit_rates — kredit dicatat 0.', p_feature;
  end if;

  return newval;
end;
$$;

revoke all on function public.ai_quota_commit(text, int, int, int, int, int, int, text, uuid) from public;
grant execute on function public.ai_quota_commit(text, int, int, int, int, int, int, text, uuid) to authenticated;

-- ------------------------------------------------------------
-- 4) Ringkasan kredit pelanggan ikut workspace yang dibuka
-- ------------------------------------------------------------
-- Tanpa ini, staf yang membuka usahanya sendiri melihat sisa kredit MAJIKANNYA
-- di halaman Pengaturan, sementara pemakaiannya dicatat ke workspace-nya
-- sendiri. Dua angka yang saling bertentangan di layar yang sama.
drop function if exists public.my_ai_credits();

create or replace function public.my_ai_credits(p_workspace uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  ws     uuid := public.ai_scope_workspace(p_workspace);
  pol    public.workspace_ai_policy%rowtype;
  pl     public.ai_plans%rowtype;
  mulai  date;
  akhir  date;
  pakai  numeric := 0;
  jatah  numeric;
begin
  if ws is null then return '{}'::jsonb; end if;

  select * into pol from public.workspace_ai_policy where workspace_id = ws;
  select * into pl  from public.ai_plans where code = coalesce(pol.plan_code, 'free');
  if pl.code is null then select * into pl from public.ai_plans where code = 'free'; end if;

  mulai := public.ai_cycle_start(coalesce(pol.cycle_anchor_day, 1));
  akhir := (mulai + interval '1 month' - interval '1 day')::date;
  jatah := coalesce(pol.monthly_credit_override, pl.monthly_credit_cap);

  select coalesce(sum(u.credits_used), 0) into pakai
    from public.workspace_ai_usage u
   where u.workspace_id = ws and u.day >= mulai and u.day <= public.ai_today_pacific();

  return jsonb_build_object(
    'paket',            pl.code,
    'paket_label',      pl.label,
    'kredit_terpakai',  round(pakai, 2),
    'kredit_jatah',     jatah,
    'kredit_sisa',      case when jatah is null then null else greatest(0, round(jatah - pakai, 2)) end,
    'persen',           case when jatah is null or jatah = 0 then null
                             else round(pakai * 100 / jatah, 1) end,
    'status',           case
                          when jatah is null then 'aman'
                          when pakai >= jatah then 'penuh'
                          when pakai * 100 / jatah >= 90 then 'kritis'
                          when pakai * 100 / jatah >= 75 then 'peringatan'
                          else 'aman' end,
    'siklus_mulai',     mulai,
    'siklus_selesai',   akhir,
    'seat_terpakai',    public.ai_seat_count(ws),
    'seat_maks',        public.ai_seat_limit(ws),
    'ditangguhkan',     coalesce(pol.suspended, false)
  );
end;
$$;

revoke all on function public.my_ai_credits(uuid) from public;
grant execute on function public.my_ai_credits(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5) RLS pemakaian: jangan kunci orang dari datanya sendiri
-- ------------------------------------------------------------
-- Policy lama `workspace_id = ai_workspace_id()` hanya mengizinkan SATU
-- workspace — milik majikan, bagi staf aktif. Setelah pemakaian mulai dicatat
-- ke workspace yang benar, staf tidak akan bisa membaca baris pemakaian
-- USAHANYA SENDIRI: datanya ada, tercatat atas namanya, dan tidak terlihat.
--
-- Aturan barunya persis sama dengan resolve_owner(): workspace sendiri, atau
-- workspace mana pun tempat ia menjadi staf aktif.
drop policy if exists "wau select own workspace" on public.workspace_ai_usage;
create policy "wau select own workspace" on public.workspace_ai_usage
  for select to authenticated
  using (
    workspace_id = auth.uid()
    or exists (
      select 1 from public.staff_members m
       where m.owner_id = workspace_id
         and m.member_id = auth.uid()
         and m.status = 'active'
    )
  );

-- ============================================================
-- SELESAI. WAJIB deploy ulang 8 Edge Function AI setelah ini — sampai itu
-- terjadi, semuanya memanggil tanpa p_workspace dan mundur ke perilaku lama:
--
--   supabase functions deploy BukuPencatatan BukuPencatatanStruk ai-catat \
--     ai-crud ai-narasi ai-hpp-draft ai-stok-insight voice-live-token \
--     --project-ref vbzmtnpmtgrhovmwjqqk
--
-- ai_workspace_id() SENGAJA tidak dihapus: ia masih dipakai sebagai jalur
-- mundur di ai_scope_workspace(), dan menghapusnya berarti setiap fungsi yang
-- belum sempat di-deploy ulang mati seketika.
-- ============================================================
