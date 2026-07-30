-- ============================================================
-- KUOTA AI PER WORKSPACE (owner-based) + KUNCI SESI VOICE
--
-- Menggantikan ai_usage lama yang menghitung PER USER. Sekarang kuota dihitung
-- per WORKSPACE: semua staf yang diundang owner berbagi jatah milik owner.
--
-- Reset harian mengikuti tengah malam PACIFIC TIME (bukan WIB/UTC), menyamai
-- reset RPD di Gemini API — supaya penghitung internal tidak pernah lebih
-- longgar daripada kuota asli di Google.
--
-- Aman diulang (idempotent).
-- ============================================================

-- ---------- 1. Workspace = owner_id ----------
-- Staf aktif memakai kuota owner-nya; owner memakai kuotanya sendiri.
create or replace function public.ai_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.owner_id
       from public.staff_members m
      where m.member_id = auth.uid()
        and m.status = 'active'
      limit 1),
    auth.uid()
  );
$$;

revoke all on function public.ai_workspace_id() from public;
grant execute on function public.ai_workspace_id() to authenticated;

-- Tanggal "hari AI" dalam zona Pacific — dipakai sebagai kunci reset harian.
create or replace function public.ai_today_pacific()
returns date
language sql
stable
as $$
  select (now() at time zone 'America/Los_Angeles')::date;
$$;

grant execute on function public.ai_today_pacific() to authenticated;

-- ---------- 2. Tabel pemakaian ----------
create table if not exists public.workspace_ai_usage (
  workspace_id uuid not null,
  feature      text not null,           -- 'insight_dashboard' | 'insight_stok' | 'chat' | 'crud' | 'ocr' | 'voice'
  day          date not null,           -- tanggal Pacific
  count        int  not null default 0, -- panggilan/pesan/aksi/struk
  seconds_used int  not null default 0, -- khusus voice (akumulasi durasi sesi)
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, feature, day)
);

alter table public.workspace_ai_usage enable row level security;

-- Anggota workspace boleh MELIHAT pemakaian (transparansi kuota bersama).
-- Penulisan hanya lewat RPC security definer di bawah.
drop policy if exists "wau select own workspace" on public.workspace_ai_usage;
create policy "wau select own workspace" on public.workspace_ai_usage
  for select to authenticated
  using (workspace_id = public.ai_workspace_id());

-- ---------- 3. Cek kuota (TANPA increment) ----------
-- Dipanggil SEBELUM memanggil Gemini. Mengembalikan satu baris:
--   allowed   : boolean — masih boleh jalan?
--   used      : pemakaian saat ini (count, atau detik untuk voice)
--   cap       : batas harian yang dikirim pemanggil
--   reset_at  : kapan counter direset (tengah malam Pacific berikutnya, UTC)
create or replace function public.ai_quota_check(p_feature text, p_limit int)
returns table (allowed boolean, used int, cap int, reset_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
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

revoke all on function public.ai_quota_check(text, int) from public;
grant execute on function public.ai_quota_check(text, int) to authenticated;

-- ---------- 4. Commit pemakaian (SETELAH sukses) ----------
-- p_units: 1 untuk fitur berbasis panggilan; jumlah DETIK untuk voice.
-- Mengembalikan pemakaian baru. Panggil hanya bila panggilan AI benar-benar sukses.
create or replace function public.ai_quota_commit(p_feature text, p_units int default 1)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  ws      uuid := public.ai_workspace_id();
  d       date := public.ai_today_pacific();
  newval  int;
  units   int  := greatest(1, coalesce(p_units, 1));
begin
  if ws is null then return 0; end if;

  if p_feature = 'voice' then
    insert into public.workspace_ai_usage (workspace_id, feature, day, seconds_used, updated_at)
    values (ws, p_feature, d, units, now())
    on conflict (workspace_id, feature, day)
    do update set seconds_used = public.workspace_ai_usage.seconds_used + units,
                  updated_at = now()
    returning seconds_used into newval;
  else
    insert into public.workspace_ai_usage (workspace_id, feature, day, count, updated_at)
    values (ws, p_feature, d, units, now())
    on conflict (workspace_id, feature, day)
    do update set count = public.workspace_ai_usage.count + units,
                  updated_at = now()
    returning count into newval;
  end if;

  return newval;
end;
$$;

revoke all on function public.ai_quota_commit(text, int) from public;
grant execute on function public.ai_quota_commit(text, int) to authenticated;

-- ---------- 5. Batas seat Free Plan ----------
-- Free Plan: maksimal 2 anggota per workspace (owner + 1 staf).
-- Dihitung dari staf yang BELUM dicabut (invited/active) + 1 (owner).
create or replace function public.ai_seat_count(p_owner uuid default null)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select 1 + (
    select count(*)::int
      from public.staff_members m
     where m.owner_id = coalesce(p_owner, auth.uid())
       and m.status <> 'revoked'
  );
$$;

grant execute on function public.ai_seat_count(uuid) to authenticated;

-- Penegakan di database: tolak INSERT staf ke-2 (anggota ke-3) pada Free Plan.
-- Trigger ini adalah jaring pengaman; UI tetap menampilkan pesan upgrade lebih dulu.
create or replace function public.enforce_free_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

drop trigger if exists trg_free_seat_limit on public.staff_members;
create trigger trg_free_seat_limit
  after insert on public.staff_members
  for each row execute function public.enforce_free_seat_limit();

-- ---------- 6. Kunci sesi voice (maks 1 sesi aktif per workspace) ----------
create table if not exists public.voice_sessions (
  workspace_id  uuid primary key,
  holder_id     uuid not null,              -- user yang memegang sesi
  started_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

alter table public.voice_sessions enable row level security;

drop policy if exists "vs select own workspace" on public.voice_sessions;
create policy "vs select own workspace" on public.voice_sessions
  for select to authenticated
  using (workspace_id = public.ai_workspace_id());

-- Ambil slot sesi voice. Sesi yang idle > 60 detik dianggap mati dan boleh direbut.
-- Mengembalikan: acquired (boolean), holder_id (siapa yang sedang memakai).
create or replace function public.voice_session_acquire()
returns table (acquired boolean, holder_id uuid)
language plpgsql
security definer
set search_path = public
as $$
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

revoke all on function public.voice_session_acquire() from public;
grant execute on function public.voice_session_acquire() to authenticated;

-- Heartbeat: dipanggil klien tiap ~15 detik selama sesi berlangsung.
create or replace function public.voice_session_touch()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid := public.ai_workspace_id();
begin
  update public.voice_sessions
     set last_seen_at = now()
   where workspace_id = ws and holder_id = auth.uid();
  return found;
end;
$$;

revoke all on function public.voice_session_touch() from public;
grant execute on function public.voice_session_touch() to authenticated;

-- Lepas slot saat sesi ditutup (atau saat tab ditutup, lewat beacon).
create or replace function public.voice_session_release()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid := public.ai_workspace_id();
begin
  delete from public.voice_sessions
   where workspace_id = ws and holder_id = auth.uid();
  return found;
end;
$$;

revoke all on function public.voice_session_release() from public;
grant execute on function public.voice_session_release() to authenticated;

-- ============================================================
-- SELESAI. Setelah dijalankan, DEPLOY ULANG semua Edge Function AI.
-- ============================================================
