-- ============================================================
-- P2 — PELANGGAN SEBAGAI ENTITAS (bukan lagi kolom teks)
--
-- Sebelum ini nama & kontak pelanggan hanya menumpang sebagai dua kolom teks
-- di `transactions`, sehingga tidak bisa dicari, tidak punya riwayat, dan
-- ejaan yang berbeda ("Budi" vs "budi") menjadi dua orang berbeda.
--
-- POLA WAJIB YANG DIIKUTI (jangan disederhanakan):
--   induk : UNIQUE (user_id, id)
--   anak  : FOREIGN KEY (user_id, induk_id) REFERENCES induk(user_id, id)
-- Seluruh relasi antar-tabel di database ini memakai FK KOMPOSIT ber-tenant.
-- Dengan pola itu, menautkan baris milik workspace lain mustahil secara
-- STRUKTURAL — bukan sekadar dicegah RLS. FK biasa `REFERENCES customers(id)`
-- akan membuka kembali celah yang sudah ditutup di 8 tabel lainnya.
--
-- Kolom lama `customer_name` / `customer_contact` SENGAJA TIDAK DIHAPUS:
-- halaman Piutang & Utang dan Invoice masih membacanya. Penghapusan baru boleh
-- dilakukan setelah kedua halaman itu dipindahkan ke relasi baru.
--
-- Idempoten: aman dijalankan ulang.
-- ============================================================

-- ---------- 1. Tabel pelanggan ----------
create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  phone       text,
  email       text,
  address     text,
  note        text,
  created_at  timestamptz not null default now()
);

-- Syarat agar tabel ini boleh jadi INDUK dari FK komposit.
create unique index if not exists customers_tenant_key
  on public.customers (user_id, id);

-- Kunci alami untuk upsert "pelanggan yang sama". Nomor telepon dipilih sebagai
-- kunci karena nama terlalu sering ditulis berbeda-beda; nomor kosong tidak
-- ikut dikunci supaya pelanggan tanpa kontak tetap bisa dicatat berkali-kali.
create unique index if not exists customers_user_phone_key
  on public.customers (user_id, phone) where phone is not null;

create index if not exists customers_user_name_idx
  on public.customers (user_id, lower(name));

-- ---------- 2. RLS (mengikuti pola `suppliers`) ----------
alter table public.customers enable row level security;

drop policy if exists "own customers" on public.customers;
create policy "own customers" on public.customers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "admin all customers" on public.customers;
create policy "admin all customers" on public.customers
  for all using (is_admin()) with check (is_admin());

-- Pelanggan masuk modul `transaksi`, BUKAN modul baru: kasir yang sudah boleh
-- mencatat penjualan otomatis boleh mencatat pelanggannya. Membuat modul
-- tersendiri berarti setiap kasir harus diberi hak akses kedua kalinya.
drop policy if exists "staff_transaksi" on public.customers;
create policy "staff_transaksi" on public.customers
  for all using (has_access(user_id, 'transaksi'))
  with check (has_access(user_id, 'transaksi'));

-- ---------- 3. Jejak audit (sama seperti pemasok) ----------
drop trigger if exists audit_customers on public.customers;
create trigger audit_customers
  after insert or update or delete on public.customers
  for each row execute function log_audit();

-- ---------- 4. Relasi dari transaksi ----------
alter table public.transactions
  add column if not exists customer_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_customer_tenant_fkey'
  ) then
    alter table public.transactions
      add constraint transactions_customer_tenant_fkey
      foreign key (user_id, customer_id)
      references public.customers (user_id, id)
      on delete set null;
  end if;
end $$;

create index if not exists transactions_customer_idx
  on public.transactions (user_id, customer_id) where customer_id is not null;

-- ---------- 5. Backfill data lama ----------
-- Normalisasi nomor menyalin PERSIS `normalizePhone()` di src/lib/aging.js
-- (baris 56-63), termasuk cabang "diawali 8" — nomor Indonesia sering ditulis
-- tanpa 0 di depan. Kalau satu cabang saja berbeda, pelanggan yang sama akan
-- terpecah dua antara hasil backfill dan data yang ditulis aplikasi setelahnya.
create or replace function public.norm_phone_id(p text)
returns text language sql immutable as $$
  with d as (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as digits)
  select case
    when digits = ''             then null
    when left(digits, 2) = '62'  then digits
    when left(digits, 1) = '0'   then '62' || substr(digits, 2)
    when left(digits, 1) = '8'   then '62' || digits
    else digits
  end
  from d
$$;

-- 5a. Pelanggan yang punya nomor telepon: satu baris per (user_id, nomor).
insert into public.customers (user_id, name, phone)
select t.user_id,
       -- Nama terpanjang dipakai sebagai kanonik: biasanya yang paling lengkap
       -- ("Budi Santoso" menang atas "Budi").
       (array_agg(btrim(t.customer_name) order by length(btrim(t.customer_name)) desc))[1],
       public.norm_phone_id(t.customer_contact)
from public.transactions t
where t.customer_id is null
  and coalesce(btrim(t.customer_name), '') <> ''
  and public.norm_phone_id(t.customer_contact) is not null
group by t.user_id, public.norm_phone_id(t.customer_contact)
on conflict (user_id, phone) where phone is not null do nothing;

-- 5b. Pelanggan tanpa nomor: dikelompokkan berdasarkan nama (huruf kecil).
--     Hanya dibuat bila belum ada baris bernama sama tanpa nomor.
-- Pengelompokan diselesaikan lebih dulu di CTE, baru disaring. Menaruh NOT
-- EXISTS langsung di HAVING ditolak Postgres (42803: "subquery uses ungrouped
-- column") — pengenalan ekspresi ter-GROUP BY tidak berlaku ke dalam subquery,
-- sekalipun ekspresi yang sama persis ada di GROUP BY.
with kandidat as (
  select t.user_id,
         lower(btrim(t.customer_name)) as nama_kunci,
         (array_agg(btrim(t.customer_name)))[1] as nama
  from public.transactions t
  where t.customer_id is null
    and coalesce(btrim(t.customer_name), '') <> ''
    and public.norm_phone_id(t.customer_contact) is null
  group by t.user_id, lower(btrim(t.customer_name))
)
insert into public.customers (user_id, name)
select k.user_id, k.nama
from kandidat k
-- `c.phone is null` WAJIB ada di sini. Tanpa itu, "Budi" tanpa nomor akan
-- dilewati karena sudah ada "Budi" BERNOMOR, padahal langkah 5c hanya menautkan
-- transaksi tanpa nomor ke baris tanpa nomor — hasilnya transaksi menggantung
-- tanpa relasi. Dua baris "Budi" memang mungkin orang yang sama, tapi kita tidak
-- punya bukti untuk menggabungkannya; penggabungan adalah keputusan pengguna.
where not exists (
  select 1 from public.customers c
  where c.user_id = k.user_id
    and c.phone is null
    and lower(c.name) = k.nama_kunci
);

-- 5c. Tautkan transaksi lama ke baris pelanggan yang baru dibuat.
update public.transactions t
set customer_id = c.id
from public.customers c
where t.customer_id is null
  and c.user_id = t.user_id
  and (
    (public.norm_phone_id(t.customer_contact) is not null
      and c.phone = public.norm_phone_id(t.customer_contact))
    or
    (public.norm_phone_id(t.customer_contact) is null
      and c.phone is null
      and lower(c.name) = lower(btrim(t.customer_name)))
  );

-- ---------- 6. Pemeriksaan setelah migrasi (jalankan manual) ----------
-- select count(*) as transaksi_bernama_tanpa_relasi
-- from transactions
-- where coalesce(btrim(customer_name),'') <> '' and customer_id is null;
--   -> harus 0
--
-- select count(*) from customers;
--   -> jumlah pelanggan unik hasil backfill
