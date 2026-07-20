-- ============================================================
-- OPERASI ATOMIK (salinan repo; diterapkan sebagai migrasi `atomic_ops_v1`)
--
-- Latar belakang: sebelumnya operasi multi-langkah (terima PO, posting
-- opname, simpan transaksi + penyesuaian stok) dijalankan sebagai beberapa
-- panggilan terpisah dari browser. Gagal di tengah (koneksi putus, RLS
-- menolak) meninggalkan data setengah jadi — mis. stok sudah bertambah
-- tetapi transaksi/status PO tidak tercatat.
--
-- Solusi: seluruh operasi dipindah ke fungsi RPC Postgres. Satu panggilan
-- = satu transaksi database — gagal di langkah mana pun, SEMUA perubahan
-- dibatalkan otomatis (rollback penuh, tidak ada data setengah jadi).
--
-- Keamanan: semua fungsi SECURITY INVOKER sehingga RLS tetap berlaku persis
-- seperti panggilan dari klien (owner penuh; staf dibatasi modulnya —
-- staf 'produk' tanpa modul 'transaksi' yang menerima PO dengan pencatatan
-- pengeluaran akan gagal UTUH, bukan setengah jalan seperti dulu).
-- ============================================================

-- Pemilik data efektif: staf aktif menulis atas nama owner-nya.
-- (Padanan server dari effectiveOwnerId() di src/lib/api.js — logika harus sinkron.)
create or replace function public.effective_owner()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select owner_id from staff_members
      where member_id = auth.uid() and status = 'active' limit 1),
    auth.uid()
  );
$$;

-- ------------------------------------------------------------
-- 1) Simpan transaksi BARU + sesuaikan stok baris produknya — atomik.
--    p_tx    : kolom transaksi (description, amount, direction, ...)
--    p_lines : [{ productId, qty }] — 'in' = stok berkurang, 'out' = bertambah.
--    Return  : { txn: <baris transaksi>, changes: [{name, unit, before, after}] }
-- ------------------------------------------------------------
create or replace function public.add_transaction_with_stock(p_tx jsonb, p_lines jsonb default '[]'::jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
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
    (effective_owner(),
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
    select id, stock, name, unit into v_p
      from products where id = (v_l->>'productId')::uuid for update;
    if not found then continue; end if;
    v_after := greatest(0, coalesce(v_p.stock, 0) + case when v_dir = 'out' then v_qty else -v_qty end);
    update products set stock = v_after, updated_at = now() where id = v_p.id;
    v_changes := v_changes || jsonb_build_object(
      'name', v_p.name, 'unit', v_p.unit,
      'before', coalesce(v_p.stock, 0), 'after', v_after);
  end loop;

  return jsonb_build_object('txn', to_jsonb(v_txn), 'changes', v_changes);
end $$;

-- ------------------------------------------------------------
-- 2) Terima PO — atomik: stok bertambah + (opsional) catat pengeluaran
--    + kunci PO 'received'. Return: { po, stock: {name,unit,before,after}, txn }
-- ------------------------------------------------------------
create or replace function public.receive_purchase_order(
  p_po_id uuid,
  p_create_expense boolean default true,
  p_category text default '',
  p_payment_status text default 'lunas',
  p_due_date date default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_po purchase_orders;
  v_p record;
  v_before numeric;
  v_after numeric;
  v_total numeric;
  v_txn transactions;
  v_po2 purchase_orders;
begin
  select * into v_po from purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'PO tidak ditemukan.';
  end if;
  if v_po.status in ('received','cancelled') then
    raise exception 'PO ini sudah diterima atau dibatalkan.';
  end if;

  select id, stock, name, unit into v_p
    from products where id = v_po.product_id for update;
  if not found then
    raise exception 'Produk PO ini tidak ditemukan.';
  end if;

  v_before := coalesce(v_p.stock, 0);
  v_after := v_before + coalesce(v_po.qty, 0);
  update products set stock = v_after, updated_at = now() where id = v_p.id;

  v_total := round(coalesce(v_po.qty, 0) * coalesce(v_po.unit_price, 0));
  if p_create_expense and v_total > 0 and coalesce(p_category, '') <> '' then
    insert into transactions
      (user_id, description, amount, direction, category, channel, occurred_at,
       payment_status, due_date, product_id, qty)
    values
      (effective_owner(),
       'Pembelian: ' || v_po.qty || ' ' || coalesce(v_p.unit,'') || ' ' || v_p.name || ' (' || v_po.po_number || ')',
       v_total, 'out', p_category, 'manual', now(),
       coalesce(nullif(p_payment_status,''), 'lunas'),
       case when p_payment_status = 'belum' then p_due_date else null end,
       v_po.product_id, v_po.qty)
    returning * into v_txn;
  end if;

  update purchase_orders
    set status = 'received', received_at = now(), txn_id = v_txn.id
    where id = v_po.id
    returning * into v_po2;

  return jsonb_build_object(
    'po', to_jsonb(v_po2),
    'stock', jsonb_build_object('name', v_p.name, 'unit', v_p.unit, 'before', v_before, 'after', v_after),
    'txn', to_jsonb(v_txn));
end $$;

-- ------------------------------------------------------------
-- 3) Posting opname — atomik: stok tiap produk DISET = hasil hitung fisik
--    + sesi dikunci 'posted'. Baris tanpa hasil hitung dilewati.
--    Return: { opname, changes: [{name, unit, before, after}] }
-- ------------------------------------------------------------
create or replace function public.post_stock_opname(p_opname_id uuid, p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_so stock_opnames;
  v_it jsonb;
  v_counted numeric;
  v_sys numeric;
  v_changes jsonb := '[]'::jsonb;
  v_so2 stock_opnames;
begin
  select * into v_so from stock_opnames where id = p_opname_id for update;
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
    update products set stock = v_counted, updated_at = now()
      where id = (v_it->>'product_id')::uuid;
    if found then
      v_changes := v_changes || jsonb_build_object(
        'name', v_it->>'name', 'unit', v_it->>'unit',
        'before', v_sys, 'after', v_counted);
    end if;
  end loop;

  update stock_opnames
    set status = 'posted', posted_at = now(), items = coalesce(p_items, items)
    where id = v_so.id
    returning * into v_so2;

  return jsonb_build_object('opname', to_jsonb(v_so2), 'changes', v_changes);
end $$;
