-- ============================================================
-- Pembatalan transaksi yang membalik stok — dan buku mutasi yang
-- membuatnya mungkin.
--
-- MENGGANTIKAN rencana lama di migration_pembatalan_stok.sql, yang hilang
-- bersama project Supabase lama dan tidak pernah dikomit.
--
-- KENAPA KOLOM `status` SAJA TIDAK CUKUP
-- Rencana awalnya sederhana: jangan DELETE, cukup tandai 'batal', lalu balikkan
-- stoknya. Masalahnya, saat diperiksa ternyata TIDAK ADA yang bisa dibalikkan:
--
--   * add_transaction_with_stock menerima p_lines (daftar barang + qty),
--     memotong stok tiap baris, lalu MEMBUANG daftarnya. Tidak ada tabel baris
--     transaksi di database ini. Yang tersimpan di baris transaksi hanya satu
--     product_id dan satu qty — transaksi multi-barang tidak meninggalkan jejak.
--
--   * Untuk produk berkemasan, pemotongan tidak bisa dibalik dari qty-nya.
--     consume_pack_stock memakai floor() DAN greatest(0, ...). Kasus K8 di
--     harness: stok 1 pak, kebutuhan 2000 g dari pak 800 g. floor(2,5) = 2 pak
--     turun, tapi penjepitan menahan hasilnya di 0, bukan -1. Mengembalikan
--     "2 pak" menghasilkan 2, padahal semula 1. Penjepitan itu menghancurkan
--     informasinya, dan tidak ada rumus yang bisa memulihkannya dari qty.
--
-- MAKA: yang dicatat adalah SELISIH YANG SUNGGUH TERJADI (sesudah dikurangi
-- sebelum), bukan qty yang diminta. Membatalkan = menegasikan selisih itu.
-- Pada kasus K8 selisihnya -1, jadi pembatalannya +1 dan stok kembali ke 1.
--
-- Cara ini juga yang benar saat ada transaksi LAIN menggerakkan stok yang sama
-- di antaranya. Mengembalikan nilai "sebelum" apa adanya akan menimpa pekerjaan
-- transaksi lain itu; menambahkan selisih hanya mengembalikan bagian yang
-- memang diambil oleh transaksi ini.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Penanda batal di transaksi
-- ------------------------------------------------------------
--
-- Kolom `status` terpisah dari `payment_status` yang sudah ada. Keduanya
-- menjawab pertanyaan berbeda: payment_status soal SUDAH DIBAYAR ATAU BELUM,
-- status soal APAKAH TRANSAKSI INI MASIH BERLAKU. Menumpangkan "batal" ke
-- payment_status akan membuat piutang yang belum lunas tidak bisa dibedakan
-- dari nota yang dibatalkan.
alter table public.transactions
  add column if not exists status text not null default 'aktif',
  add column if not exists dibatalkan_pada timestamptz,
  add column if not exists dibatalkan_oleh uuid,
  add column if not exists alasan_batal text;

do $cek$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_status_check'
  ) then
    alter table public.transactions
      add constraint transactions_status_check check (status in ('aktif','batal'));
  end if;
end
$cek$;

comment on column public.transactions.status is
  'aktif | batal. Transaksi TIDAK PERNAH dihapus — nomor nota yang lenyap merusak jejak audit keuangan. Baris batal wajib dikecualikan dari setiap laporan, dashboard, dan pembacaan AI.';

-- Laporan menyaring status di hampir setiap query, dan hampir semuanya juga
-- menyaring user_id + rentang tanggal.
create index if not exists transactions_aktif_idx
  on public.transactions (user_id, occurred_at desc)
  where status = 'aktif';

-- ------------------------------------------------------------
-- 2. Buku mutasi stok — satu baris per pergerakan yang benar-benar terjadi
-- ------------------------------------------------------------
--
-- Ini juga menjawab pertanyaan yang selama ini tidak bisa dijawab sama sekali:
-- "kenapa stok barang ini berubah?" Sebelumnya stok hanya sebuah angka yang
-- ditimpa, tanpa riwayat.
create table if not exists public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  transaction_id  uuid not null,
  product_id      uuid not null,

  -- SELISIH, bukan nilai absolut, dan bukan qty yang diminta. Negatif =
  -- berkurang. Lihat alasan panjang di kepala berkas.
  stock_delta       numeric not null default 0,
  opened_used_delta numeric not null default 0,

  -- 'langsung' = baris barang transaksi itu sendiri.
  -- 'bom'      = bahan yang ikut terpotong lewat consume_bom_for_sale.
  asal            text not null default 'langsung',

  dibalik_pada    timestamptz,
  created_at      timestamptz not null default now(),

  constraint stock_movements_asal_check check (asal in ('langsung','bom'))
);

-- FK KOMPOSIT sejak awal, bukan ditambal belakangan. tenancy_lint() akan
-- menangkapnya kalau tidak, dan gerbang CI jadi merah — itu memang gunanya.
-- Dua FK non-komposit yang baru saja diperbaiki di migration_tenancy_fk_
-- komposit.sql lahir persis dari kelalaian ini.
do $fk$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_movements_user_id_fkey') then
    alter table public.stock_movements
      add constraint stock_movements_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_movements_transaction_tenant_fkey') then
    alter table public.stock_movements
      add constraint stock_movements_transaction_tenant_fkey
      foreign key (user_id, transaction_id) references public.transactions(user_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_movements_product_tenant_fkey') then
    alter table public.stock_movements
      add constraint stock_movements_product_tenant_fkey
      foreign key (user_id, product_id) references public.products(user_id, id) on delete cascade;
  end if;
end
$fk$;

create index if not exists stock_movements_transaksi_idx
  on public.stock_movements (user_id, transaction_id);
create index if not exists stock_movements_produk_idx
  on public.stock_movements (user_id, product_id, created_at desc);

alter table public.stock_movements enable row level security;

-- Baca: pemilik workspace dan stafnya yang aktif, lewat resolve_owner yang
-- sudah dipakai seluruh sistem. Tidak ada policy INSERT/UPDATE/DELETE: buku
-- mutasi HANYA ditulis oleh fungsi SECURITY DEFINER di bawah. Buku besar yang
-- bisa ditulisi langsung oleh klien bukan buku besar.
drop policy if exists "baca mutasi stok" on public.stock_movements;
create policy "baca mutasi stok" on public.stock_movements
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.staff_members m
       where m.owner_id = public.stock_movements.user_id
         and m.member_id = auth.uid()
         and m.status = 'active'
    )
  );

comment on table public.stock_movements is
  'Buku mutasi stok: satu baris per pergerakan yang benar-benar terjadi, disimpan sebagai SELISIH. Dipakai untuk membalik stok saat transaksi dibatalkan, dan sebagai riwayat "kenapa stok berubah". Hanya ditulis oleh fungsi SECURITY DEFINER.';

-- ------------------------------------------------------------
-- 3. consume_pack_stock melaporkan keadaan SEBELUM juga
-- ------------------------------------------------------------
--
-- Tambahan yang bersifat menambah, bukan mengubah: kunci lama tetap ada persis
-- seperti semula, jadi pemanggil yang sudah ada tidak terpengaruh. Tanpa
-- opened_before, selisih opened_used tidak bisa dihitung oleh pemanggilnya —
-- dan untuk produk berkemasan, itu separuh dari pergerakan yang terjadi.
create or replace function public.consume_pack_stock(p_product_id uuid, p_need numeric, p_owner uuid)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
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
    -- DIUBAH dari `v_used := 0`. Cabang ini tidak pernah menulis opened_used ke
    -- tabel, jadi melaporkannya sebagai 0 adalah bohong kecil yang jadi mahal
    -- di tempat baru: pemanggil menghitung selisih opened_used dari (sesudah -
    -- sebelum), dan 0 - sebelum menghasilkan selisih palsu yang, saat
    -- dibatalkan, akan menambah stok terbuka yang tidak pernah diambil.
    -- Nilai sebenarnya tidak berubah, jadi selisihnya nol — dan itu yang benar.
    v_used  := coalesce(v_p.opened_used, 0);
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
    'opened_used', v_used,
    -- BARU. Nama 'opened_used' terlanjur dipakai untuk nilai SESUDAH, jadi yang
    -- sebelum diberi nama sendiri daripada mengubah arti kunci yang sudah ada.
    'opened_before', coalesce(v_p.opened_used, 0)
  );
end $function$;

-- ------------------------------------------------------------
-- 4. add_transaction_with_stock mencatat apa yang digerakkannya
-- ------------------------------------------------------------
create or replace function public.add_transaction_with_stock(
  p_tx jsonb, p_lines jsonb default '[]'::jsonb, p_owner uuid default null
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
  v_satu jsonb;
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

    -- Selisih yang SUNGGUH terjadi, bukan v_qty. Kalau greatest(0, ...)
    -- menjepit hasilnya, selisihnya lebih kecil dari qty — dan justru selisih
    -- itulah yang harus dikembalikan saat dibatalkan.
    insert into public.stock_movements
      (user_id, transaction_id, product_id, stock_delta, opened_used_delta, asal)
    values
      (v_owner, v_txn.id, v_p.id, v_after - coalesce(v_p.stock, 0), 0, 'langsung');

    v_changes := v_changes || jsonb_build_object(
      'name', v_p.name, 'unit', v_p.unit,
      'before', coalesce(v_p.stock, 0), 'after', v_after);

    -- Penjualan (direction 'in') produk ber-komposisi ikut memotong stok
    -- bahan penyusunnya. Pembelian ('out') tidak: menambah stok barang jadi
    -- tidak boleh menambah balik stok bahan yang sudah terpakai.
    if v_dir = 'in' then
      v_bom := public.consume_bom_for_sale(v_p.id, v_qty, v_owner);
      if v_bom is not null and jsonb_array_length(v_bom) > 0 then
        for v_satu in select * from jsonb_array_elements(v_bom) loop
          insert into public.stock_movements
            (user_id, transaction_id, product_id, stock_delta, opened_used_delta, asal)
          values (
            v_owner, v_txn.id, (v_satu->>'product_id')::uuid,
            (v_satu->>'after')::numeric - (v_satu->>'before')::numeric,
            (v_satu->>'opened_used')::numeric - coalesce((v_satu->>'opened_before')::numeric, 0),
            'bom');
        end loop;
        v_changes := v_changes || v_bom;
      end if;
    end if;
  end loop;

  return jsonb_build_object('txn', to_jsonb(v_txn), 'changes', v_changes);
end $function$;

-- ------------------------------------------------------------
-- 5. Pembalikan stok saat status berubah jadi 'batal'
-- ------------------------------------------------------------
--
-- Trigger, bukan sekadar fungsi yang harus diingat untuk dipanggil. Siapa pun
-- yang mengubah status — RPC, admin lewat SQL, perbaikan data manual — ikut
-- terkena. Penjaga yang bergantung pada ingatan bukan penjaga.
create or replace function public.balikkan_stok_transaksi()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
begin
  -- Hanya pada perpindahan aktif -> batal. Menandai ulang baris yang sudah
  -- batal TIDAK boleh membalik stok dua kali; `dibalik_pada` menjaga
  -- idempotensi bahkan bila trigger ini terpanggil berulang.
  if new.status <> 'batal' or coalesce(old.status, 'aktif') = 'batal' then
    return new;
  end if;

  for r in
    select * from public.stock_movements
     where transaction_id = new.id and user_id = new.user_id and dibalik_pada is null
     for update
  loop
    update public.products
       set stock = greatest(0, coalesce(stock, 0) - r.stock_delta),
           opened_used = greatest(0, coalesce(opened_used, 0) - r.opened_used_delta),
           updated_at = now()
     where id = r.product_id and user_id = r.user_id;

    update public.stock_movements set dibalik_pada = now() where id = r.id;
  end loop;

  new.dibatalkan_pada := coalesce(new.dibatalkan_pada, now());
  new.dibatalkan_oleh := coalesce(new.dibatalkan_oleh, auth.uid());
  return new;
end $function$;

drop trigger if exists trg_balikkan_stok on public.transactions;
create trigger trg_balikkan_stok
  before update of status on public.transactions
  for each row execute function public.balikkan_stok_transaksi();

-- ------------------------------------------------------------
-- 6. DELETE ditutup — inti dari seluruh perubahan ini
-- ------------------------------------------------------------
--
-- Tanpa ini, seluruh jejak audit di atas hanya sebuah anjuran. Satu
-- `delete from transactions` dari klien mana pun tetap melenyapkan notanya,
-- dan cascade ikut menghapus buku mutasinya sekalian — menghilangkan justru
-- bukti yang dibangun untuk mencegahnya.
create or replace function public.tolak_hapus_transaksi()
returns trigger
language plpgsql
as $function$
begin
  raise exception
    'Transaksi tidak boleh dihapus. Batalkan dengan mengubah status menjadi "batal" — stoknya akan dibalik otomatis dan notanya tetap terekam.'
    using errcode = 'restrict_violation';
end $function$;

drop trigger if exists trg_tolak_hapus_transaksi on public.transactions;
create trigger trg_tolak_hapus_transaksi
  before delete on public.transactions
  for each row execute function public.tolak_hapus_transaksi();

-- ------------------------------------------------------------
-- 7. Pintu pembatalan untuk aplikasi
-- ------------------------------------------------------------
create or replace function public.batalkan_transaksi(
  p_id uuid, p_alasan text default null, p_owner uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner uuid := public.resolve_owner(p_owner);
  v_txn   transactions;
  v_changes jsonb;
begin
  select * into v_txn from public.transactions
   where id = p_id and user_id = v_owner for update;
  if not found then
    raise exception 'Transaksi tidak ditemukan.' using errcode = 'no_data_found';
  end if;
  if v_txn.status = 'batal' then
    -- Bukan error: membatalkan yang sudah batal adalah permintaan yang sudah
    -- terpenuhi. Melemparnya sebagai error hanya membuat klien menampilkan
    -- kegagalan untuk keadaan yang sebenarnya benar.
    return jsonb_build_object(
      'id', v_txn.id, 'status', 'batal', 'berubah', false, 'changes', '[]'::jsonb);
  end if;

  update public.transactions
     set status = 'batal', alasan_batal = nullif(p_alasan, '')
   where id = p_id and user_id = v_owner;

  -- Dibaca SESUDAH update, karena trigger-lah yang membalik stoknya. UI memakai
  -- ini untuk memberi tahu apa yang dipulihkan — membatalkan diam-diam membuat
  -- pengguna tidak punya cara tahu stoknya sudah benar lagi atau belum.
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', p.name,
           'unit', coalesce(p.content_unit, p.unit),
           'dipulihkan', -m.stock_delta,
           -- Pembalikan sudah terjadi (stock = stock - stock_delta), jadi
           -- keadaan SEBELUM pembalikan dihitung mundur dari nilai sekarang.
           -- UI menampilkannya sebagai "sebelum -> sesudah".
           'before', p.stock + m.stock_delta,
           'after', p.stock)), '[]'::jsonb)
    into v_changes
    from public.stock_movements m
    join public.products p on p.id = m.product_id and p.user_id = m.user_id
   where m.transaction_id = p_id and m.user_id = v_owner and m.dibalik_pada is not null;

  return jsonb_build_object(
    'id', p_id, 'status', 'batal', 'berubah', true, 'changes', v_changes);
end $function$;

revoke all on function public.batalkan_transaksi(uuid, text, uuid) from public;
grant execute on function public.batalkan_transaksi(uuid, text, uuid) to authenticated;

comment on function public.batalkan_transaksi(uuid, text, uuid) is
  'Membatalkan transaksi: status jadi batal, stok dibalik lewat trigger, nota tetap terekam. Idempoten.';

-- ------------------------------------------------------------
-- 8. test_pembatalan() — 8 kasus, masuk gerbang CI
-- ------------------------------------------------------------
--
-- Menggantikan test_pembatalan() lama yang hilang bersama project Supabase
-- lama. Strukturnya sama dengan test_bom(): akun auth.users sintetis yang
-- dihapus di akhir, tidak menumpang akun siapa pun.
create or replace function public.test_pembatalan()
returns table(suite text, kasus text, hasil text, lulus boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid   uuid := 'dbdbdbdb-0000-4000-8000-000000000003';
  v_pak   uuid;
  v_jual  uuid;
  v_bahan uuid;
  v_tx    uuid;
  v_tx2   uuid;
  v_hasil jsonb;
  v_stok  numeric;
  v_buka  numeric;
  v_teks  text;
begin
  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
  insert into auth.users (id, email) values (v_uid, 'uji-batal@contoh.invalid');
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  insert into public.products (user_id, name, kind, unit, content_unit, pack_size, opened_used, stock)
  values (v_uid, 'UJI Tepung 800g', 'bahan', 'pak', 'gram', 800, 0, 12) returning id into v_pak;
  insert into public.products (user_id, name, kind, unit, stock, has_bom)
  values (v_uid, 'UJI Roti', 'jual', 'pcs', 100, true) returning id into v_jual;
  insert into public.ingredients (user_id, name, type, unit, source_product_id)
  values (v_uid, 'UJI Tepung', 'bahan', 'gram', v_pak) returning id into v_bahan;
  insert into public.product_boms (user_id, product_id, ingredient_id, qty_per_unit, deduct_stock)
  values (v_uid, v_jual, v_bahan, 250, true);

  -- P1 — transaksi baru berstatus aktif tanpa diminta.
  v_hasil := public.add_transaction_with_stock(
    jsonb_build_object('description','UJI jual roti','amount',50000,'direction','in'),
    jsonb_build_array(jsonb_build_object('productId', v_jual, 'qty', 2)), v_uid);
  v_tx := (v_hasil->'txn'->>'id')::uuid;
  select status into v_teks from public.transactions where id = v_tx;
  return query select * from public.uji_kasus('pembatalan',
    'P1 transaksi baru berstatus aktif', 'aktif', v_teks);

  -- P2 — stok produk jual dan bahan memang bergerak lebih dulu. Tanpa kasus
  -- ini, P3 dan P4 bisa hijau hanya karena tidak ada yang pernah bergerak.
  select trim_scale(stock) into v_stok from public.products where id = v_jual;
  select trim_scale(opened_used) into v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('pembatalan',
    'P2 penjualan memotong produk jual DAN bahan penyusunnya',
    'jual=98 terbuka=500', format('jual=%s terbuka=%s', v_stok, v_buka));

  -- P3 — pembatalan mengembalikan stok produk jual.
  perform public.batalkan_transaksi(v_tx, 'uji', v_uid);
  select trim_scale(stock) into v_stok from public.products where id = v_jual;
  return query select * from public.uji_kasus('pembatalan',
    'P3 pembatalan mengembalikan stok produk jual', 'jual=100', format('jual=%s', v_stok));

  -- P4 — dan stok BAHAN, yang dulu berkurang selamanya tanpa jalan pulang.
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka
    from public.products where id = v_pak;
  return query select * from public.uji_kasus('pembatalan',
    'P4 pembalikan ikut memulihkan stok bahan (BOM)',
    'pak=12 terbuka=0', format('pak=%s terbuka=%s', v_stok, v_buka));

  -- P5 — IDEMPOTEN. Kasus yang paling mudah salah: membatalkan dua kali tidak
  -- boleh menambah stok dua kali. Tanpa penanda dibalik_pada, klik ganda pada
  -- tombol batal sudah cukup untuk melahirkan stok dari udara.
  perform public.batalkan_transaksi(v_tx, 'uji lagi', v_uid);
  select trim_scale(stock) into v_stok from public.products where id = v_jual;
  return query select * from public.uji_kasus('pembatalan',
    'P5 membatalkan dua kali TIDAK menambah stok dua kali',
    'jual=100', format('jual=%s', v_stok));

  -- P6 — nota tetap ada. Inti dari seluruh perubahan ini.
  select count(*)::text into v_teks from public.transactions where id = v_tx;
  return query select * from public.uji_kasus('pembatalan',
    'P6 nota tetap tersimpan setelah dibatalkan', '1', v_teks);

  -- P7 — DELETE ditolak DATABASE, bukan sekadar dihindari aplikasi. Kalau
  -- penolakannya hanya ada di aplikasi, ia bukan jaminan — cuma kebiasaan.
  begin
    delete from public.transactions where id = v_tx;
    v_teks := 'TIDAK DITOLAK';
  exception when others then
    v_teks := 'ditolak';
  end;
  return query select * from public.uji_kasus('pembatalan',
    'P7 penghapusan transaksi ditolak database', 'ditolak', v_teks);

  -- P8 — pembatalan satu transaksi tidak menyentuh transaksi lain.
  v_hasil := public.add_transaction_with_stock(
    jsonb_build_object('description','UJI jual kedua','amount',25000,'direction','in'),
    jsonb_build_array(jsonb_build_object('productId', v_jual, 'qty', 1)), v_uid);
  v_tx2 := (v_hasil->'txn'->>'id')::uuid;
  perform public.batalkan_transaksi(v_tx, 'sudah batal', v_uid);
  select trim_scale(stock) into v_stok from public.products where id = v_jual;
  return query select * from public.uji_kasus('pembatalan',
    'P8 membatalkan transaksi lain tidak mengusik yang masih aktif',
    'jual=99', format('jual=%s', v_stok));

  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
  return;

exception when others then
  return query select * from public.uji_kasus('pembatalan',
    'harness pembatalan gagal sebelum selesai', 'tanpa error', sqlstate || ' ' || sqlerrm);
  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
  return;
end
$function$;

comment on function public.test_pembatalan() is
  '8 kasus pembatalan transaksi: pembalikan stok langsung dan BOM, idempotensi, nota yang tetap ada, dan penolakan DELETE di level database.';

-- test_semua() ikut memanggilnya. Tanpa baris ini, seluruh 8 kasus di atas
-- hanya bisa dijalankan oleh orang yang INGAT menjalankannya — dan itu persis
-- cara harness sebelumnya berakhir tidak pernah dijalankan sama sekali.
create or replace function public.test_semua()
returns table(suite text, kasus text, hasil text, lulus boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_n bigint;
begin
  return query select * from public.test_bom();
  return query select * from public.test_pembatalan();

  select count(*) into v_n from public.rls_lint();
  if v_n = 0 then
    return query select * from public.uji_kasus('rls_lint',
      'tidak ada baris yang bocor lintas pengguna', '0 pelanggaran', '0 pelanggaran');
  else
    for r in select * from public.rls_lint() loop
      return query select * from public.uji_kasus('rls_lint',
        r.invarian || ' @ ' || r.objek, 'tidak ada pelanggaran', r.detail);
    end loop;
  end if;

  select count(*) into v_n from public.tenancy_lint();
  if v_n = 0 then
    return query select * from public.uji_kasus('tenancy_lint',
      'isolasi workspace utuh', '0 pelanggaran', '0 pelanggaran');
  else
    for r in select * from public.tenancy_lint() loop
      return query select * from public.uji_kasus('tenancy_lint',
        r.invarian || ' @ ' || r.objek, 'tidak ada pelanggaran', r.detail);
    end loop;
  end if;

  return;
end
$function$;
