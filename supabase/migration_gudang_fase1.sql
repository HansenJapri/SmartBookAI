-- ============================================================
-- FASE 1 GUDANG: Purchase Order + Stock Opname
-- Aturan produk: SATU produk per PO (selaras aturan 1 transaksi = 1 produk),
-- sehingga penerimaan PO menghasilkan tepat satu transaksi pengeluaran.
-- Opname memakai sesi berversi: draf -> posting (stok dikoreksi) / batal.
-- ============================================================

-- ---------- PURCHASE ORDER ----------
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  po_number text not null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  product_id uuid not null references public.products(id) on delete cascade,
  qty numeric not null check (qty > 0),
  unit_price numeric not null default 0 check (unit_price >= 0),
  status text not null default 'draft' check (status in ('draft','approved','received','cancelled')),
  expected_date date,
  note text,
  -- transaksi pengeluaran yang dibuat otomatis saat PO diterima (opsional)
  txn_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  received_at timestamptz
);

alter table public.purchase_orders enable row level security;
create policy "po_select_own" on public.purchase_orders for select using (auth.uid() = user_id);
create policy "po_insert_own" on public.purchase_orders for insert with check (auth.uid() = user_id);
create policy "po_update_own" on public.purchase_orders for update using (auth.uid() = user_id);
create policy "po_delete_own" on public.purchase_orders for delete using (auth.uid() = user_id);
create index if not exists idx_po_user_created on public.purchase_orders (user_id, created_at desc);

-- ---------- STOCK OPNAME ----------
-- items: [{ product_id, name, unit, system_qty, counted_qty }]
-- system_qty = stok menurut sistem saat sesi dibuat (snapshot);
-- counted_qty = hasil hitung fisik; selisih dihitung di aplikasi.
create table if not exists public.stock_opnames (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  opname_number text not null,
  status text not null default 'draft' check (status in ('draft','posted','cancelled')),
  note text,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  posted_at timestamptz
);

alter table public.stock_opnames enable row level security;
create policy "so_select_own" on public.stock_opnames for select using (auth.uid() = user_id);
create policy "so_insert_own" on public.stock_opnames for insert with check (auth.uid() = user_id);
create policy "so_update_own" on public.stock_opnames for update using (auth.uid() = user_id);
create policy "so_delete_own" on public.stock_opnames for delete using (auth.uid() = user_id);
create index if not exists idx_so_user_created on public.stock_opnames (user_id, created_at desc);
