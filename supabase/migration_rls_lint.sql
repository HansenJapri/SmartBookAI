-- ============================================================
-- Penjaga invarian PRIVASI BARIS — pasangan sisi database dari
-- public.tenancy_lint() (yang menjaga isolasi workspace).
-- Terpasang di project hexaidoxmeycctpwfbst sebagai migrasi `rls_lint_privasi_baris`.
-- Pasangan sisi klien: src/lib/__tests__/privasiBaris.guard.test.js
-- ============================================================
--
-- Kenapa ada: policy "feedback read all (login)" memakai USING (true) pada tabel
-- yang punya kolom user_id, sehingga setiap pengguna yang login bisa membaca
-- baris milik pengguna lain lewat PostgREST — termasuk isi pesan yang sering
-- memuat nama usaha, angka omzet, dan keluhan operasional.
--
-- Ia lolos lama karena tidak ada yang memeriksanya: antarmuka memang hanya
-- menampilkan milik sendiri, dan tak satu pun test membuka endpoint-nya
-- langsung. Perbaikan satu policy hanya bertahan selama semua orang ingat
-- aturannya — jadi aturannya dijadikan mesin.
--
-- Pemakaian:  select * from public.rls_lint();
-- Hasil KOSONG = bersih. Setiap baris = satu pelanggaran yang harus ditutup.
--
-- TERVERIFIKASI BISA MERAH (7 Agu 2026): policy bocor dipasang ulang sementara,
-- rls_lint() mengembalikan R1_policy_baca_permisif pada feedback; setelah policy
-- dibuang, hasilnya kembali kosong.

create or replace function public.rls_lint()
returns table(invarian text, objek text, detail text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  r record;
begin
  -- R1: tabel yang punya kolom user_id TIDAK BOLEH punya policy SELECT/ALL
  --     yang permisif (USING true atau tanpa USING).
  --
  -- Kolom user_id adalah pernyataan "baris ini milik seseorang". Begitu ada,
  -- membaca lintas pemilik harus lewat predikat eksplisit (auth.uid() = user_id,
  -- is_admin(), has_access(...)) — bukan `true`. Tabel referensi bersama yang
  -- memang boleh dibaca siapa saja (macro_signals, commodity_prices,
  -- exchange_rates, legal_docs, ...) tidak punya user_id, jadi otomatis
  -- terkecuali tanpa perlu daftar putih yang harus dirawat.
  for r in
    select p.tablename, p.policyname, p.cmd
    from pg_policies p
    where p.schemaname = 'public'
      and p.cmd in ('SELECT', 'ALL')
      and (p.qual is null or btrim(p.qual::text) in ('true', '(true)'))
      and exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = p.tablename
          and c.column_name = 'user_id'
      )
  loop
    invarian := 'R1_policy_baca_permisif';
    objek := r.tablename || '.' || r.policyname;
    detail := 'policy ' || r.cmd || ' memakai USING (true) pada tabel ber-user_id — '
              || 'setiap pengguna login bisa membaca baris milik orang lain';
    return next;
  end loop;

  -- R2: tabel yang punya kolom user_id WAJIB mengaktifkan RLS.
  -- Tanpa RLS, policy sebagus apa pun tidak pernah dievaluasi.
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
      )
  loop
    invarian := 'R2_rls_mati';
    objek := r.relname;
    detail := 'tabel punya kolom user_id tetapi RLS tidak aktif — policy tidak dievaluasi sama sekali';
    return next;
  end loop;

  -- R3: tabel ber-user_id wajib punya MINIMAL satu policy.
  -- RLS aktif tanpa policy = tidak ada yang bisa membaca (gagal tertutup, aman),
  -- tapi hampir selalu berarti seseorang lupa memasangnya.
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
      )
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname
      )
  loop
    invarian := 'R3_tanpa_policy';
    objek := r.relname;
    detail := 'RLS aktif tetapi tidak ada policy sama sekali';
    return next;
  end loop;

  return;
end $$;

-- Hanya service_role: hasilnya memetakan permukaan keamanan seluruh database.
revoke all on function public.rls_lint() from public, anon, authenticated;
grant execute on function public.rls_lint() to service_role;
