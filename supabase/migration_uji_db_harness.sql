-- ============================================================
-- Harness uji sisi DATABASE — public.test_semua() dan penyusunnya.
-- Dipanggil scripts/uji-db.mjs, yang dijalankan job "db" di CI setiap push.
--
-- KENAPA BERKAS INI DITULIS ULANG DARI NOL
-- Versi sebelumnya (test_bom, test_pembatalan, test_stock_applied, test_semua)
-- HANYA pernah ada di dalam project lama hexaidoxmeycctpwfbst, dipasang lewat
-- migrasi ad-hoc. Yang dikomit ke repo cuma catatannya — migration_test_bom_
-- harness.sql menulis sendiri "Definisi lengkap fungsi ada di database".
-- Waktu project itu hilang, definisinya ikut hilang; tidak ada satu baris pun
-- di riwayat git yang bisa memulihkannya. Gerbang CI-nya lalu memanggil fungsi
-- yang tidak ada di mana-mana, dan merah selama berminggu-minggu.
--
-- Karena itu berkas ini memuat DEFINISI, bukan catatan. Kalau project berganti
-- lagi, cukup jalankan berkas ini.
--
-- CAKUPAN — BACA INI SEBELUM MENGIRA GERBANGNYA UTUH
-- Yang dipulihkan: test_bom (mesin pemotongan stok) + rls_lint + tenancy_lint.
-- Yang TIDAK dipulihkan: test_pembatalan dan test_stock_applied. Bukan karena
-- malas — fitur yang diujinya memang TIDAK ADA di database ini:
--   * transactions tidak punya kolom stock_applied;
--   * tidak ada fungsi pembalikan stok saat transaksi dihapus.
-- Keduanya juga hanya pernah hidup di project lama dan tidak pernah dikomit
-- (migration_pembatalan_stok.sql: 93 baris, nol SQL). Menulis "uji" untuk
-- fungsi yang tidak ada hanya akan menghasilkan gerbang yang selalu hijau
-- karena tidak menguji apa pun — persis jenis kebohongan yang sudah pernah
-- memakan repo ini. Memulihkan FITUR-nya adalah pekerjaan terpisah.
--
-- CARA PAKAI
--   select * from public.test_semua();        -- semua kasus + lint
--   npm run test:db                            -- dibungkus BEGIN..ROLLBACK
-- ============================================================

-- ------------------------------------------------------------
-- Pembanding satu kasus
-- ------------------------------------------------------------
-- Semua kolom di-cast eksplisit ke text/boolean. Di plpgsql, RETURN QUERY
-- mencocokkan tipe kolom SATU PER SATU dan gagal keras pada selisih yang
-- kelihatan sepele (varchar vs text, bigint vs numeric) — dan gagalnya baru
-- terlihat saat fungsi dipanggil, bukan saat dibuat.
create or replace function public.uji_kasus(
  p_suite text, p_kasus text, p_harap text, p_aktual text
)
returns table(suite text, kasus text, hasil text, lulus boolean)
language sql
immutable
as $function$
  select
    p_suite::text,
    p_kasus::text,
    (case when p_aktual is not distinct from p_harap
          then 'ok: ' || coalesce(p_aktual, '(null)')
          else 'harap [' || coalesce(p_harap, '(null)')
               || '] dapat [' || coalesce(p_aktual, '(null)') || ']'
     end)::text,
    (p_aktual is not distinct from p_harap)::boolean;
$function$;

comment on function public.uji_kasus(text, text, text, text) is
  'Pembanding satu kasus uji. is not distinct from — jadi null == null dihitung lulus, bukan unknown.';

-- ------------------------------------------------------------
-- test_bom() — mesin pemotongan stok berbasis kemasan
-- ------------------------------------------------------------
--
-- YANG DIUJI: consume_pack_stock(), consume_bom_for_sale(), product_yield().
-- Ketiganya memindahkan STOK, dan stok adalah uang.
--
-- TEMUAN LAMA YANG SENGAJA DIPERTAHANKAN — ini bagian terpentingnya.
-- Suite pertama dulu berisi 12 kasus dan semuanya hijau. Untuk menguji apakah
-- suite-nya sendiri ada gunanya, floor() di consume_pack_stock diganti round().
-- SELURUH 12 kasus TETAP HIJAU, karena tidak satu pun memakai pecahan di
-- rentang 0,5–0,99:
--   300/800 = 0,375  -> floor 0, round 0   (sama)
--   900/800 = 1,125  -> floor 1, round 1   (sama)
--   800/800 = 1,0    -> floor 1, round 1   (sama)
-- Kasus pembeda lalu ditambahkan: pakai 500 g dari kemasan 800 g yang utuh.
--   floor(0,625) = 0 -> stok tetap 12, terbuka 500      (benar)
--   round(0,625) = 1 -> stok 11, terbuka -300           (salah, dan NEGATIF)
-- K4, K5 dan K17 di bawah adalah kasus pembeda itu. Kalau menambah kasus baru,
-- pastikan ia benar-benar BISA merah — suite yang hijau belum tentu suite yang
-- menguji.
--
-- KENAPA AKUN SINTETIS, BUKAN AKUN TESTER
-- products.user_id punya FK ke auth.users, jadi user_id karangan ditolak.
-- Versi lama memakai akun tester sungguhan dan membersihkan baris ber-prefiks
-- 'UJI ' — artinya, walau sesaat, data uji menempel pada akun milik orang.
-- Versi ini membuat dua baris auth.users sintetis di dalam transaksi dan
-- menghapusnya di akhir (cascade). Tidak ada akun nyata yang tersentuh sama
-- sekali, bahkan sesaat.
create or replace function public.test_bom()
returns table(suite text, kasus text, hasil text, lulus boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- UUID tetap, bukan acak: kalau satu jalannya putus di tengah tanpa sempat
  -- bersih-bersih, jalan berikutnya menghapus sisa yang sama persis.
  v_uid    uuid := 'dbdbdbdb-0000-4000-8000-000000000001';
  v_uid2   uuid := 'dbdbdbdb-0000-4000-8000-000000000002';
  v_pak    uuid;   -- produk berkemasan (pack_size > 0)
  v_lepas  uuid;   -- produk curah    (pack_size = 0)
  v_jual   uuid;   -- produk jual ber-BOM
  v_bahan  uuid;   -- ingredients -> v_pak
  v_bahan2 uuid;   -- ingredients -> v_lepas
  v_hasil  jsonb;
  -- trim_scale() dipakai di SETIAP pembacaan stok di bawah, dan itu bukan
  -- kerapian — tanpanya seluruh suite ini merah palsu.
  --
  -- products.stock bertipe numeric BERSKALA, jadi nilai 12 tersimpan sebagai
  -- 12.00 dan format('%s') mencetaknya apa adanya: "stok=12.00". opened_used
  -- lebih licik lagi — ia ikut skala sumbernya, jadi 500 yang datang dari
  -- qty_per_unit * qty muncul sebagai "500.0000" sementara 500 yang datang
  -- dari pemanggilan langsung muncul sebagai "500". Dua angka yang sama
  -- persis, dua teks yang berbeda.
  --
  -- Merah semacam itu adalah racun: ia menuduh mesin stok padahal mesinnya
  -- benar, dan cara termurah untuk "memperbaikinya" adalah melonggarkan
  -- perbandingan sampai suite-nya berhenti menguji apa pun. trim_scale()
  -- membuang nol di belakang koma dan menyamakan keduanya menjadi 500, tanpa
  -- mengorbankan ketelitian: 0,5 tetap 0,5 dan tetap bisa merah.
  v_stok   numeric;
  v_buka   numeric;
begin
  -- Sisa jalan sebelumnya, kalau ada.
  delete from public.profiles where id in (v_uid, v_uid2);
  delete from auth.users where id in (v_uid, v_uid2);

  insert into auth.users (id, email) values
    (v_uid,  'uji-db-1@contoh.invalid'),
    (v_uid2, 'uji-db-2@contoh.invalid');

  -- product_yield() melewati resolve_owner() yang menuntut auth.uid().
  -- Harness dijalankan tanpa sesi, jadi klaimnya disetel LOKAL (is_local =
  -- true) — hilang sendiri saat transaksi selesai, tidak bocor ke koneksi lain.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role', 'authenticated')::text,
                     true);

  insert into public.products (user_id, name, kind, unit, content_unit, pack_size, opened_used, stock)
  values (v_uid, 'UJI Tepung 800g', 'bahan', 'pak', 'gram', 800, 0, 12)
  returning id into v_pak;

  insert into public.products (user_id, name, kind, unit, pack_size, opened_used, stock)
  values (v_uid, 'UJI Gula curah', 'bahan', 'kg', 0, 0, 10)
  returning id into v_lepas;

  insert into public.products (user_id, name, kind, unit, stock, has_bom)
  values (v_uid, 'UJI Roti', 'jual', 'pcs', 0, true)
  returning id into v_jual;

  insert into public.ingredients (user_id, name, type, unit, source_product_id)
  values (v_uid, 'UJI Tepung', 'bahan', 'gram', v_pak)
  returning id into v_bahan;

  insert into public.ingredients (user_id, name, type, unit, source_product_id)
  values (v_uid, 'UJI Gula', 'bahan', 'kg', v_lepas)
  returning id into v_bahan2;

  -- ========== consume_pack_stock: masukan yang harus ditolak ==========

  v_hasil := public.consume_pack_stock(v_pak, null, v_uid);
  return query select * from public.uji_kasus('bom',
    'K1 kebutuhan NULL tidak menggerakkan stok', 'null',
    coalesce(v_hasil::text, 'null'));

  v_hasil := public.consume_pack_stock(v_pak, 0, v_uid);
  return query select * from public.uji_kasus('bom',
    'K2 kebutuhan 0 tidak menggerakkan stok', 'null',
    coalesce(v_hasil::text, 'null'));

  v_hasil := public.consume_pack_stock(v_pak, -5, v_uid);
  return query select * from public.uji_kasus('bom',
    'K3 kebutuhan negatif tidak menggerakkan stok', 'null',
    coalesce(v_hasil::text, 'null'));

  -- ========== consume_pack_stock: floor(), bukan round() ==========

  -- K4 — KASUS PEMBEDA. 500 g dari pak 800 g yang masih utuh.
  -- floor: 0 pak turun, 500 g terbuka. round: 1 pak turun, terbuka -300.
  perform public.consume_pack_stock(v_pak, 500, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K4 pakai 500g dari pak 800g utuh -> pak belum turun',
    'stok=12 terbuka=500',
    format('stok=%s terbuka=%s', v_stok, v_buka));

  -- K5 — KASUS PEMBEDA KEDUA. Tambah 100 g: total 600/800 = 0,75.
  -- floor: masih 0 pak. round: 1 pak, dan terbuka jadi -200.
  perform public.consume_pack_stock(v_pak, 100, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K5 akumulasi 600g dari pak 800g -> pak masih belum turun',
    'stok=12 terbuka=600',
    format('stok=%s terbuka=%s', v_stok, v_buka));

  -- K6 — melewati batas satu pak: total 900/800 = 1,125 -> 1 pak turun, sisa 100.
  perform public.consume_pack_stock(v_pak, 300, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K6 akumulasi 900g -> satu pak turun, sisa terbuka 100g',
    'stok=11 terbuka=100',
    format('stok=%s terbuka=%s', v_stok, v_buka));

  -- K7 — kelipatan pas tidak meninggalkan sisa terbuka.
  update public.products set stock = 10, opened_used = 0 where id = v_pak;
  perform public.consume_pack_stock(v_pak, 800, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K7 pakai tepat 800g -> satu pak turun, tidak ada sisa terbuka',
    'stok=9 terbuka=0',
    format('stok=%s terbuka=%s', v_stok, v_buka));

  -- K8 — kebutuhan melampaui stok. greatest(0, ...) menahan stok di nol;
  -- tanpa itu nilainya jadi -1 dan tiap laporan setelahnya ikut salah.
  update public.products set stock = 1, opened_used = 0 where id = v_pak;
  perform public.consume_pack_stock(v_pak, 2000, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K8 kebutuhan melampaui stok -> stok berhenti di 0, tidak negatif',
    'stok=0 terbuka=400',
    format('stok=%s terbuka=%s', v_stok, v_buka));

  -- ========== consume_pack_stock: produk curah (pack_size = 0) ==========

  perform public.consume_pack_stock(v_lepas, 3, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_lepas;
  return query select * from public.uji_kasus('bom',
    'K9 produk curah berkurang apa adanya, tanpa sisa terbuka',
    'stok=7 terbuka=0',
    format('stok=%s terbuka=%s', v_stok, v_buka));

  update public.products set stock = 2 where id = v_lepas;
  perform public.consume_pack_stock(v_lepas, 5, v_uid);
  select trim_scale(stock) into v_stok from public.products where id = v_lepas;
  return query select * from public.uji_kasus('bom',
    'K10 produk curah tidak bisa minus',
    'stok=0', format('stok=%s', v_stok));

  -- ========== consume_pack_stock: batas kepemilikan ==========

  -- K11 — pemilik lain. Ini penjaga isolasi workspace di lapisan fungsi:
  -- klausa `and user_id = p_owner` di SELECT ... FOR UPDATE. Kalau klausa itu
  -- hilang, usaha A bisa memotong stok usaha B.
  update public.products set stock = 5, opened_used = 0 where id = v_pak;
  v_hasil := public.consume_pack_stock(v_pak, 100, v_uid2);
  select trim_scale(stock) into v_stok from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K11 pemilik lain ditolak dan stok tidak bergerak',
    'null stok=5',
    format('%s stok=%s', coalesce(v_hasil::text, 'null'), v_stok));

  v_hasil := public.consume_pack_stock(gen_random_uuid(), 100, v_uid);
  return query select * from public.uji_kasus('bom',
    'K12 produk tidak dikenal -> null, bukan error', 'null',
    coalesce(v_hasil::text, 'null'));

  -- ========== consume_bom_for_sale ==========

  insert into public.product_boms (user_id, product_id, ingredient_id, qty_per_unit, deduct_stock)
  values (v_uid, v_jual, v_bahan, 250, true);

  -- K13 — produk tanpa penanda has_bom tidak boleh memotong apa pun, walau
  -- baris BOM-nya ada. Penandanya yang berkuasa, bukan keberadaan barisnya.
  update public.products set has_bom = false where id = v_jual;
  update public.products set stock = 12, opened_used = 0 where id = v_pak;
  v_hasil := public.consume_bom_for_sale(v_jual, 2, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K13 has_bom=false -> tidak ada bahan yang terpotong',
    '[] stok=12 terbuka=0',
    format('%s stok=%s terbuka=%s', v_hasil::text, v_stok, v_buka));

  -- K14 — baris BOM dengan deduct_stock=false hanya untuk hitung HPP, tidak
  -- menggerakkan stok. Kalau filter ini hilang, stok bahan ikut terpotong dua
  -- kali untuk usaha yang mencatat resep sekaligus membeli barang jadi.
  update public.products set has_bom = true where id = v_jual;
  update public.product_boms set deduct_stock = false
    where product_id = v_jual and ingredient_id = v_bahan;
  v_hasil := public.consume_bom_for_sale(v_jual, 2, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K14 deduct_stock=false diabaikan mesin stok',
    '[] stok=12 terbuka=0',
    format('%s stok=%s terbuka=%s', v_hasil::text, v_stok, v_buka));

  -- K15 — jalur normal: 2 roti x 250 g = 500 g, lewat aturan floor yang sama.
  update public.product_boms set deduct_stock = true
    where product_id = v_jual and ingredient_id = v_bahan;
  v_hasil := public.consume_bom_for_sale(v_jual, 2, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K15 jual 2 x 250g -> 500g terbuka, pak belum turun',
    'stok=12 terbuka=500 bahan=1',
    format('stok=%s terbuka=%s bahan=%s', v_stok, v_buka, jsonb_array_length(v_hasil)));

  update public.products set stock = 12, opened_used = 0 where id = v_pak;
  v_hasil := public.consume_bom_for_sale(v_jual, 0, v_uid);
  select trim_scale(stock), trim_scale(opened_used) into v_stok, v_buka from public.products where id = v_pak;
  return query select * from public.uji_kasus('bom',
    'K16 qty 0 tidak memotong bahan apa pun',
    '[] stok=12 terbuka=0',
    format('%s stok=%s terbuka=%s', v_hasil::text, v_stok, v_buka));

  -- ========== product_yield ==========

  -- K17 — KASUS PEMBEDA KETIGA. 12 pak x 800 g dikurangi 200 g terbuka = 9400 g;
  -- 9400/250 = 37,6. floor -> 37 (yang benar-benar bisa dibuat).
  -- round -> 38, yaitu menjanjikan satu roti yang bahannya tidak ada.
  update public.products set stock = 12, opened_used = 200 where id = v_pak;
  v_hasil := public.product_yield(v_jual, v_uid);
  return query select * from public.uji_kasus('bom',
    'K17 yield dibulatkan ke BAWAH (9400g / 250g = 37,6)',
    '37', (v_hasil->>'yield'));

  -- K18 — bahan paling sedikit yang menentukan. Gula curah: stok 10, per unit 4
  -- -> floor(2,5) = 2. Hasil akhir harus 2, bukan 37.
  insert into public.product_boms (user_id, product_id, ingredient_id, qty_per_unit, deduct_stock)
  values (v_uid, v_jual, v_bahan2, 4, true);
  update public.products set stock = 10, opened_used = 0 where id = v_lepas;
  v_hasil := public.product_yield(v_jual, v_uid);
  return query select * from public.uji_kasus('bom',
    'K18 yield mengikuti bahan yang paling membatasi',
    '2', (v_hasil->>'yield'));

  -- Bersih-bersih. Cascade dari auth.users menghapus products, ingredients,
  -- product_boms, dan profiles milik kedua akun sintetis.
  delete from public.profiles where id in (v_uid, v_uid2);
  delete from auth.users where id in (v_uid, v_uid2);
  return;

exception when others then
  -- Kegagalan tak terduga dilaporkan sebagai kasus MERAH, bukan ditelan.
  -- Baris yang sudah dikirim lewat return next tetap sampai ke pemanggil.
  -- Blok exception plpgsql membatalkan subtransaksinya, jadi baris uji yang
  -- sempat dibuat hilang dengan sendirinya; delete di bawah menutup sisa yang
  -- mungkin lolos.
  return query select * from public.uji_kasus('bom',
    'harness gagal sebelum selesai', 'tanpa error',
    sqlstate || ' ' || sqlerrm);
  delete from public.profiles where id in (v_uid, v_uid2);
  delete from auth.users where id in (v_uid, v_uid2);
  return;
end
$function$;

comment on function public.test_bom() is
  '18 kasus mesin pemotongan stok: consume_pack_stock, consume_bom_for_sale, product_yield. Memakai akun auth.users sintetis yang dihapus di akhir.';

-- ------------------------------------------------------------
-- test_semua() — satu pintu untuk gerbang CI
-- ------------------------------------------------------------
--
-- Lint dilaporkan sebagai kasus uji, bukan sebagai daftar pelanggaran mentah,
-- supaya scripts/uji-db.mjs bisa menghitungnya dengan cara yang sama. Lint yang
-- bersih tetap mengembalikan SATU baris lulus — bukan nol baris. Nol baris
-- tidak bisa dibedakan dari "lint-nya tidak pernah jalan", dan gerbang yang
-- tidak bisa membedakan keduanya adalah gerbang yang sudah rusak.
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

comment on function public.test_semua() is
  'Gerbang uji database: test_bom + rls_lint + tenancy_lint. Dipanggil scripts/uji-db.mjs di CI. Lint bersih tetap mengembalikan satu baris lulus, supaya "0 kasus" selalu berarti gerbangnya rusak.';
