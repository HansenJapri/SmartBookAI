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

### Jam ke-0 — Deteksi & Penahanan (containment)
- [ ] Catat waktu insiden diketahui (mulai hitung mundur 3 x 24 jam).
- [ ] **Rotasi seluruh kunci & rahasia**: `GEMINI_API_KEY`, Service Role Key
      Supabase, kredensial SMTP (Resend). Buat baru, cabut yang lama.
- [ ] **Cabut sesi aktif** di Supabase Auth (force sign-out) bila akun
      terkompromi: Dashboard Supabase > Authentication > Users.
- [ ] Nonaktifkan akun admin yang dicurigai; ganti kata sandinya.
- [ ] Bila kebocoran lewat celah kode, matikan fitur terkait (mis. Edge Function)
      sampai diperbaiki.

### Jam ke-1 sampai 24 — Investigasi
- [ ] Tentukan ruang lingkup: tabel/akun mana yang terpapar.
- [ ] Periksa log Supabase (Auth logs, Postgres logs, Edge Function logs).
- [ ] Identifikasi data pribadi apa yang terungkap dan berapa pengguna terdampak.
- [ ] Simpan bukti (log, tangkapan layar) untuk pelaporan.

### Sebelum 3 x 24 jam — Pemberitahuan
- [ ] Kirim pemberitahuan ke pengguna terdampak (template di Bagian 4).
- [ ] Laporkan ke lembaga berwenang sesuai kanal resmi yang berlaku.
- [ ] Dokumentasikan tanggal & isi pelaporan.

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

## 6. Rotasi Kunci Berkala

- Rotasi `GEMINI_API_KEY` minimal tiap 6 bulan, atau segera bila dicurigai bocor.
- Jangan pernah commit `.env` ke git (sudah di-`.gitignore`).
- Service Role Key Supabase hanya dipakai di server tepercaya, tidak di klien.
