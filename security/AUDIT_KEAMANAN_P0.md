# LAPORAN AUDIT KEAMANAN P0 — BukuPintar AI (SmartBookAI)

**Project Supabase:** `SmartBookAi` (`hexaidoxmeycctpwfbst`, region ap-southeast-2)
**Tanggal audit:** 2026-07-27
**Metode:** Supabase Security & Performance Advisor + inspeksi langsung `pg_proc`, `pg_policy`, `storage.buckets`, `storage.objects` via SQL read-only.
**Fokus:** ketakutan "data bocor" & "data hilang" — hak akses, RLS, storage, fungsi berprivilege.

> Ringkas: postur keamanan **jauh lebih baik** dari yang dikhawatirkan Advisor. Dari 30+ warning, hanya **2 yang benar-benar perlu ditindak** (bucket listing + leaked-password), sisanya sudah ter-mitigasi di dalam kode atau memang harus begitu. Tidak ditemukan lubang kritis privilege-escalation atau data-loss.

---

## 1. Ringkasan Eksekutif

| # | Temuan Advisor | Realita setelah diperiksa | Severity | Tindakan |
|---|---|---|---|---|
| 1 | `product-images` public bucket allows listing | **NYATA** — siapa pun bisa meng-enumerasi path file semua tenant | 🔴 P0 | Drop policy (SQL) |
| 2 | Leaked password protection disabled | **NYATA** — user boleh pakai password bocor | 🟠 P1 | Toggle dashboard |
| 3 | `admin_delete_user/list/metrics` executable publik | **Aman** — ada guard `is_admin()` di dalam fungsi | 🟡 hygiene | Revoke anon |
| 4 | 13 fungsi `SECURITY DEFINER` exposed | Sebagian helper RLS wajib callable; sisanya trigger/registrasi | 🟡 hygiene | Revoke selektif |
| 5 | `pg_net` di schema public | Dipakai pg_cron pemicu `makro-harian`; memindah berisiko | 🟡 P2 | Tunda / hati-hati |
| 6 | ~500 lint performa (RLS initplan, FK index) | Bukan lubang keamanan; masalah skala | 🟠 P1 | Fase terpisah |

Tidak ada tabel dengan RLS mati. Tidak ada jalur user menaikkan diri jadi admin. Bucket struk (`receipts`) sudah privat & terkunci per pemilik.

---

## 2. Bukti & Analisis per Temuan

### 2.1 🔴 Bucket `product-images` — enumerasi lintas-tenant (SATU-SATUNYA P0)

Policy pada `storage.objects`:

| Policy | Perintah | Aturan | Verdict |
|---|---|---|---|
| `product_images_owner_insert` | INSERT | `(storage.foldername(name))[1] = auth.uid()` | ✅ tulis folder sendiri |
| `product_images_owner_update` | UPDATE | idem | ✅ |
| `product_images_owner_delete` | DELETE | idem | ✅ |
| `product_images_public_read` | SELECT | `bucket_id = 'product-images'` **(tanpa batas pemilik)** | 🔴 semua orang bisa LIST semua file |

**Dampak:** path objek berformat `<user_id>/<uuid>.ext`. Policy SELECT terbuka memungkinkan pihak luar meng-*list* seluruh objek → membocorkan daftar `user_id` dan semua foto produk lintas usaha. Bukan PII finansial, tapi tetap kebocoran data lintas-tenant + membuka enumerasi.

**Kenapa aman untuk di-drop:** bucket bertipe PUBLIC menyajikan objek lewat CDN publik (`/storage/v1/object/public/...`) yang **tidak** butuh policy SELECT ini. Kode aplikasi (`src/lib/api.js → uploadProductImage`) memakai `getPublicUrl`, jadi render foto tidak terpengaruh. Yang hilang hanya kemampuan LISTING.

**Opsi lebih kuat (opsional):** jadikan bucket privat + signed URL seperti `receipts`. Butuh perubahan kode di `uploadProductImage`/`deleteProductImage` dan tempat render. Untuk sekarang, drop policy listing = perbaikan minimal yang benar.

### 2.2 🟠 Leaked-password protection OFF

Supabase Auth bisa menolak password yang ada di HaveIBeenPwned. Saat ini nonaktif → akun rawan diambil alih via kredensial bocor. **Perbaikan:** Dashboard → Authentication → Policies/Password → aktifkan "Leaked password protection". (Tidak bisa lewat SQL; ini config Auth.)

### 2.3 ✅ Fungsi `admin_*` — TIDAK rentan (sudah ada guard)

Isi fungsi (dikutip dari DB):

- `admin_delete_user(uuid)` → `if not public.is_admin() then raise exception 'Tidak diizinkan'` **dan** menolak menghapus sesama admin. Aman.
- `admin_list_users()` → `... where public.is_admin()` → non-admin dapat **0 baris**. Aman.
- `admin_metrics()` → `case when not public.is_admin() then '{}'::jsonb ...` → non-admin dapat objek kosong. Aman.

Semua `SECURITY DEFINER` + `SET search_path` (mencegah search_path hijack). Advisor menandainya hanya karena *bisa dipanggil*, bukan karena *bisa dieksploitasi*.

### 2.4 ✅ Akar kepercayaan admin — tabel `admins` terkunci

`admins`: RLS **on**, hanya 1 policy `admin reads self` = SELECT `using (user_id = auth.uid())`. **Tidak ada** policy INSERT/UPDATE/DELETE → RLS memblok semua tulis dari `anon`/`authenticated`. Keanggotaan admin hanya bisa diberikan lewat service-role/SQL. **Tidak ada jalur self-escalation.**

### 2.5 ✅ Postur RLS keseluruhan

37 tabel `public` diperiksa: **semua `rowsecurity = true` dan punya ≥1 policy.** Tabel data-bersama (`commodity_prices`, `exchange_rates`, `macro_signals`, `macro_runs`) sengaja 1 policy (baca publik, tulis service-role) — sesuai desain Radar Harga. Tabel tenant (transactions, products, payrolls, dst) punya 2–5 policy (owner + staff via `has_access`).

> ⚠️ Catatan penting: "RLS aktif + ada policy" **belum membuktikan** policy-nya benar. Uji isolasi runtime 2-user (Part B) tetap wajib untuk memastikan User A benar-benar tak bisa membaca data User B. Audit ini memastikan *fondasinya ada*; Part B memastikan *fondasinya bekerja*.

### 2.6 ✅ Bucket `receipts` (struk — paling sensitif) sudah benar

Privat; `receipts read/insert/delete own` semuanya `(storage.foldername(name))[1] = auth.uid()`. Struk hanya bisa dibaca pemiliknya (via signed URL 10 menit di `getReceiptUrl`). Tidak ada tindakan.

### 2.7 🟡 Fungsi `SECURITY DEFINER` lain

| Fungsi | Peran | Tindakan | Alasan |
|---|---|---|---|
| `is_admin`, `has_access`, `effective_owner` | Helper di dalam policy RLS | **JANGAN revoke** | Mencabut EXECUTE = evaluasi policy patah = app rusak |
| `check_email_available`, `check_phone_available` | Cek saat registrasi | **Biarkan anon** | Dipanggil sebelum login |
| `accept_terms`, `bump_ai_usage` | Dipanggil user login/edge | Revoke `anon` | Tak pernah dipakai pra-login |
| `handle_new_user`, `log_audit`, `feedback_set_author` | Fungsi TRIGGER | Revoke `anon`+`authenticated` | Tak boleh dipanggil langsung; trigger tetap jalan |

### 2.8 🟡 `pg_net` di schema public

Dipakai `pg_cron` untuk memicu Edge `makro-harian` pukul 06.00 WIB. Memindahkannya ke schema lain bisa memutus pipeline harga. **Rekomendasi:** tunda; bila mau dirapikan, lakukan bersama review konfigurasi cron, bukan sekarang.

---

## 3. Remediasi

**Script:** [`security/remediasi_keamanan_p0.sql`](./remediasi_keamanan_p0.sql) — idempoten, konservatif, dengan blok verifikasi.

Cakupan script:
1. `drop policy product_images_public_read` (tutup enumerasi).
2. `revoke execute ... from anon` untuk `admin_*`, `accept_terms`, `bump_ai_usage`.
3. `revoke execute ... from anon, authenticated` untuk 3 fungsi trigger.
4. Sengaja **tidak** menyentuh helper RLS & fungsi registrasi.

**Manual (di luar SQL):**
- Aktifkan leaked-password protection (Dashboard → Authentication).
- (Opsional) pertimbangkan `product-images` privat + signed URL.

---

## 4. Urutan Apply yang Aman

1. Jalankan script di **branch/staging** dulu (`supabase db execute` atau SQL Editor pada project uji).
2. Jalankan blok verifikasi (a)–(c) di bawah script → pastikan hasil sesuai "harapan". **Kalau helper RLS jadi `false`, STOP** (jangan ke produksi).
3. Smoke test app staging: login, buka Stok Produk (foto tetap tampil), registrasi (cek email masih jalan), panel admin (masih bisa list user).
4. Apply ke produksi.
5. Jalankan ulang **Security Advisor** → `public_bucket_allows_listing` harus hilang.

---

## 5. Yang Audit Ini TIDAK Buktikan (lanjut ke Part B & seterusnya)

- **Isolasi tenant runtime** (User A vs User B nyata di setiap tabel + storage) — perlu RLS isolation test otomatis. **Ini gerbang launch terpenting berikutnya.**
- Atomicity RPC terhadap DB asli (rollback saat gagal parsial).
- Uji beban / performa RLS pada skala (temuan initplan & FK index).
- Verifikasi UU PDP (export & delete benar-benar tuntas).

---

## 6. Kesimpulan

Kekhawatiran "ada yang bisa hapus/lihat data orang lain" **tidak terbukti** pada lapisan hak akses: fungsi admin ber-guard, tabel admin terkunci, RLS aktif menyeluruh, struk privat. Satu kebocoran nyata (listing foto produk) dan satu kelemahan auth (password bocor) mudah ditutup dengan script + satu toggle. **Setelah remediasi ini + RLS isolation test (Part B) lulus, lapisan data-security siap untuk lanjut ke tahap launch.**
