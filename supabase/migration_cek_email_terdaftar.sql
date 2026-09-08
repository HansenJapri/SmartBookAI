-- ============================================================
-- public.email_terdaftar(email) — apakah email ini punya akun?
--
-- KEPUTUSAN PRODUK (8 September 2026): layar Masuk harus membedakan
-- "email belum terdaftar" dari "kata sandi salah", supaya pengguna baru tidak
-- terjebak mencoba-coba password untuk akun yang memang belum pernah dibuat.
--
-- YANG DITUKAR: pembedaan ini adalah user enumeration. Siapa pun yang bisa
-- memanggil layar Masuk kini bisa menguji daftar email dan mengetahui mana
-- yang punya akun di SmartBookAI — bahan mentah untuk phishing bertarget.
-- Desain sebelumnya menjawab sama untuk kedua kasus justru untuk mencegah ini.
--
-- YANG MENAHAN DAMPAKNYA:
--   1. Fungsi ini HANYA bisa dieksekusi service_role. Browser tidak bisa
--      memanggilnya; satu-satunya jalan adalah lewat Edge Function auth-login-otp.
--   2. Rate limit yang sudah ada di endpoint itu (5 per 10 menit, 30 per jam
--      per email & IP) tetap berlaku SEBELUM pemeriksaan ini dijalankan,
--      sehingga penyusuran daftar email tetap mahal.
--   3. Hanya mengembalikan boolean — tidak ada nama, tanggal daftar, atau
--      metadata apa pun yang ikut keluar.
--
-- Pembandingannya lower(trim(...)) karena Supabase Auth menyimpan email dalam
-- huruf kecil, sementara orang mengetiknya dengan kapitalisasi apa saja.
-- ============================================================

create or replace function public.email_terdaftar(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $fn$
  select exists (
    select 1 from auth.users
    where lower(email) = lower(trim(coalesce(p_email, '')))
      and coalesce(trim(p_email), '') <> ''
  );
$fn$;

revoke all on function public.email_terdaftar(text) from public;
revoke all on function public.email_terdaftar(text) from anon;
revoke all on function public.email_terdaftar(text) from authenticated;
grant execute on function public.email_terdaftar(text) to service_role;
