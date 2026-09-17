-- ============================================================
-- TAMBALAN: auth.users.email bertipe varchar, bukan text
--
-- Jalankan SETELAH ketiga migrasi sebelumnya sudah masuk.
-- Aman diulang (seluruhnya create or replace).
--
-- ------------------------------------------------------------
-- APA YANG SALAH
-- ------------------------------------------------------------
-- `auth.users.email` bertipe `character varying(255)`. Empat fungsi baru
-- mendeklarasikan kolom keluarannya sebagai `text`, dan RETURN QUERY di
-- PL/pgSQL menuntut kecocokan tipe PERSIS — tidak ada cast implisit.
-- Gejalanya:
--
--   ERROR 42804: structure of query does not match function result type
--   DETAIL: Returned type character varying(255) does not match
--           expected type text in column 2.
--
-- Fungsi yang terkena hanya yang membaca email dari auth.users:
--   admin_list_ai_quota, admin_list_quota_actions,
--   admin_list_insiden, admin_insiden_korban
--
-- ------------------------------------------------------------
-- KENAPA INI LOLOS SEMUA PEMERIKSAAN SEBELUMNYA
-- ------------------------------------------------------------
-- Parser PostgreSQL dan parser PL/pgSQL keduanya meloloskannya: secara sintaks
-- tidak ada yang salah. Ketidakcocokan tipe RETURN QUERY hanya muncul saat
-- fungsinya BENAR-BENAR DIJALANKAN dan baris pertama hendak dikembalikan.
--
-- `admin_list_users` yang lama selamat bukan karena lebih benar, melainkan
-- karena ia `language sql` — perencana kueri menyisipkan cast sendiri di sana.
-- Kemiripan itulah yang membuat kesalahan ini tidak terlihat saat menulisnya.
--
-- Pelajarannya, dan ini berlaku untuk fungsi berikutnya: setiap RPC baru harus
-- benar-benar DIPANGGIL sekali sebagai pengguna sungguhan sebelum dianggap
-- selesai. Migrasi yang "berhasil dijalankan" hanya membuktikan DDL-nya sah,
-- bukan bahwa fungsinya bisa mengembalikan satu baris pun.
--
-- ------------------------------------------------------------
-- KENAPA TAMBALAN TERPISAH, BUKAN MENJALANKAN ULANG MIGRASINYA
-- ------------------------------------------------------------
-- migration_admin_kuota_kontrol.sql memuat `ai_quota_resolve` versi 10 kolom,
-- sementara yang hidup sekarang versi 14 kolom dari migration_ai_token_budget.
-- `create or replace function` TIDAK BISA mengubah tipe kembalian fungsi yang
-- sudah ada, jadi menjalankan ulang berkas itu akan berhenti dengan error di
-- tengah jalan — dan meninggalkan keadaan setengah jadi.
-- ============================================================

-- ------------------------------------------------------------
-- 1) admin_list_ai_quota — versi dengan anggaran token
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
    coalesce((select sum(u.total_tokens) from public.workspace_ai_usage u
               where u.workspace_id = w.id and u.day = d), 0),
    -- Token siklus berjalan.
    coalesce((select sum(u.total_tokens) from public.workspace_ai_usage u
               where u.workspace_id = w.id and u.day >= s.c_start and u.day <= d), 0),
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
               where u.workspace_id = w.id and u.day > d - 30), 0)
  from ws w
  join siklus s on s.wid = w.id
  join public.ai_plans pl on pl.code = s.plan_code
  order by s.suspended desc, w.business_name nulls last;
end;
$$;

-- ------------------------------------------------------------
-- 2) admin_list_quota_actions
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

-- ------------------------------------------------------------
-- 3) admin_list_insiden
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 4) admin_insiden_korban
-- ------------------------------------------------------------
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

-- ============================================================
-- SELESAI. Tidak perlu deploy ulang Edge Function: keempat fungsi ini
-- hanya dipakai dashboard admin, bukan oleh Edge Function mana pun.
-- ============================================================
