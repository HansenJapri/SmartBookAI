-- ============================================================
-- FASE 4 HR: Karyawan, Absensi & Cuti, Penggajian
-- (salinan repo; sudah diterapkan sebagai migrasi `hr_fase4`)
--
-- employees : gaji bulanan (nominal/bulan) atau harian (nominal/hari hadir)
-- attendance: satu baris per karyawan per tanggal (hadir/izin/sakit/cuti/alpa)
-- payrolls  : satu baris per karyawan per periode 'YYYY-MM';
--             draf -> dibayar (membuat transaksi pengeluaran -> Laba Rugi)
-- RBAC      : modul baru 'hr' (policy staff_hr via has_access)
-- Audit     : trigger di employees & payrolls (absensi dikecualikan agar log
--             tidak bising oleh pencatatan harian)
-- ============================================================

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  role text,
  phone text,
  salary_type text not null default 'bulanan' check (salary_type in ('bulanan','harian')),
  salary_amount numeric not null default 0 check (salary_amount >= 0),
  join_date date,
  status text not null default 'aktif' check (status in ('aktif','nonaktif')),
  note text,
  created_at timestamptz not null default now()
);
alter table public.employees enable row level security;
create policy "emp_own" on public.employees for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "staff_hr" on public.employees for all
  using (public.has_access(user_id,'hr')) with check (public.has_access(user_id,'hr'));

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  status text not null check (status in ('hadir','izin','sakit','cuti','alpa')),
  note text,
  created_at timestamptz not null default now(),
  unique (employee_id, date)
);
alter table public.attendance enable row level security;
create policy "att_own" on public.attendance for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "staff_hr" on public.attendance for all
  using (public.has_access(user_id,'hr')) with check (public.has_access(user_id,'hr'));
create index if not exists idx_att_user_date on public.attendance (user_id, date desc);

create table if not exists public.payrolls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  period text not null,
  base_amount numeric not null default 0,
  bonus numeric not null default 0,
  deduction numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'draft' check (status in ('draft','paid')),
  paid_at timestamptz,
  txn_id uuid references public.transactions(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  unique (employee_id, period)
);
alter table public.payrolls enable row level security;
create policy "pay_own" on public.payrolls for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "staff_hr" on public.payrolls for all
  using (public.has_access(user_id,'hr')) with check (public.has_access(user_id,'hr'));
create index if not exists idx_pay_user_period on public.payrolls (user_id, period);

drop trigger if exists audit_employees on public.employees;
create trigger audit_employees after insert or update or delete on public.employees
  for each row execute function public.log_audit();
drop trigger if exists audit_payrolls on public.payrolls;
create trigger audit_payrolls after insert or update or delete on public.payrolls
  for each row execute function public.log_audit();
