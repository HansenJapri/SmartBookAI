-- ============================================================
-- KOREKSI HARGA MODEL KE TARIF RESMI GOOGLE
--
-- Jalankan SETELAH migration_ai_biaya_usd.sql. Aman diulang.
--
-- Seed pada migration_ai_biaya_usd.sql bertanda "PERIKSA" dan hanya perkiraan
-- kelas model, ditulis sebelum tarif resmi Gemini 3.x diketahui. Diverifikasi
-- terhadap ai.google.dev/gemini-api/docs/pricing pada 2026-09-18, ternyata
-- MELESET JAUH — seluruhnya terlalu rendah:
--
--   model                      seed lama        resmi          meleset
--   gemini-3.5-flash-lite      0,10 / 0,40      0,30 / 2,50    6,25x
--   gemini-3.1-flash-lite      0,10 / 0,40      0,25 / 1,50    3,75x
--   gemini-3.5-flash           0,30 / 2,50      1,50 / 9,00    3,6x
--   gemini-3.1-flash-tts       0,50 / 2,00      1,00 / 20,00   10x
--
-- DIPERBAIKI DI TEMPAT pada baris effective_from 2026-01-01, BUKAN disisipkan
-- sebagai baris bertanggal hari ini. effective_from ada untuk PERUBAHAN HARGA
-- yang sungguh terjadi, bukan untuk menambal angka karangan — menyisipkan
-- baris baru akan mengabadikan placeholder itu sebagai "harga yang berlaku
-- Januari-September" dan membuat seluruh biaya historis tetap salah, persis
-- angka yang dipakai untuk memutuskan harga paket.
-- ============================================================

update public.ai_model_prices set
  input_usd_mtok = 0.30, output_usd_mtok = 2.50,
  note = 'Resmi ai.google.dev/gemini-api/docs/pricing, diperiksa 2026-09-18'
where model = 'gemini-3.5-flash-lite' and effective_from = date '2026-01-01';

update public.ai_model_prices set
  input_usd_mtok = 0.25, output_usd_mtok = 1.50,
  note = 'Resmi 2026-09-18. Tarif teks/gambar/video; masukan AUDIO 0,50 (tidak dipakai rute ini)'
where model = 'gemini-3.1-flash-lite' and effective_from = date '2026-01-01';

update public.ai_model_prices set
  input_usd_mtok = 1.50, output_usd_mtok = 9.00,
  note = 'Resmi ai.google.dev/gemini-api/docs/pricing, diperiksa 2026-09-18'
where model = 'gemini-3.5-flash' and effective_from = date '2026-01-01';

update public.ai_model_prices set
  input_usd_mtok = 1.00, output_usd_mtok = 20.00,
  note = 'Resmi 2026-09-18. Keluaran 20,00 — TERMAHAL di seluruh rute aplikasi ini'
where model = 'gemini-3.1-flash-tts-preview' and effective_from = date '2026-01-01';

-- Model Live yang dipakai voice_live/voice_crud ADA di dokumentasi model tapi
-- TIDAK ADA di halaman harga: Google menandainya "Legacy audio-to-audio preview
-- model. We recommend updating to Gemini 3.8 Live." Harganya diambil dari
-- penerus yang Google sendiri tunjuk, dan ditandai PROKSI supaya tidak ada yang
-- mengira angka ini terbit resmi untuk model ini.
update public.ai_model_prices set
  input_usd_mtok = 3.00, output_usd_mtok = 12.00,
  note = 'PROKSI dari gemini-3.8-live (tarif audio). Model ini LEGACY dan tidak punya harga terbit; Google menganjurkan migrasi ke 3.8 Live'
where model = 'gemini-3.1-flash-live-preview' and effective_from = date '2026-01-01';

-- Penerus resmi, didaftarkan lebih dulu supaya migrasi voice tidak perlu
-- menunggu pembaruan tabel harga.
insert into public.ai_model_prices (model, input_usd_mtok, output_usd_mtok, effective_from, note) values
  ('gemini-3.8-live', 3.00, 12.00, date '2026-01-01',
   'Resmi 2026-09-18, tarif AUDIO (teks 0,75 masuk / 4,50 keluar). Penerus yang dianjurkan untuk gemini-3.1-flash-live-preview'),
  ('gemini-3.6-flash', 0.75, 3.75, date '2026-01-01',
   'Resmi 2026-09-18. Tarif promo berlaku s/d 31 Des 2026; naik 2x jadi 1,50/7,50 pada 1 Jan 2027')
on conflict (model, effective_from) do update
  set input_usd_mtok = excluded.input_usd_mtok,
      output_usd_mtok = excluded.output_usd_mtok,
      note = excluded.note;

-- Dihapus: baris ini di-seed untuk model yang TIDAK ADA di halaman harga
-- maupun di FEATURE_ROUTES, dengan angka karangan. Nol pemakaian, nol
-- rujukan. Harga yang salah untuk model hantu lebih berbahaya daripada tidak
-- ada barisnya sama sekali: ia akan menghitung diam-diam kalau suatu saat ada
-- rute yang menunjuk ke sana.
delete from public.ai_model_prices
 where model = 'gemini-3.1-flash'
   and not exists (select 1 from public.workspace_ai_usage u where u.last_model = 'gemini-3.1-flash');
