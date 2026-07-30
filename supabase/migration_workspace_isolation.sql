-- ============================================================
-- ISOLASI WORKSPACE — PERBAIKAN KRITIS
--
-- GEJALA: staf masuk ke usaha owner lalu kembali ke usahanya sendiri, dan
-- seluruh data usaha owner tampak ikut "ter-copy" ke usaha staf.
--
-- PENYEBABNYA TIGA, saling menumpuk:
--
-- 1. `effective_owner()` MENGABAIKAN workspace yang dipilih klien:
--
--      select coalesce(
--        (select owner_id from staff_members
--          where member_id = auth.uid() and status = 'active' limit 1),
--        auth.uid()
--      );
--
--    Begitu seseorang menjadi staf AKTIF di satu usaha, fungsi ini SELALU
--    mengembalikan owner_id usaha itu — termasuk ketika staf sedang bekerja di
--    usahanya SENDIRI. Karena add_transaction_with_stock() dan
--    receive_purchase_order() memakainya sebagai user_id, setiap transaksi yang
--    staf catat di usahanya sendiri justru tersimpan ke usaha owner. `limit 1`
--    tanpa ORDER BY juga membuat pilihannya tidak deterministik bila staf aktif
--    di lebih dari satu usaha.
--
-- 2. post_stock_opname() dan receive_purchase_order() menyentuh baris HANYA
--    berdasarkan id, tanpa memeriksa pemiliknya. RLS mengizinkan karena policy
--    staf berbunyi `has_access(user_id, modul)`, yang tidak tahu workspace
--    aktif. Jadi opname/penerimaan PO bisa menimpa stok produk usaha lain.
--
-- 3. my_monthly_summary() mengunci `user_id = auth.uid()`, sehingga staf yang
--    membuka usaha owner justru melihat rekap bulanan angkanya sendiri.
--
-- POLA PERBAIKAN: workspace tujuan menjadi ARGUMEN EKSPLISIT (p_owner) yang
-- diverifikasi di server terhadap keanggotaan aktif, dan GAGAL TERTUTUP
-- (raise) bila tidak sah — tidak lagi coalesce diam-diam ke nilai lain.
--
-- Badan setiap fungsi di bawah SAMA dengan versi terpasang; yang ditambahkan
-- hanya parameter p_owner, pemakaian v_owner, dan syarat `user_id = v_owner`.
-- ============================================================

-- ---------- 1. Penyelesai pemilik yang eksplisit & terverifikasi ----------
-- p_owner null / sama dengan pemanggil  -> workspace pemanggil sendiri.
-- p_owner milik orang lain              -> wajib ada keanggotaan AKTIF,
--                                          kalau tidak: exception.
create or replace function public.resolve_owner(p_owner uuid)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Harus masuk (login).' using errcode = 'insufficient_privilege';
  end if;
  if p_owner is null or p_owner = v_uid then
    return v_uid;
  end if;
  if exists (
    select 1 from public.staff_members m
     where m.owner_id = p_owner and m.member_id = v_uid and m.status = 'active'
  ) then
    return p_owner;
  end if;
  raise exception 'Anda tidak punya akses aktif ke usaha tersebut.'
    using errcode = 'insufficient_privilege';
end $$;

revoke all on function public.resolve_owner(uuid) from public;
grant execute on function public.resolve_owner(uuid) to authenticated;

-- ---------- 2. effective_owner() lama dibuat AMAN ----------
-- Klien lama (yang masih ter-deploy di Vercel) memanggil RPC tanpa p_owner.
-- Daripada membiarkannya menulis ke usaha orang lain, versi tanpa argumen ini
-- sekarang HANYA mengembalikan workspace pemanggil sendiri. Efeknya: klien lama
-- menulis ke usahanya sendiri (benar untuk owner, aman untuk staf) sampai
-- frontend baru yang mengirim p_owner ter-deploy.
create or replace function public.effective_owner()
returns uuid
language sql stable security definer set search_path = public as $$
  select auth.uid();
$$;

-- ---------- 3. Transaksi + stok ----------
create or replace function public.add_transaction_with_stock(
  p_tx jsonb,
  p_lines jsonb default '[]'::jsonb,
  p_owner uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := public.resolve_owner(p_owner);
  v_dir text := p_tx->>'direction';
  v_txn transactions;
  v_l jsonb;
  v_qty numeric;
  v_p record;
  v_after numeric;
  v_changes jsonb := '[]'::jsonb;
begin
  if v_dir not in ('in','out') then
    raise exception 'Jenis transaksi tidak dikenal.';
  end if;

  insert into transactions
    (user_id, description, amount, direction, category, channel, occurred_at,
     payment_status, due_date, customer_name, customer_contact, product_id, qty)
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
     nullif(p_tx->>'qty','')::numeric)
  returning * into v_txn;

  for v_l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := coalesce(nullif(v_l->>'qty','')::numeric, 0);
    if nullif(v_l->>'productId','') is null or v_qty <= 0 then continue; end if;
    -- `and user_id = v_owner` adalah tambahannya: tanpa syarat ini, id produk
    -- dari usaha lain ikut bisa disesuaikan stoknya.
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
  end loop;

  return jsonb_build_object('txn', to_jsonb(v_txn), 'changes', v_changes);
end $$;

revoke all on function public.add_transaction_with_stock(jsonb, jsonb, uuid) from public;
grant execute on function public.add_transaction_with_stock(jsonb, jsonb, uuid) to authenticated;

-- ---------- 4. Opname: sesi & produk wajib satu workspace ----------
create or replace function public.post_stock_opname(
  p_opname_id uuid,
  p_items jsonb,
  p_owner uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := public.resolve_owner(p_owner);
  v_so stock_opnames;
  v_it jsonb;
  v_counted numeric;
  v_sys numeric;
  v_changes jsonb := '[]'::jsonb;
  v_so2 stock_opnames;
  v_hit int;
begin
  select * into v_so from stock_opnames
   where id = p_opname_id and user_id = v_owner for update;
  if not found then
    raise exception 'Sesi opname tidak ditemukan.';
  end if;
  if v_so.status <> 'draft' then
    raise exception 'Sesi opname ini bukan draf aktif.';
  end if;

  for v_it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if nullif(v_it->>'counted_qty','') is null then continue; end if;
    v_counted := (v_it->>'counted_qty')::numeric;
    v_sys := coalesce(nullif(v_it->>'system_qty','')::numeric, 0);
    if v_counted = v_sys then continue; end if;
    -- `and user_id = v_owner` adalah inti perbaikannya: versi lama menimpa stok
    -- hanya berdasarkan id produk, sehingga produk usaha lain ikut tertimpa.
    update products set stock = v_counted, updated_at = now()
      where id = (v_it->>'product_id')::uuid and user_id = v_owner;
    get diagnostics v_hit = row_count;
    if v_hit > 0 then
      v_changes := v_changes || jsonb_build_object(
        'name', v_it->>'name', 'unit', v_it->>'unit',
        'before', v_sys, 'after', v_counted);
    end if;
  end loop;

  update stock_opnames
    set status = 'posted', posted_at = now(), items = coalesce(p_items, items)
    where id = v_so.id and user_id = v_owner
    returning * into v_so2;

  return jsonb_build_object('opname', to_jsonb(v_so2), 'changes', v_changes);
end $$;

revoke all on function public.post_stock_opname(uuid, jsonb, uuid) from public;
grant execute on function public.post_stock_opname(uuid, jsonb, uuid) to authenticated;

-- ---------- 5. Penerimaan PO ----------
create or replace function public.receive_purchase_order(
  p_po_id uuid,
  p_create_expense boolean default true,
  p_category text default ''::text,
  p_payment_status text default 'lunas'::text,
  p_due_date date default null::date,
  p_owner uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := public.resolve_owner(p_owner);
  v_po purchase_orders;
  v_p record;
  v_before numeric;
  v_after numeric;
  v_total numeric;
  v_txn transactions;
  v_po2 purchase_orders;
begin
  select * into v_po from purchase_orders
   where id = p_po_id and user_id = v_owner for update;
  if not found then
    raise exception 'PO tidak ditemukan.';
  end if;
  if v_po.status in ('received','cancelled') then
    raise exception 'PO ini sudah diterima atau dibatalkan.';
  end if;

  select id, stock, name, unit into v_p
    from products where id = v_po.product_id and user_id = v_owner for update;
  if not found then
    raise exception 'Produk PO ini tidak ditemukan.';
  end if;

  v_before := coalesce(v_p.stock, 0);
  v_after := v_before + coalesce(v_po.qty, 0);
  update products set stock = v_after, updated_at = now()
    where id = v_p.id and user_id = v_owner;

  v_total := round(coalesce(v_po.qty, 0) * coalesce(v_po.unit_price, 0));
  if p_create_expense and v_total > 0 and coalesce(p_category, '') <> '' then
    insert into transactions
      (user_id, description, amount, direction, category, channel, occurred_at,
       payment_status, due_date, product_id, qty)
    values
      (v_owner,
       'Pembelian: ' || v_po.qty || ' ' || coalesce(v_p.unit,'') || ' ' || v_p.name || ' (' || v_po.po_number || ')',
       v_total, 'out', p_category, 'manual', now(),
       coalesce(nullif(p_payment_status,''), 'lunas'),
       case when p_payment_status = 'belum' then p_due_date else null end,
       v_po.product_id, v_po.qty)
    returning * into v_txn;
  end if;

  update purchase_orders
    set status = 'received', received_at = now(), txn_id = v_txn.id
    where id = v_po.id and user_id = v_owner
    returning * into v_po2;

  return jsonb_build_object(
    'po', to_jsonb(v_po2),
    'stock', jsonb_build_object('name', v_p.name, 'unit', v_p.unit, 'before', v_before, 'after', v_after),
    'txn', to_jsonb(v_txn));
end $$;

revoke all on function public.receive_purchase_order(uuid, boolean, text, text, date, uuid) from public;
grant execute on function public.receive_purchase_order(uuid, boolean, text, text, date, uuid) to authenticated;

-- ---------- 6. Rekap bulanan per workspace ----------
create or replace function public.my_monthly_summary(p_owner uuid default null)
returns table(month text, income numeric, expense numeric, cnt bigint)
language sql stable security definer set search_path = public as $$
  select to_char(occurred_at, 'YYYY-MM') as month,
         coalesce(sum(amount) filter (where direction = 'in'), 0)  as income,
         coalesce(sum(amount) filter (where direction = 'out'), 0) as expense,
         count(*) as cnt
  from public.transactions
  where user_id = public.resolve_owner(p_owner)
  group by 1
  order by 1;
$$;

revoke all on function public.my_monthly_summary(uuid) from public;
grant execute on function public.my_monthly_summary(uuid) to authenticated;

-- ---------- 7. Overload lama mendelegasikan ke versi berpagar ----------
-- Frontend yang sudah ter-deploy masih memanggil bentuk tanpa p_owner. Overload
-- lama TIDAK dibiarkan menyimpan salinan badan fungsi yang belum berpagar
-- user_id — kalau dibiarkan, siapa pun bisa memanggilnya langsung lewat REST
-- dan melewati semua perbaikan di atas. Jadi versi lama sekarang cuma
-- meneruskan ke versi baru dengan p_owner => null, yang diartikan
-- resolve_owner() sebagai "workspace pemanggil sendiri".
--
-- Efek transisi: klien lama menulis ke workspace pemanggil sendiri. Untuk owner
-- itu benar; untuk staf yang sedang membuka usaha orang lain hasilnya bukan yang
-- dia harapkan, tapi TIDAK menyentuh workspace lain. Hilang begitu frontend
-- baru ter-deploy.

create or replace function public.add_transaction_with_stock(p_tx jsonb, p_lines jsonb default '[]'::jsonb)
returns jsonb
language sql volatile security definer set search_path = public as $$
  select public.add_transaction_with_stock(p_tx, p_lines, null::uuid);
$$;

create or replace function public.post_stock_opname(p_opname_id uuid, p_items jsonb)
returns jsonb
language sql volatile security definer set search_path = public as $$
  select public.post_stock_opname(p_opname_id, p_items, null::uuid);
$$;

create or replace function public.receive_purchase_order(
  p_po_id uuid,
  p_create_expense boolean default true,
  p_category text default ''::text,
  p_payment_status text default 'lunas'::text,
  p_due_date date default null::date
)
returns jsonb
language sql volatile security definer set search_path = public as $$
  select public.receive_purchase_order(
    p_po_id, p_create_expense, p_category, p_payment_status, p_due_date, null::uuid);
$$;

create or replace function public.my_monthly_summary()
returns table(month text, income numeric, expense numeric, cnt bigint)
language sql stable security definer set search_path = public as $$
  select * from public.my_monthly_summary(null::uuid);
$$;

-- Setelah frontend baru ter-deploy, overload lama boleh dibuang seluruhnya:
--   drop function if exists public.add_transaction_with_stock(jsonb, jsonb);
--   drop function if exists public.post_stock_opname(uuid, jsonb);
--   drop function if exists public.receive_purchase_order(uuid, boolean, text, text, date);
--   drop function if exists public.my_monthly_summary();

-- ---------- SISA RISIKO YANG BELUM DITUTUP ----------
-- upsert di attendance / kpi_scores memakai onConflict yang TIDAK menyertakan
-- user_id ('employee_id,date' dan 'employee_id,criteria_id,period'). Secara
-- teori, permintaan yang dibuat manual dengan employee_id milik usaha lain bisa
-- menabrak baris usaha itu dan mengubahnya. Tidak bisa dicapai lewat UI (id-nya
-- tidak pernah dipaparkan ke workspace lain setelah perbaikan ini), dan
-- memperbaikinya butuh mengganti unique index jadi menyertakan user_id —
-- perubahan constraint pada data produksi yang perlu diverifikasi dulu apakah
-- ada duplikat. Dibiarkan terbuka SENGAJA dan dicatat di sini, bukan diubah
-- diam-diam tanpa diuji.
