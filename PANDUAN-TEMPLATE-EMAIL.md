# Panduan: pasang template email + setelan auth

Semua langkah di bawah lewat **Supabase Dashboard**. Tidak bisa lewat CLI:
`supabase config push` mendorong SELURUH konfigurasi, dan `config.toml` kita
tidak punya bagian `[auth]` — jadi push akan mengirim nilai bawaan CLI,
termasuk `site_url = http://localhost:3000`, yang justru merusak email produksi.

Kerjakan berurutan. Langkah 1 dan 2 sama pentingnya — template yang benar
tetap gagal kalau Site URL-nya salah.

---

## Langkah 1 — Site URL & Redirect URLs  ⚠️ KERJAKAN DULU

Proyek baru masih memakai bawaan `http://localhost:3000`. Aplikasi memanggil
`redirectTo: window.location.origin + '/reset-password'`
(`src/context/AuthContext.jsx:169`), jadi tanpa langkah ini **reset password
akan ditolak** dengan error "redirect URL not allowed".

Buka: https://supabase.com/dashboard/project/vbzmtnpmtgrhovmwjqqk/auth/url-configuration

**Site URL** → isi:

```
https://smartbookai.id
```

**Redirect URLs** → klik *Add URL*, tambahkan satu per satu:

```
https://smartbookai.id/**
https://www.smartbookai.id/**
https://smart-book-ai.vercel.app/**
http://localhost:5173/**
```

Klik **Save**.

---

## Langkah 2 — Template email

Buka: https://supabase.com/dashboard/project/vbzmtnpmtgrhovmwjqqk/auth/templates

Ada beberapa tab. Isi **tiga** ini. Untuk masing-masing: pilih tabnya, isi
**Subject heading**, lalu ganti seluruh isi **Message body** dengan isi berkas
yang disebut (buka berkasnya, Ctrl+A, Ctrl+C, tempel menimpa), lalu **Save**.

| Tab Dashboard | Subject heading | Isi dari berkas |
|---|---|---|
| **Confirm signup** | `Kode verifikasi SmartBook AI` | `supabase/email-templates/confirm-signup.html` |
| **Reset Password** | `Kode reset password SmartBook AI` | `supabase/email-templates/reset-password.html` |
| **Magic Link** | `Kode masuk SmartBook AI` | `supabase/email-templates/magic-link.html` |

### Kenapa ini wajib, bukan opsional

Aplikasi memakai **kode OTP**, bukan tautan — `verifyOtp({ email, token, type:
'signup' })` dan `type: 'recovery'`. Template bawaan Supabase hanya berisi
tombol `{{ .ConfirmationURL }}` dan **tidak memuat `{{ .Token }}` sama sekali**.

Akibatnya kalau langkah ini dilewati: email tetap terkirim, tampak normal, tapi
**tidak ada kode di dalamnya** — sementara aplikasi meminta Anda mengetik kode.
Pendaftaran mentok di layar verifikasi tanpa penyebab yang kelihatan.

Pastikan `{{ .Token }}` ada di badan setiap template setelah ditempel.

---

## Langkah 3 — SMTP (disarankan, bukan wajib)

Buka: https://supabase.com/dashboard/project/vbzmtnpmtgrhovmwjqqk/settings/auth

Cari **SMTP Settings** → aktifkan **Enable Custom SMTP**.

Tanpa SMTP sendiri, Supabase memakai email bawaan yang dibatasi
**±2–3 email per jam** dan sering masuk folder spam. Untuk mendaftar satu akun
admin itu cukup; untuk pengguna sungguhan tidak.

Kalau dulu Anda memakai Resend, pasang lagi dengan nilai yang sama:

```
Host      : smtp.resend.com
Port      : 465
Username  : resend
Password  : (API key Resend Anda)
Sender    : email pengirim yang domainnya sudah diverifikasi di Resend
```

---

## Langkah 4 — Uji

1. Buka https://smartbookai.id/daftar
2. Daftar dengan email Anda
3. Cek inbox — **harus ada kode 6 digit**, bukan tombol
4. Masukkan kodenya di aplikasi

Kalau email tidak datang dalam 2 menit: cek folder spam. Kalau tetap tidak ada,
lihat log di
https://supabase.com/dashboard/project/vbzmtnpmtgrhovmwjqqk/logs/auth-logs

Setelah akun jadi, jadikan admin lewat
[SQL Editor](https://supabase.com/dashboard/project/vbzmtnpmtgrhovmwjqqk/sql/new):

```sql
insert into public.admins (user_id, email)
select id, email from auth.users where email = 'EMAIL-ANDA@contoh.com'
on conflict do nothing;

select * from public.admins;
```

---

## Catatan: kenapa ini hilang

Template email dan setelan SMTP hidup **hanya di Dashboard** — tidak pernah
ter-versi di repo. Ketika proyek terhapus, seluruh tabel bisa dibangun ulang
dari 47 berkas migrasi, tapi bagian ini tidak ada satu pun berkas yang
mendefinisikannya. Pola yang sama dengan bucket `product-images`.

Berkas HTML-nya sendiri memang ada di `supabase/email-templates/` — itulah
sebabnya langkah ini cuma tempel-tempel, bukan menulis ulang dari nol.
