-- ============================================================
-- BASELINE PENGGUNA (task C2) — "margin yang kamu kira"
-- Jalankan SETELAH migration_rbac_fase3.sql. Aman diulang.
--
-- Kenapa tabel ini ada
-- --------------------
-- Selisih antara TEBAKAN pengguna dan ANGKA ASLI adalah nilai produk dalam
-- satu angka. Tanpa merekam tebakannya lebih dulu, selisih itu hilang selamanya
-- begitu mereka melihat halaman Reveal — tidak bisa direkonstruksi belakangan.
--
-- Semua kolom jawaban boleh NULL: tiga pertanyaannya opsional dan masing-masing
-- boleh dilewati satu per satu, bukan hanya seluruhnya.
-- ============================================================

create table if not exists public.user_baseline (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  margin_perceived numeric(5,2),   -- tebakan margin bersih (%)
  hours_monthly    numeric(6,2),   -- jam per bulan untuk rekap manual
  channels_count   int,
  fees_known       text[],         -- biaya yang mereka sadar ada
  created_at       timestamptz not null default now()
);

-- Batas kewarasan. Bukan sekadar kerapian: angka ngawur di sini akan muncul
-- sebagai klaim di materi penjualan ("pengguna mengira marginnya 900%").
-- Margin boleh negatif karena usaha memang bisa rugi.
alter table public.user_baseline drop constraint if exists user_baseline_margin_check;
alter table public.user_baseline add constraint user_baseline_margin_check
  check (margin_perceived is null or (margin_perceived >= -100 and margin_perceived <= 100));

alter table public.user_baseline drop constraint if exists user_baseline_hours_check;
alter table public.user_baseline add constraint user_baseline_hours_check
  check (hours_monthly is null or (hours_monthly >= 0 and hours_monthly <= 744));

alter table public.user_baseline drop constraint if exists user_baseline_channels_check;
alter table public.user_baseline add constraint user_baseline_channels_check
  check (channels_count is null or (channels_count >= 0 and channels_count <= 50));

-- Satu baseline per pengguna. Tebakan awal hanya bermakna kalau diambil SEKALI,
-- sebelum mereka tahu jawabannya; indeks ini juga yang menjadi target onConflict
-- pada upsert di saveBaseline().
create unique index if not exists user_baseline_user_uniq on public.user_baseline (user_id);

alter table public.user_baseline enable row level security;

-- Mengikuti pola tabel tenant lain (lihat sales_targets): kebijakan pemilik
-- ditambah kebijakan staf berbasis modul. Reveal berada di modul 'analisis'
-- (src/lib/rbac.js), jadi staf dengan akses itulah yang boleh membacanya.
drop policy if exists "own user_baseline" on public.user_baseline;
create policy "own user_baseline" on public.user_baseline
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "staff_analisis" on public.user_baseline;
create policy "staff_analisis" on public.user_baseline
  for all using (public.has_access(user_id, 'analisis'))
  with check (public.has_access(user_id, 'analisis'));

-- ------------------------------------------------------------
-- VERIFIKASI
-- Tabel ini tenant (punya user_id) dan TIDAK didaftarkan sebagai tabel bersama,
-- sehingga public.tenancy_lint() otomatis mengawasinya. Gagalkan migrasi bila
-- RLS tidak menyala — tabel baseline tanpa RLS berarti tebakan margin satu
-- usaha bisa terbaca usaha lain.
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'user_baseline' and c.relrowsecurity
  ) then
    raise exception 'RLS tidak aktif pada public.user_baseline';
  end if;

  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'user_baseline') < 2 then
    raise exception 'Kebijakan RLS user_baseline belum lengkap';
  end if;
end $$;
