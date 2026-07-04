# BukuPintar AI — Audit Produk & Validasi Bisnis
## BAGIAN 2 dari rangkaian: Product Audit (audit kode mendalam) · Competitive Analysis

> Mode: **Reality Check.** Sumber audit: pembacaan langsung atas kode Anda (`src/`, `supabase/`, `admin-dashboard/`). Sumber kompetitor: riset web (sebagian; lihat catatan keterbatasan di bagian Kompetitor).
> Ini lanjutan Bagian 1 (Problem · Customer · Trust). Tidak mengulang isi sebelumnya.

---

## Ringkasan Bagian 2 (baca ini dulu)

**Tentang kualitas teknis — kabar baik, dan jujur:** Untuk dibangun seorang diri, ini **MVP yang rapi, nyata, dan aman**. Bukan demo. Kode bersih, terstruktur, berkomentar, dan keamanannya di atas rata-rata produk sejenis tahap awal (RLS penuh, uji penetrasi 16 serangan ditolak, kunci rahasia tidak bocor ke frontend). Anda jelas bisa membangun.

**Tapi inilah masalah terbesarnya — dan ini soal bisnis, bukan soal coding:**

> **Energi terbesar Anda dihabiskan di bagian yang salah.** Anda membangun *keluasan* (dashboard admin terpisah, forum feedback dengan moderasi & realtime, OTP telepon, kategori/channel yang bisa diedit) **sebelum** *kedalaman* di jantung nilai jual Anda: **rekonsiliasi multi-channel.** Padahal justru rekonsiliasi itulah satu-satunya alasan produk ini ada.

Tiga temuan yang harus Anda dengar:

1. **"AI"-nya tidur.** Edge Function Claude ada di repo, tapi **tidak pernah dipanggil dari aplikasi** (saya cek: tidak ada `functions.invoke` di mana pun). Hari ini produk Anda **100% rule-based** (daftar kata kunci). Branding "AI" = klaim yang belum benar.
2. **"Rekonsiliasi"-nya dangkal.** Yang ada hanya **deteksi transaksi kembar** (nominal sama + arah sama + waktu dekat). Ini **bukan** rekonsiliasi yang dibutuhkan seller: mencocokkan *"order Shopee Rp189rb"* dengan *"dana cair di bank Rp150rb setelah potongan"* dan menunjukkan ke mana Rp39rb pergi. **Pain terdalam belum tersentuh.**
3. **Onboarding terlalu panjang sebelum ada "wow".** User harus daftar (5 isian + 5 syarat password + OTP email) lalu langsung dihadapkan layar kosong → disuruh ekspor file dari bank/marketplace → upload. Momen "aha" terkunci di balik aksi paling menakutkan & paling ribet (lihat Trust Barrier, Bagian 1).

**Skor (lanjutan, kini berbasis bukti kode):**

| Dimensi | Skor | Arah | Catatan |
|---|---|---|---|
| Technical Feasibility | **82** | tinggi=baik | Sudah jadi & jalan; fondasi kuat |
| Code Quality / Maintainability | **80** | tinggi=baik | Bersih, ringkas (~3.300 baris), mudah dikembangkan |
| Security Posture (build) | **75** | tinggi=baik | RLS + pentest bagus; perlu hardening utk skala & UU PDP |
| Product Completeness (vs janji) | **56** | tinggi=baik | Luas, tapi inti (rekonsiliasi) dangkal & "AI" mati |
| Beta-readiness (pilot terkontrol) | **64** | tinggi=baik | Siap utk 10–30 user dipandu; belum utk self-serve publik |
| Competitive Pressure | **70** | **tinggi=makin berat** | Accurate Rp200rb sudah punya rekonsiliasi bank otomatis |
| Differentiation (hari ini) | **45** | tinggi=baik | Tipis; pembeda yang penting justru yang terlemah |
| Differentiation (potensi jika rekonsiliasi dibangun) | **72** | tinggi=baik | Di sinilah masa depan Anda |

---

# 5. PRODUCT AUDIT (dari source code)

## 5.1 Arsitektur & teknologi (apa adanya)

**Bentuknya:** aplikasi web satu halaman (React + Vite) yang berbicara langsung ke **Supabase** (Postgres + Auth + Storage + Realtime + Edge Function). **Tidak ada server backend buatan sendiri** — semua aturan keamanan ditegakkan di database lewat **Row Level Security (RLS)**.

**Analogi sederhana:** Supabase itu seperti **menyewa brankas + satpam + resepsionis** sekaligus (Anda tidak membangun gudang sendiri). Frontend React adalah **etalase tokonya**. Keuntungannya: murah, cepat dibangun, sedikit yang bisa rusak. Risikonya: Anda **menitipkan nyawa data ke pihak ketiga** (lihat 5.8 soal UU PDP & lokasi data).

**Tabel data (dari `schema.sql` + migrasi):** `profiles`, `transactions`, `categories`, `channels`, `categorization_rules`, `feedback`, `app_events`, `admins`, + penyimpanan file `receipts` (struk).

**Alur data inti:**
> User upload file → parser di browser (`csvImport.js`) deteksi kolom & format → kategorikan (rule-based) → user tinjau di tabel → simpan massal ke Supabase → dashboard/laporan menghitung ulang dari data itu.

Catatan penting: **hampir semua perhitungan terjadi di browser user** (lihat 5.9 — ini sumber masalah skala).

## 5.2 Fitur yang BENAR-BENAR ada (inventaris jujur)

| Fitur | Status | Kedalaman | Catatan jujur |
|---|---|---|---|
| Auth email + OTP, reset password | ✅ Jalan | Solid | Bergantung SMTP Resend; tanpa itu signup kena rate-limit & "rusak" |
| Transaksi (tambah/edit/hapus/cari/filter) | ✅ Jalan | Solid | Inti pencatatan beres |
| Import CSV/Excel (bank/QRIS/marketplace) | ✅ Jalan | **Bagus** | Parser angka & deteksi header pintar (lihat 5.5) |
| Auto-kategori | ✅ Jalan | Sedang | **Rule-based**, bukan AI. Cukup untuk kata kunci umum |
| Rekonsiliasi | ⚠️ Jalan | **Dangkal** | Hanya deteksi duplikat; bukan rekonsiliasi settlement (5.6) |
| Laporan PDF KUR & Pajak | ✅ Jalan | **Bagus** | Logika pajak PP 55/2022 benar & ada rambu pengaman (5.7) |
| Upload struk (foto/PDF) | ✅ Jalan | Sedang | Disimpan aman (path per-user, signed URL 10 mnt) |
| Pengaturan (aturan, kategori, channel) | ✅ Jalan | Berlebih | 3 lapis kustomisasi — kebanyakan untuk pemula (5.3) |
| Forum Feedback (rating, moderasi, balas admin) | ✅ Jalan | **Prematur** | Bagus secara teknis, tapi belum perlu sekarang |
| Dashboard Admin (app terpisah, analytics, realtime) | ✅ Jalan | **Prematur** | Effort besar untuk produk ~0 user |
| AI kategori via Claude (Edge Function) | 🔌 Ada tapi **MATI** | — | **Tidak pernah dipanggil app.** Klaim "AI" belum nyata |
| Forward WhatsApp / Email parser | ❌ Belum dibuat | — | Ditandai "Segera" — jujur, bagus |

## 5.3 Berguna vs over-engineered vs tak perlu (Anda minta ini secara spesifik)

**Paling berguna (jantung nilai — pertahankan & perdalam):**
- **Import + auto-kategori + Laporan KUR/Pajak.** Ini rantai nilai utama: "tumpahkan data → jadi rapi → jadi laporan berguna". Inilah produk Anda yang sesungguhnya.

**Over-engineered / prematur (Anda membangunnya terlalu dini):**
- **Dashboard Admin terpisah** (16 file, analytics, manajemen user, realtime). Berguna nanti saat ada ratusan user. Sekarang? Anda bisa lihat semua user lewat Supabase Table Editor secara gratis. *Effort ini idealnya dipakai memperdalam rekonsiliasi.*
- **Forum Feedback** dengan rating, status moderasi, balasan admin, realtime. Untuk mengumpulkan masukan dari <30 user pilot, **grup WhatsApp atau Google Form** jauh lebih cepat dan lebih jujur.
- **Tiga lapis kustomisasi** (aturan + kategori + channel semuanya bisa diedit). Pemula akan bingung; mereka mau "langsung jalan", bukan "atur dulu".
- **Infrastruktur OTP telepon (Twilio)** — belum aktif, tapi sudah dikodekan. Belum perlu.

**Tidak perlu sekarang (tunda/buang):**
- Branding & menu "AI" selama fungsinya mati. Lebih baik **jujur "otomatis berbasis aturan"** daripada "AI" yang tidak ada — kepercayaan niche kecil hancur kalau ketahuan.

**Yang HARUS diprioritaskan (dan belum):**
1. **Rekonsiliasi settlement marketplace yang sungguhan** (5.6) — ini moat Anda.
2. **Momen "aha" instan** sebelum upload (lihat 5.4 & Trust Barrier).
3. **Server-side aggregation** agar tidak jebol untuk seller volume tinggi (5.9).

## 5.4 UX & Onboarding (Anda tanya: terlalu rumit? flow panjang? langsung paham value?)

Mari telusuri jalan user baru, langkah demi langkah (dari `Register.jsx`, `App.jsx`, `Import.jsx`):

1. Klik "Coba Gratis" → form daftar: **nama usaha, nama pemilik, email, nomor telepon, password** (harus lolos **5 syarat**), + centang S&K.
2. **Verifikasi OTP email** (butuh SMTP Resend hidup; kalau tidak → gagal/rate-limit).
3. Masuk app → **layar kosong** ("belum ada data").
4. Harus ke menu **Import** → pilih channel → **keluar app, buka m-banking/Seller Center, ekspor file** → kembali → upload → tinjau tabel → simpan.
5. **Baru** sekarang dashboard menampilkan sesuatu.

**Diagnosis jujur:**
- **Terlalu panjang sebelum ada nilai.** User mengeluarkan banyak usaha & data sensitif **sebelum** melihat satu pun manfaat. Ini kebalikan dari prinsip "beri nilai dulu, minta data belakangan" (Bagian 1, 3.5).
- **Field telepon wajib di awal** padahal OTP telepon **belum aktif** — friksi tanpa guna. Minimal jadikan opsional.
- **Tidak ada jalur "lihat contoh dulu".** Anda punya `downloadSample()` (CSV contoh), tapi alurnya memutar: user harus *unduh* lalu *unggah lagi*. Seharusnya ada tombol **"Coba dengan data contoh"** yang langsung mengisi dashboard dalam 1 klik — "aha" tanpa risiko.
- **Sisi positif:** copywriting jujur, ada disclaimer, pesan error ramah ("Kode salah atau kedaluwarsa…"), tabel tinjau-sebelum-simpan (centang/ubah kategori) itu **UX yang matang**. Halaman Import sendiri (setelah file masuk) sudah bagus.

**Vonis UX:** bagus di dalam, **berat di pintu masuk**. Perbaikan onboarding = ungkit terbesar Anda, dan murah dikerjakan.

## 5.5 Kualitas data pipeline (ini salah satu bagian terbaik Anda)

`csvImport.js` lebih pintar dari kebanyakan MVP:
- **`parseAmount`** menangani banyak format Rupiah: `1.250.000`, `1,250,000`, `Rp 35.000`, `(50.000)` (kurung = minus). Bagus.
- **Deteksi baris header** menilai 15 baris pertama dan memilih yang paling "mirip header" — penting karena laporan Shopee/Tokopedia sering punya baris judul di atas tabel. Cerdas.
- **Deteksi kolom fleksibel**: debit/kredit terpisah ATAU nominal+tipe. Bagus.
- **Tanggal**: serial Excel, `dd/mm/yyyy`, fallback. **Risiko:** kalau tanggal gagal di-parse, diam-diam dipakai **tanggal hari ini** → laporan bisa salah periode tanpa user sadar. Sebaiknya tandai baris bertanggal meragukan agar user cek.

## 5.6 Realita "Reconciliation Engine" (headline Anda = mata rantai terlemah)

Ini bagian terpenting dari seluruh audit, jadi saya tajamkan.

Yang dijanjikan posisinya: *"menyatukan data multi-channel."* Yang benar-benar dikerjakan kode (`analytics.js → findDuplicateGroups`): mencari **transaksi dengan nominal sama + arah sama + waktu berdekatan**, lalu menandainya sebagai dugaan duplikat.

**Kenapa ini belum memecahkan pain sebenarnya:**
- Pain seller bukan "ada entri dobel". Pain-nya: **"uang masuk dari Shopee tidak sama dengan angka order, karena dipotong admin/komisi/ongkir — saya tidak tahu bocornya di mana."** Itu **rekonsiliasi settlement**: mencocokkan *order* ↔ *payout* ↔ *biaya*. Produk Anda belum melakukan ini.
- Contoh yang dipakai UI sendiri — *"notif WhatsApp + mutasi bank"* — **tidak bisa terjadi**, karena fitur WhatsApp belum dibuat. Jadi dalam praktik, deteksi duplikat ini **jarang aktif** (orang upload satu file dalam satu waktu, bukan dua channel berisi transaksi sama).

**Implikasi:** justru fitur yang menjadi alasan keberadaan produk ini adalah yang paling dangkal. **Kabar baiknya:** di sinilah parit pertahanan (moat) Anda. Kalau Anda bisa benar-benar mencocokkan order marketplace ↔ payout bank ↔ biaya, dan menunjukkan **"bulan ini Rp1,8 juta bocor di biaya admin Shopee"**, itu sesuatu yang BukuKas tak punya dan Accurate tak fokuskan. Itu pantas dibayar.

## 5.7 Error handling, observability, testing

- **Error handling:** wajar untuk MVP — `try/catch`, pesan ramah, ada `ErrorBoundary`, `track()` "fire-and-forget" (gagal diam-diam agar tak ganggu UX). Cukup.
- **Logika pajak (`Reports.jsx`):** ini **rapi & bertanggung jawab.** Ada rambu: kalau omzet > Rp4,8 M → peringatan "tarif final tidak berlaku"; kalau omzet < Rp500 jt (OP) → "PPh = Rp0". Disclaimer di tiap PDF. Bagus dan jujur.
- ⚠️ **Tapi laporan KUR memajang "Status: Siap diajukan ✓"** apa pun kondisinya. Ini menyentuh "mitos KUR" (Bagian 1): kesiapan laporan **bukan** jaminan lolos (SLIK OJK yang menentukan). Ganti jadi *"Laporan lengkap & siap dilampirkan"* — jangan menjanjikan kelulusan.
- **Observability:** hanya `app_events`. **Tidak ada** pemantauan error produksi (mis. Sentry) atau log server. Artinya kalau app error di HP user, **Anda buta** — tidak tahu kejadiannya. Wajib ditambah sebelum publik.
- **Testing:** `QA.md` menyebut "22/22 tes logika lulus", tapi **tidak ada file tes di repo** yang saya lihat. `pentest.mjs` nyata dan bagus. Saran: commit unit test untuk `parseAmount`, `categorize`, `findDuplicateGroups`, `taxYearly` — ini logika yang paling berbahaya kalau salah (uang & pajak).

## 5.8 Keamanan & privasi (saya beri kredit jujur, lalu peringatan jujur)

**Yang patut dipuji (jarang sebagus ini di tahap awal):**
- **RLS di semua tabel** + kebijakan "hanya pemilik" (digabung OR dengan kebijakan admin). User A tak bisa lihat data user B.
- **Kunci `service_role` hanya dipakai di skrip** (`create-admin`, `pentest`), **tidak bocor ke frontend** (saya verifikasi). `.env` ada di `.gitignore`. Password kuat (8+ dengan 4 jenis karakter). OTP email. Struk pakai **signed URL** kedaluwarsa + path per-user.
- **Admin tunggal**, hanya bisa dibuat via skrip service_role (tak bisa dari UI). Trigger anti-pemalsuan nama feedback.
- **Uji penetrasi nyata** (`pentest.mjs`): 16 percobaan akses tak-sah (baca data orang lain, eskalasi jadi admin, hapus admin, spoof user_id…) semuanya **ditolak**, + 1 kontrol positif. Ini bukti keamanan yang **serius dan langka** untuk solo dev.

**Yang harus Anda waspadai SEBELUM pegang data & uang pelanggan nyata (jangan dianggap remeh):**
1. **Admin tunggal = satu titik kiamat.** `admin_list_users()` & `admin_metrics()` membuat satu akun admin bisa membaca **email + nama usaha + seluruh volume transaksi semua user**. Kalau akun admin itu kena phishing → **bocor total**. Di mata UU PDP (Bagian 1, 3.4), ini konsentrasi risiko yang besar. Mitigasi: 2FA wajib untuk admin, akses admin ke data finansial dibatasi/di-mask, audit log akses admin.
2. **Tidak ada rate-limit/captcha pada auth.** Bisa disalahgunakan untuk spam signup/login → biaya email Resend membengkak & risiko abuse.
3. **Lokasi data (residency).** Supabase default sering di Singapura/AS. Untuk PII finansial WNI, UU PDP punya aturan transfer data lintas negara. **Cek region project Anda** & siapkan dasar hukum transfer bila di luar Indonesia.
4. **Belum ada prosedur respons kebocoran.** UU PDP mewajibkan lapor **3×24 jam**. Anda butuh rencana tertulis (siapa, lapor ke mana, template pemberitahuan user) — sebelum, bukan sesudah, insiden.
5. Minor: CORS `*` di Edge Function (sekarang mati), tak ada pemindaian/limit ukuran file struk.

Ini bukan "Anda gagal" — ini "level berikutnya" yang wajib dibereskan begitu ada uang pelanggan yang dipertaruhkan.

## 5.9 Skalabilitas & maintainability

- **Maintainability: tinggi.** Kode kecil, rapi, modular, berkomentar Bahasa Indonesia. Orang lain (atau Anda 6 bulan lagi) mudah melanjutkan. Aset nyata.
- **Skalabilitas: rendah–sedang, dan ironis.** `fetchTransactions` dibatasi **1000 transaksi**, lalu **semua perhitungan dashboard/laporan dilakukan di browser** (`summarize`, `trendDaily`, `monthlyBreakdown`…). Untuk **seller volume tinggi — yaitu pelanggan ideal Anda dari Bagian 1** — 1000 baris bisa habis dalam 1–2 bulan, dan laporan jadi tak lengkap tanpa peringatan. Impor massal ribuan baris dalam satu request juga rawan gagal.
  → **Mismatch fatal:** arsitektur saat ini pas untuk user kecil/santai, tapi **tidak pas untuk pelanggan yang paling mungkin membayar.** Solusi: pindahkan agregasi ke Postgres (view/RPC) + paginasi/impor bertahap. Tidak sulit, tapi wajib sebelum scale.
- **Tech debt:** kualitas kode rendah utang. Utang sebenarnya adalah **"scope debt"** — membangun luas sebelum dalam.

## 5.10 Vonis kesiapan (beta? terlalu mahal dioperasikan?)

- **Layak untuk beta terkontrol (10–30 user dipandu)?** **Ya** — dengan syarat: pasang SMTP Resend (kalau tidak, signup patah), perbaiki friksi onboarding, dan **Anda jadi "concierge"** (dampingi langsung). Untuk pilot, ini sudah cukup matang.
- **Layak self-serve publik?** **Belum.** Penghalang: rekonsiliasi belum benar-benar memecahkan pain, onboarding berat, buta observability, plafon skala 1000-baris.
- **Terlalu mahal dioperasikan?** **Tidak — untuk saat ini.** Karena AI mati dan tak ada OCR, biaya jalan = paket Supabase murah/gratis + hosting statis (Vercel). **Tapi** begitu Anda menyalakan AI/OCR, struktur biaya berubah drastis → ini saya bedah angka-per-angka di **Bagian 3 (Unit Economics)**.

---

# 6. COMPETITIVE ANALYSIS

> **Catatan keterbatasan & kejujuran data:** harga Mekari Jurnal & Accurate di bawah sudah terverifikasi via riset. Untuk **Majoo & Paper.id**, mesin pencari sedang bermasalah saat sesi ini, jadi **positioning saya percaya akurat, tetapi angka harga bersifat perkiraan dan wajib Anda verifikasi** ke situs resmi sebelum dipakai untuk keputusan.

## 6.1 Peta posisi (di mana semua pemain berdiri)

Bayangkan dua sumbu. Sumbu datar: **Sederhana ↔ Canggih/akuntan**. Sumbu tegak: **Pedagang mikro/tunai ↔ Seller online multi-channel**.

- **Pojok "Sederhana + Mikro/tunai":** BukuKas, BukuWarung. (Tapi keduanya **sudah pindah haluan** dari pembukuan.)
- **Pojok "Canggih + Bisnis formal":** Mekari Jurnal, Accurate Online. (Akuntansi serius, butuh paham debit-kredit.)
- **Sisi "POS retail/F&B":** Majoo. (Berbasis kasir.)
- **Sisi "Invoice & pembayaran B2B":** Paper.id.
- **Slot "Sederhana + Seller online multi-channel":** **relatif kosong.** Inilah rumah yang Anda incar. Bagus — slotnya ada. Buruknya — Anda belum benar-benar "mengisi" lewat kedalaman rekonsiliasi.

## 6.2 Bedah per kompetitor

| Pemain | Target | Kelebihan | Kelemahan | Celah yang mereka tinggalkan |
|---|---|---|---|---|
| **BukuKas** (Lummo) | Warung/mikro | Dulu pelopor, simpel | **Bangkrut 2023** | Seluruh segmen pembukuan serius ditinggal |
| **BukuWarung** | Warung/mikro → kini agen pembayaran | Basis user besar, kini fokus **EDC/Mini ATM + pinjaman** | Pembukuan jadi anak tiri | Seller online multi-channel tak digarap |
| **Mekari Jurnal** | UKM–menengah formal, akuntan | Akuntansi lengkap (SAK-EMKM), matang | **Mahal (≈Rp450rb–1,17 jt/bln)**, kurva belajar tinggi | Seller kecil yang mau "ringan & cepat" |
| **Accurate Online** | UKM, akuntan, toko | Lengkap, populer, **sudah ada rekonsiliasi bank otomatis**, mulai **≈Rp200rb/bln** | Tetap "berasa software akuntansi", bukan untuk awam multi-channel | Fokus *settlement marketplace* (gross→fee→net) belum jadi sorotan |
| **Majoo** | Retail/F&B/UMKM | **POS/kasir** + stok + karyawan + akuntansi-ringan; cocok toko fisik | Berbasis kasir, bukan penyatu marketplace+bank+e-wallet; *(harga ~perkiraan, verifikasi)* | Seller online murni multi-channel |
| **Paper.id** | UMKM/B2B | **Invoicing + pembayaran B2B**, freemium, pembiayaan | Bukan untuk rekonsiliasi penjualan ritel multi-channel | Seller ritel yang butuh "ke mana uangku setelah fee" |

## 6.3 Kenapa user akan PILIH BukuPintar — dan kenapa TIDAK

**Akan pilih (jika Anda eksekusi benar):**
- Lebih **ringan & berbahasa lokal** daripada Accurate/Mekari (tak perlu paham jurnal/debit-kredit).
- **Fokus seller online multi-channel** — incumbent tak menyasar ini secara khusus.
- **Laporan KUR & pajak instan** dalam 1 klik.
- Potensi **harga lebih murah** untuk segmen yang merasa Accurate "kemahalan/terlalu berat".

**Tidak akan pilih (rintangan nyata, jangan ditutupi):**
- **Accurate sudah Rp200rb/bln dengan rekonsiliasi bank otomatis + fitur lengkap + merek tepercaya.** Kalau pembeda Anda cuma "lebih simpel", itu tipis.
- **Seller Center marketplace sudah menampilkan ringkasan & laporan** penjualan mereka sendiri (gratis). Anda harus jelas lebih baik dari "yang sudah ada di Shopee".
- **Merek belum dikenal + minta data bank** = tembok kepercayaan (Bagian 1).
- **Rekonsiliasi belum benar-benar selesai** dan **"AI" belum nyata** — kalau calon pembeli yang teliti mengetes, janji ≠ kenyataan.

## 6.4 Diferensiasi: yang terkuat vs yang mudah ditiru

**Terkuat (defensible — INI yang harus dibangun, sesuai prinsip Skill Stacking Anda):**
> Kombinasi **rekonsiliasi settlement marketplace yang dalam** + **laporan siap-KUR/pajak** + **UX lokal untuk awam** + **kepercayaan di satu komunitas seller**. Meniru satu komponen mudah; meniru *kombinasi*-nya sulit. Inilah parit Anda — **tapi belum tergali**.

**Terlemah (komoditas, gampang ditiru siapa pun):**
- **Auto-kategori rule-based** (tinggal salin daftar kata kunci).
- **Import CSV** (semua punya).
- **Dashboard grafik generik**.
- **Label "AI"** — tanpa fungsi nyata, bukan moat; malah liabilitas kredibilitas.

## 6.5 Vonis kompetitif (jujur)

Pembeda yang **paling penting** (kedalaman rekonsiliasi) saat ini justru **paling lemah** di produk Anda. Maka **hari ini diferensiasi Anda tipis** (skor 45). Peluangnya nyata dan slot pasarnya ada, tapi **belum Anda rebut**. Tekanan kompetitif tinggi (70) — terutama dari **Accurate** yang murah, lengkap, sudah punya rekonsiliasi bank, dan dipercaya. Untuk menang, Anda **tidak bisa** bersaing sebagai "akuntansi yang lebih simpel"; Anda harus menang sebagai **"satu-satunya yang menunjukkan ke mana uang seller bocor di seluruh channel, lalu menyiapkannya jadi laporan KUR/pajak"** — sesuatu yang spesifik, sempit, dan tajam.

---

## Yang dibutuhkan untuk bagian berikutnya

Untuk **Bagian 3 (Pricing + Unit Economics + Revenue Streams)** saya tidak butuh file tambahan — saya akan menghitung dari arsitektur yang sudah saya audit (Supabase, jsPDF, rule-based vs jika AI/OCR dinyalakan). Bila Anda punya **data biaya nyata** (tagihan Supabase/Vercel/Resend bulan ini, atau estimasi harga AI/OCR yang Anda rencanakan), itu akan membuat simulasi unit economics jauh lebih presisi — opsional.

---

## Sumber (kompetitor)

- Mekari Jurnal harga (≈Rp450rb–1,17 jt/bln): jurnal.id, mas-software.
- Accurate Online (mulai ≈Rp200rb/bln, rekonsiliasi bank otomatis): hasil riset Bagian 1.
- BukuKas (Lummo) bangkrut 2023 & BukuWarung pivot (EDC/Mini ATM + BukuModal): CB Insights, BukuWarung.com.
- Majoo (POS retail/F&B) & Paper.id (invoice + pembayaran B2B): positioning dari pengetahuan industri; **harga perkiraan — verifikasi ke situs resmi.**

---

> **BERHENTI DI SINI** (token management). Ketik **LANJUT** untuk **Bagian 3: Pricing + Unit Economics (simulasi 100/500/1.000/5.000 user) + Revenue Stream Strategy** — langsung .docx.
> Sisa setelah itu: **Bagian 4** (Go-To-Market + Risk/Compliance + Final Verdict + Action Plan + 15 pertanyaan Mom Test + Concierge MVP + Friction Testing penuh + skor lengkap 13 dimensi).
