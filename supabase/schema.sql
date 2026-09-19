


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "auth";


ALTER SCHEMA "auth" OWNER TO "supabase_admin";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE SCHEMA IF NOT EXISTS "ops";


ALTER SCHEMA "ops" OWNER TO "postgres";


COMMENT ON SCHEMA "ops" IS 'Data operasional server (heartbeat cron, konfigurasi internal). SENGAJA tidak diekspos PostgREST: bukan bagian dari permukaan API aplikasi, dan tidak boleh tercampur dengan data bisnis pengguna di schema public.';



CREATE TYPE "auth"."aal_level" AS ENUM (
    'aal1',
    'aal2',
    'aal3'
);


ALTER TYPE "auth"."aal_level" OWNER TO "supabase_auth_admin";


CREATE TYPE "auth"."code_challenge_method" AS ENUM (
    's256',
    'plain'
);


ALTER TYPE "auth"."code_challenge_method" OWNER TO "supabase_auth_admin";


CREATE TYPE "auth"."factor_status" AS ENUM (
    'unverified',
    'verified'
);


ALTER TYPE "auth"."factor_status" OWNER TO "supabase_auth_admin";


CREATE TYPE "auth"."factor_type" AS ENUM (
    'totp',
    'webauthn',
    'phone',
    'recovery_code'
);


ALTER TYPE "auth"."factor_type" OWNER TO "supabase_auth_admin";


CREATE TYPE "auth"."oauth_authorization_status" AS ENUM (
    'pending',
    'approved',
    'denied',
    'expired'
);


ALTER TYPE "auth"."oauth_authorization_status" OWNER TO "supabase_auth_admin";


CREATE TYPE "auth"."oauth_client_type" AS ENUM (
    'public',
    'confidential'
);


ALTER TYPE "auth"."oauth_client_type" OWNER TO "supabase_auth_admin";


CREATE TYPE "auth"."oauth_registration_type" AS ENUM (
    'dynamic',
    'manual'
);


ALTER TYPE "auth"."oauth_registration_type" OWNER TO "supabase_auth_admin";


CREATE TYPE "auth"."oauth_response_type" AS ENUM (
    'code'
);


ALTER TYPE "auth"."oauth_response_type" OWNER TO "supabase_auth_admin";


CREATE TYPE "auth"."one_time_token_type" AS ENUM (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
);


ALTER TYPE "auth"."one_time_token_type" OWNER TO "supabase_auth_admin";


CREATE OR REPLACE FUNCTION "auth"."email"() RETURNS "text"
    LANGUAGE "sql" STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;


ALTER FUNCTION "auth"."email"() OWNER TO "supabase_auth_admin";


COMMENT ON FUNCTION "auth"."email"() IS 'Deprecated. Use auth.jwt() -> ''email'' instead.';



CREATE OR REPLACE FUNCTION "auth"."jwt"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    AS $$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;


ALTER FUNCTION "auth"."jwt"() OWNER TO "supabase_auth_admin";


CREATE OR REPLACE FUNCTION "auth"."role"() RETURNS "text"
    LANGUAGE "sql" STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;


ALTER FUNCTION "auth"."role"() OWNER TO "supabase_auth_admin";


COMMENT ON FUNCTION "auth"."role"() IS 'Deprecated. Use auth.jwt() -> ''role'' instead.';



CREATE OR REPLACE FUNCTION "auth"."uid"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;


ALTER FUNCTION "auth"."uid"() OWNER TO "supabase_auth_admin";


COMMENT ON FUNCTION "auth"."uid"() IS 'Deprecated. Use auth.jwt() -> ''sub'' instead.';



CREATE OR REPLACE FUNCTION "ops"."panggil_keepalive"("p_sumber" "text" DEFAULT 'cron-6-hari'::"text") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ops', 'public', 'extensions'
    AS $$
declare
  v_token text;
  v_req   bigint;
begin
  select nilai into v_token from ops.service_config where kunci = 'keepalive_token';
  if v_token is null or length(v_token) < 24 then
    raise exception 'keepalive_token belum ada di ops.service_config';
  end if;

  select net.http_post(
    url     := 'https://vbzmtnpmtgrhovmwjqqk.supabase.co/functions/v1/keepalive?sumber=' || p_sumber,
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-keepalive-token', v_token
    )
  ) into v_req;

  return v_req;
end;
$$;


ALTER FUNCTION "ops"."panggil_keepalive"("p_sumber" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ops"."pangkas_heartbeat"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ops', 'public'
    AS $$
declare
  v_hapus integer;
begin
  delete from ops.service_heartbeat where beat_at < now() - interval '3 months';
  get diagnostics v_hapus = row_count;
  return v_hapus;
end;
$$;


ALTER FUNCTION "ops"."pangkas_heartbeat"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "ops"."ringkasan_kesehatan"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'ops', 'public'
    AS $$
  select jsonb_build_object(
    'diperiksa_pada', now(),
    'makro_run_terakhir', (select max(run_date) from public.macro_runs),
    'makro_ai_status_terakhir', (select ai_status from public.macro_runs order by run_date desc limit 1),
    'makro_ai_terakhir_ok', (select max(run_date) from public.macro_runs where ai_status = 'ok'),
    'makro_hari_sejak_ai_ok', (select (current_date - max(run_date)) from public.macro_runs where ai_status = 'ok'),
    'harga_price_date_terakhir', (select max(price_date) from public.commodity_prices),
    'harga_baris_hari_ini', (
      select count(*) from public.commodity_prices
      where run_date = (select max(run_date) from public.commodity_prices)
    ),
    'kurs_tanggal_terakhir', (select max(rate_date) from public.exchange_rates),
    'inflasi_bulan_terakhir', (select max(month) from public.macro_config),
    'transaksi_terakhir', (select max(created_at) from public.transactions),
    'event_terakhir', (select max(created_at) from public.app_events)
  );
$$;


ALTER FUNCTION "ops"."ringkasan_kesehatan"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_invitation"("p_invite_id" "uuid") RETURNS TABLE("id" "uuid", "owner_id" "uuid", "business_name" "text", "modules" "text"[], "role" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_uid uuid := auth.uid();
  v_row public.staff_members;
begin
  if v_uid is null or v_email = '' then
    raise exception 'Harus masuk (login) untuk menerima undangan'
      using errcode = 'insufficient_privilege';
  end if;

  -- Kunci baris agar dua tab/perangkat tidak mengklaim bersamaan.
  select * into v_row from public.staff_members m
   where m.id = p_invite_id and lower(m.email) = v_email
   for update;

  if v_row.id is null then
    raise exception 'Undangan tidak ditemukan atau bukan untuk email Anda'
      using errcode = 'no_data_found';
  end if;

  if v_row.status = 'revoked' then
    raise exception 'Undangan ini sudah dicabut oleh pemilik usaha'
      using errcode = 'insufficient_privilege';
  end if;

  if v_row.member_id is not null and v_row.member_id <> v_uid then
    raise exception 'Undangan ini sudah diklaim akun lain'
      using errcode = 'insufficient_privilege';
  end if;

  update public.staff_members m
     set member_id = v_uid, status = 'active', declined_at = null
   where m.id = p_invite_id;

  return query
    select m.id, m.owner_id,
           coalesce(nullif(trim(p.business_name), ''), 'Usaha tanpa nama') as business_name,
           m.modules, m.role
    from public.staff_members m
    left join public.profiles p on p.id = m.owner_id
    where m.id = p_invite_id;
end $$;


ALTER FUNCTION "public"."accept_invitation"("p_invite_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_terms"("p_version" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null then
    raise exception 'Harus masuk (login) untuk menyetujui.';
  end if;
  if p_version is null or char_length(p_version) > 20 then
    raise exception 'Versi ketentuan tidak valid.';
  end if;

  update public.profiles set
    accepted_terms      = true,
    accepted_terms_at   = now(),
    accepted_privacy    = true,
    accepted_privacy_at = now(),
    terms_version       = p_version
  where id = auth.uid();
end;
$$;


ALTER FUNCTION "public"."accept_terms"("p_version" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_transaction_with_stock"("p_tx" "jsonb", "p_lines" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.add_transaction_with_stock(p_tx, p_lines, null::uuid);
$$;


ALTER FUNCTION "public"."add_transaction_with_stock"("p_tx" "jsonb", "p_lines" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_transaction_with_stock"("p_tx" "jsonb", "p_lines" "jsonb" DEFAULT '[]'::"jsonb", "p_owner" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_owner uuid := public.resolve_owner(p_owner);
  v_dir text := p_tx->>'direction';
  v_txn transactions;
  v_l jsonb;
  v_qty numeric;
  v_p record;
  v_after numeric;
  v_changes jsonb := '[]'::jsonb;
  v_bom jsonb;
  v_satu jsonb;
begin
  if v_dir not in ('in','out') then
    raise exception 'Jenis transaksi tidak dikenal.';
  end if;

  insert into transactions
    (user_id, description, amount, direction, category, channel, occurred_at,
     payment_status, due_date, customer_name, customer_contact, product_id, qty,
     supplier_id,
     receipt_url, source_ref, customer_id, raw, import_confidence)
  values
    (v_owner,
     p_tx->>'description',
     (p_tx->>'amount')::numeric,
     v_dir,
     coalesce(nullif(p_tx->>'category',''), 'Lain-lain'),
     coalesce(nullif(p_tx->>'channel',''), 'manual'),
     coalesce((p_tx->>'occurred_at')::timestamptz, now()),
     coalesce(nullif(p_tx->>'payment_status',''), 'lunas'),
     nullif(p_tx->>'due_date','')::date,
     nullif(p_tx->>'customer_name',''),
     nullif(p_tx->>'customer_contact',''),
     nullif(p_tx->>'product_id','')::uuid,
     nullif(p_tx->>'qty','')::numeric,
     nullif(p_tx->>'supplier_id','')::uuid,
     nullif(p_tx->>'receipt_url',''),
     nullif(p_tx->>'source_ref',''),
     nullif(p_tx->>'customer_id','')::uuid,
     nullif(p_tx->>'raw',''),
     nullif(p_tx->>'import_confidence',''))
  returning * into v_txn;

  for v_l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := coalesce(nullif(v_l->>'qty','')::numeric, 0);
    if nullif(v_l->>'productId','') is null or v_qty <= 0 then continue; end if;
    select id, stock, name, unit into v_p
      from products where id = (v_l->>'productId')::uuid and user_id = v_owner
      for update;
    if not found then continue; end if;
    v_after := greatest(0, coalesce(v_p.stock, 0) + case when v_dir = 'out' then v_qty else -v_qty end);
    update products set stock = v_after, updated_at = now()
      where id = v_p.id and user_id = v_owner;

    insert into public.stock_movements
      (user_id, transaction_id, product_id, stock_delta, opened_used_delta, asal)
    values
      (v_owner, v_txn.id, v_p.id, v_after - coalesce(v_p.stock, 0), 0, 'langsung');

    v_changes := v_changes || jsonb_build_object(
      'name', v_p.name, 'unit', v_p.unit,
      'before', coalesce(v_p.stock, 0), 'after', v_after);

    if v_dir = 'in' then
      v_bom := public.consume_bom_for_sale(v_p.id, v_qty, v_owner);
      if v_bom is not null and jsonb_array_length(v_bom) > 0 then
        for v_satu in select * from jsonb_array_elements(v_bom) loop
          insert into public.stock_movements
            (user_id, transaction_id, product_id, stock_delta, opened_used_delta, asal)
          values (
            v_owner, v_txn.id, (v_satu->>'product_id')::uuid,
            (v_satu->>'after')::numeric - (v_satu->>'before')::numeric,
            (v_satu->>'opened_used')::numeric - coalesce((v_satu->>'opened_before')::numeric, 0),
            'bom');
        end loop;
        v_changes := v_changes || v_bom;
      end if;
    end if;
  end loop;

  return jsonb_build_object('txn', to_jsonb(v_txn), 'changes', v_changes);
end $$;


ALTER FUNCTION "public"."add_transaction_with_stock"("p_tx" "jsonb", "p_lines" "jsonb", "p_owner" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."add_transaction_with_stock"("p_tx" "jsonb", "p_lines" "jsonb", "p_owner" "uuid") IS 'Menyimpan transaksi + menggerakkan stok secara atomik, dan mencatat setiap pergerakan ke stock_movements. Daftar kolom INSERT-nya HARUS ikut diperbarui setiap kali kolom baru ditambahkan ke transactions — kolom yang tidak disebut hilang tanpa error.';



CREATE OR REPLACE FUNCTION "public"."admin__jaga"("p_workspace" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."admin__jaga"("p_workspace" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."workspace_ai_policy" (
    "workspace_id" "uuid" NOT NULL,
    "plan_code" "text" DEFAULT 'free'::"text" NOT NULL,
    "daily_caps_override" "jsonb",
    "monthly_credit_override" numeric(12,2),
    "cycle_anchor_day" smallint DEFAULT 1 NOT NULL,
    "suspended" boolean DEFAULT false NOT NULL,
    "note" "text",
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "token_cap_daily" bigint,
    "token_cap_monthly" bigint,
    CONSTRAINT "wap_token_cap_daily_positif" CHECK ((("token_cap_daily" IS NULL) OR ("token_cap_daily" >= 0))),
    CONSTRAINT "wap_token_cap_monthly_positif" CHECK ((("token_cap_monthly" IS NULL) OR ("token_cap_monthly" >= 0))),
    CONSTRAINT "workspace_ai_policy_cycle_anchor_day_check" CHECK ((("cycle_anchor_day" >= 1) AND ("cycle_anchor_day" <= 28))),
    CONSTRAINT "workspace_ai_policy_monthly_credit_override_check" CHECK ((("monthly_credit_override" IS NULL) OR ("monthly_credit_override" >= (0)::numeric)))
);


ALTER TABLE "public"."workspace_ai_policy" OWNER TO "postgres";


COMMENT ON COLUMN "public"."workspace_ai_policy"."token_cap_daily" IS 'Rem darurat, BUKAN anggaran kedua. Anjuran: 15-20% dari batas bulanan — cukup longgar untuk hari tutup buku, cukup ketat untuk menangkap skrip yang mengulang sebelum jatah sebulan habis dalam satu sore. null = tanpa batas.';



COMMENT ON COLUMN "public"."workspace_ai_policy"."token_cap_monthly" IS 'Anggaran token per siklus. null = tanpa batas. Ini plafon biaya yang sebenarnya — kredit tidak melacak biaya dengan baik (lihat kepala migrasi).';



CREATE OR REPLACE FUNCTION "public"."admin__pastikan_policy"("p_workspace" "uuid") RETURNS "public"."workspace_ai_policy"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."admin__pastikan_policy"("p_workspace" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_adjust_credits"("p_workspace" "uuid", "p_delta" numeric, "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  -- tak-hingga menjadi terhingga — kebalikan dari yang diminta.
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
  -- menolak. Menurunkan jatah ke bawah pemakaian adalah tindakan sah, tapi
  -- akibatnya langsung: AI-nya terblokir saat itu juga. Admin berhak
  -- melakukannya dan berhak tahu bahwa ia melakukannya — dua-duanya.
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


ALTER FUNCTION "public"."admin_adjust_credits"("p_workspace" "uuid", "p_delta" numeric, "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_ai_telemetry"("p_days" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."admin_ai_telemetry"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_clear_daily_cap"("p_workspace" "uuid", "p_feature" "text", "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."admin_clear_daily_cap"("p_workspace" "uuid", "p_feature" "text", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_user"("p_uid" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
declare
  u_email   text;
  p_row     public.profiles%rowtype;
  ringkas   jsonb;
  alasan    text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Tidak diizinkan: bukan admin' using errcode = 'insufficient_privilege';
  end if;

  if alasan is null then
    raise exception 'Alasan penghapusan wajib diisi. Penghapusan akun bersifat permanen dan wajib dapat dipertanggungjawabkan (UU PDP Pasal 46).'
      using errcode = 'invalid_parameter_value';
  end if;
  if length(alasan) < 10 then
    raise exception 'Alasan terlalu pendek. Tulis minimal 10 karakter yang menjelaskan mengapa akun ini dihapus.'
      using errcode = 'invalid_parameter_value';
  end if;

  if exists (select 1 from public.admins where user_id = p_uid) then
    raise exception 'Akun admin tidak boleh dihapus' using errcode = 'insufficient_privilege';
  end if;

  select email into u_email from auth.users where id = p_uid;
  if u_email is null then
    raise exception 'Akun % tidak ditemukan', p_uid using errcode = 'no_data_found';
  end if;

  select * into p_row from public.profiles where id = p_uid;

  -- Dihitung SEBELUM penghapusan. Sesudahnya, angka-angka ini tidak ada lagi
  -- di mana pun — dan justru angka inilah isi surat pemberitahuan ke otoritas
  -- bila kelak akun ini termasuk terdampak insiden.
  ringkas := jsonb_build_object(
    'transactions',        public.hitung_baris_milik('transactions',        'user_id',  p_uid),
    'feedback',            public.hitung_baris_milik('feedback',            'user_id',  p_uid),
    'app_events',          public.hitung_baris_milik('app_events',          'user_id',  p_uid),
    'audit_logs',          public.hitung_baris_milik('audit_logs',          'owner_id', p_uid),
    'ai_activity_log',     public.hitung_baris_milik('ai_activity_log',     'owner_id', p_uid),
    'workspace_ai_usage',  public.hitung_baris_milik('workspace_ai_usage',  'workspace_id', p_uid),
    'staff_members',       public.hitung_baris_milik('staff_members',       'owner_id', p_uid),
    'products',            public.hitung_baris_milik('products',            'user_id',  p_uid),
    'customers',           public.hitung_baris_milik('customers',           'user_id',  p_uid),
    'employees',           public.hitung_baris_milik('employees',           'user_id',  p_uid)
  );

  insert into public.deleted_accounts
    (user_id, email_hash, email_mask, business_type, account_created_at,
     deleted_by, reason, data_summary)
  values
    (p_uid,
     encode(digest(lower(u_email), 'sha256'), 'hex'),
     public.topeng_email(u_email),
     p_row.business_type,
     p_row.created_at,
     auth.uid(),
     alasan,
     ringkas);

  -- Jejak admin ditulis di sisi server, bukan dititipkan ke browser.
  insert into public.admin_audit_log (admin_id, action, target_table, target_id, meta)
  values (auth.uid(), 'user_deleted', 'auth.users', p_uid::text,
          jsonb_build_object('reason', alasan, 'data_summary', ringkas));

  delete from auth.users where id = p_uid;  -- cascade ke seluruh data miliknya

  return jsonb_build_object(
    'user_id', p_uid,
    'email_mask', public.topeng_email(u_email),
    'data_summary', ringkas,
    'deleted_at', now()
  );
end;
$$;


ALTER FUNCTION "public"."admin_delete_user"("p_uid" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_error_ringkas"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.is_admin() then '{}'::jsonb else jsonb_build_object(
    'baru',            (select count(*) from public.error_logs where status = 'baru'),
    'fatal_baru',      (select count(*) from public.error_logs where status = 'baru' and tingkat = 'fatal'),
    'kejadian_24jam',  (select coalesce(sum(jumlah), 0) from public.error_logs where terakhir_pada > now() - interval '24 hours'),
    'terakhir_pada',   (select max(terakhir_pada) from public.error_logs),
    'fitur_terparah',  (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select fitur, sum(jumlah) as kejadian
        from public.error_logs
        where terakhir_pada > now() - interval '7 days'
        group by fitur order by kejadian desc limit 5
      ) x
    )
  ) end;
$$;


ALTER FUNCTION "public"."admin_error_ringkas"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_feature_cost_stats"() RETURNS TABLE("feature" "text", "last_model" "text", "calls" bigint, "seconds_used" bigint, "avg_tokens_in" numeric, "avg_tokens_out" numeric, "avg_tokens_call" numeric, "pct_input" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'Tidak diizinkan: bukan admin' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    f.feature::text,
    u.last_model::text,
    coalesce(sum(u.count), 0)::bigint,
    coalesce(sum(u.seconds_used), 0)::bigint,
    case when coalesce(sum(u.count), 0) > 0
      then round(sum(u.prompt_tokens)::numeric / sum(u.count), 0) end,
    case when coalesce(sum(u.count), 0) > 0
      then round(sum(u.completion_tokens + u.thinking_tokens)::numeric / sum(u.count), 0) end,
    case when coalesce(sum(u.count), 0) > 0
      then round(sum(u.total_tokens)::numeric / sum(u.count), 0) end,
    case when coalesce(sum(u.prompt_tokens + u.completion_tokens + u.thinking_tokens), 0) > 0
      then round(sum(u.prompt_tokens)::numeric * 100
                  / sum(u.prompt_tokens + u.completion_tokens + u.thinking_tokens), 1) end
  from public.ai_feature_defaults f
  left join public.workspace_ai_usage u
    on u.feature = f.feature and u.last_model is not null
  group by f.feature, f.sort_order, u.last_model
  order by f.sort_order, u.last_model nulls first;
end;
$$;


ALTER FUNCTION "public"."admin_feature_cost_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_insiden_akun_terhapus"("p_id" bigint) RETURNS TABLE("user_id" "uuid", "email_mask" "text", "email_hash" "text", "reason" "text", "data_summary" "jsonb", "deleted_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  ins public.security_incidents%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Tidak diizinkan: bukan admin' using errcode = 'insufficient_privilege';
  end if;

  select * into ins from public.security_incidents where id = p_id;
  if ins.id is null then
    raise exception 'Insiden % tidak ditemukan', p_id using errcode = 'no_data_found';
  end if;

  return query
  select d.user_id, d.email_mask, d.email_hash, d.reason, d.data_summary, d.deleted_at
    from public.deleted_accounts d
   -- Yang relevan adalah akun yang dihapus SESUDAH kejadian mulai: datanya
   -- masih hidup di sistem saat jendela insiden berjalan.
   where d.deleted_at >= coalesce(ins.terjadi_mulai, ins.diketahui_pada - interval '30 days')
   order by d.deleted_at desc;
end;
$$;


ALTER FUNCTION "public"."admin_insiden_akun_terhapus"("p_id" bigint) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."security_incidents" (
    "id" bigint NOT NULL,
    "ref" "text" NOT NULL,
    "judul" "text" NOT NULL,
    "ringkasan" "text" NOT NULL,
    "kategori" "text" DEFAULT 'kebocoran_data'::"text" NOT NULL,
    "tingkat" "text" DEFAULT 'sedang'::"text" NOT NULL,
    "terjadi_mulai" timestamp with time zone,
    "terjadi_sampai" timestamp with time zone,
    "diketahui_pada" timestamp with time zone NOT NULL,
    "batas_lapor" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'terbuka'::"text" NOT NULL,
    "lingkup" "text" DEFAULT 'aktivitas'::"text" NOT NULL,
    "workspace_ids" "uuid"[],
    "kategori_data" "text"[],
    "jumlah_korban" integer,
    "lapor_otoritas_pada" timestamp with time zone,
    "lapor_otoritas_ref" "text",
    "lapor_korban_pada" timestamp with time zone,
    "tindakan" "text",
    "dibuat_oleh" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "security_incidents_judul_check" CHECK ((("char_length"("btrim"("judul")) >= 3) AND ("char_length"("btrim"("judul")) <= 200))),
    CONSTRAINT "security_incidents_jumlah_korban_check" CHECK ((("jumlah_korban" IS NULL) OR ("jumlah_korban" >= 0))),
    CONSTRAINT "security_incidents_kategori_check" CHECK (("kategori" = ANY (ARRAY['kebocoran_data'::"text", 'akses_tidak_sah'::"text", 'kehilangan_data'::"text", 'perubahan_tidak_sah'::"text", 'malware'::"text", 'lainnya'::"text"]))),
    CONSTRAINT "security_incidents_lingkup_check" CHECK (("lingkup" = ANY (ARRAY['aktivitas'::"text", 'semua'::"text", 'terpilih'::"text"]))),
    CONSTRAINT "security_incidents_ringkasan_check" CHECK (("char_length"("btrim"("ringkasan")) >= 10)),
    CONSTRAINT "security_incidents_status_check" CHECK (("status" = ANY (ARRAY['terbuka'::"text", 'investigasi'::"text", 'dilaporkan'::"text", 'selesai'::"text", 'bukan_insiden'::"text"]))),
    CONSTRAINT "security_incidents_tingkat_check" CHECK (("tingkat" = ANY (ARRAY['rendah'::"text", 'sedang'::"text", 'tinggi'::"text", 'kritis'::"text"])))
);


ALTER TABLE "public"."security_incidents" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_insiden_buat"("p_judul" "text", "p_ringkasan" "text", "p_kategori" "text" DEFAULT 'kebocoran_data'::"text", "p_tingkat" "text" DEFAULT 'sedang'::"text", "p_diketahui_pada" timestamp with time zone DEFAULT "now"(), "p_terjadi_mulai" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_terjadi_sampai" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_lingkup" "text" DEFAULT 'aktivitas'::"text", "p_kategori_data" "text"[] DEFAULT NULL::"text"[]) RETURNS "public"."security_incidents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  baris public.security_incidents%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Tidak diizinkan: bukan admin' using errcode = 'insufficient_privilege';
  end if;

  -- Jam nol di masa depan akan memberi tenggat yang lebih longgar daripada
  -- yang sebenarnya. Itu bukan kesalahan ketik yang boleh lolos diam-diam:
  -- seluruh gunanya kolom ini adalah menjadi angka yang tidak bisa digeser.
  if p_diketahui_pada > now() + interval '5 minutes' then
    raise exception 'Waktu "diketahui pada" tidak boleh di masa depan'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.security_incidents
    (ref, judul, ringkasan, kategori, tingkat, diketahui_pada,
     terjadi_mulai, terjadi_sampai, lingkup, kategori_data)
  values
    (public.insiden_ref_baru(), btrim(p_judul), btrim(p_ringkasan),
     p_kategori, p_tingkat, p_diketahui_pada,
     p_terjadi_mulai, p_terjadi_sampai, p_lingkup, p_kategori_data)
  returning * into baris;

  insert into public.admin_audit_log (admin_id, action, target_table, target_id, meta)
  values (auth.uid(), 'insiden_dibuat', 'security_incidents', baris.id::text,
          jsonb_build_object('ref', baris.ref, 'tingkat', baris.tingkat,
                             'batas_lapor', baris.batas_lapor));

  return baris;
end;
$$;


ALTER FUNCTION "public"."admin_insiden_buat"("p_judul" "text", "p_ringkasan" "text", "p_kategori" "text", "p_tingkat" "text", "p_diketahui_pada" timestamp with time zone, "p_terjadi_mulai" timestamp with time zone, "p_terjadi_sampai" timestamp with time zone, "p_lingkup" "text", "p_kategori_data" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_insiden_korban"("p_id" bigint) RETURNS TABLE("workspace_id" "uuid", "email" "text", "owner_name" "text", "business_name" "text", "phone" "text", "jejak_app" bigint, "jejak_audit" bigint, "jejak_ai" bigint, "aktivitas_awal" timestamp with time zone, "aktivitas_akhir" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."admin_insiden_korban"("p_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_insiden_ringkas"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'terbuka', (select count(*) from public.security_incidents
                 where status not in ('selesai','bukan_insiden')),
    'terlambat', (select count(*) from public.security_incidents
                   where now() > batas_lapor and lapor_otoritas_pada is null
                     and status not in ('selesai','bukan_insiden')),
    -- Insiden paling mepet yang belum dilaporkan. null = tidak ada yang
    -- sedang berjalan, dan itu memang keadaan yang diharapkan.
    'tenggat_terdekat', (select min(batas_lapor) from public.security_incidents
                          where lapor_otoritas_pada is null
                            and status not in ('selesai','bukan_insiden')),
    'akun_dihapus_30h', (select count(*) from public.deleted_accounts
                          where deleted_at > now() - interval '30 days')
  );
end;
$$;


ALTER FUNCTION "public"."admin_insiden_ringkas"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_insiden_ubah"("p_id" bigint, "p_status" "text" DEFAULT NULL::"text", "p_tingkat" "text" DEFAULT NULL::"text", "p_ringkasan" "text" DEFAULT NULL::"text", "p_tindakan" "text" DEFAULT NULL::"text", "p_terjadi_mulai" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_terjadi_sampai" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_lingkup" "text" DEFAULT NULL::"text", "p_kategori_data" "text"[] DEFAULT NULL::"text"[], "p_jumlah_korban" integer DEFAULT NULL::integer, "p_lapor_otoritas_pada" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_lapor_otoritas_ref" "text" DEFAULT NULL::"text", "p_lapor_korban_pada" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "public"."security_incidents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  lama  public.security_incidents%rowtype;
  baris public.security_incidents%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Tidak diizinkan: bukan admin' using errcode = 'insufficient_privilege';
  end if;

  select * into lama from public.security_incidents where id = p_id;
  if lama.id is null then
    raise exception 'Insiden % tidak ditemukan', p_id using errcode = 'no_data_found';
  end if;

  -- Menutup insiden sebagai "dilaporkan" tanpa mencatat KAPAN dilaporkan akan
  -- menghasilkan register yang tampak patuh tapi tidak bisa membuktikan
  -- apa pun. Justru tanggal itulah satu-satunya yang ditanyakan saat audit.
  if coalesce(p_status, lama.status) = 'dilaporkan'
     and coalesce(p_lapor_otoritas_pada, lama.lapor_otoritas_pada) is null then
    raise exception 'Status "dilaporkan" membutuhkan tanggal pelaporan ke otoritas'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.security_incidents set
    status              = coalesce(p_status, status),
    tingkat             = coalesce(p_tingkat, tingkat),
    ringkasan           = coalesce(nullif(btrim(p_ringkasan), ''), ringkasan),
    tindakan            = coalesce(p_tindakan, tindakan),
    terjadi_mulai       = coalesce(p_terjadi_mulai, terjadi_mulai),
    terjadi_sampai      = coalesce(p_terjadi_sampai, terjadi_sampai),
    lingkup             = coalesce(p_lingkup, lingkup),
    kategori_data       = coalesce(p_kategori_data, kategori_data),
    jumlah_korban       = coalesce(p_jumlah_korban, jumlah_korban),
    lapor_otoritas_pada = coalesce(p_lapor_otoritas_pada, lapor_otoritas_pada),
    lapor_otoritas_ref  = coalesce(nullif(btrim(p_lapor_otoritas_ref), ''), lapor_otoritas_ref),
    lapor_korban_pada   = coalesce(p_lapor_korban_pada, lapor_korban_pada),
    updated_at          = now()
  where id = p_id
  returning * into baris;

  insert into public.admin_audit_log (admin_id, action, target_table, target_id, meta)
  values (auth.uid(), 'insiden_diubah', 'security_incidents', p_id::text,
          jsonb_build_object(
            'ref', baris.ref,
            'status', jsonb_build_array(lama.status, baris.status),
            'tingkat', jsonb_build_array(lama.tingkat, baris.tingkat)));

  return baris;
end;
$$;


ALTER FUNCTION "public"."admin_insiden_ubah"("p_id" bigint, "p_status" "text", "p_tingkat" "text", "p_ringkasan" "text", "p_tindakan" "text", "p_terjadi_mulai" timestamp with time zone, "p_terjadi_sampai" timestamp with time zone, "p_lingkup" "text", "p_kategori_data" "text"[], "p_jumlah_korban" integer, "p_lapor_otoritas_pada" timestamp with time zone, "p_lapor_otoritas_ref" "text", "p_lapor_korban_pada" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_jejak_akun"("p_uid" "uuid", "p_sejak" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_limit" integer DEFAULT 500) RETURNS TABLE("waktu" timestamp with time zone, "sumber" "text", "aksi" "text", "detail" "jsonb")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  sejak timestamptz := coalesce(p_sejak, now() - interval '90 days');
begin
  if not public.is_admin() then
    raise exception 'Tidak diizinkan: bukan admin' using errcode = 'insufficient_privilege';
  end if;

  return query
  select * from (
    select e.created_at, 'aplikasi'::text, e.type, e.meta
      from public.app_events e
     where e.user_id = p_uid and e.created_at >= sejak
    union all
    select a.created_at, 'data'::text,
           a.table_name || ' · ' || a.action,
           jsonb_build_object('row_id', a.row_id, 'via', a.via, 'actor_id', a.actor_id)
      from public.audit_logs a
     where a.owner_id = p_uid and a.created_at >= sejak
    union all
    select l.created_at, 'ai'::text,
           l.feature || ' · ' || l.outcome,
           l.meta
      from public.ai_activity_log l
     where l.owner_id = p_uid and l.created_at >= sejak
    union all
    select q.created_at, 'admin'::text, q.action,
           jsonb_build_object('feature', q.feature, 'before', q.before_value,
                              'after', q.after_value, 'note', q.note)
      from public.admin_quota_actions q
     where q.workspace_id = p_uid and q.created_at >= sejak
  ) t(waktu, sumber, aksi, detail)
  order by t.waktu desc
  limit least(greatest(coalesce(p_limit, 500), 1), 2000);
end;
$$;


ALTER FUNCTION "public"."admin_jejak_akun"("p_uid" "uuid", "p_sejak" timestamp with time zone, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_ai_quota"() RETURNS TABLE("workspace_id" "uuid", "email" "text", "business_name" "text", "owner_name" "text", "plan_code" "text", "plan_label" "text", "suspended" boolean, "note" "text", "seat_used" integer, "seat_limit" integer, "credits_used" numeric, "credits_cap" numeric, "credit_override" numeric, "cycle_start" "date", "cycle_end" "date", "features" "jsonb", "updated_at" timestamp with time zone, "updated_by" "uuid", "tokens_day" bigint, "tokens_cycle" bigint, "token_cap_daily" bigint, "token_cap_monthly" bigint, "token_cap_daily_override" bigint, "token_cap_monthly_override" bigint, "tokens_cycle_30h" bigint, "usd_day" "jsonb", "usd_cycle" "jsonb", "usd_30h" "jsonb", "is_staff_elsewhere" boolean, "staff_at" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  d date := public.ai_today_pacific();
begin
  if not public.is_admin() then
    raise exception 'Tidak diizinkan: bukan admin' using errcode = 'insufficient_privilege';
  end if;

  return query
  with ws as (
    -- SUMBER = auth.users, bukan profiles. Pengguna terdaftar yang barisnya di
    -- profiles gagal dibuat tetap harus terlihat — hilang dari daftar adalah
    -- kegagalan yang menyamar jadi "tidak ada penggunanya".
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


ALTER FUNCTION "public"."admin_list_ai_quota"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_insiden"("p_limit" integer DEFAULT 200) RETURNS TABLE("id" bigint, "ref" "text", "judul" "text", "ringkasan" "text", "kategori" "text", "tingkat" "text", "status" "text", "lingkup" "text", "kategori_data" "text"[], "terjadi_mulai" timestamp with time zone, "terjadi_sampai" timestamp with time zone, "diketahui_pada" timestamp with time zone, "batas_lapor" timestamp with time zone, "sisa_menit" integer, "terlambat" boolean, "jumlah_korban" integer, "lapor_otoritas_pada" timestamp with time zone, "lapor_otoritas_ref" "text", "lapor_korban_pada" timestamp with time zone, "tindakan" "text", "dibuat_oleh_email" "text", "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."admin_list_insiden"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_model_prices"() RETURNS TABLE("model" "text", "input_usd_mtok" numeric, "output_usd_mtok" numeric, "effective_from" "date", "note" "text", "tokens_30h" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."admin_list_model_prices"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_quota_actions"("p_workspace" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 200) RETURNS TABLE("id" bigint, "admin_id" "uuid", "admin_email" "text", "workspace_id" "uuid", "business_name" "text", "action" "text", "feature" "text", "before_value" "jsonb", "after_value" "jsonb", "note" "text", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."admin_list_quota_actions"("p_workspace" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_users"() RETURNS TABLE("id" "uuid", "email" "text", "business_name" "text", "owner_name" "text", "business_type" "text", "phone" "text", "taxpayer_type" "text", "created_at" timestamp with time zone, "accepted_terms" boolean, "accepted_terms_at" timestamp with time zone, "terms_version" "text", "tx_count" bigint, "tx_volume" numeric, "last_activity" timestamp with time zone, "feedback_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    p.id, u.email, p.business_name, p.owner_name, p.business_type,
    p.phone, p.taxpayer_type, p.created_at,
    coalesce(p.accepted_terms, false) as accepted_terms,
    p.accepted_terms_at,
    p.terms_version,
    coalesce(t.cnt, 0)   as tx_count,
    coalesce(t.vol, 0)   as tx_volume,
    t.last_at            as last_activity,
    coalesce(f.cnt, 0)   as feedback_count
  from public.profiles p
  join auth.users u on u.id = p.id
  left join (
    select user_id, count(*) cnt, sum(amount) vol, max(occurred_at) last_at
    from public.transactions group by user_id
  ) t on t.user_id = p.id
  left join (
    select user_id, count(*) cnt from public.feedback group by user_id
  ) f on f.user_id = p.id
  where public.is_admin()           -- non-admin tidak mendapat baris apa pun
  order by p.created_at desc;
$$;


ALTER FUNCTION "public"."admin_list_users"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_metrics"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case when not public.is_admin() then '{}'::jsonb else jsonb_build_object(
    'total_users',        (select count(*) from public.profiles),
    'new_users_7d',       (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'new_users_30d',      (select count(*) from public.profiles where created_at > now() - interval '30 days'),
    'active_users_30d',   (select count(distinct user_id) from public.transactions where occurred_at > now() - interval '30 days'),
    'active_users_7d',    (select count(distinct user_id) from public.transactions where occurred_at > now() - interval '7 days'),
    'total_transactions', (select count(*) from public.transactions),
    'total_volume',       (select coalesce(sum(amount), 0) from public.transactions),
    'volume_30d',         (select coalesce(sum(amount), 0) from public.transactions where occurred_at > now() - interval '30 days'),
    'total_feedback',     (select count(*) from public.feedback),
    'feedback_open',      (select count(*) from public.feedback where status = 'baru'),
    'avg_rating',         (select round(avg(rating)::numeric, 2) from public.feedback where rating is not null),
    'rating_count',       (select count(*) from public.feedback where rating is not null),
    'helped_yes',         (select count(*) from public.feedback where helped = true),
    'helped_no',          (select count(*) from public.feedback where helped = false),
    'power_users',        (select count(*) from (
                             select user_id from public.transactions
                             group by user_id having count(*) >= 10) s)
  ) end;
$$;


ALTER FUNCTION "public"."admin_metrics"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_quota_overview"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."admin_quota_overview"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_ai_suspended"("p_workspace" "uuid", "p_suspended" boolean, "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."admin_set_ai_suspended"("p_workspace" "uuid", "p_suspended" boolean, "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_credit_override"("p_workspace" "uuid", "p_credits" numeric, "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."admin_set_credit_override"("p_workspace" "uuid", "p_credits" numeric, "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_daily_cap"("p_workspace" "uuid", "p_feature" "text", "p_cap" integer, "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."admin_set_daily_cap"("p_workspace" "uuid", "p_feature" "text", "p_cap" integer, "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_model_price"("p_model" "text", "p_input_usd" numeric, "p_output_usd" numeric, "p_berlaku" "date" DEFAULT NULL::"date", "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."admin_set_model_price"("p_model" "text", "p_input_usd" numeric, "p_output_usd" numeric, "p_berlaku" "date", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_plan"("p_workspace" "uuid", "p_plan_code" "text", "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."admin_set_plan"("p_workspace" "uuid", "p_plan_code" "text", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_token_cap"("p_workspace" "uuid", "p_periode" "text", "p_tokens" bigint, "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."admin_set_token_cap"("p_workspace" "uuid", "p_periode" "text", "p_tokens" bigint, "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_credit_rate"("p_feature" "text", "p_on" "date" DEFAULT NULL::"date") RETURNS numeric
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select r.credit_cost
    from public.ai_credit_rates r
   where r.feature = p_feature
     and r.effective_from <= coalesce(p_on, public.ai_today_pacific())
   order by r.effective_from desc
   limit 1;
$$;


ALTER FUNCTION "public"."ai_credit_rate"("p_feature" "text", "p_on" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_cycle_start"("p_anchor" integer DEFAULT 1) RETURNS "date"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."ai_cycle_start"("p_anchor" integer) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_model_prices" (
    "model" "text" NOT NULL,
    "input_usd_mtok" numeric(12,6) NOT NULL,
    "output_usd_mtok" numeric(12,6) NOT NULL,
    "effective_from" "date" NOT NULL,
    "note" "text",
    CONSTRAINT "ai_model_prices_input_usd_mtok_check" CHECK (("input_usd_mtok" >= (0)::numeric)),
    CONSTRAINT "ai_model_prices_output_usd_mtok_check" CHECK (("output_usd_mtok" >= (0)::numeric))
);


ALTER TABLE "public"."ai_model_prices" OWNER TO "postgres";


COMMENT ON TABLE "public"."ai_model_prices" IS 'Harga Google per 1 juta token, per model, berlaku sejak effective_from. Model tanpa baris di sini menghasilkan biaya NULL (tidak diketahui), bukan 0.';



CREATE OR REPLACE FUNCTION "public"."ai_model_price"("p_model" "text", "p_on" "date" DEFAULT NULL::"date") RETURNS "public"."ai_model_prices"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select *
    from public.ai_model_prices r
   where r.model = p_model
     and r.effective_from <= coalesce(p_on, public.ai_today_pacific())
   order by r.effective_from desc
   limit 1;
$$;


ALTER FUNCTION "public"."ai_model_price"("p_model" "text", "p_on" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_quota_check"("p_feature" "text", "p_limit" integer) RETURNS TABLE("allowed" boolean, "used" integer, "cap" integer, "reset_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  ws  uuid := public.ai_workspace_id();
  d   date := public.ai_today_pacific();
  cur int  := 0;
begin
  if ws is null then
    return query select false, 0, p_limit, now();
    return;
  end if;

  select case when p_feature = 'voice' then u.seconds_used else u.count end
    into cur
    from public.workspace_ai_usage u
   where u.workspace_id = ws and u.feature = p_feature and u.day = d;

  cur := coalesce(cur, 0);

  return query select
    cur < p_limit,
    cur,
    p_limit,
    (((d + 1)::text || ' 00:00:00')::timestamp at time zone 'America/Los_Angeles');
end;
$$;


ALTER FUNCTION "public"."ai_quota_check"("p_feature" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_quota_commit"("p_feature" "text", "p_units" integer DEFAULT 1, "p_prompt_tokens" integer DEFAULT 0, "p_completion_tokens" integer DEFAULT 0, "p_thinking_tokens" integer DEFAULT 0, "p_total_tokens" integer DEFAULT 0, "p_wasted_tokens" integer DEFAULT 0, "p_model" "text" DEFAULT NULL::"text", "p_workspace" "uuid" DEFAULT NULL::"uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  -- PECAHAN: empat sesi 30 detik tidak boleh ditagih 20 kredit untuk 2 menit.
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


ALTER FUNCTION "public"."ai_quota_commit"("p_feature" "text", "p_units" integer, "p_prompt_tokens" integer, "p_completion_tokens" integer, "p_thinking_tokens" integer, "p_total_tokens" integer, "p_wasted_tokens" integer, "p_model" "text", "p_workspace" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_quota_resolve"("p_feature" "text", "p_fallback_cap" integer, "p_workspace" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("allowed" boolean, "blocked_by" "text", "daily_used" integer, "daily_cap" integer, "daily_reset_at" timestamp with time zone, "credits_used" numeric, "credits_cap" numeric, "cycle_start" "date", "cycle_end" "date", "plan_code" "text", "tokens_day" bigint, "tokens_day_cap" bigint, "tokens_cycle" bigint, "tokens_cycle_cap" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."ai_quota_resolve"("p_feature" "text", "p_fallback_cap" integer, "p_workspace" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_scope_workspace"("p_workspace" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when p_workspace is null then public.ai_workspace_id()
    else public.resolve_owner(p_workspace)
  end;
$$;


ALTER FUNCTION "public"."ai_scope_workspace"("p_workspace" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ai_scope_workspace"("p_workspace" "uuid") IS 'Workspace yang ditagih untuk satu permintaan AI. p_workspace diverifikasi resolve_owner(); NULL = jalur kompatibilitas untuk Edge Function yang belum di-deploy ulang.';



CREATE OR REPLACE FUNCTION "public"."ai_seat_count"("p_owner" "uuid" DEFAULT NULL::"uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select 1 + (
    select count(*)::int
      from public.staff_members m
     where m.owner_id = coalesce(p_owner, auth.uid())
       and m.status <> 'revoked'
  );
$$;


ALTER FUNCTION "public"."ai_seat_count"("p_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_seat_limit"("p_owner" "uuid" DEFAULT NULL::"uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (select p.seat_limit
       from public.workspace_ai_policy w
       join public.ai_plans p on p.code = w.plan_code
      where w.workspace_id = coalesce(p_owner, auth.uid())),
    (select seat_limit from public.ai_plans where code = 'free'),
    2
  );
$$;


ALTER FUNCTION "public"."ai_seat_limit"("p_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_today_pacific"() RETURNS "date"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select (now() at time zone 'America/Los_Angeles')::date;
$$;


ALTER FUNCTION "public"."ai_today_pacific"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_usd_range"("p_workspace" "uuid", "p_from" "date", "p_to" "date") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  -- LATERAL, bukan (ai_model_price(...)).kolom dua kali: pemanggilan bergaya
  -- field-selection mengeksekusi fungsinya SEKALI PER KOLOM yang diambil.
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
    'usd', round(coalesce(sum(
        case when in_price is null then null
             else prompt_tokens * in_price / 1000000.0
                + out_tokens    * out_price / 1000000.0
        end), 0)::numeric, 6),
    'usd_retry', round(coalesce(sum(
        case when out_price is null then null
             else wasted_tokens * out_price / 1000000.0
        end), 0)::numeric, 6),
    -- Selama angka ini > 0, biaya di atas adalah batas BAWAH, dan UI wajib
    -- mengatakannya. Angka biaya yang diam-diam tidak lengkap lebih berbahaya
    -- daripada tidak ada angka: ia terlihat seperti jawaban.
    'tokens_tanpa_harga', coalesce(sum(
        case when in_price is null then total_tokens + wasted_tokens else 0 end), 0)::bigint,
    'tokens_berharga', coalesce(sum(
        case when in_price is null then 0 else total_tokens + wasted_tokens end), 0)::bigint
  )
  from baris;
$$;


ALTER FUNCTION "public"."ai_usd_range"("p_workspace" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_workspace_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (select m.owner_id
       from public.staff_members m
      where m.member_id = auth.uid()
        and m.status = 'active'
      limit 1),
    auth.uid()
  );
$$;


ALTER FUNCTION "public"."ai_workspace_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."balikkan_stok_transaksi"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  r record;
begin
  if new.status <> 'batal' or coalesce(old.status, 'aktif') = 'batal' then
    return new;
  end if;

  for r in
    select * from public.stock_movements
     where transaction_id = new.id and user_id = new.user_id and dibalik_pada is null
     for update
  loop
    update public.products
       set stock = greatest(0, coalesce(stock, 0) - r.stock_delta),
           opened_used = greatest(0, coalesce(opened_used, 0) - r.opened_used_delta),
           updated_at = now()
     where id = r.product_id and user_id = r.user_id;

    update public.stock_movements set dibalik_pada = now() where id = r.id;
  end loop;

  new.dibatalkan_pada := coalesce(new.dibatalkan_pada, now());
  new.dibatalkan_oleh := coalesce(new.dibatalkan_oleh, auth.uid());
  return new;
end $$;


ALTER FUNCTION "public"."balikkan_stok_transaksi"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."batalkan_transaksi"("p_id" "uuid", "p_alasan" "text" DEFAULT NULL::"text", "p_owner" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_owner uuid := public.resolve_owner(p_owner);
  v_txn   transactions;
  v_changes jsonb;
begin
  select * into v_txn from public.transactions
   where id = p_id and user_id = v_owner for update;
  if not found then
    raise exception 'Transaksi tidak ditemukan.' using errcode = 'no_data_found';
  end if;
  if v_txn.status = 'batal' then
    return jsonb_build_object(
      'id', v_txn.id, 'status', 'batal', 'berubah', false, 'changes', '[]'::jsonb);
  end if;

  update public.transactions
     set status = 'batal', alasan_batal = nullif(p_alasan, '')
   where id = p_id and user_id = v_owner;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', p.name,
           'unit', coalesce(p.content_unit, p.unit),
           'dipulihkan', -m.stock_delta,
           'before', p.stock + m.stock_delta,
           'after', p.stock)), '[]'::jsonb)
    into v_changes
    from public.stock_movements m
    join public.products p on p.id = m.product_id and p.user_id = m.user_id
   where m.transaction_id = p_id and m.user_id = v_owner and m.dibalik_pada is not null;

  return jsonb_build_object(
    'id', p_id, 'status', 'batal', 'berubah', true, 'changes', v_changes);
end $$;


ALTER FUNCTION "public"."batalkan_transaksi"("p_id" "uuid", "p_alasan" "text", "p_owner" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."batalkan_transaksi"("p_id" "uuid", "p_alasan" "text", "p_owner" "uuid") IS 'Membatalkan transaksi: status jadi batal, stok dibalik lewat trigger, nota tetap terekam. Idempoten.';



CREATE OR REPLACE FUNCTION "public"."bump_ai_usage"("p_kind" "text", "p_limit" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
  newcount int;
begin
  if uid is null then return false; end if;
  insert into public.ai_usage (user_id, day, kind, count)
  values (uid, today, p_kind, 1)
  on conflict (user_id, day, kind)
  do update set count = public.ai_usage.count + 1
  returning count into newcount;
  return newcount <= p_limit;
end;
$$;


ALTER FUNCTION "public"."bump_ai_usage"("p_kind" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."catat_error"("p_sidik" "text", "p_pesan" "text", "p_sumber" "text" DEFAULT 'frontend'::"text", "p_fitur" "text" DEFAULT 'tidak diketahui'::"text", "p_aksi" "text" DEFAULT NULL::"text", "p_kode" "text" DEFAULT NULL::"text", "p_tingkat" "text" DEFAULT 'error'::"text", "p_halaman" "text" DEFAULT NULL::"text", "p_jejak" "text" DEFAULT NULL::"text", "p_konteks" "jsonb" DEFAULT '{}'::"jsonb", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_id    bigint;
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if coalesce(trim(p_sidik), '') = '' or coalesce(trim(p_pesan), '') = '' then
    return null;
  end if;

  if v_uid is not null then
    select email into v_email from auth.users where id = v_uid;
  end if;

  insert into public.error_logs (
    sidik, pesan, sumber, fitur, aksi, kode, tingkat, halaman, jejak, konteks,
    user_id, email, user_agent
  ) values (
    left(trim(p_sidik), 120),
    left(p_pesan, 2000),
    left(coalesce(p_sumber, 'frontend'), 20),
    left(coalesce(p_fitur, 'tidak diketahui'), 80),
    left(p_aksi, 160),
    left(p_kode, 60),
    case when p_tingkat in ('error', 'fatal', 'warn') then p_tingkat else 'error' end,
    left(p_halaman, 200),
    left(p_jejak, 4000),
    coalesce(p_konteks, '{}'::jsonb),
    v_uid,
    v_email,
    left(p_user_agent, 300)
  )
  on conflict (sidik) do update set
    jumlah        = public.error_logs.jumlah + 1,
    terakhir_pada = now(),
    -- Pesan & konteks diperbarui ke kejadian TERBARU: saat menelusuri, yang
    -- dibutuhkan adalah keadaan terakhir, bukan yang pertama kali berbulan lalu.
    pesan         = left(excluded.pesan, 2000),
    konteks       = excluded.konteks,
    jejak         = coalesce(left(excluded.jejak, 4000), public.error_logs.jejak),
    halaman       = coalesce(excluded.halaman, public.error_logs.halaman),
    user_id       = coalesce(excluded.user_id, public.error_logs.user_id),
    email         = coalesce(excluded.email, public.error_logs.email),
    -- Muncul lagi setelah dianggap selesai = perbaikannya tidak bekerja.
    status        = case when public.error_logs.status = 'ditangani'
                         then 'baru' else public.error_logs.status end
  returning id into v_id;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."catat_error"("p_sidik" "text", "p_pesan" "text", "p_sumber" "text", "p_fitur" "text", "p_aksi" "text", "p_kode" "text", "p_tingkat" "text", "p_halaman" "text", "p_jejak" "text", "p_konteks" "jsonb", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_email_available"("p_email" "text") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select not exists (select 1 from auth.users where lower(email) = lower(p_email));
$$;


ALTER FUNCTION "public"."check_email_available"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_phone_available"("p_phone" "text") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select not exists (select 1 from public.profiles where phone = p_phone);
$$;


ALTER FUNCTION "public"."check_phone_available"("p_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consume_bom_for_sale"("p_product_id" "uuid", "p_qty" numeric, "p_owner" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_has_bom boolean;
  v_row     record;
  v_one     jsonb;
  v_out     jsonb := '[]'::jsonb;
begin
  if p_qty is null or p_qty <= 0 then return v_out; end if;

  select has_bom into v_has_bom
    from products where id = p_product_id and user_id = p_owner;
  if not coalesce(v_has_bom, false) then return v_out; end if;

  for v_row in
    select b.qty_per_unit, i.source_product_id
      from product_boms b
      join ingredients i on i.id = b.ingredient_id
     where b.product_id = p_product_id
       and b.user_id = p_owner
       and b.deduct_stock is true
       and i.source_product_id is not null
       and coalesce(b.qty_per_unit, 0) > 0
  loop
    v_one := public.consume_pack_stock(v_row.source_product_id, v_row.qty_per_unit * p_qty, p_owner);
    if v_one is not null then v_out := v_out || v_one; end if;
  end loop;

  return v_out;
end $$;


ALTER FUNCTION "public"."consume_bom_for_sale"("p_product_id" "uuid", "p_qty" numeric, "p_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consume_pack_stock"("p_product_id" "uuid", "p_need" numeric, "p_owner" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_p       record;
  v_size    numeric;
  v_total   numeric;
  v_down    numeric;
  v_after   numeric;
  v_used    numeric;
begin
  if p_need is null or p_need <= 0 then return null; end if;

  select id, name, unit, stock, pack_size, opened_used, content_unit
    into v_p
    from products
   where id = p_product_id and user_id = p_owner
   for update;
  if not found then return null; end if;

  v_size := coalesce(v_p.pack_size, 0);

  if v_size > 0 then
    v_total := coalesce(v_p.opened_used, 0) + p_need;
    v_down  := floor(v_total / v_size);
    v_used  := v_total - (v_down * v_size);
    v_after := greatest(0, coalesce(v_p.stock, 0) - v_down);
    update products
       set stock = v_after, opened_used = v_used, updated_at = now()
     where id = v_p.id and user_id = p_owner;
  else
    v_used  := coalesce(v_p.opened_used, 0);
    v_after := greatest(0, coalesce(v_p.stock, 0) - p_need);
    update products
       set stock = v_after, updated_at = now()
     where id = v_p.id and user_id = p_owner;
  end if;

  return jsonb_build_object(
    'product_id', v_p.id,
    'name',       v_p.name,
    'unit',       v_p.unit,
    'before',     coalesce(v_p.stock, 0),
    'after',      v_after,
    'used',       p_need,
    'used_unit',  coalesce(v_p.content_unit, v_p.unit),
    'opened_used', v_used,
    'opened_before', coalesce(v_p.opened_used, 0)
  );
end $$;


ALTER FUNCTION "public"."consume_pack_stock"("p_product_id" "uuid", "p_need" numeric, "p_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decline_invitation"("p_invite_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_n int;
begin
  if auth.uid() is null or v_email = '' then
    raise exception 'Harus masuk (login)' using errcode = 'insufficient_privilege';
  end if;
  update public.staff_members m
     set declined_at = now()
   where m.id = p_invite_id
     and lower(m.email) = v_email
     and m.member_id is null
     and m.status = 'invited';
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;


ALTER FUNCTION "public"."decline_invitation"("p_invite_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."effective_owner"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select auth.uid();
$$;


ALTER FUNCTION "public"."effective_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."email_terdaftar"("p_email" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  select exists (
    select 1 from auth.users
    where lower(email) = lower(trim(coalesce(p_email, '')))
      and coalesce(trim(p_email), '') <> ''
  );
$$;


ALTER FUNCTION "public"."email_terdaftar"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_free_seat_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  active_seats int;
  max_seats    int := 2;   -- Free Plan: owner + 1 staf
begin
  select 1 + count(*)::int into active_seats
    from public.staff_members m
   where m.owner_id = new.owner_id
     and m.status <> 'revoked';

  if active_seats > max_seats then
    raise exception 'FREE_PLAN_SEAT_LIMIT: Paket Free maksimal % anggota (pemilik + 1 staf). Tingkatkan paket untuk menambah anggota.', max_seats
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_free_seat_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_seat_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."enforce_seat_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."feedback_set_author"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_name text;
begin
  select coalesce(nullif(trim(business_name), ''), nullif(trim(owner_name), ''))
    into v_name
  from public.profiles
  where id = auth.uid();

  new.author_name := coalesce(v_name, 'Pengguna');
  return new;
end;
$$;


ALTER FUNCTION "public"."feedback_set_author"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_accepted boolean := coalesce((new.raw_user_meta_data->>'accepted_terms')::boolean, false);
  v_at       timestamptz := coalesce((new.raw_user_meta_data->>'accepted_terms_at')::timestamptz, now());
begin
  insert into public.profiles (
    id, business_name, owner_name, phone,
    accepted_terms, accepted_terms_at,
    accepted_privacy, accepted_privacy_at,
    terms_version
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'business_name', 'Usaha Saya'),
    coalesce(new.raw_user_meta_data->>'owner_name', ''),
    nullif(new.raw_user_meta_data->>'phone', ''),
    v_accepted, case when v_accepted then v_at end,
    v_accepted, case when v_accepted then v_at end,
    new.raw_user_meta_data->>'terms_version'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."hapus_data_saya"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_uid uuid := auth.uid();
  v_hasil jsonb := '{}'::jsonb;
  v_tabel text;
  v_n bigint;
begin
  if v_uid is null then
    raise exception 'Harus masuk (login).' using errcode = 'insufficient_privilege';
  end if;

  perform set_config('app.hapus_data_saya', '1', true);

  foreach v_tabel in array array[
    'transactions', 'categorization_rules', 'products', 'suppliers',
    'units', 'product_categories', 'channels', 'categories', 'feedback', 'app_events'
  ] loop
    if to_regclass('public.' || v_tabel) is null then
      v_hasil := v_hasil || jsonb_build_object(v_tabel, 'tabel tidak ada');
      continue;
    end if;
    execute format('delete from public.%I where user_id = $1', v_tabel) using v_uid;
    get diagnostics v_n = row_count;
    v_hasil := v_hasil || jsonb_build_object(v_tabel, v_n);
  end loop;

  return v_hasil;
end
$_$;


ALTER FUNCTION "public"."hapus_data_saya"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."hapus_data_saya"() IS 'Hak penghapusan data subjek (UU PDP). Menghapus seluruh data milik pemanggil dalam SATU transaksi. Satu-satunya jalur yang boleh menghapus baris transactions selain penghapusan akun.';



CREATE OR REPLACE FUNCTION "public"."has_access"("owner" "uuid", "module" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select owner = auth.uid() or exists (
    select 1 from public.staff_members m
    where m.owner_id = owner and m.member_id = auth.uid()
      and m.status = 'active' and module = any(m.modules)
  );
$$;


ALTER FUNCTION "public"."has_access"("owner" "uuid", "module" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."hitung_baris_milik"("p_table" "text", "p_kolom" "text", "p_uid" "uuid") RETURNS bigint
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  n bigint := 0;
begin
  if to_regclass('public.' || p_table) is null then
    return 0;
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = p_table and column_name = p_kolom
  ) then
    return 0;
  end if;

  execute format('select count(*) from public.%I where %I = $1', p_table, p_kolom)
    into n using p_uid;
  return coalesce(n, 0);
exception when others then
  return 0;
end;
$_$;


ALTER FUNCTION "public"."hitung_baris_milik"("p_table" "text", "p_kolom" "text", "p_uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insiden_hitung_batas"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.batas_lapor := new.diketahui_pada + interval '72 hours';
  return new;
end;
$$;


ALTER FUNCTION "public"."insiden_hitung_batas"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insiden_ref_baru"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select 'INS-' || to_char(now(), 'YYYY') || '-' ||
         lpad((
           coalesce(max(substring(ref from 'INS-\d{4}-(\d+)')::int), 0) + 1
         )::text, 4, '0')
    from public.security_incidents
   where ref like 'INS-' || to_char(now(), 'YYYY') || '-%';
$$;


ALTER FUNCTION "public"."insiden_ref_baru"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_audit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  o uuid; rid text; ch jsonb := '{}'::jsonb; k text; nj jsonb; oj jsonb;
  -- Baris UTUH, terpisah dari `ch`. Pada UPDATE, `ch` hanya berisi field yang
  -- berubah, sedangkan employee_id perlu dibaca dari baris lengkapnya.
  baris jsonb;
  emp uuid;
  v_via text := 'manual';
begin
  if tg_op = 'DELETE' then
    o := old.user_id; rid := old.id::text; baris := to_jsonb(old); ch := baris;
  elsif tg_op = 'INSERT' then
    o := new.user_id; rid := new.id::text; baris := to_jsonb(new); ch := baris;
  else
    o := new.user_id; rid := new.id::text;
    nj := to_jsonb(new); oj := to_jsonb(old); baris := nj;
    for k in select jsonb_object_keys(nj) loop
      if k not in ('updated_at','created_at') and (nj->k) is distinct from (oj->k) then
        ch := ch || jsonb_build_object(k, jsonb_build_array(oj->k, nj->k));
      end if;
    end loop;
  end if;

  -- Subjek karyawan. `assignee_id` ikut supaya kartu tugas yang ditugaskan ke
  -- seorang karyawan juga muncul di riwayatnya.
  begin
    emp := nullif(coalesce(baris->>'employee_id', baris->>'assignee_id'), '')::uuid;
  exception when others then
    emp := null;
  end;
  -- Baris tabel employees itu sendiri: subjeknya adalah karyawan itu.
  if emp is null and tg_table_name = 'employees' then
    begin
      emp := rid::uuid;
    exception when others then
      emp := null;
    end;
  end if;

  -- Asal aksi, dibaca dari header permintaan PostgREST.
  --
  -- Dibungkus blok exception sendiri: di luar PostgREST (mis. dipanggil dari
  -- job cron atau psql) setelan itu tidak ada, dan trigger audit TIDAK BOLEH
  -- menggagalkan penulisan data hanya karena penandanya tak terbaca. Gagal
  -- tertutup ke 'manual'.
  begin
    if coalesce(current_setting('request.headers', true)::json ->> 'x-smartbook-via', '') = 'ai' then
      v_via := 'ai';
    end if;
  exception when others then
    v_via := 'manual';
  end;

  insert into public.audit_logs
    (owner_id, actor_id, table_name, action, row_id, changed, via, employee_id)
  values (o, auth.uid(), tg_table_name, tg_op, rid, ch, v_via, emp);
  return coalesce(new, old);
end $$;


ALTER FUNCTION "public"."log_audit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_ai_credits"("p_workspace" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."my_ai_credits"("p_workspace" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_modules"("p_owner" "uuid" DEFAULT NULL::"uuid") RETURNS "text"[]
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid := public.resolve_owner(p_owner);
  v_mods  text[];
begin
  if v_owner = v_uid then
    return array['dashboard','operasional','transaksi','produk','hr','analisis'];
  end if;

  select m.modules into v_mods
    from public.staff_members m
   where m.owner_id = v_owner and m.member_id = v_uid and m.status = 'active'
   limit 1;

  return coalesce(v_mods, array[]::text[]);
end $$;


ALTER FUNCTION "public"."my_modules"("p_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_monthly_summary"("p_owner" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("month" "text", "income" numeric, "expense" numeric, "cnt" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select to_char(occurred_at, 'YYYY-MM') as month,
         coalesce(sum(amount) filter (where direction = 'in'), 0)  as income,
         coalesce(sum(amount) filter (where direction = 'out'), 0) as expense,
         count(*) as cnt
  from public.transactions
  where user_id = public.resolve_owner(p_owner)
  group by 1
  order by 1;
$$;


ALTER FUNCTION "public"."my_monthly_summary"("p_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_pending_invitations"() RETURNS TABLE("id" "uuid", "owner_id" "uuid", "business_name" "text", "owner_email" "text", "modules" "text"[], "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  select m.id, m.owner_id,
         coalesce(nullif(trim(p.business_name), ''), 'Usaha tanpa nama') as business_name,
         u.email::text as owner_email,
         m.modules, m.created_at
  from public.staff_members m
  left join public.profiles p on p.id = m.owner_id
  left join auth.users u on u.id = m.owner_id
  where m.member_id is null
    and m.status = 'invited'
    and m.declined_at is null
    and auth.uid() is not null
    and lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  order by m.created_at desc;
$$;


ALTER FUNCTION "public"."my_pending_invitations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_workspaces"() RETURNS TABLE("id" "uuid", "owner_id" "uuid", "business_name" "text", "owner_email" "text", "modules" "text"[], "role" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  select m.id, m.owner_id,
         coalesce(nullif(trim(p.business_name), ''), 'Usaha tanpa nama') as business_name,
         u.email::text as owner_email,
         m.modules, m.role
  from public.staff_members m
  left join public.profiles p on p.id = m.owner_id
  left join auth.users u on u.id = m.owner_id
  where m.member_id = auth.uid()
    and m.status = 'active'
  order by 3 nulls last;
$$;


ALTER FUNCTION "public"."my_workspaces"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."norm_phone_id"("p" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  with d as (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as digits)
  select case
    when digits = ''             then null
    when left(digits, 2) = '62'  then digits
    when left(digits, 1) = '0'   then '62' || substr(digits, 2)
    when left(digits, 1) = '8'   then '62' || digits
    else digits
  end
  from d
$$;


ALTER FUNCTION "public"."norm_phone_id"("p" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ops_catat_heartbeat"("p_sumber" "text", "p_sehat" boolean, "p_kesehatan" "jsonb", "p_catatan" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'ops', 'public'
    AS $$
declare
  v_id      bigint;
  v_beat_at timestamptz;
begin
  insert into ops.service_heartbeat (sumber, sehat, kesehatan, catatan)
  values (
    coalesce(nullif(trim(p_sumber), ''), 'tidak-diketahui'),
    coalesce(p_sehat, false),
    coalesce(p_kesehatan, '{}'::jsonb),
    left(coalesce(p_catatan, ''), 1000)
  )
  returning id, beat_at into v_id, v_beat_at;

  return jsonb_build_object('id', v_id, 'beat_at', v_beat_at);
end;
$$;


ALTER FUNCTION "public"."ops_catat_heartbeat"("p_sumber" "text", "p_sehat" boolean, "p_kesehatan" "jsonb", "p_catatan" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ops_ringkasan_kesehatan"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'ops', 'public'
    AS $$
  select ops.ringkasan_kesehatan();
$$;


ALTER FUNCTION "public"."ops_ringkasan_kesehatan"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ops_token"("p_kunci" "text") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'ops', 'public'
    AS $$
  select nilai from ops.service_config where kunci = p_kunci;
$$;


ALTER FUNCTION "public"."ops_token"("p_kunci" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."otp_attempt_fail"("p_bucket" "text", "p_subject" "text", "p_limit" integer DEFAULT 5, "p_window_seconds" integer DEFAULT 900) RETURNS TABLE("locked" boolean, "hits" integer, "remaining" integer, "retry_after" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_start timestamptz;
  v_hits  int;
begin
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.auth_rate_limits (bucket, subject, window_start, hits)
  values (p_bucket, md5(lower(p_subject)), v_start, 1)
  on conflict (bucket, subject, window_start)
    do update set hits = public.auth_rate_limits.hits + 1
  returning public.auth_rate_limits.hits into v_hits;

  locked      := v_hits >= p_limit;
  hits        := v_hits;
  remaining   := greatest(0, p_limit - v_hits);
  retry_after := greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds)) - now()))::int);
  return next;
end $$;


ALTER FUNCTION "public"."otp_attempt_fail"("p_bucket" "text", "p_subject" "text", "p_limit" integer, "p_window_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."otp_attempt_reset"("p_bucket" "text", "p_subject" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  delete from public.auth_rate_limits
  where bucket = p_bucket and subject = md5(lower(p_subject));
$$;


ALTER FUNCTION "public"."otp_attempt_reset"("p_bucket" "text", "p_subject" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."otp_attempt_status"("p_bucket" "text", "p_subject" "text", "p_limit" integer DEFAULT 5, "p_window_seconds" integer DEFAULT 900) RETURNS TABLE("locked" boolean, "hits" integer, "remaining" integer, "retry_after" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_start timestamptz;
  v_hits  int;
begin
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  select coalesce(a.hits, 0) into v_hits
  from public.auth_rate_limits a
  where a.bucket = p_bucket
    and a.subject = md5(lower(p_subject))
    and a.window_start = v_start;

  v_hits := coalesce(v_hits, 0);
  locked      := v_hits >= p_limit;
  hits        := v_hits;
  remaining   := greatest(0, p_limit - v_hits);
  retry_after := greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds)) - now()))::int);
  return next;
end $$;


ALTER FUNCTION "public"."otp_attempt_status"("p_bucket" "text", "p_subject" "text", "p_limit" integer, "p_window_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pangkas_error_logs"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_hapus integer;
begin
  delete from public.error_logs
  where status in ('ditangani', 'diabaikan')
    and terakhir_pada < now() - interval '90 days';
  get diagnostics v_hapus = row_count;
  return v_hapus;
end;
$$;


ALTER FUNCTION "public"."pangkas_error_logs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."post_stock_opname"("p_opname_id" "uuid", "p_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.post_stock_opname(p_opname_id, p_items, null::uuid);
$$;


ALTER FUNCTION "public"."post_stock_opname"("p_opname_id" "uuid", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."post_stock_opname"("p_opname_id" "uuid", "p_items" "jsonb", "p_owner" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_owner uuid := public.resolve_owner(p_owner);
  v_so stock_opnames;
  v_it jsonb;
  v_counted numeric;
  v_sys numeric;
  v_changes jsonb := '[]'::jsonb;
  v_so2 stock_opnames;
  v_hit int;
begin
  select * into v_so from stock_opnames
   where id = p_opname_id and user_id = v_owner for update;
  if not found then
    raise exception 'Sesi opname tidak ditemukan.';
  end if;
  if v_so.status <> 'draft' then
    raise exception 'Sesi opname ini bukan draf aktif.';
  end if;

  for v_it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if nullif(v_it->>'counted_qty','') is null then continue; end if;
    v_counted := (v_it->>'counted_qty')::numeric;
    v_sys := coalesce(nullif(v_it->>'system_qty','')::numeric, 0);
    if v_counted = v_sys then continue; end if;
    -- `and user_id = v_owner` adalah inti perbaikannya: versi lama menimpa stok
    -- hanya berdasarkan id produk, sehingga produk usaha lain ikut tertimpa.
    update products set stock = v_counted, updated_at = now()
      where id = (v_it->>'product_id')::uuid and user_id = v_owner;
    get diagnostics v_hit = row_count;
    if v_hit > 0 then
      v_changes := v_changes || jsonb_build_object(
        'name', v_it->>'name', 'unit', v_it->>'unit',
        'before', v_sys, 'after', v_counted);
    end if;
  end loop;

  update stock_opnames
    set status = 'posted', posted_at = now(), items = coalesce(p_items, items)
    where id = v_so.id and user_id = v_owner
    returning * into v_so2;

  return jsonb_build_object('opname', to_jsonb(v_so2), 'changes', v_changes);
end $$;


ALTER FUNCTION "public"."post_stock_opname"("p_opname_id" "uuid", "p_items" "jsonb", "p_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."product_yield"("p_product_id" "uuid", "p_owner" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_owner uuid := public.resolve_owner(p_owner);
  v_row   record;
  v_avail numeric;
  v_can   numeric;
  v_min   numeric := null;
  v_parts jsonb := '[]'::jsonb;
begin
  for v_row in
    select b.qty_per_unit, i.name as ingredient_name,
           p.id as pid, p.name as product_name, p.unit, p.stock, p.pack_size,
           p.opened_used, p.content_unit
      from product_boms b
      join ingredients i on i.id = b.ingredient_id
      join products p    on p.id = i.source_product_id
     where b.product_id = p_product_id
       and b.user_id = v_owner
       and b.deduct_stock is true
       and coalesce(b.qty_per_unit, 0) > 0
  loop
    if coalesce(v_row.pack_size, 0) > 0 then
      v_avail := (coalesce(v_row.stock, 0) * v_row.pack_size) - coalesce(v_row.opened_used, 0);
    else
      v_avail := coalesce(v_row.stock, 0);
    end if;
    v_avail := greatest(0, v_avail);
    v_can := floor(v_avail / v_row.qty_per_unit);
    if v_min is null or v_can < v_min then v_min := v_can; end if;

    v_parts := v_parts || jsonb_build_object(
      'ingredient', v_row.ingredient_name,
      'product',    v_row.product_name,
      'available',  v_avail,
      'unit',       coalesce(v_row.content_unit, v_row.unit),
      'per_unit',   v_row.qty_per_unit,
      'can_make',   v_can
    );
  end loop;

  return jsonb_build_object('yield', v_min, 'parts', v_parts);
end $$;


ALTER FUNCTION "public"."product_yield"("p_product_id" "uuid", "p_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prune_auth_rate_limits"("p_older_than_hours" integer DEFAULT 24) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_n int;
begin
  delete from public.auth_rate_limits
   where window_start < now() - make_interval(hours => p_older_than_hours);
  get diagnostics v_n = row_count;
  return v_n;
end $$;


ALTER FUNCTION "public"."prune_auth_rate_limits"("p_older_than_hours" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rate_limit_hit"("p_bucket" "text", "p_subject" "text", "p_limit" integer, "p_window_seconds" integer) RETURNS TABLE("allowed" boolean, "remaining" integer, "retry_after" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_start timestamptz;
  v_hits  int;
begin
  -- Jendela tetap (fixed window): dibulatkan ke bawah kelipatan durasi jendela.
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.auth_rate_limits (bucket, subject, window_start, hits)
  values (p_bucket, p_subject, v_start, 1)
  on conflict (bucket, subject, window_start)
    do update set hits = public.auth_rate_limits.hits + 1
  returning hits into v_hits;

  allowed     := v_hits <= p_limit;
  remaining   := greatest(0, p_limit - v_hits);
  retry_after := greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds)) - now()))::int);
  return next;
end $$;


ALTER FUNCTION "public"."rate_limit_hit"("p_bucket" "text", "p_subject" "text", "p_limit" integer, "p_window_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."receive_purchase_order"("p_po_id" "uuid", "p_create_expense" boolean DEFAULT true, "p_category" "text" DEFAULT ''::"text", "p_payment_status" "text" DEFAULT 'lunas'::"text", "p_due_date" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.receive_purchase_order(
    p_po_id, p_create_expense, p_category, p_payment_status, p_due_date, null::uuid);
$$;


ALTER FUNCTION "public"."receive_purchase_order"("p_po_id" "uuid", "p_create_expense" boolean, "p_category" "text", "p_payment_status" "text", "p_due_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."receive_purchase_order"("p_po_id" "uuid", "p_create_expense" boolean DEFAULT true, "p_category" "text" DEFAULT ''::"text", "p_payment_status" "text" DEFAULT 'lunas'::"text", "p_due_date" "date" DEFAULT NULL::"date", "p_owner" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_owner uuid := public.resolve_owner(p_owner);
  v_po purchase_orders;
  v_p record;
  v_before numeric;
  v_after numeric;
  v_total numeric;
  v_txn transactions;
  v_po2 purchase_orders;
begin
  select * into v_po from purchase_orders
   where id = p_po_id and user_id = v_owner for update;
  if not found then
    raise exception 'PO tidak ditemukan.';
  end if;
  if v_po.status in ('received','cancelled') then
    raise exception 'PO ini sudah diterima atau dibatalkan.';
  end if;

  select id, stock, name, unit into v_p
    from products where id = v_po.product_id and user_id = v_owner for update;
  if not found then
    raise exception 'Produk PO ini tidak ditemukan.';
  end if;

  v_before := coalesce(v_p.stock, 0);
  v_after := v_before + coalesce(v_po.qty, 0);
  update products set stock = v_after, updated_at = now()
    where id = v_p.id and user_id = v_owner;

  v_total := round(coalesce(v_po.qty, 0) * coalesce(v_po.unit_price, 0));
  if p_create_expense and v_total > 0 and coalesce(p_category, '') <> '' then
    insert into transactions
      (user_id, description, amount, direction, category, channel, occurred_at,
       payment_status, due_date, product_id, qty)
    values
      (v_owner,
       'Pembelian: ' || v_po.qty || ' ' || coalesce(v_p.unit,'') || ' ' || v_p.name || ' (' || v_po.po_number || ')',
       v_total, 'out', p_category, 'manual', now(),
       coalesce(nullif(p_payment_status,''), 'lunas'),
       case when p_payment_status = 'belum' then p_due_date else null end,
       v_po.product_id, v_po.qty)
    returning * into v_txn;
  end if;

  update purchase_orders
    set status = 'received', received_at = now(), txn_id = v_txn.id
    where id = v_po.id and user_id = v_owner
    returning * into v_po2;

  return jsonb_build_object(
    'po', to_jsonb(v_po2),
    'stock', jsonb_build_object('name', v_p.name, 'unit', v_p.unit, 'before', v_before, 'after', v_after),
    'txn', to_jsonb(v_txn));
end $$;


ALTER FUNCTION "public"."receive_purchase_order"("p_po_id" "uuid", "p_create_expense" boolean, "p_category" "text", "p_payment_status" "text", "p_due_date" "date", "p_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_owner"("p_owner" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Harus masuk (login).' using errcode = 'insufficient_privilege';
  end if;
  if p_owner is null or p_owner = v_uid then
    return v_uid;
  end if;
  if exists (
    select 1 from public.staff_members m
     where m.owner_id = p_owner and m.member_id = v_uid and m.status = 'active'
  ) then
    return p_owner;
  end if;
  raise exception 'Anda tidak punya akses aktif ke usaha tersebut.'
    using errcode = 'insufficient_privilege';
end $$;


ALTER FUNCTION "public"."resolve_owner"("p_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_lint"() RETURNS TABLE("invarian" "text", "objek" "text", "detail" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  r record;
begin
  -- R1: tabel yang punya kolom user_id TIDAK BOLEH punya policy SELECT/ALL
  --     yang permisif (USING true atau tanpa USING).
  --
  -- Kolom user_id adalah pernyataan "baris ini milik seseorang". Begitu ada,
  -- membaca lintas pemilik harus lewat predikat eksplisit (auth.uid() = user_id,
  -- is_admin(), has_access(...)) — bukan `true`. Tabel referensi bersama yang
  -- memang boleh dibaca siapa saja (macro_signals, commodity_prices,
  -- exchange_rates, legal_docs, ...) tidak punya user_id, jadi otomatis
  -- terkecuali tanpa perlu daftar putih yang harus dirawat.
  for r in
    select p.tablename, p.policyname, p.cmd
    from pg_policies p
    where p.schemaname = 'public'
      and p.cmd in ('SELECT', 'ALL')
      and (p.qual is null or btrim(p.qual::text) in ('true', '(true)'))
      and exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = p.tablename
          and c.column_name = 'user_id'
      )
  loop
    invarian := 'R1_policy_baca_permisif';
    objek := r.tablename || '.' || r.policyname;
    detail := 'policy ' || r.cmd || ' memakai USING (true) pada tabel ber-user_id — '
              || 'setiap pengguna login bisa membaca baris milik orang lain';
    return next;
  end loop;

  -- R2: tabel yang punya kolom user_id WAJIB mengaktifkan RLS.
  -- Tanpa RLS, policy sebagus apa pun tidak pernah dievaluasi.
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
      )
  loop
    invarian := 'R2_rls_mati';
    objek := r.relname;
    detail := 'tabel punya kolom user_id tetapi RLS tidak aktif — policy tidak dievaluasi sama sekali';
    return next;
  end loop;

  -- R3: tabel ber-user_id wajib punya MINIMAL satu policy.
  -- RLS aktif tanpa policy = tidak ada yang bisa membaca (gagal tertutup, aman),
  -- tapi hampir selalu berarti seseorang lupa memasangnya.
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
      )
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname
      )
  loop
    invarian := 'R3_tanpa_policy';
    objek := r.relname;
    detail := 'RLS aktif tetapi tidak ada policy sama sekali';
    return next;
  end loop;

  return;
end $$;


ALTER FUNCTION "public"."rls_lint"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."staff_members_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare owner_email text;
begin
  new.email := lower(trim(new.email));
  select u.email into owner_email from auth.users u where u.id = new.owner_id;
  if owner_email is not null and new.email = lower(owner_email) then
    raise exception 'Tidak bisa mengundang email Anda sendiri sebagai staf'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."staff_members_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."staff_members_name_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'UPDATE' and new.name is distinct from old.name
     and old.owner_id <> auth.uid() then
    raise exception 'Hanya pemilik usaha yang boleh mengubah nama pengguna.';
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."staff_members_name_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stock_opnames_items_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_bad int;
begin
  if new.items is null or jsonb_typeof(new.items) <> 'array' then
    return new;
  end if;
  select count(*) into v_bad
  from jsonb_array_elements(new.items) e
  where nullif(e->>'product_id','') is not null
    and not exists (
      select 1 from public.products p
       where p.id = (e->>'product_id')::uuid and p.user_id = new.user_id
    );
  if v_bad > 0 then
    raise exception 'Sesi opname memuat % produk yang bukan milik usaha ini.', v_bad
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."stock_opnames_items_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tenancy_lint"() RETURNS TABLE("invarian" "text", "objek" "text", "detail" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_shared text[] := array[
    'admins','app_events','feedback','ai_usage','legal_docs','profiles',
    'staff_members','audit_logs','admin_audit_log',
    'macro_signals','macro_runs','macro_config','commodity_prices','exchange_rates',
    'error_logs'
  ];
  r record;
  v_n bigint;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and not (c.relname = any(v_shared))
      and not a.attnotnull
  loop
    invarian := 'T1_user_id_nullable'; objek := r.relname;
    detail := 'kolom user_id harus NOT NULL di tabel tenant';
    return next;
  end loop;

  for r in
    select con.conname,
           con.conrelid::regclass::text as anak,
           con.confrelid::regclass::text as induk,
           (select array_agg(att.attname order by k.ord)
              from unnest(con.conkey) with ordinality k(attnum, ord)
              join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
           ) as kolom_anak
    from pg_constraint con
    join pg_class ch on ch.oid = con.conrelid
    join pg_class pa on pa.oid = con.confrelid
    join pg_namespace nch on nch.oid = ch.relnamespace
    join pg_namespace npa on npa.oid = pa.relnamespace
    where con.contype = 'f'
      and nch.nspname = 'public' and npa.nspname = 'public'
      and not (ch.relname = any(v_shared))
      and not (pa.relname = any(v_shared))
      and exists (select 1 from pg_attribute a
                   where a.attrelid = ch.oid and a.attname='user_id' and not a.attisdropped)
      and exists (select 1 from pg_attribute a
                   where a.attrelid = pa.oid and a.attname='user_id' and not a.attisdropped)
  loop
    if not ('user_id' = any(r.kolom_anak)) then
      invarian := 'T2_fk_tidak_komposit'; objek := r.anak || '.' || r.conname;
      detail := 'FK ke ' || r.induk || ' hanya memakai ' || array_to_string(r.kolom_anak, ',')
                || ' — harus menyertakan user_id';
      return next;
    end if;
  end loop;

  select count(*) into v_n
  from public.stock_opnames so
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(so.items) = 'array' then so.items else '[]'::jsonb end) e
  where nullif(e->>'product_id','') is not null
    and not exists (select 1 from public.products p
                     where p.id = (e->>'product_id')::uuid and p.user_id = so.user_id);
  if v_n > 0 then
    invarian := 'T3_referensi_lintas_workspace'; objek := 'stock_opnames.items';
    detail := v_n || ' product_id menunjuk workspace lain';
    return next;
  end if;

  return;
end
$$;


ALTER FUNCTION "public"."tenancy_lint"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."tenancy_lint"() IS 'Lint isolasi workspace. Setiap baris yang dikembalikan = satu pelanggaran. Dipanggil public.test_semua() di gerbang CI.';



CREATE OR REPLACE FUNCTION "public"."test_bom"() RETURNS TABLE("suite" "text", "kasus" "text", "hasil" "text", "lulus" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid    uuid := 'dbdbdbdb-0000-4000-8000-000000000001';
  v_uid2   uuid := 'dbdbdbdb-0000-4000-8000-000000000002';
  v_pak    uuid;
  v_lepas  uuid;
  v_jual   uuid;
  v_bahan  uuid;
  v_bahan2 uuid;
  v_hasil  jsonb;
  v_stok   numeric;
  v_buka   numeric;
begin
  delete from public.profiles where id in (v_uid, v_uid2);
  delete from auth.users where id in (v_uid, v_uid2);

  insert into auth.users (id, email) values
    (v_uid,  'uji-db-1@contoh.invalid'),
    (v_uid2, 'uji-db-2@contoh.invalid');

  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role', 'authenticated')::text,
                     true);

  insert into public.products (user_id, name, kind, unit, content_unit, pack_size, opened_used, stock)
  values (v_uid, 'UJI Tepung 800g', 'bahan', 'pak', 'gram', 800, 0, 12)
  returning id into v_pak;

  insert into public.products (user_id, name, kind, unit, pack_size, opened_used, stock)
  values (v_uid, 'UJI Gula curah', 'bahan', 'kg', 0, 0, 10)
  returning id into v_lepas;

  insert into public.products (user_id, name, kind, unit, stock, has_bom)
  values (v_uid, 'UJI Roti', 'jual', 'pcs', 0, true)
  returning id into v_jual;

  insert into public.ingredients (user_id, name, type, unit, source_product_id)
  values (v_uid, 'UJI Tepung', 'bahan', 'gram', v_pak)
  returning id into v_bahan;

  insert into public.ingredients (user_id, name, type, unit, source_product_id)
  values (v_uid, 'UJI Gula', 'bahan', 'kg', v_lepas)
  returning id into v_bahan2;

  v_hasil := public.consume_pack_stock(v_pak, null, v_uid);
  return query select * from public.uji_kasus('bom',
    'K1 kebutuhan NULL tidak menggerakkan stok', 'null',
    coalesce(v_hasil::text, 'null'));

  v_hasil := public.consume_pack_stock(v_pak, 0, v_uid);
  return query select * from public.uji_kasus('bom',
    'K2 kebutuhan 0 tidak menggerakkan stok', 'null',
    coalesce(v_hasil::text, 'null'));

  v_hasil := public.consume_pack_stock(v_pak, -5, v_uid);
  return query select * from public.uji_kasus('bom',
    'K3 kebutuhan negatif tidak menggerakkan stok', 'null',
    coalesce(v_hasil::text, 'null'));

  perform public.consume_pack_stock(v_pak, 500, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K4 pakai 500g dari pak 800g utuh -> pak belum turun',
    'stok=12 terbuka=500',
    format('stok=%s terbuka=%s', v_stok, v_buka));

  perform public.consume_pack_stock(v_pak, 100, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K5 akumulasi 600g dari pak 800g -> pak masih belum turun',
    'stok=12 terbuka=600',
    format('stok=%s terbuka=%s', v_stok, v_buka));

  perform public.consume_pack_stock(v_pak, 300, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K6 akumulasi 900g -> satu pak turun, sisa terbuka 100g',
    'stok=11 terbuka=100',
    format('stok=%s terbuka=%s', v_stok, v_buka));

  update public.products set stock = 10, opened_used = 0 where id = v_pak;
  perform public.consume_pack_stock(v_pak, 800, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K7 pakai tepat 800g -> satu pak turun, tidak ada sisa terbuka',
    'stok=9 terbuka=0',
    format('stok=%s terbuka=%s', v_stok, v_buka));

  update public.products set stock = 1, opened_used = 0 where id = v_pak;
  perform public.consume_pack_stock(v_pak, 2000, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K8 kebutuhan melampaui stok -> stok berhenti di 0, tidak negatif',
    'stok=0 terbuka=400',
    format('stok=%s terbuka=%s', v_stok, v_buka));

  perform public.consume_pack_stock(v_lepas, 3, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_lepas;
  return query select * from public.uji_kasus('bom',
    'K9 produk curah berkurang apa adanya, tanpa sisa terbuka',
    'stok=7 terbuka=0',
    format('stok=%s terbuka=%s', v_stok, v_buka));

  update public.products set stock = 2 where id = v_lepas;
  perform public.consume_pack_stock(v_lepas, 5, v_uid);
  select trim_scale(stock) into v_stok from public.products where id = v_lepas;
  return query select * from public.uji_kasus('bom',
    'K10 produk curah tidak bisa minus',
    'stok=0', format('stok=%s', v_stok));

  update public.products set stock = 5, opened_used = 0 where id = v_pak;
  v_hasil := public.consume_pack_stock(v_pak, 100, v_uid2);
  select trim_scale(stock) into v_stok from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K11 pemilik lain ditolak dan stok tidak bergerak',
    'null stok=5',
    format('%s stok=%s', coalesce(v_hasil::text, 'null'), v_stok));

  v_hasil := public.consume_pack_stock(gen_random_uuid(), 100, v_uid);
  return query select * from public.uji_kasus('bom',
    'K12 produk tidak dikenal -> null, bukan error', 'null',
    coalesce(v_hasil::text, 'null'));

  insert into public.product_boms (user_id, product_id, ingredient_id, qty_per_unit, deduct_stock)
  values (v_uid, v_jual, v_bahan, 250, true);

  update public.products set has_bom = false where id = v_jual;
  update public.products set stock = 12, opened_used = 0 where id = v_pak;
  v_hasil := public.consume_bom_for_sale(v_jual, 2, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K13 has_bom=false -> tidak ada bahan yang terpotong',
    '[] stok=12 terbuka=0',
    format('%s stok=%s terbuka=%s', v_hasil::text, v_stok, v_buka));

  update public.products set has_bom = true where id = v_jual;
  update public.product_boms set deduct_stock = false
    where product_id = v_jual and ingredient_id = v_bahan;
  v_hasil := public.consume_bom_for_sale(v_jual, 2, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K14 deduct_stock=false diabaikan mesin stok',
    '[] stok=12 terbuka=0',
    format('%s stok=%s terbuka=%s', v_hasil::text, v_stok, v_buka));

  update public.product_boms set deduct_stock = true
    where product_id = v_jual and ingredient_id = v_bahan;
  v_hasil := public.consume_bom_for_sale(v_jual, 2, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K15 jual 2 x 250g -> 500g terbuka, pak belum turun',
    'stok=12 terbuka=500 bahan=1',
    format('stok=%s terbuka=%s bahan=%s', v_stok, v_buka, jsonb_array_length(v_hasil)));

  update public.products set stock = 12, opened_used = 0 where id = v_pak;
  v_hasil := public.consume_bom_for_sale(v_jual, 0, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K16 qty 0 tidak memotong bahan apa pun',
    '[] stok=12 terbuka=0',
    format('%s stok=%s terbuka=%s', v_hasil::text, v_stok, v_buka));

  update public.products set stock = 12, opened_used = 200 where id = v_pak;
  v_hasil := public.product_yield(v_jual, v_uid);
  return query select * from public.uji_kasus('bom',
    'K17 yield dibulatkan ke BAWAH (9400g / 250g = 37,6)',
    '37', trim_scale((v_hasil->>'yield')::numeric)::text);

  insert into public.product_boms (user_id, product_id, ingredient_id, qty_per_unit, deduct_stock)
  values (v_uid, v_jual, v_bahan2, 4, true);
  update public.products set stock = 10, opened_used = 0 where id = v_lepas;
  v_hasil := public.product_yield(v_jual, v_uid);
  return query select * from public.uji_kasus('bom',
    'K18 yield mengikuti bahan yang paling membatasi',
    '2', trim_scale((v_hasil->>'yield')::numeric)::text);

  delete from public.profiles where id in (v_uid, v_uid2);
  delete from auth.users where id in (v_uid, v_uid2);
  return;

exception when others then
  return query select * from public.uji_kasus('bom',
    'harness gagal sebelum selesai', 'tanpa error',
    sqlstate || ' ' || sqlerrm);
  delete from public.profiles where id in (v_uid, v_uid2);
  delete from auth.users where id in (v_uid, v_uid2);
  return;
end
$$;


ALTER FUNCTION "public"."test_bom"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."test_bom"() IS '18 kasus mesin pemotongan stok: consume_pack_stock, consume_bom_for_sale, product_yield. Memakai akun auth.users sintetis yang dihapus di akhir.';



CREATE OR REPLACE FUNCTION "public"."test_kolom_transaksi"() RETURNS TABLE("suite" "text", "kasus" "text", "hasil" "text", "lulus" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid  uuid := 'dbdbdbdb-0000-4000-8000-000000000004';
  v_cust uuid;
  v_hasil jsonb;
  v_tx   uuid;
  r      record;
  v_hilang text := '';
begin
  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
  insert into auth.users (id, email) values (v_uid, 'uji-kolom@contoh.invalid');
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  insert into public.customers (user_id, name) values (v_uid, 'UJI Pelanggan')
  returning id into v_cust;

  v_hasil := public.add_transaction_with_stock(
    jsonb_build_object(
      'description','UJI kolom lengkap',
      'amount', 12345,
      'direction','out',
      'channel','struk',
      'receipt_url','uji/struk.jpg',
      'source_ref','struk.jpg',
      'customer_id', v_cust,
      'raw','teks mentah',
      'import_confidence','tinggi'),
    '[]'::jsonb, v_uid);
  v_tx := (v_hasil->'txn'->>'id')::uuid;

  select * into r from public.transactions where id = v_tx;

  if r.receipt_url       is distinct from 'uji/struk.jpg' then v_hilang := v_hilang || 'receipt_url '; end if;
  if r.source_ref        is distinct from 'struk.jpg'     then v_hilang := v_hilang || 'source_ref '; end if;
  if r.customer_id       is distinct from v_cust          then v_hilang := v_hilang || 'customer_id '; end if;
  if r.raw               is distinct from 'teks mentah'   then v_hilang := v_hilang || 'raw '; end if;
  if r.import_confidence is distinct from 'tinggi'        then v_hilang := v_hilang || 'import_confidence '; end if;

  return query select * from public.uji_kasus('kolom_transaksi',
    'P10 receipt_url/source_ref/customer_id/raw/import_confidence ikut tersimpan',
    'semua tersimpan',
    case when v_hilang = '' then 'semua tersimpan' else 'DIBUANG: ' || btrim(v_hilang) end);

  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
  return;

exception when others then
  return query select * from public.uji_kasus('kolom_transaksi',
    'harness kolom gagal sebelum selesai', 'tanpa error', sqlstate || ' ' || sqlerrm);
  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
  return;
end
$$;


ALTER FUNCTION "public"."test_kolom_transaksi"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."test_kolom_transaksi"() IS 'Menjaga agar add_transaction_with_stock tidak diam-diam membuang kolom yang dikirim klien. Lahir dari bug foto struk yatim, 19 Sep 2026.';



CREATE OR REPLACE FUNCTION "public"."test_pembatalan"() RETURNS TABLE("suite" "text", "kasus" "text", "hasil" "text", "lulus" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid   uuid := 'dbdbdbdb-0000-4000-8000-000000000003';
  v_pak   uuid;
  v_jual  uuid;
  v_bahan uuid;
  v_tx    uuid;
  v_tx2   uuid;
  v_hasil jsonb;
  v_stok  numeric;
  v_buka  numeric;
  v_teks  text;
begin
  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
  insert into auth.users (id, email) values (v_uid, 'uji-batal@contoh.invalid');
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  insert into public.products (user_id, name, kind, unit, content_unit, pack_size, opened_used, stock)
  values (v_uid, 'UJI Tepung 800g', 'bahan', 'pak', 'gram', 800, 0, 12) returning id into v_pak;
  insert into public.products (user_id, name, kind, unit, stock, has_bom)
  values (v_uid, 'UJI Roti', 'jual', 'pcs', 100, true) returning id into v_jual;
  insert into public.ingredients (user_id, name, type, unit, source_product_id)
  values (v_uid, 'UJI Tepung', 'bahan', 'gram', v_pak) returning id into v_bahan;
  insert into public.product_boms (user_id, product_id, ingredient_id, qty_per_unit, deduct_stock)
  values (v_uid, v_jual, v_bahan, 250, true);

  v_hasil := public.add_transaction_with_stock(
    jsonb_build_object('description','UJI jual roti','amount',50000,'direction','in'),
    jsonb_build_array(jsonb_build_object('productId', v_jual, 'qty', 2)), v_uid);
  v_tx := (v_hasil->'txn'->>'id')::uuid;
  select status into v_teks from public.transactions where id = v_tx;
  return query select * from public.uji_kasus('pembatalan',
    'P1 transaksi baru berstatus aktif', 'aktif', v_teks);

  select trim_scale(stock) into v_stok from public.products where id = v_jual;
  select trim_scale(opened_used) into v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('pembatalan',
    'P2 penjualan memotong produk jual DAN bahan penyusunnya',
    'jual=98 terbuka=500', format('jual=%s terbuka=%s', v_stok, v_buka));

  perform public.batalkan_transaksi(v_tx, 'uji', v_uid);
  select trim_scale(stock) into v_stok from public.products where id = v_jual;
  return query select * from public.uji_kasus('pembatalan',
    'P3 pembatalan mengembalikan stok produk jual', 'jual=100', format('jual=%s', v_stok));

  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka
    from public.products where id = v_pak;
  return query select * from public.uji_kasus('pembatalan',
    'P4 pembalikan ikut memulihkan stok bahan (BOM)',
    'pak=12 terbuka=0', format('pak=%s terbuka=%s', v_stok, v_buka));

  perform public.batalkan_transaksi(v_tx, 'uji lagi', v_uid);
  select trim_scale(stock) into v_stok from public.products where id = v_jual;
  return query select * from public.uji_kasus('pembatalan',
    'P5 membatalkan dua kali TIDAK menambah stok dua kali',
    'jual=100', format('jual=%s', v_stok));

  select count(*)::text into v_teks from public.transactions where id = v_tx;
  return query select * from public.uji_kasus('pembatalan',
    'P6 nota tetap tersimpan setelah dibatalkan', '1', v_teks);

  begin
    delete from public.transactions where id = v_tx;
    v_teks := 'TIDAK DITOLAK';
  exception when others then
    v_teks := 'ditolak';
  end;
  return query select * from public.uji_kasus('pembatalan',
    'P7 penghapusan transaksi ditolak database', 'ditolak', v_teks);

  v_hasil := public.add_transaction_with_stock(
    jsonb_build_object('description','UJI jual kedua','amount',25000,'direction','in'),
    jsonb_build_array(jsonb_build_object('productId', v_jual, 'qty', 1)), v_uid);
  v_tx2 := (v_hasil->'txn'->>'id')::uuid;
  perform public.batalkan_transaksi(v_tx, 'sudah batal', v_uid);
  select trim_scale(stock) into v_stok from public.products where id = v_jual;
  return query select * from public.uji_kasus('pembatalan',
    'P8 membatalkan transaksi lain tidak mengusik yang masih aktif',
    'jual=99', format('jual=%s', v_stok));

  delete from auth.users where id = v_uid;
  select count(*)::text into v_teks from public.transactions where user_id = v_uid;
  return query select * from public.uji_kasus('pembatalan',
    'P9 penghapusan akun tetap menghapus transaksinya (UU PDP)', '0', v_teks);

  delete from public.profiles where id = v_uid;
  return;

exception when others then
  return query select * from public.uji_kasus('pembatalan',
    'harness pembatalan gagal sebelum selesai', 'tanpa error', sqlstate || ' ' || sqlerrm);
  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
  return;
end
$$;


ALTER FUNCTION "public"."test_pembatalan"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."test_pembatalan"() IS '9 kasus pembatalan transaksi: pembalikan stok langsung dan BOM, idempotensi, nota yang tetap ada, penolakan DELETE di level database, dan jaminan bahwa penghapusan akun (UU PDP) tetap bisa berjalan.';



CREATE OR REPLACE FUNCTION "public"."test_semua"() RETURNS TABLE("suite" "text", "kasus" "text", "hasil" "text", "lulus" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  r record;
  v_n bigint;
begin
  return query select * from public.test_bom();
  return query select * from public.test_pembatalan();
  return query select * from public.test_kolom_transaksi();

  select count(*) into v_n from public.rls_lint();
  if v_n = 0 then
    return query select * from public.uji_kasus('rls_lint',
      'tidak ada baris yang bocor lintas pengguna', '0 pelanggaran', '0 pelanggaran');
  else
    for r in select * from public.rls_lint() loop
      return query select * from public.uji_kasus('rls_lint',
        r.invarian || ' @ ' || r.objek, 'tidak ada pelanggaran', r.detail);
    end loop;
  end if;

  select count(*) into v_n from public.tenancy_lint();
  if v_n = 0 then
    return query select * from public.uji_kasus('tenancy_lint',
      'isolasi workspace utuh', '0 pelanggaran', '0 pelanggaran');
  else
    for r in select * from public.tenancy_lint() loop
      return query select * from public.uji_kasus('tenancy_lint',
        r.invarian || ' @ ' || r.objek, 'tidak ada pelanggaran', r.detail);
    end loop;
  end if;

  return;
end
$$;


ALTER FUNCTION "public"."test_semua"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."test_semua"() IS 'Gerbang uji database: test_bom + rls_lint + tenancy_lint. Dipanggil scripts/uji-db.mjs di CI. Lint bersih tetap mengembalikan satu baris lulus, supaya "0 kasus" selalu berarti gerbangnya rusak.';



CREATE OR REPLACE FUNCTION "public"."tolak_hapus_transaksi"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if coalesce(current_setting('app.hapus_data_saya', true), '') = '1' then
    return old;
  end if;

  if not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;

  raise exception
    'Transaksi tidak boleh dihapus. Batalkan dengan mengubah status menjadi "batal" — stoknya akan dibalik otomatis dan notanya tetap terekam.'
    using errcode = 'restrict_violation';
end $$;


ALTER FUNCTION "public"."tolak_hapus_transaksi"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."topeng_email"("p_email" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case
    when p_email is null or position('@' in p_email) = 0 then null
    else
      case when length(split_part(p_email, '@', 1)) <= 3
           then left(split_part(p_email, '@', 1), 1) || '***'
           else left(split_part(p_email, '@', 1), 2) || '***' || right(split_part(p_email, '@', 1), 2)
      end || '@' || split_part(p_email, '@', 2)
  end;
$$;


ALTER FUNCTION "public"."topeng_email"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."uji_kasus"("p_suite" "text", "p_kasus" "text", "p_harap" "text", "p_aktual" "text") RETURNS TABLE("suite" "text", "kasus" "text", "hasil" "text", "lulus" boolean)
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select
    p_suite::text,
    p_kasus::text,
    (case when p_aktual is not distinct from p_harap
          then 'ok: ' || coalesce(p_aktual, '(null)')
          else 'harap [' || coalesce(p_harap, '(null)')
               || '] dapat [' || coalesce(p_aktual, '(null)') || ']'
     end)::text,
    (p_aktual is not distinct from p_harap)::boolean;
$$;


ALTER FUNCTION "public"."uji_kasus"("p_suite" "text", "p_kasus" "text", "p_harap" "text", "p_aktual" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."uji_kasus"("p_suite" "text", "p_kasus" "text", "p_harap" "text", "p_aktual" "text") IS 'Pembanding satu kasus uji. is not distinct from — jadi null == null dihitung lulus, bukan unknown.';



CREATE OR REPLACE FUNCTION "public"."voice_session_acquire"() RETURNS TABLE("acquired" boolean, "holder_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  ws  uuid := public.ai_workspace_id();
  me  uuid := auth.uid();
  cur record;
begin
  if ws is null then
    return query select false, null::uuid; return;
  end if;

  -- Bersihkan sesi basi (idle > 60 detik) lebih dulu.
  delete from public.voice_sessions
   where workspace_id = ws
     and last_seen_at < now() - interval '60 seconds';

  select * into cur from public.voice_sessions where workspace_id = ws;

  if cur is null then
    insert into public.voice_sessions (workspace_id, holder_id)
    values (ws, me)
    on conflict (workspace_id) do nothing;
    return query select true, me; return;
  end if;

  -- Pemegang yang sama boleh melanjutkan sesinya.
  if cur.holder_id = me then
    update public.voice_sessions set last_seen_at = now() where workspace_id = ws;
    return query select true, me; return;
  end if;

  return query select false, cur.holder_id;
end;
$$;


ALTER FUNCTION "public"."voice_session_acquire"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."voice_session_release"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  ws uuid := public.ai_workspace_id();
begin
  delete from public.voice_sessions
   where workspace_id = ws and holder_id = auth.uid();
  return found;
end;
$$;


ALTER FUNCTION "public"."voice_session_release"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."voice_session_touch"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  ws uuid := public.ai_workspace_id();
begin
  update public.voice_sessions
     set last_seen_at = now()
   where workspace_id = ws and holder_id = auth.uid();
  return found;
end;
$$;


ALTER FUNCTION "public"."voice_session_touch"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "auth"."audit_log_entries" (
    "instance_id" "uuid",
    "id" "uuid" NOT NULL,
    "payload" json,
    "created_at" timestamp with time zone,
    "ip_address" character varying(64) DEFAULT ''::character varying NOT NULL
);


ALTER TABLE "auth"."audit_log_entries" OWNER TO "supabase_auth_admin";


COMMENT ON TABLE "auth"."audit_log_entries" IS 'Auth: Audit trail for user actions.';



CREATE TABLE IF NOT EXISTS "auth"."custom_oauth_providers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider_type" "text" NOT NULL,
    "identifier" "text" NOT NULL,
    "name" "text" NOT NULL,
    "client_id" "text" NOT NULL,
    "client_secret" "text" NOT NULL,
    "acceptable_client_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "scopes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "pkce_enabled" boolean DEFAULT true NOT NULL,
    "attribute_mapping" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "authorization_params" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "email_optional" boolean DEFAULT false NOT NULL,
    "issuer" "text",
    "discovery_url" "text",
    "skip_nonce_check" boolean DEFAULT false NOT NULL,
    "cached_discovery" "jsonb",
    "discovery_cached_at" timestamp with time zone,
    "authorization_url" "text",
    "token_url" "text",
    "userinfo_url" "text",
    "jwks_uri" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "custom_claims_allowlist" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    CONSTRAINT "custom_oauth_providers_authorization_url_https" CHECK ((("authorization_url" IS NULL) OR ("authorization_url" ~~ 'https://%'::"text"))),
    CONSTRAINT "custom_oauth_providers_authorization_url_length" CHECK ((("authorization_url" IS NULL) OR ("char_length"("authorization_url") <= 2048))),
    CONSTRAINT "custom_oauth_providers_client_id_length" CHECK ((("char_length"("client_id") >= 1) AND ("char_length"("client_id") <= 512))),
    CONSTRAINT "custom_oauth_providers_discovery_url_length" CHECK ((("discovery_url" IS NULL) OR ("char_length"("discovery_url") <= 2048))),
    CONSTRAINT "custom_oauth_providers_identifier_format" CHECK (("identifier" ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'::"text")),
    CONSTRAINT "custom_oauth_providers_issuer_length" CHECK ((("issuer" IS NULL) OR (("char_length"("issuer") >= 1) AND ("char_length"("issuer") <= 2048)))),
    CONSTRAINT "custom_oauth_providers_jwks_uri_https" CHECK ((("jwks_uri" IS NULL) OR ("jwks_uri" ~~ 'https://%'::"text"))),
    CONSTRAINT "custom_oauth_providers_jwks_uri_length" CHECK ((("jwks_uri" IS NULL) OR ("char_length"("jwks_uri") <= 2048))),
    CONSTRAINT "custom_oauth_providers_name_length" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 100))),
    CONSTRAINT "custom_oauth_providers_oauth2_requires_endpoints" CHECK ((("provider_type" <> 'oauth2'::"text") OR (("authorization_url" IS NOT NULL) AND ("token_url" IS NOT NULL) AND ("userinfo_url" IS NOT NULL)))),
    CONSTRAINT "custom_oauth_providers_oidc_discovery_url_https" CHECK ((("provider_type" <> 'oidc'::"text") OR ("discovery_url" IS NULL) OR ("discovery_url" ~~ 'https://%'::"text"))),
    CONSTRAINT "custom_oauth_providers_oidc_issuer_https" CHECK ((("provider_type" <> 'oidc'::"text") OR ("issuer" IS NULL) OR ("issuer" ~~ 'https://%'::"text"))),
    CONSTRAINT "custom_oauth_providers_oidc_requires_issuer" CHECK ((("provider_type" <> 'oidc'::"text") OR ("issuer" IS NOT NULL))),
    CONSTRAINT "custom_oauth_providers_provider_type_check" CHECK (("provider_type" = ANY (ARRAY['oauth2'::"text", 'oidc'::"text"]))),
    CONSTRAINT "custom_oauth_providers_token_url_https" CHECK ((("token_url" IS NULL) OR ("token_url" ~~ 'https://%'::"text"))),
    CONSTRAINT "custom_oauth_providers_token_url_length" CHECK ((("token_url" IS NULL) OR ("char_length"("token_url") <= 2048))),
    CONSTRAINT "custom_oauth_providers_userinfo_url_https" CHECK ((("userinfo_url" IS NULL) OR ("userinfo_url" ~~ 'https://%'::"text"))),
    CONSTRAINT "custom_oauth_providers_userinfo_url_length" CHECK ((("userinfo_url" IS NULL) OR ("char_length"("userinfo_url") <= 2048)))
);


ALTER TABLE "auth"."custom_oauth_providers" OWNER TO "supabase_auth_admin";


CREATE TABLE IF NOT EXISTS "auth"."flow_state" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid",
    "auth_code" "text",
    "code_challenge_method" "auth"."code_challenge_method",
    "code_challenge" "text",
    "provider_type" "text" NOT NULL,
    "provider_access_token" "text",
    "provider_refresh_token" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "authentication_method" "text" NOT NULL,
    "auth_code_issued_at" timestamp with time zone,
    "invite_token" "text",
    "referrer" "text",
    "oauth_client_state_id" "uuid",
    "linking_target_id" "uuid",
    "email_optional" boolean DEFAULT false NOT NULL
);


ALTER TABLE "auth"."flow_state" OWNER TO "supabase_auth_admin";


COMMENT ON TABLE "auth"."flow_state" IS 'Stores metadata for all OAuth/SSO login flows';



CREATE TABLE IF NOT EXISTS "auth"."identities" (
    "provider_id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "identity_data" "jsonb" NOT NULL,
    "provider" "text" NOT NULL,
    "last_sign_in_at" timestamp with time zone,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "email" "text" GENERATED ALWAYS AS ("lower"(("identity_data" ->> 'email'::"text"))) STORED,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);


ALTER TABLE "auth"."identities" OWNER TO "supabase_auth_admin";


COMMENT ON TABLE "auth"."identities" IS 'Auth: Stores identities associated to a user.';



COMMENT ON COLUMN "auth"."identities"."email" IS 'Auth: Email is a generated column that references the optional email property in the identity_data';



CREATE TABLE IF NOT EXISTS "auth"."instances" (
    "id" "uuid" NOT NULL,
    "uuid" "uuid",
    "raw_base_config" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "auth"."instances" OWNER TO "supabase_auth_admin";


COMMENT ON TABLE "auth"."instances" IS 'Auth: Manages users across multiple sites.';



CREATE TABLE IF NOT EXISTS "auth"."mfa_amr_claims" (
    "session_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "authentication_method" "text" NOT NULL,
    "id" "uuid" NOT NULL
);


ALTER TABLE "auth"."mfa_amr_claims" OWNER TO "supabase_auth_admin";


COMMENT ON TABLE "auth"."mfa_amr_claims" IS 'auth: stores authenticator method reference claims for multi factor authentication';



CREATE TABLE IF NOT EXISTS "auth"."mfa_challenges" (
    "id" "uuid" NOT NULL,
    "factor_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "verified_at" timestamp with time zone,
    "ip_address" "inet" NOT NULL,
    "otp_code" "text",
    "web_authn_session_data" "jsonb"
);


ALTER TABLE "auth"."mfa_challenges" OWNER TO "supabase_auth_admin";


COMMENT ON TABLE "auth"."mfa_challenges" IS 'auth: stores metadata about challenge requests made';



CREATE TABLE IF NOT EXISTS "auth"."mfa_factors" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "friendly_name" "text",
    "factor_type" "auth"."factor_type" NOT NULL,
    "status" "auth"."factor_status" NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "updated_at" timestamp with time zone NOT NULL,
    "secret" "text",
    "phone" "text",
    "last_challenged_at" timestamp with time zone,
    "web_authn_credential" "jsonb",
    "web_authn_aaguid" "uuid",
    "last_webauthn_challenge_data" "jsonb"
);


ALTER TABLE "auth"."mfa_factors" OWNER TO "supabase_auth_admin";


COMMENT ON TABLE "auth"."mfa_factors" IS 'auth: stores metadata about factors';



COMMENT ON COLUMN "auth"."mfa_factors"."last_webauthn_challenge_data" IS 'Stores the latest WebAuthn challenge data including attestation/assertion for customer verification';



CREATE TABLE IF NOT EXISTS "auth"."mfa_recovery_code_sets" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "mfa_factor_id" "uuid" NOT NULL,
    "failed_verification_count" integer DEFAULT 0 NOT NULL,
    "verification_locked_until" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mfa_recovery_code_sets_failed_verification_count_check" CHECK (("failed_verification_count" >= 0))
);


ALTER TABLE "auth"."mfa_recovery_code_sets" OWNER TO "supabase_auth_admin";


CREATE TABLE IF NOT EXISTS "auth"."mfa_recovery_codes" (
    "id" "uuid" NOT NULL,
    "mfa_recovery_code_set_id" "uuid" NOT NULL,
    "code_hash" "text" NOT NULL,
    "consumed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "auth"."mfa_recovery_codes" OWNER TO "supabase_auth_admin";


CREATE TABLE IF NOT EXISTS "auth"."oauth_authorizations" (
    "id" "uuid" NOT NULL,
    "authorization_id" "text" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "redirect_uri" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "state" "text",
    "resource" "text",
    "code_challenge" "text",
    "code_challenge_method" "auth"."code_challenge_method",
    "response_type" "auth"."oauth_response_type" DEFAULT 'code'::"auth"."oauth_response_type" NOT NULL,
    "status" "auth"."oauth_authorization_status" DEFAULT 'pending'::"auth"."oauth_authorization_status" NOT NULL,
    "authorization_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:03:00'::interval) NOT NULL,
    "approved_at" timestamp with time zone,
    "nonce" "text",
    CONSTRAINT "oauth_authorizations_authorization_code_length" CHECK (("char_length"("authorization_code") <= 255)),
    CONSTRAINT "oauth_authorizations_code_challenge_length" CHECK (("char_length"("code_challenge") <= 128)),
    CONSTRAINT "oauth_authorizations_expires_at_future" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "oauth_authorizations_nonce_length" CHECK (("char_length"("nonce") <= 255)),
    CONSTRAINT "oauth_authorizations_redirect_uri_length" CHECK (("char_length"("redirect_uri") <= 2048)),
    CONSTRAINT "oauth_authorizations_resource_length" CHECK (("char_length"("resource") <= 2048)),
    CONSTRAINT "oauth_authorizations_scope_length" CHECK (("char_length"("scope") <= 4096)),
    CONSTRAINT "oauth_authorizations_state_length" CHECK (("char_length"("state") <= 4096))
);


ALTER TABLE "auth"."oauth_authorizations" OWNER TO "supabase_auth_admin";


CREATE TABLE IF NOT EXISTS "auth"."oauth_client_states" (
    "id" "uuid" NOT NULL,
    "provider_type" "text" NOT NULL,
    "code_verifier" "text",
    "created_at" timestamp with time zone NOT NULL
);


ALTER TABLE "auth"."oauth_client_states" OWNER TO "supabase_auth_admin";


COMMENT ON TABLE "auth"."oauth_client_states" IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';



CREATE TABLE IF NOT EXISTS "auth"."oauth_clients" (
    "id" "uuid" NOT NULL,
    "client_secret_hash" "text",
    "registration_type" "auth"."oauth_registration_type" NOT NULL,
    "redirect_uris" "text" NOT NULL,
    "grant_types" "text" NOT NULL,
    "client_name" "text",
    "client_uri" "text",
    "logo_uri" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "client_type" "auth"."oauth_client_type" DEFAULT 'confidential'::"auth"."oauth_client_type" NOT NULL,
    "token_endpoint_auth_method" "text" NOT NULL,
    CONSTRAINT "oauth_clients_client_name_length" CHECK (("char_length"("client_name") <= 1024)),
    CONSTRAINT "oauth_clients_client_uri_length" CHECK (("char_length"("client_uri") <= 2048)),
    CONSTRAINT "oauth_clients_logo_uri_length" CHECK (("char_length"("logo_uri") <= 2048)),
    CONSTRAINT "oauth_clients_token_endpoint_auth_method_check" CHECK (("token_endpoint_auth_method" = ANY (ARRAY['client_secret_basic'::"text", 'client_secret_post'::"text", 'none'::"text"])))
);


ALTER TABLE "auth"."oauth_clients" OWNER TO "supabase_auth_admin";


CREATE TABLE IF NOT EXISTS "auth"."oauth_consents" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "scopes" "text" NOT NULL,
    "granted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "oauth_consents_revoked_after_granted" CHECK ((("revoked_at" IS NULL) OR ("revoked_at" >= "granted_at"))),
    CONSTRAINT "oauth_consents_scopes_length" CHECK (("char_length"("scopes") <= 2048)),
    CONSTRAINT "oauth_consents_scopes_not_empty" CHECK (("char_length"(TRIM(BOTH FROM "scopes")) > 0))
);


ALTER TABLE "auth"."oauth_consents" OWNER TO "supabase_auth_admin";


CREATE TABLE IF NOT EXISTS "auth"."one_time_tokens" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "token_type" "auth"."one_time_token_type" NOT NULL,
    "token_hash" "text" NOT NULL,
    "relates_to" "text" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    CONSTRAINT "one_time_tokens_token_hash_check" CHECK (("char_length"("token_hash") > 0))
);


ALTER TABLE "auth"."one_time_tokens" OWNER TO "supabase_auth_admin";


CREATE TABLE IF NOT EXISTS "auth"."refresh_tokens" (
    "instance_id" "uuid",
    "id" bigint NOT NULL,
    "token" character varying(255),
    "user_id" character varying(255),
    "revoked" boolean,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "parent" character varying(255),
    "session_id" "uuid"
);


ALTER TABLE "auth"."refresh_tokens" OWNER TO "supabase_auth_admin";


COMMENT ON TABLE "auth"."refresh_tokens" IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';



CREATE SEQUENCE IF NOT EXISTS "auth"."refresh_tokens_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "auth"."refresh_tokens_id_seq" OWNER TO "supabase_auth_admin";


ALTER SEQUENCE "auth"."refresh_tokens_id_seq" OWNED BY "auth"."refresh_tokens"."id";



CREATE TABLE IF NOT EXISTS "auth"."saml_providers" (
    "id" "uuid" NOT NULL,
    "sso_provider_id" "uuid" NOT NULL,
    "entity_id" "text" NOT NULL,
    "metadata_xml" "text" NOT NULL,
    "metadata_url" "text",
    "attribute_mapping" "jsonb",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "name_id_format" "text",
    CONSTRAINT "entity_id not empty" CHECK (("char_length"("entity_id") > 0)),
    CONSTRAINT "metadata_url not empty" CHECK ((("metadata_url" = NULL::"text") OR ("char_length"("metadata_url") > 0))),
    CONSTRAINT "metadata_xml not empty" CHECK (("char_length"("metadata_xml") > 0))
);


ALTER TABLE "auth"."saml_providers" OWNER TO "supabase_auth_admin";


COMMENT ON TABLE "auth"."saml_providers" IS 'Auth: Manages SAML Identity Provider connections.';



CREATE TABLE IF NOT EXISTS "auth"."saml_relay_states" (
    "id" "uuid" NOT NULL,
    "sso_provider_id" "uuid" NOT NULL,
    "request_id" "text" NOT NULL,
    "for_email" "text",
    "redirect_to" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "flow_state_id" "uuid",
    CONSTRAINT "request_id not empty" CHECK (("char_length"("request_id") > 0))
);


ALTER TABLE "auth"."saml_relay_states" OWNER TO "supabase_auth_admin";


COMMENT ON TABLE "auth"."saml_relay_states" IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';



CREATE TABLE IF NOT EXISTS "auth"."schema_migrations" (
    "version" character varying(255) NOT NULL
);


ALTER TABLE "auth"."schema_migrations" OWNER TO "supabase_auth_admin";


COMMENT ON TABLE "auth"."schema_migrations" IS 'Auth: Manages updates to the auth system.';



CREATE TABLE IF NOT EXISTS "auth"."scim_tokens" (
    "id" "uuid" NOT NULL,
    "sso_provider_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "prefix" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "last_used_at" timestamp with time zone,
    CONSTRAINT "scim_tokens_expires_at_future" CHECK ((("expires_at" IS NULL) OR ("expires_at" > "created_at"))),
    CONSTRAINT "scim_tokens_revoked_after_created" CHECK ((("revoked_at" IS NULL) OR ("revoked_at" >= "created_at"))),
    CONSTRAINT "scim_tokens_token_hash_check" CHECK (("token_hash" ~ '^[0-9a-f]{64}$'::"text"))
);


ALTER TABLE "auth"."scim_tokens" OWNER TO "supabase_auth_admin";


CREATE TABLE IF NOT EXISTS "auth"."scim_users" (
    "id" "uuid" NOT NULL,
    "sso_provider_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "resource" "jsonb" NOT NULL,
    "user_name" "text" GENERATED ALWAYS AS ("lower"(("resource" ->> 'userName'::"text"))) STORED NOT NULL,
    "external_id" "text" GENERATED ALWAYS AS (("resource" ->> 'externalId'::"text")) STORED,
    "active" boolean GENERATED ALWAYS AS (COALESCE((("resource" ->> 'active'::"text"))::boolean, true)) STORED NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "auth"."scim_users" OWNER TO "supabase_auth_admin";


CREATE TABLE IF NOT EXISTS "auth"."sessions" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "factor_id" "uuid",
    "aal" "auth"."aal_level",
    "not_after" timestamp with time zone,
    "refreshed_at" timestamp without time zone,
    "user_agent" "text",
    "ip" "inet",
    "tag" "text",
    "oauth_client_id" "uuid",
    "refresh_token_hmac_key" "text",
    "refresh_token_counter" bigint,
    "scopes" "text",
    CONSTRAINT "sessions_scopes_length" CHECK (("char_length"("scopes") <= 4096))
);


ALTER TABLE "auth"."sessions" OWNER TO "supabase_auth_admin";


COMMENT ON TABLE "auth"."sessions" IS 'Auth: Stores session data associated to a user.';



COMMENT ON COLUMN "auth"."sessions"."not_after" IS 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';



COMMENT ON COLUMN "auth"."sessions"."refresh_token_hmac_key" IS 'Holds a HMAC-SHA256 key used to sign refresh tokens for this session.';



COMMENT ON COLUMN "auth"."sessions"."refresh_token_counter" IS 'Holds the ID (counter) of the last issued refresh token.';



CREATE TABLE IF NOT EXISTS "auth"."sso_domains" (
    "id" "uuid" NOT NULL,
    "sso_provider_id" "uuid" NOT NULL,
    "domain" "text" NOT NULL,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    CONSTRAINT "domain not empty" CHECK (("char_length"("domain") > 0))
);


ALTER TABLE "auth"."sso_domains" OWNER TO "supabase_auth_admin";


COMMENT ON TABLE "auth"."sso_domains" IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';



CREATE TABLE IF NOT EXISTS "auth"."sso_providers" (
    "id" "uuid" NOT NULL,
    "resource_id" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "disabled" boolean,
    CONSTRAINT "resource_id not empty" CHECK ((("resource_id" = NULL::"text") OR ("char_length"("resource_id") > 0)))
);


ALTER TABLE "auth"."sso_providers" OWNER TO "supabase_auth_admin";


COMMENT ON TABLE "auth"."sso_providers" IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';



COMMENT ON COLUMN "auth"."sso_providers"."resource_id" IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';



CREATE TABLE IF NOT EXISTS "auth"."users" (
    "instance_id" "uuid",
    "id" "uuid" NOT NULL,
    "aud" character varying(255),
    "role" character varying(255),
    "email" character varying(255),
    "encrypted_password" character varying(255),
    "email_confirmed_at" timestamp with time zone,
    "invited_at" timestamp with time zone,
    "confirmation_token" character varying(255),
    "confirmation_sent_at" timestamp with time zone,
    "recovery_token" character varying(255),
    "recovery_sent_at" timestamp with time zone,
    "email_change_token_new" character varying(255),
    "email_change" character varying(255),
    "email_change_sent_at" timestamp with time zone,
    "last_sign_in_at" timestamp with time zone,
    "raw_app_meta_data" "jsonb",
    "raw_user_meta_data" "jsonb",
    "is_super_admin" boolean,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "phone" "text" DEFAULT NULL::character varying,
    "phone_confirmed_at" timestamp with time zone,
    "phone_change" "text" DEFAULT ''::character varying,
    "phone_change_token" character varying(255) DEFAULT ''::character varying,
    "phone_change_sent_at" timestamp with time zone,
    "confirmed_at" timestamp with time zone GENERATED ALWAYS AS (LEAST("email_confirmed_at", "phone_confirmed_at")) STORED,
    "email_change_token_current" character varying(255) DEFAULT ''::character varying,
    "email_change_confirm_status" smallint DEFAULT 0,
    "banned_until" timestamp with time zone,
    "reauthentication_token" character varying(255) DEFAULT ''::character varying,
    "reauthentication_sent_at" timestamp with time zone,
    "is_sso_user" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "is_anonymous" boolean DEFAULT false NOT NULL,
    CONSTRAINT "users_email_change_confirm_status_check" CHECK ((("email_change_confirm_status" >= 0) AND ("email_change_confirm_status" <= 2)))
);


ALTER TABLE "auth"."users" OWNER TO "supabase_auth_admin";


COMMENT ON TABLE "auth"."users" IS 'Auth: Stores user login data within a secure schema.';



COMMENT ON COLUMN "auth"."users"."is_sso_user" IS 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';



CREATE TABLE IF NOT EXISTS "auth"."webauthn_challenges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "challenge_type" "text" NOT NULL,
    "session_data" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "webauthn_challenges_challenge_type_check" CHECK (("challenge_type" = ANY (ARRAY['signup'::"text", 'registration'::"text", 'authentication'::"text"])))
);


ALTER TABLE "auth"."webauthn_challenges" OWNER TO "supabase_auth_admin";


CREATE TABLE IF NOT EXISTS "auth"."webauthn_credentials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "credential_id" "bytea" NOT NULL,
    "public_key" "bytea" NOT NULL,
    "attestation_type" "text" DEFAULT ''::"text" NOT NULL,
    "aaguid" "uuid",
    "sign_count" bigint DEFAULT 0 NOT NULL,
    "transports" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "backup_eligible" boolean DEFAULT false NOT NULL,
    "backed_up" boolean DEFAULT false NOT NULL,
    "friendly_name" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone
);


ALTER TABLE "auth"."webauthn_credentials" OWNER TO "supabase_auth_admin";


CREATE TABLE IF NOT EXISTS "ops"."service_config" (
    "kunci" "text" NOT NULL,
    "nilai" "text" NOT NULL,
    "dibuat_pada" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "ops"."service_config" OWNER TO "postgres";


COMMENT ON TABLE "ops"."service_config" IS 'Rahasia internal server (mis. token keepalive). Nilainya dibuat di dalam Postgres dan tidak pernah ditulis ke definisi cron, agar tidak ikut terbaca setiap kali jadwal cron dilihat atau diekspor.';



CREATE TABLE IF NOT EXISTS "ops"."service_heartbeat" (
    "id" bigint NOT NULL,
    "beat_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sumber" "text" NOT NULL,
    "kesehatan" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sehat" boolean DEFAULT true NOT NULL,
    "catatan" "text"
);


ALTER TABLE "ops"."service_heartbeat" OWNER TO "postgres";


COMMENT ON TABLE "ops"."service_heartbeat" IS 'Detak keep-alive + rekam medis berkala. Ditulis cron tiap <= 6 hari agar proyek Supabase gratis tidak pernah menyentuh ambang jeda 7 hari, sekaligus menjadi jejak historis kesehatan layanan (kunci AI, harga, kurs).';



CREATE SEQUENCE IF NOT EXISTS "ops"."service_heartbeat_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "ops"."service_heartbeat_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "ops"."service_heartbeat_id_seq" OWNED BY "ops"."service_heartbeat"."id";



CREATE TABLE IF NOT EXISTS "public"."admin_audit_log" (
    "id" bigint NOT NULL,
    "admin_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "action" "text" NOT NULL,
    "target_table" "text",
    "target_id" "text",
    "meta" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_audit_log" OWNER TO "postgres";


ALTER TABLE "public"."admin_audit_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."admin_audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."admin_quota_actions" (
    "id" bigint NOT NULL,
    "admin_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "feature" "text",
    "before_value" "jsonb",
    "after_value" "jsonb",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "admin_quota_actions_action_check" CHECK (("action" = ANY (ARRAY['set_daily_cap'::"text", 'clear_daily_cap'::"text", 'set_plan'::"text", 'set_credit_override'::"text", 'clear_credit_override'::"text", 'suspend'::"text", 'unsuspend'::"text", 'set_token_cap'::"text", 'clear_token_cap'::"text"])))
);


ALTER TABLE "public"."admin_quota_actions" OWNER TO "postgres";


ALTER TABLE "public"."admin_quota_actions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."admin_quota_actions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."admins" (
    "user_id" "uuid" NOT NULL,
    "email" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_activity_log" (
    "id" bigint NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "feature" "text" NOT NULL,
    "outcome" "text" DEFAULT 'ok'::"text" NOT NULL,
    "meta" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "model" "text",
    "key_slot" "text",
    "latency_ms" integer,
    "tokens_in" integer,
    "tokens_out" integer,
    "used_fallback" boolean,
    "error_code" "text"
);


ALTER TABLE "public"."ai_activity_log" OWNER TO "postgres";


ALTER TABLE "public"."ai_activity_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ai_activity_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ai_credit_rates" (
    "feature" "text" NOT NULL,
    "credit_cost" numeric(6,2) NOT NULL,
    "effective_from" "date" DEFAULT CURRENT_DATE NOT NULL,
    "note" "text",
    CONSTRAINT "ai_credit_rates_credit_cost_check" CHECK (("credit_cost" >= (0)::numeric))
);


ALTER TABLE "public"."ai_credit_rates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_feature_defaults" (
    "feature" "text" NOT NULL,
    "label" "text" NOT NULL,
    "unit" "text" DEFAULT 'panggilan'::"text" NOT NULL,
    "default_cap" integer NOT NULL,
    "max_cap" integer NOT NULL,
    "key_slot" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "model" "text",
    "fallback_model" "text",
    "model_note" "text",
    CONSTRAINT "ai_feature_defaults_cap_masuk_akal" CHECK (("default_cap" <= "max_cap")),
    CONSTRAINT "ai_feature_defaults_default_cap_check" CHECK (("default_cap" >= 0)),
    CONSTRAINT "ai_feature_defaults_max_cap_check" CHECK (("max_cap" >= 0)),
    CONSTRAINT "ai_feature_defaults_unit_check" CHECK (("unit" = ANY (ARRAY['panggilan'::"text", 'detik'::"text"])))
);


ALTER TABLE "public"."ai_feature_defaults" OWNER TO "postgres";


COMMENT ON COLUMN "public"."ai_feature_defaults"."model" IS 'Model utama dari FEATURE_ROUTES di supabase/functions/_shared/ai/config.ts. Diperbarui manual saat rute berubah — bukan dibaca live dari kode.';



COMMENT ON COLUMN "public"."ai_feature_defaults"."fallback_model" IS 'Model cadangan. NULL berarti fitur ini TIDAK punya fallback — satu kegagalan model berarti fitur mati, bukan berdegradasi.';



CREATE TABLE IF NOT EXISTS "public"."ai_insights" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "insight_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "kind" "text" DEFAULT 'harian'::"text" NOT NULL,
    "content" "text" NOT NULL,
    "payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ai_insights" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_plans" (
    "code" "text" NOT NULL,
    "label" "text" NOT NULL,
    "seat_limit" integer NOT NULL,
    "monthly_credit_cap" numeric(12,2),
    "daily_caps" "jsonb",
    "price_idr" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "token_cap_daily" bigint,
    "token_cap_monthly" bigint,
    CONSTRAINT "ai_plans_monthly_credit_cap_check" CHECK ((("monthly_credit_cap" IS NULL) OR ("monthly_credit_cap" >= (0)::numeric))),
    CONSTRAINT "ai_plans_price_idr_check" CHECK (("price_idr" >= 0)),
    CONSTRAINT "ai_plans_seat_limit_check" CHECK (("seat_limit" >= 1))
);


ALTER TABLE "public"."ai_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_usage" (
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "day" "date" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"date" NOT NULL,
    "kind" "text" NOT NULL,
    "count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."ai_usage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_events" (
    "id" bigint NOT NULL,
    "user_id" "uuid",
    "type" "text" NOT NULL,
    "meta" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."app_events" OWNER TO "postgres";


ALTER TABLE "public"."app_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."app_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."attendance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "status" "text" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "attendance_status_check" CHECK (("status" = ANY (ARRAY['hadir'::"text", 'izin'::"text", 'sakit'::"text", 'cuti'::"text", 'alpa'::"text"])))
);


ALTER TABLE "public"."attendance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attendance_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "bonus_per_day" numeric DEFAULT 0 NOT NULL,
    "deduction_per_day" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "attendance_rules_bonus_per_day_check" CHECK (("bonus_per_day" >= (0)::numeric)),
    CONSTRAINT "attendance_rules_deduction_per_day_check" CHECK (("deduction_per_day" >= (0)::numeric)),
    CONSTRAINT "attendance_rules_status_check" CHECK (("status" = ANY (ARRAY['hadir'::"text", 'izin'::"text", 'sakit'::"text", 'cuti'::"text", 'alpa'::"text"])))
);


ALTER TABLE "public"."attendance_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" bigint NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "table_name" "text" NOT NULL,
    "action" "text" NOT NULL,
    "row_id" "text",
    "changed" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "via" "text" DEFAULT 'manual'::"text",
    "employee_id" "uuid",
    CONSTRAINT "audit_logs_via_check" CHECK ((("via" IS NULL) OR ("via" = ANY (ARRAY['manual'::"text", 'ai'::"text"]))))
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


ALTER TABLE "public"."audit_logs" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."audit_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."auth_rate_limits" (
    "bucket" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "hits" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."auth_rate_limits" OWNER TO "postgres";


COMMENT ON TABLE "public"."auth_rate_limits" IS 'Penghitung rate limit endpoint auth. Hanya ditulis lewat rate_limit_hit() dari Edge Function (service role).';



CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "direction" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "categories_direction_check" CHECK (("direction" = ANY (ARRAY['in'::"text", 'out'::"text"])))
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categorization_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "keyword" "text" NOT NULL,
    "category" "text" NOT NULL,
    "direction" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "categorization_rules_direction_check" CHECK (("direction" = ANY (ARRAY['in'::"text", 'out'::"text"])))
);


ALTER TABLE "public"."categorization_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."channels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "value" "text" NOT NULL,
    "label" "text" NOT NULL,
    "icon" "text" DEFAULT '🏷️'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."channels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."commodity_prices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_date" "date" NOT NULL,
    "commodity_key" "text" NOT NULL,
    "variant_name" "text" NOT NULL,
    "is_group" boolean DEFAULT false NOT NULL,
    "price" numeric(14,2) NOT NULL,
    "prev_price" numeric(14,2),
    "price_date" "date",
    "unit" "text" DEFAULT 'Rp/kg'::"text" NOT NULL,
    "source_name" "text" DEFAULT 'PIHPS Bank Indonesia'::"text" NOT NULL,
    "source_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "province_id" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."commodity_prices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text",
    "email" "text",
    "address" "text",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deleted_accounts" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "email_hash" "text" NOT NULL,
    "email_mask" "text",
    "business_type" "text",
    "account_created_at" timestamp with time zone,
    "deleted_by" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "data_summary" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "deleted_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."deleted_accounts" OWNER TO "postgres";


ALTER TABLE "public"."deleted_accounts" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."deleted_accounts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."employees" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "role" "text",
    "phone" "text",
    "salary_type" "text" DEFAULT 'bulanan'::"text" NOT NULL,
    "salary_amount" numeric DEFAULT 0 NOT NULL,
    "join_date" "date",
    "status" "text" DEFAULT 'aktif'::"text" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "employees_salary_amount_check" CHECK (("salary_amount" >= (0)::numeric)),
    CONSTRAINT "employees_salary_type_check" CHECK (("salary_type" = ANY (ARRAY['bulanan'::"text", 'harian'::"text"]))),
    CONSTRAINT "employees_status_check" CHECK (("status" = ANY (ARRAY['aktif'::"text", 'nonaktif'::"text"])))
);


ALTER TABLE "public"."employees" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."error_logs" (
    "id" bigint NOT NULL,
    "sidik" "text" NOT NULL,
    "pertama_pada" timestamp with time zone DEFAULT "now"() NOT NULL,
    "terakhir_pada" timestamp with time zone DEFAULT "now"() NOT NULL,
    "jumlah" integer DEFAULT 1 NOT NULL,
    "sumber" "text" DEFAULT 'frontend'::"text" NOT NULL,
    "fitur" "text" DEFAULT 'tidak diketahui'::"text" NOT NULL,
    "halaman" "text",
    "aksi" "text",
    "konteks" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "tingkat" "text" DEFAULT 'error'::"text" NOT NULL,
    "kode" "text",
    "pesan" "text" NOT NULL,
    "jejak" "text",
    "user_id" "uuid",
    "email" "text",
    "workspace_id" "uuid",
    "user_agent" "text",
    "status" "text" DEFAULT 'baru'::"text" NOT NULL,
    "catatan_admin" "text"
);


ALTER TABLE "public"."error_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."error_logs" IS 'Jejak error & bug seluruh sistem (frontend, Edge Function, cron). Dibaca tab Log Error di admin dashboard. Ditulis lewat catat_error(); dibaca HANYA oleh admin.';



COMMENT ON COLUMN "public"."error_logs"."sidik" IS 'Fingerprint penggabung. Kejadian berulang menaikkan `jumlah`, bukan menambah baris.';



COMMENT ON COLUMN "public"."error_logs"."status" IS 'baru | ditangani | diabaikan. Baris yang muncul lagi setelah "ditangani" otomatis kembali ke "baru" — perbaikan yang gagal harus terlihat.';



CREATE SEQUENCE IF NOT EXISTS "public"."error_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."error_logs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."error_logs_id_seq" OWNED BY "public"."error_logs"."id";



CREATE TABLE IF NOT EXISTS "public"."exchange_rates" (
    "rate_date" "date" NOT NULL,
    "usd_idr" numeric(14,4) NOT NULL,
    "source" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."exchange_rates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "author_name" "text",
    "rating" integer,
    "category" "text" DEFAULT 'saran'::"text" NOT NULL,
    "message" "text" NOT NULL,
    "helped" boolean,
    "status" "text" DEFAULT 'baru'::"text" NOT NULL,
    "admin_reply" "text",
    "replied_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "feedback_category_check" CHECK (("category" = ANY (ARRAY['saran'::"text", 'bug'::"text", 'pujian'::"text", 'pertanyaan'::"text", 'lainnya'::"text"]))),
    CONSTRAINT "feedback_message_check" CHECK ((("char_length"("message") >= 1) AND ("char_length"("message") <= 4000))),
    CONSTRAINT "feedback_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5))),
    CONSTRAINT "feedback_status_check" CHECK (("status" = ANY (ARRAY['baru'::"text", 'dibaca'::"text", 'ditindaklanjuti'::"text", 'selesai'::"text"])))
);


ALTER TABLE "public"."feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ingredients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" DEFAULT 'bahan'::"text" NOT NULL,
    "unit" "text" DEFAULT 'gram'::"text" NOT NULL,
    "price_per_unit" numeric(14,4) DEFAULT 0 NOT NULL,
    "price_source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "commodity_key" "text",
    "import_exposure" "text" DEFAULT 'rendah'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "pack_size" numeric DEFAULT 0 NOT NULL,
    "pack_price" numeric DEFAULT 0 NOT NULL,
    "source_product_id" "uuid",
    CONSTRAINT "ingredients_import_exposure_check" CHECK (("import_exposure" = ANY (ARRAY['tinggi'::"text", 'sedang'::"text", 'rendah'::"text"]))),
    CONSTRAINT "ingredients_price_source_check" CHECK (("price_source" = ANY (ARRAY['manual'::"text", 'struk'::"text", 'estimasi_ai'::"text"]))),
    CONSTRAINT "ingredients_type_check" CHECK (("type" = ANY (ARRAY['bahan'::"text", 'kemasan'::"text", 'energi'::"text", 'tenaga'::"text", 'lainnya'::"text"])))
);


ALTER TABLE "public"."ingredients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kpi_bonus_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "min_score" numeric NOT NULL,
    "bonus" numeric DEFAULT 0 NOT NULL,
    "deduction" numeric DEFAULT 0 NOT NULL,
    "label" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "kpi_bonus_rules_bonus_check" CHECK (("bonus" >= (0)::numeric)),
    CONSTRAINT "kpi_bonus_rules_deduction_check" CHECK (("deduction" >= (0)::numeric)),
    CONSTRAINT "kpi_bonus_rules_min_score_check" CHECK ((("min_score" >= (0)::numeric) AND ("min_score" <= (100)::numeric)))
);


ALTER TABLE "public"."kpi_bonus_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kpi_criteria" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "weight" numeric DEFAULT 0 NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "kpi_criteria_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'kehadiran'::"text", 'tugas'::"text"]))),
    CONSTRAINT "kpi_criteria_weight_check" CHECK ((("weight" >= (0)::numeric) AND ("weight" <= (100)::numeric)))
);


ALTER TABLE "public"."kpi_criteria" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kpi_scores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "criteria_id" "uuid" NOT NULL,
    "period" "text" NOT NULL,
    "score" numeric DEFAULT 0 NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "kpi_scores_score_check" CHECK ((("score" >= (0)::numeric) AND ("score" <= (100)::numeric)))
);


ALTER TABLE "public"."kpi_scores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."legal_docs" (
    "slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."legal_docs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."macro_config" (
    "month" "text" NOT NULL,
    "inflation_yoy" numeric(6,2),
    "inflation_food_yoy" numeric(6,2),
    "note" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."macro_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."macro_runs" (
    "run_date" "date" NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "detail" "text",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "ai_status" "text",
    "ai_detail" "text",
    "ai_model" "text",
    "ai_tokens" integer
);


ALTER TABLE "public"."macro_runs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."macro_runs"."ai_status" IS 'ok | kosong | gagal. "kosong" = model menjawab tapi JSON tidak terpakai; "gagal" = panggilan tidak pernah berhasil. Dibedakan karena penanganannya berbeda.';



COMMENT ON COLUMN "public"."macro_runs"."ai_detail" IS 'Sebab teknis apa adanya (kode error, HTTP status, model). Untuk admin, bukan pengguna.';



CREATE TABLE IF NOT EXISTS "public"."macro_signals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_date" "date" NOT NULL,
    "commodity_key" "text" NOT NULL,
    "commodity_label" "text" NOT NULL,
    "direction" "text" DEFAULT 'stabil'::"text" NOT NULL,
    "est_pct_min" numeric(6,2) DEFAULT 0 NOT NULL,
    "est_pct_max" numeric(6,2) DEFAULT 0 NOT NULL,
    "confidence" "text" DEFAULT 'rendah'::"text" NOT NULL,
    "drivers" "jsonb",
    "sources" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ai_status" "text",
    CONSTRAINT "macro_signals_confidence_check" CHECK (("confidence" = ANY (ARRAY['rendah'::"text", 'sedang'::"text", 'tinggi'::"text"]))),
    CONSTRAINT "macro_signals_direction_check" CHECK (("direction" = ANY (ARRAY['naik'::"text", 'turun'::"text", 'stabil'::"text"])))
);


ALTER TABLE "public"."macro_signals" OWNER TO "postgres";


COMMENT ON COLUMN "public"."macro_signals"."ai_status" IS 'Provenance baris ini. "ok" = arah & estimasi benar-benar dari Gemini. Selain itu = nilai bawaan, WAJIB tidak ditampilkan sebagai perkiraan di UI.';



CREATE TABLE IF NOT EXISTS "public"."payrolls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "period" "text" NOT NULL,
    "base_amount" numeric DEFAULT 0 NOT NULL,
    "bonus" numeric DEFAULT 0 NOT NULL,
    "deduction" numeric DEFAULT 0 NOT NULL,
    "total" numeric DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "paid_at" timestamp with time zone,
    "txn_id" "uuid",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payrolls_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'paid'::"text"])))
);


ALTER TABLE "public"."payrolls" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_boms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "ingredient_id" "uuid" NOT NULL,
    "qty_per_unit" numeric(14,4) DEFAULT 0 NOT NULL,
    "is_ai_estimated" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cost_basis" "text" DEFAULT 'per_unit'::"text" NOT NULL,
    "period_amount" numeric DEFAULT 0 NOT NULL,
    "period_output" numeric DEFAULT 0 NOT NULL,
    "deduct_stock" boolean DEFAULT false NOT NULL,
    CONSTRAINT "product_boms_cost_basis_check" CHECK (("cost_basis" = ANY (ARRAY['per_unit'::"text", 'per_periode'::"text"])))
);


ALTER TABLE "public"."product_boms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."product_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "sku" "text",
    "category" "text",
    "unit" "text" DEFAULT 'pcs'::"text" NOT NULL,
    "stock" numeric(14,2) DEFAULT 0 NOT NULL,
    "min_stock" numeric(14,2) DEFAULT 0 NOT NULL,
    "price" numeric(14,2) DEFAULT 0 NOT NULL,
    "supplier_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cost_price" numeric(14,2) DEFAULT 0 NOT NULL,
    "kind" "text" DEFAULT 'jual'::"text" NOT NULL,
    "pack_size" numeric DEFAULT 0 NOT NULL,
    "content_unit" "text",
    "opened_used" numeric DEFAULT 0 NOT NULL,
    "has_bom" boolean DEFAULT false NOT NULL,
    "description" "text",
    "image_url" "text",
    CONSTRAINT "products_kind_check" CHECK (("kind" = ANY (ARRAY['jual'::"text", 'bahan'::"text"])))
);


ALTER TABLE "public"."products" OWNER TO "postgres";


COMMENT ON COLUMN "public"."products"."image_url" IS 'URL publik foto produk di bucket product-images. Path objeknya berpola <user_id>/<uuid>.<ext> (lihat uploadProductImage di src/lib/api.js).';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "business_name" "text",
    "owner_name" "text",
    "business_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "phone" "text",
    "phone_verified" boolean DEFAULT false NOT NULL,
    "taxpayer_type" "text" DEFAULT 'pribadi'::"text" NOT NULL,
    "accepted_terms" boolean DEFAULT false NOT NULL,
    "accepted_terms_at" timestamp with time zone,
    "accepted_privacy" boolean DEFAULT false NOT NULL,
    "accepted_privacy_at" timestamp with time zone,
    "terms_version" "text",
    "business_address" "text",
    "logo_url" "text",
    "invoice_server_label" "text",
    "invoice_server_value" "text",
    "invoice_show_server" boolean DEFAULT false NOT NULL,
    "invoice_tax_percent" numeric(5,2) DEFAULT 0 NOT NULL,
    "invoice_service_percent" numeric(5,2) DEFAULT 0 NOT NULL,
    CONSTRAINT "profiles_taxpayer_type_check" CHECK (("taxpayer_type" = ANY (ARRAY['pribadi'::"text", 'badan'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "po_number" "text" NOT NULL,
    "supplier_id" "uuid",
    "product_id" "uuid" NOT NULL,
    "qty" numeric NOT NULL,
    "unit_price" numeric DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "expected_date" "date",
    "note" "text",
    "txn_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "approved_at" timestamp with time zone,
    "received_at" timestamp with time zone,
    CONSTRAINT "purchase_orders_qty_check" CHECK (("qty" > (0)::numeric)),
    CONSTRAINT "purchase_orders_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'approved'::"text", 'received'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "purchase_orders_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."purchase_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "note" "text",
    "remind_at" timestamp with time zone NOT NULL,
    "wa_number" "text",
    "status" "text" DEFAULT 'aktif'::"text" NOT NULL,
    "dismissed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reminders_status_check" CHECK (("status" = ANY (ARRAY['aktif'::"text", 'selesai'::"text"])))
);


ALTER TABLE "public"."reminders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_targets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "amount" numeric(14,2),
    "start_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "deadline" "date",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revenue_target" numeric(14,2),
    "profit_target" numeric(14,2),
    CONSTRAINT "sales_targets_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "sales_targets_has_goal_check" CHECK ((("revenue_target" IS NOT NULL) OR ("profit_target" IS NOT NULL) OR ("amount" IS NOT NULL)))
);


ALTER TABLE "public"."sales_targets" OWNER TO "postgres";


ALTER TABLE "public"."security_incidents" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."security_incidents_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."staff_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "member_id" "uuid",
    "role" "text" DEFAULT 'staf'::"text" NOT NULL,
    "modules" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "status" "text" DEFAULT 'invited'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "declined_at" timestamp with time zone,
    "name" "text",
    CONSTRAINT "staff_members_name_len_check" CHECK ((("name" IS NULL) OR ("char_length"("name") <= 60))),
    CONSTRAINT "staff_members_role_check" CHECK (("role" = 'staf'::"text")),
    CONSTRAINT "staff_members_status_check" CHECK (("status" = ANY (ARRAY['invited'::"text", 'active'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."staff_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "transaction_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "stock_delta" numeric DEFAULT 0 NOT NULL,
    "opened_used_delta" numeric DEFAULT 0 NOT NULL,
    "asal" "text" DEFAULT 'langsung'::"text" NOT NULL,
    "dibalik_pada" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stock_movements_asal_check" CHECK (("asal" = ANY (ARRAY['langsung'::"text", 'bom'::"text"])))
);


ALTER TABLE "public"."stock_movements" OWNER TO "postgres";


COMMENT ON TABLE "public"."stock_movements" IS 'Buku mutasi stok: satu baris per pergerakan yang benar-benar terjadi, disimpan sebagai SELISIH. Dipakai untuk membalik stok saat transaksi dibatalkan, dan sebagai riwayat "kenapa stok berubah". Hanya ditulis oleh fungsi SECURITY DEFINER.';



CREATE TABLE IF NOT EXISTS "public"."stock_opnames" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "opname_number" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "note" "text",
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "posted_at" timestamp with time zone,
    CONSTRAINT "stock_opnames_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'posted'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."stock_opnames" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."suppliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text",
    "email" "text",
    "address" "text",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."suppliers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "note" "text",
    "status" "text" DEFAULT 'antre'::"text" NOT NULL,
    "priority" "text" DEFAULT 'normal'::"text" NOT NULL,
    "due_date" "date",
    "assignee_id" "uuid",
    "done_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tasks_priority_check" CHECK (("priority" = ANY (ARRAY['rendah'::"text", 'normal'::"text", 'tinggi'::"text"]))),
    CONSTRAINT "tasks_status_check" CHECK (("status" = ANY (ARRAY['antre'::"text", 'dikerjakan'::"text", 'selesai'::"text"])))
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "description" "text" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "direction" "text" NOT NULL,
    "category" "text" DEFAULT 'Lain-lain'::"text" NOT NULL,
    "channel" "text" DEFAULT 'manual'::"text" NOT NULL,
    "source_ref" "text",
    "raw" "text",
    "is_duplicate" boolean DEFAULT false NOT NULL,
    "dismissed_dup" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "receipt_url" "text",
    "payment_status" "text" DEFAULT 'lunas'::"text" NOT NULL,
    "customer_name" "text",
    "customer_contact" "text",
    "product_id" "uuid",
    "qty" numeric(14,2),
    "due_date" "date",
    "customer_id" "uuid",
    "supplier_id" "uuid",
    "import_confidence" "text",
    "status" "text" DEFAULT 'aktif'::"text" NOT NULL,
    "dibatalkan_pada" timestamp with time zone,
    "dibatalkan_oleh" "uuid",
    "alasan_batal" "text",
    CONSTRAINT "transactions_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "transactions_direction_check" CHECK (("direction" = ANY (ARRAY['in'::"text", 'out'::"text"]))),
    CONSTRAINT "transactions_import_confidence_check" CHECK ((("import_confidence" IS NULL) OR ("import_confidence" = ANY (ARRAY['tinggi'::"text", 'sedang'::"text", 'rendah'::"text"])))),
    CONSTRAINT "transactions_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['lunas'::"text", 'belum'::"text"]))),
    CONSTRAINT "transactions_status_check" CHECK (("status" = ANY (ARRAY['aktif'::"text", 'batal'::"text"])))
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."transactions"."import_confidence" IS 'Keyakinan deteksi kolom biaya saat impor laporan marketplace (task C3). NULL untuk transaksi manual, impor bank, dan baris sebelum fitur ini ada.';



COMMENT ON COLUMN "public"."transactions"."status" IS 'aktif | batal. Transaksi TIDAK PERNAH dihapus — nomor nota yang lenyap merusak jejak audit keuangan. Baris batal wajib dikecualikan dari setiap laporan, dashboard, dan pembacaan AI.';



CREATE TABLE IF NOT EXISTS "public"."units" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."units" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_baseline" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "margin_perceived" numeric(5,2),
    "hours_monthly" numeric(6,2),
    "channels_count" integer,
    "fees_known" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_baseline_channels_check" CHECK ((("channels_count" IS NULL) OR (("channels_count" >= 0) AND ("channels_count" <= 50)))),
    CONSTRAINT "user_baseline_hours_check" CHECK ((("hours_monthly" IS NULL) OR (("hours_monthly" >= (0)::numeric) AND ("hours_monthly" <= (744)::numeric)))),
    CONSTRAINT "user_baseline_margin_check" CHECK ((("margin_perceived" IS NULL) OR (("margin_perceived" >= ('-100'::integer)::numeric) AND ("margin_perceived" <= (100)::numeric))))
);


ALTER TABLE "public"."user_baseline" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."voice_sessions" (
    "workspace_id" "uuid" NOT NULL,
    "holder_id" "uuid" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."voice_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspace_ai_usage" (
    "workspace_id" "uuid" NOT NULL,
    "feature" "text" NOT NULL,
    "day" "date" NOT NULL,
    "count" integer DEFAULT 0 NOT NULL,
    "seconds_used" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "prompt_tokens" bigint DEFAULT 0 NOT NULL,
    "completion_tokens" bigint DEFAULT 0 NOT NULL,
    "thinking_tokens" bigint DEFAULT 0 NOT NULL,
    "total_tokens" bigint DEFAULT 0 NOT NULL,
    "wasted_tokens" bigint DEFAULT 0 NOT NULL,
    "last_model" "text",
    "credits_used" numeric(12,2) DEFAULT 0 NOT NULL,
    "credits_estimated" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."workspace_ai_usage" OWNER TO "postgres";


COMMENT ON COLUMN "public"."workspace_ai_usage"."thinking_tokens" IS 'Token "thinking" ditagih Google walau tidak satu huruf pun sampai ke pengguna. Dipisah karena pernah memakan habis maxOutputTokens di makro-harian sehingga JSON terpotong dan seluruh sinyal jatuh ke "stabil" tanpa satu error pun muncul.';



COMMENT ON COLUMN "public"."workspace_ai_usage"."credits_used" IS 'Kredit yang DIBEKUKAN pada tarif saat commit. Perubahan tarif TIDAK PERNAH menghitung ulang baris lampau: tagihan yang berubah sendiri setelah diterbitkan adalah cara tercepat kehilangan kepercayaan pelanggan.';



ALTER TABLE ONLY "auth"."refresh_tokens" ALTER COLUMN "id" SET DEFAULT "nextval"('"auth"."refresh_tokens_id_seq"'::"regclass");



ALTER TABLE ONLY "ops"."service_heartbeat" ALTER COLUMN "id" SET DEFAULT "nextval"('"ops"."service_heartbeat_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."error_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."error_logs_id_seq"'::"regclass");



ALTER TABLE ONLY "auth"."mfa_amr_claims"
    ADD CONSTRAINT "amr_id_pk" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."audit_log_entries"
    ADD CONSTRAINT "audit_log_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."custom_oauth_providers"
    ADD CONSTRAINT "custom_oauth_providers_identifier_key" UNIQUE ("identifier");



ALTER TABLE ONLY "auth"."custom_oauth_providers"
    ADD CONSTRAINT "custom_oauth_providers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."flow_state"
    ADD CONSTRAINT "flow_state_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."identities"
    ADD CONSTRAINT "identities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."identities"
    ADD CONSTRAINT "identities_provider_id_provider_unique" UNIQUE ("provider_id", "provider");



ALTER TABLE ONLY "auth"."instances"
    ADD CONSTRAINT "instances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."mfa_amr_claims"
    ADD CONSTRAINT "mfa_amr_claims_session_id_authentication_method_pkey" UNIQUE ("session_id", "authentication_method");



ALTER TABLE ONLY "auth"."mfa_challenges"
    ADD CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."mfa_factors"
    ADD CONSTRAINT "mfa_factors_last_challenged_at_key" UNIQUE ("last_challenged_at");



ALTER TABLE ONLY "auth"."mfa_factors"
    ADD CONSTRAINT "mfa_factors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."mfa_recovery_code_sets"
    ADD CONSTRAINT "mfa_recovery_code_sets_mfa_factor_id_key" UNIQUE ("mfa_factor_id");



ALTER TABLE ONLY "auth"."mfa_recovery_code_sets"
    ADD CONSTRAINT "mfa_recovery_code_sets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."mfa_recovery_code_sets"
    ADD CONSTRAINT "mfa_recovery_code_sets_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "auth"."mfa_recovery_codes"
    ADD CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."oauth_authorizations"
    ADD CONSTRAINT "oauth_authorizations_authorization_code_key" UNIQUE ("authorization_code");



ALTER TABLE ONLY "auth"."oauth_authorizations"
    ADD CONSTRAINT "oauth_authorizations_authorization_id_key" UNIQUE ("authorization_id");



ALTER TABLE ONLY "auth"."oauth_authorizations"
    ADD CONSTRAINT "oauth_authorizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."oauth_client_states"
    ADD CONSTRAINT "oauth_client_states_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."oauth_clients"
    ADD CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."oauth_consents"
    ADD CONSTRAINT "oauth_consents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."oauth_consents"
    ADD CONSTRAINT "oauth_consents_user_client_unique" UNIQUE ("user_id", "client_id");



ALTER TABLE ONLY "auth"."one_time_tokens"
    ADD CONSTRAINT "one_time_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_token_unique" UNIQUE ("token");



ALTER TABLE ONLY "auth"."saml_providers"
    ADD CONSTRAINT "saml_providers_entity_id_key" UNIQUE ("entity_id");



ALTER TABLE ONLY "auth"."saml_providers"
    ADD CONSTRAINT "saml_providers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."saml_relay_states"
    ADD CONSTRAINT "saml_relay_states_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."schema_migrations"
    ADD CONSTRAINT "schema_migrations_pkey" PRIMARY KEY ("version");



ALTER TABLE ONLY "auth"."scim_tokens"
    ADD CONSTRAINT "scim_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."scim_users"
    ADD CONSTRAINT "scim_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."sso_domains"
    ADD CONSTRAINT "sso_domains_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."sso_providers"
    ADD CONSTRAINT "sso_providers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."users"
    ADD CONSTRAINT "users_phone_key" UNIQUE ("phone");



ALTER TABLE ONLY "auth"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."webauthn_challenges"
    ADD CONSTRAINT "webauthn_challenges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "auth"."webauthn_credentials"
    ADD CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "ops"."service_config"
    ADD CONSTRAINT "service_config_pkey" PRIMARY KEY ("kunci");



ALTER TABLE ONLY "ops"."service_heartbeat"
    ADD CONSTRAINT "service_heartbeat_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_audit_log"
    ADD CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_quota_actions"
    ADD CONSTRAINT "admin_quota_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admins"
    ADD CONSTRAINT "admins_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."ai_activity_log"
    ADD CONSTRAINT "ai_activity_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_credit_rates"
    ADD CONSTRAINT "ai_credit_rates_pkey" PRIMARY KEY ("feature", "effective_from");



ALTER TABLE ONLY "public"."ai_feature_defaults"
    ADD CONSTRAINT "ai_feature_defaults_pkey" PRIMARY KEY ("feature");



ALTER TABLE ONLY "public"."ai_insights"
    ADD CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_insights"
    ADD CONSTRAINT "ai_insights_user_id_insight_date_kind_key" UNIQUE ("user_id", "insight_date", "kind");



ALTER TABLE ONLY "public"."ai_model_prices"
    ADD CONSTRAINT "ai_model_prices_pkey" PRIMARY KEY ("model", "effective_from");



ALTER TABLE ONLY "public"."ai_plans"
    ADD CONSTRAINT "ai_plans_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."ai_usage"
    ADD CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("user_id", "day", "kind");



ALTER TABLE ONLY "public"."app_events"
    ADD CONSTRAINT "app_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_employee_id_date_key" UNIQUE ("employee_id", "date");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance_rules"
    ADD CONSTRAINT "attendance_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance_rules"
    ADD CONSTRAINT "attendance_rules_user_id_status_key" UNIQUE ("user_id", "status");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auth_rate_limits"
    ADD CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("bucket", "subject", "window_start");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_user_id_name_direction_key" UNIQUE ("user_id", "name", "direction");



ALTER TABLE ONLY "public"."categorization_rules"
    ADD CONSTRAINT "categorization_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."channels"
    ADD CONSTRAINT "channels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."channels"
    ADD CONSTRAINT "channels_user_id_value_key" UNIQUE ("user_id", "value");



ALTER TABLE ONLY "public"."commodity_prices"
    ADD CONSTRAINT "commodity_prices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deleted_accounts"
    ADD CONSTRAINT "deleted_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_tenant_key" UNIQUE ("user_id", "id");



ALTER TABLE ONLY "public"."error_logs"
    ADD CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."error_logs"
    ADD CONSTRAINT "error_logs_sidik_key" UNIQUE ("sidik");



ALTER TABLE ONLY "public"."exchange_rates"
    ADD CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("rate_date");



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ingredients"
    ADD CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ingredients"
    ADD CONSTRAINT "ingredients_tenant_key" UNIQUE ("user_id", "id");



ALTER TABLE ONLY "public"."kpi_bonus_rules"
    ADD CONSTRAINT "kpi_bonus_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kpi_criteria"
    ADD CONSTRAINT "kpi_criteria_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kpi_criteria"
    ADD CONSTRAINT "kpi_criteria_tenant_key" UNIQUE ("user_id", "id");



ALTER TABLE ONLY "public"."kpi_scores"
    ADD CONSTRAINT "kpi_scores_employee_id_criteria_id_period_key" UNIQUE ("employee_id", "criteria_id", "period");



ALTER TABLE ONLY "public"."kpi_scores"
    ADD CONSTRAINT "kpi_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legal_docs"
    ADD CONSTRAINT "legal_docs_pkey" PRIMARY KEY ("slug");



ALTER TABLE ONLY "public"."macro_config"
    ADD CONSTRAINT "macro_config_pkey" PRIMARY KEY ("month");



ALTER TABLE ONLY "public"."macro_runs"
    ADD CONSTRAINT "macro_runs_pkey" PRIMARY KEY ("run_date");



ALTER TABLE ONLY "public"."macro_signals"
    ADD CONSTRAINT "macro_signals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."macro_signals"
    ADD CONSTRAINT "macro_signals_run_date_commodity_key_key" UNIQUE ("run_date", "commodity_key");



ALTER TABLE ONLY "public"."payrolls"
    ADD CONSTRAINT "payrolls_employee_id_period_key" UNIQUE ("employee_id", "period");



ALTER TABLE ONLY "public"."payrolls"
    ADD CONSTRAINT "payrolls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_boms"
    ADD CONSTRAINT "product_boms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_boms"
    ADD CONSTRAINT "product_boms_product_id_ingredient_id_key" UNIQUE ("product_id", "ingredient_id");



ALTER TABLE ONLY "public"."product_categories"
    ADD CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_categories"
    ADD CONSTRAINT "product_categories_user_id_name_key" UNIQUE ("user_id", "name");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_tenant_key" UNIQUE ("user_id", "id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_targets"
    ADD CONSTRAINT "sales_targets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."security_incidents"
    ADD CONSTRAINT "security_incidents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."security_incidents"
    ADD CONSTRAINT "security_incidents_ref_key" UNIQUE ("ref");



ALTER TABLE ONLY "public"."staff_members"
    ADD CONSTRAINT "staff_members_owner_id_email_key" UNIQUE ("owner_id", "email");



ALTER TABLE ONLY "public"."staff_members"
    ADD CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_opnames"
    ADD CONSTRAINT "stock_opnames_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_tenant_key" UNIQUE ("user_id", "id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_tenant_key" UNIQUE ("user_id", "id");



ALTER TABLE ONLY "public"."units"
    ADD CONSTRAINT "units_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."units"
    ADD CONSTRAINT "units_user_id_name_key" UNIQUE ("user_id", "name");



ALTER TABLE ONLY "public"."user_baseline"
    ADD CONSTRAINT "user_baseline_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."voice_sessions"
    ADD CONSTRAINT "voice_sessions_pkey" PRIMARY KEY ("workspace_id");



ALTER TABLE ONLY "public"."workspace_ai_policy"
    ADD CONSTRAINT "workspace_ai_policy_pkey" PRIMARY KEY ("workspace_id");



ALTER TABLE ONLY "public"."workspace_ai_usage"
    ADD CONSTRAINT "workspace_ai_usage_pkey" PRIMARY KEY ("workspace_id", "feature", "day");



CREATE INDEX "audit_logs_instance_id_idx" ON "auth"."audit_log_entries" USING "btree" ("instance_id");



CREATE UNIQUE INDEX "confirmation_token_idx" ON "auth"."users" USING "btree" ("confirmation_token") WHERE (("confirmation_token")::"text" !~ '^[0-9 ]*$'::"text");



CREATE INDEX "custom_oauth_providers_created_at_idx" ON "auth"."custom_oauth_providers" USING "btree" ("created_at");



CREATE INDEX "custom_oauth_providers_enabled_idx" ON "auth"."custom_oauth_providers" USING "btree" ("enabled");



CREATE INDEX "custom_oauth_providers_identifier_idx" ON "auth"."custom_oauth_providers" USING "btree" ("identifier");



CREATE INDEX "custom_oauth_providers_provider_type_idx" ON "auth"."custom_oauth_providers" USING "btree" ("provider_type");



CREATE UNIQUE INDEX "email_change_token_current_idx" ON "auth"."users" USING "btree" ("email_change_token_current") WHERE (("email_change_token_current")::"text" !~ '^[0-9 ]*$'::"text");



CREATE UNIQUE INDEX "email_change_token_new_idx" ON "auth"."users" USING "btree" ("email_change_token_new") WHERE (("email_change_token_new")::"text" !~ '^[0-9 ]*$'::"text");



CREATE INDEX "factor_id_created_at_idx" ON "auth"."mfa_factors" USING "btree" ("user_id", "created_at");



CREATE INDEX "flow_state_created_at_idx" ON "auth"."flow_state" USING "btree" ("created_at" DESC);



CREATE INDEX "identities_email_idx" ON "auth"."identities" USING "btree" ("email" "text_pattern_ops");



COMMENT ON INDEX "auth"."identities_email_idx" IS 'Auth: Ensures indexed queries on the email column';



CREATE INDEX "identities_user_id_idx" ON "auth"."identities" USING "btree" ("user_id");



CREATE INDEX "idx_auth_code" ON "auth"."flow_state" USING "btree" ("auth_code");



CREATE INDEX "idx_oauth_client_states_created_at" ON "auth"."oauth_client_states" USING "btree" ("created_at");



CREATE INDEX "idx_user_id_auth_method" ON "auth"."flow_state" USING "btree" ("user_id", "authentication_method");



CREATE INDEX "idx_users_created_at_desc" ON "auth"."users" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_users_email" ON "auth"."users" USING "btree" ("email");



CREATE INDEX "idx_users_last_sign_in_at_desc" ON "auth"."users" USING "btree" ("last_sign_in_at" DESC);



CREATE INDEX "idx_users_name" ON "auth"."users" USING "btree" ((("raw_user_meta_data" ->> 'name'::"text"))) WHERE (("raw_user_meta_data" ->> 'name'::"text") IS NOT NULL);



CREATE INDEX "mfa_challenge_created_at_idx" ON "auth"."mfa_challenges" USING "btree" ("created_at" DESC);



CREATE UNIQUE INDEX "mfa_factors_user_friendly_name_unique" ON "auth"."mfa_factors" USING "btree" ("friendly_name", "user_id") WHERE (TRIM(BOTH FROM "friendly_name") <> ''::"text");



CREATE INDEX "mfa_factors_user_id_idx" ON "auth"."mfa_factors" USING "btree" ("user_id");



CREATE INDEX "mfa_recovery_codes_set_id_idx" ON "auth"."mfa_recovery_codes" USING "btree" ("mfa_recovery_code_set_id");



CREATE INDEX "oauth_auth_pending_exp_idx" ON "auth"."oauth_authorizations" USING "btree" ("expires_at") WHERE ("status" = 'pending'::"auth"."oauth_authorization_status");



CREATE INDEX "oauth_clients_deleted_at_idx" ON "auth"."oauth_clients" USING "btree" ("deleted_at");



CREATE INDEX "oauth_consents_active_client_idx" ON "auth"."oauth_consents" USING "btree" ("client_id") WHERE ("revoked_at" IS NULL);



CREATE INDEX "oauth_consents_active_user_client_idx" ON "auth"."oauth_consents" USING "btree" ("user_id", "client_id") WHERE ("revoked_at" IS NULL);



CREATE INDEX "oauth_consents_user_order_idx" ON "auth"."oauth_consents" USING "btree" ("user_id", "granted_at" DESC);



CREATE INDEX "one_time_tokens_relates_to_hash_idx" ON "auth"."one_time_tokens" USING "hash" ("relates_to");



CREATE INDEX "one_time_tokens_token_hash_hash_idx" ON "auth"."one_time_tokens" USING "hash" ("token_hash");



CREATE UNIQUE INDEX "one_time_tokens_user_id_token_type_key" ON "auth"."one_time_tokens" USING "btree" ("user_id", "token_type");



CREATE UNIQUE INDEX "reauthentication_token_idx" ON "auth"."users" USING "btree" ("reauthentication_token") WHERE (("reauthentication_token")::"text" !~ '^[0-9 ]*$'::"text");



CREATE UNIQUE INDEX "recovery_token_idx" ON "auth"."users" USING "btree" ("recovery_token") WHERE (("recovery_token")::"text" !~ '^[0-9 ]*$'::"text");



CREATE INDEX "refresh_tokens_instance_id_idx" ON "auth"."refresh_tokens" USING "btree" ("instance_id");



CREATE INDEX "refresh_tokens_instance_id_user_id_idx" ON "auth"."refresh_tokens" USING "btree" ("instance_id", "user_id");



CREATE INDEX "refresh_tokens_parent_idx" ON "auth"."refresh_tokens" USING "btree" ("parent");



CREATE INDEX "refresh_tokens_session_id_revoked_idx" ON "auth"."refresh_tokens" USING "btree" ("session_id", "revoked");



CREATE INDEX "refresh_tokens_updated_at_idx" ON "auth"."refresh_tokens" USING "btree" ("updated_at" DESC);



CREATE INDEX "saml_providers_sso_provider_id_idx" ON "auth"."saml_providers" USING "btree" ("sso_provider_id");



CREATE INDEX "saml_relay_states_created_at_idx" ON "auth"."saml_relay_states" USING "btree" ("created_at" DESC);



CREATE INDEX "saml_relay_states_for_email_idx" ON "auth"."saml_relay_states" USING "btree" ("for_email");



CREATE INDEX "saml_relay_states_sso_provider_id_idx" ON "auth"."saml_relay_states" USING "btree" ("sso_provider_id");



CREATE INDEX "scim_tokens_expires_at_idx" ON "auth"."scim_tokens" USING "btree" ("expires_at");



CREATE INDEX "scim_tokens_revoked_at_idx" ON "auth"."scim_tokens" USING "btree" ("revoked_at");



CREATE INDEX "scim_tokens_sso_provider_id_idx" ON "auth"."scim_tokens" USING "btree" ("sso_provider_id");



CREATE UNIQUE INDEX "scim_tokens_token_hash_key" ON "auth"."scim_tokens" USING "btree" ("token_hash");



CREATE INDEX "scim_users_created_at_idx" ON "auth"."scim_users" USING "btree" ("sso_provider_id", "created_at", "id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "scim_users_deleted_at_idx" ON "auth"."scim_users" USING "btree" ("deleted_at");



CREATE UNIQUE INDEX "scim_users_external_id_key" ON "auth"."scim_users" USING "btree" ("sso_provider_id", "external_id") WHERE (("external_id" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE INDEX "scim_users_id_idx" ON "auth"."scim_users" USING "btree" ("sso_provider_id", "id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "scim_users_sso_provider_id_idx" ON "auth"."scim_users" USING "btree" ("sso_provider_id");



CREATE INDEX "scim_users_updated_at_idx" ON "auth"."scim_users" USING "btree" ("sso_provider_id", "updated_at", "id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "scim_users_user_id_idx" ON "auth"."scim_users" USING "btree" ("user_id");



CREATE INDEX "scim_users_user_name_idx" ON "auth"."scim_users" USING "btree" ("sso_provider_id", "user_name" COLLATE "C", "id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "scim_users_user_name_key" ON "auth"."scim_users" USING "btree" ("sso_provider_id", "user_name") WHERE ("deleted_at" IS NULL);



CREATE INDEX "sessions_not_after_idx" ON "auth"."sessions" USING "btree" ("not_after" DESC);



CREATE INDEX "sessions_oauth_client_id_idx" ON "auth"."sessions" USING "btree" ("oauth_client_id");



CREATE INDEX "sessions_user_id_idx" ON "auth"."sessions" USING "btree" ("user_id");



CREATE UNIQUE INDEX "sso_domains_domain_idx" ON "auth"."sso_domains" USING "btree" ("lower"("domain"));



CREATE INDEX "sso_domains_sso_provider_id_idx" ON "auth"."sso_domains" USING "btree" ("sso_provider_id");



CREATE UNIQUE INDEX "sso_providers_resource_id_idx" ON "auth"."sso_providers" USING "btree" ("lower"("resource_id"));



CREATE INDEX "sso_providers_resource_id_pattern_idx" ON "auth"."sso_providers" USING "btree" ("resource_id" "text_pattern_ops");



CREATE UNIQUE INDEX "unique_phone_factor_per_user" ON "auth"."mfa_factors" USING "btree" ("user_id", "phone");



CREATE INDEX "user_id_created_at_idx" ON "auth"."sessions" USING "btree" ("user_id", "created_at");



CREATE UNIQUE INDEX "users_email_partial_key" ON "auth"."users" USING "btree" ("email") WHERE ("is_sso_user" = false);



COMMENT ON INDEX "auth"."users_email_partial_key" IS 'Auth: A partial unique index that applies only when is_sso_user is false';



CREATE INDEX "users_instance_id_email_idx" ON "auth"."users" USING "btree" ("instance_id", "lower"(("email")::"text"));



CREATE INDEX "users_instance_id_idx" ON "auth"."users" USING "btree" ("instance_id");



CREATE INDEX "users_is_anonymous_idx" ON "auth"."users" USING "btree" ("is_anonymous");



CREATE INDEX "webauthn_challenges_expires_at_idx" ON "auth"."webauthn_challenges" USING "btree" ("expires_at");



CREATE INDEX "webauthn_challenges_user_id_idx" ON "auth"."webauthn_challenges" USING "btree" ("user_id");



CREATE UNIQUE INDEX "webauthn_credentials_credential_id_key" ON "auth"."webauthn_credentials" USING "btree" ("credential_id");



CREATE INDEX "webauthn_credentials_user_id_idx" ON "auth"."webauthn_credentials" USING "btree" ("user_id");



CREATE INDEX "service_heartbeat_beat_at_idx" ON "ops"."service_heartbeat" USING "btree" ("beat_at" DESC);



CREATE INDEX "app_events_type_idx" ON "public"."app_events" USING "btree" ("type", "created_at" DESC);



CREATE INDEX "app_events_user_idx" ON "public"."app_events" USING "btree" ("user_id");



CREATE INDEX "commodity_prices_run_idx" ON "public"."commodity_prices" USING "btree" ("run_date" DESC);



CREATE UNIQUE INDEX "commodity_prices_run_variant_prov_key" ON "public"."commodity_prices" USING "btree" ("run_date", "variant_name", "province_id");



CREATE UNIQUE INDEX "customers_tenant_key" ON "public"."customers" USING "btree" ("user_id", "id");



CREATE INDEX "customers_user_name_idx" ON "public"."customers" USING "btree" ("user_id", "lower"("name"));



CREATE UNIQUE INDEX "customers_user_phone_key" ON "public"."customers" USING "btree" ("user_id", "phone") WHERE ("phone" IS NOT NULL);



CREATE INDEX "error_logs_fitur_idx" ON "public"."error_logs" USING "btree" ("fitur", "terakhir_pada" DESC);



CREATE INDEX "error_logs_status_idx" ON "public"."error_logs" USING "btree" ("status", "terakhir_pada" DESC);



CREATE INDEX "error_logs_terakhir_idx" ON "public"."error_logs" USING "btree" ("terakhir_pada" DESC);



CREATE INDEX "feedback_created_idx" ON "public"."feedback" USING "btree" ("created_at" DESC);



CREATE INDEX "feedback_user_idx" ON "public"."feedback" USING "btree" ("user_id");



CREATE INDEX "idx_ai_activity_feature_time" ON "public"."ai_activity_log" USING "btree" ("feature", "created_at" DESC);



CREATE INDEX "idx_ai_activity_model_time" ON "public"."ai_activity_log" USING "btree" ("model", "created_at" DESC) WHERE ("model" IS NOT NULL);



CREATE INDEX "idx_ai_activity_outcome_time" ON "public"."ai_activity_log" USING "btree" ("outcome", "created_at" DESC) WHERE ("outcome" <> 'ok'::"text");



CREATE INDEX "idx_ai_activity_owner_created" ON "public"."ai_activity_log" USING "btree" ("owner_id", "created_at" DESC);



CREATE INDEX "idx_att_user_date" ON "public"."attendance" USING "btree" ("user_id", "date" DESC);



CREATE INDEX "idx_audit_created" ON "public"."admin_audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_owner_created" ON "public"."audit_logs" USING "btree" ("owner_id", "created_at" DESC);



CREATE INDEX "idx_audit_owner_employee" ON "public"."audit_logs" USING "btree" ("owner_id", "employee_id", "created_at" DESC) WHERE ("employee_id" IS NOT NULL);



CREATE INDEX "idx_auth_rate_limits_window" ON "public"."auth_rate_limits" USING "btree" ("window_start");



CREATE INDEX "idx_deleted_accounts_at" ON "public"."deleted_accounts" USING "btree" ("deleted_at" DESC);



CREATE INDEX "idx_deleted_accounts_hash" ON "public"."deleted_accounts" USING "btree" ("email_hash");



CREATE INDEX "idx_insiden_batas" ON "public"."security_incidents" USING "btree" ("batas_lapor");



CREATE INDEX "idx_insiden_status" ON "public"."security_incidents" USING "btree" ("status", "diketahui_pada" DESC);



CREATE INDEX "idx_kpis_user_period" ON "public"."kpi_scores" USING "btree" ("user_id", "period");



CREATE INDEX "idx_pay_user_period" ON "public"."payrolls" USING "btree" ("user_id", "period");



CREATE INDEX "idx_po_user_created" ON "public"."purchase_orders" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_quota_actions_created" ON "public"."admin_quota_actions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_quota_actions_ws" ON "public"."admin_quota_actions" USING "btree" ("workspace_id", "created_at" DESC);



CREATE INDEX "idx_reminders_user_status" ON "public"."reminders" USING "btree" ("user_id", "status", "remind_at");



CREATE INDEX "idx_so_user_created" ON "public"."stock_opnames" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_staff_members_email_lower" ON "public"."staff_members" USING "btree" ("lower"("email"));



CREATE INDEX "idx_staff_members_member_status" ON "public"."staff_members" USING "btree" ("member_id", "status");



CREATE INDEX "idx_tasks_user_status" ON "public"."tasks" USING "btree" ("user_id", "status", "created_at" DESC);



CREATE INDEX "idx_tx_unpaid" ON "public"."transactions" USING "btree" ("user_id", "payment_status") WHERE ("payment_status" = 'belum'::"text");



CREATE INDEX "ingredients_source_product_idx" ON "public"."ingredients" USING "btree" ("source_product_id");



CREATE INDEX "ingredients_user_idx" ON "public"."ingredients" USING "btree" ("user_id");



CREATE INDEX "macro_signals_date_idx" ON "public"."macro_signals" USING "btree" ("run_date" DESC);



CREATE INDEX "product_boms_product_idx" ON "public"."product_boms" USING "btree" ("product_id");



CREATE INDEX "product_boms_user_idx" ON "public"."product_boms" USING "btree" ("user_id");



CREATE INDEX "products_kind_idx" ON "public"."products" USING "btree" ("user_id", "kind");



CREATE INDEX "products_user_idx" ON "public"."products" USING "btree" ("user_id");



CREATE UNIQUE INDEX "profiles_phone_unique" ON "public"."profiles" USING "btree" ("phone") WHERE ("phone" IS NOT NULL);



CREATE INDEX "sales_targets_active_idx" ON "public"."sales_targets" USING "btree" ("user_id", "is_active", "created_at" DESC);



CREATE UNIQUE INDEX "sales_targets_one_active_idx" ON "public"."sales_targets" USING "btree" ("user_id") WHERE "is_active";



CREATE INDEX "sales_targets_user_idx" ON "public"."sales_targets" USING "btree" ("user_id");



CREATE INDEX "stock_movements_produk_idx" ON "public"."stock_movements" USING "btree" ("user_id", "product_id", "created_at" DESC);



CREATE INDEX "stock_movements_transaksi_idx" ON "public"."stock_movements" USING "btree" ("user_id", "transaction_id");



CREATE INDEX "suppliers_user_idx" ON "public"."suppliers" USING "btree" ("user_id");



CREATE INDEX "transactions_aktif_idx" ON "public"."transactions" USING "btree" ("user_id", "occurred_at" DESC) WHERE ("status" = 'aktif'::"text");



CREATE INDEX "transactions_customer_idx" ON "public"."transactions" USING "btree" ("user_id", "customer_id") WHERE ("customer_id" IS NOT NULL);



CREATE INDEX "transactions_low_confidence_idx" ON "public"."transactions" USING "btree" ("user_id", "occurred_at") WHERE ("import_confidence" = 'rendah'::"text");



CREATE INDEX "transactions_supplier_idx" ON "public"."transactions" USING "btree" ("user_id", "supplier_id");



CREATE INDEX "transactions_unpaid_idx" ON "public"."transactions" USING "btree" ("user_id") WHERE ("payment_status" = 'belum'::"text");



CREATE INDEX "transactions_user_date_idx" ON "public"."transactions" USING "btree" ("user_id", "occurred_at" DESC);



CREATE UNIQUE INDEX "user_baseline_user_uniq" ON "public"."user_baseline" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();



CREATE OR REPLACE TRIGGER "audit_attendance" AFTER INSERT OR DELETE OR UPDATE ON "public"."attendance" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit"();



CREATE OR REPLACE TRIGGER "audit_attendance_rules" AFTER INSERT OR DELETE OR UPDATE ON "public"."attendance_rules" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit"();



CREATE OR REPLACE TRIGGER "audit_customers" AFTER INSERT OR DELETE OR UPDATE ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit"();



CREATE OR REPLACE TRIGGER "audit_employees" AFTER INSERT OR DELETE OR UPDATE ON "public"."employees" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit"();



CREATE OR REPLACE TRIGGER "audit_kpi_bonus_rules" AFTER INSERT OR DELETE OR UPDATE ON "public"."kpi_bonus_rules" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit"();



CREATE OR REPLACE TRIGGER "audit_kpi_scores" AFTER INSERT OR DELETE OR UPDATE ON "public"."kpi_scores" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit"();



CREATE OR REPLACE TRIGGER "audit_payrolls" AFTER INSERT OR DELETE OR UPDATE ON "public"."payrolls" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit"();



CREATE OR REPLACE TRIGGER "audit_tasks" AFTER INSERT OR DELETE OR UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."log_audit"();



CREATE OR REPLACE TRIGGER "feedback_author_trg" BEFORE INSERT ON "public"."feedback" FOR EACH ROW EXECUTE FUNCTION "public"."feedback_set_author"();



CREATE OR REPLACE TRIGGER "trg_balikkan_stok" BEFORE UPDATE OF "status" ON "public"."transactions" FOR EACH ROW EXECUTE FUNCTION "public"."balikkan_stok_transaksi"();



CREATE OR REPLACE TRIGGER "trg_insiden_batas" BEFORE INSERT OR UPDATE ON "public"."security_incidents" FOR EACH ROW EXECUTE FUNCTION "public"."insiden_hitung_batas"();



CREATE OR REPLACE TRIGGER "trg_seat_limit" AFTER INSERT ON "public"."staff_members" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_seat_limit"();



CREATE OR REPLACE TRIGGER "trg_staff_members_guard" BEFORE INSERT OR UPDATE OF "email" ON "public"."staff_members" FOR EACH ROW EXECUTE FUNCTION "public"."staff_members_guard"();



CREATE OR REPLACE TRIGGER "trg_staff_members_name_guard" BEFORE UPDATE OF "name" ON "public"."staff_members" FOR EACH ROW EXECUTE FUNCTION "public"."staff_members_name_guard"();



CREATE OR REPLACE TRIGGER "trg_stock_opnames_items_guard" BEFORE INSERT OR UPDATE OF "items", "user_id" ON "public"."stock_opnames" FOR EACH ROW EXECUTE FUNCTION "public"."stock_opnames_items_guard"();



CREATE OR REPLACE TRIGGER "trg_tolak_hapus_transaksi" BEFORE DELETE ON "public"."transactions" FOR EACH ROW EXECUTE FUNCTION "public"."tolak_hapus_transaksi"();



ALTER TABLE ONLY "auth"."identities"
    ADD CONSTRAINT "identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."mfa_amr_claims"
    ADD CONSTRAINT "mfa_amr_claims_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."mfa_challenges"
    ADD CONSTRAINT "mfa_challenges_auth_factor_id_fkey" FOREIGN KEY ("factor_id") REFERENCES "auth"."mfa_factors"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."mfa_factors"
    ADD CONSTRAINT "mfa_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."mfa_recovery_code_sets"
    ADD CONSTRAINT "mfa_recovery_code_sets_mfa_factor_id_fkey" FOREIGN KEY ("mfa_factor_id") REFERENCES "auth"."mfa_factors"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."mfa_recovery_code_sets"
    ADD CONSTRAINT "mfa_recovery_code_sets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."mfa_recovery_codes"
    ADD CONSTRAINT "mfa_recovery_codes_mfa_recovery_code_set_id_fkey" FOREIGN KEY ("mfa_recovery_code_set_id") REFERENCES "auth"."mfa_recovery_code_sets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."oauth_authorizations"
    ADD CONSTRAINT "oauth_authorizations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "auth"."oauth_clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."oauth_authorizations"
    ADD CONSTRAINT "oauth_authorizations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."oauth_consents"
    ADD CONSTRAINT "oauth_consents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "auth"."oauth_clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."oauth_consents"
    ADD CONSTRAINT "oauth_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."one_time_tokens"
    ADD CONSTRAINT "one_time_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."saml_providers"
    ADD CONSTRAINT "saml_providers_sso_provider_id_fkey" FOREIGN KEY ("sso_provider_id") REFERENCES "auth"."sso_providers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."saml_relay_states"
    ADD CONSTRAINT "saml_relay_states_flow_state_id_fkey" FOREIGN KEY ("flow_state_id") REFERENCES "auth"."flow_state"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."saml_relay_states"
    ADD CONSTRAINT "saml_relay_states_sso_provider_id_fkey" FOREIGN KEY ("sso_provider_id") REFERENCES "auth"."sso_providers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."scim_tokens"
    ADD CONSTRAINT "scim_tokens_sso_provider_id_fkey" FOREIGN KEY ("sso_provider_id") REFERENCES "auth"."sso_providers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."scim_users"
    ADD CONSTRAINT "scim_users_sso_provider_id_fkey" FOREIGN KEY ("sso_provider_id") REFERENCES "auth"."sso_providers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."scim_users"
    ADD CONSTRAINT "scim_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "auth"."sessions"
    ADD CONSTRAINT "sessions_oauth_client_id_fkey" FOREIGN KEY ("oauth_client_id") REFERENCES "auth"."oauth_clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."sessions"
    ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."sso_domains"
    ADD CONSTRAINT "sso_domains_sso_provider_id_fkey" FOREIGN KEY ("sso_provider_id") REFERENCES "auth"."sso_providers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."webauthn_challenges"
    ADD CONSTRAINT "webauthn_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "auth"."webauthn_credentials"
    ADD CONSTRAINT "webauthn_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admins"
    ADD CONSTRAINT "admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_insights"
    ADD CONSTRAINT "ai_insights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_events"
    ADD CONSTRAINT "app_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_employee_tenant_fkey" FOREIGN KEY ("user_id", "employee_id") REFERENCES "public"."employees"("user_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance_rules"
    ADD CONSTRAINT "attendance_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categorization_rules"
    ADD CONSTRAINT "categorization_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."channels"
    ADD CONSTRAINT "channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ingredients"
    ADD CONSTRAINT "ingredients_source_product_tenant_fkey" FOREIGN KEY ("user_id", "source_product_id") REFERENCES "public"."products"("user_id", "id") ON DELETE SET NULL ("source_product_id");



ALTER TABLE ONLY "public"."ingredients"
    ADD CONSTRAINT "ingredients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kpi_bonus_rules"
    ADD CONSTRAINT "kpi_bonus_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kpi_criteria"
    ADD CONSTRAINT "kpi_criteria_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kpi_scores"
    ADD CONSTRAINT "kpi_scores_criteria_tenant_fkey" FOREIGN KEY ("user_id", "criteria_id") REFERENCES "public"."kpi_criteria"("user_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kpi_scores"
    ADD CONSTRAINT "kpi_scores_employee_tenant_fkey" FOREIGN KEY ("user_id", "employee_id") REFERENCES "public"."employees"("user_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kpi_scores"
    ADD CONSTRAINT "kpi_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payrolls"
    ADD CONSTRAINT "payrolls_employee_tenant_fkey" FOREIGN KEY ("user_id", "employee_id") REFERENCES "public"."employees"("user_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payrolls"
    ADD CONSTRAINT "payrolls_txn_tenant_fkey" FOREIGN KEY ("user_id", "txn_id") REFERENCES "public"."transactions"("user_id", "id") ON DELETE SET NULL ("txn_id");



ALTER TABLE ONLY "public"."payrolls"
    ADD CONSTRAINT "payrolls_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_boms"
    ADD CONSTRAINT "product_boms_ingredient_tenant_fkey" FOREIGN KEY ("user_id", "ingredient_id") REFERENCES "public"."ingredients"("user_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_boms"
    ADD CONSTRAINT "product_boms_product_tenant_fkey" FOREIGN KEY ("user_id", "product_id") REFERENCES "public"."products"("user_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_boms"
    ADD CONSTRAINT "product_boms_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_categories"
    ADD CONSTRAINT "product_categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_supplier_tenant_fkey" FOREIGN KEY ("user_id", "supplier_id") REFERENCES "public"."suppliers"("user_id", "id") ON DELETE SET NULL ("supplier_id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_product_tenant_fkey" FOREIGN KEY ("user_id", "product_id") REFERENCES "public"."products"("user_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_supplier_tenant_fkey" FOREIGN KEY ("user_id", "supplier_id") REFERENCES "public"."suppliers"("user_id", "id") ON DELETE SET NULL ("supplier_id");



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_txn_tenant_fkey" FOREIGN KEY ("user_id", "txn_id") REFERENCES "public"."transactions"("user_id", "id") ON DELETE SET NULL ("txn_id");



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_targets"
    ADD CONSTRAINT "sales_targets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_members"
    ADD CONSTRAINT "staff_members_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."staff_members"
    ADD CONSTRAINT "staff_members_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_product_tenant_fkey" FOREIGN KEY ("user_id", "product_id") REFERENCES "public"."products"("user_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_transaction_tenant_fkey" FOREIGN KEY ("user_id", "transaction_id") REFERENCES "public"."transactions"("user_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_opnames"
    ADD CONSTRAINT "stock_opnames_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_assignee_tenant_fkey" FOREIGN KEY ("user_id", "assignee_id") REFERENCES "public"."employees"("user_id", "id") ON DELETE SET NULL ("assignee_id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_customer_tenant_fkey" FOREIGN KEY ("user_id", "customer_id") REFERENCES "public"."customers"("user_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_product_tenant_fkey" FOREIGN KEY ("user_id", "product_id") REFERENCES "public"."products"("user_id", "id") ON DELETE SET NULL ("product_id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_supplier_tenant_fkey" FOREIGN KEY ("user_id", "supplier_id") REFERENCES "public"."suppliers"("user_id", "id") ON DELETE SET NULL ("supplier_id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."units"
    ADD CONSTRAINT "units_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_baseline"
    ADD CONSTRAINT "user_baseline_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspace_ai_policy"
    ADD CONSTRAINT "workspace_ai_policy_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "public"."ai_plans"("code");



ALTER TABLE "auth"."audit_log_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "auth"."flow_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "auth"."identities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "auth"."instances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "auth"."mfa_amr_claims" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "auth"."mfa_challenges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "auth"."mfa_factors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "auth"."one_time_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "auth"."refresh_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "auth"."saml_providers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "auth"."saml_relay_states" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "auth"."schema_migrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "auth"."sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "auth"."sso_domains" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "auth"."sso_providers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "auth"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ops"."service_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "ops"."service_heartbeat" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin all categories" ON "public"."categories" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin all channels" ON "public"."channels" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin all customers" ON "public"."customers" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin all product_categories" ON "public"."product_categories" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin all products" ON "public"."products" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin all profiles" ON "public"."profiles" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin all rules" ON "public"."categorization_rules" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin all suppliers" ON "public"."suppliers" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin all transactions" ON "public"."transactions" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin all units" ON "public"."units" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin baca error_logs" ON "public"."error_logs" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "admin reads self" ON "public"."admins" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "admin ubah error_logs" ON "public"."error_logs" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin write macro_config" ON "public"."macro_config" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."admin_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_quota_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_activity_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_activity_owner_read" ON "public"."ai_activity_log" FOR SELECT USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "ai_activity_self_insert" ON "public"."ai_activity_log" FOR INSERT WITH CHECK ((("actor_id" = "auth"."uid"()) AND (("owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."staff_members" "m"
  WHERE (("m"."owner_id" = "ai_activity_log"."owner_id") AND ("m"."member_id" = "auth"."uid"()) AND ("m"."status" = 'active'::"text")))))));



ALTER TABLE "public"."ai_credit_rates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_feature_defaults" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_insights" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_model_prices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_usage" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_usage select own" ON "public"."ai_usage" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."app_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "att_own" ON "public"."attendance" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."attendance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."attendance_rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attrule_own" ON "public"."attendance_rules" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "audit admin insert" ON "public"."admin_audit_log" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() AND ("admin_id" = "auth"."uid"())));



CREATE POLICY "audit admin select" ON "public"."admin_audit_log" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_owner_read" ON "public"."audit_logs" FOR SELECT USING (("owner_id" = "auth"."uid"()));



ALTER TABLE "public"."auth_rate_limits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "baca mutasi stok" ON "public"."stock_movements" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."staff_members" "m"
  WHERE (("m"."owner_id" = "stock_movements"."user_id") AND ("m"."member_id" = "auth"."uid"()) AND ("m"."status" = 'active'::"text"))))));



ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."categorization_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."channels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commodity_prices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "credit rates read all" ON "public"."ai_credit_rates" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deleted accounts admin read" ON "public"."deleted_accounts" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



ALTER TABLE "public"."deleted_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "emp_own" ON "public"."employees" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."employees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."error_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "events admin read" ON "public"."app_events" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "events insert own" ON "public"."app_events" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."exchange_rates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feature defaults read all" ON "public"."ai_feature_defaults" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."feedback" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feedback admin all" ON "public"."feedback" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "feedback delete own" ON "public"."feedback" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "feedback insert own" ON "public"."feedback" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "feedback select own" ON "public"."feedback" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "incidents admin read" ON "public"."security_incidents" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



ALTER TABLE "public"."ingredients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kpi_bonus_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kpi_criteria" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kpi_scores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "kpib_own" ON "public"."kpi_bonus_rules" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "kpic_own" ON "public"."kpi_criteria" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "kpis_own" ON "public"."kpi_scores" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "legal admin write" ON "public"."legal_docs" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "legal read all" ON "public"."legal_docs" FOR SELECT USING (true);



ALTER TABLE "public"."legal_docs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."macro_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."macro_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."macro_signals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "own ai_insights" ON "public"."ai_insights" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own categories" ON "public"."categories" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own channels" ON "public"."channels" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own customers" ON "public"."customers" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own ingredients" ON "public"."ingredients" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own product_boms" ON "public"."product_boms" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own product_categories" ON "public"."product_categories" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own products" ON "public"."products" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own profile" ON "public"."profiles" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "own rules" ON "public"."categorization_rules" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own sales_targets" ON "public"."sales_targets" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own suppliers" ON "public"."suppliers" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own transactions" ON "public"."transactions" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own units" ON "public"."units" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own user_baseline" ON "public"."user_baseline" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "pay_own" ON "public"."payrolls" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."payrolls" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "plans read all" ON "public"."ai_plans" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "po_delete_own" ON "public"."purchase_orders" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "po_insert_own" ON "public"."purchase_orders" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "po_select_own" ON "public"."purchase_orders" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "po_update_own" ON "public"."purchase_orders" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "policy select own workspace" ON "public"."workspace_ai_policy" FOR SELECT TO "authenticated" USING ((("workspace_id" = "public"."ai_workspace_id"()) OR "public"."is_admin"()));



ALTER TABLE "public"."product_boms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "quota actions admin read" ON "public"."admin_quota_actions" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "read commodity_prices" ON "public"."commodity_prices" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read exchange_rates" ON "public"."exchange_rates" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read macro_config" ON "public"."macro_config" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read macro_runs" ON "public"."macro_runs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read macro_signals" ON "public"."macro_signals" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "rem_own" ON "public"."reminders" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_targets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."security_incidents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sm_member_select" ON "public"."staff_members" FOR SELECT USING (("member_id" = "auth"."uid"()));



CREATE POLICY "sm_owner_all" ON "public"."staff_members" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "so_delete_own" ON "public"."stock_opnames" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "so_insert_own" ON "public"."stock_opnames" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "so_select_own" ON "public"."stock_opnames" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "so_update_own" ON "public"."stock_opnames" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "staff_analisis" ON "public"."user_baseline" USING ("public"."has_access"("user_id", 'analisis'::"text")) WITH CHECK ("public"."has_access"("user_id", 'analisis'::"text"));



CREATE POLICY "staff_dashboard" ON "public"."ai_insights" USING ("public"."has_access"("user_id", 'dashboard'::"text")) WITH CHECK ("public"."has_access"("user_id", 'dashboard'::"text"));



CREATE POLICY "staff_dashboard" ON "public"."sales_targets" USING ("public"."has_access"("user_id", 'dashboard'::"text")) WITH CHECK ("public"."has_access"("user_id", 'dashboard'::"text"));



CREATE POLICY "staff_hr" ON "public"."attendance" USING ("public"."has_access"("user_id", 'hr'::"text")) WITH CHECK ("public"."has_access"("user_id", 'hr'::"text"));



CREATE POLICY "staff_hr" ON "public"."attendance_rules" USING ("public"."has_access"("user_id", 'hr'::"text")) WITH CHECK ("public"."has_access"("user_id", 'hr'::"text"));



CREATE POLICY "staff_hr" ON "public"."employees" USING ("public"."has_access"("user_id", 'hr'::"text")) WITH CHECK ("public"."has_access"("user_id", 'hr'::"text"));



CREATE POLICY "staff_hr" ON "public"."kpi_bonus_rules" USING ("public"."has_access"("user_id", 'hr'::"text")) WITH CHECK ("public"."has_access"("user_id", 'hr'::"text"));



CREATE POLICY "staff_hr" ON "public"."kpi_criteria" USING ("public"."has_access"("user_id", 'hr'::"text")) WITH CHECK ("public"."has_access"("user_id", 'hr'::"text"));



CREATE POLICY "staff_hr" ON "public"."kpi_scores" USING ("public"."has_access"("user_id", 'hr'::"text")) WITH CHECK ("public"."has_access"("user_id", 'hr'::"text"));



CREATE POLICY "staff_hr" ON "public"."payrolls" USING ("public"."has_access"("user_id", 'hr'::"text")) WITH CHECK ("public"."has_access"("user_id", 'hr'::"text"));



ALTER TABLE "public"."staff_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "staff_operasional" ON "public"."reminders" USING ("public"."has_access"("user_id", 'operasional'::"text")) WITH CHECK ("public"."has_access"("user_id", 'operasional'::"text"));



CREATE POLICY "staff_operasional" ON "public"."tasks" USING ("public"."has_access"("user_id", 'operasional'::"text")) WITH CHECK ("public"."has_access"("user_id", 'operasional'::"text"));



CREATE POLICY "staff_produk" ON "public"."ingredients" USING ("public"."has_access"("user_id", 'produk'::"text")) WITH CHECK ("public"."has_access"("user_id", 'produk'::"text"));



CREATE POLICY "staff_produk" ON "public"."product_boms" USING ("public"."has_access"("user_id", 'produk'::"text")) WITH CHECK ("public"."has_access"("user_id", 'produk'::"text"));



CREATE POLICY "staff_produk" ON "public"."product_categories" USING ("public"."has_access"("user_id", 'produk'::"text")) WITH CHECK ("public"."has_access"("user_id", 'produk'::"text"));



CREATE POLICY "staff_produk" ON "public"."products" USING ("public"."has_access"("user_id", 'produk'::"text")) WITH CHECK ("public"."has_access"("user_id", 'produk'::"text"));



CREATE POLICY "staff_produk" ON "public"."purchase_orders" USING ("public"."has_access"("user_id", 'produk'::"text")) WITH CHECK ("public"."has_access"("user_id", 'produk'::"text"));



CREATE POLICY "staff_produk" ON "public"."stock_opnames" USING ("public"."has_access"("user_id", 'produk'::"text")) WITH CHECK ("public"."has_access"("user_id", 'produk'::"text"));



CREATE POLICY "staff_produk" ON "public"."suppliers" USING ("public"."has_access"("user_id", 'produk'::"text")) WITH CHECK ("public"."has_access"("user_id", 'produk'::"text"));



CREATE POLICY "staff_produk" ON "public"."units" USING ("public"."has_access"("user_id", 'produk'::"text")) WITH CHECK ("public"."has_access"("user_id", 'produk'::"text"));



CREATE POLICY "staff_transaksi" ON "public"."categories" USING ("public"."has_access"("user_id", 'transaksi'::"text")) WITH CHECK ("public"."has_access"("user_id", 'transaksi'::"text"));



CREATE POLICY "staff_transaksi" ON "public"."categorization_rules" USING ("public"."has_access"("user_id", 'transaksi'::"text")) WITH CHECK ("public"."has_access"("user_id", 'transaksi'::"text"));



CREATE POLICY "staff_transaksi" ON "public"."channels" USING ("public"."has_access"("user_id", 'transaksi'::"text")) WITH CHECK ("public"."has_access"("user_id", 'transaksi'::"text"));



CREATE POLICY "staff_transaksi" ON "public"."customers" USING ("public"."has_access"("user_id", 'transaksi'::"text")) WITH CHECK ("public"."has_access"("user_id", 'transaksi'::"text"));



CREATE POLICY "staff_transaksi" ON "public"."transactions" USING ("public"."has_access"("user_id", 'transaksi'::"text")) WITH CHECK ("public"."has_access"("user_id", 'transaksi'::"text"));



ALTER TABLE "public"."stock_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_opnames" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."suppliers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_own" ON "public"."tasks" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."units" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_baseline" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."voice_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vs select own workspace" ON "public"."voice_sessions" FOR SELECT TO "authenticated" USING (("workspace_id" = "public"."ai_workspace_id"()));



CREATE POLICY "wau select own workspace" ON "public"."workspace_ai_usage" FOR SELECT TO "authenticated" USING ((("workspace_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."staff_members" "m"
  WHERE (("m"."owner_id" = "workspace_ai_usage"."workspace_id") AND ("m"."member_id" = "auth"."uid"()) AND ("m"."status" = 'active'::"text"))))));



ALTER TABLE "public"."workspace_ai_policy" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspace_ai_usage" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "auth" TO "anon";
GRANT USAGE ON SCHEMA "auth" TO "authenticated";
GRANT USAGE ON SCHEMA "auth" TO "service_role";
GRANT ALL ON SCHEMA "auth" TO "supabase_auth_admin";
GRANT ALL ON SCHEMA "auth" TO "dashboard_user";
GRANT USAGE ON SCHEMA "auth" TO "postgres";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT USAGE ON SCHEMA "ops" TO "service_role";



GRANT ALL ON FUNCTION "auth"."email"() TO "dashboard_user";



GRANT ALL ON FUNCTION "auth"."jwt"() TO "postgres";
GRANT ALL ON FUNCTION "auth"."jwt"() TO "dashboard_user";



GRANT ALL ON FUNCTION "auth"."role"() TO "dashboard_user";



GRANT ALL ON FUNCTION "auth"."uid"() TO "dashboard_user";



REVOKE ALL ON FUNCTION "ops"."panggil_keepalive"("p_sumber" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "ops"."pangkas_heartbeat"() FROM PUBLIC;
GRANT ALL ON FUNCTION "ops"."pangkas_heartbeat"() TO "service_role";



REVOKE ALL ON FUNCTION "ops"."ringkasan_kesehatan"() FROM PUBLIC;
GRANT ALL ON FUNCTION "ops"."ringkasan_kesehatan"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."accept_invitation"("p_invite_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_invitation"("p_invite_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."accept_invitation"("p_invite_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_invitation"("p_invite_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."accept_terms"("p_version" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."accept_terms"("p_version" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_terms"("p_version" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."add_transaction_with_stock"("p_tx" "jsonb", "p_lines" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_transaction_with_stock"("p_tx" "jsonb", "p_lines" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_transaction_with_stock"("p_tx" "jsonb", "p_lines" "jsonb", "p_owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_transaction_with_stock"("p_tx" "jsonb", "p_lines" "jsonb", "p_owner" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_transaction_with_stock"("p_tx" "jsonb", "p_lines" "jsonb", "p_owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin__jaga"("p_workspace" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin__jaga"("p_workspace" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin__jaga"("p_workspace" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."workspace_ai_policy" TO "anon";
GRANT ALL ON TABLE "public"."workspace_ai_policy" TO "authenticated";
GRANT ALL ON TABLE "public"."workspace_ai_policy" TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin__pastikan_policy"("p_workspace" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin__pastikan_policy"("p_workspace" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin__pastikan_policy"("p_workspace" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_adjust_credits"("p_workspace" "uuid", "p_delta" numeric, "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_adjust_credits"("p_workspace" "uuid", "p_delta" numeric, "p_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_adjust_credits"("p_workspace" "uuid", "p_delta" numeric, "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_adjust_credits"("p_workspace" "uuid", "p_delta" numeric, "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_ai_telemetry"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_ai_telemetry"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_ai_telemetry"("p_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_clear_daily_cap"("p_workspace" "uuid", "p_feature" "text", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_clear_daily_cap"("p_workspace" "uuid", "p_feature" "text", "p_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_clear_daily_cap"("p_workspace" "uuid", "p_feature" "text", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_clear_daily_cap"("p_workspace" "uuid", "p_feature" "text", "p_note" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_delete_user"("p_uid" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_delete_user"("p_uid" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_delete_user"("p_uid" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_error_ringkas"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_error_ringkas"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_error_ringkas"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_feature_cost_stats"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_feature_cost_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_feature_cost_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_feature_cost_stats"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_insiden_akun_terhapus"("p_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_insiden_akun_terhapus"("p_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_insiden_akun_terhapus"("p_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_insiden_akun_terhapus"("p_id" bigint) TO "service_role";



GRANT ALL ON TABLE "public"."security_incidents" TO "anon";
GRANT ALL ON TABLE "public"."security_incidents" TO "authenticated";
GRANT ALL ON TABLE "public"."security_incidents" TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_insiden_buat"("p_judul" "text", "p_ringkasan" "text", "p_kategori" "text", "p_tingkat" "text", "p_diketahui_pada" timestamp with time zone, "p_terjadi_mulai" timestamp with time zone, "p_terjadi_sampai" timestamp with time zone, "p_lingkup" "text", "p_kategori_data" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_insiden_buat"("p_judul" "text", "p_ringkasan" "text", "p_kategori" "text", "p_tingkat" "text", "p_diketahui_pada" timestamp with time zone, "p_terjadi_mulai" timestamp with time zone, "p_terjadi_sampai" timestamp with time zone, "p_lingkup" "text", "p_kategori_data" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_insiden_buat"("p_judul" "text", "p_ringkasan" "text", "p_kategori" "text", "p_tingkat" "text", "p_diketahui_pada" timestamp with time zone, "p_terjadi_mulai" timestamp with time zone, "p_terjadi_sampai" timestamp with time zone, "p_lingkup" "text", "p_kategori_data" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_insiden_buat"("p_judul" "text", "p_ringkasan" "text", "p_kategori" "text", "p_tingkat" "text", "p_diketahui_pada" timestamp with time zone, "p_terjadi_mulai" timestamp with time zone, "p_terjadi_sampai" timestamp with time zone, "p_lingkup" "text", "p_kategori_data" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_insiden_korban"("p_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_insiden_korban"("p_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_insiden_korban"("p_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_insiden_korban"("p_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_insiden_ringkas"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_insiden_ringkas"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_insiden_ringkas"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_insiden_ringkas"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_insiden_ubah"("p_id" bigint, "p_status" "text", "p_tingkat" "text", "p_ringkasan" "text", "p_tindakan" "text", "p_terjadi_mulai" timestamp with time zone, "p_terjadi_sampai" timestamp with time zone, "p_lingkup" "text", "p_kategori_data" "text"[], "p_jumlah_korban" integer, "p_lapor_otoritas_pada" timestamp with time zone, "p_lapor_otoritas_ref" "text", "p_lapor_korban_pada" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_insiden_ubah"("p_id" bigint, "p_status" "text", "p_tingkat" "text", "p_ringkasan" "text", "p_tindakan" "text", "p_terjadi_mulai" timestamp with time zone, "p_terjadi_sampai" timestamp with time zone, "p_lingkup" "text", "p_kategori_data" "text"[], "p_jumlah_korban" integer, "p_lapor_otoritas_pada" timestamp with time zone, "p_lapor_otoritas_ref" "text", "p_lapor_korban_pada" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_insiden_ubah"("p_id" bigint, "p_status" "text", "p_tingkat" "text", "p_ringkasan" "text", "p_tindakan" "text", "p_terjadi_mulai" timestamp with time zone, "p_terjadi_sampai" timestamp with time zone, "p_lingkup" "text", "p_kategori_data" "text"[], "p_jumlah_korban" integer, "p_lapor_otoritas_pada" timestamp with time zone, "p_lapor_otoritas_ref" "text", "p_lapor_korban_pada" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_insiden_ubah"("p_id" bigint, "p_status" "text", "p_tingkat" "text", "p_ringkasan" "text", "p_tindakan" "text", "p_terjadi_mulai" timestamp with time zone, "p_terjadi_sampai" timestamp with time zone, "p_lingkup" "text", "p_kategori_data" "text"[], "p_jumlah_korban" integer, "p_lapor_otoritas_pada" timestamp with time zone, "p_lapor_otoritas_ref" "text", "p_lapor_korban_pada" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_jejak_akun"("p_uid" "uuid", "p_sejak" timestamp with time zone, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_jejak_akun"("p_uid" "uuid", "p_sejak" timestamp with time zone, "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_jejak_akun"("p_uid" "uuid", "p_sejak" timestamp with time zone, "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_jejak_akun"("p_uid" "uuid", "p_sejak" timestamp with time zone, "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_list_ai_quota"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_ai_quota"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_ai_quota"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_ai_quota"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_list_insiden"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_insiden"("p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_insiden"("p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_insiden"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_list_model_prices"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_model_prices"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_model_prices"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_model_prices"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_list_quota_actions"("p_workspace" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_quota_actions"("p_workspace" "uuid", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_quota_actions"("p_workspace" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_quota_actions"("p_workspace" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_list_users"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_list_users"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_users"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_metrics"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_metrics"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_metrics"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_quota_overview"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_quota_overview"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_quota_overview"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_ai_suspended"("p_workspace" "uuid", "p_suspended" boolean, "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_ai_suspended"("p_workspace" "uuid", "p_suspended" boolean, "p_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_set_ai_suspended"("p_workspace" "uuid", "p_suspended" boolean, "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_ai_suspended"("p_workspace" "uuid", "p_suspended" boolean, "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_credit_override"("p_workspace" "uuid", "p_credits" numeric, "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_credit_override"("p_workspace" "uuid", "p_credits" numeric, "p_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_set_credit_override"("p_workspace" "uuid", "p_credits" numeric, "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_credit_override"("p_workspace" "uuid", "p_credits" numeric, "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_daily_cap"("p_workspace" "uuid", "p_feature" "text", "p_cap" integer, "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_daily_cap"("p_workspace" "uuid", "p_feature" "text", "p_cap" integer, "p_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_set_daily_cap"("p_workspace" "uuid", "p_feature" "text", "p_cap" integer, "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_daily_cap"("p_workspace" "uuid", "p_feature" "text", "p_cap" integer, "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_model_price"("p_model" "text", "p_input_usd" numeric, "p_output_usd" numeric, "p_berlaku" "date", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_model_price"("p_model" "text", "p_input_usd" numeric, "p_output_usd" numeric, "p_berlaku" "date", "p_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_set_model_price"("p_model" "text", "p_input_usd" numeric, "p_output_usd" numeric, "p_berlaku" "date", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_model_price"("p_model" "text", "p_input_usd" numeric, "p_output_usd" numeric, "p_berlaku" "date", "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_plan"("p_workspace" "uuid", "p_plan_code" "text", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_plan"("p_workspace" "uuid", "p_plan_code" "text", "p_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_set_plan"("p_workspace" "uuid", "p_plan_code" "text", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_plan"("p_workspace" "uuid", "p_plan_code" "text", "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_token_cap"("p_workspace" "uuid", "p_periode" "text", "p_tokens" bigint, "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_token_cap"("p_workspace" "uuid", "p_periode" "text", "p_tokens" bigint, "p_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_set_token_cap"("p_workspace" "uuid", "p_periode" "text", "p_tokens" bigint, "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_token_cap"("p_workspace" "uuid", "p_periode" "text", "p_tokens" bigint, "p_note" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."ai_credit_rate"("p_feature" "text", "p_on" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."ai_credit_rate"("p_feature" "text", "p_on" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_credit_rate"("p_feature" "text", "p_on" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."ai_cycle_start"("p_anchor" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."ai_cycle_start"("p_anchor" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_cycle_start"("p_anchor" integer) TO "service_role";



GRANT ALL ON TABLE "public"."ai_model_prices" TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_model_price"("p_model" "text", "p_on" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_model_price"("p_model" "text", "p_on" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_quota_check"("p_feature" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_quota_check"("p_feature" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."ai_quota_check"("p_feature" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_quota_check"("p_feature" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_quota_commit"("p_feature" "text", "p_units" integer, "p_prompt_tokens" integer, "p_completion_tokens" integer, "p_thinking_tokens" integer, "p_total_tokens" integer, "p_wasted_tokens" integer, "p_model" "text", "p_workspace" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_quota_commit"("p_feature" "text", "p_units" integer, "p_prompt_tokens" integer, "p_completion_tokens" integer, "p_thinking_tokens" integer, "p_total_tokens" integer, "p_wasted_tokens" integer, "p_model" "text", "p_workspace" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ai_quota_commit"("p_feature" "text", "p_units" integer, "p_prompt_tokens" integer, "p_completion_tokens" integer, "p_thinking_tokens" integer, "p_total_tokens" integer, "p_wasted_tokens" integer, "p_model" "text", "p_workspace" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_quota_commit"("p_feature" "text", "p_units" integer, "p_prompt_tokens" integer, "p_completion_tokens" integer, "p_thinking_tokens" integer, "p_total_tokens" integer, "p_wasted_tokens" integer, "p_model" "text", "p_workspace" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_quota_resolve"("p_feature" "text", "p_fallback_cap" integer, "p_workspace" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_quota_resolve"("p_feature" "text", "p_fallback_cap" integer, "p_workspace" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ai_quota_resolve"("p_feature" "text", "p_fallback_cap" integer, "p_workspace" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_quota_resolve"("p_feature" "text", "p_fallback_cap" integer, "p_workspace" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_scope_workspace"("p_workspace" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_scope_workspace"("p_workspace" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ai_scope_workspace"("p_workspace" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_scope_workspace"("p_workspace" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ai_seat_count"("p_owner" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ai_seat_count"("p_owner" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_seat_count"("p_owner" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ai_seat_limit"("p_owner" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ai_seat_limit"("p_owner" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_seat_limit"("p_owner" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ai_today_pacific"() TO "anon";
GRANT ALL ON FUNCTION "public"."ai_today_pacific"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_today_pacific"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_usd_range"("p_workspace" "uuid", "p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_usd_range"("p_workspace" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_workspace_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_workspace_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."ai_workspace_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_workspace_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."balikkan_stok_transaksi"() TO "anon";
GRANT ALL ON FUNCTION "public"."balikkan_stok_transaksi"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."balikkan_stok_transaksi"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."batalkan_transaksi"("p_id" "uuid", "p_alasan" "text", "p_owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."batalkan_transaksi"("p_id" "uuid", "p_alasan" "text", "p_owner" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."batalkan_transaksi"("p_id" "uuid", "p_alasan" "text", "p_owner" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."batalkan_transaksi"("p_id" "uuid", "p_alasan" "text", "p_owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."bump_ai_usage"("p_kind" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bump_ai_usage"("p_kind" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."bump_ai_usage"("p_kind" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."catat_error"("p_sidik" "text", "p_pesan" "text", "p_sumber" "text", "p_fitur" "text", "p_aksi" "text", "p_kode" "text", "p_tingkat" "text", "p_halaman" "text", "p_jejak" "text", "p_konteks" "jsonb", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."catat_error"("p_sidik" "text", "p_pesan" "text", "p_sumber" "text", "p_fitur" "text", "p_aksi" "text", "p_kode" "text", "p_tingkat" "text", "p_halaman" "text", "p_jejak" "text", "p_konteks" "jsonb", "p_user_agent" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."catat_error"("p_sidik" "text", "p_pesan" "text", "p_sumber" "text", "p_fitur" "text", "p_aksi" "text", "p_kode" "text", "p_tingkat" "text", "p_halaman" "text", "p_jejak" "text", "p_konteks" "jsonb", "p_user_agent" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."catat_error"("p_sidik" "text", "p_pesan" "text", "p_sumber" "text", "p_fitur" "text", "p_aksi" "text", "p_kode" "text", "p_tingkat" "text", "p_halaman" "text", "p_jejak" "text", "p_konteks" "jsonb", "p_user_agent" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_email_available"("p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_email_available"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_email_available"("p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_phone_available"("p_phone" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_phone_available"("p_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_phone_available"("p_phone" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."consume_bom_for_sale"("p_product_id" "uuid", "p_qty" numeric, "p_owner" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."consume_bom_for_sale"("p_product_id" "uuid", "p_qty" numeric, "p_owner" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."consume_bom_for_sale"("p_product_id" "uuid", "p_qty" numeric, "p_owner" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."consume_pack_stock"("p_product_id" "uuid", "p_need" numeric, "p_owner" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."consume_pack_stock"("p_product_id" "uuid", "p_need" numeric, "p_owner" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."consume_pack_stock"("p_product_id" "uuid", "p_need" numeric, "p_owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."decline_invitation"("p_invite_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decline_invitation"("p_invite_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."decline_invitation"("p_invite_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."decline_invitation"("p_invite_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."effective_owner"() TO "anon";
GRANT ALL ON FUNCTION "public"."effective_owner"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."effective_owner"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."email_terdaftar"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."email_terdaftar"("p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_free_seat_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_free_seat_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_free_seat_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_seat_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_seat_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_seat_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."feedback_set_author"() TO "anon";
GRANT ALL ON FUNCTION "public"."feedback_set_author"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."feedback_set_author"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."hapus_data_saya"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."hapus_data_saya"() TO "anon";
GRANT ALL ON FUNCTION "public"."hapus_data_saya"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."hapus_data_saya"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_access"("owner" "uuid", "module" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_access"("owner" "uuid", "module" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_access"("owner" "uuid", "module" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."hitung_baris_milik"("p_table" "text", "p_kolom" "text", "p_uid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."hitung_baris_milik"("p_table" "text", "p_kolom" "text", "p_uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."hitung_baris_milik"("p_table" "text", "p_kolom" "text", "p_uid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."insiden_hitung_batas"() TO "anon";
GRANT ALL ON FUNCTION "public"."insiden_hitung_batas"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."insiden_hitung_batas"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."insiden_ref_baru"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."insiden_ref_baru"() TO "anon";
GRANT ALL ON FUNCTION "public"."insiden_ref_baru"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_audit"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_audit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_audit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_ai_credits"("p_workspace" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_ai_credits"("p_workspace" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."my_ai_credits"("p_workspace" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_ai_credits"("p_workspace" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_modules"("p_owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_modules"("p_owner" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_modules"("p_owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_monthly_summary"("p_owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_monthly_summary"("p_owner" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_monthly_summary"("p_owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_pending_invitations"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_pending_invitations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_pending_invitations"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_workspaces"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_workspaces"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_workspaces"() TO "service_role";



GRANT ALL ON FUNCTION "public"."norm_phone_id"("p" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."norm_phone_id"("p" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."norm_phone_id"("p" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ops_catat_heartbeat"("p_sumber" "text", "p_sehat" boolean, "p_kesehatan" "jsonb", "p_catatan" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ops_catat_heartbeat"("p_sumber" "text", "p_sehat" boolean, "p_kesehatan" "jsonb", "p_catatan" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ops_ringkasan_kesehatan"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ops_ringkasan_kesehatan"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."ops_token"("p_kunci" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ops_token"("p_kunci" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."otp_attempt_fail"("p_bucket" "text", "p_subject" "text", "p_limit" integer, "p_window_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."otp_attempt_fail"("p_bucket" "text", "p_subject" "text", "p_limit" integer, "p_window_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."otp_attempt_fail"("p_bucket" "text", "p_subject" "text", "p_limit" integer, "p_window_seconds" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."otp_attempt_reset"("p_bucket" "text", "p_subject" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."otp_attempt_reset"("p_bucket" "text", "p_subject" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."otp_attempt_reset"("p_bucket" "text", "p_subject" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."otp_attempt_status"("p_bucket" "text", "p_subject" "text", "p_limit" integer, "p_window_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."otp_attempt_status"("p_bucket" "text", "p_subject" "text", "p_limit" integer, "p_window_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."otp_attempt_status"("p_bucket" "text", "p_subject" "text", "p_limit" integer, "p_window_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."pangkas_error_logs"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pangkas_error_logs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."post_stock_opname"("p_opname_id" "uuid", "p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."post_stock_opname"("p_opname_id" "uuid", "p_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."post_stock_opname"("p_opname_id" "uuid", "p_items" "jsonb", "p_owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."post_stock_opname"("p_opname_id" "uuid", "p_items" "jsonb", "p_owner" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."post_stock_opname"("p_opname_id" "uuid", "p_items" "jsonb", "p_owner" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."product_yield"("p_product_id" "uuid", "p_owner" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."product_yield"("p_product_id" "uuid", "p_owner" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."product_yield"("p_product_id" "uuid", "p_owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prune_auth_rate_limits"("p_older_than_hours" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prune_auth_rate_limits"("p_older_than_hours" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rate_limit_hit"("p_bucket" "text", "p_subject" "text", "p_limit" integer, "p_window_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rate_limit_hit"("p_bucket" "text", "p_subject" "text", "p_limit" integer, "p_window_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rate_limit_hit"("p_bucket" "text", "p_subject" "text", "p_limit" integer, "p_window_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rate_limit_hit"("p_bucket" "text", "p_subject" "text", "p_limit" integer, "p_window_seconds" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."receive_purchase_order"("p_po_id" "uuid", "p_create_expense" boolean, "p_category" "text", "p_payment_status" "text", "p_due_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."receive_purchase_order"("p_po_id" "uuid", "p_create_expense" boolean, "p_category" "text", "p_payment_status" "text", "p_due_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."receive_purchase_order"("p_po_id" "uuid", "p_create_expense" boolean, "p_category" "text", "p_payment_status" "text", "p_due_date" "date", "p_owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."receive_purchase_order"("p_po_id" "uuid", "p_create_expense" boolean, "p_category" "text", "p_payment_status" "text", "p_due_date" "date", "p_owner" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."receive_purchase_order"("p_po_id" "uuid", "p_create_expense" boolean, "p_category" "text", "p_payment_status" "text", "p_due_date" "date", "p_owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_owner"("p_owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_owner"("p_owner" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_owner"("p_owner" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_owner"("p_owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_lint"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_lint"() TO "service_role";



GRANT ALL ON FUNCTION "public"."staff_members_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."staff_members_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."staff_members_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."staff_members_name_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."staff_members_name_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."staff_members_name_guard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."stock_opnames_items_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."stock_opnames_items_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."stock_opnames_items_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tenancy_lint"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tenancy_lint"() TO "service_role";



GRANT ALL ON FUNCTION "public"."test_bom"() TO "anon";
GRANT ALL ON FUNCTION "public"."test_bom"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."test_bom"() TO "service_role";



GRANT ALL ON FUNCTION "public"."test_kolom_transaksi"() TO "anon";
GRANT ALL ON FUNCTION "public"."test_kolom_transaksi"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."test_kolom_transaksi"() TO "service_role";



GRANT ALL ON FUNCTION "public"."test_pembatalan"() TO "anon";
GRANT ALL ON FUNCTION "public"."test_pembatalan"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."test_pembatalan"() TO "service_role";



GRANT ALL ON FUNCTION "public"."test_semua"() TO "anon";
GRANT ALL ON FUNCTION "public"."test_semua"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."test_semua"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tolak_hapus_transaksi"() TO "anon";
GRANT ALL ON FUNCTION "public"."tolak_hapus_transaksi"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tolak_hapus_transaksi"() TO "service_role";



GRANT ALL ON FUNCTION "public"."topeng_email"("p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."topeng_email"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."topeng_email"("p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."uji_kasus"("p_suite" "text", "p_kasus" "text", "p_harap" "text", "p_aktual" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."uji_kasus"("p_suite" "text", "p_kasus" "text", "p_harap" "text", "p_aktual" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."uji_kasus"("p_suite" "text", "p_kasus" "text", "p_harap" "text", "p_aktual" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."voice_session_acquire"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."voice_session_acquire"() TO "anon";
GRANT ALL ON FUNCTION "public"."voice_session_acquire"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."voice_session_acquire"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."voice_session_release"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."voice_session_release"() TO "anon";
GRANT ALL ON FUNCTION "public"."voice_session_release"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."voice_session_release"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."voice_session_touch"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."voice_session_touch"() TO "anon";
GRANT ALL ON FUNCTION "public"."voice_session_touch"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."voice_session_touch"() TO "service_role";



GRANT ALL ON TABLE "auth"."audit_log_entries" TO "dashboard_user";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "auth"."audit_log_entries" TO "postgres";
GRANT SELECT ON TABLE "auth"."audit_log_entries" TO "postgres" WITH GRANT OPTION;



GRANT ALL ON TABLE "auth"."custom_oauth_providers" TO "postgres";
GRANT ALL ON TABLE "auth"."custom_oauth_providers" TO "dashboard_user";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "auth"."flow_state" TO "postgres";
GRANT SELECT ON TABLE "auth"."flow_state" TO "postgres" WITH GRANT OPTION;
GRANT ALL ON TABLE "auth"."flow_state" TO "dashboard_user";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "auth"."identities" TO "postgres";
GRANT SELECT ON TABLE "auth"."identities" TO "postgres" WITH GRANT OPTION;
GRANT ALL ON TABLE "auth"."identities" TO "dashboard_user";



GRANT ALL ON TABLE "auth"."instances" TO "dashboard_user";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "auth"."instances" TO "postgres";
GRANT SELECT ON TABLE "auth"."instances" TO "postgres" WITH GRANT OPTION;



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "auth"."mfa_amr_claims" TO "postgres";
GRANT SELECT ON TABLE "auth"."mfa_amr_claims" TO "postgres" WITH GRANT OPTION;
GRANT ALL ON TABLE "auth"."mfa_amr_claims" TO "dashboard_user";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "auth"."mfa_challenges" TO "postgres";
GRANT SELECT ON TABLE "auth"."mfa_challenges" TO "postgres" WITH GRANT OPTION;
GRANT ALL ON TABLE "auth"."mfa_challenges" TO "dashboard_user";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "auth"."mfa_factors" TO "postgres";
GRANT SELECT ON TABLE "auth"."mfa_factors" TO "postgres" WITH GRANT OPTION;
GRANT ALL ON TABLE "auth"."mfa_factors" TO "dashboard_user";



GRANT ALL ON TABLE "auth"."mfa_recovery_code_sets" TO "postgres";
GRANT ALL ON TABLE "auth"."mfa_recovery_code_sets" TO "dashboard_user";



GRANT ALL ON TABLE "auth"."mfa_recovery_codes" TO "postgres";
GRANT ALL ON TABLE "auth"."mfa_recovery_codes" TO "dashboard_user";



GRANT ALL ON TABLE "auth"."oauth_authorizations" TO "postgres";
GRANT ALL ON TABLE "auth"."oauth_authorizations" TO "dashboard_user";



GRANT ALL ON TABLE "auth"."oauth_client_states" TO "postgres";
GRANT ALL ON TABLE "auth"."oauth_client_states" TO "dashboard_user";



GRANT ALL ON TABLE "auth"."oauth_clients" TO "postgres";
GRANT ALL ON TABLE "auth"."oauth_clients" TO "dashboard_user";



GRANT ALL ON TABLE "auth"."oauth_consents" TO "postgres";
GRANT ALL ON TABLE "auth"."oauth_consents" TO "dashboard_user";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "auth"."one_time_tokens" TO "postgres";
GRANT SELECT ON TABLE "auth"."one_time_tokens" TO "postgres" WITH GRANT OPTION;
GRANT ALL ON TABLE "auth"."one_time_tokens" TO "dashboard_user";



GRANT ALL ON TABLE "auth"."refresh_tokens" TO "dashboard_user";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "auth"."refresh_tokens" TO "postgres";
GRANT SELECT ON TABLE "auth"."refresh_tokens" TO "postgres" WITH GRANT OPTION;



GRANT ALL ON SEQUENCE "auth"."refresh_tokens_id_seq" TO "dashboard_user";
GRANT ALL ON SEQUENCE "auth"."refresh_tokens_id_seq" TO "postgres";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "auth"."saml_providers" TO "postgres";
GRANT SELECT ON TABLE "auth"."saml_providers" TO "postgres" WITH GRANT OPTION;
GRANT ALL ON TABLE "auth"."saml_providers" TO "dashboard_user";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "auth"."saml_relay_states" TO "postgres";
GRANT SELECT ON TABLE "auth"."saml_relay_states" TO "postgres" WITH GRANT OPTION;
GRANT ALL ON TABLE "auth"."saml_relay_states" TO "dashboard_user";



GRANT SELECT ON TABLE "auth"."schema_migrations" TO "postgres" WITH GRANT OPTION;



GRANT ALL ON TABLE "auth"."scim_tokens" TO "postgres";
GRANT ALL ON TABLE "auth"."scim_tokens" TO "dashboard_user";



GRANT ALL ON TABLE "auth"."scim_users" TO "postgres";
GRANT ALL ON TABLE "auth"."scim_users" TO "dashboard_user";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "auth"."sessions" TO "postgres";
GRANT SELECT ON TABLE "auth"."sessions" TO "postgres" WITH GRANT OPTION;
GRANT ALL ON TABLE "auth"."sessions" TO "dashboard_user";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "auth"."sso_domains" TO "postgres";
GRANT SELECT ON TABLE "auth"."sso_domains" TO "postgres" WITH GRANT OPTION;
GRANT ALL ON TABLE "auth"."sso_domains" TO "dashboard_user";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "auth"."sso_providers" TO "postgres";
GRANT SELECT ON TABLE "auth"."sso_providers" TO "postgres" WITH GRANT OPTION;
GRANT ALL ON TABLE "auth"."sso_providers" TO "dashboard_user";



GRANT ALL ON TABLE "auth"."users" TO "dashboard_user";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "auth"."users" TO "postgres";
GRANT SELECT ON TABLE "auth"."users" TO "postgres" WITH GRANT OPTION;



GRANT ALL ON TABLE "auth"."webauthn_challenges" TO "postgres";
GRANT ALL ON TABLE "auth"."webauthn_challenges" TO "dashboard_user";



GRANT ALL ON TABLE "auth"."webauthn_credentials" TO "postgres";
GRANT ALL ON TABLE "auth"."webauthn_credentials" TO "dashboard_user";



GRANT ALL ON TABLE "ops"."service_config" TO "service_role";



GRANT ALL ON TABLE "ops"."service_heartbeat" TO "service_role";



GRANT ALL ON SEQUENCE "ops"."service_heartbeat_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "ops"."service_heartbeat_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "ops"."service_heartbeat_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."admin_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."admin_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_audit_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."admin_audit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."admin_audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."admin_audit_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."admin_quota_actions" TO "anon";
GRANT ALL ON TABLE "public"."admin_quota_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_quota_actions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."admin_quota_actions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."admin_quota_actions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."admin_quota_actions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."admins" TO "anon";
GRANT ALL ON TABLE "public"."admins" TO "authenticated";
GRANT ALL ON TABLE "public"."admins" TO "service_role";



GRANT ALL ON TABLE "public"."ai_activity_log" TO "anon";
GRANT ALL ON TABLE "public"."ai_activity_log" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_activity_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ai_activity_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ai_activity_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ai_activity_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ai_credit_rates" TO "anon";
GRANT ALL ON TABLE "public"."ai_credit_rates" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_credit_rates" TO "service_role";



GRANT ALL ON TABLE "public"."ai_feature_defaults" TO "anon";
GRANT ALL ON TABLE "public"."ai_feature_defaults" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_feature_defaults" TO "service_role";



GRANT ALL ON TABLE "public"."ai_insights" TO "anon";
GRANT ALL ON TABLE "public"."ai_insights" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_insights" TO "service_role";



GRANT ALL ON TABLE "public"."ai_plans" TO "anon";
GRANT ALL ON TABLE "public"."ai_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_plans" TO "service_role";



GRANT ALL ON TABLE "public"."ai_usage" TO "anon";
GRANT ALL ON TABLE "public"."ai_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_usage" TO "service_role";



GRANT ALL ON TABLE "public"."app_events" TO "anon";
GRANT ALL ON TABLE "public"."app_events" TO "authenticated";
GRANT ALL ON TABLE "public"."app_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."app_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."app_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."app_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."attendance" TO "anon";
GRANT ALL ON TABLE "public"."attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance" TO "service_role";



GRANT ALL ON TABLE "public"."attendance_rules" TO "anon";
GRANT ALL ON TABLE "public"."attendance_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance_rules" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."audit_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."audit_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."audit_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."auth_rate_limits" TO "anon";
GRANT ALL ON TABLE "public"."auth_rate_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."auth_rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."categories" TO "anon";
GRANT ALL ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";



GRANT ALL ON TABLE "public"."categorization_rules" TO "anon";
GRANT ALL ON TABLE "public"."categorization_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."categorization_rules" TO "service_role";



GRANT ALL ON TABLE "public"."channels" TO "anon";
GRANT ALL ON TABLE "public"."channels" TO "authenticated";
GRANT ALL ON TABLE "public"."channels" TO "service_role";



GRANT ALL ON TABLE "public"."commodity_prices" TO "anon";
GRANT ALL ON TABLE "public"."commodity_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."commodity_prices" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON TABLE "public"."deleted_accounts" TO "anon";
GRANT ALL ON TABLE "public"."deleted_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."deleted_accounts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."deleted_accounts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."deleted_accounts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."deleted_accounts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."employees" TO "anon";
GRANT ALL ON TABLE "public"."employees" TO "authenticated";
GRANT ALL ON TABLE "public"."employees" TO "service_role";



GRANT ALL ON TABLE "public"."error_logs" TO "anon";
GRANT ALL ON TABLE "public"."error_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."error_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."error_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."error_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."error_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."exchange_rates" TO "anon";
GRANT ALL ON TABLE "public"."exchange_rates" TO "authenticated";
GRANT ALL ON TABLE "public"."exchange_rates" TO "service_role";



GRANT ALL ON TABLE "public"."feedback" TO "anon";
GRANT ALL ON TABLE "public"."feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback" TO "service_role";



GRANT ALL ON TABLE "public"."ingredients" TO "anon";
GRANT ALL ON TABLE "public"."ingredients" TO "authenticated";
GRANT ALL ON TABLE "public"."ingredients" TO "service_role";



GRANT ALL ON TABLE "public"."kpi_bonus_rules" TO "anon";
GRANT ALL ON TABLE "public"."kpi_bonus_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."kpi_bonus_rules" TO "service_role";



GRANT ALL ON TABLE "public"."kpi_criteria" TO "anon";
GRANT ALL ON TABLE "public"."kpi_criteria" TO "authenticated";
GRANT ALL ON TABLE "public"."kpi_criteria" TO "service_role";



GRANT ALL ON TABLE "public"."kpi_scores" TO "anon";
GRANT ALL ON TABLE "public"."kpi_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."kpi_scores" TO "service_role";



GRANT ALL ON TABLE "public"."legal_docs" TO "anon";
GRANT ALL ON TABLE "public"."legal_docs" TO "authenticated";
GRANT ALL ON TABLE "public"."legal_docs" TO "service_role";



GRANT ALL ON TABLE "public"."macro_config" TO "anon";
GRANT ALL ON TABLE "public"."macro_config" TO "authenticated";
GRANT ALL ON TABLE "public"."macro_config" TO "service_role";



GRANT ALL ON TABLE "public"."macro_runs" TO "anon";
GRANT ALL ON TABLE "public"."macro_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."macro_runs" TO "service_role";



GRANT ALL ON TABLE "public"."macro_signals" TO "anon";
GRANT ALL ON TABLE "public"."macro_signals" TO "authenticated";
GRANT ALL ON TABLE "public"."macro_signals" TO "service_role";



GRANT ALL ON TABLE "public"."payrolls" TO "anon";
GRANT ALL ON TABLE "public"."payrolls" TO "authenticated";
GRANT ALL ON TABLE "public"."payrolls" TO "service_role";



GRANT ALL ON TABLE "public"."product_boms" TO "anon";
GRANT ALL ON TABLE "public"."product_boms" TO "authenticated";
GRANT ALL ON TABLE "public"."product_boms" TO "service_role";



GRANT ALL ON TABLE "public"."product_categories" TO "anon";
GRANT ALL ON TABLE "public"."product_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."product_categories" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_orders" TO "anon";
GRANT ALL ON TABLE "public"."purchase_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_orders" TO "service_role";



GRANT ALL ON TABLE "public"."reminders" TO "anon";
GRANT ALL ON TABLE "public"."reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."reminders" TO "service_role";



GRANT ALL ON TABLE "public"."sales_targets" TO "anon";
GRANT ALL ON TABLE "public"."sales_targets" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_targets" TO "service_role";



GRANT ALL ON SEQUENCE "public"."security_incidents_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."security_incidents_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."security_incidents_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."staff_members" TO "anon";
GRANT ALL ON TABLE "public"."staff_members" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_members" TO "service_role";



GRANT ALL ON TABLE "public"."stock_movements" TO "anon";
GRANT ALL ON TABLE "public"."stock_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_movements" TO "service_role";



GRANT ALL ON TABLE "public"."stock_opnames" TO "anon";
GRANT ALL ON TABLE "public"."stock_opnames" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_opnames" TO "service_role";



GRANT ALL ON TABLE "public"."suppliers" TO "anon";
GRANT ALL ON TABLE "public"."suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."suppliers" TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "anon";
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";



GRANT ALL ON TABLE "public"."units" TO "anon";
GRANT ALL ON TABLE "public"."units" TO "authenticated";
GRANT ALL ON TABLE "public"."units" TO "service_role";



GRANT ALL ON TABLE "public"."user_baseline" TO "anon";
GRANT ALL ON TABLE "public"."user_baseline" TO "authenticated";
GRANT ALL ON TABLE "public"."user_baseline" TO "service_role";



GRANT ALL ON TABLE "public"."voice_sessions" TO "anon";
GRANT ALL ON TABLE "public"."voice_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."voice_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."workspace_ai_usage" TO "anon";
GRANT ALL ON TABLE "public"."workspace_ai_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."workspace_ai_usage" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_auth_admin" IN SCHEMA "auth" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_auth_admin" IN SCHEMA "auth" GRANT ALL ON SEQUENCES TO "dashboard_user";



ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_auth_admin" IN SCHEMA "auth" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_auth_admin" IN SCHEMA "auth" GRANT ALL ON FUNCTIONS TO "dashboard_user";



ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_auth_admin" IN SCHEMA "auth" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_auth_admin" IN SCHEMA "auth" GRANT ALL ON TABLES TO "dashboard_user";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







