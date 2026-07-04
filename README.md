# BukuPintar AI — Aplikasi Pembukuan Otomatis Multi-Channel untuk UMKM

Aplikasi web **full-stack nyata** (bukan demo): user mendaftar, login, mencatat &
mengimpor transaksi yang **tersimpan permanen** di database, lalu menghasilkan
laporan keuangan siap KUR & pajak. Dibangun dengan **React + Supabase**.

## ✨ Fitur yang benar-benar berfungsi

- **Autentikasi asli** — daftar & login dengan email/password (Supabase Auth).
- **Transaksi tersimpan** — tambah, edit, hapus, cari & filter; tiap user hanya
  melihat datanya sendiri (Row Level Security).
- **Import file nyata (CSV & Excel)** — unggah mutasi bank / QRIS / marketplace dalam
  format **.xlsx, .xls, .csv** (mis. ekspor Shopee/Tokopedia Seller Center). Parser
  otomatis melewati baris judul, mendeteksi kolom tanggal/keterangan/nominal
  (mendukung debit-kredit terpisah maupun nominal+tipe), lalu mengkategorikan tiap baris.
- **Edukasi KUR & Pajak** — penjelasan ringkas di halaman Laporan tentang syarat KUR
  dan PPh Final UMKM 0,5% (PP 55/2022), beserta cara memakai laporan yang dihasilkan.
- **Auto-kategori (rule-based)** — mesin aturan Bahasa Indonesia (PLN, QRIS, Shopee,
  Grab, dll). Bisa ditambah aturan kustom sendiri di Pengaturan.
- **Reconciliation engine** — mendeteksi transaksi duplikat lintas-channel
  (mis. notif WA + mutasi bank) berdasar nominal & waktu; bisa digabung/diabaikan.
- **Dashboard real-time** — KPI, tren arus kas, sumber pemasukan, pengeluaran per
  kategori — semua dihitung dari data nyata (Recharts).
- **Forum Feedback** — pengguna yang sudah login bisa berbagi masukan, memberi rating,
  dan menjawab "apakah aplikasi ini membantu?". Semua masukan terbaca di Dashboard Admin.
- **Laporan PDF asli** — generate PDF Laporan KUR (laba-rugi + arus kas bulanan)
  dan Rekap Pajak (PPh Final UMKM 0,5%) dengan jsPDF.
- **(Opsional) AI via Claude** — Edge Function siap-deploy untuk auto-kategori pakai
  LLM. App tetap jalan penuh tanpa ini.

## 🚀 Cara menjalankan (≈5 menit)

### 1. Install dependency
```bash
npm install
```

### 2. Siapkan Supabase (database)
1. Buat project gratis di [supabase.com](https://supabase.com).
2. **SQL Editor → New query** → tempel isi [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
3. **SQL Editor → New query** → tempel isi [`supabase/migration_auth.sql`](supabase/migration_auth.sql) → **Run**
   (menambah nomor telepon unik + fungsi cek ketersediaan).
4. Jalankan juga [`supabase/migration_v2.sql`](supabase/migration_v2.sql) lalu
   [`supabase/migration_admin.sql`](supabase/migration_admin.sql) — yang terakhir
   menambah **Forum Feedback**, pelacakan pemakaian, dan dukungan **Dashboard Admin**.

### 3. Isi kredensial
```bash
cp .env.example .env
```
Isi `.env` dari **Project Settings → API**:
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
VITE_PHONE_OTP=false
```

### 3b. Email andal untuk OTP & reset password (Resend — gratis)
Email bawaan Supabase dibatasi ~2–3/jam → tidak layak dipakai. Pakai Resend:
1. Daftar gratis di [resend.com](https://resend.com) → **API Keys** → buat key.
2. Supabase: **Project Settings → Authentication → SMTP Settings** → *Enable Custom SMTP*:
   - Host: `smtp.resend.com` · Port: `465` · User: `resend` · Pass: *(API key Resend)*
   - Sender email: alamat yang sudah diverifikasi di Resend.
3. Agar verifikasi pakai **kode OTP** (bukan link): **Authentication → Email Templates** →
   pada *Confirm signup* dan *Reset Password*, sisipkan token 6 digit:
   ```html
   <p>Kode verifikasi Anda: <b>{{ .Token }}</b></p>
   ```

### 3c. (Opsional, nanti) OTP SMS telepon
Butuh provider SMS berbayar (mis. Twilio). Setelah dipasang di
**Authentication → Providers → Phone**, set `VITE_PHONE_OTP=true` di `.env`.

### 4. Jalankan
```bash
npm run dev      # http://localhost:5173
```
Daftar akun → mulai mencatat. Coba juga **Import Data → Unduh contoh format CSV**
untuk menguji import.

> Jika `.env` belum diisi, app otomatis membuka halaman **/setup** berisi panduan ini.

## 🏗️ Build & deploy
```bash
npm run build    # output ke dist/
npm run preview
```
Deploy `dist/` ke Vercel/Netlify, atau seluruh project ke Railway/Fly.io.
Set env `VITE_SUPABASE_URL` & `VITE_SUPABASE_ANON_KEY` di dashboard hosting.

### (Opsional) Aktifkan AI Claude
```bash
supabase functions deploy categorize
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

## 🛠️ Dashboard Admin (folder terpisah)
Panel admin untuk memantau & mengelola seluruh aplikasi (lihat semua user, transaksi,
feedback; ukur efektivitas & kepuasan). Berjalan di port sendiri (`5174`) dan terhubung
ke database Supabase yang sama. Login dibatasi **satu akun admin**.

```bash
cd admin-dashboard
npm install
npm run create-admin   # buat akun admin (butuh service_role key di .env, sekali saja)
npm run dev            # http://localhost:5174
```
Panduan lengkap: [`admin-dashboard/README.md`](admin-dashboard/README.md).

## 📁 Struktur
```
supabase/
  schema.sql                 # tabel + RLS + trigger profil (jalankan di Supabase)
  functions/categorize/      # Edge Function AI opsional
src/
  main.jsx                   # entry + Router + AuthProvider
  App.jsx                    # definisi route & guard
  context/AuthContext.jsx    # state auth (Supabase)
  components/
    AppLayout.jsx            # shell sidebar aplikasi
    TransactionModal.jsx     # form tambah/edit transaksi
  pages/
    Landing.jsx              # halaman marketing publik
    Login / Register / Setup
    Dashboard / Transactions / Import / Reconciliation / Reports / Settings
  lib/
    supabase.js              # init client
    api.js                   # query database
    categorize.js            # mesin auto-kategori rule-based
    csvImport.js             # parser CSV (papaparse)
    analytics.js             # ringkasan, tren, deteksi duplikat
    format.js                # format Rupiah & tanggal
```

## 🔧 Tech
React 18 · React Router · Supabase (Postgres + Auth + RLS) · Recharts · PapaParse ·
jsPDF · Vite.

---
Catatan: estimasi pajak mengacu PP 55/2022 (PPh Final UMKM 0,5%); untuk pelaporan
resmi verifikasi dengan konsultan/DJP.
