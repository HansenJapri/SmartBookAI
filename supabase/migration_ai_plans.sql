-- ============================================================
-- FASE 2 — PAKET, OVERRIDE PER WORKSPACE, DAN RESOLUSI KUOTA 4 LAPIS
--
-- Jalankan SETELAH migration_ai_credits.sql. Aman diulang (idempotent).
--
-- INI FASE PERTAMA YANG MENGUBAH PERILAKU PRODUKSI. Fase 0 dan 1 hanya
-- menambah catatan; fase ini memindahkan penentuan limit dari kode yang
-- ter-deploy ke database.
--
-- Masalah yang diperbaiki: hari ini limit dipatok di FEATURE_ROUTES
-- (config.ts). Super Admin TIDAK BISA menaikkan kuota satu akun tanpa
-- deploy ulang Edge Function. Itu berarti setiap permintaan pelanggan
-- "tolong tambah jatah hari ini" menjadi rilis perangkat lunak.
--
--   Lapis 0  PLAFON GOOGLE (RPD/RPM per key slot)  ← tidak kita kendalikan
--   Lapis 1  PAKET                 ai_plans
--   Lapis 2  OVERRIDE WORKSPACE    workspace_ai_policy   ← kontrol admin
--   Lapis 3  DEFAULT KODE          FEATURE_ROUTES        ← jaring pengaman
--
-- effective_cap = override ?? paket ?? default_kode
--
-- FEATURE_ROUTES.dailyCap berubah peran: dari sumber kebenaran menjadi
-- CADANGAN TERAKHIR. Penting supaya kegagalan membaca database tidak
-- membuka kuota tanpa batas.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Katalog paket
-- ------------------------------------------------------------
create table if not exists public.ai_plans (
  code               text primary key,
  label              text    not null,
  seat_limit         int     not null check (seat_limit >= 1),
  -- null = tanpa batas kredit. Dipakai Enterprise.
  monthly_credit_cap numeric(12,2) check (monthly_credit_cap is null or monthly_credit_cap >= 0),
  -- Override cap harian per fitur, mis. {"ocr": 25}. null / kunci yang tidak
  -- ada = pakai default kode. Lihat catatan panjang di seed di bawah soal
  -- mengapa seluruh paket sengaja dibiarkan null untuk sekarang.
  daily_caps         jsonb,
  price_idr          int     not null default 0 check (price_idr >= 0),
  is_active          boolean not null default true,
  sort_order         int     not null default 0
);

alter table public.ai_plans enable row level security;

-- Katalog paket adalah informasi harga: siapa pun yang login boleh membacanya
-- (halaman upgrade perlu menampilkannya). Penulisan tanpa policy → hanya
-- service_role / SQL Editor, sejalan dengan pola tabel `admins`.
drop policy if exists "plans read all" on public.ai_plans;
create policy "plans read all" on public.ai_plans
  for select to authenticated using (true);

-- Kredit bulanan mengikuti kartu tarif di migration_ai_credits.sql:
-- Free 300 kredit ≈ 10/hari ≈ 10× chat, atau 3× baca struk, atau 5× catat.
-- Cukup untuk membuktikan nilai, terlalu sedikit untuk operasional harian —
-- itu memang tujuannya.
--
-- CATATAN PENTING — daily_caps SENGAJA null untuk SEMUA paket.
-- Menggoda sekali menjadikan cap harian sebagai pembeda paket ("Pro dapat
-- OCR 30/hari!"), tapi cap harian BUKAN alat jualan: ia melindungi RPD Google
-- per key slot, dan slot C dipakai bersama oleh ocr + crud + catat + hpp_draft.
-- Menaikkannya untuk satu paket berarti menaikkannya untuk ratusan workspace
-- sekaligus, dan kita BELUM mengukur berapa headroom RPD yang tersisa di tiap
-- slot — itu justru yang akan dijawab dashboard Fase 3. Sampai angka itu ada,
-- paket dibedakan oleh KREDIT dan SEAT saja, dan kenaikan cap harian dilakukan
-- per-workspace lewat override yang disengaja admin, bukan massal lewat paket.
insert into public.ai_plans (code, label, seat_limit, monthly_credit_cap, daily_caps, price_idr, sort_order) values
  ('free',       'Free',        2,     300, null,      0, 1),
  ('pro',        'Pro',         5,    1500, null,  99000, 2),
  ('bisnis',     'Bisnis',     15,    6000, null, 299000, 3),
  ('enterprise', 'Enterprise', 100,  null,  null,      0, 4)
on conflict (code) do nothing;

-- ------------------------------------------------------------
-- 2) Kebijakan per workspace
-- ------------------------------------------------------------
-- Workspace TANPA baris di sini dianggap 'free'. Sengaja: memaksa setiap
-- workspace punya baris berarti pendaftaran baru bisa gagal karena tabel
-- kebijakan, dan itu menukar masalah kecil dengan masalah besar.
create table if not exists public.workspace_ai_policy (
  workspace_id           uuid primary key,
  plan_code              text not null default 'free' references public.ai_plans(code),
  daily_caps_override    jsonb,
  monthly_credit_override numeric(12,2) check (monthly_credit_override is null or monthly_credit_override >= 0),
  -- Tanggal jangkar siklus bulanan. Dibatasi 1-28 supaya tidak ada bulan yang
  -- kehilangan tanggalnya (29-31 tidak ada di Februari; jangkar 31 akan
  -- membuat siklus melompat tak terduga tiap kuartal).
  cycle_anchor_day       smallint not null default 1 check (cycle_anchor_day between 1 and 28),
  -- Kill-switch AI per akun. Form manual TETAP jalan tanpa batas — mematikan
  -- AI tidak boleh berarti mematikan pembukuan orang.
  suspended              boolean not null default false,
  note                   text,
  updated_by             uuid,
  updated_at             timestamptz not null default now()
);

alter table public.workspace_ai_policy enable row level security;

-- Anggota workspace boleh MELIHAT kebijakannya sendiri (transparansi: pelanggan
-- berhak tahu paket dan jatahnya). Admin melihat semua. Penulisan tidak diberi
-- policy apa pun → perubahan limit hanya lewat service_role / SQL Editor
-- sampai RPC admin lahir di Fase 4, lengkap dengan jejak admin_quota_actions.
drop policy if exists "policy select own workspace" on public.workspace_ai_policy;
create policy "policy select own workspace" on public.workspace_ai_policy
  for select to authenticated
  using (workspace_id = public.ai_workspace_id() or public.is_admin());

-- ------------------------------------------------------------
-- 3) Siklus bulanan
-- ------------------------------------------------------------
-- BASIS TANGGAL: PACIFIC, bukan WIB.
--
-- Rancangan awal menyebut siklus bulanan mengikuti WIB agar terasa alami bagi
-- pelanggan Indonesia. Itu tidak bisa dipertahankan begitu menyentuh data:
-- SELURUH baris workspace_ai_usage dikunci pada tanggal PACIFIC (lihat
-- ai_today_pacific di migration_ai_workspace_quota.sql, yang sengaja menyamai
-- reset RPD Google). Menjumlahkan baris ber-tanggal Pacific memakai batas
-- ber-tanggal WIB membuat pemakaian di sekitar tanggal jangkar jatuh ke siklus
-- yang salah — tagihan yang meleset satu hari, tiap bulan, selamanya.
--
-- Jadi siklus memakai basis yang sama dengan datanya, dan yang diterjemahkan
-- ke WIB adalah TAMPILANNYA, bukan perhitungannya. UI menampilkan momen reset
-- dalam WIB (≈15.00), penjumlahannya tetap eksak.
create or replace function public.ai_cycle_start(p_anchor int default 1)
returns date
language plpgsql
stable
set search_path = public
as $$
declare
  d      date := public.ai_today_pacific();
  anchor int  := least(greatest(coalesce(p_anchor, 1), 1), 28);
  bulan_ini date;
begin
  bulan_ini := make_date(extract(year from d)::int, extract(month from d)::int, anchor);
  if d >= bulan_ini then
    return bulan_ini;
  end if;
  return (bulan_ini - interval '1 month')::date;
end;
$$;

grant execute on function public.ai_cycle_start(int) to authenticated;

-- ------------------------------------------------------------
-- 4) Resolusi kuota — DUA PENGHITUNG BERDAMPINGAN
-- ------------------------------------------------------------
-- Satu permintaan wajib lolos KEDUANYA:
--
--   cap harian per fitur = GUARDRAIL TEKNIS  (melindungi RPD Google per slot)
--   kredit bulanan       = SATUAN KOMERSIAL  (yang dijual & di-upgrade)
--
-- `blocked_by` adalah field yang memisahkan "tunggu tiga jam" dari "beli
-- lagi" — dua kalimat yang sangat berbeda bagi pemilik toko, dan dua tindakan
-- yang sangat berbeda bagi tim penjualan. Menggabungkannya jadi satu status
-- "penuh" akan membuat sales mengejar akun yang sebenarnya tidak butuh apa-apa.
--
-- p_fallback_cap = FEATURE_ROUTES.dailyCap dari pemanggil, dipakai HANYA bila
-- paket maupun override tidak menyebut fitur ini (lapis 3).
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

  -- Paket yang tertulis di kebijakan tapi hilang dari katalog (dihapus/di-rename)
  -- tidak boleh menjatuhkan permintaan. Mundur ke 'free': lebih ketat, bukan
  -- lebih longgar — kegagalan konfigurasi tidak boleh berbuah kuota gratis.
  if pl.code is null then
    select * into pl from public.ai_plans where code = 'free';
  end if;

  v_mulai := public.ai_cycle_start(coalesce(pol.cycle_anchor_day, 1));
  v_akhir := (v_mulai + interval '1 month' - interval '1 day')::date;

  -- ---- Lapis 2 → 1 → 3 ----
  v_cap := coalesce(
    nullif(pol.daily_caps_override ->> p_feature, '')::int,
    nullif(pl.daily_caps           ->> p_feature, '')::int,
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

  -- ---- Urutan pemeriksaan menentukan pesan yang dilihat pengguna ----
  -- Suspend didahulukan (keputusan sadar admin), lalu kredit (bisa dibeli),
  -- lalu guardrail harian (hanya bisa ditunggu). Kalau harian didahulukan,
  -- akun yang kreditnya benar-benar habis akan disuruh "tunggu besok" —
  -- dan besok ia tetap tidak bisa apa-apa.
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
-- 5) Batas seat kini mengikuti paket
-- ------------------------------------------------------------
-- Menggantikan angka 2 yang dipatok di enforce_free_seat_limit(). Nama
-- fungsinya ikut berubah karena ia bukan lagi khusus Free Plan; trigger lama
-- di-drop supaya tidak ada dua trigger yang menegakkan aturan berbeda pada
-- tabel yang sama.
create or replace function public.ai_seat_limit(p_owner uuid default null)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.seat_limit
       from public.workspace_ai_policy w
       join public.ai_plans p on p.code = w.plan_code
      where w.workspace_id = coalesce(p_owner, auth.uid())),
    (select seat_limit from public.ai_plans where code = 'free'),
    2
  );
$$;

grant execute on function public.ai_seat_limit(uuid) to authenticated;

create or replace function public.enforce_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_seats int;
  max_seats    int := public.ai_seat_limit(new.owner_id);
begin
  select 1 + count(*)::int into active_seats
    from public.staff_members m
   where m.owner_id = new.owner_id
     and m.status <> 'revoked';

  if active_seats > max_seats then
    raise exception 'SEAT_LIMIT_REACHED: Paket Anda maksimal % anggota (pemilik + % staf). Tingkatkan paket untuk menambah anggota.',
      max_seats, max_seats - 1
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_free_seat_limit on public.staff_members;
drop trigger if exists trg_seat_limit on public.staff_members;
create trigger trg_seat_limit
  after insert on public.staff_members
  for each row execute function public.enforce_seat_limit();

-- Fungsi lama dibiarkan ada (tidak di-drop): kode klien yang belum di-deploy
-- ulang mungkin masih memanggilnya, dan menghapusnya berarti undangan staf
-- gagal di tengah jendela deploy. Ia sudah tidak dipakai trigger mana pun.

-- ------------------------------------------------------------
-- 6) Ringkasan kredit pelanggan — kini dengan JATAH dan SISA
-- ------------------------------------------------------------
-- Menggantikan versi Fase 1 yang hanya bisa menjawab "sudah terpakai berapa".
create or replace function public.my_ai_credits()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  ws     uuid := public.ai_workspace_id();
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
    -- Ambang yang sama dengan dashboard admin: <75 aman, 75-90 peringatan,
    -- 90-100 kritis, >=100 penuh. Dihitung di satu tempat supaya UI pelanggan
    -- dan UI admin tidak pernah menampilkan status yang berbeda untuk angka
    -- yang sama.
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

grant execute on function public.my_ai_credits() to authenticated;

-- Versi Fase 1 berparameter (p_days int) di-drop: dua fungsi bernama sama
-- dengan tanda tangan berbeda membuat pemanggilan tanpa argumen ambigu.
drop function if exists public.my_ai_credits(int);

-- ------------------------------------------------------------
-- 7) Sebaran paket & status untuk dashboard admin
-- ------------------------------------------------------------
create or replace function public.admin_quota_overview()
returns jsonb
language sql stable security definer set search_path = public as $$
  with ws as (
    select w.workspace_id,
           coalesce(pol.plan_code, 'free') as plan_code,
           coalesce(pol.monthly_credit_override,
                    (select monthly_credit_cap from public.ai_plans p
                      where p.code = coalesce(pol.plan_code, 'free'))) as jatah,
           sum(w.credits_used) as pakai
      from public.workspace_ai_usage w
      left join public.workspace_ai_policy pol on pol.workspace_id = w.workspace_id
     where w.day >= public.ai_cycle_start(coalesce(pol.cycle_anchor_day, 1))
     group by w.workspace_id, pol.plan_code, pol.monthly_credit_override, pol.cycle_anchor_day
  ),
  ber_status as (
    select *, case
      when jatah is null then 'aman'
      when pakai >= jatah then 'penuh'
      when pakai * 100 / jatah >= 90 then 'kritis'
      when pakai * 100 / jatah >= 75 then 'peringatan'
      else 'aman' end as status
      from ws
  )
  select case when not public.is_admin() then '{}'::jsonb else jsonb_build_object(
    'total_workspace',   (select count(*) from ber_status),
    'kuota_platform',    (select coalesce(sum(jatah), 0) from ber_status),
    'konsumsi_platform', (select coalesce(sum(pakai), 0) from ber_status),
    'sisa_platform',     (select coalesce(sum(greatest(0, jatah - pakai)), 0) from ber_status where jatah is not null),
    'utilisasi_persen',  (select case when coalesce(sum(jatah), 0) = 0 then 0
                                 else round(sum(pakai) * 100 / sum(jatah), 1) end
                            from ber_status where jatah is not null),
    'sebaran_status',    (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                            from (select status, count(*) n from ber_status group by status) s),
    'sebaran_paket',     (select coalesce(jsonb_object_agg(plan_code, n), '{}'::jsonb)
                            from (select plan_code, count(*) n from ber_status group by plan_code) s),
    'perlu_tindakan',    (select coalesce(jsonb_agg(r), '[]'::jsonb) from (
                            select workspace_id, plan_code, pakai, jatah, status
                              from ber_status
                             where status in ('peringatan', 'kritis', 'penuh')
                             order by case status when 'penuh' then 1 when 'kritis' then 2 else 3 end,
                                      pakai desc
                             limit 50) r)
  ) end;
$$;

grant execute on function public.admin_quota_overview() to authenticated;

-- ============================================================
-- SELESAI.
--
-- WAJIB DEPLOY ULANG Edge Function AI setelah migrasi ini: checkQuota() kini
-- memanggil ai_quota_resolve(). Fungsi lama yang masih memanggil
-- ai_quota_check() TETAP JALAN (RPC-nya tidak dihapus) — hanya saja mereka
-- belum mengenal kredit dan masih memakai cap dari FEATURE_ROUTES, jadi
-- perubahan paket belum terasa sampai deploy dilakukan.
--
-- Fase berikutnya (3): materialized view + halaman /admin/ai-quota.
-- ============================================================
