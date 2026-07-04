-- ============================================================
-- MIGRASI ADMIN + FEEDBACK — jalankan SETELAH schema.sql,
-- migration_auth.sql, dan migration_v2.sql
-- Supabase Dashboard → SQL Editor → New query → tempel → Run
--
-- Menambah:
--   • Tabel admins  (penjaga "hanya 1 akun admin")
--   • Fungsi is_admin()  (dipakai semua kebijakan admin)
--   • Forum feedback  (hanya user login yang bisa posting)
--   • app_events  (pelacakan pemakaian → ukur efisiensi/efektivitas)
--   • Kebijakan RLS "admin boleh lihat & kelola semua"
--   • Fungsi admin: admin_list_users(), admin_metrics(), admin_delete_user()
--   • Realtime untuk feedback, transactions, profiles, app_events
-- ============================================================

-- ============================================================
-- 1) TABEL ADMIN  — siapa yang boleh masuk Dashboard Admin
-- ============================================================
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- Seorang admin boleh membaca baris admin-nya sendiri (untuk verifikasi di dashboard).
-- INSERT/DELETE ke tabel ini TIDAK diberi policy apa pun → hanya bisa lewat
-- service_role (skrip create-admin). Inilah yang membuat admin "tidak bisa
-- didaftarkan dari UI" — persis sesuai permintaan: 1 akun admin saja.
drop policy if exists "admin reads self" on public.admins;
create policy "admin reads self" on public.admins
  for select using (user_id = auth.uid());

-- Penjaga utama: TRUE jika user yang sedang login terdaftar sebagai admin.
-- SECURITY DEFINER → berjalan sebagai pemilik fungsi sehingga bisa membaca
-- public.admins tanpa terkena RLS (mencegah rekursi kebijakan).
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- ============================================================
-- 2) FORUM FEEDBACK  — hanya user login yang bisa posting
-- ============================================================
create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  author_name text,                       -- nama usaha/pemilik (disalin saat posting)
  rating      int  check (rating between 1 and 5),
  category    text not null default 'saran'
              check (category in ('saran','bug','pujian','pertanyaan','lainnya')),
  message     text not null check (char_length(message) between 1 and 4000),
  helped      boolean,                     -- "apakah aplikasi ini membantu masalahmu?"
  status      text not null default 'baru' -- alur moderasi admin
              check (status in ('baru','dibaca','ditindaklanjuti','selesai')),
  admin_reply text,                        -- balasan admin (opsional)
  replied_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists feedback_created_idx on public.feedback (created_at desc);
create index if not exists feedback_user_idx    on public.feedback (user_id);

alter table public.feedback enable row level security;

-- FORUM: semua user yang login boleh MEMBACA semua postingan.
drop policy if exists "feedback read all (login)" on public.feedback;
create policy "feedback read all (login)" on public.feedback
  for select to authenticated using (true);

-- User hanya boleh MEMBUAT postingan atas namanya sendiri.
drop policy if exists "feedback insert own" on public.feedback;
create policy "feedback insert own" on public.feedback
  for insert to authenticated with check (auth.uid() = user_id);

-- User boleh MENGHAPUS postingannya sendiri (edit = hapus lalu posting ulang).
drop policy if exists "feedback delete own" on public.feedback;
create policy "feedback delete own" on public.feedback
  for delete to authenticated using (auth.uid() = user_id);

-- ADMIN boleh segalanya atas seluruh feedback (membalas, ubah status, hapus).
drop policy if exists "feedback admin all" on public.feedback;
create policy "feedback admin all" on public.feedback
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- 3) PELACAKAN PEMAKAIAN  — untuk metrik efisiensi & efektivitas
--    (di-isi otomatis oleh aplikasi, "fire-and-forget")
-- ============================================================
create table if not exists public.app_events (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  type       text not null,          -- mis. 'login','transaction_added','import_completed',
                                      --      'report_generated','feedback_submitted'
  meta       jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_events_type_idx on public.app_events (type, created_at desc);
create index if not exists app_events_user_idx on public.app_events (user_id);

alter table public.app_events enable row level security;

drop policy if exists "events insert own" on public.app_events;
create policy "events insert own" on public.app_events
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "events admin read" on public.app_events;
create policy "events admin read" on public.app_events
  for select to authenticated using (public.is_admin());

-- ============================================================
-- 4) KEBIJAKAN "ADMIN LIHAT & KELOLA SEMUA" pada tabel data
--    (ditambahkan DI SAMPING kebijakan "own ..." yang sudah ada;
--     PostgreSQL menggabungkan policy dengan OR → user biasa tetap
--     hanya melihat datanya sendiri, admin melihat semua)
-- ============================================================
drop policy if exists "admin all profiles" on public.profiles;
create policy "admin all profiles" on public.profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin all transactions" on public.transactions;
create policy "admin all transactions" on public.transactions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin all categories" on public.categories;
create policy "admin all categories" on public.categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin all channels" on public.channels;
create policy "admin all channels" on public.channels
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin all rules" on public.categorization_rules;
create policy "admin all rules" on public.categorization_rules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- 5) FUNGSI ADMIN (SECURITY DEFINER, dijaga oleh is_admin())
-- ============================================================

-- 5a) Daftar SEMUA user + ringkasan aktivitas (termasuk email dari auth.users).
create or replace function public.admin_list_users()
returns table (
  id             uuid,
  email          text,
  business_name  text,
  owner_name     text,
  business_type  text,
  phone          text,
  taxpayer_type  text,
  created_at     timestamptz,
  tx_count       bigint,
  tx_volume      numeric,
  last_activity  timestamptz,
  feedback_count bigint
)
language sql stable security definer set search_path = public as $$
  select
    p.id, u.email, p.business_name, p.owner_name, p.business_type,
    p.phone, p.taxpayer_type, p.created_at,
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
  where public.is_admin()           -- non-admin → tidak dapat baris apa pun
  order by p.created_at desc;
$$;

grant execute on function public.admin_list_users() to authenticated;

-- 5b) Ringkasan KPI untuk halaman Overview/Analytics.
create or replace function public.admin_metrics()
returns jsonb
language sql stable security definer set search_path = public as $$
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

grant execute on function public.admin_metrics() to authenticated;

-- 5c) Hapus user end-user secara TOTAL (auth + semua datanya, cascade).
--     Akun admin tidak boleh dihapus lewat fungsi ini.
create or replace function public.admin_delete_user(p_uid uuid)
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then
    raise exception 'Tidak diizinkan: bukan admin';
  end if;
  if exists (select 1 from public.admins where user_id = p_uid) then
    raise exception 'Akun admin tidak boleh dihapus';
  end if;
  delete from auth.users where id = p_uid;  -- cascade ke profiles, transactions, feedback, dst.
end;
$$;

grant execute on function public.admin_delete_user(uuid) to authenticated;

-- ============================================================
-- 6) REALTIME — agar dashboard admin update otomatis tanpa refresh
-- ============================================================
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.feedback';     exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.transactions';  exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.profiles';      exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.app_events';    exception when duplicate_object then null; end;
end $$;

-- ============================================================
-- SELESAI. Setelah ini, buat akun admin dengan menjalankan:
--   admin-dashboard/scripts/create-admin.mjs   (lihat README)
-- ============================================================
