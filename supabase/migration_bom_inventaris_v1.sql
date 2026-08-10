-- ============================================================
-- P7 / P8 / P10 / P11 — BOM opsional, konversi satuan kemasan, pemisahan
-- inventaris (bahan baku vs produk jual), estimasi yield, pengurangan stok
-- otomatis saat penjualan, dan relasi pemasok pada transaksi.
--
-- Terpasang di project hexaidoxmeycctpwfbst sebagai tiga migrasi:
--   bom_inventaris_konversi_v1
--   bom_auto_deduction_v1
--   add_transaction_with_stock_bom
-- ============================================================
--
-- KEPUTUSAN MODEL DATA (baca sebelum mengubah apa pun):
--
-- Bahan baku TIDAK dipindah ke tabel baru. Data pengguna yang sudah ada
-- menyimpan bahan baku sebagai `products` (contoh nyata dari layar pengguna:
-- "Stok tepung terigu tinggal 12 dus" muncul di halaman Stok Produk). Membuat
-- tabel stok kedua akan memecah stok yang sama ke dua tempat dan mematikan
-- Purchase Order, Stock Opname, serta Riwayat Stok yang semuanya sudah bekerja
-- di atas `products`.
--
-- Jadi: SATU tabel stok (`products`) dengan kolom penanda `kind`, ditampilkan
-- sebagai dua daftar terpisah di antarmuka. `ingredients` tetap menjadi master
-- KOMPONEN BIAYA HPP — termasuk komponen yang memang tidak punya stok sama
-- sekali (tenaga kerja, listrik, sewa) — dan kini bisa menunjuk ke produk stok
-- lewat source_product_id bila komponen itu barang fisik.

-- ------------------------------------------------------------
-- 1. products: dua kategori inventaris + konversi kemasan
-- ------------------------------------------------------------
alter table public.products
  add column if not exists kind text not null default 'jual',
  -- Isi per satuan stok. Contoh: unit='bungkus', pack_size=800, content_unit='gram'.
  -- 0 berarti tidak memakai konversi (barang dihitung per satuan utuh).
  add column if not exists pack_size numeric not null default 0,
  add column if not exists content_unit text,
  -- Akumulasi pemakaian dari kemasan yang sedang terbuka, dalam content_unit.
  -- Saat mencapai pack_size, stock berkurang 1 dan sisanya dibawa ke kemasan berikutnya.
  add column if not exists opened_used numeric not null default 0,
  add column if not exists has_bom boolean not null default false,
  add column if not exists description text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_kind_check') then
    alter table public.products
      add constraint products_kind_check check (kind in ('jual', 'bahan'));
  end if;
end $$;

create index if not exists products_kind_idx on public.products (user_id, kind);

-- ------------------------------------------------------------
-- 2. ingredients: harga per kemasan -> harga per satuan
-- ------------------------------------------------------------
--
-- Ini akar bug "1200 terbaca 12000" (P7). Pengguna tahu harga belanjanya per
-- KEMASAN ("satu bungkus Rp 12.000 isi 800 gram"), tapi kolom yang tersedia
-- hanya "harga per satuan". Mereka mengisi angka kemasan di kolom satuan, lalu
-- dikalikan takaran resep — sehingga 10 gram tepung tampak berharga Rp 12.000.
-- Dengan pack_price + pack_size, harga per satuan DIHITUNG, bukan ditebak.
alter table public.ingredients
  add column if not exists pack_size numeric not null default 0,
  add column if not exists pack_price numeric not null default 0,
  add column if not exists source_product_id uuid references public.products(id) on delete set null;

create index if not exists ingredients_source_product_idx on public.ingredients (source_product_id);

-- ------------------------------------------------------------
-- 3. product_boms: biaya per periode + kendali pengurangan stok
-- ------------------------------------------------------------
alter table public.product_boms
  add column if not exists cost_basis text not null default 'per_unit',
  -- Biaya yang dibayar per periode (sewa tempat, gaji, listrik bulanan).
  add column if not exists period_amount numeric not null default 0,
  -- Perkiraan jumlah produk yang dihasilkan dalam periode itu.
  -- Biaya per unit = period_amount / period_output.
  add column if not exists period_output numeric not null default 0,
  -- Pengguna menentukan sendiri baris mana yang memotong stok saat produk
  -- terjual. Default false: mengaktifkannya diam-diam pada data lama akan
  -- mulai mengurangi stok tanpa pemilik usaha pernah memintanya.
  add column if not exists deduct_stock boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_boms_cost_basis_check') then
    alter table public.product_boms
      add constraint product_boms_cost_basis_check check (cost_basis in ('per_unit', 'per_periode'));
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. transactions: relasi pemasok (P11)
-- ------------------------------------------------------------
alter table public.transactions
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;

create index if not exists transactions_supplier_idx on public.transactions (user_id, supplier_id);

-- ------------------------------------------------------------
-- 5. Pengurangan stok berbasis kemasan
-- ------------------------------------------------------------
--
-- Aturan kemasan (permintaan produk): stok utama tetap tampil sebagai jumlah
-- kemasan grosir ("12 bungkus"). Pemakaian dicatat sebagai akumulasi di
-- opened_used; begitu mencapai isi satu kemasan (pack_size), jumlah kemasan
-- berkurang satu dan sisanya dibawa ke kemasan berikutnya.
--
-- pack_size = 0 berarti produk tidak memakai konversi: takaran resep dianggap
-- langsung dalam satuan stoknya (mis. 2 butir telur dari stok 30 butir).
create or replace function public.consume_pack_stock(
  p_product_id uuid,
  p_need numeric,
  p_owner uuid
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_p       record;
  v_size    numeric;
  v_total   numeric;
  v_down    numeric;
  v_after   numeric;
  v_used    numeric;
begin
  if p_need is null or p_need <= 0 then return null; end if;

  select id, name, unit, stock, pack_size, opened_used, content_unit
    into v_p
    from products
   where id = p_product_id and user_id = p_owner
   for update;
  if not found then return null; end if;

  v_size := coalesce(v_p.pack_size, 0);

  if v_size > 0 then
    v_total := coalesce(v_p.opened_used, 0) + p_need;
    v_down  := floor(v_total / v_size);
    v_used  := v_total - (v_down * v_size);
    v_after := greatest(0, coalesce(v_p.stock, 0) - v_down);
    update products
       set stock = v_after, opened_used = v_used, updated_at = now()
     where id = v_p.id and user_id = p_owner;
  else
    v_used  := 0;
    v_after := greatest(0, coalesce(v_p.stock, 0) - p_need);
    update products
       set stock = v_after, updated_at = now()
     where id = v_p.id and user_id = p_owner;
  end if;

  return jsonb_build_object(
    'product_id', v_p.id,
    'name',       v_p.name,
    'unit',       v_p.unit,
    'before',     coalesce(v_p.stock, 0),
    'after',      v_after,
    'used',       p_need,
    'used_unit',  coalesce(v_p.content_unit, v_p.unit),
    'opened_used', v_used
  );
end $$;

-- Menjalankan seluruh komposisi satu produk untuk p_qty unit terjual.
-- Hanya baris BOM yang (a) ditandai deduct_stock oleh pengguna dan
-- (b) bahannya tertaut ke produk stok (source_product_id) yang memotong stok.
-- Baris biaya seperti tenaga kerja atau listrik ikut membentuk HPP tapi tidak
-- punya stok untuk dikurangi — penyaringan ini syarat kebenaran, bukan optimasi.
create or replace function public.consume_bom_for_sale(
  p_product_id uuid,
  p_qty numeric,
  p_owner uuid
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_has_bom boolean;
  v_row     record;
  v_one     jsonb;
  v_out     jsonb := '[]'::jsonb;
begin
  if p_qty is null or p_qty <= 0 then return v_out; end if;

  select has_bom into v_has_bom
    from products where id = p_product_id and user_id = p_owner;
  if not coalesce(v_has_bom, false) then return v_out; end if;

  for v_row in
    select b.qty_per_unit, i.source_product_id
      from product_boms b
      join ingredients i on i.id = b.ingredient_id
     where b.product_id = p_product_id
       and b.user_id = p_owner
       and b.deduct_stock is true
       and i.source_product_id is not null
       and coalesce(b.qty_per_unit, 0) > 0
  loop
    v_one := public.consume_pack_stock(v_row.source_product_id, v_row.qty_per_unit * p_qty, p_owner);
    if v_one is not null then v_out := v_out || v_one; end if;
  end loop;

  return v_out;
end $$;

-- Estimasi berapa unit produk yang masih bisa dibuat dari sisa stok bahan.
-- Mengembalikan batas per bahan supaya antarmuka bisa menunjukkan bahan MANA
-- yang menjadi penghambat, bukan cuma angka akhirnya.
create or replace function public.product_yield(p_product_id uuid, p_owner uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_owner uuid := public.resolve_owner(p_owner);
  v_row   record;
  v_avail numeric;
  v_can   numeric;
  v_min   numeric := null;
  v_parts jsonb := '[]'::jsonb;
begin
  for v_row in
    select b.qty_per_unit, i.name as ingredient_name,
           p.id as pid, p.name as product_name, p.unit, p.stock, p.pack_size,
           p.opened_used, p.content_unit
      from product_boms b
      join ingredients i on i.id = b.ingredient_id
      join products p    on p.id = i.source_product_id
     where b.product_id = p_product_id
       and b.user_id = v_owner
       and b.deduct_stock is true
       and coalesce(b.qty_per_unit, 0) > 0
  loop
    if coalesce(v_row.pack_size, 0) > 0 then
      v_avail := (coalesce(v_row.stock, 0) * v_row.pack_size) - coalesce(v_row.opened_used, 0);
    else
      v_avail := coalesce(v_row.stock, 0);
    end if;
    v_avail := greatest(0, v_avail);
    v_can := floor(v_avail / v_row.qty_per_unit);
    if v_min is null or v_can < v_min then v_min := v_can; end if;

    v_parts := v_parts || jsonb_build_object(
      'ingredient', v_row.ingredient_name,
      'product',    v_row.product_name,
      'available',  v_avail,
      'unit',       coalesce(v_row.content_unit, v_row.unit),
      'per_unit',   v_row.qty_per_unit,
      'can_make',   v_can
    );
  end loop;

  return jsonb_build_object('yield', v_min, 'parts', v_parts);
end $$;

grant execute on function public.consume_pack_stock(uuid, numeric, uuid)   to authenticated;
grant execute on function public.consume_bom_for_sale(uuid, numeric, uuid) to authenticated;
grant execute on function public.product_yield(uuid, uuid)                 to authenticated;

-- ------------------------------------------------------------
-- 6. Sambungkan ke jalur transaksi atomik yang sudah ada
-- ------------------------------------------------------------
--
-- Diletakkan di dalam RPC, bukan di klien, karena satu penjualan harus
-- menghasilkan SATU transaksi database: kalau pemotongan bahan gagal,
-- transaksinya ikut batal. Memisahkannya jadi dua panggilan akan menciptakan
-- penjualan tercatat dengan stok bahan yang tidak pernah berkurang — persis
-- kelas bug yang dulu diperbaiki lewat migrasi atomic_ops_v1.
create or replace function public.add_transaction_with_stock(
  p_tx jsonb,
  p_lines jsonb default '[]'::jsonb,
  p_owner uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner uuid := public.resolve_owner(p_owner);
  v_dir text := p_tx->>'direction';
  v_txn transactions;
  v_l jsonb;
  v_qty numeric;
  v_p record;
  v_after numeric;
  v_changes jsonb := '[]'::jsonb;
  v_bom jsonb;
begin
  if v_dir not in ('in','out') then
    raise exception 'Jenis transaksi tidak dikenal.';
  end if;

  insert into transactions
    (user_id, description, amount, direction, category, channel, occurred_at,
     payment_status, due_date, customer_name, customer_contact, product_id, qty,
     supplier_id)
  values
    (v_owner,
     p_tx->>'description',
     (p_tx->>'amount')::numeric,
     v_dir,
     coalesce(nullif(p_tx->>'category',''), 'Lain-lain'),
     coalesce(nullif(p_tx->>'channel',''), 'manual'),
     coalesce((p_tx->>'occurred_at')::timestamptz, now()),
     coalesce(nullif(p_tx->>'payment_status',''), 'lunas'),
     nullif(p_tx->>'due_date','')::date,
     nullif(p_tx->>'customer_name',''),
     nullif(p_tx->>'customer_contact',''),
     nullif(p_tx->>'product_id','')::uuid,
     nullif(p_tx->>'qty','')::numeric,
     nullif(p_tx->>'supplier_id','')::uuid)
  returning * into v_txn;

  for v_l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := coalesce(nullif(v_l->>'qty','')::numeric, 0);
    if nullif(v_l->>'productId','') is null or v_qty <= 0 then continue; end if;
    select id, stock, name, unit into v_p
      from products where id = (v_l->>'productId')::uuid and user_id = v_owner
      for update;
    if not found then continue; end if;
    v_after := greatest(0, coalesce(v_p.stock, 0) + case when v_dir = 'out' then v_qty else -v_qty end);
    update products set stock = v_after, updated_at = now()
      where id = v_p.id and user_id = v_owner;
    v_changes := v_changes || jsonb_build_object(
      'name', v_p.name, 'unit', v_p.unit,
      'before', coalesce(v_p.stock, 0), 'after', v_after);

    -- Penjualan (direction 'in') produk ber-komposisi ikut memotong stok
    -- bahan penyusunnya. Pembelian ('out') tidak: menambah stok barang jadi
    -- tidak boleh menambah balik stok bahan yang sudah terpakai.
    if v_dir = 'in' then
      v_bom := public.consume_bom_for_sale(v_p.id, v_qty, v_owner);
      if v_bom is not null and jsonb_array_length(v_bom) > 0 then
        v_changes := v_changes || v_bom;
      end if;
    end if;
  end loop;

  return jsonb_build_object('txn', to_jsonb(v_txn), 'changes', v_changes);
end $function$;

-- ------------------------------------------------------------
-- VERIFIKASI E2E (dijalankan 7 Agu 2026, data uji sudah dibersihkan)
-- ------------------------------------------------------------
-- Bahan  : "Tepung Terigu" unit=bungkus, stock=12, pack_size=800, content_unit=gram
-- Produk : "Roti" has_bom=true, BOM 100 gram/pcs, deduct_stock=true
--
--   yield awal                 -> 96 pcs   (12 x 800 / 100)
--   jual 3 pcs (300 gram)      -> stok tetap 12 bungkus, opened_used 300
--   jual 6 pcs (600 gram)      -> kumulatif 900 > 800: stok 12 -> 11, opened_used 100
--   yield setelah              -> 87 pcs   ((11 x 800 - 100) / 100)
