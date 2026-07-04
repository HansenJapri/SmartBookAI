# QA & Kriteria Kelulusan — BukuPintar AI

Dokumen ini mendefinisikan **kapan aplikasi dianggap BERHASIL** (lolos / siap launching).
Aplikasi dinyatakan **LULUS** bila memenuhi semua syarat di Bagian 0.

---

## 0. Definisi "Berhasil" (Definition of Done)

Aplikasi dianggap **SIAP LAUNCHING** jika SEMUA kondisi ini terpenuhi:

1. ✅ **100% test case Prioritas P0 (kritis) LULUS.**
2. ✅ **≥ 95% test case P1 (penting) LULUS.**
3. ✅ **Tidak ada bug severity *Blocker* atau *Critical* yang masih terbuka.**
4. ✅ **Memenuhi semua ambang metrik** di Bagian 2.
5. ✅ **Checklist pra-launch** (Bagian 8) selesai 100%.
6. ✅ Build produksi sukses tanpa error & **tanpa error di console browser**.

> Jika salah satu dari #1–#6 gagal → aplikasi **BELUM lulus**.

---

## 1. Skala Prioritas & Severity

**Prioritas test case**
| Kode | Arti |
|---|---|
| P0 | Kritis — fitur inti, kalau gagal aplikasi tidak layak rilis |
| P1 | Penting — memengaruhi pengalaman utama user |
| P2 | Tambahan — polish, tidak menghambat rilis |

**Severity bug**
| Level | Arti |
|---|---|
| Blocker | Aplikasi tidak bisa dipakai / data hilang / data user bocor |
| Critical | Fitur inti rusak, tidak ada workaround |
| Major | Fitur rusak tapi ada workaround |
| Minor | Kosmetik / teks / tata letak kecil |

---

## 2. Ambang Metrik (Acceptance Thresholds)

| Metrik | Target | Cara ukur |
|---|---|---|
| Akurasi auto-kategori (rule-based) | **≥ 85%** | Uji 100 transaksi campuran, hitung yang benar |
| Akurasi parsing import (CSV/Excel) | **≥ 95%** | Uji 200 baris dari ≥3 format file, baris yang ter-parse benar |
| Akurasi deteksi duplikat (rekonsiliasi) | **≥ 95%** | 50 skenario cross-channel, % yang ter-match tanpa salah |
| Konsistensi angka laporan vs transaksi | **100%** | Total di Dashboard/Laporan = jumlah manual transaksi |
| Waktu muat awal (load) halaman | **< 3 detik** | DevTools, jaringan normal |
| Isolasi data antar-user (RLS) | **100% (wajib)** | User A tidak bisa melihat data user B |

---

## 3. Suite A — Autentikasi & Keamanan Akun

| ID | Skenario | Langkah | Hasil diharapkan | Prioritas |
|---|---|---|---|---|
| A-01 | Daftar akun baru | Isi form valid → Daftar | Kode OTP dikirim ke email, pindah ke layar OTP | P0 |
| A-02 | Password lemah ditolak | Isi password `abc` | Tombol/validasi menolak; checklist menunjukkan syarat belum terpenuhi | P0 |
| A-03 | Password kuat diterima | `H@nsen2006handsome` | Semua 5 syarat hijau (8+ char, besar, kecil, angka, simbol) | P0 |
| A-04 | Verifikasi OTP email benar | Masukkan kode dari email (6–8 digit) | Berhasil masuk ke Dashboard | P0 |
| A-05 | OTP salah ditolak | Masukkan kode acak | Muncul pesan "Kode salah atau kedaluwarsa", tidak masuk | P0 |
| A-06 | OTP fleksibel panjang | Kode 8 digit | Input menerima semua digit (tidak terpotong) | P0 |
| A-07 | Email sudah terdaftar | Daftar pakai email yang sudah aktif | Pesan "Email sudah terdaftar. Silakan masuk." | P1 |
| A-08 | Email belum verifikasi → daftar lagi | Daftar ulang email yang belum verif | Kirim ulang kode, lanjut ke OTP (tidak nyangkut) | P1 |
| A-09 | Nomor telepon ganda ditolak | Daftar pakai no. HP yang sudah dipakai | Pesan "Nomor telepon sudah terdaftar di akun lain" | P1 |
| A-10 | Login benar | Email + password benar | Masuk ke Dashboard | P0 |
| A-11 | Login salah | Password salah | Pesan "Email atau kata sandi salah" | P0 |
| A-12 | Lupa password | /lupa-password → email → kode → password baru | Password berubah, bisa login dengan password baru | P0 |
| A-13 | Logout | Klik "Keluar" | Sesi berakhir, diarahkan ke halaman masuk | P0 |
| A-14 | Proteksi halaman | Buka /app tanpa login | Diarahkan ke /masuk | P0 |
| A-15 | Sesi bertahan | Login → refresh halaman | Tetap login (tidak logout sendiri) | P1 |
| A-16 | Format telepon | `08xxx`, `+62xxx`, `62xxx` | Semua dinormalkan jadi `+62xxx` | P1 |

---

## 4. Suite B — Transaksi

| ID | Skenario | Hasil diharapkan | Prioritas |
|---|---|---|---|
| B-01 | Tambah transaksi pemasukan | Tersimpan & muncul di daftar + Dashboard | P0 |
| B-02 | Tambah transaksi pengeluaran | Tersimpan dengan tanda minus/merah | P0 |
| B-03 | Validasi nominal | Nominal 0 / kosong ditolak | P0 |
| B-04 | Validasi deskripsi kosong | Ditolak dengan pesan | P1 |
| B-05 | Auto-saran kategori | Ketik "Token PLN" → kategori "Operasional Listrik" | P1 |
| B-06 | Edit transaksi | Ubah nominal/kategori → tersimpan | P0 |
| B-07 | Hapus transaksi | Konfirmasi → hilang dari daftar & total terupdate | P0 |
| B-08 | Cari transaksi | Ketik kata kunci → daftar terfilter | P1 |
| B-09 | Filter Masuk/Keluar | Filter bekerja benar | P1 |
| B-10 | Data persist | Refresh / login ulang → transaksi masih ada | P0 |

---

## 5. Suite C — Import Data (CSV & Excel)

| ID | Skenario | Hasil diharapkan | Prioritas |
|---|---|---|---|
| C-01 | Import CSV mutasi bank (debit/kredit) | Arah & nominal benar, ter-kategori | P0 |
| C-02 | Import Excel (.xlsx) | File terbaca, transaksi muncul di preview | P0 |
| C-03 | File dengan baris judul di atas tabel | Baris judul dilewati, header benar terdeteksi | P0 |
| C-04 | Import marketplace (Total Pembayaran) | Kategori default "Penjualan Marketplace" | P1 |
| C-05 | Format Rupiah beragam | `Rp 1.250.000`, `(50.000)`, `1,250,000` terbaca benar | P0 |
| C-06 | Preview sebelum simpan | Bisa centang/uncentang & ubah kategori per baris | P1 |
| C-07 | Hanya yang dicentang tersimpan | Baris tak dicentang tidak masuk DB | P1 |
| C-08 | File rusak/format aneh | Pesan error ramah, tidak crash | P0 |
| C-09 | File kosong | Pesan "file kosong/tidak terbaca" | P1 |
| C-10 | Unduh contoh CSV | File contoh ter-download | P2 |
| C-11 | Tanggal dd/mm/yyyy | Tanggal ter-parse benar (tidak ketukar bulan/hari) | P1 |

---

## 6. Suite D–G — Fitur Lain

**D. Rekonsiliasi**
| ID | Skenario | Hasil diharapkan | Prioritas |
|---|---|---|---|
| D-01 | Deteksi duplikat lintas-channel | 2 transaksi nominal+waktu dekat → terdeteksi 1 grup | P0 |
| D-02 | Gabung duplikat | "Pertahankan ini" → sisanya terhapus | P1 |
| D-03 | Abaikan (bukan duplikat) | Grup hilang dari daftar dugaan | P1 |
| D-04 | Ubah toleransi waktu | 1 jam / 1 hari / 3 hari → hasil berubah sesuai | P2 |

**E. Dashboard**
| ID | Skenario | Hasil diharapkan | Prioritas |
|---|---|---|---|
| E-01 | KPI akurat | Omzet/profit = hitungan manual transaksi | P0 |
| E-02 | Grafik tren | Tampil 14 hari, nilai sesuai | P1 |
| E-03 | Pie sumber pemasukan | Proporsi per channel benar | P1 |
| E-04 | Empty state | Tanpa data → ajakan tambah/import (bukan error) | P1 |

**F. Laporan**
| ID | Skenario | Hasil diharapkan | Prioritas |
|---|---|---|---|
| F-01 | Generate PDF Laporan KUR | PDF terunduh, isi laba-rugi + arus kas | P0 |
| F-02 | Generate PDF Rekap Pajak | PDF terunduh, PPh Final 0,5% benar | P0 |
| F-03 | Filter periode | Pilih bulan → angka & PDF sesuai periode | P1 |
| F-04 | PPh = 0,5% × omzet | Hitungan benar | P0 |
| F-05 | Edukasi KUR & Pajak | Accordion bisa dibuka, isi tampil | P2 |

**G. Pengaturan**
| ID | Skenario | Hasil diharapkan | Prioritas |
|---|---|---|---|
| G-01 | Simpan profil usaha | Tersimpan, muncul di kop laporan PDF | P1 |
| G-02 | Tambah aturan kategori | Kata kunci baru → transaksi terkait ter-kategori | P1 |
| G-03 | Hapus aturan | Aturan terhapus | P2 |

---

## 7. Suite H — Keamanan & Isolasi Data (WAJIB)

| ID | Skenario | Hasil diharapkan | Prioritas |
|---|---|---|---|
| H-01 | **Isolasi data antar-user** | Login user B → TIDAK bisa melihat transaksi user A | **P0 (Blocker bila gagal)** |
| H-02 | RLS aktif | Query API tanpa login tidak mengembalikan data orang lain | P0 |
| H-03 | Anon key aman | Tidak ada service_role key / secret di frontend | P0 |
| H-04 | Password tidak tersimpan plaintext | Dikelola Supabase Auth (hashed) | P0 |
| H-05 | Halaman /app butuh sesi valid | Tanpa token → ditolak | P0 |

> **Cara uji H-01:** buat 2 akun, isi transaksi di masing-masing, pastikan tidak saling terlihat.

---

## 8. Checklist Pra-Launch (Konfigurasi)

- [ ] `schema.sql` dijalankan di Supabase
- [ ] `migration_auth.sql` dijalankan (telepon unik + RPC)
- [ ] SMTP Resend terpasang (email OTP & reset terkirim, tidak kena rate limit)
- [ ] Template "Confirm signup" & "Reset Password" memuat `{{ .Token }}` sebagai teks
- [ ] `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` terisi (lokal & hosting)
- [ ] (Setelah deploy) Site URL & Redirect URLs di Supabase = domain Vercel
- [ ] Build produksi sukses (`npm run build`) tanpa error
- [ ] Tidak ada error di console browser pada semua halaman

---

## 9. Kompatibilitas & Performa

| ID | Skenario | Hasil diharapkan | Prioritas |
|---|---|---|---|
| K-01 | Chrome/Edge desktop | Semua fitur jalan | P0 |
| K-02 | Firefox desktop | Semua fitur jalan | P1 |
| K-03 | Tampilan mobile (HP) | Layout responsif, sidebar bisa dibuka | P1 |
| K-04 | Refresh di rute dalam (mis. /app/laporan) | Tidak 404 (SPA rewrite) | P0 |
| K-05 | Load awal < 3 detik | Lulus di jaringan normal | P1 |
| K-06 | 1000+ transaksi | Dashboard & daftar tetap responsif | P2 |

---

## 10. Regresi Otomatis (sudah lulus saat pengembangan)

Logika inti diuji otomatis (lewat Vite): **22/22 LULUS**, mencakup:
- Parsing angka Rupiah (titik/koma/kurung/desimal)
- Auto-kategori (rule bawaan + aturan user prioritas)
- Validasi password & normalisasi telepon
- Deteksi kolom CSV/Excel + lewati baris judul
- Deteksi duplikat & ringkasan total

Jalankan ulang regresi ini setiap ada perubahan logika sebelum rilis.

---

## 11. Form Sign-off

| Peran | Nama | Tanggal | Status (Lulus/Tidak) | Catatan |
|---|---|---|---|---|
| Penguji | | | | |
| Pemilik produk | | | | |

**Keputusan akhir rilis:** ⬜ LULUS — siap launching  ⬜ TIDAK — perlu perbaikan

> Lampirkan rekap: jumlah P0 lulus/total, P1 lulus/total, daftar bug terbuka beserta severity.
