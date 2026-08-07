-- ============================================================
-- P2 — Pembatas percobaan OTP (max attempt + lockout)
-- Terpasang di project hexaidoxmeycctpwfbst sebagai migrasi `otp_attempt_limit`.
-- Dipakai dari src/lib/otpGuard.js lewat useOtpLock().
-- ============================================================
--
-- Supabase Auth membatasi PENGIRIMAN kode (throttle antar-permintaan & kuota
-- email per jam), tetapi tidak membatasi berapa kali sebuah kode boleh DITEBAK.
-- Kode login 8 digit yang boleh dicoba tanpa batas selama masa berlakunya adalah
-- permukaan brute-force yang nyata.
--
-- Tiga fungsi di bawah memakai tabel auth_rate_limits yang sudah ada. Bedanya
-- dengan rate_limit_hit() yang sudah ada: fungsi itu SELALU menambah hitungan,
-- sementara di sini kita perlu memisahkan tiga hal —
--   status  : membaca sisa percobaan TANPA menambah (dipanggil saat layar dibuka;
--             kalau ikut menambah, sekadar membuka halaman sudah menghabiskan jatah),
--   fail    : menambah satu percobaan setelah kode terbukti salah,
--   reset   : mengosongkan hitungan setelah kode benar, supaya pengguna sah yang
--             sempat salah ketik tidak terbawa terkunci ke login berikutnya.
--
-- Subjek disimpan sebagai md5(email), bukan emailnya. Tabel ini tidak boleh
-- berubah menjadi daftar email pengguna yang bisa dipanen kalau suatu saat ada
-- kekeliruan policy; untuk keperluan menghitung, hash sudah cukup.
--
-- Batas default: 5 percobaan per jendela 15 menit, per (alur, email).

create or replace function public.otp_attempt_status(
  p_bucket text,
  p_subject text,
  p_limit int default 5,
  p_window_seconds int default 900
)
returns table(locked boolean, hits int, remaining int, retry_after int)
language plpgsql
security definer
set search_path to 'public'
as $$
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

create or replace function public.otp_attempt_fail(
  p_bucket text,
  p_subject text,
  p_limit int default 5,
  p_window_seconds int default 900
)
returns table(locked boolean, hits int, remaining int, retry_after int)
language plpgsql
security definer
set search_path to 'public'
as $$
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

create or replace function public.otp_attempt_reset(p_bucket text, p_subject text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from public.auth_rate_limits
  where bucket = p_bucket and subject = md5(lower(p_subject));
$$;

-- Dipanggil dari halaman login/daftar/lupa-password yang BELUM punya sesi.
grant execute on function public.otp_attempt_status(text, text, int, int) to anon, authenticated;
grant execute on function public.otp_attempt_fail(text, text, int, int)   to anon, authenticated;
grant execute on function public.otp_attempt_reset(text, text)            to anon, authenticated;
