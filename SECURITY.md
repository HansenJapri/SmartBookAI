# Keamanan & Rencana Respons Insiden — BukuPintar AI

Dokumen ini WAJIB disiapkan sebelum insiden terjadi, bukan sesudahnya.
Acuan hukum: UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP),
UU ITE, dan PP No. 71 Tahun 2019.

Terakhir ditinjau: 4 Juni 2026.

---

## 1. Penanggung Jawab

| Peran | Nama | Kontak |
|---|---|---|
| Pengendali Data / PIC keamanan | (isi: nama/badan usaha resmi) | (isi: email domain usaha) |
| Cadangan (backup PIC) | (isi) | (isi) |

PIC bertanggung jawab mengambil keputusan saat insiden dan berkomunikasi dengan
otoritas serta pengguna.

---

## 2. Kewajiban Hukum Saat Terjadi Kebocoran Data Pribadi

UU PDP (Pasal 46) mewajibkan pemberitahuan **paling lambat 3 x 24 jam** sejak
diketahui, kepada:

1. **Subjek data pribadi** (pengguna yang terdampak), dan
2. **Lembaga yang berwenang** di bidang pelindungan data pribadi.

Pemberitahuan memuat: (a) data pribadi yang terungkap, (b) kapan dan bagaimana
terjadi, dan (c) upaya penanganan dan pemulihan.

Sanksi kelalaian dapat mencapai **2% dari pendapatan tahunan** serta sanksi lain
sesuai peraturan.

---

## 3. Alur Respons Insiden (Runbook)

> **Perkakasnya ada di Dashboard Admin > tab "Insiden & PDP".** Runbook di bawah
> mengacu ke sana di tiga langkah yang paling menentukan: mencatat jam nol,
> menyusun daftar korban, dan mencatat bukti pelaporan. Jangan mengerjakan
> ketiganya di spreadsheet terpisah — spanduk hitung mundur di dashboard hanya
> membaca register itu, dan insiden yang tidak tercatat di sana tidak akan
> mengingatkan siapa pun.

### Jam ke-0 — Deteksi & Penahanan (containment)
- [ ] **Catat insiden di tab "Insiden & PDP"**, isi *Diketahui pada* dengan waktu
      tim benar-benar pertama tahu — bukan waktu form diisi. Nilai ini memulai
      hitung mundur dan **tidak bisa diubah** setelah disimpan.
      Catat lebih awal walau masih dugaan; status "bukan insiden" tersedia untuk
      menutup dugaan yang ternyata keliru, dan itu jauh lebih murah daripada
      kehilangan jam-jam pertama dari 72.
- [ ] **Rotasi seluruh kunci & rahasia**: `GEMINI_API_KEY`, Service Role Key
      Supabase, kredensial SMTP (Resend). Buat baru, cabut yang lama.
- [ ] **Cabut sesi aktif** di Supabase Auth (force sign-out) bila akun
      terkompromi: Dashboard Supabase > Authentication > Users.
- [ ] Nonaktifkan akun admin yang dicurigai; ganti kata sandinya.
- [ ] Bila kebocoran lewat celah kode, matikan fitur terkait (mis. Edge Function)
      sampai diperbaiki.

### Jam ke-1 sampai 24 — Investigasi
- [ ] Tentukan ruang lingkup: tabel/akun mana yang terpapar.
- [ ] Isi *Kejadian mulai/sampai* pada insiden. Ini yang menyaring daftar korban.
      Kosongkan bila belum diketahui — jendela kosong diperlakukan **terbuka**,
      jadi daftarnya terlalu luas, bukan kosong. Daftar terlalu luas bisa
      dipersempit nanti; daftar kosong yang tampak meyakinkan tidak bisa.
- [ ] Buka **"Daftar korban"** pada insiden, lalu **Unduh CSV**. Berisi email dan
      telepon subjek data yang jejaknya jatuh di jendela itu. Perlakukan berkas
      unduhannya sebagaimana data pribadi.
- [ ] Periksa juga daftar **akun yang sudah dihapus** pada insiden yang sama.
      Datanya masih hidup di sistem saat jendela berjalan, jadi ia tetap masuk
      laporan ke otoritas meski subjeknya tidak bisa lagi dihubungi dari sini.
- [ ] Untuk satu akun tertentu, pakai tombol **🕵️ Jejak** di tab Pengguna:
      pemakaian aplikasi, perubahan data, pemakaian AI, dan perubahan kebijakan
      admin — digabung dan terurut waktu.
- [ ] Periksa log Supabase (Auth logs, Postgres logs, Edge Function logs).
- [ ] Centang *data pribadi apa yang terungkap* pada insiden. Ini butir wajib
      pertama dalam surat pemberitahuan.
- [ ] Simpan bukti (log, tangkapan layar) untuk pelaporan.

### Sebelum 3 x 24 jam — Pemberitahuan
- [ ] Kirim pemberitahuan ke pengguna terdampak (template di Bagian 4).
- [ ] Laporkan ke lembaga berwenang sesuai kanal resmi yang berlaku.
- [ ] Isi *Dilaporkan ke otoritas pada*, *nomor tanda terima*, dan *Pemberitahuan
      ke subjek data dikirim pada* di tab Insiden, lalu ubah status menjadi
      **"Sudah dilaporkan"**. Sistem menolak status itu tanpa tanggal pelaporan:
      tanggal inilah yang ditanyakan saat audit, dan status tanpa tanggal hanya
      tampak patuh tanpa bisa membuktikan apa pun.
- [ ] Ingat Pasal 46 mewajibkan **dua** pemberitahuan — ke lembaga *dan* ke setiap
      subjek data. Memenuhi salah satunya saja belum memenuhi kewajiban.

### Setelah insiden — Pemulihan
- [ ] Perbaiki akar masalah (patch kode, perketat RLS, perbaiki konfigurasi).
- [ ] Tinjau ulang dokumen ini dan perbarui kontrol.
- [ ] Catat pelajaran (post-mortem singkat).

---

## 4. Template Pemberitahuan ke Pengguna

> Subjek: Pemberitahuan Penting Mengenai Keamanan Data Akun Anda di BukuPintar AI
>
> Yth. Pengguna BukuPintar AI,
>
> Kami menemukan insiden keamanan pada (tanggal) yang dapat memengaruhi data
> berikut: (sebutkan jenis data, mis. alamat email dan ringkasan transaksi).
>
> Yang sudah kami lakukan: (mis. rotasi kunci akses, penutupan celah, pencabutan
> sesi). Yang kami sarankan Anda lakukan: ganti kata sandi, dan waspadai
> komunikasi mencurigakan yang mengatasnamakan kami.
>
> Kami memohon maaf dan berkomitmen menjaga data Anda. Pertanyaan dapat
> disampaikan ke (email kontak resmi).
>
> Hormat kami, Pengelola BukuPintar AI

---

## 5. Kontrol Keamanan yang Berlaku (ringkas)

- **Isolasi data antarpengguna**: Row Level Security (RLS) "own + admin" pada
  seluruh tabel data pengguna.
- **Rahasia tidak pernah dikirim ke browser**: kunci Gemini hanya hidup di Edge
  Function (tanpa prefix `VITE_`), tidak masuk bundel frontend.
- **Akun admin tunggal**: seluruh fungsi admin dijaga oleh `is_admin()`.
- **Akses berkas struk**: melalui tautan sementara (signed URL) berdurasi pendek.

### Yang perlu diaktifkan/dijaga di Dashboard Supabase (operasional)
- **MFA/2FA untuk akun admin** (lihat H4 di Master List): Authentication >
  Providers/MFA. Wajib untuk akun admin karena dapat membaca data semua pengguna.
- **Rate limit & proteksi bot** pada Auth (lihat M5): Authentication > Rate Limits;
  aktifkan CAPTCHA (hCaptcha/Turnstile) pada signup & login bila tersedia.
- **Region data** (lihat M4): catat region project (mis. Singapore `ap-southeast-1`).
  Jika di luar Indonesia, transfer lintas negara WAJIB diungkap di Kebijakan
  Privasi (sudah dimuat pada Bagian 6 dokumen privasi).
- **Log akses admin**: tabel `admin_audit_log` mencatat tindakan admin
  (lihat migration_audit.sql).

---

## 5b. Catatan Aktivitas yang Menopang Pelaporan 72 Jam

Kewajiban "korban teridentifikasi cepat" bersandar pada empat jejak. Ketiganya
yang pertama ditulis otomatis; yang keempat ditulis tiap kali admin mengubah
kebijakan.

| Tabel | Isi | Bisa diubah/dihapus dari aplikasi? |
|---|---|---|
| `app_events` | Pemakaian aplikasi per pengguna | Tidak (tanpa policy update/delete) |
| `audit_logs` | Setiap INSERT/UPDATE/DELETE data, plus penanda manual/AI | Tidak |
| `ai_activity_log` | Pemakaian fitur AI — tanpa isi pertanyaan, disengaja | Tidak |
| `admin_quota_actions` | Perubahan kuota/paket/suspend oleh admin, nilai sebelum & sesudah | Tidak |
| `admin_audit_log` | Tindakan admin lain | Tidak |
| `deleted_accounts` | "Nisan" akun yang dihapus: sidik email, alasan, rincian data yang ikut lenyap | Tidak |

Dua hal yang perlu diketahui saat menyusun laporan:

- **`deleted_accounts` sengaja pseudonim.** Yang disimpan sidik SHA-256 email,
  bukan emailnya; nama pemilik dan nomor telepon tidak disimpan sama sekali. Hak
  penghapusan (Pasal 8) dan kewajiban jejak audit saling menarik ke arah
  berlawanan, dan ini titik tengahnya: cukup untuk membuktikan sebuah alamat
  pernah terdaftar bila kelak muncul dump data, tidak cukup untuk menghubungi
  atau memasarkan.

- **Penanda `via = 'ai'` pada `audit_logs` bersifat informasional.** Ia dibaca
  dari header permintaan dan klien yang dimodifikasi bisa memalsukannya. Jangan
  memakainya sebagai bukti anti-sangkal dalam laporan.

---

## 6. Rotasi Kunci Berkala

- Rotasi `GEMINI_API_KEY` minimal tiap 6 bulan, atau segera bila dicurigai bocor.
- Jangan pernah commit `.env` ke git (sudah di-`.gitignore`).
- Service Role Key Supabase hanya dipakai di server tepercaya, tidak di klien.
