-- ============================================================
-- MIGRASI LEGAL — Identitas Pengendali Data & kontak resmi (task B1)
--
-- Latar: isi /privasi dan /ketentuan diambil dari tabel public.legal_docs,
-- BUKAN dari src/lib/legal.js. Konstanta di legal.js hanya dipakai sebagai
-- fallback saat baris DB kosong (lihat src/components/LegalDoc.jsx). Karena
-- itu menaikkan CONTROLLER_NAME/CONTACT_EMAIL di kode saja tidak mengubah
-- apa pun yang dilihat pengguna — perubahan harus sampai ke DB.
--
-- migration_legal.sql memakai `on conflict (slug) do nothing`, sehingga
-- menjalankan ulang berkas itu TIDAK memperbarui baris yang sudah ada.
--
-- Yang diperbaiki:
--   1. Pengendali Data tidak teridentifikasi ("Pengelola BukuPintar AI").
--   2. Kontak ditulis "surel resmi yang tertera pada Aplikasi" — dokumen tidak
--      pernah menyebut alamat surelnya, padahal UU PDP 27/2022 mensyaratkan
--      kanal yang bisa dihubungi untuk pelaksanaan hak subjek data.
--
-- Sifat: bedah (replace frasa), bukan tulis ulang dokumen — supaya suntingan
-- admin lewat dashboard tidak ikut tertimpa. Aman diulang (idempoten): setelah
-- dijalankan sekali, frasa sumbernya tidak ada lagi sehingga replace jadi no-op.
-- ============================================================

-- ---------- 1) KEBIJAKAN PRIVASI: identitas Pengendali Data ----------
update public.legal_docs set
  content = replace(
    content,
    'Pengelola BukuPintar AI ("Kami")',
    'Sovralytics Technology (usaha perorangan), selanjutnya disebut "Kami"'
  ),
  updated_at = now()
where slug = 'privacy'
  and content like '%Pengelola BukuPintar AI ("Kami")%';

-- ---------- 2) SYARAT & KETENTUAN: definisi "Pengelola" ----------
-- Menyamakan dengan fallback di src/components/LegalContent.jsx.
update public.legal_docs set
  content = replace(
    content,
    '- **Pengelola** adalah pihak yang menyediakan dan mengelola Aplikasi.',
    '- **Pengelola** adalah Sovralytics Technology (usaha perorangan), pihak yang menyediakan dan mengelola Aplikasi.'
  ),
  updated_at = now()
where slug = 'terms'
  and content like '%- **Pengelola** adalah pihak yang menyediakan dan mengelola Aplikasi.%';

-- ---------- 3) KEDUA DOKUMEN: alamat surel yang sebenarnya ----------
-- 2 kemunculan di 'privacy' (identitas + bagian hak subjek data),
-- 1 kemunculan di 'terms' (bagian Kontak).
update public.legal_docs set
  content = replace(
    content,
    'surel resmi yang tertera pada Aplikasi',
    'surel sovralyticstech@gmail.com'
  ),
  updated_at = now()
where content like '%surel resmi yang tertera pada Aplikasi%';

-- ---------- 4) VERIFIKASI ----------
-- Gagalkan migrasi bila masih ada dokumen tanpa alamat kontak yang nyata,
-- supaya kekurangan ini tidak lolos diam-diam seperti sebelumnya.
do $$
declare
  v_sisa int;
begin
  select count(*) into v_sisa
  from public.legal_docs
  where content like '%surel resmi yang tertera pada Aplikasi%'
     or content not like '%@%';

  if v_sisa > 0 then
    raise exception 'Masih ada % dokumen legal tanpa alamat kontak yang dapat dihubungi.', v_sisa;
  end if;
end $$;

-- ---------- PEMULIHAN ----------
-- Isi dokumen sebelum migrasi ini disimpan di public.legal_docs_backup_b1
-- (dibuat saat B1 dijalankan, RLS aktif sehingga tidak terekspos PostgREST).
--
--   update public.legal_docs d set content = b.content, updated_at = now()
--   from public.legal_docs_backup_b1 b where b.slug = d.slug;
--
-- Setelah B1 diverifikasi dan stabil, tabel snapshot boleh dibuang:
--   drop table if exists public.legal_docs_backup_b1;
