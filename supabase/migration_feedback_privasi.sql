-- ============================================================
-- P19 — Isolasi privasi forum & feedback (1-on-1 pengguna <-> Admin)
-- Terpasang di project hexaidoxmeycctpwfbst sebagai migrasi `feedback_privasi_1on1`.
-- ============================================================
--
-- Kondisi sebelumnya: policy "feedback read all (login)" memakai USING (true),
-- sehingga SETIAP pengguna yang login bisa membaca seluruh baris feedback milik
-- pengguna lain — termasuk isi pesan yang sering memuat nama usaha, angka omzet,
-- dan keluhan operasional. Ini kebocoran data lintas penyewa (cross-tenant),
-- bukan sekadar masalah tampilan: menyembunyikan daftarnya di UI tidak menutup
-- apa pun karena endpoint PostgREST bisa dipanggil langsung dengan token yang sama.
--
-- Sesudah perbaikan: pengguna hanya melihat barisnya sendiri. Admin SmartBook AI
-- tetap melihat semuanya lewat policy "feedback admin all" (is_admin()) yang
-- sudah ada sebelumnya dan sengaja TIDAK disentuh di sini.

drop policy if exists "feedback read all (login)" on public.feedback;

create policy "feedback select own" on public.feedback
  for select
  using (auth.uid() = user_id);
