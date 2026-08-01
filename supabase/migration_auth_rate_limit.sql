-- ============================================================
-- RATE LIMITING ENDPOINT AUTENTIKASI (berbasis Postgres)
--
-- KENAPA POSTGRES, BUKAN IN-MEMORY ATAU REDIS
-- -------------------------------------------
-- Edge Function berjalan di isolate Deno yang berumur pendek dan diskalakan
-- horizontal: variabel di memori TIDAK dibagi antar-invokasi maupun antar-region,
-- sehingga penghitung in-memory praktis tidak membatasi apa pun. Redis tidak
-- tersedia di stack ini. Postgres sudah ada, transaksional, dan cukup cepat
-- untuk beban auth — jadi itulah penyimpanan yang benar di sini.
--
-- APA YANG DILINDUNGI
-- -------------------
-- Endpoint auth-login-otp memverifikasi password SEBELUM mengirim OTP. Tanpa
-- pembatas, endpoint itu menjadi dua hal sekaligus:
--   1. Orakel brute-force password (tak terbatas percobaan)
--   2. Saluran penghabis kuota SMTP Gmail (500 email/hari)
-- Pembatas dipasang SEBELUM verifikasi password, jadi keduanya tertutup.
--
-- Batas Supabase sendiri (Minimum interval per user 60 detik, Rate limit for
-- sending emails 30/jam) tetap berlaku dan bekerja di lapis berbeda: itu per
-- ALAMAT EMAIL di sisi GoTrue. Pembatas di sini bekerja per email DAN per IP,
-- sebelum permintaan menyentuh GoTrue sama sekali.
-- ============================================================

create table if not exists public.auth_rate_limits (
  bucket       text        not null,   -- nama aturan, mis. 'login_10m'
  subject      text        not null,   -- 'email:<alamat>' atau 'ip:<alamat>'
  window_start timestamptz not null,
  hits         int         not null default 0,
  primary key (bucket, subject, window_start)
);

-- Tabel ini HANYA disentuh Edge Function lewat RPC security definer.
-- RLS aktif tanpa satu pun policy = tidak ada akses langsung dari klien.
alter table public.auth_rate_limits enable row level security;

create index if not exists idx_auth_rate_limits_window
  on public.auth_rate_limits (window_start);

-- Menghitung satu percobaan dan memutuskan boleh/tidak, dalam satu operasi
-- atomik. `insert ... on conflict do update` mencegah dua permintaan bersamaan
-- sama-sama lolos karena membaca hitungan lama (race condition klasik).
--
-- Mengembalikan sisa jatah dan detik tunggu supaya pemanggil bisa menjawab 429
-- dengan angka yang benar — bukan angka tebakan.
create or replace function public.rate_limit_hit(
  p_bucket  text,
  p_subject text,
  p_limit   int,
  p_window_seconds int
)
returns table (allowed boolean, remaining int, retry_after int)
language plpgsql volatile security definer set search_path = public as $$
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

revoke all on function public.rate_limit_hit(text, text, int, int) from public;
-- Sengaja TIDAK di-grant ke `authenticated` maupun `anon`: satu-satunya
-- pemanggil yang sah adalah Edge Function memakai service role. Kalau klien
-- bisa memanggilnya langsung, penyerang tinggal menghabiskan jatah orang lain.

-- Pembersih baris jendela lama supaya tabel tidak tumbuh selamanya.
create or replace function public.prune_auth_rate_limits(p_older_than_hours int default 24)
returns int
language plpgsql volatile security definer set search_path = public as $$
declare v_n int;
begin
  delete from public.auth_rate_limits
   where window_start < now() - make_interval(hours => p_older_than_hours);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.prune_auth_rate_limits(int) from public;

comment on table public.auth_rate_limits is
  'Penghitung rate limit endpoint auth. Hanya ditulis lewat rate_limit_hit() dari Edge Function (service role).';
