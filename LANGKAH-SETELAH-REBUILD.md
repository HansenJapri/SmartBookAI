# Langkah setelah database dibangun ulang

Proyek Supabase lama (`hexaidoxmeycctpwfbst`) terhapus 8 September 2026.
Proyek baru sudah dibuat dan skemanya lengkap. Dokumen ini mendaftar **hanya
yang belum bisa saya kerjakan** — semuanya butuh akses yang tidak saya punya.

**Kredensial baru:**

```
Project ref  : vbzmtnpmtgrhovmwjqqk
URL          : https://vbzmtnpmtgrhovmwjqqk.supabase.co
Region       : Southeast Asia (Singapore)
Dashboard    : https://supabase.com/dashboard/project/vbzmtnpmtgrhovmwjqqk
```

Urutkan dari atas. Langkah 1–3 wajib supaya aplikasi hidup; 4–5 supaya fitur AI
dan email jalan.

---

## 1. Perbarui environment variable di Vercel  ⚠️ PALING PENTING

Tanpa ini aplikasi di `smartbookai.id` masih menunjuk database yang **sudah
tidak ada**, jadi login pun akan gagal.

1. Buka https://vercel.com/hansenjapris-projects/smart-book-ai/settings/environment-variables
2. Cari `VITE_SUPABASE_URL` → **Edit** → ganti nilainya jadi:
   ```
   https://vbzmtnpmtgrhovmwjqqk.supabase.co
   ```
3. Cari `VITE_SUPABASE_ANON_KEY` → **Edit** → ganti jadi:
   ```
   eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZiem10bnBtdGdyaG92bXdqcXFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTYyMDAsImV4cCI6MjEwNDQzMjIwMH0.VLTN02gi-FQ9zy48Ih8lrm8OkZbmRxE9IDBnRU9-ZpE
   ```
   (Anon key memang kunci publik — aman ditulis di sini. Keamanan dijaga RLS.)
4. Pastikan keduanya berlaku untuk **Production**.
5. **Redeploy**: Deployments → deployment teratas → titik tiga → **Redeploy**.

> Kalau variabel itu ternyata TIDAK ada di Vercel, berarti build memakai
> `.env.production` dari repo — dan berkas itu sudah saya perbarui. Cukup
> lakukan langkah 2 (push), lalu Vercel rebuild otomatis.

---

## 2. Push kode ke GitHub

```bash
cd "D:/My Project/SmartBookAI"
git push -u origin telemetri-token-dan-kredit-ai
```

Branch ini berisi perbaikan CORS/AI kemarin **dan** rebuild hari ini. Setelah
di-push, buat Pull Request lalu merge ke `main` agar Vercel deploy versi baru.

---

## 3. Daftar ulang akun + jadikan admin

Semua akun lama hilang. Akun Anda harus dibuat ulang.

1. Buka https://smartbookai.id/register (setelah langkah 1 & 2 selesai)
2. Daftar dengan email Anda seperti biasa
3. Jadikan akun itu admin — buka
   [SQL Editor](https://supabase.com/dashboard/project/vbzmtnpmtgrhovmwjqqk/sql/new),
   ganti emailnya, lalu Run:

```sql
insert into public.admins (user_id, email)
select id, email from auth.users where email = 'EMAIL-ANDA@contoh.com'
on conflict do nothing;

-- verifikasi
select * from public.admins;
```

Kategori, satuan, dan data awal lain terisi **otomatis** saat daftar (ada
trigger `on_auth_user_created`) — tidak perlu diisi manual.

---

## 4. Kunci Gemini — supaya fitur AI hidup

Kunci lama hanya pernah ada sebagai secret Supabase dan ikut terhapus. Nilainya
tidak tersimpan di mana pun, jadi **harus dibuat baru**.

1. Buka https://aistudio.google.com/apikey
2. **Create API key** → salin. Buat **tiga** kunci berbeda kalau ingin isolasi
   kuota antar-fitur; satu kunci dipakai bertiga juga boleh (lebih sederhana,
   tapi satu kunci dicabut = semua fitur AI mati bersamaan).
3. Jalankan (ganti `AIza...` dengan kunci Anda):

```bash
cd "D:/My Project/SmartBookAI"
supabase secrets set GEMINI_KEY_A=AIza_kunci_pertama --project-ref vbzmtnpmtgrhovmwjqqk
supabase secrets set GEMINI_KEY_B=AIza_kunci_kedua  --project-ref vbzmtnpmtgrhovmwjqqk
supabase secrets set GEMINI_KEY_C=AIza_kunci_ketiga --project-ref vbzmtnpmtgrhovmwjqqk
```

> ⚠️ Jangan menyalin contoh mentah-mentah. Pernah terjadi perintah disalin apa
> adanya sehingga ketiga slot berisi teks `<key>` — dan itu justru mematikan
> seluruh AI, karena nilai placeholder menang atas kunci cadangan yang masih sah.

4. Verifikasi tanpa menunggu besok:

```bash
supabase functions deploy makro-harian --project-ref vbzmtnpmtgrhovmwjqqk
curl -s -X POST "https://vbzmtnpmtgrhovmwjqqk.supabase.co/functions/v1/makro-harian" \
  -H "Content-Type: application/json" -d '{}'
```

Harus muncul `"ai":{"status":"ok", ...}`. Kalau masih `gagal`, pesan
detailnya menyebut sebabnya persis.

---

## 5. Email (OTP, verifikasi, reset password)

Pengaturan SMTP dan template email tersimpan di Dashboard — ikut terhapus.

**a. Template** (WAJIB, kalau tidak kode OTP tidak muncul di email):

Dashboard → Authentication → Emails. Untuk **Confirm signup** dan **Reset
Password**, isi dari berkas di repo:

- `supabase/email-templates/confirm-signup.html`
- `supabase/email-templates/reset-password.html`
- `supabase/email-templates/magic-link.html`

Pastikan `{{ .Token }}` ada di badan email — itu kode OTP-nya.

**b. SMTP** (disarankan): Dashboard → Project Settings → Authentication → SMTP.
Tanpa SMTP sendiri, Supabase memakai email bawaan yang dibatasi ~2–3 email/jam
dan sering masuk spam. Kalau dulu Anda pakai Resend, pasang lagi di sini.

---

## Yang SUDAH selesai (tidak perlu Anda kerjakan)

| | |
|---|---|
| 48 tabel + seluruh RLS, fungsi, trigger | ✅ 47/47 migrasi sukses |
| Bucket `product-images` & `receipts` | ✅ + policy P0 sudah aman |
| 13 Edge Function | ✅ ter-deploy |
| Cron `makro-harian` (harian) & `keepalive` (tiap ≤6 hari) | ✅ aktif, URL benar |
| Secret `APP_ORIGIN`, `SELFTEST_TOKEN`, `KEEPALIVE_TOKEN` | ✅ terpasang |
| Harga SP2KP, kurs, inflasi | ✅ sudah terisi hari ini |
| `.env`, `.env.production`, `config.toml`, `DEPLOY.md`, Postman | ✅ menunjuk ref baru |

## Yang hilang permanen

Data lama: 8 akun, 78 transaksi, 6 produk, 3 supplier, 5 karyawan, 4 payroll,
9 skor KPI. Tidak ada cara mengembalikannya — free tier tidak punya undelete.

Riwayat harga komoditas & sinyal AI akan terisi ulang sendiri: cron harian
menambah satu hari data tiap pagi jam 06.00 WIB.
