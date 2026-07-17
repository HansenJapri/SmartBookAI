-- ============================================================
-- HR LANJUTAN: Aturan Bonus/Potongan Absensi + KPI Karyawan
-- (salinan repo; sudah diterapkan sebagai migrasi `hr_kpi_absensi_v1`)
--
-- attendance_rules : efek gaji per HARI untuk tiap status absensi,
--                    diatur sendiri oleh pemilik (bonus_per_day /
--                    deduction_per_day). Dipakai otomatis saat membuat
--                    draf gaji; tetap bisa dikoreksi manual di Penggajian.
-- kpi_criteria     : kriteria penilaian karyawan. source:
--                    'kehadiran' = skor otomatis dari absensi,
--                    'tugas'     = skor otomatis dari Papan Tugas,
--                    'manual'    = diisi pemilik. weight = bobot %.
-- kpi_scores       : skor 0-100 per karyawan per periode per kriteria.
-- kpi_bonus_rules  : jenjang skor total -> bonus/potongan Rupiah
--                    (baris dengan min_score tertinggi yang terlampaui
--                    yang berlaku).
-- RLS: owner + staff_hr (modul 'hr') — pola sama dengan fase 4.
-- Audit: attendance_rules & kpi_bonus_rules (berdampak uang).
-- ============================================================

create table if not exists public.attendance_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('hadir','izin','sakit','cuti','alpa')),
  bonus_per_day numeric not null default 0 check (bonus_per_day >= 0),
  deduction_per_day numeric not null default 0 check (deduction_per_day >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, status)
);
alter table public.attendance_rules enable row level security;
create policy "attrule_own" on public.attendance_rules for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "staff_hr" on public.attendance_rules for all
  using (public.has_access(user_id,'hr')) with check (public.has_access(user_id,'hr'));

create table if not exists public.kpi_criteria (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  weight numeric not null default 0 check (weight >= 0 and weight <= 100),
  source text not null default 'manual' check (source in ('manual','kehadiran','tugas')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.kpi_criteria enable row level security;
create policy "kpic_own" on public.kpi_criteria for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "staff_hr" on public.kpi_criteria for all
  using (public.has_access(user_id,'hr')) with check (public.has_access(user_id,'hr'));

create table if not exists public.kpi_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  criteria_id uuid not null references public.kpi_criteria(id) on delete cascade,
  period text not null,
  score numeric not null default 0 check (score >= 0 and score <= 100),
  note text,
  created_at timestamptz not null default now(),
  unique (employee_id, criteria_id, period)
);
alter table public.kpi_scores enable row level security;
create policy "kpis_own" on public.kpi_scores for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "staff_hr" on public.kpi_scores for all
  using (public.has_access(user_id,'hr')) with check (public.has_access(user_id,'hr'));
create index if not exists idx_kpis_user_period on public.kpi_scores (user_id, period);

create table if not exists public.kpi_bonus_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  min_score numeric not null check (min_score >= 0 and min_score <= 100),
  bonus numeric not null default 0 check (bonus >= 0),
  deduction numeric not null default 0 check (deduction >= 0),
  label text,
  created_at timestamptz not null default now()
);
alter table public.kpi_bonus_rules enable row level security;
create policy "kpib_own" on public.kpi_bonus_rules for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "staff_hr" on public.kpi_bonus_rules for all
  using (public.has_access(user_id,'hr')) with check (public.has_access(user_id,'hr'));

drop trigger if exists audit_attendance_rules on public.attendance_rules;
create trigger audit_attendance_rules after insert or update or delete on public.attendance_rules
  for each row execute function public.log_audit();
drop trigger if exists audit_kpi_bonus_rules on public.kpi_bonus_rules;
create trigger audit_kpi_bonus_rules after insert or update or delete on public.kpi_bonus_rules
  for each row execute function public.log_audit();
