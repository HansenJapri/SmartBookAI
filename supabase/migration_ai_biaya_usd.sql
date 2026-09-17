-- ============================================================
-- BIAYA NYATA DALAM USD — menerjemahkan token menjadi uang
--
-- Jalankan SETELAH migration_ai_token_budget.sql. Aman diulang.
--
-- ------------------------------------------------------------
-- KENAPA INI ADA
-- ------------------------------------------------------------
-- Dashboard admin sudah bisa menjawab "akun ini memakai berapa token", tapi
-- tidak pernah bisa menjawab pertanyaan yang sebenarnya ditanyakan: BERAPA
-- BIAYANYA. Token bukan uang, dan nilainya tidak seragam — satu juta token
-- Flash berharga beberapa kali lipat satu juta token Flash-Lite, dan token
-- keluaran jauh lebih mahal daripada token masukan pada model yang sama.
--
-- Akibatnya angka "2,5 jt token" di layar admin terbaca seperti rupiah oleh
-- siapa pun yang tidak menulis kodenya. Itu bukan salah pembacanya: angka
-- berdigit tujuh tanpa satuan uang memang mengundang salah baca, dan keputusan
-- harga paket diambil dari angka itu.
--
-- ------------------------------------------------------------
-- KENAPA TABEL, BUKAN KONSTANTA DI KODE
-- ------------------------------------------------------------
-- Sama alasannya dengan ai_credit_rates: harga Google berubah tanpa meminta
-- izin siapa pun, dan model baru muncul lebih cepat daripada siklus deploy.
-- Harga yang dipatok di kode berarti setiap penyesuaian harga menunggu rilis,
-- dan riwayat biaya lama ikut berubah surut ketika angkanya diganti.
--
-- effective_from membuat perubahan harga BERLAKU KE DEPAN saja, sehingga biaya
-- bulan lalu tetap dihitung dengan harga yang berlaku bulan lalu.
--
-- ------------------------------------------------------------
-- MODEL TANPA HARGA = NULL, BUKAN NOL
-- ------------------------------------------------------------
-- Model yang belum terdaftar harganya menghasilkan biaya NULL, dan tokennya
-- dijumlahkan terpisah sebagai `tokens_tanpa_harga`. Ini disengaja: nol di
-- kolom biaya terbaca sebagai "gratis", dan admin yang melihat $0,00 pada akun
-- yang sebenarnya boros tidak punya alasan untuk curiga. Angka yang hilang
-- harus terlihat hilang.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Kartu harga model
-- ------------------------------------------------------------
create table if not exists public.ai_model_prices (
  model            text not null,
  -- USD per SATU JUTA token, satuan yang dipakai Google di halaman harganya.
  -- Menyimpannya per-juta (bukan per-token) menjaga angka tetap terbaca mata
  -- manusia saat diperiksa langsung di tabel: 0.10 bukan 0.0000001.
  input_usd_mtok   numeric(12, 6) not null check (input_usd_mtok  >= 0),
  output_usd_mtok  numeric(12, 6) not null check (output_usd_mtok >= 0),
  effective_from   date not null,
  note             text,
  primary key (model, effective_from)
);

alter table public.ai_model_prices enable row level security;

-- Harga dibaca oleh RPC security definer, bukan langsung oleh klien. Tidak ada
-- policy select untuk authenticated: harga pokok adalah angka internal, dan
-- pelanggan tidak perlu — juga tidak seharusnya — bisa menghitung margin.
revoke all on table public.ai_model_prices from anon, authenticated;

comment on table public.ai_model_prices is
  'Harga Google per 1 juta token, per model, berlaku sejak effective_from. Model tanpa baris di sini menghasilkan biaya NULL (tidak diketahui), bukan 0.';

-- ------------------------------------------------------------
-- 2) Seed harga
-- ------------------------------------------------------------
-- ANGKA DI BAWAH ADALAH TITIK AWAL YANG HARUS DIVERIFIKASI, bukan kebenaran.
-- Harga resmi hanya ada di halaman harga Google, dan hanya admin yang memegang
-- tagihan sebenarnya yang bisa memastikannya. Baris ini sengaja diberi note
-- "PERIKSA" supaya tidak ada yang mengira angka ini sudah dikonfirmasi.
--
-- Pola tarif yang dipakai mengikuti kelas model, bukan nomor versinya:
--   Flash-Lite  kelas termurah, dipakai chat/crud/insight/ocr
--   Flash       kelas menengah, dipakai catat/hpp_draft/makro
--   Live & TTS  kelas audio, ditagih berbeda dari teks
--
-- effective_from DIPATOK ke tanggal tetap. Memakai current_date berarti
-- menjalankan ulang migrasi ini di hari lain menyisipkan baris harga BARU dan
-- diam-diam membatalkan harga yang sudah dikoreksi admin.
insert into public.ai_model_prices (model, input_usd_mtok, output_usd_mtok, effective_from, note) values
  ('gemini-3.5-flash-lite',        0.10,  0.40, date '2026-01-01', 'PERIKSA terhadap halaman harga Google — seed kelas Flash-Lite'),
  ('gemini-3.1-flash-lite',        0.10,  0.40, date '2026-01-01', 'PERIKSA terhadap halaman harga Google — seed kelas Flash-Lite'),
  ('gemini-3.5-flash',             0.30,  2.50, date '2026-01-01', 'PERIKSA terhadap halaman harga Google — seed kelas Flash'),
  ('gemini-3.1-flash',             0.30,  2.50, date '2026-01-01', 'PERIKSA terhadap halaman harga Google — seed kelas Flash'),
  ('gemini-3.1-flash-live-preview', 0.50, 2.00, date '2026-01-01', 'PERIKSA — kelas audio Live, tarif audio berbeda dari teks'),
  ('gemini-3.1-flash-tts-preview',  0.50, 2.00, date '2026-01-01', 'PERIKSA — kelas audio TTS, tarif audio berbeda dari teks')
on conflict (model, effective_from) do nothing;

-- ------------------------------------------------------------
-- 3) Resolusi harga yang berlaku
-- ------------------------------------------------------------
-- Harga yang berlaku pada suatu tanggal = effective_from terbesar yang tidak
-- melewati tanggal itu. Tidak ada baris → NULL, dan NULL menjalar sampai ke
-- kolom biaya. Itulah gunanya.
create or replace function public.ai_model_price(p_model text, p_on date default null)
returns public.ai_model_prices
language sql
stable
security definer
set search_path = public
as $$
  select *
    from public.ai_model_prices r
   where r.model = p_model
     and r.effective_from <= coalesce(p_on, public.ai_today_pacific())
   order by r.effective_from desc
   limit 1;
$$;

revoke all on function public.ai_model_price(text, date) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4) Biaya satu rentang tanggal untuk satu workspace
-- ------------------------------------------------------------
-- Dihitung dari workspace_ai_usage — agregat PERMANEN yang tidak pernah
-- disentuh job retensi. ai_activity_log punya rincian per panggilan yang lebih
-- tajam, tapi ia dijadwalkan dipangkas pada 90 hari; biaya yang hilang setelah
-- tiga bulan bukan catatan biaya.
--
-- TIGA KETIDAKTEPATAN YANG DIAKUI TERBUKA, supaya tidak ada yang mengira angka
-- ini setara dengan invoice Google:
--
--   1. `last_model` adalah model TERAKHIR pada hari itu untuk fitur itu. Bila
--      fallback sempat aktif di tengah hari, sebagian token sebenarnya milik
--      model cadangan. Kesalahannya kecil karena rantai fallback sengaja
--      berpindah antar model sekelas (lihat FEATURE_ROUTES), tapi bukan nol.
--
--   2. Token `thinking` ditagih Google sebagai KELUARAN, jadi ia dijumlahkan
--      ke sisi output — bukan diabaikan seperti kalau hanya prompt+completion
--      yang dihitung.
--
--   3. `wasted_tokens` (percobaan yang dibuang lalu diulang) tetap ditagih
--      Google walau tidak masuk total_tokens. Ia dihargai pada tarif KELUARAN
--      — tarif yang lebih mahal — dengan sengaja: untuk alat anggaran, menaksir
--      biaya terlalu tinggi jauh lebih aman daripada terlalu rendah.
create or replace function public.ai_usd_range(
  p_workspace uuid,
  p_from      date,
  p_to        date
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  -- LATERAL, bukan (ai_model_price(...)).kolom dua kali: pemanggilan bergaya
  -- field-selection itu mengeksekusi fungsinya SEKALI PER KOLOM yang diambil,
  -- jadi dua kolom berarti dua kali pencarian harga untuk setiap baris
  -- pemakaian. Di layar yang memanggil fungsi ini tiga kali per akun, biayanya
  -- berlipat cepat tanpa satu pun angka di layar ikut berubah.
  with baris as (
    select
      u.total_tokens,
      u.prompt_tokens,
      u.completion_tokens + u.thinking_tokens as out_tokens,
      u.wasted_tokens,
      h.input_usd_mtok  as in_price,
      h.output_usd_mtok as out_price
    from public.workspace_ai_usage u
    left join lateral public.ai_model_price(u.last_model, u.day) h on true
    where u.workspace_id = p_workspace
      and u.day >= p_from
      and u.day <= p_to
  )
  select jsonb_build_object(
    -- Biaya pemakaian yang berhasil.
    'usd', round(coalesce(sum(
        case when in_price is null then null
             else prompt_tokens * in_price / 1000000.0
                + out_tokens    * out_price / 1000000.0
        end), 0)::numeric, 6),
    -- Biaya percobaan yang dibuang. Dipisah supaya "kita membayar untuk retry"
    -- tidak menyamar jadi biaya pemakaian normal — itulah alasan kolom
    -- wasted_tokens dipisah sejak awal.
    'usd_retry', round(coalesce(sum(
        case when out_price is null then null
             else wasted_tokens * out_price / 1000000.0
        end), 0)::numeric, 6),
    -- Token yang modelnya tidak dikenal harganya. Selama angka ini > 0, biaya
    -- di atas adalah batas BAWAH, dan UI wajib mengatakannya.
    'tokens_tanpa_harga', coalesce(sum(
        case when in_price is null then total_tokens + wasted_tokens else 0 end), 0)::bigint,
    'tokens_berharga', coalesce(sum(
        case when in_price is null then 0 else total_tokens + wasted_tokens end), 0)::bigint
  )
  from baris;
$$;

revoke all on function public.ai_usd_range(uuid, date, date) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 5) Daftar kuota admin kini membawa biaya USD
-- ------------------------------------------------------------
-- Tiga rentang, sama dengan tiga rentang token yang sudah ada, supaya setiap
-- angka token di layar punya pasangan uangnya dan tidak ada yang perlu
-- mengalikan sendiri di kepala.
--
-- DROP DULU, BUKAN `create or replace` SAJA. Menambah kolom pada RETURNS TABLE
-- berarti mengubah tipe kembalian, dan Postgres menolaknya dengan "cannot
-- change return type of existing function" — `create or replace` tidak bisa
-- menolongnya. Tanpa baris ini seluruh migrasi gagal di tengah jalan pada
-- database yang sudah punya versi lamanya, yaitu setiap database yang sudah
-- berjalan. Kesalahan yang sama sudah pernah mematikan seluruh fitur AI
-- serentak (lihat kepala migration_ai_telemetry.sql).
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
  usd_30h           jsonb
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
    coalesce((select sum(u.total_tokens) from public.workspace_ai_usage u
               where u.workspace_id = w.id and u.day >= s.c_start and u.day <= d), 0)::bigint,
    coalesce(s.tok_hari_ov,  pl.token_cap_daily),
    coalesce(s.tok_bulan_ov, pl.token_cap_monthly),
    s.tok_hari_ov,
    s.tok_bulan_ov,
    coalesce((select sum(u.total_tokens) from public.workspace_ai_usage u
               where u.workspace_id = w.id and u.day > d - 30), 0)::bigint,
    -- Biaya USD untuk tiga rentang yang sama dengan tiga rentang token di atas.
    public.ai_usd_range(w.id, d, d),
    public.ai_usd_range(w.id, s.c_start, d),
    public.ai_usd_range(w.id, d - 29, d)
  from ws w
  join siklus s on s.wid = w.id
  join public.ai_plans pl on pl.code = s.plan_code
  order by s.suspended desc, w.business_name nulls last;
end;
$$;

revoke all on function public.admin_list_ai_quota() from public;
grant execute on function public.admin_list_ai_quota() to authenticated;

-- ------------------------------------------------------------
-- 6) RPC admin: GESER kredit naik atau turun (bukan mengganti)
-- ------------------------------------------------------------
-- admin_set_credit_override sudah ada dan MENGGANTI jatah. Itu benar untuk
-- "akun ini paketnya khusus 500", tapi salah untuk dua kasus yang jauh lebih
-- sering terjadi: pelanggan kehabisan di tengah siklus dan minta tambahan, atau
-- jatah kelebihan diberikan dan perlu ditarik kembali.
--
-- Dengan RPC yang mengganti, admin harus membuka jatah efektif saat ini,
-- menjumlahkan atau menguranginya sendiri di kepala, lalu mengetik hasilnya.
-- Aritmatika mental di atas kolom yang menentukan tagihan orang adalah cara
-- yang bagus untuk memberi 100 kredit kepada akun yang seharusnya menerima
-- 1.000 — dan cara yang lebih bagus lagi untuk mencabutnya.
--
-- SATU FUNGSI BERTANDA, BUKAN DUA. `admin_add_credits` + `admin_reduce_credits`
-- berarti dua salinan penjaga yang sama (paket tanpa batas, jatah negatif,
-- pencatatan audit) yang harus ikut berubah bersama selamanya. Yang kedua
-- selalu tertinggal.
create or replace function public.admin_adjust_credits(
  p_workspace uuid,
  p_delta     numeric,   -- positif menambah, negatif mengurangi
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pol      public.workspace_ai_policy%rowtype;
  pl       public.ai_plans%rowtype;
  efektif  numeric;
  baru     numeric;
  terpakai numeric := 0;
  mulai    date;
begin
  perform public.admin__jaga(p_workspace);

  if p_delta is null or p_delta = 0 then
    raise exception 'Perubahan kredit tidak boleh nol — sebutkan berapa yang ditambah (positif) atau dikurangi (negatif)'
      using errcode = 'invalid_parameter_value';
  end if;

  pol := public.admin__pastikan_policy(p_workspace);
  select * into pl from public.ai_plans where code = coalesce(pol.plan_code, 'free');
  if pl.code is null then
    select * into pl from public.ai_plans where code = 'free';
  end if;

  efektif := coalesce(pol.monthly_credit_override, pl.monthly_credit_cap);

  -- Paket tanpa batas (Enterprise) tidak punya angka untuk digeser. Menambah
  -- padanya tidak berarti apa-apa; MENGURANGI justru menurunkan jatahnya dari
  -- tak-hingga menjadi terhingga — kebalikan dari yang diminta. Ditolak, bukan
  -- diam-diam dikerjakan.
  if efektif is null then
    raise exception 'Paket % tanpa batas kredit — tidak ada angka yang bisa digeser. Pakai "kredit bulanan khusus" untuk mulai membatasinya.',
      coalesce(pl.label, pl.code)
      using errcode = 'invalid_parameter_value';
  end if;

  baru := efektif + p_delta;

  if baru < 0 then
    raise exception 'Pengurangan % membuat jatah menjadi % — jatah kredit tidak bisa negatif. Jatah saat ini %.',
      abs(p_delta), baru, efektif
      using errcode = 'invalid_parameter_value';
  end if;

  -- Pemakaian siklus berjalan dibaca untuk DILAPORKAN BALIK, bukan untuk
  -- menolak. Menurunkan jatah ke bawah pemakaian adalah tindakan sah (mis.
  -- menghentikan akun yang menyalahgunakan), tapi akibatnya langsung: AI-nya
  -- terblokir saat itu juga. Admin berhak melakukannya dan berhak tahu bahwa
  -- ia melakukannya — dua-duanya, bukan salah satu.
  mulai := public.ai_cycle_start(coalesce(pol.cycle_anchor_day, 1));
  select coalesce(sum(u.credits_used), 0) into terpakai
    from public.workspace_ai_usage u
   where u.workspace_id = p_workspace
     and u.day >= mulai
     and u.day <= public.ai_today_pacific();

  update public.workspace_ai_policy
     set monthly_credit_override = baru, updated_by = auth.uid(), updated_at = now()
   where workspace_id = p_workspace;

  insert into public.admin_quota_actions
    (workspace_id, action, feature, before_value, after_value, note)
  values
    (p_workspace, 'set_credit_override', null,
     jsonb_build_object('kredit', efektif, 'sumber',
       case when pol.monthly_credit_override is null then 'paket' else 'override' end),
     jsonb_build_object('kredit', baru, 'delta', p_delta,
                        'terpakai_saat_itu', round(terpakai, 2)),
     p_note);

  return jsonb_build_object(
    'workspace_id', p_workspace,
    'sebelum',  efektif,
    'delta',    p_delta,
    'sesudah',  baru,
    'terpakai', round(terpakai, 2),
    -- Dipakai UI untuk mengatakan terus terang "akun ini sekarang terblokir",
    -- alih-alih melaporkan sukses dan membiarkan admin mengetahuinya dari
    -- keluhan pelanggan besok pagi.
    'memblokir_sekarang', terpakai >= baru
  );
end;
$$;

revoke all on function public.admin_adjust_credits(uuid, numeric, text) from public;
grant execute on function public.admin_adjust_credits(uuid, numeric, text) to authenticated;

-- Pendahulunya yang hanya bisa menambah. Di-drop, bukan dibiarkan: ia tidak
-- pernah sempat dipanggil UI mana pun (dashboard admin belum di-deploy saat ia
-- dibuat), dan meninggalkan dua jalur menulis jatah kredit berarti salah satunya
-- suatu saat dipakai tanpa penjaga yang belakangan ditambahkan di sini.
drop function if exists public.admin_add_credits(uuid, numeric, text);

-- ------------------------------------------------------------
-- 7) RPC admin: koreksi harga model
-- ------------------------------------------------------------
-- Harga seed di bagian 2 bertanda PERIKSA. Tanpa jalur koreksi di aplikasi,
-- satu-satunya cara memperbaikinya adalah SQL Editor — persis keadaan yang
-- halaman Kuota AI dibuat untuk mengakhiri.
--
-- Harga baru selalu menjadi BARIS BARU per tanggal berlaku, tidak pernah
-- menimpa baris lama, supaya biaya bulan lalu tetap dihitung dengan harga
-- bulan lalu.
create or replace function public.admin_set_model_price(
  p_model      text,
  p_input_usd  numeric,
  p_output_usd numeric,
  p_berlaku    date default null,
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := coalesce(p_berlaku, public.ai_today_pacific());
begin
  if not public.is_admin() then
    raise exception 'Tidak diizinkan: bukan admin' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_model), '') = '' then
    raise exception 'Nama model wajib diisi' using errcode = 'invalid_parameter_value';
  end if;
  if p_input_usd is null or p_input_usd < 0 or p_output_usd is null or p_output_usd < 0 then
    raise exception 'Harga tidak boleh kosong atau negatif' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.ai_model_prices (model, input_usd_mtok, output_usd_mtok, effective_from, note)
  values (trim(p_model), p_input_usd, p_output_usd, d, p_note)
  on conflict (model, effective_from) do update
     set input_usd_mtok  = excluded.input_usd_mtok,
         output_usd_mtok = excluded.output_usd_mtok,
         note            = excluded.note;

  return jsonb_build_object('model', trim(p_model), 'berlaku', d,
                            'input_usd_mtok', p_input_usd, 'output_usd_mtok', p_output_usd);
end;
$$;

revoke all on function public.admin_set_model_price(text, numeric, numeric, date, text) from public;
grant execute on function public.admin_set_model_price(text, numeric, numeric, date, text) to authenticated;

-- Daftar harga untuk layar admin, termasuk model yang SUDAH DIPAKAI tapi belum
-- punya harga. Model yang hilang dari daftar ini tidak akan pernah dicari
-- admin, dan tokennya diam-diam tidak pernah masuk hitungan biaya.
create or replace function public.admin_list_model_prices()
returns table (
  model           text,
  input_usd_mtok  numeric,
  output_usd_mtok numeric,
  effective_from  date,
  note            text,
  tokens_30h      bigint
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
  with dipakai as (
    select u.last_model as m, sum(u.total_tokens + u.wasted_tokens)::bigint as tok
      from public.workspace_ai_usage u
     where u.last_model is not null and u.day > d - 30
     group by u.last_model
  ),
  semua as (
    select p.model as m from public.ai_model_prices p
    union
    select dipakai.m from dipakai
  )
  -- Cast eksplisit ke numeric telanjang: kolomnya numeric(12,6), dan RETURN
  -- QUERY plpgsql pernah menolak ketidakcocokan tipe sekecil ini.
  select
    s.m::text,
    h.input_usd_mtok::numeric,
    h.output_usd_mtok::numeric,
    h.effective_from::date,
    h.note::text,
    coalesce(dp.tok, 0)::bigint
  from semua s
  left join dipakai dp on dp.m = s.m
  left join lateral public.ai_model_price(s.m, d) h on true
  order by coalesce(dp.tok, 0) desc, s.m;
end;
$$;

revoke all on function public.admin_list_model_prices() from public;
grant execute on function public.admin_list_model_prices() to authenticated;

-- ============================================================
-- SELESAI.
--
-- WAJIB setelah menjalankan ini:
--   1. Periksa harga di tabel ai_model_prices terhadap halaman harga Google.
--      Seluruh baris seed bertanda "PERIKSA" dan hanya perkiraan kelas model.
--   2. Deploy ulang admin-dashboard — admin_list_ai_quota menambah 3 kolom.
--
-- Edge Function TIDAK perlu di-deploy ulang: ai_quota_resolve tidak berubah.
-- ============================================================
