# BukuPintar — Dashboard Admin

Aplikasi **terpisah** (folder & port sendiri) untuk memantau dan mengelola seluruh
BukuPintar dari belakang layar. Terhubung ke **project Supabase yang sama** dengan
aplikasi utama, jadi semua data tampil **realtime** — berjalan di `localhost` tapi
datanya online.

Yang bisa dilakukan:
- **Overview** — KPI kesehatan aplikasi: jumlah pengguna, pengguna aktif, total
  transaksi & nilai, rata-rata kepuasan, % merasa terbantu, tren pendaftaran & transaksi.
- **Pengguna** — lihat **semua** akun + statistik aktivitas, **edit** profil, **hapus**
  akun beserta seluruh datanya (CRUD penuh).
- **Transaksi** — telusuri/edit/hapus transaksi lintas semua pengguna.
- **Feedback** — baca forum masukan, **balas**, ubah status, atau hapus (moderasi).
- **Analitik** — efektivitas (funnel adopsi, pemakaian fitur), kepuasan (distribusi
  bintang, NPS, % terbantu) dan suara pengguna (kutipan langsung).

Hanya **satu akun admin** yang bisa masuk. Tidak ada pendaftaran publik — akun dibuat
dari backend lewat skrip.

---

## ⚙️ Setup (sekali saja, ±5 menit)

### 1. Jalankan migrasi database
Di **Supabase Dashboard → SQL Editor → New query**, jalankan **berurutan** (lewati yang
sudah pernah dijalankan untuk aplikasi utama):

1. `../supabase/schema.sql`
2. `../supabase/migration_auth.sql`
3. `../supabase/migration_v2.sql`
4. **`../supabase/migration_admin.sql`**  ← baru (admin + feedback + analitik + realtime)

### 2. Isi kredensial
File `.env` sudah berisi `VITE_SUPABASE_URL` & `VITE_SUPABASE_ANON_KEY` (sama dengan
aplikasi utama). Tambahkan **service_role key** sementara untuk membuat akun admin:

```
SUPABASE_SERVICE_ROLE_KEY=...   # Supabase → Project Settings → API → service_role secret
```

> ⚠️ `service_role` adalah kunci RAHASIA (bypass semua keamanan). Dipakai HANYA oleh
> skrip di langkah 4, di komputermu. Jangan commit / sebar. Boleh dihapus dari `.env`
> setelah akun dibuat.

### 3. Install dependency
```bash
cd admin-dashboard
npm install
```

### 4. Buat akun admin (otomatis, langsung aktif)
```bash
npm run create-admin
```
Skrip membuat akun **hansenj5206@gmail.com** dengan password yang sudah ditentukan,
menandainya verified, dan mendaftarkannya sebagai satu-satunya admin.

### 5. Jalankan dashboard
```bash
npm run dev      # http://localhost:5174
```
Login dengan email & password di atas. Selesai 🎉

> Aplikasi utama tetap jalan seperti biasa di `npm run dev` (port 5173).
> Keduanya berbagi database Supabase yang sama.

---

## 🔐 Model keamanan

- Tabel `public.admins` menentukan siapa admin. Tidak ada policy INSERT untuk
  user biasa → **mustahil mendaftarkan admin dari UI**; hanya skrip service_role
  (langkah 4) yang bisa menambah baris ke sana.
- Fungsi `is_admin()` dipakai oleh semua kebijakan RLS "admin lihat semua".
  Pengguna biasa tetap hanya melihat datanya sendiri.
- Login dashboard memverifikasi `is_admin()` setelah autentikasi; akun non-admin
  langsung di-_sign-out_.
- Operasi sensitif (hapus user total) lewat fungsi `SECURITY DEFINER`
  `admin_delete_user()` yang dijaga `is_admin()` dan menolak menghapus sesama admin.

## 🏗️ Build produksi
```bash
npm run build && npm run preview
```

## 🧩 Tech
React 18 · React Router · Supabase (Postgres + Auth + RLS + Realtime) · Recharts · Vite.
