-- ============================================================
-- add_transaction_with_stock() diam-diam membuang lima kolom.
--
-- GEJALA YANG DILAPORKAN
-- "Foto/PDF struk tidak tersimpan." Benar, dan penyebabnya bukan unggahannya.
--
-- BUKTI (project vbzmtnpmtgrhovmwjqqk, 19 Sep 2026):
--   storage.objects  15:03:14.491  receipts/…/1789830180342_km1cfk.jpeg  284 KB
--   transactions     15:03:14.894  channel='struk'  receipt_url = NULL
-- Berkasnya terunggah, URL-nya dikirim ke RPC, dan RPC-nya membuangnya. Yang
-- tersisa adalah berkas yatim di storage: ruang terpakai yang tidak bisa
-- dijangkau dari aplikasi mana pun.
--
-- SEBABNYA: daftar kolom pada INSERT di dalam fungsi ini ditulis sekali, lalu
-- tidak pernah ikut bertambah saat kolom baru ditambahkan ke tabel. Kolom yang
-- tidak disebut TIDAK menimbulkan error — PostgreSQL dengan senang hati
-- menyimpan baris tanpa kolom yang tidak Anda sebutkan. Kegagalannya sunyi.
--
-- LIMA KOLOM YANG HILANG, dan semuanya benar-benar dikirim klien:
--   receipt_url        src/pages/Struk.jsx meneruskannya setelah uploadReceipt()
--   source_ref         nama berkas struk, untuk menelusuri asal sebuah catatan
--   customer_id        DIISI tautkanPihakTransaksi() lewat resolveCustomer()
--   raw               teks mentah sumber impor
--   import_confidence  penanda keyakinan impor
--
-- customer_id yang paling merusak diam-diam: transaksi tetap menyimpan
-- customer_name sebagai TEKS, jadi di layar terlihat benar — sementara
-- relasinya ke tabel customers tidak pernah terbentuk. Setiap laporan per
-- pelanggan lalu menghitung nol untuk penjualan yang jelas-jelas ada.
--
-- Perlu ditegaskan karena mudah salah sasaran: FOREIGN KEY-nya sendiri sehat.
-- transactions.customer_id, supplier_id dan product_id semuanya punya FK
-- komposit ke (user_id, id) tabel induknya. Yang rusak bukan relasinya,
-- melainkan satu daftar kolom yang lupa diperbarui.
-- ============================================================

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
     supplier_id,
     -- DITAMBAHKAN. Lihat alasan panjang di kepala berkas: kelimanya dikirim
     -- klien dan selama ini dibuang tanpa satu pun error.
     receipt_url, source_ref, customer_id, raw, import_confidence)
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
     nullif(p_tx->>'supplier_id','')::uuid,
     nullif(p_tx->>'receipt_url',''),
     nullif(p_tx->>'source_ref',''),
     nullif(p_tx->>'customer_id','')::uuid,
     nullif(p_tx->>'raw',''),
     nullif(p_tx->>'import_confidence',''))
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

    insert into public.stock_movements
      (user_id, transaction_id, product_id, stock_delta, opened_used_delta, asal)
    values
      (v_owner, v_txn.id, v_p.id, v_after - coalesce(v_p.stock, 0), 0, 'langsung');

    v_changes := v_changes || jsonb_build_object(
      'name', v_p.name, 'unit', v_p.unit,
      'before', coalesce(v_p.stock, 0), 'after', v_after);

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

comment on function public.add_transaction_with_stock(jsonb, jsonb, uuid) is
  'Menyimpan transaksi + menggerakkan stok secara atomik, dan mencatat setiap pergerakan ke stock_movements. Daftar kolom INSERT-nya HARUS ikut diperbarui setiap kali kolom baru ditambahkan ke transactions — kolom yang tidak disebut hilang tanpa error.';

-- ------------------------------------------------------------
-- P10 — kolom yang dikirim klien harus BENAR-BENAR tersimpan
-- ------------------------------------------------------------
--
-- Kasus ini lahir dari bug nyata 19 Sep 2026: add_transaction_with_stock
-- membuang receipt_url, source_ref, customer_id, raw dan import_confidence
-- karena kelimanya tidak disebut di daftar kolom INSERT-nya. Tidak ada error.
-- Foto struk terunggah 284 KB, transaksinya tersimpan 0,4 detik kemudian tanpa
-- tautan ke berkas itu, dan berkasnya jadi yatim di storage.
--
-- Kelas bug ini akan lahir lagi setiap kali seseorang menambah kolom ke
-- transactions dan lupa menambahkannya ke fungsi. Kasus ini menangkapnya:
-- kalau satu kolom saja hilang, ia merah dengan menyebut kolom mana.
create or replace function public.test_kolom_transaksi()
returns table(suite text, kasus text, hasil text, lulus boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid  uuid := 'dbdbdbdb-0000-4000-8000-000000000004';
  v_cust uuid;
  v_hasil jsonb;
  v_tx   uuid;
  r      record;
  v_hilang text := '';
begin
  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
  insert into auth.users (id, email) values (v_uid, 'uji-kolom@contoh.invalid');
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  insert into public.customers (user_id, name) values (v_uid, 'UJI Pelanggan')
  returning id into v_cust;

  v_hasil := public.add_transaction_with_stock(
    jsonb_build_object(
      'description','UJI kolom lengkap',
      'amount', 12345,
      'direction','out',
      'channel','struk',
      'receipt_url','uji/struk.jpg',
      'source_ref','struk.jpg',
      'customer_id', v_cust,
      'raw','teks mentah',
      'import_confidence','tinggi'),
    '[]'::jsonb, v_uid);
  v_tx := (v_hasil->'txn'->>'id')::uuid;

  select * into r from public.transactions where id = v_tx;

  if r.receipt_url       is distinct from 'uji/struk.jpg' then v_hilang := v_hilang || 'receipt_url '; end if;
  if r.source_ref        is distinct from 'struk.jpg'     then v_hilang := v_hilang || 'source_ref '; end if;
  if r.customer_id       is distinct from v_cust          then v_hilang := v_hilang || 'customer_id '; end if;
  if r.raw               is distinct from 'teks mentah'   then v_hilang := v_hilang || 'raw '; end if;
  if r.import_confidence is distinct from 'tinggi'        then v_hilang := v_hilang || 'import_confidence '; end if;

  return query select * from public.uji_kasus('kolom_transaksi',
    'P10 receipt_url/source_ref/customer_id/raw/import_confidence ikut tersimpan',
    'semua tersimpan',
    case when v_hilang = '' then 'semua tersimpan' else 'DIBUANG: ' || btrim(v_hilang) end);

  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
  return;

exception when others then
  return query select * from public.uji_kasus('kolom_transaksi',
    'harness kolom gagal sebelum selesai', 'tanpa error', sqlstate || ' ' || sqlerrm);
  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
  return;
end
$function$;

comment on function public.test_kolom_transaksi() is
  'Menjaga agar add_transaction_with_stock tidak diam-diam membuang kolom yang dikirim klien. Lahir dari bug foto struk yatim, 19 Sep 2026.';

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
  return query select * from public.test_kolom_transaksi();

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
