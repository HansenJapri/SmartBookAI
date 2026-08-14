-- ============================================================
-- MIGRASI: penanda asal aksi (manual/AI), subjek karyawan pada audit log,
--          trigger audit untuk absensi & KPI, serta log aktivitas AI.
--
-- Jalankan SETELAH migration_rbac_fase3.sql. Aman diulang.
--
-- Tiga hal yang diperbaiki:
--
--   1. audit_logs tidak bisa membedakan aksi manual dari aksi lewat asisten AI.
--      log_audit() mencatat actor_id = auth.uid(), dan AI memakai JWT pengguna
--      yang sama — jadi keduanya identik.
--
--   2. `attendance` dan `kpi_scores` TIDAK punya trigger audit sama sekali.
--      Perubahan absensi dan cuti — data HR yang paling sering disengketakan
--      karyawan — selama ini tidak tercatat di mana pun.
--
--   3. Audit log tidak bisa disaring per karyawan. Kolom `changed` pada UPDATE
--      hanya memuat field yang berubah, jadi employee_id sering tidak ada di
--      sana dan penyaringan per karyawan mustahil dilakukan dari sisi klien.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Kolom baru pada audit_logs
-- ------------------------------------------------------------

-- Asal aksi. 'manual' = pengguna menekan tombol sendiri, 'ai' = penulisan
-- berasal dari alur asisten (draf ai-crud yang disimpan).
--
-- BATAS KEJUJURAN: nilai ini INFORMASIONAL, bukan bukti anti-sangkal.
-- Penulisan data dari alur AI tetap dilakukan browser (ai-crud hanya
-- menghasilkan draf; manusia yang menekan Simpan), jadi penandanya dibaca dari
-- header permintaan dan klien yang dimodifikasi bisa memalsukannya. Untuk
-- jejak yang benar-benar mengikat, penulisan harus dipindah ke server —
-- perubahan arsitektur yang sengaja TIDAK diambil di sini.
-- Dua pernyataan, dan urutannya penting.
--
-- `add column ... default 'manual'` dalam satu perintah akan MENGISI seluruh
-- baris lama dengan 'manual'. Untuk tabel yang seluruh gunanya adalah jejak
-- yang bisa dipercaya, itu berarti menuliskan pernyataan yang tidak kita
-- ketahui kebenarannya: sebagian baris lama mungkin memang berasal dari alur
-- asisten, hanya saja belum ada yang mencatatnya.
--
-- Karena itu kolom ditambahkan TANPA default lebih dulu — baris lama tetap
-- NULL, yang berarti "asalnya tidak tercatat" — lalu default dipasang untuk
-- baris BARU saja.
alter table public.audit_logs
  add column if not exists via text;

alter table public.audit_logs
  alter column via set default 'manual';

do $$ begin
  alter table public.audit_logs
    add constraint audit_logs_via_check check (via is null or via in ('manual', 'ai'));
exception when duplicate_object then null;
end $$;

-- Karyawan yang menjadi SUBJEK baris ini (bukan pelakunya).
--
-- Perlu kolom tersendiri karena `changed` pada UPDATE hanya memuat field yang
-- berubah: mengubah status absensi tidak menyertakan employee_id di sana, jadi
-- baris itu tidak bisa dihubungkan ke karyawan mana pun tanpa kolom ini.
alter table public.audit_logs
  add column if not exists employee_id uuid;

create index if not exists idx_audit_owner_employee
  on public.audit_logs (owner_id, employee_id, created_at desc)
  where employee_id is not null;

-- ------------------------------------------------------------
-- 2) log_audit() — versi baru
-- ------------------------------------------------------------

create or replace function public.log_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o uuid; rid text; ch jsonb := '{}'::jsonb; k text; nj jsonb; oj jsonb;
  -- Baris UTUH, terpisah dari `ch`. Pada UPDATE, `ch` hanya berisi field yang
  -- berubah, sedangkan employee_id perlu dibaca dari baris lengkapnya.
  baris jsonb;
  emp uuid;
  v_via text := 'manual';
begin
  if tg_op = 'DELETE' then
    o := old.user_id; rid := old.id::text; baris := to_jsonb(old); ch := baris;
  elsif tg_op = 'INSERT' then
    o := new.user_id; rid := new.id::text; baris := to_jsonb(new); ch := baris;
  else
    o := new.user_id; rid := new.id::text;
    nj := to_jsonb(new); oj := to_jsonb(old); baris := nj;
    for k in select jsonb_object_keys(nj) loop
      if k not in ('updated_at','created_at') and (nj->k) is distinct from (oj->k) then
        ch := ch || jsonb_build_object(k, jsonb_build_array(oj->k, nj->k));
      end if;
    end loop;
  end if;

  -- Subjek karyawan. `assignee_id` ikut supaya kartu tugas yang ditugaskan ke
  -- seorang karyawan juga muncul di riwayatnya.
  begin
    emp := nullif(coalesce(baris->>'employee_id', baris->>'assignee_id'), '')::uuid;
  exception when others then
    emp := null;
  end;
  -- Baris tabel employees itu sendiri: subjeknya adalah karyawan itu.
  if emp is null and tg_table_name = 'employees' then
    begin
      emp := rid::uuid;
    exception when others then
      emp := null;
    end;
  end if;

  -- Asal aksi, dibaca dari header permintaan PostgREST.
  --
  -- Dibungkus blok exception sendiri: di luar PostgREST (mis. dipanggil dari
  -- job cron atau psql) setelan itu tidak ada, dan trigger audit TIDAK BOLEH
  -- menggagalkan penulisan data hanya karena penandanya tak terbaca. Gagal
  -- tertutup ke 'manual'.
  begin
    if coalesce(current_setting('request.headers', true)::json ->> 'x-smartbook-via', '') = 'ai' then
      v_via := 'ai';
    end if;
  exception when others then
    v_via := 'manual';
  end;

  insert into public.audit_logs
    (owner_id, actor_id, table_name, action, row_id, changed, via, employee_id)
  values (o, auth.uid(), tg_table_name, tg_op, rid, ch, v_via, emp);
  return coalesce(new, old);
end $$;

-- ------------------------------------------------------------
-- 3) Trigger audit yang selama ini hilang
-- ------------------------------------------------------------
--
-- Absensi & cuti adalah data HR yang paling sering disengketakan ("saya masuk
-- hari itu, kok tercatat alpa"). Tanpa jejak, sengketa itu tidak bisa
-- diselesaikan siapa pun. kpi_scores menentukan bonus dan potongan gaji, jadi
-- alasannya sama.

drop trigger if exists audit_attendance on public.attendance;
create trigger audit_attendance after insert or update or delete on public.attendance
  for each row execute function public.log_audit();

drop trigger if exists audit_kpi_scores on public.kpi_scores;
create trigger audit_kpi_scores after insert or update or delete on public.kpi_scores
  for each row execute function public.log_audit();

-- ------------------------------------------------------------
-- 4) Log aktivitas AI
-- ------------------------------------------------------------
--
-- Tabel TERPISAH dari audit_logs, disengaja. audit_logs adalah jejak PERUBAHAN
-- DATA: kolomnya table_name / action (INSERT/UPDATE/DELETE) / row_id / changed.
-- Mode Tanya asisten tidak mengubah apa pun, jadi memasukkannya ke sana akan
-- merusak makna tabel itu sekaligus membanjirinya — satu baris per pertanyaan.
--
-- TIDAK ADA TEKS PERTANYAAN di tabel ini, dan itu keputusan yang disengaja.
-- Menyimpannya berarti pemilik usaha bisa membaca setiap kalimat yang diketik
-- stafnya ke asisten. Itu pengawasan karyawan, menimbulkan kewajiban PDP
-- tersendiri, dan tidak dibutuhkan untuk menjawab "fitur AI dipakai siapa,
-- kapan, dan berhasil atau tidak".
create table if not exists public.ai_activity_log (
  id         bigint generated always as identity primary key,
  owner_id   uuid not null,
  actor_id   uuid,
  feature    text not null,                      -- 'chat' | 'catat' | 'crud' | 'struk' | ...
  outcome    text not null default 'ok',         -- 'ok' | 'gagal' | 'limit'
  meta       jsonb,                              -- ringkas & tanpa isi pertanyaan
  created_at timestamptz not null default now()
);

alter table public.ai_activity_log enable row level security;

-- Baca: pemilik usaha saja, sejalan dengan audit_logs.
drop policy if exists "ai_activity_owner_read" on public.ai_activity_log;
create policy "ai_activity_owner_read" on public.ai_activity_log
  for select using (owner_id = auth.uid());

-- Tulis: hanya atas nama diri sendiri, dan hanya ke workspace yang memang
-- boleh dibuka pemanggil. Tanpa syarat kedua, siapa pun yang login bisa
-- menyuntikkan baris ke jejak aktivitas usaha orang lain.
drop policy if exists "ai_activity_self_insert" on public.ai_activity_log;
create policy "ai_activity_self_insert" on public.ai_activity_log
  for insert with check (
    actor_id = auth.uid()
    and (
      owner_id = auth.uid()
      or exists (
        select 1 from public.staff_members m
        where m.owner_id = ai_activity_log.owner_id
          and m.member_id = auth.uid()
          and m.status = 'active'
      )
    )
  );

-- Tidak ada policy update/delete: jejak aktivitas tidak boleh diubah atau
-- dihapus dari aplikasi, sama seperti audit_logs.

create index if not exists idx_ai_activity_owner_created
  on public.ai_activity_log (owner_id, created_at desc);

-- ============================================================
-- SELESAI.
-- ============================================================
