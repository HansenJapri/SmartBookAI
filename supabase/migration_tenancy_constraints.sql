-- ============================================================
-- ISOLASI WORKSPACE, LAPIS SKEMA (bukan lapis aplikasi)
--
-- Dua migrasi sebelumnya memperbaiki KEBOCORAN yang sudah terjadi:
--   migration_rbac_invite_hardening.sql  — policy undangan & privilege escalation
--   migration_workspace_isolation.sql    — RPC menulis ke workspace yang salah
-- Keduanya bekerja dengan menambahkan pemeriksaan di query dan di fungsi.
--
-- Masalahnya: pemeriksaan bisa dilupakan. Setiap `select('*')` baru, setiap
-- fungsi baru, setiap upsert baru harus ingat menyertakan user_id. Itu bukan
-- desain — itu disiplin, dan disiplin selalu bocor cepat atau lambat. Bug
-- "data usaha owner ter-copy ke usaha staf" adalah akibat langsungnya.
--
-- Migrasi ini memindahkan invarian ke SKEMA, sehingga pelanggaran menjadi
-- MUSTAHIL, bukan sekadar "tidak dilakukan":
--
--   AKAR MASALAH: setiap foreign key antar-tabel hanya menunjuk `(id)`.
--   attendance.employee_id -> employees(id) tidak peduli apakah karyawan itu
--   milik workspace yang sama. Begitu pula transactions.product_id,
--   purchase_orders.product_id, kpi_scores.*, payrolls.*, product_boms.*,
--   products.supplier_id, tasks.assignee_id. Tiga belas relasi, semuanya bisa
--   menyeberang workspace tanpa satu pun penghalang di database.
--
--   PERBAIKAN: setiap induk mendapat kunci alternatif (user_id, id), dan setiap
--   FK menjadi KOMPOSIT: (user_id, <ref>) -> induk(user_id, id). Referensi
--   lintas-workspace kini ditolak Postgres dengan 23503 — tidak bergantung pada
--   RLS, tidak bergantung pada kode klien, tidak bergantung pada RPC.
--
-- PRA-SYARAT YANG SUDAH DIVERIFIKASI SEBELUM DITERAPKAN:
--   - 13 relasi diperiksa, 0 baris melanggar (tidak ada data yang perlu dibersihkan)
--   - user_id sudah NOT NULL di seluruh 26 tabel tenant
--
-- HASIL UJI NEGATIF (dijalankan di dalam blok yang di-rollback):
--   attendance.employee_id        lintas-workspace -> DITOLAK 23503
--   transactions.product_id       lintas-workspace -> DITOLAK 23503
--   kpi_scores (employee+criteria) lintas-workspace -> DITOLAK 23503
--   payrolls (employee+txn)       lintas-workspace -> DITOLAK 23503
--   purchase_orders.product_id    lintas-workspace -> DITOLAK 23503
--   products.supplier_id          lintas-workspace -> DITOLAK 23503
--   tasks.assignee_id             lintas-workspace -> DITOLAK 23503
--   stock_opnames.items           lintas-workspace -> DITOLAK 23503 (trigger)
--   kontrol positif: referensi dalam workspace sendiri TETAP berfungsi
-- ============================================================

-- ---------- 1. Kunci tenant di tabel induk ----------
-- `id` tetap primary key. (user_id, id) ditambahkan sebagai kunci alternatif
-- supaya anak bisa mereferensikan "baris ini DI workspace ini".
alter table public.employees     add constraint employees_tenant_key     unique (user_id, id);
alter table public.kpi_criteria  add constraint kpi_criteria_tenant_key  unique (user_id, id);
alter table public.transactions  add constraint transactions_tenant_key  unique (user_id, id);
alter table public.products      add constraint products_tenant_key      unique (user_id, id);
alter table public.suppliers     add constraint suppliers_tenant_key     unique (user_id, id);
alter table public.ingredients   add constraint ingredients_tenant_key   unique (user_id, id);

-- ---------- 2. Foreign key komposit ----------
-- Kolom referensi yang nullable memakai MATCH SIMPLE (bawaan): bila kolomnya
-- NULL, constraint tidak diperiksa — itulah perilaku yang diinginkan untuk
-- relasi opsional. user_id sendiri NOT NULL, jadi tidak ada celah "lolos
-- karena null" pada sisi tenant.
--
-- `on delete set null (kolom)` (PostgreSQL 15+) dipakai agar hanya kolom
-- referensinya yang dikosongkan — bukan user_id yang NOT NULL. Tanpa daftar
-- kolom, SET NULL akan mencoba mengosongkan user_id juga dan gagal.

-- attendance
alter table public.attendance drop constraint attendance_employee_id_fkey;
alter table public.attendance add constraint attendance_employee_tenant_fkey
  foreign key (user_id, employee_id) references public.employees (user_id, id) on delete cascade;

-- kpi_scores
alter table public.kpi_scores drop constraint kpi_scores_employee_id_fkey;
alter table public.kpi_scores add constraint kpi_scores_employee_tenant_fkey
  foreign key (user_id, employee_id) references public.employees (user_id, id) on delete cascade;
alter table public.kpi_scores drop constraint kpi_scores_criteria_id_fkey;
alter table public.kpi_scores add constraint kpi_scores_criteria_tenant_fkey
  foreign key (user_id, criteria_id) references public.kpi_criteria (user_id, id) on delete cascade;

-- payrolls
alter table public.payrolls drop constraint payrolls_employee_id_fkey;
alter table public.payrolls add constraint payrolls_employee_tenant_fkey
  foreign key (user_id, employee_id) references public.employees (user_id, id) on delete cascade;
alter table public.payrolls drop constraint payrolls_txn_id_fkey;
alter table public.payrolls add constraint payrolls_txn_tenant_fkey
  foreign key (user_id, txn_id) references public.transactions (user_id, id) on delete set null (txn_id);

-- product_boms
alter table public.product_boms drop constraint product_boms_product_id_fkey;
alter table public.product_boms add constraint product_boms_product_tenant_fkey
  foreign key (user_id, product_id) references public.products (user_id, id) on delete cascade;
alter table public.product_boms drop constraint product_boms_ingredient_id_fkey;
alter table public.product_boms add constraint product_boms_ingredient_tenant_fkey
  foreign key (user_id, ingredient_id) references public.ingredients (user_id, id) on delete cascade;

-- products
alter table public.products drop constraint products_supplier_id_fkey;
alter table public.products add constraint products_supplier_tenant_fkey
  foreign key (user_id, supplier_id) references public.suppliers (user_id, id) on delete set null (supplier_id);

-- purchase_orders
alter table public.purchase_orders drop constraint purchase_orders_product_id_fkey;
alter table public.purchase_orders add constraint purchase_orders_product_tenant_fkey
  foreign key (user_id, product_id) references public.products (user_id, id) on delete cascade;
alter table public.purchase_orders drop constraint purchase_orders_supplier_id_fkey;
alter table public.purchase_orders add constraint purchase_orders_supplier_tenant_fkey
  foreign key (user_id, supplier_id) references public.suppliers (user_id, id) on delete set null (supplier_id);
alter table public.purchase_orders drop constraint purchase_orders_txn_id_fkey;
alter table public.purchase_orders add constraint purchase_orders_txn_tenant_fkey
  foreign key (user_id, txn_id) references public.transactions (user_id, id) on delete set null (txn_id);

-- tasks
alter table public.tasks drop constraint tasks_assignee_id_fkey;
alter table public.tasks add constraint tasks_assignee_tenant_fkey
  foreign key (user_id, assignee_id) references public.employees (user_id, id) on delete set null (assignee_id);

-- transactions
alter table public.transactions drop constraint transactions_product_id_fkey;
alter table public.transactions add constraint transactions_product_tenant_fkey
  foreign key (user_id, product_id) references public.products (user_id, id) on delete set null (product_id);

-- ---------- 3. stock_opnames.items — referensi di dalam JSONB ----------
-- items berbentuk jsonb [{product_id, ...}], jadi tidak bisa dijaga foreign key.
-- Ini SATU-SATUNYA relasi di skema yang tidak bisa dipagari FK, jadi dijaga
-- trigger supaya tidak ada pengecualian pada invarian.
create or replace function public.stock_opnames_items_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_bad int;
begin
  if new.items is null or jsonb_typeof(new.items) <> 'array' then
    return new;
  end if;
  select count(*) into v_bad
  from jsonb_array_elements(new.items) e
  where nullif(e->>'product_id','') is not null
    and not exists (
      select 1 from public.products p
       where p.id = (e->>'product_id')::uuid and p.user_id = new.user_id
    );
  if v_bad > 0 then
    raise exception 'Sesi opname memuat % produk yang bukan milik usaha ini.', v_bad
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_stock_opnames_items_guard on public.stock_opnames;
create trigger trg_stock_opnames_items_guard
  before insert or update of items, user_id on public.stock_opnames
  for each row execute function public.stock_opnames_items_guard();

-- ---------- 4. Lint skema: invarian jadi bisa diperiksa mesin ----------
-- Ini bagian terpenting dari migrasi ini. Perbaikan di atas menutup 13 relasi
-- yang ada HARI INI; lint di bawah memastikan relasi ke-14 yang ditambahkan
-- bulan depan tidak lolos tanpa pagar.
--
--   T1  setiap tabel tenant punya user_id NOT NULL
--   T2  setiap FK antar-tabel tenant bersifat KOMPOSIT (menyertakan user_id)
--   T3  tidak ada data yang mereferensikan workspace lain (relasi jsonb)
--
-- Hasil kosong = sehat. JALANKAN SETELAH SETIAP PERUBAHAN SKEMA:
--   select * from public.tenancy_lint();
create or replace function public.tenancy_lint()
returns table (invarian text, objek text, detail text)
language plpgsql stable security definer set search_path = public as $$
declare
  -- Tabel yang memang BUKAN milik satu workspace. Menambahkan nama ke sini
  -- berarti menyatakan "tabel ini lintas-akun secara sengaja" — pikirkan dua
  -- kali sebelum melakukannya.
  v_shared text[] := array[
    'admins','app_events','feedback','ai_usage','legal_docs','profiles',
    'staff_members','audit_logs','admin_audit_log',
    'macro_signals','macro_runs','macro_config','commodity_prices','exchange_rates'
  ];
  r record;
  v_n bigint;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and not (c.relname = any(v_shared))
      and not a.attnotnull
  loop
    invarian := 'T1_user_id_nullable'; objek := r.relname;
    detail := 'kolom user_id harus NOT NULL di tabel tenant';
    return next;
  end loop;

  for r in
    select con.conname,
           con.conrelid::regclass::text as anak,
           con.confrelid::regclass::text as induk,
           (select array_agg(att.attname order by k.ord)
              from unnest(con.conkey) with ordinality k(attnum, ord)
              join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
           ) as kolom_anak
    from pg_constraint con
    join pg_class ch on ch.oid = con.conrelid
    join pg_class pa on pa.oid = con.confrelid
    join pg_namespace nch on nch.oid = ch.relnamespace
    join pg_namespace npa on npa.oid = pa.relnamespace
    where con.contype = 'f'
      and nch.nspname = 'public' and npa.nspname = 'public'
      and not (ch.relname = any(v_shared))
      and not (pa.relname = any(v_shared))
      and exists (select 1 from pg_attribute a
                   where a.attrelid = ch.oid and a.attname='user_id' and not a.attisdropped)
      and exists (select 1 from pg_attribute a
                   where a.attrelid = pa.oid and a.attname='user_id' and not a.attisdropped)
  loop
    if not ('user_id' = any(r.kolom_anak)) then
      invarian := 'T2_fk_tidak_komposit'; objek := r.anak || '.' || r.conname;
      detail := 'FK ke ' || r.induk || ' hanya memakai ' || array_to_string(r.kolom_anak, ',')
                || ' — harus menyertakan user_id';
      return next;
    end if;
  end loop;

  select count(*) into v_n
  from public.stock_opnames so
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(so.items) = 'array' then so.items else '[]'::jsonb end) e
  where nullif(e->>'product_id','') is not null
    and not exists (select 1 from public.products p
                     where p.id = (e->>'product_id')::uuid and p.user_id = so.user_id);
  if v_n > 0 then
    invarian := 'T3_referensi_lintas_workspace'; objek := 'stock_opnames.items';
    detail := v_n || ' product_id menunjuk workspace lain';
    return next;
  end if;

  return;
end $$;

revoke all on function public.tenancy_lint() from public;
comment on function public.tenancy_lint() is
  'Gerbang rilis isolasi workspace. Hasil kosong = skema sehat. Jalankan setelah setiap perubahan skema.';

-- ---------- 5. Efek pada risiko upsert yang sebelumnya terbuka ----------
-- attendance memakai onConflict (employee_id, date) dan kpi_scores memakai
-- (employee_id, criteria_id, period) — keduanya TIDAK menyertakan user_id.
-- Sebelum migrasi ini, permintaan yang dibuat manual dengan employee_id milik
-- usaha lain bisa menabrak baris usaha itu dan mengubahnya.
--
-- Sekarang tidak perlu mengubah unique constraint tersebut: FK komposit membuat
-- employee_id MENENTUKAN workspace-nya, jadi (employee_id, date) sudah setara
-- dengan (user_id, employee_id, date). Baris dengan employee_id usaha lain tidak
-- bisa ada sejak awal — upsert-nya ditolak sebelum sampai ke tahap konflik.
-- Ini alasan constraint unique dibiarkan apa adanya: menambah user_id di sana
-- hanya redundansi, dan mengganti unique index pada data produksi punya risiko
-- sendiri yang tidak perlu diambil.
