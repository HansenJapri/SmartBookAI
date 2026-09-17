-- ============================================================
-- FASE 4 — KONTROL KUOTA AI DARI DASHBOARD ADMIN
--
-- Jalankan SETELAH migration_ai_plans.sql. Aman diulang (idempotent).
--
-- Ini menutup janji yang ditulis sendiri di migration_ai_plans.sql:
--
--   "Penulisan tidak diberi policy apa pun → perubahan limit hanya lewat
--    service_role / SQL Editor sampai RPC admin lahir di Fase 4, lengkap
--    dengan jejak admin_quota_actions."
--
-- Sampai hari ini, permintaan pelanggan "tolong tambah jatah AI hari ini"
-- hanya bisa dijawab dengan membuka SQL Editor Supabase dan mengetik UPDATE
-- dengan tangan. Dua hal buruk sekaligus: tidak ada yang mencatat siapa
-- menaikkan jatah siapa, dan satu salah ketik pada klausa WHERE mengubah
-- kebijakan seluruh pelanggan.
--
-- Yang ditambahkan:
--   1. ai_feature_defaults   — default kode dipindah ke database (lapis 3)
--   2. admin_quota_actions   — jejak PERMANEN setiap perubahan kebijakan
--   3. RPC admin_*           — satu-satunya jalan menulis workspace_ai_policy
--   4. admin_list_ai_quota() — satu tabel untuk halaman "Kuota AI"
-- ============================================================

-- ------------------------------------------------------------
-- 1) DEFAULT PER FITUR — dipindah dari kode ke database
-- ------------------------------------------------------------
--
-- KENAPA TABEL INI ADA, bukan sekadar membaca FEATURE_ROUTES.
--
-- Halaman admin harus bisa menjawab "berapa cap efektif akun ini SEKARANG".
-- Tanpa default yang bisa dibaca database, jawabannya harus disalin dari
-- config.ts ke sisi klien — dan salinan itu pasti menua. Dashboard yang
-- menampilkan 10 sementara Edge Function menegakkan 40 lebih berbahaya
-- daripada dashboard yang tidak menampilkan apa-apa: ia membuat admin yakin
-- pada angka yang salah.
--
-- Maka rantainya kini: override workspace ?? paket ?? TABEL INI ?? cadangan
-- kode. Baris di sini di-seed PERSIS sama dengan FEATURE_ROUTES.dailyCap per
-- 15 September 2026, jadi migrasi ini TIDAK mengubah perilaku apa pun saat
-- dijalankan — ia hanya memindahkan tempat kebenarannya tinggal.
--
-- PERINGATAN UNTUK YANG MENGUBAH config.ts NANTI: mengubah dailyCap di sana
-- saja tidak lagi cukup. Angka di sini yang menang, karena ia dibaca lebih
-- dulu. Ubah keduanya, atau ubah di sini saja.
create table if not exists public.ai_feature_defaults (
  feature     text primary key,
  label       text not null,
  -- Satuan cap. 'panggilan' untuk fitur berbasis permintaan, 'detik' untuk
  -- voice — yang menyimpan durasi, bukan jumlah panggilan. Dipakai UI supaya
  -- admin tidak pernah mengetik "10" sambil mengira itu 10 menit.
  unit        text not null default 'panggilan' check (unit in ('panggilan', 'detik')),
  default_cap int  not null check (default_cap >= 0),
  -- Plafon keamanan. Cap harian melindungi RPD Google per key slot; slot C
  -- dipakai bersama oleh ocr + crud + catat + hpp_draft. Admin boleh menaikkan
  -- jatah satu akun, tapi tidak boleh mengetik angka yang menghabiskan kuota
  -- Google untuk seluruh pelanggan lain dalam satu sore.
  max_cap     int  not null check (max_cap >= 0),
  key_slot    text,
  sort_order  int  not null default 0,
  constraint ai_feature_defaults_cap_masuk_akal check (default_cap <= max_cap)
);

alter table public.ai_feature_defaults enable row level security;

-- Katalog fitur bukan rahasia: pelanggan berhak tahu ada batas apa saja.
drop policy if exists "feature defaults read all" on public.ai_feature_defaults;
create policy "feature defaults read all" on public.ai_feature_defaults
  for select to authenticated using (true);
-- Tanpa policy tulis → hanya service_role / SQL Editor, sejalan dengan ai_plans.

insert into public.ai_feature_defaults (feature, label, unit, default_cap, max_cap, key_slot, sort_order) values
  ('chat',              'Chat Tanya AI',              'panggilan',  10,  200, 'A', 1),
  ('insight_dashboard', 'Insight AI Dashboard',       'panggilan',  10,  200, 'A', 2),
  ('insight_stok',      'Insight AI Stok',            'panggilan',  10,  200, 'B', 3),
  ('catat',             'Catat dengan kalimat biasa', 'panggilan',  40,  400, 'C', 4),
  ('crud',              'Pencatatan via AI',          'panggilan',  10,  200, 'C', 5),
  ('ocr',               'Baca struk dengan AI',       'panggilan',  10,  100, 'C', 6),
  ('hpp_draft',         'Draf HPP dengan AI',         'panggilan',  10,  100, 'C', 7),
  ('voice',             'Fitur suara (voice)',        'detik',     600, 7200, 'B', 8)
on conflict (feature) do nothing;

grant select on public.ai_feature_defaults to authenticated;

-- ------------------------------------------------------------
-- 2) JEJAK PERUBAHAN KEBIJAKAN — permanen, tanpa jalur hapus
-- ------------------------------------------------------------
--
-- Terpisah dari admin_audit_log dengan sengaja. admin_audit_log ditulis dari
-- BROWSER secara "fire-and-forget": kalau insert-nya gagal, aksinya tetap
-- jalan dan jejaknya hilang tanpa suara. Itu cukup untuk "admin membuka
-- halaman", tidak cukup untuk "admin menggandakan jatah AI satu akun".
--
-- Baris di sini ditulis di DALAM transaksi yang sama dengan perubahannya, oleh
-- fungsi security definer. Perubahan tanpa jejak menjadi mustahil, bukan
-- sekadar tidak disarankan: kalau insert jejaknya gagal, perubahannya ikut
-- batal.
create table if not exists public.admin_quota_actions (
  id           bigint generated always as identity primary key,
  admin_id     uuid not null default auth.uid(),
  workspace_id uuid not null,
  action       text not null check (action in (
                 'set_daily_cap', 'clear_daily_cap', 'set_plan',
                 'set_credit_override', 'clear_credit_override',
                 'suspend', 'unsuspend'
               )),
  feature      text,
  -- Nilai SEBELUM dan SESUDAH, keduanya. Menyimpan hanya nilai baru membuat
  -- pertanyaan "siapa yang menurunkannya dari 40 ke 10" tidak terjawab tanpa
  -- menelusuri seluruh riwayat baris demi baris.
  before_value jsonb,
  after_value  jsonb,
  note         text,
  created_at   timestamptz not null default now()
);

alter table public.admin_quota_actions enable row level security;

drop policy if exists "quota actions admin read" on public.admin_quota_actions;
create policy "quota actions admin read" on public.admin_quota_actions
  for select to authenticated using (public.is_admin());

-- Tidak ada policy insert/update/delete. Penulisan HANYA lewat RPC di bawah;
-- perubahan dan penghapusan tidak mungkin dari aplikasi mana pun.

create index if not exists idx_quota_actions_ws
  on public.admin_quota_actions (workspace_id, created_at desc);
create index if not exists idx_quota_actions_created
  on public.admin_quota_actions (created_at desc);

grant select on public.admin_quota_actions to authenticated;

-- ------------------------------------------------------------
-- 3) Rantai resolusi kuota kini menyertakan ai_feature_defaults
-- ------------------------------------------------------------
--
-- Satu-satunya perubahan terhadap Fase 2: satu coalesce bertambah satu lapis.
--
--   override workspace ?? paket ?? ai_feature_defaults ?? p_fallback_cap
--
-- Nilai seed tabel default sama persis dengan p_fallback_cap yang dikirim
-- Edge Function hari ini, jadi hasilnya identik sampai ada yang sengaja
-- mengubahnya. p_fallback_cap tetap dipertahankan sebagai jaring terakhir
-- untuk fitur yang belum sempat terdaftar di tabel.
create or replace function public.ai_quota_resolve(
  p_feature      text,
  p_fallback_cap int
)
returns table (
  allowed        boolean,
  blocked_by     text,
  daily_used     int,
  daily_cap      int,
  daily_reset_at timestamptz,
  credits_used   numeric,
  credits_cap    numeric,
  cycle_start    date,
  cycle_end      date,
  plan_code      text
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
begin
  if ws is null then
    return query select false, 'no_workspace', 0, p_fallback_cap, now(),
                        0::numeric, null::numeric, d, d, 'free';
    return;
  end if;

  select * into pol from public.workspace_ai_policy where workspace_id = ws;
  select * into pl  from public.ai_plans
   where code = coalesce(pol.plan_code, 'free');

  if pl.code is null then
    select * into pl from public.ai_plans where code = 'free';
  end if;

  v_mulai := public.ai_cycle_start(coalesce(pol.cycle_anchor_day, 1));
  v_akhir := (v_mulai + interval '1 month' - interval '1 day')::date;

  -- ---- Lapis 2 → 1 → 3 (tabel) → 3b (cadangan kode) ----
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
   where u.workspace_id = ws
     and u.day >= v_mulai
     and u.day <= d;

  if coalesce(pol.suspended, false) then
    v_blok := 'suspended';
  elsif v_kredit_cap is not null and v_kredit_used >= v_kredit_cap then
    v_blok := 'credits';
  elsif v_used >= v_cap then
    v_blok := 'daily';
  end if;

  return query select
    v_blok is null,
    v_blok,
    v_used,
    v_cap,
    (((d + 1)::text || ' 00:00:00')::timestamp at time zone 'America/Los_Angeles'),
    round(v_kredit_used, 2),
    v_kredit_cap,
    v_mulai,
    v_akhir,
    pl.code;
end;
$$;

revoke all on function public.ai_quota_resolve(text, int) from public;
grant execute on function public.ai_quota_resolve(text, int) to authenticated;

-- ------------------------------------------------------------
-- 4) Penolong internal: pastikan baris kebijakan ada
-- ------------------------------------------------------------
--
-- Workspace tanpa baris workspace_ai_policy dianggap 'free' (lihat Fase 2).
-- Begitu admin mengubah sesuatu, barisnya harus ada. Dipisah jadi fungsi
-- sendiri supaya lima RPC di bawah tidak masing-masing menulis ulang logika
-- yang sama — dan salah satunya lupa.
create or replace function public.admin__pastikan_policy(p_workspace uuid)
returns public.workspace_ai_policy
language plpgsql
security definer
set search_path = public
as $$
declare
  row_pol public.workspace_ai_policy%rowtype;
begin
  insert into public.workspace_ai_policy (workspace_id, plan_code)
  values (p_workspace, 'free')
  on conflict (workspace_id) do nothing;

  select * into row_pol from public.workspace_ai_policy where workspace_id = p_workspace;
  return row_pol;
end;
$$;

revoke all on function public.admin__pastikan_policy(uuid) from public, authenticated;

-- Penjaga bersama untuk seluruh RPC admin di bawah.
create or replace function public.admin__jaga(p_workspace uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Tidak diizinkan: bukan admin' using errcode = 'insufficient_privilege';
  end if;
  if p_workspace is null then
    raise exception 'Workspace wajib diisi' using errcode = 'invalid_parameter_value';
  end if;
  -- Workspace = id owner. Menolak id yang bukan pemilik akun mana pun mencegah
  -- salah ketik menciptakan baris kebijakan hantu yang tidak pernah dipakai
  -- siapa pun dan tidak pernah disadari salah.
  if not exists (select 1 from public.profiles p where p.id = p_workspace) then
    raise exception 'Workspace % tidak ditemukan', p_workspace using errcode = 'no_data_found';
  end if;
end;
$$;

revoke all on function public.admin__jaga(uuid) from public, authenticated;

-- ------------------------------------------------------------
-- 5) RPC: ubah cap harian satu fitur
-- ------------------------------------------------------------
create or replace function public.admin_set_daily_cap(
  p_workspace uuid,
  p_feature   text,
  p_cap       int,
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pol    public.workspace_ai_policy%rowtype;
  def    public.ai_feature_defaults%rowtype;
  lama   jsonb;
  baru   jsonb;
begin
  perform public.admin__jaga(p_workspace);

  select * into def from public.ai_feature_defaults where feature = p_feature;
  if def.feature is null then
    raise exception 'Fitur "%" tidak dikenal. Pilihan: %',
      p_feature,
      (select string_agg(feature, ', ' order by sort_order) from public.ai_feature_defaults)
      using errcode = 'invalid_parameter_value';
  end if;

  if p_cap is null or p_cap < 0 then
    raise exception 'Batas harian tidak boleh kosong atau negatif'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Plafon keamanan, bukan formalitas: cap harian melindungi RPD Google pada
  -- key slot %. Melewatinya untuk satu akun berarti mengambil jatah akun lain.
  if p_cap > def.max_cap then
    raise exception 'Batas % melebihi plafon aman fitur "%" (maks %, slot kunci %). Naikkan plafon lebih dulu di ai_feature_defaults bila memang disengaja.',
      p_cap, p_feature, def.max_cap, coalesce(def.key_slot, '-')
      using errcode = 'invalid_parameter_value';
  end if;

  pol  := public.admin__pastikan_policy(p_workspace);
  lama := pol.daily_caps_override;

  baru := coalesce(lama, '{}'::jsonb) || jsonb_build_object(p_feature, p_cap);

  update public.workspace_ai_policy
     set daily_caps_override = baru,
         updated_by = auth.uid(),
         updated_at = now()
   where workspace_id = p_workspace;

  insert into public.admin_quota_actions
    (workspace_id, action, feature, before_value, after_value, note)
  values
    (p_workspace, 'set_daily_cap', p_feature,
     jsonb_build_object('cap', lama -> p_feature),
     jsonb_build_object('cap', to_jsonb(p_cap)),
     p_note);

  return jsonb_build_object(
    'workspace_id', p_workspace,
    'feature', p_feature,
    'cap', p_cap,
    'unit', def.unit
  );
end;
$$;

revoke all on function public.admin_set_daily_cap(uuid, text, int, text) from public;
grant execute on function public.admin_set_daily_cap(uuid, text, int, text) to authenticated;

-- ------------------------------------------------------------
-- 6) RPC: kembalikan satu fitur ke default
-- ------------------------------------------------------------
create or replace function public.admin_clear_daily_cap(
  p_workspace uuid,
  p_feature   text,
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pol  public.workspace_ai_policy%rowtype;
  lama jsonb;
begin
  perform public.admin__jaga(p_workspace);

  pol  := public.admin__pastikan_policy(p_workspace);
  lama := pol.daily_caps_override;

  if lama is null or not (lama ? p_feature) then
    -- Bukan error: hasil akhirnya persis yang diminta (tidak ada override).
    -- Tapi juga tidak dicatat, karena tidak ada yang berubah.
    return jsonb_build_object('workspace_id', p_workspace, 'feature', p_feature, 'changed', false);
  end if;

  update public.workspace_ai_policy
     set daily_caps_override = nullif(lama - p_feature, '{}'::jsonb),
         updated_by = auth.uid(),
         updated_at = now()
   where workspace_id = p_workspace;

  insert into public.admin_quota_actions
    (workspace_id, action, feature, before_value, after_value, note)
  values
    (p_workspace, 'clear_daily_cap', p_feature,
     jsonb_build_object('cap', lama -> p_feature),
     jsonb_build_object('cap', null),
     p_note);

  return jsonb_build_object('workspace_id', p_workspace, 'feature', p_feature, 'changed', true);
end;
$$;

revoke all on function public.admin_clear_daily_cap(uuid, text, text) from public;
grant execute on function public.admin_clear_daily_cap(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- 7) RPC: ganti paket
-- ------------------------------------------------------------
create or replace function public.admin_set_plan(
  p_workspace uuid,
  p_plan_code text,
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pol  public.workspace_ai_policy%rowtype;
  lama text;
begin
  perform public.admin__jaga(p_workspace);

  if not exists (select 1 from public.ai_plans where code = p_plan_code and is_active) then
    raise exception 'Paket "%" tidak ada atau tidak aktif', p_plan_code
      using errcode = 'invalid_parameter_value';
  end if;

  pol  := public.admin__pastikan_policy(p_workspace);
  lama := pol.plan_code;

  if lama is not distinct from p_plan_code then
    return jsonb_build_object('workspace_id', p_workspace, 'plan_code', p_plan_code, 'changed', false);
  end if;

  update public.workspace_ai_policy
     set plan_code = p_plan_code, updated_by = auth.uid(), updated_at = now()
   where workspace_id = p_workspace;

  insert into public.admin_quota_actions
    (workspace_id, action, before_value, after_value, note)
  values
    (p_workspace, 'set_plan',
     jsonb_build_object('plan_code', lama),
     jsonb_build_object('plan_code', p_plan_code),
     p_note);

  return jsonb_build_object('workspace_id', p_workspace, 'plan_code', p_plan_code, 'changed', true);
end;
$$;

revoke all on function public.admin_set_plan(uuid, text, text) from public;
grant execute on function public.admin_set_plan(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- 8) RPC: override kredit bulanan (null = ikut paket)
-- ------------------------------------------------------------
create or replace function public.admin_set_credit_override(
  p_workspace uuid,
  p_credits   numeric,
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pol  public.workspace_ai_policy%rowtype;
  lama numeric;
begin
  perform public.admin__jaga(p_workspace);

  if p_credits is not null and p_credits < 0 then
    raise exception 'Kredit tidak boleh negatif' using errcode = 'invalid_parameter_value';
  end if;

  pol  := public.admin__pastikan_policy(p_workspace);
  lama := pol.monthly_credit_override;

  update public.workspace_ai_policy
     set monthly_credit_override = p_credits, updated_by = auth.uid(), updated_at = now()
   where workspace_id = p_workspace;

  insert into public.admin_quota_actions
    (workspace_id, action, before_value, after_value, note)
  values
    (p_workspace,
     case when p_credits is null then 'clear_credit_override' else 'set_credit_override' end,
     jsonb_build_object('credits', lama),
     jsonb_build_object('credits', p_credits),
     p_note);

  return jsonb_build_object('workspace_id', p_workspace, 'credits', p_credits);
end;
$$;

revoke all on function public.admin_set_credit_override(uuid, numeric, text) from public;
grant execute on function public.admin_set_credit_override(uuid, numeric, text) to authenticated;

-- ------------------------------------------------------------
-- 9) RPC: matikan / hidupkan AI satu akun
-- ------------------------------------------------------------
--
-- Kill-switch ini SENGAJA hanya menyentuh AI. Seluruh form manual tetap jalan
-- tanpa batas. Mematikan AI pelanggan yang menyalahgunakan sistem tidak boleh
-- berarti mematikan pembukuan usahanya — itu bukan sanksi, itu kerusakan.
create or replace function public.admin_set_ai_suspended(
  p_workspace uuid,
  p_suspended boolean,
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pol  public.workspace_ai_policy%rowtype;
  lama boolean;
begin
  perform public.admin__jaga(p_workspace);

  if p_suspended is null then
    raise exception 'Status suspend wajib diisi' using errcode = 'invalid_parameter_value';
  end if;

  -- Mematikan layanan yang sudah dibayar adalah tindakan yang harus bisa
  -- dipertanggungjawabkan berbulan-bulan kemudian. Alasan diwajibkan supaya
  -- jejaknya bisa dibaca orang yang tidak ada di ruangan saat keputusannya
  -- diambil.
  if p_suspended and coalesce(btrim(p_note), '') = '' then
    raise exception 'Alasan wajib diisi saat menonaktifkan AI sebuah akun'
      using errcode = 'invalid_parameter_value';
  end if;

  pol  := public.admin__pastikan_policy(p_workspace);
  lama := coalesce(pol.suspended, false);

  if lama is not distinct from p_suspended then
    return jsonb_build_object('workspace_id', p_workspace, 'suspended', p_suspended, 'changed', false);
  end if;

  update public.workspace_ai_policy
     set suspended = p_suspended,
         note = coalesce(nullif(btrim(p_note), ''), pol.note),
         updated_by = auth.uid(),
         updated_at = now()
   where workspace_id = p_workspace;

  insert into public.admin_quota_actions
    (workspace_id, action, before_value, after_value, note)
  values
    (p_workspace,
     case when p_suspended then 'suspend' else 'unsuspend' end,
     jsonb_build_object('suspended', lama),
     jsonb_build_object('suspended', p_suspended),
     p_note);

  return jsonb_build_object('workspace_id', p_workspace, 'suspended', p_suspended, 'changed', true);
end;
$$;

revoke all on function public.admin_set_ai_suspended(uuid, boolean, text) from public;
grant execute on function public.admin_set_ai_suspended(uuid, boolean, text) to authenticated;

-- ------------------------------------------------------------
-- 10) RPC: satu tabel untuk halaman "Kuota AI"
-- ------------------------------------------------------------
--
-- Satu baris per workspace, lengkap dengan cap EFEKTIF dan pemakaian HARI INI
-- per fitur. Digabung di database, bukan di browser, karena versi browser
-- berarti satu permintaan per workspace per fitur — delapan kali jumlah akun.
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
  -- [{feature, label, unit, cap, sumber, used, default_cap, max_cap}, ...]
  features       jsonb,
  updated_at     timestamptz,
  updated_by     uuid
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
     -- Hanya OWNER yang punya workspace. Staf memakai kuota owner-nya
     -- (lihat ai_workspace_id), jadi menampilkan mereka sebagai baris
     -- tersendiri akan menyarankan tuas yang sebenarnya tidak ada.
     where not exists (
       select 1 from public.staff_members m
        where m.member_id = p.id and m.status = 'active'
     )
  ),
  pol as (
    select w.id as wid,
           coalesce(po.plan_code, 'free')            as plan_code,
           po.daily_caps_override                    as ov,
           po.monthly_credit_override                as cred_ov,
           coalesce(po.cycle_anchor_day, 1)          as anchor,
           coalesce(po.suspended, false)             as suspended,
           po.note, po.updated_at, po.updated_by
      from ws w
      left join public.workspace_ai_policy po on po.workspace_id = w.id
  ),
  siklus as (
    select pol.*, public.ai_cycle_start(pol.anchor) as c_start from pol
  )
  select
    w.id, w.email, w.business_name, w.owner_name,
    s.plan_code,
    pl.label,
    s.suspended,
    s.note,
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
                 'feature',     f.feature,
                 'label',       f.label,
                 'unit',        f.unit,
                 -- `sumber` menjawab "kenapa angkanya segini", yang selalu
                 -- jadi pertanyaan kedua setelah "berapa angkanya".
                 'sumber',      case
                                  when s.ov ? f.feature          then 'override'
                                  when pl.daily_caps ? f.feature then 'paket'
                                  else 'default'
                                end,
                 'cap',         coalesce(
                                  nullif(s.ov          ->> f.feature, '')::int,
                                  nullif(pl.daily_caps ->> f.feature, '')::int,
                                  f.default_cap
                                ),
                 'default_cap', f.default_cap,
                 'max_cap',     f.max_cap,
                 'key_slot',    f.key_slot,
                 'used',        coalesce((
                                  select case when f.feature = 'voice' then u.seconds_used else u.count end
                                    from public.workspace_ai_usage u
                                   where u.workspace_id = w.id and u.feature = f.feature and u.day = d
                                ), 0)
               )
               order by f.sort_order
             )
        from public.ai_feature_defaults f
    ),
    s.updated_at,
    s.updated_by
  from ws w
  join siklus s on s.wid = w.id
  join public.ai_plans pl on pl.code = s.plan_code
  order by s.suspended desc, w.business_name nulls last;
end;
$$;

revoke all on function public.admin_list_ai_quota() from public;
grant execute on function public.admin_list_ai_quota() to authenticated;

-- ------------------------------------------------------------
-- 11) RPC: riwayat perubahan kebijakan
-- ------------------------------------------------------------
create or replace function public.admin_list_quota_actions(
  p_workspace uuid default null,
  p_limit     int  default 200
)
returns table (
  id            bigint,
  admin_id      uuid,
  admin_email   text,
  workspace_id  uuid,
  business_name text,
  action        text,
  feature       text,
  before_value  jsonb,
  after_value   jsonb,
  note          text,
  created_at    timestamptz
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
  select a.id, a.admin_id, au.email::text, a.workspace_id, p.business_name,
         a.action, a.feature, a.before_value, a.after_value, a.note, a.created_at
    from public.admin_quota_actions a
    left join auth.users au on au.id = a.admin_id
    left join public.profiles p on p.id = a.workspace_id
   where p_workspace is null or a.workspace_id = p_workspace
   order by a.created_at desc
   limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;

revoke all on function public.admin_list_quota_actions(uuid, int) from public;
grant execute on function public.admin_list_quota_actions(uuid, int) to authenticated;

-- ============================================================
-- SELESAI.
--
-- TIDAK perlu deploy ulang Edge Function: ai_quota_resolve tetap dipanggil
-- dengan tanda tangan yang sama, dan nilai seed ai_feature_defaults identik
-- dengan FEATURE_ROUTES.dailyCap hari ini.
-- ============================================================
