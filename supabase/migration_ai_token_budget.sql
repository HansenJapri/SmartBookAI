-- ============================================================
-- ANGGARAN TOKEN PER AKUN — batas harian & bulanan yang diatur admin
--
-- Jalankan SETELAH migration_admin_kuota_kontrol.sql. Aman diulang.
--
-- ------------------------------------------------------------
-- KENAPA TOKEN, PADAHAL SUDAH ADA KREDIT
-- ------------------------------------------------------------
-- Kredit adalah satuan KOMERSIAL (yang dijual, dan yang dimengerti pemilik
-- toko). Token adalah satuan BIAYA (yang ditagih Google). Keduanya sudah lama
-- ada berdampingan, tapi sampai hari ini hanya kredit yang bisa dibatasi —
-- dan kredit ternyata TIDAK melacak biaya dengan baik.
--
-- Diukur dari pemakaian nyata project ini (per 17 September 2026):
--
--   fitur       token/panggilan   tarif kredit   token per 1 kredit
--   crud             7.433             1             7.433
--   chat             4.316             1             4.316
--   hpp_draft        2.094             3               698
--
-- Satu kredit yang dibelanjakan di `crud` memakan 10x lebih banyak token
-- daripada satu kredit di `hpp_draft`. Akibatnya, paket Free 300 kredit bisa
-- berarti 209.000 token (kalau semua dipakai untuk hpp_draft) ATAU 2.230.000
-- token (kalau semua untuk crud) — rentang sepuluh kali lipat untuk harga
-- yang sama persis.
--
-- Selama jarak itu ada, "batasi kreditnya" bukan pengendalian biaya. Batas
-- token inilah plafon Rupiah yang sebenarnya.
--
-- ------------------------------------------------------------
-- KENAPA DUA BATAS, BUKAN SATU
-- ------------------------------------------------------------
-- BULANAN adalah anggarannya. UMKM memakai aplikasi ini secara bergelombang:
-- tenang sepanjang minggu, lalu meledak saat stok opname dan tutup buku.
-- Batas harian yang cukup untuk hari sibuk akan terlalu longgar untuk 27 hari
-- lainnya; batas harian yang pas untuk hari biasa akan mematikan fitur persis
-- di hari pengguna paling membutuhkannya.
--
-- HARIAN adalah rem daruratnya, bukan anggaran kedua. Ia menangkap satu hal
-- yang tidak bisa ditangkap batas bulanan: kejadian yang membakar seluruh
-- jatah sebulan dalam satu sore — skrip yang mengulang, integrasi yang
-- ngelantur, atau penyalahgunaan. Tanpa itu, batas bulanan baru terasa setelah
-- uangnya habis.
--
-- Karena itu keduanya opsional dan berdiri sendiri: null = tanpa batas.
-- Anjuran pemakaian ada di komentar `token_cap_daily` di bawah.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Kolom batas
-- ------------------------------------------------------------
alter table public.workspace_ai_policy
  add column if not exists token_cap_daily   bigint,
  add column if not exists token_cap_monthly bigint;

do $$ begin
  alter table public.workspace_ai_policy
    add constraint wap_token_cap_daily_positif
    check (token_cap_daily is null or token_cap_daily >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.workspace_ai_policy
    add constraint wap_token_cap_monthly_positif
    check (token_cap_monthly is null or token_cap_monthly >= 0);
exception when duplicate_object then null; end $$;

comment on column public.workspace_ai_policy.token_cap_monthly is
  'Anggaran token per siklus. null = tanpa batas. Ini plafon biaya yang sebenarnya — kredit tidak melacak biaya dengan baik (lihat kepala migrasi).';
comment on column public.workspace_ai_policy.token_cap_daily is
  'Rem darurat, BUKAN anggaran kedua. Anjuran: 15-20% dari batas bulanan — cukup longgar untuk hari tutup buku, cukup ketat untuk menangkap skrip yang mengulang sebelum jatah sebulan habis dalam satu sore. null = tanpa batas.';

-- Nilai default paket, supaya akun baru tidak otomatis tanpa batas.
alter table public.ai_plans
  add column if not exists token_cap_daily   bigint,
  add column if not exists token_cap_monthly bigint;

-- Dihitung dari pemakaian nyata, bukan angka bulat yang enak dilihat.
-- Free  300 kredit. Skenario terburuk (semua crud) = 2,23 juta token. Plafon
--       dipasang 2,5 juta: menampung pemakaian terburuk yang sah, sekaligus
--       tetap menjadi atap bila ada yang lepas kendali.
-- Pro   1.500 kredit → 5x Free, tapi plafon token TIDAK ikut 5x. Pengguna Pro
--       memakai campuran fitur yang lebih beragam, jadi token per kredit
--       rata-ratanya lebih rendah daripada skenario terburuk Free.
-- Harian = 20% bulanan, kecuali Free yang 25% karena angkanya kecil dan hari
--       tutup buku pada workspace kecil sangat timpang terhadap rata-rata.
update public.ai_plans set token_cap_monthly = 2500000, token_cap_daily = 625000 where code = 'free'       and token_cap_monthly is null;
update public.ai_plans set token_cap_monthly = 10000000, token_cap_daily = 2000000 where code = 'pro'        and token_cap_monthly is null;
update public.ai_plans set token_cap_monthly = 35000000, token_cap_daily = 7000000 where code = 'bisnis'     and token_cap_monthly is null;
-- Enterprise sengaja null/null: tanpa batas, sejalan dengan monthly_credit_cap.
update public.ai_plans set token_cap_monthly = null,     token_cap_daily = null     where code = 'enterprise';

-- ------------------------------------------------------------
-- 2) Rantai resolusi: dua penghitung jadi empat
-- ------------------------------------------------------------
--
-- URUTAN PEMERIKSAAN MENENTUKAN KALIMAT YANG DIBACA PENGGUNA, dan tiap sebab
-- menuntut tindakan yang berbeda:
--
--   suspended       admin mematikan sengaja      → hubungi admin
--   tokens_monthly  anggaran biaya habis         → hubungi admin (tak bisa dibeli)
--   tokens_daily    rem darurat aktif            → tunggu besok
--   credits         jatah komersial habis        → beli / upgrade SEKARANG
--   daily           guardrail teknis per fitur   → tunggu reset
--
-- Batas token didahulukan daripada kredit dengan sengaja: ia adalah keputusan
-- ADMIN, sedangkan kredit adalah keadaan akun. Menyuruh pengguna membeli
-- kredit padahal yang memblokir adalah plafon admin berarti menjual sesuatu
-- yang tidak akan menyelesaikan masalahnya.
create or replace function public.ai_quota_resolve(
  p_feature      text,
  p_fallback_cap int
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
  ws        uuid := public.ai_workspace_id();
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

  -- Token: SELURUH fitur dijumlahkan, bukan per fitur. Anggaran biaya tidak
  -- peduli uangnya habis di OCR atau di chat — yang penting berapa totalnya.
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

revoke all on function public.ai_quota_resolve(text, int) from public;
grant execute on function public.ai_quota_resolve(text, int) to authenticated;

-- ------------------------------------------------------------
-- 3) RPC admin: atur anggaran token
-- ------------------------------------------------------------
do $$ begin
  alter table public.admin_quota_actions drop constraint admin_quota_actions_action_check;
exception when undefined_object then null; end $$;

alter table public.admin_quota_actions
  add constraint admin_quota_actions_action_check check (action in (
    'set_daily_cap', 'clear_daily_cap', 'set_plan',
    'set_credit_override', 'clear_credit_override',
    'suspend', 'unsuspend',
    'set_token_cap', 'clear_token_cap'
  ));

create or replace function public.admin_set_token_cap(
  p_workspace uuid,
  p_periode   text,        -- 'harian' | 'bulanan'
  p_tokens    bigint,      -- null = kembali mengikuti paket
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pol  public.workspace_ai_policy%rowtype;
  lama bigint;
begin
  perform public.admin__jaga(p_workspace);

  if p_periode not in ('harian', 'bulanan') then
    raise exception 'Periode harus "harian" atau "bulanan", bukan "%"', p_periode
      using errcode = 'invalid_parameter_value';
  end if;
  if p_tokens is not null and p_tokens < 0 then
    raise exception 'Batas token tidak boleh negatif' using errcode = 'invalid_parameter_value';
  end if;

  pol := public.admin__pastikan_policy(p_workspace);

  if p_periode = 'harian' then
    lama := pol.token_cap_daily;
    update public.workspace_ai_policy
       set token_cap_daily = p_tokens, updated_by = auth.uid(), updated_at = now()
     where workspace_id = p_workspace;
  else
    lama := pol.token_cap_monthly;
    -- Batas harian yang melebihi batas bulanan tidak pernah bisa tercapai —
    -- rem yang dipasang di belakang tembok. Ditolak, bukan diam-diam
    -- diperbaiki: admin yang mengetiknya jelas salah satu angkanya.
    if p_tokens is not null
       and coalesce(pol.token_cap_daily, 0) > p_tokens then
      raise exception 'Batas bulanan (%) lebih kecil daripada batas harian (%). Turunkan batas hariannya lebih dulu.',
        p_tokens, pol.token_cap_daily
        using errcode = 'invalid_parameter_value';
    end if;
    update public.workspace_ai_policy
       set token_cap_monthly = p_tokens, updated_by = auth.uid(), updated_at = now()
     where workspace_id = p_workspace;
  end if;

  insert into public.admin_quota_actions
    (workspace_id, action, feature, before_value, after_value, note)
  values
    (p_workspace,
     case when p_tokens is null then 'clear_token_cap' else 'set_token_cap' end,
     'token_' || p_periode,
     jsonb_build_object('tokens', lama),
     jsonb_build_object('tokens', p_tokens),
     p_note);

  return jsonb_build_object('workspace_id', p_workspace, 'periode', p_periode, 'tokens', p_tokens);
end;
$$;

revoke all on function public.admin_set_token_cap(uuid, text, bigint, text) from public;
grant execute on function public.admin_set_token_cap(uuid, text, bigint, text) to authenticated;

-- ------------------------------------------------------------
-- 4) Daftar kuota admin kini membawa token
-- ------------------------------------------------------------
create or replace function public.admin_list_ai_quota()
returns table (
  workspace_id   uuid,
  email          text,
  business_name  text,
  owner_name     text,
  plan_code      text,
  plan_label     text,
  suspended      boolean,
  note           text,
  seat_used      int,
  seat_limit     int,
  credits_used   numeric,
  credits_cap    numeric,
  credit_override numeric,
  cycle_start    date,
  cycle_end      date,
  features       jsonb,
  updated_at     timestamptz,
  updated_by     uuid,
  tokens_day        bigint,
  tokens_cycle      bigint,
  token_cap_daily   bigint,
  token_cap_monthly bigint,
  token_cap_daily_override   bigint,
  token_cap_monthly_override bigint,
  tokens_cycle_30h  bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d date := public.ai_today_pacific();
begin
  if not public.is_admin() then
    raise exception 'Tidak diizinkan: bukan admin' using errcode = 'insufficient_privilege';
  end if;

  return query
  with ws as (
    -- email di-cast ke text: auth.users.email bertipe varchar(255), dan
    -- RETURN QUERY plpgsql menolak ketidakcocokan tipe sekecil apa pun.
    select p.id, u.email::text as email, p.business_name, p.owner_name
      from public.profiles p
      join auth.users u on u.id = p.id
     where not exists (
       select 1 from public.staff_members m
        where m.member_id = p.id and m.status = 'active'
     )
  ),
  pol as (
    select w.id as wid,
           coalesce(po.plan_code, 'free')   as plan_code,
           po.daily_caps_override           as ov,
           po.monthly_credit_override       as cred_ov,
           coalesce(po.cycle_anchor_day, 1) as anchor,
           coalesce(po.suspended, false)    as suspended,
           po.token_cap_daily   as tok_hari_ov,
           po.token_cap_monthly as tok_bulan_ov,
           po.note, po.updated_at, po.updated_by
      from ws w
      left join public.workspace_ai_policy po on po.workspace_id = w.id
  ),
  siklus as (
    select pol.*, public.ai_cycle_start(pol.anchor) as c_start from pol
  )
  select
    w.id, w.email, w.business_name, w.owner_name,
    s.plan_code, pl.label, s.suspended, s.note,
    (select 1 + count(*)::int from public.staff_members m
      where m.owner_id = w.id and m.status <> 'revoked'),
    pl.seat_limit,
    coalesce((select round(sum(u.credits_used), 2) from public.workspace_ai_usage u
               where u.workspace_id = w.id and u.day >= s.c_start and u.day <= d), 0),
    coalesce(s.cred_ov, pl.monthly_credit_cap),
    s.cred_ov,
    s.c_start,
    (s.c_start + interval '1 month' - interval '1 day')::date,
    (
      select jsonb_agg(
               jsonb_build_object(
                 'feature', f.feature, 'label', f.label, 'unit', f.unit,
                 'sumber', case
                             when s.ov ? f.feature          then 'override'
                             when pl.daily_caps ? f.feature then 'paket'
                             else 'default'
                           end,
                 'cap', coalesce(
                          nullif(s.ov          ->> f.feature, '')::int,
                          nullif(pl.daily_caps ->> f.feature, '')::int,
                          f.default_cap),
                 'default_cap', f.default_cap,
                 'max_cap', f.max_cap,
                 'key_slot', f.key_slot,
                 'used', coalesce((
                           select case when f.feature = 'voice' then u.seconds_used else u.count end
                             from public.workspace_ai_usage u
                            where u.workspace_id = w.id and u.feature = f.feature and u.day = d), 0)
               ) order by f.sort_order)
        from public.ai_feature_defaults f
    ),
    s.updated_at, s.updated_by,
    -- Token hari ini (tanggal Pacific, sama dengan kunci baris pemakaian).
    -- ::bigint WAJIB: sum() atas bigint menghasilkan numeric, dan RETURN
    -- QUERY menolak ketidakcocokan tipe sekecil apa pun.
    coalesce((select sum(u.total_tokens) from public.workspace_ai_usage u
               where u.workspace_id = w.id and u.day = d), 0)::bigint,
    -- Token siklus berjalan.
    coalesce((select sum(u.total_tokens) from public.workspace_ai_usage u
               where u.workspace_id = w.id and u.day >= s.c_start and u.day <= d), 0)::bigint,
    -- Batas EFEKTIF (override ?? paket).
    coalesce(s.tok_hari_ov,  pl.token_cap_daily),
    coalesce(s.tok_bulan_ov, pl.token_cap_monthly),
    -- Override mentah, supaya UI bisa menampilkan "diatur admin" vs "dari paket".
    s.tok_hari_ov,
    s.tok_bulan_ov,
    -- 30 hari terakhir: dipakai untuk MENAKAR batas yang masuk akal sebelum
    -- memasangnya. Menetapkan plafon tanpa melihat pemakaian nyata lebih dulu
    -- adalah cara tercepat mematikan akun yang tidak melakukan kesalahan apa pun.
    coalesce((select sum(u.total_tokens) from public.workspace_ai_usage u
               where u.workspace_id = w.id and u.day > d - 30), 0)::bigint
  from ws w
  join siklus s on s.wid = w.id
  join public.ai_plans pl on pl.code = s.plan_code
  order by s.suspended desc, w.business_name nulls last;
end;
$$;

revoke all on function public.admin_list_ai_quota() from public;
grant execute on function public.admin_list_ai_quota() to authenticated;

-- ============================================================
-- SELESAI. WAJIB deploy ulang Edge Function AI setelah ini:
-- ai_quota_resolve mengembalikan 4 kolom baru, dan rate-limiter.ts membacanya.
--
--   supabase functions deploy BukuPencatatan BukuPencatatanStruk ai-catat \
--     ai-crud ai-narasi ai-hpp-draft ai-stok-insight voice-live-token \
--     --project-ref vbzmtnpmtgrhovmwjqqk
-- ============================================================
