-- ============================================================
-- Pengetatan hak eksekusi RPC (temuan advisor keamanan, 8 September 2026)
--
-- Supabase Database Linter melaporkan 51 fungsi SECURITY DEFINER yang bisa
-- dipanggil peran `anon`. Diuji satu per satu terhadap API produksi: hampir
-- semuanya memang sudah punya penjaga internal dan membalas kosong ([] / {})
-- untuk pemanggil tanpa sesi.
--
-- SATU yang tidak: `tenancy_lint()` membalas anon dengan daftar pelanggaran
-- invarian beserta NAMA constraint dan tabelnya —
--
--   [{"invarian":"T2_fk_tidak_komposit",
--     "objek":"ingredients.ingredients_source_product_id_fkey", ...}]
--
-- Itu bukan data pengguna, tapi ia menyerahkan peta struktur database beserta
-- titik-titik lemahnya kepada siapa pun yang menebak nama endpoint-nya. Alat
-- diagnostik internal tidak punya alasan untuk bisa dipanggil dari browser.
--
-- YANG SENGAJA TIDAK DISENTUH:
--   is_admin(), has_access(), effective_owner(), resolve_owner()
-- Keempatnya dipakai DI DALAM policy RLS. Mencabut EXECUTE-nya akan mematahkan
-- evaluasi RLS seluruh aplikasi — bukan mengetatkan, melainkan mematikan.
-- Peringatan yang sama sudah tercatat di security/remediasi_keamanan_p0.sql.
--
--   check_email_available(), check_phone_available(), otp_attempt_*(),
--   accept_terms(), accept_invitation(), decline_invitation()
-- Dipanggil pada alur daftar/login/undangan ketika pengguna memang BELUM punya
-- sesi penuh. Mencabutnya akan mematahkan pendaftaran.
-- ============================================================

-- ---------- 1) Alat diagnostik internal: bukan endpoint publik ----------
revoke execute on function public.tenancy_lint() from anon;
revoke execute on function public.tenancy_lint() from authenticated;

-- ---------- 2) Fungsi admin: cabut dari anon ----------
-- Penjaga internalnya sudah benar (terverifikasi membalas kosong), tetapi
-- pertahanan berlapis berarti permintaan tanpa sesi tidak perlu sampai ke
-- badan fungsi sama sekali. `authenticated` TETAP diberi akses — admin panel
-- memakai sesi biasa dan penjaga is_admin() ada di dalam fungsinya.
revoke execute on function public.admin_list_users() from anon;
revoke execute on function public.admin_metrics() from anon;
revoke execute on function public.admin_quota_overview() from anon;
revoke execute on function public.admin_ai_telemetry(integer) from anon;
revoke execute on function public.admin_delete_user(uuid) from anon;

-- ---------- 3) Fungsi milik-sendiri: tidak masuk akal tanpa sesi ----------
revoke execute on function public.my_workspaces() from anon;
revoke execute on function public.my_pending_invitations() from anon;
revoke execute on function public.my_ai_credits() from anon;
revoke execute on function public.my_modules(uuid) from anon;
revoke execute on function public.my_monthly_summary(uuid) from anon;

-- ---------- 4) Operasi tulis berat: tidak boleh dari sesi anonim ----------
revoke execute on function public.add_transaction_with_stock(jsonb, jsonb) from anon;
revoke execute on function public.add_transaction_with_stock(jsonb, jsonb, uuid) from anon;
revoke execute on function public.post_stock_opname(uuid, jsonb) from anon;
revoke execute on function public.post_stock_opname(uuid, jsonb, uuid) from anon;
revoke execute on function public.receive_purchase_order(uuid, boolean, text, text, date) from anon;
revoke execute on function public.receive_purchase_order(uuid, boolean, text, text, date, uuid) from anon;

-- ---------- 5) Pemeliharaan: hanya service role ----------
revoke execute on function public.prune_auth_rate_limits(integer) from anon;
revoke execute on function public.prune_auth_rate_limits(integer) from authenticated;

-- ---------- 6) Penghitung kuota lama yang sudah ditinggalkan ----------
-- Digantikan checkQuota/commitQuota sejak migrasi G-18; menyisakannya terbuka
-- berarti menyisakan jalan menaikkan penghitung pemakaian orang lain.
revoke execute on function public.bump_ai_usage(text, integer) from anon;

-- ---------- 7) search_path yang bisa diubah peran (temuan advisor) ----------
-- Tanpa search_path tetap, pemanggil bisa menyisipkan schema-nya sendiri di
-- depan `public` dan membuat fungsi ini memanggil objek palsu.
alter function public.ai_today_pacific() set search_path = public;
alter function public.norm_phone_id(text) set search_path = public;

-- ---------- 8) Overload usang yang membuat pemanggilan ambigu ----------
-- Ada dua my_monthly_summary: () dan (uuid). PostgREST tidak bisa memilih
-- ketika dipanggil tanpa argumen, dan membalas PGRST203. Aplikasi selalu
-- mengirim p_owner sehingga tidak terdampak, tetapi jalur CADANGAN di
-- api.js:234 memanggilnya tanpa argumen — jadi jalur pemulihan itu dijamin
-- gagal justru pada saat ia dibutuhkan.
--
-- Versi tanpa argumen adalah peninggalan sebelum workspace ada; yang ber-uuid
-- sudah menangani kasus "owner = diri sendiri" lewat resolve_owner().
drop function if exists public.my_monthly_summary();

-- ---------- 9) Cabut dari PUBLIC, bukan hanya dari anon ----------
--
-- Uji ulang setelah bagian 2 memperlihatkan admin_list_users & admin_metrics
-- MASIH bisa dipanggil anon. Sebabnya: hak eksekusinya tidak pernah datang dari
-- grant `anon`, melainkan dari grant bawaan Postgres ke peran `PUBLIC` — yang
-- mencakup setiap peran, termasuk anon. `revoke ... from anon` mencabut sesuatu
-- yang memang tidak pernah ada, lalu tampak berhasil tanpa mengubah apa pun.
--
-- Jadi urutannya harus: cabut dari PUBLIC dulu, baru berikan kembali secara
-- eksplisit ke peran yang memang berhak.
revoke execute on function public.admin_list_users() from public;
revoke execute on function public.admin_metrics() from public;
revoke execute on function public.admin_quota_overview() from public;
revoke execute on function public.admin_ai_telemetry(integer) from public;
revoke execute on function public.admin_delete_user(uuid) from public;
revoke execute on function public.tenancy_lint() from public;
revoke execute on function public.prune_auth_rate_limits(integer) from public;
revoke execute on function public.my_workspaces() from public;
revoke execute on function public.my_pending_invitations() from public;
revoke execute on function public.my_ai_credits() from public;
revoke execute on function public.my_modules(uuid) from public;
revoke execute on function public.my_monthly_summary(uuid) from public;
revoke execute on function public.bump_ai_usage(text, integer) from public;

-- Kembalikan ke pengguna yang SUDAH login. Penjaga is_admin() di dalam fungsi
-- admin_* tetap menjadi lapis yang menentukan siapa yang benar-benar dilayani.
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_metrics() to authenticated;
grant execute on function public.admin_quota_overview() to authenticated;
grant execute on function public.admin_ai_telemetry(integer) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;
grant execute on function public.my_workspaces() to authenticated;
grant execute on function public.my_pending_invitations() to authenticated;
grant execute on function public.my_ai_credits() to authenticated;
grant execute on function public.my_modules(uuid) to authenticated;
grant execute on function public.my_monthly_summary(uuid) to authenticated;

-- tenancy_lint & prune_auth_rate_limits TIDAK dikembalikan ke authenticated:
-- keduanya alat pemeliharaan, tempatnya SQL Editor / service role.
grant execute on function public.tenancy_lint() to service_role;
grant execute on function public.prune_auth_rate_limits(integer) to service_role;
