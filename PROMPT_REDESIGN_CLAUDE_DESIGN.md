# PROMPT REDESIGN UI/UX — SmartBookAI (BukuPintar AI)
> Serahkan prompt ini ke Claude Design. Tidak perlu modifikasi tambahan.

---

## [P — PERAN]

Kamu adalah Senior Product Designer + Frontend Engineer dengan spesialisasi:
- SaaS aplikasi keuangan & pembukuan berbasis AI untuk pasar Asia Tenggara (8+ tahun pengalaman)
- Design systems berbasis CSS custom properties tanpa CSS framework eksternal
- Aksesibilitas digital (WCAG 2.1 AA) dan UX untuk pengguna non-teknis
- Mobile-first responsive design untuk pengguna smartphone-only
- React component patterns yang ramping dan dapat dipelihara

Prinsip desain utama: **"Apakah pemilik warung berusia 35 tahun di Surabaya bisa memahami ini dalam 3 detik pertama?"**

---

## [K — KONTEKS & AUDIENS]

**SmartBookAI** (nama tampilan: BukuPintar AI) adalah aplikasi web manajemen bisnis UMKM berbasis AI dari **PT Sovralytics Tech**. Ini bukan sekadar aplikasi pembukuan — ini asisten bisnis pintar yang bisa diajak bicara, membaca struk sendiri, menjawab rekap apapun tentang bisnis kamu (keuangan, karyawan, stok, piutang — cukup tanya), dan mengelola seluruh operasional usaha dari satu tempat.

**Stack:** React 18 + Vite + pure CSS custom properties (tidak ada Tailwind, tidak ada Bootstrap).

### Palet Warna & Aturan Kontras

Palet dasar (tidak ada hierarki nama — Claude Design bebas menentukan peran tiap warna):
```
#1c36ee   (biru tua)
#137be7   (biru sedang)
#07bbd2   (cyan biru)
#00fed9   (cyan terang)
```

**Aturan kontras — WAJIB, tidak ada pengecualian:**
- Latar gelap (luminance rendah) → teks, ikon, label, border aktif HARUS terang (putih / off-white)
- Latar terang (luminance tinggi) → teks, ikon, label, border aktif HARUS gelap (hitam / abu gelap)
- Sidebar gelap → SEMUA item nav (ikon + label teks + badge) di atasnya harus terang
- Button di atas latar gelap → label button harus terang; button di atas latar terang → label harus gelap
- Rasio kontras minimum WCAG AA: 4.5:1 untuk teks normal, 3:1 untuk teks besar & elemen UI

Font: **Inter** (body) + **Space Grotesk** (heading). Maksimal 3 font family.

Dark/light theme wajib via `[data-theme="dark"]` pada `:root`. Semua nilai warna harus melalui CSS custom properties — tidak ada hardcode hex langsung di komponen.

### Audiens

**Primer — "Pak Rendi":** Pemilik warung/toko kecil, 28–50 tahun, akrab WhatsApp & Shopee, takut salah tekan, pakai 3–5x/hari via smartphone Android mid-range. Mau catat transaksi secepat kirim WA.

**Sekunder — "Mbak Dina":** Staf kasir/admin, 22–30 tahun, butuh efisiensi, akses fitur lebih advanced, kadang pakai laptop.

---

## [DESKRIPSI LENGKAP SEMUA FITUR SMARTBOOKAI]

> **PENTING — BACA SEBELUM DESAIN:**
>
> ✅ = Fitur sudah live dan berfungsi sepenuhnya.
> 🔜 = Fitur dalam pengembangan. Di UI wajib ada badge "Segera Hadir" — jangan tampilkan seolah sudah bisa dipakai.
>
> Redesign hanya mengubah tampilan. Tidak boleh menghapus, menyembunyikan, atau mengubah logika fitur manapun.

---

### STATUS INTEGRASI CHANNEL (KRITIS)

> Semua pull/sync otomatis dari platform eksternal masih 🔜 Coming Soon.
> Yang ✅ live: ketik/suara lewat AI + foto struk + import CSV generik.

| Cara Input Transaksi | Status |
|---|---|
| Ketik kalimat natural ke AI Asisten (misal: "laku 3 donat 45rb") | ✅ Live |
| Input suara ke AI Asisten (Speech Recognition, Bahasa Indonesia) | ✅ Live |
| Foto / scan struk → AI baca otomatis (AI vision) | ✅ Live |
| Import file CSV generik dengan mapping kolom manual | ✅ Live |
| Form input manual (isi field satu per satu) | ✅ Live |
| Sinkronisasi otomatis QRIS merchant | 🔜 Coming Soon |
| Import mutasi bank otomatis | 🔜 Coming Soon |
| Parser laporan Shopee / Tokopedia / TikTok Shop | 🔜 Coming Soon |
| Forward notifikasi WhatsApp | 🔜 Coming Soon |
| Parser email/invoice marketplace | 🔜 Coming Soon |

---

### 1. LANDING PAGE (`/`) ✅

**Tujuan:** Konversi pengunjung jadi pengguna terdaftar. Tampilkan fitur keren, rumusan masalah nyata, solusi konkret, dan hook yang kuat. Buang semua konten yang tidak berkontribusi ke konversi.

**Navbar:**
- Logo BukuPintar AI (kiri)
- Link anchor: Masalah, Fitur, Cara Kerja
- Toggle Dark Mode + bahasa (ID/EN)
- Tombol "Masuk" (ghost) + "Coba Gratis" (primary, paling mencolok)

**Hero — Hook Utama:**

Headline yang menghantam pain point langsung. Arah pesan: *Bicara ke AI → transaksi tercatat. Foto struk → data masuk sendiri. Satu aplikasi, semua urusan usahamu.* Sesuaikan bahasa dengan visi brand, tapi energinya harus terasa seperti ini.

- Sub-headline 1–2 kalimat: manfaat konkret, bukan jargon
- CTA primer besar: "Mulai Gratis Sekarang"
- CTA sekunder: "Lihat Cara Kerjanya"
- Mockup smartphone: tampilkan panel chat AI sedang mencatat transaksi dari suara/ketikan, atau dashboard dengan insight AI — bukan form isian biasa

**Seksi Masalah (Problem Statement) — 3 pain point nyata:**

1. **Catat transaksi itu repot** — pemilik warung tidak sempat buka laptop atau isi form panjang di tengah transaksi. Ujungnya tidak tercatat sama sekali.
2. **Untung tergerus tanpa sadar** — biaya admin marketplace, ongkir ditanggung, fee iklan — semua terpotong diam-diam. Omzet kelihatan besar, tapi uang yang masuk jauh lebih kecil.
3. **Operasional berantakan** — stok tidak terpantau, karyawan tidak ada absensi, pembelian ke supplier tidak tercatat. Bisnis jalan tapi tidak bisa dikontrol.

**Seksi Fitur Unggulan — 6 fitur paling keren yang SUDAH LIVE:**

1. **Catat Lewat Suara atau Ketikan** — Bilang ke AI: *"tadi laku 3 kue coklat total 45 ribu"* dan transaksi langsung siap tersimpan. Tidak perlu buka form, tidak perlu isi kolom satu per satu.
2. **Foto Struk → Data Masuk Sendiri** — Ambil foto struk belanja, AI baca dan ekstrak semua item, jumlah, dan harga otomatis. Stok pun ikut diperbarui.
3. **Asisten AI yang Tahu Semua Urusan Bisnismu** — Malas buka-buka halaman? Tanya langsung: *"Rekap absensi Budi bulan ini gimana?"*, *"Siapa karyawan yang KPI-nya paling bagus?"*, *"Ada piutang yang lewat jatuh tempo?"* — AI jawab dari data nyata kamu, tanpa perlu navigasi ke mana pun.
4. **Dashboard AI + Prediksi Target** — Insight harian otomatis tentang kondisi usaha. Set target omzet, lihat 3 skenario prediksi (optimis/realistis/pesimis) kapan target tercapai.
5. **Analisis Kebocoran Biaya** — Lihat berapa persen omzetmu yang terpotong fee admin, ongkir, iklan per channel. Margin aslimu mungkin jauh lebih kecil dari yang kamu kira.
6. **HR + Operasional Lengkap** — Kelola stok, PO ke supplier, absensi, KPI, hingga gaji karyawan — semuanya dari satu tempat dan otomatis masuk ke laporan keuangan.

**Seksi Cara Kerja (3 langkah sederhana):**
1. Bilang atau ketik ke AI → transaksi ter-parse otomatis → kamu konfirmasi
2. Dashboard + Radar pantau kondisi bisnis & harga bahan real-time
3. Laporan keuangan tersedia kapan saja — ekspor PDF atau Excel

> **Catatan di landing page:** Channel label (QRIS, Shopee, BCA, dll) tersedia saat catat transaksi. Sinkronisasi otomatis dari platform-platform ini sedang dalam pengembangan.

**Seksi Coming Soon (singkat):**
Badge atau seksi kecil: integrasi otomatis QRIS, Shopee, Tokopedia, WhatsApp forward — segera hadir.

**CTA Akhir:**
Section besar sebelum footer. Headline persuasif + "Buat Akun Gratis — Tanpa Kartu Kredit".

**Footer:**
- Logo BukuPintar AI + tagline: *"Asisten bisnis AI untuk UMKM Indonesia."*
- Kolom link: Produk (Fitur, Cara Kerja, Daftar), Legal (Syarat & Ketentuan, Kebijakan Privasi)
- **Informasi perusahaan (wajib tampil, profesional):**
  - **PT Sovralytics Tech**
  - Instagram: [@sovralytics_tech](https://www.instagram.com/sovralytics_tech/)
  - Email: sovralyticstech@gmail.com
- Copyright: © 2026 PT Sovralytics Tech. All rights reserved.
- Disclaimer: *BukuPintar AI adalah alat bantu pencatatan, bukan nasihat keuangan, pajak, atau hukum.*

---

### 2. AUTH — LOGIN (`/masuk`) ✅
- Form email + password (show/hide toggle)
- Tombol "Masuk"
- Link ke Lupa Password & Daftar
- Panel samping brand (AuthSide): tagline + 4 keunggulan singkat
- Validasi error inline (di bawah field, bukan popup)
- Bilingual ID/EN

### 3. AUTH — REGISTER (`/daftar`) ✅
- Form: nama usaha, nama pemilik, email, password
- Password checklist real-time (panjang ≥8, huruf besar, angka, simbol)
- Checkbox persetujuan Syarat & Ketentuan + Kebijakan Privasi
- OTP 6 digit untuk verifikasi email setelah submit
- Link ke Login
- Panel samping brand

### 4. AUTH — LUPA PASSWORD (`/lupa-password`) ✅
- Input email → kirim kode reset
- Input kode OTP + password baru + konfirmasi
- Pesan sukses → redirect login

### 5. SETUP AWAL (`/setup`) ✅
- Wizard onboarding satu kali setelah pertama daftar
- Input: nama usaha, jenis usaha, nama pemilik, nomor telepon, tipe wajib pajak
- Data bisa diubah nanti di Pengaturan

---

### 6. APP SHELL (Layout Utama) ✅

**Sidebar (desktop):**
- Logo + nama usaha di atas
- Navigasi berkelompok dengan label seksi: Ringkasan, Transaksi, Produk, Karyawan (HR), Analisis, Lainnya
- Item nav: ikon + label teks. Active state tegas.
- User info + tombol Logout di bawah
- Collapsible (icon-only mode)
- ⚠️ Sidebar berlatar gelap → SEMUA ikon & teks nav HARUS terang

**Topbar:**
- Judul halaman aktif
- Avatar user + dropdown (profil, pengaturan, logout)
- Badge notifikasi/reminders

**Bottom Navigation (mobile ≤768px):**
- 5 tab: Dashboard, Catat (shortcut ke mode Catat AI), Transaksi, Stok, Lainnya (…)
- Tab "Catat" sebaiknya paling menonjol secara visual — ini aksi paling sering
- Active tab: indikator warna jelas

**App Lock (Overlay PIN):**
- Muncul otomatis setelah idle sesuai konfigurasi user
- Input PIN 4–6 digit (masked)
- Overlay blur seluruh konten
- Set/ubah/hapus PIN di Pengaturan

**Asisten AI — Chatbot Panel (fitur INTI, bukan sekedar widget):**

Ini adalah antarmuka utama untuk dua hal sekaligus:

**Mode TANYA** — Q&A dan rekap bisnis dari satu tempat:

AI memiliki akses ke **seluruh data bisnis pengguna secara real-time** — transaksi, stok, karyawan, absensi, KPI, gaji, hingga piutang. User tidak perlu buka halaman mana pun untuk dapat rekap. Cukup tanya.

Contoh pertanyaan yang bisa dijawab AI:

*Keuangan:*
- "Berapa laba bersih bulan ini?"
- "Pengeluaran terbesar saya apa saja minggu ini?"
- "Ada piutang yang sudah lewat jatuh tempo?"

*Karyawan & HR — tanpa buka halaman Absensi/KPI/Gaji:*
- "Rekap absensi Budi bulan ini gimana?"
- "Siapa karyawan yang paling sering izin?"
- "KPI siapa yang skornya paling tinggi bulan lalu?"
- "Total gaji yang sudah dibayar bulan ini berapa?"
- "Karyawan mana yang belum dibayar gajinya?"

*Stok & Operasional:*
- "Produk mana yang stoknya hampir habis?"
- "Ada PO yang belum diterima?"

*Navigasi & panduan pakai:*
- "Cara buat invoice gimana?"
- "Di mana saya lihat laporan laba rugi?"

AI menjawab langsung dengan angka dari data nyata pengguna — bukan jawaban generik. Jika datanya memang tidak ada, AI bilang terus terang.

- Riwayat percakapan per sesi (tidak disimpan ke server setelah sesi selesai)
- Chip pertanyaan cepat di empty state (keuangan, HR, stok — masing-masing kategori)

**Mode CATAT** — Input transaksi via AI:
- User ketik atau ucapkan transaksi dalam Bahasa Indonesia natural, misalnya:
  - *"Laku 3 kue coklat total 45 ribu"*
  - *"Beli gas 22 ribu sama plastik 10 ribu"*
  - *"Kemarin bayar listrik 150 ribu"*
  - *"Orderan kue ultah 350 ribu belum dibayar"*
- AI parse kalimat → tampilkan **kartu draf transaksi** (belum tersimpan)
- Kartu draf bisa diedit: jenis (pemasukan/pengeluaran), nominal, kategori, tanggal, keterangan, status bayar
- Tombol "Simpan X Transaksi" — transaksi baru disimpan setelah konfirmasi user
- Setelah tersimpan: ringkasan deterministik dari database (bukan AI): "3 transaksi tersimpan. Hari ini: pemasukan Rp X, pengeluaran Rp Y, laba Rp Z."
- ⚠️ **Human-in-the-loop wajib** — AI tidak langsung simpan, selalu perlu konfirmasi user

**Input suara:**
- Tombol mikrofon di input area
- Gunakan Web Speech API (Bahasa Indonesia: `lang='id-ID'`)
- Teks hasil suara masuk ke input → user kirim manual
- Fallback teks jika perangkat tidak support

**Consent screen:** Muncul pertama kali sebelum AI aktif — penjelasan apa yang dikirim ke layanan AI dan apa yang tidak. Tombol "Aktifkan Asisten AI".

**Akses cepat:** Tab "Catat" di bottom navigation mobile langsung membuka panel dalam mode Catat.

**FAB (desktop):** Floating Action Button di pojok kanan bawah — ikon chat. Klik buka panel.

**Reminders (Banner Kontekstual):**
- Muncul di atas konten Dashboard jika ada tagihan jatuh tempo, stok menipis, atau HR yang perlu diperhatikan
- Dismissable per item

**Language Toggle (ID/EN) + Theme Toggle (Dark/Light):** Di topbar/navbar.

---

### 7. DASHBOARD (`/app/dashboard`) ✅

Dashboard ini adalah **pusat komando bisnis berbasis AI**, bukan sekadar halaman ringkasan angka.

**Filter Rentang Tanggal:** Dropdown preset (Hari ini / Minggu ini / Bulan ini / Kuartal / Semester / Tahun / Semua / Rentang kustom). Jika kustom: 2 date picker dari–sampai.

**Banner Alert Stok Menipis:** Alert merah jika produk ≤ min_stock, link ke Stok.

**Mode Demo:** Tombol "Coba dengan data contoh" untuk pengguna baru. Banner info saat mode aktif.

**Kartu Insight AI Harian (AI Automation):**
- Narasi teks otomatis kondisi usaha hari ini, dihasilkan AI dari angka nyata pengguna
- Di-cache per hari — buka berkali-kali tidak kena kuota
- Tombol refresh paksa (generate ulang)
- Disclaimer AI: "Narasi dibuat AI, angka dihitung dari data nyata Anda"
- Contoh output: *"Hari ini omzet Rp 2,4 juta dari 18 transaksi. Pengeluaran Rp 850 ribu, laba bersih Rp 1,55 juta. Channel Shopee menyumbang 60% pemasukan. 2 item stok mendekati habis — segera restock."*

**Kartu Target Penjualan (AI Automation — Prediksi 3 Skenario):**
- User set target omzet (nama, nominal, tanggal mulai)
- Setelah data cukup (≥14 hari, ≥10 transaksi): progress bar + prediksi 3 skenario kapan target tercapai berdasarkan regresi musiman (bukan AI — deterministik)
  - Optimis: jika tren terbaik terjaga
  - Realistis: berdasarkan rata-rata performa
  - Pesimis: jika tren sedang melemah
- Jika data belum cukup: teks motivasi + progress data terkumpul
- Tombol hapus target

**4 KPI Card:**
- Pemasukan (hijau + ikon TrendingUp)
- Pengeluaran (merah + ikon TrendingDown)
- Laba Bersih (kondisional hijau/merah)
- Margin % (kondisional) — sub-info: piutang belum lunas jika ada

**Grafik Tren 14 Hari:** Area chart pemasukan vs pengeluaran harian. Dua area warna berbeda, tooltip hover.

**Grafik Sumber Pemasukan:** Donut chart per channel dengan legenda nilai.

**6 Transaksi Terbaru:** List ringkas (deskripsi, channel pill, kategori pill, waktu, nominal ±). Link "Lihat semua".

**Top 6 Pengeluaran per Kategori:** Horizontal bar chart.

**Empty State:** Ilustrasi + 3 CTA: coba demo, buka AI Asisten untuk catat, import CSV.

---

### 8. ASISTEN AI — CATAT TRANSAKSI (Via Panel Chat) ✅

> Ini adalah cara utama mencatat transaksi — bukan form manual. Panel ini ada di App Shell (chatbot), bukan halaman tersendiri.

Cara kerja lengkap sudah dijelaskan di seksi App Shell (Mode CATAT). Poin desain kritis:
- Kartu draf transaksi harus terlihat jelas: jenis (in/out), nominal besar dan terbaca, kategori, tanggal, keterangan, status bayar, tombol hapus per kartu
- Tombol "Simpan X Transaksi" harus menonjol — ini aksi yang paling penting
- Flag peringatan jika nominal sangat besar (mungkin salah dengar/baca)
- Setelah simpan: kartu berubah jadi summary read-only (tidak bisa edit lagi)

---

### 9. TRANSAKSI (`/app/transaksi`) ✅

Halaman daftar dan manajemen semua transaksi yang sudah tersimpan:

- **Toolbar:** Search box, filter Jenis (Semua/Pemasukan/Pengeluaran), filter Status Bayar (Semua/Lunas/Belum), tombol "+ Tambah" (buka form manual sebagai alternatif AI)
- **Tabel:** Kolom: Tanggal, Jenis (badge in/out), Deskripsi + ikon paperclip jika ada struk, Channel (pill), Kategori (pill), Status Bayar (badge), Nominal, Aksi
- **Aksi per baris:** Edit (modal), Hapus (konfirmasi), Cetak Faktur (untuk pemasukan)
- **Counter:** "Menampilkan X dari Y transaksi"
- **Empty state** berbeda: belum ada transaksi sama sekali vs tidak ada hasil filter

**Modal Tambah/Edit Transaksi (form manual):**
- Toggle Pemasukan / Pengeluaran
- Deskripsi, Nominal, Tanggal & waktu, Channel (label), Kategori, Status Bayar
- Jika Belum Lunas: Nama Pelanggan/Pemasok, Jatuh Tempo
- Catatan opsional
- Upload foto/PDF struk (lampiran)
- Jika pemasukan baru: opsi "Sesuaikan stok" — pilih produk & qty, stok berkurang atomik

**Modal Cetak Faktur/Invoice:**
- Preview faktur: logo usaha, nama usaha, kontak, detail transaksi, total, catatan footer
- Tombol Print

---

### 10. FOTO/PDF STRUK — AI BACA OTOMATIS (`/app/struk`) ✅

Ini adalah cara input transaksi berbasis AI vision:

**Alur:**
1. User ambil foto langsung (kamera) atau unggah file (JPG/PNG/PDF, maks 10 MB)
2. Preview foto/file ditampilkan
3. Tombol **"Baca Struk dengan AI"** — AI (vision model) memindai struk dan mengekstrak:
   - Daftar item (nama, qty, satuan, harga)
   - Nama merchant/toko
   - Total transaksi
   - Tanggal transaksi
   - Tingkat keterbacaan (cetak jelas / buram / tulisan tangan)
4. Hasil muncul sebagai tabel item yang bisa diedit
5. User periksa dan koreksi jika perlu
6. Tiap item bisa dikaitkan ke produk di stok (dropdown) + konversi satuan jika berbeda
7. Pilih: Pengeluaran (belanja) atau Pemasukan (penjualan)
8. Tombol "Simpan Transaksi · Rp X" → transaksi tersimpan + stok item terkait diperbarui otomatis

**Alert & validasi:**
- Alert jika struk terdeteksi tulisan tangan (akurasi rendah)
- Alert jika foto buram
- Cross-check deterministik: jika total item ≠ total struk AI (toleransi 2%) → warning
- Disclaimer AI di bawah tabel

**Alternatif:** Tombol "Atau isi item manual" jika tidak mau pakai AI.

---

### 11. IMPORT CSV (`/app/import`) ✅

Import massal dari file CSV apapun:
- Drag & drop atau klik upload `.csv`
- Preview 5 baris pertama
- Mapping kolom: header CSV → field sistem (tanggal, nominal, deskripsi, jenis, kategori, channel)
- Validasi: hitung baris valid vs error
- Konfirmasi jumlah sebelum import
- Pesan sukses
- Catatan UI: parser spesifik per platform (Shopee, Tokopedia, mutasi bank) sedang dalam pengembangan

---

### 12. REKONSILIASI (`/app/rekonsiliasi`) ✅

Deteksi & bersihkan duplikat transaksi:
- Penjelasan singkat cara kerja
- Dropdown toleransi selisih waktu: 1 jam / 6 jam / 1 hari / 3 hari
- Badge: "X grup duplikat terdeteksi"
- List grup: per grup tampilkan 2+ transaksi mirip. Aksi: "Pertahankan Satu" atau "Abaikan"
- Empty state positif: ikon centang hijau besar

---

### 13. PIUTANG & UTANG (`/app/piutang`) ✅

- **3 KPI Card:** Piutang total (hijau), Utang total (merah), Lewat Jatuh Tempo (merah/abu)
- **Tab:** Piutang / Utang
- **Aging Buckets:** 4 chip: 0–30 / 31–60 / 61–90 / >90 hari. Bucket >90 hari: border merah jika ada isi.
- **Tabel:** Tanggal, Deskripsi, Pelanggan/Pemasok, Umur + pill bucket, Jatuh Tempo, Nominal, Aksi
- **Aksi:** "Ingatkan via WhatsApp" (buka wa.me dengan teks pengingat siap kirim — link saja, bukan integrasi WA) + "Tandai Lunas"
- Empty state berbeda untuk piutang vs utang

---

### 14. STOK PRODUK (`/app/stok`) ✅

- Alert stok menipis di atas
- Form tambah/edit produk inline: nama, kategori, satuan, harga jual, harga modal/HPP, stok saat ini, stok minimum, pemasok
- Toolbar: search + tombol "Kelola satuan & kategori" (toggle panel CrudList satuan & kategori)
- Tabel: Nama, Kategori, Stok + badge "Menipis", Harga Modal, Harga Jual, Margin %, Pemasok, Aksi
- Baris stok menipis: latar amber
- Aksi: Buat PO (jika menipis), Ubah, Hapus
- Footer: total produk + nilai modal stok

---

### 15. PURCHASE ORDER / PO (`/app/po`) ✅

Alur: Draf → Disetujui → Diterima:
- Tombol "+ Buat PO" → Modal: produk, supplier, qty, harga satuan, tgl perkiraan, catatan. Nomor auto-generate.
- List PO dengan badge status berwarna
- Aksi sesuai status: Edit/Setujui/Hapus (Draf), Terima Barang/Batalkan (Disetujui)
- Modal Terima Barang: konfirmasi qty → stok bertambah + opsi catat pengeluaran
- Deep link dari halaman Stok: "Buat PO" buka modal dengan produk pre-filled

---

### 16. STOCK OPNAME (`/app/opname`) ✅

Sesi stock opname (satu draf aktif per waktu):
- List sesi sebelumnya (nomor, tanggal, status)
- Tombol "Mulai Opname Baru"
- Sesi aktif: tabel produk → Stok Sistem | input Stok Fisik | Selisih (otomatis)
- Tombol: Simpan Draf (bisa berkali-kali) | Posting Opname (terkunci, stok sistem di-set) | Batalkan
- Summary: produk dengan selisih, nilai selisih

---

### 17. SIMULASI HPP (`/app/hpp`) ✅

Hitung Pokok Penjualan + simulasi dampak kenaikan bahan:
- Pilih produk → load BOM tersimpan
- **BOM Editor:** tabel bahan: nama, tipe, satuan, harga/satuan, komoditas, paparan impor, qty/unit, flag AI-estimated
- **Tombol "Draft dengan AI":** AI generate estimasi awal BOM dari nama produk. Baris hasil AI diberi badge "Estimasi AI". Disclaimer jelas.
- Panel hasil: HPP/unit, harga jual, margin, harga jual minimal untuk target margin
- Simulasi kenaikan: input % per bahan → HPP baru vs lama
- Simulasi kurs: input % pelemahan → otomatis naikkan bahan dengan paparan impor sedang/tinggi
- Sinyal Radar terintegrasi: perkiraan kenaikan komoditas di samping bahan terkait
- Tombol Simpan BOM

---

### 18. PEMASOK / SUPPLIER (`/app/pemasok`) ✅

Master data vendor:
- Form tambah/edit: nama, kontak, alamat, catatan
- Tabel: nama, kontak, alamat, aksi (edit, hapus)
- Search, empty state

---

### 19. PAPAN TUGAS HARIAN (`/app/tugas`) ✅

Manajemen tugas operasional harian (Kanban sederhana):
- **3 kolom status:** Antre → Dikerjakan → Selesai
- **Tambah tugas (modal):** Judul (wajib), Catatan, Prioritas (rendah/normal/tinggi/kritis), Jatuh Tempo, Ditugaskan ke (karyawan aktif)
- **Kartu tugas:** Judul, catatan, prioritas (badge warna), jatuh tempo, nama yang ditugaskan, badge "Terlambat" jika lewat due date
- **Pindah status:** Tombol panah kiri/kanan (tidak drag-drop) — ramah sentuh, tidak salah geser
- Urutkan per kolom: prioritas tinggi di atas, terlambat diberi visual berbeda
- Edit tugas (buka modal) + hapus
- **Integrasi KPI:** Persentase tugas selesai dari papan ini dipakai sebagai sumber data otomatis untuk skor KPI karyawan
- Setiap perubahan terekam di Audit Log
- Empty state per kolom

---

### 20. KARYAWAN (`/app/karyawan`) ✅

Master data SDM:
- Tombol "+ Tambah" → Modal: nama, jabatan, telepon, jenis gaji (bulanan/harian), nominal, tanggal bergabung, catatan
- Tabel: nama, jabatan, jenis gaji, nominal, status (aktif/nonaktif pill), bergabung, aksi
- Toggle aktif/nonaktif (nonaktif tidak masuk absensi & penggajian)
- Hapus: konfirmasi, riwayat absensi ikut terhapus, tercatat di Audit Log

---

### 21. ABSENSI & CUTI (`/app/absensi`) ✅

- Filter periode (bulan/tahun) dengan navigasi ← →
- Tabel bulanan: baris = karyawan aktif, kolom = tanggal 1–31 (scroll horizontal di mobile)
- Setiap sel: dropdown status (Hadir/Izin/Sakit/Cuti/Mangkir/Libur)
- Isi satu tanggal untuk semua karyawan sekaligus (klik header kolom)
- Panel Aturan Absensi (toggle): nilai poin per status — dipakai untuk gaji harian & KPI
- Rekap bawah per karyawan: jumlah hadir, izin, sakit, cuti, mangkir
- Export Excel rekap bulanan

---

### 22. KPI KARYAWAN (`/app/kpi`) ✅

- Filter periode dengan navigasi ← →
- **Kriteria KPI (CRUD):** Nama, Bobot %, Sumber (otomatis dari absensi / otomatis dari papan tugas / manual). Default: Kehadiran 40%, Tugas 40%, Kualitas 20%.
- **Aturan Bonus/Potongan (CRUD):** Jenjang skor → nominal bonus atau potongan
- **Tabel skor per karyawan:** prefill otomatis, bisa dioverride, total tertimbang %, usulan bonus/potongan
- Tombol "Simpan Semua Skor" → otomatis dipakai saat generate draf gaji

---

### 23. PENGGAJIAN (`/app/gaji`) ✅

- Filter periode (bulan/tahun)
- Tombol "Generate Draf": buat baris gaji semua karyawan aktif. Gaji bulanan = nominal tetap; gaji harian = tarif × hari hadir. Bonus/potongan dari KPI.
- Tabel: nama, jabatan, jenis gaji, pokok, bonus (editable di draf), potongan (editable di draf), total, status, aksi
- "Bayar Gaji": pilih kategori pengeluaran → tercatat sebagai transaksi pengeluaran otomatis
- Status Lunas: terkunci (readonly)
- Summary: total pengeluaran gaji periode ini

---

### 24. RADAR HARGA BAHAN (`/app/radar`) ✅

Pemantauan makroekonomi & harga komoditas real-time:
- **Kartu Kurs USD/IDR:** Nilai terkini (besar), delta 30 hari (hijau/merah), label kontekstual, area chart 90 hari, sumber ER-API
- **Kartu Inflasi BPS:** Inflasi umum + pangan YoY%, periode data, catatan praktis, link ke HPP
- **Filter Provinsi:** 34 provinsi, ganti data PIHPS ke provinsi terpilih (cache per hari)
- **Checkbox "Hanya bahan usaha saya":** filter ke komoditas dalam BOM produk pengguna
- **Grid Sinyal Komoditas** (per komoditas: beras, cabai, bawang, telur, ayam, terigu, kedelai, minyak, gula, dll):
  - Badge arah NAIK/TURUN/STABIL (warna)
  - Harga terkini (Rp/satuan) + delta %
  - Label sumber (PIHPS Bank Indonesia / media)
  - Perkiraan range kenaikan 30 hari
  - Tingkat keyakinan
  - Faktor driver (2–3 poin)
  - Link sumber
  - Expand varian harga
  - Badge "dipakai usaha Anda" jika di BOM
- Disclaimer AI

---

### 25. REVEAL — ANALISIS KEBOCORAN (`/app/reveal`) ✅

Visualisasi biaya tersembunyi:
- Filter periode
- 4 KPI Card: Omzet Kotor, Total Kebocoran (merah), Uang Bersih (hijau), Margin Asli % vs Margin yang Dikira %
- Kartu insight: *"Dari Rp X omzet, Rp Y dipotong (Z%). Margin aslimu A%, bukan B% yang kamu kira."* + tombol salin
- Grafik kebocoran per channel (horizontal bar, merah)
- Tabel detail per channel: Omzet Kotor, Potongan, Uang Bersih, %
- Breakdown badge: fee admin, ongkir, iklan (kuning); OPEX (biru); laba asli (hijau) vs laba dikira (abu)
- Link ke Rekonsiliasi
- Empty state + CTA

---

### 26. LAPORAN KEUANGAN (`/app/laporan`) ✅

**Catatan posisi:** Ini adalah fitur pendukung — bukan nilai jual utama SmartBookAI.

- Filter periode (semua / per bulan)
- 4 KPI Card: Pendapatan, Pengeluaran, Laba Bersih, Estimasi PPh Final
- Alert: omzet >Rp 4,8 M (tidak eligible tarif final) | omzet OP <Rp 500 juta (PPh = 0)
- **Kartu Laporan Laba Rugi (SAK EMKM):** Unduh PDF (header berwarna, tabel per pos, rekap bulanan, disclaimer) + Unduh Excel (3 sheet)
- **Kartu Rekap Pajak PPh Final 0,5% (PP 55/2022):** Unduh PDF + Unduh Excel
- **Seksi Edukasi (Accordion):** Penjelasan KUR, cara pakai laporan, pajak UMKM
- Disclaimer di bawah

---

### 27. MANAJEMEN TIM (`/app/tim`) ✅

Multi-user per akun bisnis (RBAC):
- Daftar anggota: nama, email, peran, status (aktif/pending)
- Undang anggota: email + pilih peran (Owner/Admin/Kasir/Viewer)
- Hak akses per peran: Owner full, Admin hampir semua, Kasir transaksi+stok, Viewer baca
- Ubah peran, cabut akses

---

### 28. AUDIT LOG (`/app/audit`) ✅

Riwayat aktivitas sensitif (read-only, tidak bisa diedit/dihapus):
- Tabel: Waktu, Pengguna, Jenis Aksi, Detail, Perangkat/IP
- Aksi tercatat: hapus transaksi/karyawan, bayar gaji, posting opname, ubah akses tim, ekspor data, login baru
- Filter jenis aksi + rentang tanggal

---

### 29. PENGATURAN (`/app/pengaturan`) ✅

Dibagi per seksi:

**Profil Usaha:** Nama usaha, nama pemilik, jenis usaha, telepon, tipe wajib pajak, upload logo (resize di browser)

**Kategori Transaksi:** CrudList Pemasukan | Pengeluaran (tambah, rename, hapus)

**Channel Penjualan:** CRUD channel kustom (label + ikon emoji). Channel bawaan tidak bisa dihapus.

**Aturan Auto-Kategorisasi:** Daftar keyword → kategori + jenis. Saat AI atau form mencatat transaksi, jika deskripsi cocok keyword, kategori terisi otomatis.

**Keamanan:** PIN App Lock (set/ubah/hapus), Two-Factor Auth (TOTP via Google Authenticator), daftar sesi aktif

**Nota/Invoice:** Kustomisasi tampilan faktur: nama usaha, telepon, catatan footer

**Ekspor Data:** Semua transaksi → CSV/Excel

**Hapus Akun:** Konfirmasi teks "HAPUS" + tombol merah destruktif

---

### 30. FEEDBACK (`/app/feedback`) ✅

- Pilih jenis: Bug / Permintaan Fitur / Umum
- Judul + deskripsi + rating bintang (opsional)
- Tombol Kirim + pesan terima kasih

---

### HALAMAN LEGAL ✅

- **Syarat & Ketentuan** (`/syarat`): Dokumen scrollable, accordion per seksi
- **Kebijakan Privasi** (`/privasi`): Dokumen scrollable, accordion per seksi

---

## [O — OBJEKTIF & INTERAKSI]

Lakukan redesign menyeluruh seluruh tampilan UI/UX SmartBookAI. Sebelum mulai, ajukan pertanyaan berikut satu per satu dan tunggu jawaban:

1. **ARAH VISUAL:** Modern Fintech / Warm Professional / Bold Consumer / Minimal Elegant — atau jelaskan visi sendiri.
2. **PALET:** Bolehkah keempat nilai hex di atas diubah atau dikombinasikan ulang? Ke arah mana?
3. **PRIORITAS:** Halaman mana yang paling kritis untuk didesain ulang pertama?
4. **REFERENSI:** Ada app/website yang tampilannya kamu suka sebagai acuan?
5. **BATASAN TAMBAHAN:** Ada class CSS atau komponen spesifik yang tidak boleh diubah?

Setelah semua terjawab, mulai proses redesign bertahap.

---

## [L — LANGKAH-LANGKAH]

1. Design Brief & Moodboard Verbal → konfirmasi
2. Design Token System (`:root` & `[data-theme="dark"]` di `index.css`)
3. Komponen Atom (btn, input, card, badge, modal, table, pill, alert, fab, chat-bubble)
4. App Shell: Sidebar + Topbar + Bottom Navigation + Chatbot Panel
5. Auth Screens (Login · Register · Forgot Password)
6. Landing Page
7. Dashboard (dengan AI cards)
8. AI Catat (kartu draf transaksi) + Halaman Transaksi
9. Struk AI + Import CSV
10. Inventori: Stok, PO, Opname, HPP, Supplier
11. Operasional: Papan Tugas + Rekonsiliasi + Piutang
12. HR: Karyawan, Absensi, KPI, Penggajian
13. Analisis: Radar, Reveal, Laporan
14. Manajemen: Tim, Audit, Pengaturan, Feedback
15. Quality Check: contrast, keyboard nav, mobile 375px, dark theme

Setiap langkah: **tampilkan preview → tunggu persetujuan → lanjut**.

---

## [C — REFERENSI]

- **App Shell:** Linear.app (sidebar gelap kompak, active state tegas)
- **Chatbot/AI Panel:** Intercom, Perplexity (bersih, fokus, tidak crowded)
- **Data/Tabel:** Notion (ramah, empty state encouraging)
- **Kartu AI Draft:** WhatsApp Business + Stripe (kartu konfirmasi yang jelas sebelum aksi)
- **Landing:** Vercel, Lemon Squeezy (modern, hook tajam, konversi tinggi)

**Anti-pattern yang DILARANG:**
- Gradient kripto generik
- Ilustrasi 3D mahal yang tidak relevan
- Dark mode naif (hanya ganti background tanpa adjust semua elemen)
- Teks gelap di latar gelap atau teks terang di latar terang
- Animasi berkedip atau CTA yang "berteriak"
- Fitur 🔜 coming soon ditampilkan seolah sudah live

---

## [B — BATASAN]

**TEKNIS:**
- Dilarang menambah dependency NPM baru
- Dilarang menghapus CSS variable yang masih dipakai
- Dilarang mengubah JSX yang mempengaruhi logika state/routing/API
- Tidak ada gambar/icon dari CDN eksternal
- Semua warna harus via CSS custom properties — tidak ada hex hardcode di komponen

**AKSESIBILITAS (WCAG 2.1 AA):**
- Kontras ≥ 4.5:1 (normal), ≥ 3:1 (besar & UI)
- **Latar gelap = elemen di atasnya terang. Latar terang = elemen di atasnya gelap. Tidak ada pengecualian.**
- Semua icon button: `aria-label`
- Skip link tetap ada, focus indicator tidak hilang
- Semua form field punya `<label>` terhubung

**FUNGSIONALITAS:**
- Semua 30 layar dan fitur tidak boleh dihapus atau disembunyikan
- Coming soon: badge "Segera Hadir" — bukan dihilangkan

**DESAIN:**
- Mobile 375px = prioritas sama dengan desktop 1280px
- Maks 3 font family
- Dark theme support wajib

---

## [O — OUTPUT FORMAT]

```
--- ITERASI [N]: [NAMA] ---

[REASONING]
3–5 kalimat: masalah ditemukan + keputusan desain.

[PERUBAHAN CSS]
File + kode lengkap dalam code block.

[PERUBAHAN JSX]
Diff (+ baru / - lama), atau "tidak ada".

[PREVIEW VISUAL]
HTML snippet atau ASCII mockup yang bisa langsung dirender.

[CHECKLIST AKSESIBILITAS]
☐ Contrast ≥ 4.5:1
☐ Keyboard navigable
☐ Screen reader: aria-label, role, landmark
☐ Mobile 375px
☐ Dark theme [data-theme="dark"]
☐ Latar gelap → elemen terang ✓ | Latar terang → elemen gelap ✓
☐ Coming soon badge terpasang (jika relevan)

[DEPENDENSI]
File lain terpengaruh + hal yang perlu dikonfirmasi.

--- AKHIR ITERASI ---
```

---

## [T — TAIL GENERATION]

```
---TAIL CHECK---
✓ Batasan teknis: tidak ada dependency baru, tidak ada hex hardcode
✓ Aksesibilitas: contrast ≥ 4.5:1, focus visible, aria-label lengkap
✓ Token system: semua warna via CSS custom properties
✓ Kontras: latar gelap = elemen terang | latar terang = elemen gelap
✓ Mobile: diverifikasi 375px
✓ Dark theme: diverifikasi [data-theme="dark"]
✓ Coming soon: badge "Segera Hadir" pada fitur yang belum live
Langkah aktif: [N — NAMA] | Berikutnya: [N+1 — NAMA]
Ketik "lanjut" / "revisi [catatan]" / "skip ke [halaman]"
---END TAIL---
```
