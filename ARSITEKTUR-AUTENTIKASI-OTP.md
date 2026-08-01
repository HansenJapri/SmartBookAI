# Arsitektur Autentikasi OTP — Analisis & Batasan

Dokumen ini menjelaskan alur login dua langkah, kenapa dirancang begitu, dan —
yang paling penting — **titik rapuh yang berada di luar kendali kode**. Ditulis
setelah dua hari terhenti karena kode OTP tidak pernah sampai ke inbox.

---

## 1. Alur

```
Browser                Edge Function            Supabase GoTrue        SMTP        Inbox
   |  email+password  ->  auth-login-otp
   |                        |-- signInWithPassword (server) --> ✓ lalu signOut()
   |                        |-- signInWithOtp() ------------->  |-- kirim email --> ✉
   |  <-- {sent:true} ------|
   |
   |  kode 8 digit --------------------------> verifyOtp() --> SESI TERBIT
```

**Sesi tidak pernah terbit di langkah pertama.** Password diverifikasi di server,
sesinya langsung dimatikan dan tidak dikirim ke browser. Alur yang memanggil
`signInWithPassword` di browser lalu menampilkan layar OTP adalah keamanan semu:
JWT sudah aktif sebelum kode diisi, jadi penyerang tinggal menutup layarnya.

---

## 2. Cacat arsitektur yang terbukti mahal

Ketersediaan login bergantung pada **tiga potong konfigurasi dashboard** yang
tidak bisa dibaca, divalidasi, atau diuji oleh aplikasi — padahal salah satu
saja rusak berarti **100% pengguna tidak bisa masuk**:

| Konfigurasi | Cara gagalnya | Terdeteksi dari aplikasi? |
|---|---|---|
| Kredensial SMTP | `500 unexpected_failure` | Hanya sebagai error generik |
| Email OTP Length | Kode 6 digit, UI menuntut 8 → tidak ada yang bisa masuk | Tidak |
| Template Magic Link tanpa `{{ .Token }}` | Email berisi tautan, kode tidak pernah ikut | Tidak |

Ketiganya **gagal diam-diam**. Tidak ada alarm, tidak ada log aplikasi, dan
pesan yang sampai ke pengguna sama sekali tidak menunjuk penyebabnya.

### Yang memperparah: GoTrue menyembunyikan sebab aslinya

Log Supabase memuat penyebab persisnya:

```
535 "5.7.8 Username and Password not accepted ... BadCredentials ... - gsmtp"
```

Tetapi yang diteruskan ke pemanggil API hanyalah:

```
status 500, code "unexpected_failure", message "Error sending magic link email"
```

Deteksi pertama di Edge Function mencari pola `535` / `gsmtp` / `BadCredentials`
— pola yang **tidak pernah sampai ke sana**. Akibatnya kegagalan pengiriman
selalu jatuh ke pesan generik. Pelajarannya: **deteksi harus memakai sinyal yang
benar-benar diterima, bukan sinyal yang terlihat di log.**

---

## 3. Kronologi insiden (dari log auth, bukan dugaan)

| Waktu UTC | WIB | Kejadian |
|---|---|---|
| 06:11 | 13:11 | Email terkirim dari `noreply@mail.app.supabase.io` — mailer bawaan Supabase, **berhasil** |
| 06:38 | 13:38 | `/otp` → 500 pertama. `535 BadCredentials` dari `gsmtp` |
| … | … | 12 panggilan `/otp`, **semuanya 500**, nol berhasil |
| 04:53 (1 Agu) | 11:53 | Masih 500 |

Kesimpulan: pengiriman email berfungsi **sebelum** SMTP kustom Gmail dipasang,
dan tidak pernah sekali pun berhasil **sesudahnya**. Penyebabnya bukan kode,
bukan rate limit, bukan template — melainkan kredensial SMTP.

Rate limit sempat dicurigai dan sudah dinaikkan dari `2/1h` ke `30`. Itu memang
perlu, tapi bukan penyebabnya.

---

## 4. Kenapa Gmail SMTP rapuh untuk jalur ini

Gmail menolak password akun biasa untuk SMTP. Penyebab `535 BadCredentials`,
diurut dari yang paling sering:

1. Memakai password akun Google, bukan **App Password**
2. App Password ditempel **beserta spasinya** — Google menampilkannya sebagai
   `abcd efgh ijkl mnop`, dan yang benar adalah 16 karakter **tanpa spasi**
3. **2-Step Verification belum aktif** — tanpa itu menu App Password tidak ada
4. Username bukan alamat email lengkap
5. Port dan mode enkripsi tidak cocok (`465` = SSL, `587` = STARTTLS)

Di luar itu, Gmail dibatasi ~500 email/hari dan alamat pengirim harus sama
dengan akunnya. Untuk produksi, penyedia transaksional (Resend/Brevo/SendGrid)
jauh lebih tepat — API HTTP mereka tidak punya kelas kegagalan handshake SMTP
sama sekali, dan errornya terbaca langsung.

---

## 5. Perbaikan yang sudah diterapkan

| Perbaikan | Efek |
|---|---|
| Deteksi kegagalan kirim memakai `status 500` / `unexpected_failure` / `"error sending"` | Pesan jujur: "pengiriman email bermasalah", bukan "password salah" |
| Deteksi throttle memakai 4 penanda, termasuk pola `"after N seconds"` | Throttle tidak lagi menyamar sebagai kegagalan kirim |
| Jeda kirim ulang dibaca dari server (`retry_after`) | Hitung mundur di UI persis sesuai server |
| Tombol "Kirim ulang" nonaktif selama jeda | Pengguna tidak bisa menabrak throttle berulang kali |
| Sebab tak dikenal → `errService`, **bukan** `errInvalid` | Gangguan layanan tidak pernah lagi disalahartikan sebagai password salah |

---

## 6. Arah perbaikan berikutnya (belum dikerjakan)

Untuk menghapus dua dari tiga ketergantungan konfigurasi, OTP bisa dibuat
sepenuhnya milik aplikasi:

- Kode 8 digit dibangkitkan sendiri, hash-nya disimpan di tabel dengan
  `expires_at` dan penghitung percobaan
- Dikirim lewat **API HTTP** penyedia email, bukan SMTP
- Sesi diterbitkan lewat `auth.admin.generateLink({type:'magiclink'})` →
  `hashed_token` → `verifyOtp({token_hash})`

Hasilnya: panjang kode dan masa berlaku tidak lagi bergantung setelan dashboard,
template Magic Link tidak dipakai sama sekali, dan satu-satunya ketergantungan
luar yang tersisa (API key) gagal dengan pesan yang terbaca.

**Catatan jujur:** perubahan ini **tidak** menyelesaikan blocker saat ini.
Blocker-nya adalah pengiriman email, dan jalur mana pun tetap butuh pengirim
yang kredensialnya benar. Mendahulukan penulisan ulang subsistem auth sebelum
pengiriman email beres adalah urutan kerja yang salah.

---

## 7. Sisa risiko yang diketahui

Klien secara teknis masih bisa memanggil `supabase.auth.signInWithOtp()` sendiri
dan melewati gerbang password — login cukup dengan akses inbox. Tingkat
keamanannya setara fitur "lupa password" yang sudah ada. Menutupnya berarti
mematikan OTP sisi klien dan mengirim email sendiri (butuh penyedia pihak ketiga).
