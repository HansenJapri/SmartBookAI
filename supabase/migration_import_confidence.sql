-- ============================================================
-- KEYAKINAN HASIL IMPOR MARKETPLACE (task C3)
-- Jalankan kapan saja. Aman diulang.
--
-- Kenapa disimpan, bukan sekadar ditampilkan saat impor
-- -----------------------------------------------------
-- Peringatan di layar impor hanya dilihat sekali, saat berkasnya masuk. Angka
-- kebocoran dari periode itu akan dibaca berkali-kali sesudahnya — di Reveal,
-- di laporan, di PDF yang diserahkan ke calon pengguna. Tanpa jejak yang ikut
-- tersimpan, tidak ada cara mengetahui bahwa angka satu bulan tertentu berasal
-- dari berkas yang kolom biayanya tidak terbaca lengkap.
--
-- Kolom sengaja nullable tanpa nilai bawaan: transaksi manual, impor mutasi
-- bank, dan seluruh baris lama memang tidak punya keyakinan impor marketplace,
-- dan NULL adalah pernyataan yang jujur untuk itu — bukan 'tinggi'.
-- ============================================================

alter table public.transactions
  add column if not exists import_confidence text;

alter table public.transactions drop constraint if exists transactions_import_confidence_check;
alter table public.transactions add constraint transactions_import_confidence_check
  check (import_confidence is null or import_confidence in ('tinggi', 'sedang', 'rendah'));

comment on column public.transactions.import_confidence is
  'Keyakinan deteksi kolom biaya saat impor laporan marketplace (task C3). '
  'NULL untuk transaksi manual, impor bank, dan baris sebelum fitur ini ada.';

-- Indeks parsial: yang dicari Reveal nanti hanya periode berkeyakinan RENDAH,
-- dan itu porsi kecil. Indeks penuh pada tabel terbesar tidak sebanding.
create index if not exists transactions_low_confidence_idx
  on public.transactions (user_id, occurred_at)
  where import_confidence = 'rendah';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions'
      and column_name = 'import_confidence'
  ) then
    raise exception 'Kolom import_confidence gagal dibuat';
  end if;
end $$;
