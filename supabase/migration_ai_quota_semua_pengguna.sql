-- ============================================================
-- TAB KUOTA AI HARUS MENAMPILKAN SEMUA PENGGUNA TERDAFTAR
--
-- Jalankan SETELAH migration_ai_feature_model_map.sql. Aman diulang.
-- ============================================================
-- GEJALA: pengguna hansenj2506@gmail.com terdaftar, punya profil ("Ferdi" /
-- "Ferdinant"), tapi TIDAK PERNAH muncul di tab Kuota AI. Dari layar admin ia
-- seolah tidak ada — kuotanya tidak bisa dilihat, tidak bisa diatur, dan
-- biayanya tidak masuk total mana pun.
--
-- SEBAB: admin_list_ai_quota() membuang siapa pun yang menjadi STAF AKTIF di
-- workspace orang lain:
--
--     where not exists (select 1 from staff_members m
--                        where m.member_id = p.id and m.status = 'active')
--
-- Filter itu berangkat dari asumsi "staf aktif bukan pemilik workspace".
-- Asumsi tersebut BERTENTANGAN dengan aturan dasar aplikasi ini, yang tertulis
-- jelas di src/lib/api.js:
--
--     "setiap pengguna SELALU memiliki workspace-nya sendiri. Keanggotaan
--      sebagai staf di usaha orang lain bersifat TAMBAHAN dan hanya aktif bila
--      pengguna MEMILIHNYA sendiri lewat pengalih workspace."
--
-- Aturan itu lahir dari bug yang sudah pernah diperbaiki: pengguna baru yang
-- emailnya pernah diundang jadi staf langsung "diserap" ke workspace pengundang
-- dan tidak pernah bisa punya usaha sendiri. Filter di admin_list_ai_quota()
-- adalah sisa terakhir dari asumsi lama itu — ia masih menyerap orang, kali ini
-- dari penglihatan admin.
--
-- PERBAIKAN:
--   1. Filter dibuang. Setiap pengguna = satu workspace, tanpa kecuali.
--   2. Sumbernya pindah dari public.profiles ke auth.users (LEFT JOIN ke
--      profiles). Sebelumnya INNER JOIN: pengguna yang terdaftar tapi barisnya
--      di profiles gagal dibuat akan hilang diam-diam dengan sebab yang
--      BERBEDA — dan gejalanya persis sama, sehingga akan didiagnosis ulang
--      dari nol. Sekarang ia tetap muncul, dengan nama usaha kosong.
--   3. Dua kolom baru menjelaskan barisnya, bukan sekadar menambahnya:
--      is_staff_elsewhere + staff_at.
--
-- KENAPA KOLOM PENJELAS ITU WAJIB: selama ai_workspace_id() masih seperti
-- sekarang, SELURUH pemakaian AI seorang staf aktif dicatat ke workspace
-- majikannya — termasuk saat ia sedang membuka usahanya SENDIRI. Jadi baris
-- baru ini akan selamanya menunjukkan 0 pemakaian. Tanpa penjelasan di layar,
-- angka nol itu terbaca "pengguna ini tidak memakai AI", padahal artinya
-- "pemakaiannya tercatat di tempat lain". Lihat catatan di kaki berkas ini.
-- ============================================================

-- DROP DULU: menambah kolom pada RETURNS TABLE berarti mengubah tipe
-- kembalian, dan `create or replace` menolaknya dengan "cannot change return
-- type of existing function".
drop function if exists public.admin_list_ai_quota();

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
  tokens_cycle_30h  bigint,
  usd_day           jsonb,
  usd_cycle         jsonb,
  usd_30h           jsonb,
  is_staff_elsewhere boolean,
  staff_at           text
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
    -- SUMBER = auth.users, bukan profiles. Pengguna yang terdaftar tapi
    -- profilnya gagal dibuat tetap harus terlihat — hilang dari daftar adalah
    -- kegagalan yang menyamar jadi "tidak ada penggunanya".
    --
    -- email di-cast ke text: auth.users.email bertipe varchar(255), dan
    -- RETURN QUERY plpgsql menolak ketidakcocokan tipe sekecil apa pun.
    select u.id,
           u.email::text     as email,
           p.business_name,
           p.owner_name
      from auth.users u
      left join public.profiles p on p.id = u.id
     where u.deleted_at is null
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
    -- ::bigint WAJIB: sum() atas bigint menghasilkan numeric.
    coalesce((select sum(u.total_tokens) from public.workspace_ai_usage u
               where u.workspace_id = w.id and u.day = d), 0)::bigint,
    coalesce((select sum(u.total_tokens) from public.workspace_ai_usage u
               where u.workspace_id = w.id and u.day >= s.c_start and u.day <= d), 0)::bigint,
    coalesce(s.tok_hari_ov,  pl.token_cap_daily),
    coalesce(s.tok_bulan_ov, pl.token_cap_monthly),
    s.tok_hari_ov,
    s.tok_bulan_ov,
    coalesce((select sum(u.total_tokens) from public.workspace_ai_usage u
               where u.workspace_id = w.id and u.day > d - 30), 0)::bigint,
    public.ai_usd_range(w.id, d, d),
    public.ai_usd_range(w.id, s.c_start, d),
    public.ai_usd_range(w.id, d - 29, d),
    -- Penjelas baris, bukan sekadar penanda. Selama ai_workspace_id() belum
    -- ikut diperbaiki, workspace milik staf aktif akan selamanya menunjukkan
    -- 0 pemakaian karena seluruh pemakaiannya tercatat ke majikannya.
    exists (select 1 from public.staff_members m
             where m.member_id = w.id and m.status = 'active'),
    (select string_agg(coalesce(o.business_name, left(m.owner_id::text, 8)), ', ')
       from public.staff_members m
       left join public.profiles o on o.id = m.owner_id
      where m.member_id = w.id and m.status = 'active')
  from ws w
  join siklus s on s.wid = w.id
  join public.ai_plans pl on pl.code = s.plan_code
  order by s.suspended desc, w.business_name nulls last, w.email;
end;
$$;

revoke all on function public.admin_list_ai_quota() from public;
grant execute on function public.admin_list_ai_quota() to authenticated;

-- ============================================================
-- YANG BELUM DIPERBAIKI DI SINI, DAN SENGAJA
-- ============================================================
-- ai_workspace_id() menentukan workspace mana yang ditagih untuk satu
-- permintaan AI:
--
--     select coalesce(
--       (select m.owner_id from staff_members m
--         where m.member_id = auth.uid() and m.status = 'active' limit 1),
--       auth.uid());
--
-- Ia SELALU memilih majikan bila pemanggilnya staf aktif — tanpa melihat
-- workspace mana yang sedang dibuka. Padahal lapisan AI yang lebih baru
-- (_shared/ai/workspace-scope.ts → resolveScope) sudah menerima workspace
-- pilihan dari klien dan memverifikasinya lewat resolve_owner().
--
-- Akibatnya satu permintaan AI bisa MEMBACA data workspace A tapi MENAGIH
-- kuota workspace B: seorang staf yang sedang membuka usahanya SENDIRI tetap
-- memotong kredit majikannya. Ada pula `limit 1` tanpa ORDER BY — bila
-- seseorang menjadi staf aktif di lebih dari satu workspace (yang menurut
-- komentar di src/lib/api.js memang sah), majikan mana yang tertagih tidak
-- ditentukan oleh apa pun.
--
-- Perbaikannya menyentuh penagihan SELURUH lalu lintas AI dan menuntut
-- deploy ulang 8 Edge Function, jadi ia dipisah ke keputusan tersendiri dan
-- TIDAK dibundel ke perbaikan tampilan ini.
-- ============================================================
