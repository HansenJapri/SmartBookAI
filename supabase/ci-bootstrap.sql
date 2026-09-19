-- ============================================================
-- Yang harus ada SEBELUM supabase/schema.sql bisa dimuat di Postgres polos.
--
-- KENAPA BERKAS INI ADA
-- `supabase db dump --schema public --schema auth` mengeluarkan skema yang
-- lengkap — termasuk seluruh tabel auth, auth.uid(), auth.jwt(). Yang TIDAK
-- ikut hanyalah dua hal yang memang bukan bagian dari skema:
--
--   1. ROLE. Dump memakai OWNER TO dan GRANT ke supabase_admin,
--      supabase_auth_admin, anon, authenticated, service_role, authenticator
--      dan dashboard_user. Postgres menolak GRANT ke role yang tidak ada, jadi
--      satu nama yang hilang menggagalkan seluruh pemuatan.
--
--   2. EKSTENSI. Dump tidak memuat satu pun CREATE EXTENSION, padahal skema
--      public memakai digest() dari pgcrypto (fungsi penyamar email di
--      admin_delete_user). Tanpa pgcrypto, fungsinya baru gagal saat DIPANGGIL,
--      bukan saat dimuat — jadi gerbangnya akan terlihat hijau sampai ada uji
--      yang kebetulan menyentuhnya.
--
-- Berkas ini sengaja SEPENDEK ini. Setiap baris tambahan di sini adalah selisih
-- antara yang diuji CI dan yang berjalan di produksi, dan selisih itu persis
-- tempat bug bersembunyi dari gerbangnya sendiri.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Role yang dirujuk dump lewat OWNER TO dan GRANT
-- ------------------------------------------------------------
-- Semuanya NOLOGIN: tidak ada yang menyambung sebagai mereka di CI, dan role
-- tanpa login tidak bisa dipakai apa pun. Yang dibutuhkan hanyalah agar
-- namanya ada sehingga GRANT dan OWNER TO punya sasaran.
do $roles$
declare r text;
begin
  foreach r in array array[
    'supabase_admin', 'supabase_auth_admin', 'authenticator',
    'anon', 'authenticated', 'service_role', 'dashboard_user'
  ] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end
$roles$;

-- ------------------------------------------------------------
-- 2. Ekstensi
-- ------------------------------------------------------------
-- digest() -> pgcrypto. gen_random_uuid() sudah inti sejak PG13.
create extension if not exists pgcrypto;
