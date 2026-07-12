# BukuPintar AI — Dokumentasi Fitur Lengkap

> Versi dokumen: Juli 2026  
> Stack: React 18 + Vite + Supabase + Edge Functions  
> Target pengguna: UMKM Indonesia (owner & staf)

---

## Daftar Isi

1. [Arsitektur & Struktur Aplikasi](#1-arsitektur--struktur-aplikasi)
2. [Autentikasi & Keamanan Akun](#2-autentikasi--keamanan-akun)
3. [Dashboard](#3-dashboard)
4. [Transaksi](#4-transaksi)
5. [Import Data (CSV / Excel)](#5-import-data-csv--excel)
6. [Scan Struk (AI Vision)](#6-scan-struk-ai-vision)
7. [Rekonsiliasi Duplikat](#7-rekonsiliasi-duplikat)
8. [Piutang & Utang](#8-piutang--utang)
9. [Stok Produk & Inventaris](#9-stok-produk--inventaris)
10. [Purchase Order (PO)](#10-purchase-order-po)
11. [Stock Opname](#11-stock-opname)
12. [HPP — Harga Pokok Produksi](#12-hpp--harga-pokok-produksi)
13. [Pemasok (Supplier)](#13-pemasok-supplier)
14. [Data Karyawan](#14-data-karyawan)
15. [Absensi & Cuti](#15-absensi--cuti)
16. [Penggajian (Payroll)](#16-penggajian-payroll)
17. [Papan Tugas Harian (Operasional)](#17-papan-tugas-harian-operasional)
18. [Radar Harga Makro](#18-radar-harga-makro)
19. [Reveal — Deteksi Kebocoran Pendapatan](#19-reveal--deteksi-kebocoran-pendapatan)
20. [Laporan Keuangan](#20-laporan-keuangan)
21. [Chatbot AI Asisten](#21-chatbot-ai-asisten)
22. [Pengguna & Hak Akses (RBAC)](#22-pengguna--hak-akses-rbac)
23. [Audit Log](#23-audit-log)
24. [Pengaturan](#24-pengaturan)
25. [Feedback](#25-feedback)
26. [Rencana Testing](#26-rencana-testing)

---

## 1. Arsitektur & Struktur Aplikasi

### Deskripsi
BukuPintar AI adalah aplikasi pencatatan keuangan dan operasional UMKM berbasis web (SPA). Data disimpan di Supabase (PostgreSQL + Auth + Storage) dengan isolasi data per-user via Row Level Security (RLS). Fitur AI dikirim ke Supabase Edge Functions (Deno).

### Struktur Halaman (Routing)

| Path | Halaman |
|---|---|
| `/` | Landing page (publik) |
| `/masuk` | Login |
| `/daftar` | Registrasi |
| `/lupa-password` | Reset password |
| `/setup` | Konfigurasi awal (URL + key Supabase) |
| `/ketentuan` | Syarat & Ketentuan |
| `/privasi` | Kebijakan Privasi |
| `/app` | Dashboard (protected) |
| `/app/tugas` | Papan tugas operasional |
| `/app/transaksi` | Daftar transaksi |
| `/app/import` | Import CSV/Excel |
| `/app/struk` | Scan struk AI |
| `/app/rekonsiliasi` | Deteksi duplikat |
| `/app/piutang` | Piutang & utang |
| `/app/stok` | Stok produk |
| `/app/po` | Purchase Order |
| `/app/opname` | Stock Opname |
| `/app/hpp` | Harga Pokok Produksi |
| `/app/supplier` | Data pemasok |
| `/app/karyawan` | Data karyawan |
| `/app/absensi` | Absensi & cuti |
| `/app/gaji` | Penggajian |
| `/app/radar` | Radar harga makro |
| `/app/reveal` | Deteksi kebocoran |
| `/app/laporan` | Laporan keuangan |
| `/app/feedback` | Umpan balik |
| `/app/pengguna` | Manajemen tim & RBAC |
| `/app/audit` | Audit log (owner) |
| `/app/pengaturan` | Pengaturan akun & usaha |

### Teknis Penting
- **Code splitting** dengan `React.lazy` + `Suspense` — setiap halaman dimuat saat dibutuhkan saja (load awal lebih cepat).
- **Guard route**: `Protected` (perlu login + MFA), `GuestOnly` (hanya tamu), `ConfigOnly` (perlu setup).
- **Tema & bahasa**: toggle Dark/Light mode dan bilingual ID/EN via `LangContext`.
- **AppLock**: PIN opsional — layar terkunci otomatis saat tidak aktif, dibuka kembali dengan PIN.

---

## 2. Autentikasi & Keamanan Akun

### Fitur yang Ada

**Registrasi**
- Form: nama, email, nomor telepon, password.
- Validasi password 5-syarat (≥8 karakter, huruf besar, huruf kecil, angka, simbol) — ditampilkan dengan `PasswordChecklist` real-time.
- Nomor telepon dinormalisasi otomatis (`08xxx` → `+62xxx`).
- Setelah daftar → kode OTP dikirim ke email, pengguna verifikasi di layar `OtpInput`.

**Login**
- Email + password → sesi Supabase.
- Jika 2FA aktif → setelah login diarahkan ke `MfaChallenge` (verifikasi TOTP).

**Lupa Password**
- Kirim kode reset ke email → isi kode di form → buat password baru.

**Two-Factor Authentication (2FA / MFA)**
- Berbasis TOTP (Google Authenticator, Authy, dll.).
- Dikelola di halaman Pengaturan via komponen `TwoFactor`.
- Saat login, challenge MFA ditampilkan sebelum masuk ke aplikasi.

**PIN Kunci Aplikasi (AppLock)**
- Atur PIN 6-digit di Pengaturan.
- Layar kunci muncul otomatis setelah tidak aktif.
- Tujuan: mencegah orang lain mengakses saat HP/PC tidak dijaga.

**Keamanan Data**
- Password dikelola Supabase Auth (bcrypt, tidak tersimpan plaintext).
- Semua data dilindungi RLS — user A tidak bisa melihat data user B.
- Tidak ada `service_role` key di frontend.

### Cara Penggunaan
1. Buka `/daftar` → isi form → cek email untuk OTP → masuk.
2. Untuk login berikutnya: `/masuk` → email + password.
3. Aktifkan 2FA di Pengaturan → scan QR di aplikasi authenticator.
4. Atur PIN di Pengaturan → Keamanan → Atur PIN.

---

## 3. Dashboard

### Fungsi & Tujuan
Ringkasan kondisi keuangan usaha secara sekilas. Semua angka dihitung real-time dari data transaksi yang ada.

### Yang Ditampilkan

**KPI Kartu (4 kotak utama)**
- Total Omzet (pemasukan)
- Total Pengeluaran
- Laba Bersih (omzet − pengeluaran)
- Margin Laba (%)

**Filter Periode**
- Preset: Hari ini, Minggu ini, Bulan ini, Kuartal, Semester, Tahun, Semua, Custom (rentang bebas).

**Grafik Tren Harian (14 hari)**
- Area chart: omzet, pengeluaran, profit per hari.

**Pie Chart Sumber Pemasukan**
- Distribusi per channel (QRIS, Bank, Marketplace, WhatsApp, Manual, dll.).

**Bar Chart Pengeluaran per Kategori**
- 6 kategori terbesar.

**Target Omzet**
- Owner bisa set target omzet bulanan.
- Progress bar + proyeksi apakah target tercapai (via regresi linier `forecastTarget`).

**Peringatan Stok Menipis**
- Daftar produk yang stoknya ≤ `min_stock`.
- Tombol langsung ke Purchase Order untuk produk tersebut.

**Peringatan Duplikat Transaksi**
- Jumlah grup duplikat yang belum diselesaikan → link ke halaman Rekonsiliasi.

**Piutang Belum Lunas**
- Total tagihan ke pelanggan yang belum dibayar.

**Insight AI Harian**
- Narasi otomatis (1 paragraf) dari Edge Function `ai-narasi`.
- Di-cache per hari — tidak memboroskan kuota AI.
- Tombol refresh manual untuk memaksa pembaruan.

**Mode Demo**
- Tampilkan data contoh ketika belum ada transaksi — memudahkan orientasi pengguna baru.

### Cara Penggunaan
- Buka `/app` → semua data tampil otomatis.
- Ganti preset periode untuk melihat rentang berbeda.
- Klik "Refresh Insight" untuk insight terbaru dari AI.
- Klik nama produk stok menipis untuk langsung buat PO.

---

## 4. Transaksi

### Fungsi & Tujuan
Pencatatan semua arus kas masuk dan keluar secara manual. Ini adalah inti aplikasi — semua laporan, dashboard, dan analisis bersumber dari data di sini.

### Yang Bisa Dilakukan

**Tambah Transaksi**
- Field: deskripsi, nominal, arah (masuk/keluar), kategori, channel, tanggal, status pembayaran (lunas/belum), nama pelanggan, tanggal jatuh tempo, keterangan, lampiran struk.
- Auto-saran kategori: saat ketik deskripsi, kategori disarankan otomatis berdasarkan aturan keyword (mis. "Token PLN" → "Operasional Listrik").
- Bisa tambah **baris produk** — stok otomatis berkurang (jual) atau bertambah (beli) saat transaksi disimpan.

**Edit & Hapus**
- Edit: klik ikon pensil → modal terbuka dengan data lama → ubah → simpan.
- Hapus: konfirmasi dialog → transaksi dihapus.

**Filter & Cari**
- Filter: Semua / Masuk / Keluar / Status bayar (lunas/belum).
- Pencarian teks bebas pada deskripsi dan kategori.

**Cetak Invoice**
- Dari daftar transaksi → klik ikon invoice → `InvoiceModal` tampil → cetak/download PDF.

**Lampiran Struk**
- Foto atau PDF struk bisa dilampirkan saat input transaksi.
- Klik ikon klip pada daftar untuk membuka file struk di tab baru.

### Cara Penggunaan
1. Buka `/app/transaksi` → klik **+ Transaksi**.
2. Isi form, pilih arah (Masuk/Keluar), kategori, dan channel.
3. Klik **Simpan** → transaksi muncul di daftar dan Dashboard terupdate.
4. Untuk edit: klik ikon pensil. Untuk hapus: klik ikon tempat sampah.

---

## 5. Import Data (CSV / Excel)

### Fungsi & Tujuan
Impor massal transaksi dari file mutasi bank, QRIS, atau laporan marketplace — tanpa ketik satu per satu.

### Channel yang Didukung

| Channel | Format |
|---|---|
| Mutasi Bank | CSV/Excel dengan kolom debet/kredit |
| QRIS | CSV laporan QRIS |
| Marketplace | Shopee, Tokopedia, TikTok Shop, Lazada, Blibli |

### Alur Import
1. Pilih channel.
2. Upload file (CSV atau XLSX).
3. Parser otomatis membaca header dan baris data:
   - Format Rupiah beragam ditangani (`Rp 1.250.000`, `(50.000)`, `1,250,000`).
   - Baris judul/header ekstra di atas tabel dilewati otomatis.
   - Tanggal `dd/mm/yyyy` dan `yyyy-mm-dd` keduanya didukung.
4. Untuk marketplace: biaya platform (admin, ongkir ditanggung seller, dll.) dipecah otomatis jadi baris terpisah.
5. **Preview pra-simpan**: setiap baris tampil dengan centang — bisa uncentang baris yang tidak ingin disimpan, ubah kategori per baris.
6. Klik **Simpan yang Dicentang** → transaksi masuk ke database.

### Cara Penggunaan
1. Buka `/app/import`.
2. Pilih channel (Bank / QRIS / Marketplace).
3. Seret file atau klik area upload.
4. Tinjau preview → centang/uncentang baris → klik Simpan.

---

## 6. Scan Struk (AI Vision)

### Fungsi & Tujuan
Foto atau PDF struk belanja → AI membaca secara otomatis → data transaksi terisi — tidak perlu ketik manual.

### Cara Kerja
- File dikirim ke Edge Function `BukuPencatatanStruk` (model vision).
- AI mengekstrak: nama merchant, tanggal, total, dan **daftar item** (nama, qty, satuan, harga).
- Hasilnya tampil sebagai form yang bisa diedit sebelum disimpan.
- Metadata keterbacaan (`legibility`): "cetak baik / buram / tulisan tangan" ditampilkan sebagai info.

### Yang Bisa Dilakukan
- Upload via galeri, kamera, atau drag-and-drop.
- Format didukung: JPG, PNG, WEBP, HEIC, PDF (maks 10 MB).
- Setiap item bisa dihubungkan ke produk di stok — stok otomatis terupdate saat disimpan.
- Tombol **Baca AI** → data terisi → koreksi jika perlu → **Simpan Transaksi**.

### Cara Penggunaan
1. Buka `/app/struk`.
2. Upload foto/PDF struk.
3. Klik **Baca dengan AI** → tunggu beberapa detik.
4. Koreksi data jika ada yang salah baca.
5. Klik **Simpan** → transaksi dan stok terupdate.

---

## 7. Rekonsiliasi Duplikat

### Fungsi & Tujuan
Mendeteksi transaksi yang kemungkinan dobel catat — misalnya satu pembayaran masuk dari notifikasi WA sekaligus dari mutasi bank.

### Cara Kerja Deteksi
Dua transaksi dianggap kandidat duplikat bila:
- Arah sama (keduanya masuk atau keduanya keluar).
- Nominal sama (selisih < Rp 1).
- Selisih waktu ≤ toleransi yang dipilih (1 jam / 6 jam / 1 hari / 3 hari).

### Yang Bisa Dilakukan
- Lihat daftar grup duplikat yang terdeteksi.
- **Pertahankan satu** → sisanya dihapus.
- **Abaikan** → grup ditandai bukan duplikat, tidak muncul lagi.
- Ubah toleransi waktu untuk menyesuaikan sensitivitas deteksi.

### Cara Penggunaan
1. Buka `/app/rekonsiliasi`.
2. Pilih toleransi waktu yang sesuai.
3. Tinjau setiap grup → pilih mana yang dipertahankan atau abaikan.

---

## 8. Piutang & Utang

### Fungsi & Tujuan
Melacak tagihan yang belum lunas — baik piutang (uang yang harus diterima dari pelanggan) maupun utang (kewajiban yang belum dibayar ke pemasok/pihak lain).

### Sumber Data
Semua transaksi dengan `payment_status = 'belum'` otomatis muncul di sini. Tidak ada input terpisah — cukup tandai "belum lunas" saat input transaksi.

### Yang Ditampilkan
- **KPI 3 kotak**: total piutang, total utang, dan jumlah yang sudah lewat jatuh tempo.
- **Analisis umur tagihan (Aging)**: dikelompokkan ke bucket — 0–7 hari, 8–30 hari, 31–60 hari, >60 hari.
- Per baris tagihan: nama pelanggan/pemasok, deskripsi, nominal, tanggal, jatuh tempo, umur (hari).

### Aksi per Tagihan
- **Tandai Lunas** → status berubah ke `lunas`, hilang dari daftar piutang/utang.
- **Kirim Pengingat WA** → membuka WhatsApp dengan pesan pengingat yang sudah diisi otomatis (template link `wa.me`).

### Cara Penggunaan
1. Saat input transaksi, set status pembayaran ke **Belum Lunas** dan isi tanggal jatuh tempo.
2. Buka `/app/piutang` → tabel terisi otomatis.
3. Klik **Tandai Lunas** saat pembayaran diterima.
4. Klik **Kirim WA** untuk mengirim pengingat ke pelanggan/pemasok.

---

## 9. Stok Produk & Inventaris

### Fungsi & Tujuan
Master data produk/barang dagangan. Stok terupdate otomatis saat transaksi atau PO dicatat — tidak perlu update manual satu per satu.

### Data per Produk
- Nama, kategori, satuan, harga jual, harga modal, stok saat ini, stok minimum, pemasok terkait.

### Yang Bisa Dilakukan
- **CRUD produk**: tambah, edit, hapus.
- **Kelola satuan**: tambah satuan khusus (selain `pcs`) — mis. "karton", "lusin", "kg".
- **Kelola kategori produk**: buat kategori sesuai jenis usaha.
- **Pencarian**: cari berdasarkan nama atau kategori.
- **Alert stok menipis**: produk yang stok ≤ min_stock ditampilkan dalam banner peringatan merah.
- **Tombol "Buat PO"**: dari baris stok menipis, klik langsung menuju form Purchase Order dengan produk sudah terisi.

### Integrasi Otomatis
- Saat transaksi penjualan dengan baris produk disimpan → stok **berkurang**.
- Saat PO diterima → stok **bertambah**.
- Saat opname diposting → stok **dikoreksi** ke hasil hitung fisik.

### Cara Penggunaan
1. Buka `/app/stok`.
2. Isi form tambah produk (nama, harga, stok awal, min stok) → klik **Simpan**.
3. Stok bergerak otomatis mengikuti transaksi dan PO.
4. Pantau daftar stok menipis di bagian atas atau di Dashboard.

---

## 10. Purchase Order (PO)

### Fungsi & Tujuan
Mencatat pesanan pembelian ke pemasok secara terstruktur, dengan alur status yang jelas dari pemesanan hingga barang diterima.

### Alur Status
```
Draf → Disetujui → Diterima
              ↓
          (Dibatalkan)
```

- **Draf**: PO dibuat, stok belum berubah. Bisa diedit.
- **Disetujui**: PO dikonfirmasi, menunggu pengiriman.
- **Diterima**: Barang masuk → stok bertambah otomatis → opsi mencatat pengeluaran ke cashflow.
- **Dibatalkan**: PO dibatalkan, stok tidak berubah.

### Data per PO
- Nomor PO otomatis (format `PO-YYYYMM-XXX`).
- Produk, pemasok, jumlah, harga satuan, total, tanggal ekspektasi, catatan.

### Cara Penggunaan
1. Buka `/app/po` → klik **+ PO Baru** (atau dari halaman Stok klik "Buat PO").
2. Pilih produk & pemasok, isi jumlah dan harga.
3. Simpan sebagai Draf → Setujui → saat barang datang klik **Terima**.
4. Sistem menambah stok dan menawarkan untuk mencatat biaya pembelian ke transaksi pengeluaran.

---

## 11. Stock Opname

### Fungsi & Tujuan
Penghitungan fisik stok secara berkala — membandingkan stok sistem vs stok nyata di gudang, lalu mengoreksi selisihnya.

### Alur Sesi Opname

```
Mulai Sesi (Draf) → Isi Hitung Fisik → Simpan Draf (bisa jeda) → Posting
                                                                      ↓
                                                        Stok sistem diset = hitung fisik
```

### Yang Bisa Dilakukan
- Hanya satu sesi draf aktif dalam satu waktu.
- Sesi draf bisa disimpan berkali-kali dan dilanjutkan kapan saja.
- Kolom "Selisih" tampil otomatis (sistem − fisik).
- Saat **Posting**: semua produk yang dihitung dikoreksi stoknya, sesi terkunci (tidak bisa diedit lagi).
- Bisa **Batalkan** sesi: stok tidak berubah, hasil hitung dibuang.
- Riwayat semua sesi opname tampil di daftar dengan status.

### Cara Penggunaan
1. Buka `/app/opname` → klik **Mulai Opname Baru**.
2. Isi kolom "Stok Fisik" untuk setiap produk (sesuai hitung di gudang).
3. Klik **Simpan Draf** untuk jeda → lanjutkan kapan saja.
4. Setelah semua terisi → klik **Posting** → stok terkoreksi.

---

## 12. HPP — Harga Pokok Produksi

### Fungsi & Tujuan
Menghitung biaya produksi per unit produk (Bill of Materials / BOM), memperkirakan dampak perubahan harga komoditas terhadap HPP, dan menyimulasikan margin.

### Yang Bisa Dilakukan

**Komposisi Bahan (BOM)**
- Pilih produk → isi daftar bahan (nama, qty per unit, harga per satuan, satuan, tipe: bahan/tenaga/overhead).
- Setiap bahan bisa dikaitkan ke **komoditas** (tepung terigu, minyak goreng, gula, telur, dll.) — agar sinyal harga dari Radar Makro terhubung.

**AI Draft BOM**
- Isi nama produk + jenis usaha → klik **Draf AI** → Edge Function `ai-hpp-draft` menghasilkan estimasi komposisi.
- Hasilnya hanya draf — pengguna wajib memeriksa dan menyesuaikan sebelum disimpan.
- Bahan estimasi AI ditandai dengan ikon khusus.

**Simulasi Dampak Harga**
- Per bahan: isi "% kenaikan" → HPP dan margin terupdate real-time.
- **Simulasi kurs**: jika ada bahan impor, isi persen perubahan nilai tukar → HPP terhitung ulang.
- **Target margin**: isi margin yang diinginkan → sistem menghitung harga jual minimum yang diperlukan.

**Sinyal Radar**
- Jika bahan terhubung ke komoditas yang punya sinyal Radar aktif, muncul notifikasi "harga sedang naik/turun".

### Cara Penggunaan
1. Buka `/app/hpp` → pilih produk.
2. Tambah bahan secara manual atau klik **Draf AI**.
3. Koreksi data bahan → klik **Simpan BOM**.
4. Pantau HPP total dan margin otomatis di panel bawah.
5. Simulasikan dampak kenaikan harga bahan di kolom "%".

---

## 13. Pemasok (Supplier)

### Fungsi & Tujuan
Master data pemasok/vendor sebagai referensi saat membuat produk, PO, dan pencatatan pembelian.

### Data per Pemasok
- Nama, nomor telepon, email, alamat, catatan.

### Yang Bisa Dilakukan
- CRUD pemasok: tambah, edit, hapus.
- Pencarian berdasarkan nama atau nomor telepon.
- Pemasok dipilih saat membuat PO atau menginput produk.

### Cara Penggunaan
1. Buka `/app/supplier` → isi form tambah pemasok → **Simpan**.
2. Pemasok siap dipilih di form PO atau Stok Produk.

---

## 14. Data Karyawan

### Fungsi & Tujuan
Master data SDM — sebagai referensi untuk absensi, penggajian, dan penugasan di papan tugas.

### Data per Karyawan
- Nama, jabatan, nomor telepon, jenis gaji, nominal gaji, tanggal bergabung, catatan.

### Jenis Gaji
- **Bulanan**: nominal tetap per bulan.
- **Harian**: nominal per hari hadir (dihitung otomatis dari data absensi saat penggajian).

### Status Karyawan
- Aktif / Nonaktif — hanya karyawan aktif yang muncul di absensi dan penggajian.

### Cara Penggunaan
1. Buka `/app/karyawan` → isi form → pilih jenis gaji → **Simpan**.
2. Karyawan aktif akan muncul di halaman Absensi dan Penggajian.

---

## 15. Absensi & Cuti

### Fungsi & Tujuan
Pencatatan kehadiran harian seluruh karyawan aktif. Data ini dipakai otomatis oleh modul Penggajian untuk karyawan bergaji harian.

### Status Absensi
- Hadir, Izin, Sakit, Cuti, Alpa.

### Yang Bisa Dilakukan
- Pilih tanggal → klik status per karyawan → tersimpan otomatis (tanpa tombol simpan terpisah).
- **Rekap bulan berjalan** tampil di bawah: jumlah Hadir / Izin / Sakit / Cuti / Alpa per karyawan.
- Rekap ini yang dipakai untuk menghitung gaji harian di modul Penggajian.

### Cara Penggunaan
1. Buka `/app/absensi`.
2. Pilih tanggal (default: hari ini).
3. Klik tombol status untuk setiap karyawan → langsung tersimpan.
4. Pantau rekap bulanan di bagian bawah.

---

## 16. Penggajian (Payroll)

### Fungsi & Tujuan
Mengelola penggajian per periode (bulanan), dari perhitungan otomatis hingga pencatatan pembayaran yang terkoneksi ke cashflow.

### Alur

```
Pilih Periode → Generate Draf → Koreksi Bonus/Potongan → Bayar
                                                            ↓
                                              Transaksi pengeluaran gaji
                                              otomatis dicatat ke cashflow
```

### Perhitungan Otomatis
- **Gaji bulanan**: nominal tetap dari master karyawan.
- **Gaji harian**: `tarif harian × jumlah hari hadir` (diambil dari data absensi periode tersebut).
- Bonus dan potongan bisa diisi manual per karyawan.
- Total = gaji pokok + bonus − potongan.

### Status Penggajian
- Draf (belum dibayar), Dibayar.

### Cara Penggunaan
1. Buka `/app/gaji` → pilih periode (bulan/tahun).
2. Klik **Generate Draf** → baris tiap karyawan aktif dibuat otomatis.
3. Isi bonus/potongan jika ada.
4. Klik **Bayar** per karyawan → pilih kategori pengeluaran → transaksi gaji tercatat.

---

## 17. Papan Tugas Harian (Operasional)

### Fungsi & Tujuan
Papan Kanban sederhana untuk mengelola tugas operasional harian — produksi, layanan, pengiriman, dll.

### Kolom Papan (alur tetap)
```
Antre → Dikerjakan → Selesai
```

### Data per Tugas
- Judul, catatan, prioritas (Tinggi / Normal / Rendah), tanggal jadwal, penanggungjawab (dari daftar karyawan aktif).

### Yang Bisa Dilakukan
- Tambah, edit, hapus tugas.
- Pindah status dengan tombol `←` / `→` (ramah layar sentuh, tidak drag-and-drop agar tidak salah geser).
- Urutkan otomatis: prioritas tinggi duluan, lalu jadwal terdekat.
- Indikator **terlambat** (merah) jika jadwal sudah lewat dan tugas belum selesai.
- Setiap perubahan status otomatis tercatat di Audit Log.

### Cara Penggunaan
1. Buka `/app/tugas`.
2. Klik **+ Tugas Baru** → isi judul, prioritas, jadwal, penanggungjawab.
3. Pindahkan status dengan tombol panah saat tugas dikerjakan / selesai.

---

## 18. Radar Harga Makro

### Fungsi & Tujuan
Memantau harga komoditas bahan baku (tepung, minyak, gula, telur, dll.) dan nilai tukar rupiah — agar pemilik usaha siap menghadapi perubahan biaya produksi.

### Sumber Data
- Harga komoditas dan kurs diambil via pipeline Edge Function `makro-harian` yang berjalan setiap hari pukul 06.00 WIB (pg_cron).
- Data di-cache untuk semua pengguna (bukan per-user) — efisien.

### Yang Ditampilkan
- **Sinyal per komoditas**: arah (↑ Naik / ↓ Turun / = Stabil), persentase perubahan, estimasi dampak biaya, tingkat kepercayaan (rendah/sedang/tinggi).
- **Grafik tren 90 hari** nilai tukar Rupiah.
- **Filter "Bahan Saya"**: tampilkan hanya komoditas yang terhubung ke BOM produk pengguna.
- Tombol **Refresh Manual** sebagai cadangan jika jadwal otomatis terlewat.
- Tanggal data terakhir ditampilkan jelas.

### Cara Penggunaan
1. Buka `/app/radar`.
2. Aktifkan toggle **"Bahan Saya"** untuk fokus ke komoditas yang relevan.
3. Pantau sinyal dan pertimbangkan penyesuaian harga jual atau stok.
4. Gunakan data ini di modul HPP untuk simulasi dampak harga.

---

## 19. Reveal — Deteksi Kebocoran Pendapatan

### Fungsi & Tujuan
Menghitung berapa pendapatan yang "hilang" akibat biaya platform marketplace, biaya payment gateway, dll. — sering tidak disadari pemilik usaha.

### Yang Dihitung
- **Omzet Kotor**: total pemasukan sebelum potongan.
- **Potongan Platform**: biaya admin, komisi, ongkir seller, dll. (dari data import marketplace).
- **Pendapatan Bersih**: omzet kotor − total potongan.
- **Persentase Kebocoran**: berapa % omzet yang hilang.
- **Margin Asli vs Margin yang Dikira**: perbandingan margin setelah biaya tersembunyi.

### Visualisasi
- Bar chart kebocoran per channel/platform.
- Insight teks otomatis yang bisa disalin ke clipboard.

### Cara Penggunaan
1. Buka `/app/reveal`.
2. Pilih periode (bulanan atau semua).
3. Baca insight — bandingkan margin asli vs yang dikira.
4. Gunakan info ini untuk negosiasi biaya platform atau penyesuaian harga jual.

---

## 20. Laporan Keuangan

### Fungsi & Tujuan
Menghasilkan laporan keuangan terformat yang bisa diunduh sebagai PDF — untuk keperluan internal, perbankan (pengajuan KUR), atau pelaporan pajak.

### Jenis Laporan (PDF)

| Laporan | Isi |
|---|---|
| Laporan KUR (Bank) | Laba Rugi + Arus Kas — format siap ke bank |
| Rekap Pajak PPh Final | Perhitungan PPh UMKM 0,5% per bulan, kumulatif per tahun |

### Perhitungan Pajak
Sesuai PP No. 55 Tahun 2022 & UU HPP No. 7 Tahun 2021:
- **Tarif**: 0,5% dari peredaran bruto.
- **WP Orang Pribadi**: omzet s.d. Rp 500 juta/tahun bebas pajak.
- **Batas tarif final**: s.d. Rp 4,8 miliar/tahun.
- Pembebasan Rp 500 juta dihitung kumulatif per tahun (bukan per bulan).

### Yang Juga Ditampilkan
- Ringkasan omzet, pengeluaran, laba per periode.
- Pengeluaran per kategori.
- Rekap bulanan (tren).
- **Edukasi**: accordion KUR (syarat, tips) dan accordion Pajak UMKM — bisa dibuka/tutup.

### Cara Penggunaan
1. Buka `/app/laporan`.
2. Pilih periode (bulan tertentu atau semua).
3. Tinjau angka di layar.
4. Klik **Unduh PDF Laporan KUR** atau **Unduh PDF Rekap Pajak**.

---

## 21. Chatbot AI Asisten

### Fungsi & Tujuan
Asisten percakapan berbasis AI yang bisa menjawab pertanyaan seputar usaha (mode Tanya) atau membantu mencatat transaksi via kalimat bebas (mode Catat).

### Mode Tanya (Q&A)
- Tanya apa saja seputar laporan, stok, keuangan, dll.
- Asisten punya konteks ringkasan keuangan hari ini (total masuk/keluar).
- Instruksi navigasi disesuaikan device: "tap menu di bawah" (HP) vs "klik di sidebar" (desktop).
- Riwayat percakapan hanya di sesi ini — tidak disimpan permanen.

### Mode Catat (Input Transaksi)
- Ketik kalimat bebas, misalnya: *"bayar listrik 350 ribu tadi pagi"*.
- AI mengurai menjadi daftar transaksi kandidat (belum tersimpan).
- Pengguna **wajib meninjau** dan menekan **Simpan** — AI tidak menyimpan otomatis.
- Setiap transaksi kandidat bisa diubah kategori sebelum disimpan.

### Input Suara
- Klik ikon mikrofon → bicara → teks otomatis terisi (Web Speech API).
- Tersedia di browser yang mendukung (Chrome, Edge).

### Consent AI
- Saat pertama kali membuka chatbot, pengguna harus setuju pada syarat penggunaan AI.
- Persetujuan disimpan lokal (localStorage).

### Cara Penggunaan
1. Klik ikon chat melayang (pojok kanan bawah).
2. Pilih mode: **Tanya** atau **Catat**.
3. Ketik pertanyaan/kalimat transaksi → Enter atau klik Kirim.
4. Untuk mode Catat: tinjau draf → klik **Simpan Semua** atau simpan per item.

---

## 22. Pengguna & Hak Akses (RBAC)

### Fungsi & Tujuan
Owner bisa mengundang staf ke dalam akun usahanya, dengan akses dibatasi per modul — staf hanya melihat dan mengoperasikan bagian yang diizinkan.

### Modul Akses

| Modul | Menu yang Dibuka |
|---|---|
| Operasional | Papan Tugas |
| Transaksi & Keuangan | Transaksi, Import, Struk, Rekonsiliasi, Piutang |
| Gudang & Produk | Stok, PO, Opname, HPP, Pemasok |
| HR & Karyawan | Karyawan, Absensi, Penggajian |
| Analisis & Laporan | Radar, Reveal, Laporan |

### Menu Khusus Owner (staf tidak bisa akses)
- Pengaturan, Pengguna, Audit Log.

### Cara Undang Staf
1. Buka `/app/pengguna` → klik **+ Undang Staf**.
2. Isi email staf → centang modul yang diizinkan → **Kirim Undangan**.
3. Staf mendaftar/login menggunakan email yang diundang → akses aktif otomatis.
4. Owner bisa edit modul atau cabut akses kapan saja.

### Isolasi Data (RLS)
- Staf hanya melihat data owner yang mengundangnya.
- Dijaga di level database (Row Level Security) — bukan hanya di UI.

---

## 23. Audit Log

### Fungsi & Tujuan
Rekam jejak permanen siapa melakukan apa dan kapan — mencegah penyalahgunaan data dan memudahkan investigasi.

### Cara Kerja
- Log ditulis oleh **trigger database** — aplikasi tidak bisa memalsukan atau menghapus log.
- Setiap `INSERT`, `UPDATE`, `DELETE` pada tabel penting terekam.

### Tabel yang Dipantau
Transaksi, Produk/Stok, Pemasok, Purchase Order, Stock Opname, Kategori, Karyawan, Penggajian, Tugas Operasional.

### Yang Dicatat per Log
- Tabel, aksi (Tambah/Ubah/Hapus), ringkasan perubahan (sebelum → sesudah), pelaku (user/staf), waktu.

### Filter Log
- Filter berdasarkan tabel dan jenis aksi.
- Refresh manual atau refresh real-time (berlangganan channel Supabase Realtime).

### Cara Penggunaan
1. Buka `/app/audit` (hanya owner).
2. Pilih filter tabel/aksi jika perlu.
3. Tinjau log — kolom "Perubahan" menampilkan ringkasan mudah dibaca.

---

## 24. Pengaturan

### Fungsi & Tujuan
Konfigurasi profil usaha, preferensi aplikasi, dan data master kategori/channel.

### Yang Bisa Dikonfigurasi

**Profil Usaha**
- Nama usaha, nomor telepon, tipe wajib pajak (Orang Pribadi/Badan), logo.
- Nama dan logo muncul di kop laporan PDF.

**Kategori Transaksi**
- Tambah/hapus kategori pemasukan dan pengeluaran sesuai kebutuhan usaha.
- Kategori default tersedia, tapi bisa dikustomisasi.

**Channel Transaksi**
- Tambah channel pembayaran khusus (mis. channel marketplace tertentu).

**Aturan Auto-Kategori**
- Tambah aturan keyword → kategori. Contoh: kata kunci "Grab" → "Transportasi Operasional".
- Aturan pengguna diprioritaskan di atas aturan bawaan sistem.

**Keamanan**
- Ganti password.
- Aktifkan/nonaktifkan 2FA (TOTP).
- Atur/ubah PIN Kunci Aplikasi.

**Privasi & Data**
- **Export data**: unduh semua transaksi dalam format JSON.
- **Hapus semua data**: hapus permanen seluruh data usaha (dengan konfirmasi).
- Link ke halaman Syarat & Ketentuan serta Kebijakan Privasi.

### Cara Penggunaan
1. Buka `/app/pengaturan`.
2. Isi profil usaha → **Simpan Profil**.
3. Tambah kategori di tab Kategori.
4. Tambah aturan auto-kategori di tab Aturan.
5. Aktifkan 2FA di tab Keamanan → scan QR → verifikasi kode.

---

## 25. Feedback

### Fungsi & Tujuan
Pengguna bisa memberikan umpan balik langsung dari dalam aplikasi — rating bintang, kategori masukan, apakah AI membantu, dan pesan bebas.

### Yang Bisa Dilakukan
- Beri rating 1–5 bintang.
- Pilih kategori: Saran, Bug/Error, Pujian, dll.
- Tandai apakah fitur AI sudah membantu.
- Tulis pesan bebas.
- Lihat riwayat feedback yang pernah dikirim beserta statusnya (Baru / Dibaca / Ditindaklanjuti / Selesai).

### Cara Penggunaan
1. Buka `/app/feedback`.
2. Beri rating → pilih kategori → isi pesan → **Kirim**.

---

## 26. Rencana Testing

Dokumen QA lengkap ada di `QA.md`. Berikut ringkasan terstrukturnya.

---

### 26.1 Definisi "Lulus"

Aplikasi dinyatakan **siap launch** jika:
1. **100%** test case P0 (Kritis) lulus.
2. **≥ 95%** test case P1 (Penting) lulus.
3. **Tidak ada** bug Blocker atau Critical yang masih terbuka.
4. Semua ambang metrik terpenuhi.
5. Checklist pra-launch selesai 100%.
6. Build produksi sukses tanpa error console.

---

### 26.2 Ambang Metrik

| Metrik | Target |
|---|---|
| Akurasi auto-kategori | ≥ 85% (dari 100 transaksi campuran) |
| Akurasi parsing import CSV/Excel | ≥ 95% (dari 200 baris, ≥3 format) |
| Akurasi deteksi duplikat | ≥ 95% (50 skenario cross-channel) |
| Konsistensi angka laporan | 100% (sama dengan hitungan manual) |
| Waktu muat halaman (load) | < 3 detik (jaringan normal) |
| Isolasi data antar-user (RLS) | 100% — tidak boleh ada kebocoran |

---

### 26.3 Suite A — Autentikasi & Keamanan

| ID | Skenario | Prioritas |
|---|---|---|
| A-01 | Daftar akun baru → OTP dikirim ke email | P0 |
| A-02 | Password lemah (< syarat) ditolak | P0 |
| A-03 | Password kuat (5 syarat terpenuhi) diterima | P0 |
| A-04 | OTP benar → masuk ke Dashboard | P0 |
| A-05 | OTP salah → ditolak dengan pesan | P0 |
| A-06 | OTP 8 digit diterima (tidak terpotong) | P0 |
| A-07 | Email sudah terdaftar → pesan sesuai | P1 |
| A-08 | Daftar ulang email belum verif → kirim ulang OTP | P1 |
| A-09 | Nomor telepon ganda ditolak | P1 |
| A-10 | Login benar → masuk Dashboard | P0 |
| A-11 | Login salah → pesan error | P0 |
| A-12 | Reset password via email | P0 |
| A-13 | Logout → diarahkan ke login | P0 |
| A-14 | Buka /app tanpa login → redirect login | P0 |
| A-15 | Refresh halaman → sesi tetap aktif | P1 |
| A-16 | Normalisasi format telepon `08xxx`/`62xxx`/`+62xxx` | P1 |

---

### 26.4 Suite B — Transaksi

| ID | Skenario | Prioritas |
|---|---|---|
| B-01 | Tambah transaksi masuk → muncul di daftar + Dashboard | P0 |
| B-02 | Tambah transaksi keluar → tanda minus/merah | P0 |
| B-03 | Nominal 0 atau kosong ditolak | P0 |
| B-04 | Deskripsi kosong ditolak | P1 |
| B-05 | Auto-saran kategori (contoh: "PLN" → "Operasional Listrik") | P1 |
| B-06 | Edit transaksi → perubahan tersimpan | P0 |
| B-07 | Hapus → konfirmasi → hilang dari daftar, total terupdate | P0 |
| B-08 | Cari transaksi dengan kata kunci | P1 |
| B-09 | Filter Masuk/Keluar | P1 |
| B-10 | Data masih ada setelah refresh / login ulang | P0 |

---

### 26.5 Suite C — Import Data

| ID | Skenario | Prioritas |
|---|---|---|
| C-01 | Import CSV mutasi bank (debit/kredit terdeteksi) | P0 |
| C-02 | Import Excel (.xlsx) terbaca | P0 |
| C-03 | Baris judul di atas tabel dilewati otomatis | P0 |
| C-04 | Import marketplace → kategori "Penjualan Marketplace" | P1 |
| C-05 | Format Rupiah beragam terbaca benar | P0 |
| C-06 | Preview pra-simpan bisa dicentang/uncentang | P1 |
| C-07 | Hanya baris dicentang yang tersimpan ke DB | P1 |
| C-08 | File rusak → pesan error, tidak crash | P0 |
| C-09 | File kosong → pesan sesuai | P1 |
| C-10 | Tanggal dd/mm/yyyy ter-parse benar | P1 |

---

### 26.6 Suite D — Rekonsiliasi

| ID | Skenario | Prioritas |
|---|---|---|
| D-01 | Deteksi duplikat nominal+waktu dekat → 1 grup terdeteksi | P0 |
| D-02 | "Pertahankan ini" → sisanya terhapus | P1 |
| D-03 | "Abaikan" → grup hilang dari daftar | P1 |
| D-04 | Ubah toleransi waktu → hasil berubah sesuai | P2 |

---

### 26.7 Suite E — Dashboard

| ID | Skenario | Prioritas |
|---|---|---|
| E-01 | KPI omzet/profit = hitungan manual transaksi | P0 |
| E-02 | Grafik tren 14 hari tampil, nilai sesuai | P1 |
| E-03 | Pie chart sumber pemasukan, proporsi benar | P1 |
| E-04 | Tanpa data → empty state (bukan error) | P1 |

---

### 26.8 Suite F — Laporan

| ID | Skenario | Prioritas |
|---|---|---|
| F-01 | PDF Laporan KUR terunduh, isi laba-rugi + arus kas | P0 |
| F-02 | PDF Rekap Pajak terunduh, PPh 0,5% benar | P0 |
| F-03 | Filter periode → angka & PDF sesuai | P1 |
| F-04 | PPh = 0,5% × omzet kena pajak | P0 |
| F-05 | Accordion KUR & Pajak bisa dibuka | P2 |

---

### 26.9 Suite G — Pengaturan

| ID | Skenario | Prioritas |
|---|---|---|
| G-01 | Simpan profil usaha → muncul di kop PDF | P1 |
| G-02 | Tambah aturan kategori → transaksi ter-kategori sesuai | P1 |
| G-03 | Hapus aturan kategori | P2 |

---

### 26.10 Suite H — Keamanan & Isolasi Data (WAJIB)

| ID | Skenario | Prioritas |
|---|---|---|
| H-01 | **User B tidak bisa melihat data User A** | **P0 — Blocker bila gagal** |
| H-02 | Query API tanpa login tidak mengembalikan data orang lain | P0 |
| H-03 | Tidak ada service_role key di frontend | P0 |
| H-04 | Password tidak tersimpan plaintext | P0 |
| H-05 | Halaman /app tanpa token valid → ditolak | P0 |

> **Cara uji H-01**: buat 2 akun berbeda, isi transaksi di masing-masing, pastikan tidak saling terlihat.

---

### 26.11 Suite K — Kompatibilitas & Performa

| ID | Skenario | Prioritas |
|---|---|---|
| K-01 | Chrome/Edge desktop — semua fitur jalan | P0 |
| K-02 | Firefox desktop — semua fitur jalan | P1 |
| K-03 | Mobile (HP) — layout responsif, sidebar bisa dibuka | P1 |
| K-04 | Refresh di rute dalam (/app/laporan) → tidak 404 | P0 |
| K-05 | Load awal < 3 detik (jaringan normal) | P1 |
| K-06 | 1000+ transaksi → Dashboard tetap responsif | P2 |

---

### 26.12 Unit Test Otomatis (Regresi)

Dijalankan dengan `npm test` (Vitest). Saat ini **22/22 test lulus**, mencakup:

| File Test | Yang Diuji |
|---|---|
| `logic.test.js` | Parsing Rupiah, auto-kategori, pajak PPh, deteksi duplikat, summarize |
| `rbac.test.js` | `canModule`, `filterNav`, daftar 5 modul RBAC |
| `ops.test.js` | Alur status papan tugas, `isTaskOverdue`, `sortTasks` |
| `aging.test.js` | Perhitungan umur tagihan, bucket aging |
| `gudang.test.js` | Logika PO, Opname, nomor dokumen |
| `hr.test.js` | Penghitungan gaji harian, periode, rekap absensi |
| `masa_depan.test.js` | Proyeksi target omzet (regresi linier) |

**Jalankan ulang setiap ada perubahan logika sebelum rilis.**

---

### 26.13 Checklist Pra-Launch

- [ ] `schema.sql` dijalankan di Supabase
- [ ] `migration_auth.sql` dijalankan (telepon unik + RPC)
- [ ] SMTP Resend terpasang (OTP & reset terkirim)
- [ ] Template email memuat `{{ .Token }}` sebagai teks
- [ ] `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` terisi
- [ ] Site URL & Redirect URLs di Supabase = domain Vercel
- [ ] `npm run build` sukses tanpa error
- [ ] Tidak ada error di console browser pada semua halaman

---

*Dokumen ini dibuat otomatis dari pembacaan source code SmartBookAI — Juli 2026.*
