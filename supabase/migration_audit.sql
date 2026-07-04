-- ============================================================
-- MIGRASI AUDIT LOG ADMIN
-- Mencatat tindakan admin (siapa, kapan, melakukan apa) sebagai jejak audit.
-- Jalankan SETELAH migration_admin.sql. Aman diulang.
-- ============================================================

create table if not exists public.admin_audit_log (
  id           bigint generated always as identity primary key,
  admin_id     uuid not null default auth.uid(),
  action       text not null,           -- mis. 'user_deleted', 'transaction_updated'
  target_table text,
  target_id    text,
  meta         jsonb,
  created_at   timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;

-- Hanya admin yang boleh membaca jejak audit.
drop policy if exists "audit admin select" on public.admin_audit_log;
create policy "audit admin select" on public.admin_audit_log
  for select to authenticated using (public.is_admin());

-- Admin hanya boleh menulis baris atas namanya sendiri (admin_id = dirinya).
drop policy if exists "audit admin insert" on public.admin_audit_log;
create policy "audit admin insert" on public.admin_audit_log
  for insert to authenticated with check (public.is_admin() and admin_id = auth.uid());

-- Tidak ada policy update/delete: jejak audit tidak boleh diubah/dihapus dari aplikasi.

create index if not exists idx_audit_created on public.admin_audit_log (created_at desc);

-- ============================================================
-- SELESAI.
-- ============================================================
