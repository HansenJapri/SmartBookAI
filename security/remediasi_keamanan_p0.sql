-- ============================================================
-- REMEDIASI KEAMANAN P0 — BukuPintar AI (project hexaidoxmeycctpwfbst)
--
-- Sifat: IDEMPOTEN & konservatif. TINJAU dulu, jalankan di STAGING/branch
-- sebelum produksi. Skrip ini TIDAK menyentuh fungsi helper RLS
-- (is_admin/has_access/effective_owner) karena dipakai DI DALAM policy —
-- mencabut EXECUTE-nya akan mematahkan evaluasi RLS seluruh aplikasi.
--
-- Cara apply (pilih salah satu):
--   a) Supabase Dashboard > SQL Editor > tempel > Run (di staging dulu).
--   b) supabase db execute -f security/remediasi_keamanan_p0.sql
--   c) minta saya apply via MCP apply_migration (butuh konfirmasi Anda).
--
-- Verifikasi sesudahnya ada di bagian paling bawah + AUDIT_KEAMANAN_P0.md.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) BUCKET product-images: tutup enumerasi lintas-tenant
-- ------------------------------------------------------------
-- Policy `product_images_public_read` = SELECT `using (bucket_id='product-images')`
-- tanpa batasan pemilik → SIAPA PUN (termasuk anon) bisa MELISTING seluruh
-- objek semua pengguna via storage API. Karena bucket ini PUBLIC, akses objek
-- lewat URL publik (getPublicUrl) TETAP berfungsi tanpa policy ini —
-- yang hilang hanya kemampuan LISTING/enumerasi. Kode app memakai getPublicUrl
-- (src/lib/api.js: uploadProductImage), jadi render foto TIDAK terpengaruh.
drop policy if exists "product_images_public_read" on storage.objects;

-- Policy tulis milik-sendiri (insert/update/delete owner) DIBIARKAN — sudah benar:
--   product_images_owner_insert/update/delete => (storage.foldername(name))[1] = auth.uid()

-- ------------------------------------------------------------
-- 2) RPC yang tak pernah dipanggil sebelum login: cabut EXECUTE dari anon
--    (fungsi tetap ber-guard is_admin()/auth.uid() di dalam — ini lapis kedua)
-- ------------------------------------------------------------
revoke execute on function public.admin_delete_user(uuid)          from anon;
revoke execute on function public.admin_list_users()               from anon;
revoke execute on function public.admin_metrics()                  from anon;
revoke execute on function public.accept_terms(text)               from anon;
revoke execute on function public.bump_ai_usage(text, integer)     from anon;
-- Catatan: role `authenticated` DIBIARKAN untuk kelima fungsi di atas
-- (panel admin & edge function memanggilnya sebagai user login; guard internal
-- tetap menolak non-admin / sesi kosong).

-- ------------------------------------------------------------
-- 3) Fungsi TRIGGER: tidak boleh dipanggil langsung sebagai RPC.
--    Cabut dari anon & authenticated. Eksekusi trigger TIDAK memeriksa
--    privilege EXECUTE pemanggil, jadi trigger tetap berjalan normal.
-- ------------------------------------------------------------
revoke execute on function public.handle_new_user()     from anon, authenticated;
revoke execute on function public.log_audit()           from anon, authenticated;
revoke execute on function public.feedback_set_author() from anon, authenticated;

-- ------------------------------------------------------------
-- SENGAJA TIDAK DIUBAH (mengubahnya = merusak aplikasi):
--   public.is_admin()                      -> dipakai di policy RLS
--   public.has_access(uuid, text)          -> dipakai di policy RLS
--   public.effective_owner()               -> dipakai di policy RLS
--   public.check_email_available(text)     -> dipanggil ANON saat registrasi
--   public.check_phone_available(text)     -> dipanggil ANON saat registrasi
-- ------------------------------------------------------------

commit;

-- ============================================================
-- VERIFIKASI (jalankan setelah commit; harus sesuai "harapan")
-- ============================================================

-- (a) Policy listing product-images sudah hilang → harapan: 0 baris.
-- select polname from pg_policy
-- where polrelid='storage.objects'::regclass and polname='product_images_public_read';

-- (b) anon tak lagi bisa EXECUTE admin_*/bump/accept → harapan: semua false.
-- select p.proname,
--        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
-- from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
-- where p.proname in ('admin_delete_user','admin_list_users','admin_metrics',
--                     'accept_terms','bump_ai_usage','handle_new_user','log_audit','feedback_set_author')
-- order by p.proname;

-- (c) helper RLS MASIH executable oleh authenticated → harapan: semua true
--     (kalau ada yang false, RLS akan patah — JANGAN lanjut ke produksi).
-- select p.proname,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
-- from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
-- where p.proname in ('is_admin','has_access','effective_owner',
--                     'check_email_available','check_phone_available');

-- (d) Setelah ini, jalankan ulang Security Advisor. Warning yang HILANG:
--     public_bucket_allows_listing (product-images).
--     Warning anon_security_definer_function_executable akan berkurang untuk
--     fungsi yang di-revoke; sisanya (is_admin/has_access/effective_owner/
--     check_*) WAJAR karena memang harus callable.
