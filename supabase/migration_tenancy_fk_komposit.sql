-- ============================================================
-- Menutup 3 pelanggaran tenancy_lint() di project vbzmtnpmtgrhovmwjqqk.
--
-- KENAPA BERKAS INI ADA, DAN KENAPA BARU SEKARANG
-- Dua perbaikan FK di bawah pernah dikerjakan sebelumnya — tapi hanya
-- diterapkan langsung ke project LAMA (hexaidoxmeycctpwfbst) lewat migrasi
-- ad-hoc, dan tidak pernah dikomit sebagai SQL. Catatannya ada di
-- migration_test_bom_harness.sql, tapi catatan bukan kode. Waktu project
-- berganti, perbaikannya hilang dan lint-nya merah lagi — tanpa ada yang tahu,
-- karena gerbang CI yang seharusnya menangkapnya juga ikut mati.
--
-- Pelajarannya sederhana dan mahal: perbaikan skema yang hanya hidup di dalam
-- satu instance database bukan perbaikan, ia pinjaman. Berkas ini melunasinya.
-- ============================================================

-- ------------------------------------------------------------
-- 1 & 2. FK komposit — baris workspace A tidak boleh menunjuk baris workspace B
-- ------------------------------------------------------------
--
-- ingredients.source_product_id -> products(id)
-- transactions.supplier_id      -> suppliers(id)
--
-- Keduanya hanya memakai SATU kolom, jadi Postgres dengan senang hati menerima
-- bahan milik usaha A yang menunjuk produk milik usaha B. Tidak ada query
-- aplikasi yang sengaja melakukannya, tapi "tidak ada yang sengaja" bukan
-- jaminan — itu cuma kebiasaan. Kunci komposit memindahkan jaminannya ke
-- database, yang tidak punya kebiasaan.
--
-- products_tenant_key dan suppliers_tenant_key (UNIQUE (user_id, id)) sudah
-- tersedia, jadi FK komposit bisa langsung menunjuk ke sana.

-- Periksa DULU. Migrasi ini GAGAL KERAS kalau sudah ada tautan yang menyeberang
-- workspace, bukan diam-diam memutusnya jadi NULL. Data yang sudah terlanjur
-- salah adalah temuan yang harus dilihat manusia, bukan sampah yang disapu.
do $cek$
declare v_n bigint;
begin
  select count(*) into v_n
  from public.ingredients i
  join public.products p on p.id = i.source_product_id
  where i.source_product_id is not null and i.user_id is distinct from p.user_id;
  if v_n > 0 then
    raise exception 'DIBATALKAN: % baris ingredients.source_product_id menunjuk produk milik workspace lain. Periksa datanya lebih dulu.', v_n;
  end if;

  select count(*) into v_n
  from public.transactions t
  join public.suppliers s on s.id = t.supplier_id
  where t.supplier_id is not null and t.user_id is distinct from s.user_id;
  if v_n > 0 then
    raise exception 'DIBATALKAN: % baris transactions.supplier_id menunjuk supplier milik workspace lain. Periksa datanya lebih dulu.', v_n;
  end if;
end
$cek$;

-- ON DELETE SET NULL (kolom) — bukan SET NULL polos. Tanpa menyebut kolomnya,
-- Postgres akan mengosongkan user_id juga saat baris induk dihapus, dan user_id
-- itu NOT NULL: penghapusan produk/supplier biasa akan gagal dengan error yang
-- sama sekali tidak menjelaskan sebabnya. Sintaks per-kolom ini butuh PG 15+;
-- project ini di PG 17.
alter table public.ingredients
  drop constraint if exists ingredients_source_product_id_fkey;
alter table public.ingredients
  drop constraint if exists ingredients_source_product_tenant_fkey;
alter table public.ingredients
  add constraint ingredients_source_product_tenant_fkey
  foreign key (user_id, source_product_id)
  references public.products (user_id, id)
  on delete set null (source_product_id);

alter table public.transactions
  drop constraint if exists transactions_supplier_id_fkey;
alter table public.transactions
  drop constraint if exists transactions_supplier_tenant_fkey;
alter table public.transactions
  add constraint transactions_supplier_tenant_fkey
  foreign key (user_id, supplier_id)
  references public.suppliers (user_id, id)
  on delete set null (supplier_id);

-- ------------------------------------------------------------
-- 3. error_logs BUKAN tabel tenant — dan tidak boleh dipaksa jadi tenant
-- ------------------------------------------------------------
--
-- tenancy_lint() menuntut user_id NOT NULL di setiap tabel yang punya kolom
-- user_id dan tidak terdaftar sebagai "shared". error_logs punya kolom itu,
-- jadi ia kena — tapi tuntutannya SALAH untuk tabel ini:
--
--   * error_logs sengaja mencatat kegagalan yang terjadi SEBELUM login.
--     catat_error() menulis user_id NULL kalau auth.uid() kosong. Saat ini 2
--     dari 18 baris memang begitu, dan itu justru kelas error yang paling perlu
--     terlihat — halaman login yang rusak tidak akan pernah punya user_id.
--   * RLS-nya sudah menyatakan sifat tabel ini: baca dan ubah HANYA is_admin().
--     Tidak ada pengguna aplikasi yang bisa melihat baris siapa pun.
--
-- Memaksa NOT NULL di sini berarti membuang jejak error paling penting demi
-- menghijaukan sebuah lint. Yang benar adalah memperbaiki PERTANYAAN lint-nya:
-- error_logs masuk daftar shared, sebaris dengan audit_logs dan app_events yang
-- sifatnya sama persis.
--
-- Selebihnya fungsi ini DISALIN UTUH dari definisi yang berjalan sekarang.
-- Satu-satunya perubahan ada di v_shared.
create or replace function public.tenancy_lint()
returns table(invarian text, objek text, detail text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  -- Tabel yang memang BUKAN milik satu workspace. Menambahkan nama ke sini
  -- berarti menyatakan "tabel ini lintas-akun secara sengaja" — pikirkan dua
  -- kali sebelum melakukannya.
  v_shared text[] := array[
    'admins','app_events','feedback','ai_usage','legal_docs','profiles',
    'staff_members','audit_logs','admin_audit_log',
    'macro_signals','macro_runs','macro_config','commodity_prices','exchange_rates',
    -- Ditambahkan: jejak error seluruh sistem, dibaca admin saja, dan sengaja
    -- menerima user_id NULL untuk error sebelum login.
    'error_logs'
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
end
$function$;

comment on function public.tenancy_lint() is
  'Lint isolasi workspace. Setiap baris yang dikembalikan = satu pelanggaran. Dipanggil public.test_semua() di gerbang CI.';
