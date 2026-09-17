-- ============================================================
-- TAMBALAN 2: sum() atas bigint menghasilkan numeric, bukan bigint
--
-- Jalankan SETELAH migration_fix_email_text.sql. Aman diulang.
--
-- ------------------------------------------------------------
-- APA YANG SALAH
-- ------------------------------------------------------------
-- Di PostgreSQL, sum(bigint) mengembalikan NUMERIC — bukan bigint. Tiga kolom
-- token di admin_list_ai_quota dideklarasikan bigint tetapi diisi hasil sum(),
-- jadi RETURN QUERY menolaknya:
--
--   ERROR 42804: structure of query does not match function result type
--   DETAIL: Returned type numeric does not match expected type bigint
--           in column 19.
--
-- Kolom yang terkena: tokens_day (19), tokens_cycle (20), tokens_cycle_30h (25).
-- 22 kolom lainnya sudah cocok dan tidak disentuh.
--
-- Diperbaiki dengan cast eksplisit ke bigint, BUKAN dengan mengubah deklarasi
-- menjadi numeric: token adalah cacahan bulat, dan numeric akan mengundang
-- nilai pecahan yang tidak punya arti apa pun di sini.
--
-- ------------------------------------------------------------
-- KENAPA INI TIDAK KETAHUAN BERSAMA TAMBALAN PERTAMA
-- ------------------------------------------------------------
-- PostgreSQL berhenti di ketidakcocokan PERTAMA yang ditemuinya. Kolom 2
-- (email) gagal lebih dulu, sehingga kolom 19 tidak pernah sempat diperiksa.
-- Menambal satu lalu menjalankan ulang akan selalu memunculkan yang berikutnya,
-- satu per satu.
--
-- Karena itu kali ini seluruh 25 kolom dibandingkan sekaligus lebih dulu:
-- kueri dalam fungsi dijalankan `limit 0` ke tabel sementara, lalu tipe tiap
-- kolomnya dibaca dari information_schema dan diadu dengan RETURNS TABLE.
-- Hasilnya tepat tiga ketidakcocokan, dan ketiganya diperbaiki di sini —
-- tidak ada yang keempat.
-- ============================================================

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

-- ============================================================
-- SELESAI. Tidak perlu deploy ulang Edge Function: fungsi ini hanya
-- dipakai dashboard admin.
-- ============================================================
