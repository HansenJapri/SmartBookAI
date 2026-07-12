-- ============================================================
-- FASE 5 OPERASIONAL: Papan Tugas Harian
-- (salinan repo; sudah diterapkan sebagai migrasi `operasional_fase5`)
--
-- tasks: papan Antre -> Dikerjakan -> Selesai; due_date = jadwal
-- produksi/layanan; assignee_id = penugasan ke karyawan (modul HR).
-- RBAC : modul 'operasional'. Log aktivitas = trigger audit
-- (tampil di halaman Audit Log).
-- ============================================================
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  note text,
  status text not null default 'antre' check (status in ('antre','dikerjakan','selesai')),
  priority text not null default 'normal' check (priority in ('rendah','normal','tinggi')),
  due_date date,
  assignee_id uuid references public.employees(id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.tasks enable row level security;
create policy "task_own" on public.tasks for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "staff_operasional" on public.tasks for all
  using (public.has_access(user_id,'operasional')) with check (public.has_access(user_id,'operasional'));
create index if not exists idx_tasks_user_status on public.tasks (user_id, status, created_at desc);

drop trigger if exists audit_tasks on public.tasks;
create trigger audit_tasks after insert or update or delete on public.tasks
  for each row execute function public.log_audit();
