# 📊 ANALISIS STRATEGIS SMARTBOOK AI & EVALUASI KELAYAKAN PASAR

> **Basis data:** audit internal `_AUDIT/_src/00–07`, `hasil-wawancara-mom-test.md` (Juli 2026), `QA.md`, `FITUR-SISTEM-SMARTBOOKAI.md`, `Proposal-Bisnis-SmartBookAI.md`, dan graph kode (`graphify-out/`, 2.098 node / 266 file).
> **Tanggal analisis:** 2 Agustus 2026
> **Sifat:** advisory bisnis. Bagian legalitas terbatas pada prinsip perjanjian kerja sama, bukan nasihat hukum.

---

## 1. EVALUASI KELAYAKAN RILIS PASAR (GO / NO-GO ASSESSMENT)

### Status Kelayakan Pasar: **LAYAK DENGAN SYARAT — GO terbatas, NO-GO massal**

Terjemahan operasionalnya:

| Jenis rilis | Vonis | Alasan |
|---|---|---|
| **Private Beta berbayar (10–30 user, founder-led)** | ✅ **GO** — mulai bulan ini | Produk teknis siap; yang belum terbukti adalah kemauan bayar. Ini satu-satunya cara membuktikannya. |
| **Rilis publik self-serve + iklan** | 🔴 **NO-GO** | Belum ada satu pun bukti WTP. Onboarding masih panjang. Blocker legal K2 belum ditutup. |
| **Rekrut freelance sales** | 🔴 **NO-GO** (tunda 3–6 bulan) | Founder belum punya sales script yang terbukti. Detail matematisnya di Bagian 4. |

**Kalimat vonis:** produk Anda tidak gagal di sisi teknis — ia belum diuji di sisi komersial. Menunda rilis untuk memoles bug lagi adalah bentuk penghindaran dari pertanyaan yang sebenarnya menakutkan: *apakah ada orang yang mau membayar dan menyerahkan datanya?*

---

### Analisis Kebutuhan Pasar & Demand

**Sinyal negatif (harus dihadapi, bukan dirasionalisasi):**

Hasil Mom Test Juli 2026, 5 responden (4 valid):

| Responden | Skor | Pain utama yang **mereka pilih sendiri** |
|---|---|---|
| Jonathan (Agency, 3 th) | 3/10 | Behavior founder — bukan keuangan |
| Steven (Retail multi-channel, 2 th) | 2/10 | *"Stuck channel, harus buka channel baru. Tidak ada masalah urgent dari pencatatan."* |
| Olivia (Sablon, 4 th) | 1/10 | Miscommunication SOP tim. WTP eksplisit: **nol** |
| Fery (FnB Pastry, 8 bln) | 3/10 | Prediksi bahan baku + inflasi (aspirasi, bukan pain) |

**0 dari 4 masuk kategori UTAMA maupun FOLLOWUP.** Ini bukan noise — ini sinyal.

**Tapi ada tiga catatan yang menyelamatkan interpretasinya:**

1. **Sampel salah segmen.** Semua responden adalah usaha 1–2 orang tanpa stok kompleks, tanpa piutang berarti. ICP yang didesain (3–30 karyawan, stok fisik, butuh KUR) sama sekali belum diinterview. Ini kegagalan rekrutmen responden, bukan kegagalan produk.
2. **Sampel terlalu kecil.** Rob Fitzpatrick merekomendasikan 10–20 wawancara sebelum menarik kesimpulan. Anda punya 4.
3. **Responden #2 (Steven) justru membenarkan hipotesis Anda sambil menyangkalnya.** Dia bilang "tidak ada masalah urgent dari pencatatan" — padahal dia punya tim finance yang bekerja 2× sebulan dan pernah salah keputusan karena tidak tahu cashflow. Artinya: **pain-nya nyata, tapi tidak dia sadari sebagai pain.** Ini masalah pemasaran (framing), bukan masalah produk. Jangan jual "pencatatan rapi" — jual **"berapa yang bocor bulan ini"**.

**Sinyal positif dari pasar (dari audit Bagian 1–2):**

- Kuburan kompetitor membuka celah: **BukuKas bangkrut 2023**, **BukuWarung pivot ke fintech/EDC**. Segmen pembukuan serius untuk seller ditinggalkan.
- Celah harga jelas: Accurate Online ~Rp200rb/bln (terlalu "software akuntansi"), Mekari Rp450rb–1,17jt/bln (terlalu berat). Ruang Rp99–149rb kosong.
- Trigger WTP yang terikat tenggat itu nyata: **KUR dan musim pajak**. Orang bayar cepat kalau ada deadline dan uang jutaan di ujungnya.

**Peringatan dari kuburan yang sama:** BukuKas mati justru karena pembukuan murni sulit dimonetisasi. Jangan ulangi pola "bangun luas, bakar waktu, tak termonetisasi".

---

### Checklist Kriteria Go/No-Go

| # | Kriteria Validasi | Status | Catatan Evaluasi |
|---|---|---|---|
| 1 | Fitur core (import → kategori → laporan) stabil | 🟢 **LULUS** | Technical Feasibility 82/100. Pipeline CSV/Excel, RLS penuh, pentest sudah dilakukan. |
| 2 | Diferensiasi utama (Reveal Kebocoran) aktif | 🟡 **PARSIAL** | Fitur ada, tapi **H5 belum tuntas**: belum diuji end-to-end dengan file Shopee/Tokopedia/TikTok asli. Format tiap marketplace berbeda. |
| 3 | Klaim "AI" sesuai realita produksi | 🟡 **PARSIAL** | `askAI` + `readReceipt` sudah tersambung via Edge Function. Wajib pastikan ter-deploy + `ANTHROPIC_API_KEY` aktif di produksi sebelum ada mata calon pembeli. |
| 4 | Minimal 1 pelanggan membayar sukarela | 🔴 **GAGAL** | Nol. Ini blocker komersial nomor satu (K1). |
| 5 | Minimal 3 user mengulang pakai di bulan ke-2 | 🔴 **GAGAL** | Belum ada pilot. Retensi = sinyal terkuat, dan belum terukur sama sekali. |
| 6 | Identitas Pengendali Data resmi terisi | 🔴 **GAGAL — BLOCKER LEGAL** | `src/lib/legal.js`: `CONTROLLER_NAME` masih placeholder, `CONTACT_EMAIL` masih Gmail pribadi. Kebijakan privasi jadi lemah secara hukum. **Tidak boleh menerima data user nyata sebelum ini beres.** |
| 7 | Rencana respons kebocoran 3×24 jam tertulis | 🟡 **PERIKSA** | `SECURITY.md` ada di repo — verifikasi isinya sudah memuat: siapa PIC, lapor ke mana, template notifikasi user, langkah rotasi kunci. |
| 8 | Onboarding punya aha-moment < 60 detik | 🔴 **GAGAL** | H3 belum dikerjakan. User harus daftar + isi form + upload file sebelum melihat manfaat apa pun. Ini pembunuh konversi. |
| 9 | Landing memasarkan diferensiasi, bukan kategori | 🔴 **GAGAL** | H6: Reveal Kebocoran tidak muncul di landing. Hero masih generik "pembukuan otomatis" — mudah ditiru, tidak menonjol. |
| 10 | Klaim laporan tidak over-promise | 🔴 **GAGAL** | H2: status "Siap diajukan ✓" pada laporan KUR. Kelolosan KUR ditentukan SLIK OJK, bukan kerapian laporan. Ganti jadi "lengkap & siap dilampirkan". |
| 11 | Tautan legal di footer landing | 🔴 **GAGAL** | H1: regresi — footer sekarang hanya "© 2026". S&K/Privasi hilang. |
| 12 | Monitoring error produksi | 🔴 **GAGAL** | M1: belum ada Sentry. Anda akan buta saat app error di HP user. |
| 13 | Skala transaksi memadai untuk ICP | 🟡 **RISIKO** | M2: `fetchTransactions` dibatasi 1.000 baris, agregasi di browser. Seller volume tinggi — justru pelanggan ideal Anda — datanya terpotong **tanpa peringatan**. Laporan bisa salah diam-diam. |
| 14 | Kriteria kelulusan QA terpenuhi | ⚪ **BELUM DIVERIFIKASI** | `QA.md` mensyaratkan 100% P0 lulus, ≥95% P1, nol bug Blocker/Critical. Jalankan dan catat hasilnya — jangan asumsikan. |

**Skor kesiapan: 1 hijau, 4 kuning, 8 merah, 1 belum diuji.**

**Interpretasi:** yang merah hampir semuanya adalah pekerjaan **1–3 hari**, bukan 3 bulan. Ini bukan situasi "produk belum jadi" — ini situasi "produk jadi tapi belum dipasang pengamannya". Kriteria #6, #10, #11 bisa selesai hari ini juga.

**Tiga syarat mutlak sebelum GO terbatas:**

1. Tutup **K2** (identitas Pengendali Data). Ini bukan negosiasi — Anda akan memegang data finansial orang sebagai merek tak dikenal, di bawah UU PDP yang sanksinya sampai 2% omzet tahunan dan pidana 6 tahun.
2. Tutup **H1, H2, H7** (footer legal, klaim KUR, klaim AI). Total ± 3 jam kerja. Ini melindungi Anda dari liability sekaligus dari reputasi buruk.
3. Verifikasi **H5** (Reveal + AI end-to-end dengan 1 file marketplace asli). Kalau demo pembunuh Anda gagal di depan calon pembeli pertama, Anda kehilangan mereka permanen.

---

### 💡 Rekomendasi Taktis Bagian 1

- **Jangan tunggu bug-free.** Standar "tanpa bug" tidak pernah tercapai dan bukan itu yang menahan Anda. Yang menahan Anda adalah nol bukti komersial.
- **Ubah definisi "rilis".** Rilis Anda bukan tombol publik — rilis Anda adalah **10 orang yang Anda layani langsung**. Skala nanti.
- **Bekukan fitur baru (K4).** Repo menunjukkan Payroll, Absensi, PO, Stock Opname, Supplier, Invoice, Chatbot — semua ditambah sebelum ada satu pelanggan bayar. Itu pola BukuKas.

---

## 2. DEDUKSI PRODUK: FITUR, TUJUAN & TARGET AUDIENS

### Definisi Produk

**Definisi yang Anda pakai sekarang (terlalu lebar, hindari):**
> *"Platform SaaS manajemen pembukuan dan analisis bisnis berbasis AI untuk UMKM."*

Masalahnya: kalimat ini bisa dipakai BukuKas, Majoo, Accurate, dan 20 aplikasi lain. Ia tidak memberi alasan siapa pun untuk memilih Anda, dan menempatkan Anda melawan Accurate secara langsung — pertarungan yang belum bisa Anda menangkan.

**Definisi yang direkomendasikan (sempit, bisa dipertahankan):**
> **SmartBook AI menyatukan penjualan dari semua channel seller online, menunjukkan ke mana uang mereka bocor setelah potongan biaya admin/ongkir/iklan, dan menyiapkan laporannya untuk KUR & pajak.**

Perbedaannya bukan kosmetik. Definisi pertama menjual **kerapian**. Definisi kedua menjual **pengurangan kerugian**. Yang kedua punya angka, dan angka bisa dibandingkan dengan harga langganan.

**Tujuan platform (3 lapis):**

| Lapis | Tujuan | Metrik keberhasilan |
|---|---|---|
| **Jangka pendek (0–6 bln)** | Buktikan ada orang yang membayar & kembali bulan depan | ≥5 pelanggan berbayar sukarela, retensi bulan-2 ≥60% |
| **Jangka menengah (6–18 bln)** | Jadi ritual bulanan tutup buku bagi seller multi-channel | 150 pelanggan berbayar, churn bulanan <5% |
| **Jangka panjang (18 bln+)** | Pintu masuk ke fintech adjacency (referral KUR/pinjaman) | Data + kepercayaan + skala cukup untuk kemitraan lender |

---

### Matriks Fitur Kunci

Dari `FITUR-SISTEM-SMARTBOOKAI.md` dan graph kode, sistem Anda punya **±26 modul**. Berikut klasifikasi jujurnya:

| Kategori | Fitur | Status | Vonis |
|---|---|---|---|
| **🔴 CORE — alasan produk ini ada** | Import CSV/Excel multi-channel (`csvImport.js`) | Ada, kuat | Pertahankan & perdalam |
| | Auto-kategorisasi (rule-based + AI Haiku) | Ada | Pertahankan. AI hanya untuk tier berbayar |
| | **Reveal — Deteksi Kebocoran Pendapatan** (`reveal.js`) | Ada, **belum terverifikasi** | **Ini moat Anda. Prioritas #1.** |
| | Rekonsiliasi duplikat lintas channel | Ada, **dangkal** | Perdalam: order ↔ payout ↔ fee |
| | Laporan Keuangan + PDF KUR/Pajak | Ada | Perbaiki klaim (H2), pertahankan disclaimer |
| | Dashboard ringkas | Ada | Jadikan tempat aha-moment |
| **🟠 PENDUKUNG — memperkuat core** | Scan Struk (AI Vision, `readReceipt`) | Ada | Jadikan **pintu masuk onboarding** — friksinya paling ringan |
| | HPP (Harga Pokok Produksi) | Ada | Relevan untuk FnB/produksi. Simpan |
| | Piutang & Utang | Ada | Relevan untuk ICP dengan karyawan |
| | Stok & Inventaris | Ada | Simpan, jangan kembangkan lagi dulu |
| | Chatbot AI Asisten | Ada | Berguna untuk onboarding, bukan jualan |
| | Radar Harga Makro (RAG) | Ada | Menarik & unik, tapi **bukan alasan orang bayar** |
| **🟡 PREMATUR — di luar janji produk** | Payroll / Penggajian | Ada | Ini wilayah HRIS, bukan pembukuan. Sembunyikan dari pitch |
| | Absensi & Cuti | Ada | Sama seperti di atas |
| | Data Karyawan + Undang Staf | Ada | Sama |
| | Purchase Order | Ada | Wilayah ERP |
| | Stock Opname | Ada | Wilayah ERP |
| | Supplier Management | Ada | Wilayah ERP |
| | Papan Tugas Harian | Ada | Wilayah project management |
| | Invoice | Ada | Wilayah Paper.id |
| **⚪ BUANG / TUNDA** | Admin Dashboard terpisah | Ada | Ganti Supabase Table Editor sampai >100 user |
| | Forum Feedback | Ada | Ganti grup WhatsApp |
| | OTP telepon | Infrastruktur ada, tidak aktif | Tunda. Buat field telepon opsional (M3) |
| | 3 lapis kustomisasi | Ada | Sembunyikan di balik "Pengaturan lanjutan" |

**Temuan paling penting dari matriks ini:** Anda membangun **ERP UMKM** sambil memasarkan diri sebagai **aplikasi pembukuan AI**. Sembilan modul di kategori 🟡 adalah bukti scope creep yang serius — masing-masing memakan waktu yang seharusnya dipakai memperdalam Reveal.

Ini bukan berarti kode itu sia-sia. Untuk **portfolio**, ini luar biasa (skor 85/100 di audit internal). Untuk **penjualan**, ini justru melemahkan: makin banyak fitur yang Anda sebut, makin sulit calon pembeli mengerti Anda menyelesaikan masalah apa.

**Aturan praktis pitching:** sebut **maksimal 3 fitur**. Import multi-channel → Reveal kebocoran → Laporan KUR/Pajak. Selebihnya baru diperlihatkan kalau ditanya.

---

### Target Audiens Utama (ICP)

**ICP Primer — "Seller Online Multi-Channel Naik Kelas"**

| Dimensi | Kriteria |
|---|---|
| Omzet | Rp30–300 juta/bulan |
| Channel | ≥2 marketplace (Shopee/Tokopedia/TikTok/Lazada) **+** QRIS/transfer bank |
| Karyawan | 1–5 orang, minimal ada 1 admin yang mengurus data |
| Usia usaha | ≥1 tahun (sudah lewat fase bertahan hidup) |
| Trigger | Sedang/akan mengajukan KUR, atau baru "kaget" saat tutup buku |
| Perilaku | Sudah pernah bayar tools apa pun (indikator terkuat WTP) |
| Lokasi awal | Jabodetabek + kota besar, dalam komunitas yang erat (referral lebih mudah) |

**Pre-screener 3 pertanyaan** (pakai ini sebelum mengundang siapa pun wawancara — kalau ketiganya "tidak", jangan interview):

1. Apakah Anda pernah gagal/kesulitan dapat pinjaman modal karena tidak punya laporan keuangan?
2. Apakah ada karyawan/admin yang mengelola keuangan untuk Anda?
3. Dalam 3 bulan terakhir, pernahkah selisih stok atau potongan marketplace membuat Anda rugi nyata?

**ICP Sekunder — "FnB Skala Menengah"** (berdasarkan insight Fery Fernando)
Kuliner yang sudah masuk GrabFood/GoFood, punya ≥3 karyawan, bahan baku yang harganya fluktuatif. Fitur HPP + Radar Harga Makro Anda sangat relevan di sini. Fery adalah satu-satunya responden yang bisa menyebut kebutuhannya secara spesifik ("prediksi bahan baku + penyesuaian inflasi") — itu sinyal yang layak dikejar dengan 5–10 wawancara khusus.

**Anti-persona (jangan kejar sekarang):**

| Siapa | Kenapa dihindari |
|---|---|
| Warung tunai / mikro single-channel | Tidak punya masalah rekonsiliasi. Ini yang membunuh ekonomi BukuKas |
| Penghindar pajak | Justru **takut** laporan rapi |
| Gaptek | Biaya support menghabiskan margin |
| Usaha <6 bulan | Belum punya pain (terbukti dari responden Nicky) |
| Solo founder tanpa karyawan | Excel masih cukup — terbukti dari Olivia (WTP = 0) |

### 💡 Rekomendasi Taktis Bagian 2

- **Sembunyikan 9 modul 🟡 dari landing page dan demo.** Bukan hapus dari kode — hapus dari cerita.
- **Rekrut 10–15 responden baru** sesuai pre-screener. Cari di: komunitas reseller, toko bangunan, toko sembako menengah, konveksi >5 karyawan, kuliner GrabFood.
- **Follow up Fery Fernando** — tawarkan akses gratis 1 bulan. Dia satu-satunya yang aktif mencari solusi.

---

## 3. PEMETAAN KOMPETITOR, SWOT, UVP & MOAT

### Tabel Analisis SWOT

| Strength | Weakness | Opportunity | Threat |
|---|---|---|---|
| Produk full-stack **sudah jalan** & aman (RLS penuh, pentest, consent tercatat) — feasibility 82/100 | **Nol validasi komersial.** 0 pelanggan bayar, 0 retensi terukur | **Kuburan kompetitor:** BukuKas bangkrut 2023, BukuWarung pivot ke fintech → segmen ditinggalkan | **Accurate Online Rp200rb/bln** sudah punya rekonsiliasi bank otomatis + merek tepercaya |
| **Reveal Kebocoran** — sudut yang tidak digarap siapa pun di Indonesia | Rekonsiliasi masih **dangkal**; padahal itu satu-satunya pembeda yang penting | **Celah harga Rp99–149rb kosong** antara "gratis dangkal" dan "Rp200rb berat" | **Tembok kepercayaan 78/100** — minta data bank sebagai merek tak dikenal |
| Margin kotor **~88–90%** (biaya AI hanya ~2% dari harga dengan Haiku) | Onboarding panjang; aha-moment terlalu jauh → konversi rendah | **Trigger KUR & musim pajak** — WTP memuncak saat ada tenggat | **UU PDP** (berlaku 17 Okt 2024): denda 2% omzet, Rp60 M, pidana 6 tahun, lapor 3×24 jam |
| Founder = solo full-stack, iterasi cepat, biaya tetap nyaris nol | Scope creep parah: 9 modul di luar janji produk | **B2B2C:** koperasi, BUMDes, agensi enabler marketplace, konsultan pajak → pinjam kepercayaan mereka | **Tools native marketplace gratis** (Seller Center analytics) memenuhi 60% kebutuhan |
| Titik impas teknis sangat rendah: **~15–20 pelanggan** menutup biaya infra | Otot **distribusi & sales belum teruji sama sekali** (Founder Fit 70, tapi hanya di sisi build) | **Fintech adjacency** jangka panjang — referral KUR/pinjaman, jalur yang dipilih BukuWarung | **Spreadsheet + AI generik** (Gemini/ChatGPT) — disebut langsung oleh responden Steven sebagai pembanding |
| Portfolio value **85/100** — nilai ini aman apa pun hasil bisnisnya | Data terpotong diam-diam di 1.000 transaksi — merusak justru untuk pelanggan terbaik | Segmen FnB dengan HPP + Radar Harga Makro belum digarap kompetitor | Biaya support manusia — bukan server — yang akan menggerus margin saat skala |

---

### Komparasi Kompetitor

| Pemain | Segmen | Harga | Kekuatan | Kelemahan | Celah untuk SmartBook AI |
|---|---|---|---|---|---|
| **BukuKas** (Lummo) | Warung/mikro | Gratis | Dulu pelopor, simpel | **Bangkrut 2023** | Seluruh segmen pembukuan serius ditinggalkan |
| **BukuWarung** | Mikro → agen pembayaran | Gratis | Basis user besar; kini fokus EDC/Mini ATM + pinjaman | Pembukuan jadi anak tiri | Seller online multi-channel tidak digarap |
| **Mekari Jurnal** | UKM menengah formal | Rp450rb–1,17jt/bln | Akuntansi lengkap (SAK-EMKM), matang | Mahal, kurva belajar tinggi | Seller kecil yang mau ringan & cepat |
| **Accurate Online** ⚠️ | UKM, akuntan, toko | ~Rp200rb/bln | Lengkap, populer, **rekonsiliasi bank otomatis**, merek kuat | Tetap "berasa software akuntansi" | **Settlement marketplace (gross→fee→net) belum jadi sorotan mereka** |
| **Majoo** | Retail/F&B | ~perkiraan, verifikasi | POS/kasir + stok + karyawan | Berbasis kasir, bukan penyatu marketplace+bank | Seller online murni multi-channel |
| **Paper.id** | UMKM/B2B | Freemium | Invoicing + pembayaran B2B | Bukan untuk rekonsiliasi ritel multi-channel | Seller ritel yang butuh "ke mana uangku setelah fee" |
| **Spreadsheet + Gemini/ChatGPT** ⚠️ | Semua | Rp0–300rb | Fleksibel, sudah dikuasai, tidak perlu percaya siapa pun | Manual, tidak ada rekonsiliasi otomatis | **Ini kompetitor sesungguhnya di tahap awal** — disebut langsung oleh responden |
| **Tools native marketplace** ⚠️ | Seller | Gratis | Sudah ada di Seller Center, data akurat per-channel | **Hanya per-channel, tidak menyatukan** | Justru di situ celah Anda: penyatuan lintas-channel |

⚠️ = ancaman paling nyata. Perhatikan bahwa dua dari tiga ancaman utama adalah **gratis**. Ini menegaskan: Anda tidak boleh menjual "pencatatan". Anda harus menjual sesuatu yang gratis tidak bisa lakukan.

---

### Unique Value Proposition (UVP)

**Versi satu kalimat (untuk landing hero):**
> **"Omzet Rp50 juta, tapi yang masuk rekening cuma Rp43 juta. SmartBook AI menunjukkan ke mana Rp7 juta itu pergi — lalu menyiapkan laporannya untuk KUR & pajak."**

**Versi positioning (untuk pitch):**
> *Bukan software akuntansi yang ribet, bukan aplikasi catat receh. SmartBook AI menyatukan semua channel jualanmu, menunjukkan ke mana uangmu bocor, dan menyiapkannya untuk KUR & pajak.*

**Tagline pendek:** *"Lihat untung aslimu. Temukan uang yang bocor. Siap KUR & pajak."*

**Tiga alasan UVP ini bekerja:**

1. **Punya angka.** "Rp7 juta" bisa dibandingkan dengan Rp99rb/bulan. "Pembukuan rapi" tidak bisa.
2. **Menjual kerugian, bukan kerapian.** Loss aversion — orang bergerak 2× lebih kuat untuk menghindari kehilangan daripada untuk mendapat keuntungan setara.
3. **Menjawab keberatan Steven.** Dia bilang "tidak ada masalah urgent dari pencatatan". Dia benar — dan UVP ini tidak menjual pencatatan.

**Yang harus DIHENTIKAN dari copy sekarang:**

| Hentikan | Kenapa | Ganti dengan |
|---|---|---|
| "64 juta UMKM" | Memposisikan ke semua orang = tidak ke siapa pun | "Untuk seller yang jualan di ≥2 marketplace" |
| "Pembukuan otomatis" | Kategori yang sudah ada 5 pemain gratis | "Lihat ke mana uangmu bocor" |
| "Siap diajukan ✓" (laporan KUR) | Over-claim, liability — SLIK OJK yang menentukan | "Laporan lengkap & siap dilampirkan" |
| "AI" tanpa bukti | Merusak kepercayaan saat diuji | Tunjukkan output AI-nya langsung dalam demo |

---

### Competitive Moat

**Jujur dulu: hari ini Anda tidak punya moat.** Skor diferensiasi audit internal = **45/100 saat ini**, potensi **72/100**. Perbedaan 27 poin itu terletak pada satu hal yang belum Anda kerjakan.

| Kandidat moat | Kekuatan hari ini | Bisa ditiru dalam | Vonis |
|---|---|---|---|
| UI lebih simpel | Lemah | 2 minggu | ❌ Bukan moat |
| Harga lebih murah | Lemah | 1 hari (Accurate bisa turunkan harga) | ❌ Bukan moat |
| Fitur banyak (26 modul) | Lemah | — | ❌ Justru beban |
| Chatbot AI | Lemah | 1 minggu (API terbuka) | ❌ Bukan moat |
| Radar Harga Makro (RAG) | Menarik | 1–2 bulan | 🟡 Diferensiasi, bukan moat |
| **Peta biaya settlement per marketplace** (`marketplaceFees.js` + pola pencocokan order↔payout↔fee yang terakumulasi dari data nyata) | **Belum terbangun** | **Sulit — butuh volume data nyata & waktu** | ✅ **Ini moat sesungguhnya** |

**Cara membangunnya (urut):**

1. **Kuasai 1 marketplace dulu — Shopee.** Cocokkan order ↔ payout ↔ setiap komponen biaya (admin, layanan, program gratis ongkir, voucher, iklan). Akurat sampai rupiah terakhir.
2. **Kerjakan manual 20–30 kali** lewat concierge. Setiap kali Anda cocokkan manual, Anda belajar satu edge case yang tidak akan ditebak kompetitor.
3. **Kodifikasi jadi rule engine.** Sekarang akurasi Anda punya dasar empiris, bukan asumsi.
4. **Ulangi untuk Tokopedia → TikTok → Lazada.**
5. **Barulah moat terbentuk:** akurasi rekonsiliasi Anda ditopang dataset yang tidak dimiliki siapa pun, dan bertambah baik seiring pemakaian. Accurate tidak akan mengejar ini karena bukan fokus mereka; marketplace tidak akan membuatnya karena tidak mau menonjolkan biayanya sendiri.

**Moat lapis kedua (18 bulan+): switching cost + fintech.** Setelah 12 bulan riwayat keuangan tersimpan dan laporan KUR dipakai berulang, pindah aplikasi jadi mahal. Di titik itu, referral KUR/pinjaman jadi mungkin — dan di situlah uang besarnya. *Pelajaran dari kuburan: pembukuan adalah pintu, fintech adalah brankasnya.*

### 💡 Rekomendasi Taktis Bagian 3

- **Verifikasi harga Majoo & Paper.id** ke situs resmi sebelum dipakai di materi jualan. Angka di audit internal masih perkiraan.
- **Buat satu halaman perbandingan** "SmartBook AI vs Spreadsheet + AI generik" — karena itu kompetitor yang benar-benar disebut calon pelanggan.
- **Ubah hero landing minggu ini.** Ini perubahan berbiaya nol dengan dampak terbesar.

---

## 4. EVALUASI MODEL KEMITRAAN FREELANCE SALES

### Analisis Skema Profit Sharing (80:20 vs 70:30)

*(Asumsi: 80:20 = 80% perusahaan / 20% sales. Jika maksud Anda terbalik, seluruh analisis di bawah berubah drastis — konfirmasikan.)*

**Matematika yang harus Anda lihat sebelum merekrut siapa pun:**

| Parameter | Skema 80:20 | Skema 70:30 |
|---|---|---|
| Harga tier Mid | Rp99.000/bln | Rp99.000/bln |
| Komisi per pelanggan/bulan | **Rp19.800** | **Rp29.700** |
| Pelanggan aktif untuk penghasilan sales Rp3 juta/bln | **152 pelanggan** | **101 pelanggan** |
| Realita akuisisi high-trust B2B (3 demo/minggu, konversi 10%) | ±1,2 pelanggan baru/bulan | ±1,2 pelanggan baru/bulan |
| **Waktu mencapai target penghasilan** | **≈ 10 tahun** | **≈ 7 tahun** |

**Kesimpulan tanpa dibungkus: kedua skema tidak bisa dijalankan.** Ini bukan soal memilih rasio yang lebih adil — ini soal **basis komisinya terlalu kecil untuk model recurring pada ARPU Rp99rb.**

Freelancer akan berhenti di bulan kedua. Bukan karena tidak loyal, tapi karena bulan pertama mereka menghasilkan Rp20.000–60.000, dan mereka punya sewa yang harus dibayar.

**Kesalahan konseptualnya:** bagi hasil recurring 20–30% adalah standar untuk SaaS ber-ARPU **jutaan rupiah** (enterprise), di mana satu closing = komisi Rp2–10 juta/bulan. Pada ARPU Rp99rb, model ini secara aritmetika mustahil.

---

### Pro & Kontra Model Freelance Sales

| ✅ Kelebihan | ❌ Kekurangan (untuk kondisi Anda hari ini) |
|---|---|
| Biaya tetap nol — bayar hanya saat ada hasil | **Founder belum punya sales script yang terbukti.** Freelancer tidak bisa menjual sesuatu yang Anda sendiri belum pernah berhasil jual. Anda akan membakar 10 freelancer untuk belajar apa yang seharusnya Anda pelajari sendiri dari 10 percakapan |
| Jangkauan geografis lebih luas | **Produk ini meminta kepercayaan tertinggi** (data finansial). Perantara pihak ketiga yang tidak Anda kenal justru **menurunkan** kepercayaan, bukan menaikkan |
| Bisa uji beberapa segmen paralel | **Risiko UU PDP.** Sales yang menerima file CSV/mutasi calon pelanggan = pemrosesan data pribadi tanpa dasar hukum. Tanggung jawabnya jatuh ke Anda sebagai Pengendali Data |
| Cocok untuk produk transaksional sekali bayar | **Risiko over-claim.** Sales yang butuh closing akan bilang "dijamin lolos KUR" atau "AI-nya bisa segalanya". Komplainnya masuk ke Anda |
| Bisa jadi channel referral organik | **Anda kehilangan mesin pembelajaran tercepat.** Founder-led sales di 12 bulan pertama bukan soal hemat biaya — itu satu-satunya cara tahu kata-kata persis yang membuat orang bilang "ya" |
| | **Support load.** Sales tidak menangani onboarding. Setiap pelanggan mereka tetap Anda yang layani |

---

### Rekomendasi Rasio & Model Ideal

**Rekomendasi utama: JANGAN rekrut freelance sales sekarang. Tunda 3–6 bulan.** Prasyaratnya jelas: **setelah Anda sendiri berhasil menutup 10 pelanggan berbayar dan punya script yang terbukti.** Sebelum itu, freelance sales adalah cara mahal untuk menunda pembelajaran.

**Jika tetap ingin jalan — inilah desain yang secara matematis masuk akal:**

#### Opsi A ⭐ (Rekomendasi) — Freelancer menjual **Paket per-event**, bukan langganan

Produk yang paling cocok untuk freelance sales adalah **Paket Laporan Siap-KUR/Pajak (Rp199.000 sekali bayar)**, bukan langganan. Alasannya:

- Transaksional — tidak butuh kepercayaan jangka panjang
- Terikat tenggat — WTP memuncak, siklus penjualan pendek
- Komisi 35% = **Rp70.000 per closing**, dibayar sekali dan langsung
- Sales bisa menghasilkan Rp2,8 juta dengan 40 closing/bulan — agresif tapi tidak absurd
- Pelanggan per-event yang puas → jadi corong langganan yang Anda tangani sendiri

| Komponen | Angka |
|---|---|
| Harga paket | Rp199.000 |
| Komisi sales | 35% = **Rp70.000** |
| Margin kotor Anda setelah komisi | ±Rp120.000 (60%) |
| Clawback | Penuh jika pelanggan refund <14 hari |

#### Opsi B — Bounty + recurring kecil (untuk langganan)

| Komponen | Angka | Alasan |
|---|---|---|
| **Bounty per pelanggan aktif** | Rp250.000 | Dibayar setelah pelanggan **membayar bulan ke-2** (bukan saat tanda tangan). Menyaring closing paksaan |
| **Recurring** | 10% seumur pelanggan (Rp9.900/bln) | Insentif menjaga retensi, bukan sekadar closing |
| **CAC efektif Anda** | ±Rp350.000 termasuk recurring tahun pertama | |
| **LTV** (retensi 12 bln, margin 88%) | ±Rp1.045.000 | |
| **LTV/CAC** | **≈ 3,0×** | Di ambang sehat. Di bawah ini, hentikan |
| **Clawback** | 100% bounty jika churn <3 bulan | Melindungi dari closing berkualitas rendah |

#### Yang harus dihindari mutlak

| ❌ Jangan | Kenapa |
|---|---|
| Bagi hasil recurring 20–30% tanpa bounty | Terbukti mustahil secara aritmetika (tabel di atas) |
| Bayar komisi saat *sign-up*, bukan saat *bayar* | Mengundang akun palsu & closing paksaan |
| Memberi sales akses ke akun produksi user | Pelanggaran UU PDP langsung. Sediakan **akun demo terisolasi** |
| Sales dengan target tanpa batasan klaim | Over-claim "dijamin lolos KUR" = liability Anda |
| Merekrut >3 orang di gelombang pertama | Anda belum bisa melatih, memantau, atau menyuplai lead |

---

### Rekomendasi Alur Onboarding & Perjanjian (TTD)

**Alur 6 tahap:**

| Tahap | Kegiatan | Output |
|---|---|---|
| **1. Seleksi** | Cari yang punya **akses ke komunitas seller/UMKM**, bukan yang berpengalaman sales umum. Jaringan > teknik | 3–5 kandidat |
| **2. Perjanjian (TTD)** | Tanda tangan **sebelum** akses apa pun diberikan | 3 dokumen (di bawah) |
| **3. Pelatihan** | 2 sesi × 2 jam: (a) produk + demo Reveal, (b) script, objection handling, **batasan klaim** | Kit tertulis |
| **4. Sertifikasi** | Mock demo di depan Anda. Wajib lulus sebelum bertemu prospek nyata | Lulus / ulang |
| **5. Akses terbatas** | Akun demo terisolasi + materi + link tracking. **Bukan** akun produksi | Kredensial demo |
| **6. Masa percobaan 30 hari** | Target: 12 demo, minimal 2 closing. Evaluasi & lanjut/berhenti | Keputusan |

**Tiga dokumen yang wajib ditandatangani** *(prinsip dasar — verifikasi final dengan konsultan hukum):*

| Dokumen | Isi pokok |
|---|---|
| **1. MoU / Perjanjian Kemitraan** | **Status: mitra independen, bukan karyawan** (hindari implikasi UU Ketenagakerjaan). Ruang lingkup: mencari & memperkenalkan prospek. Skema & jadwal pembayaran komisi. Definisi "pelanggan aktif". Klausul **clawback**. Durasi + cara mengakhiri. Bukan eksklusif |
| **2. NDA** | Kerahasiaan: harga internal, roadmap, daftar prospek, materi pelatihan. Berlaku setelah kerja sama berakhir |
| **3. Adendum Perlindungan Data & Batasan Klaim** | **(a)** Mitra **dilarang menerima, menyimpan, atau meneruskan file keuangan calon pelanggan** — semua upload dilakukan sendiri oleh calon pelanggan. **(b)** Daftar klaim terlarang: "dijamin lolos KUR", "pasti akurat 100%", "data dijamin tidak akan bocor". **(c)** Kewajiban menyebut status **beta**. **(d)** Konsekuensi pelanggaran: pemutusan + clawback |

Poin (a) di dokumen ketiga adalah yang paling sering dilupakan dan paling berbahaya. Di bawah UU PDP, Anda adalah Pengendali Data — apa pun yang dilakukan mitra terhadap data calon pelanggan menjadi tanggung jawab Anda.

### 💡 Rekomendasi Taktis Bagian 4

- **Bulan 1–3: founder-led saja.** Target Anda 10 pelanggan berbayar hasil tangan sendiri.
- **Rekam setiap percakapan penjualan** (dengan izin). Dari 10 rekaman itulah script yang bisa diajarkan akan lahir.
- **Baru di bulan 4:** rekrut **2 orang** dengan Opsi A (paket KUR). Evaluasi 30 hari sebelum menambah.

---

## 5. STRATEGI PEMASARAN PRA-RILIS (PRE-LAUNCH STRATEGY)

### Kelayakan Promosi Saat Stage Development

**Vonis: BISA — bahkan HARUS. Tapi yang dipromosikan bukan produknya.**

**Alasan harus mulai sekarang:**

1. **Anda punya 0 pelanggan dan 0 audiens.** Menunggu produk sempurna berarti hari peluncuran Anda berbicara ke ruangan kosong. Membangun audiens butuh 2–3 bulan — jalankan paralel dengan QA.
2. **Segmen ini tidak convert lewat funnel otomatis.** Mereka convert lewat bukti manusia dan waktu. Waktu itu harus dimulai sekarang.
3. **Data validasi Anda masih nol.** Promosi pra-rilis yang benar **adalah** aktivitas validasi. Setiap orang yang mendaftar waitlist adalah data.

**Alasan tidak boleh promosi produk secara terbuka:**

1. **K2 belum ditutup** — identitas Pengendali Data masih placeholder. Menarik traffic ke aplikasi yang meminta data finansial dengan kebijakan privasi lemah = risiko UU PDP.
2. **H5 belum diverifikasi** — kalau Reveal gagal di demo pertama, Anda kehilangan calon pembeli itu permanen. Reputasi tidak punya tombol undo.
3. **Onboarding masih menyakitkan (H3)** — traffic yang masuk sekarang akan bounce, dan Anda membakar audiens yang mahal dikumpulkan.

**Aturan pengaman: promosikan MASALAH, bukan PRODUK.** Konten tentang "ke mana uang seller bocor" bisa Anda sebarkan hari ini tanpa risiko apa pun. Ia membangun audiens, menguji pesan, dan mengumpulkan lead — tanpa satu pun janji yang bisa Anda langgar.

---

### Taktik Promosi Pre-Launch yang Aman

*(Semua disusun untuk anggaran bootstrapped — biaya total < Rp1 juta)*

#### Taktik 1 — "Audit Kebocoran Gratis" (prioritas tertinggi)

Bukan promosi produk. Anda menawarkan **jasa manual gratis**: seller mengirim laporan Shopee/Tokopedia 1 bulan via WhatsApp, Anda olah (pakai app sendiri sebagai alat internal), kembalikan **1 halaman PDF** berisi satu kalimat tajam:

> *"Omzet kotor Rp50 juta. Setelah biaya admin + ongkir + iklan, bersihnya Rp43 juta. Ini Rp7 juta-nya pergi ke mana."*

| Aspek | Detail |
|---|---|
| Biaya | Rp0 (hanya waktu Anda) |
| Target | 10 audit dalam 30 hari |
| Kenapa aman | Tidak ada janji produk, tidak ada akun dibuat, tidak ada data disimpan di sistem |
| Yang Anda dapat | Data pola nyata (bahan moat), testimoni, 10 kandidat pelanggan pertama, dan jawaban atas K1 |
| CTA | *"Kalau berguna, saya sedang bangun alat yang melakukan ini otomatis — mau saya kabari?"* |

Ini sekaligus **Concierge MVP** dan **mesin pemasaran**. Satu aktivitas, dua hasil.

#### Taktik 2 — Konten "Reveal" (TikTok/Instagram Reels)

Format 30–45 detik, angka disamarkan, sudut pandang edukasi:

- *"Kenapa omzet Rp50 juta cuma jadi Rp43 juta di rekening — 5 potongan yang tidak kamu hitung"*
- *"3 biaya Shopee yang paling sering seller lupa masukkan ke harga jual"*
- *"Cara cek berapa persen omzetmu dimakan iklan marketplace"*

| Aspek | Detail |
|---|---|
| Frekuensi | 3×/minggu, 12 video/bulan |
| Biaya | Rp0 — screen recording + suara Anda |
| Kenapa aman | **Nol klaim produk.** Kalau app crash besok, konten ini tidak terdampak |
| Metrik | Save + share > views. Save = "ini relevan untuk saya" |

#### Taktik 3 — Landing Page "Beta Tertutup" dengan pembingkaian jujur

Ganti CTA dari "Daftar Sekarang" menjadi **"Gabung Daftar Tunggu Beta"**, dengan blok jujur di bawahnya:

> **Apa yang sedang kami bangun** — alat yang menunjukkan ke mana uangmu bocor di semua channel jualan.
> **Status:** beta tertutup, 20 seller pertama.
> **Yang belum sempurna:** kami masih menyempurnakan pencocokan data untuk sebagian format marketplace. Kamu akan tahu persis apa yang bekerja dan apa yang belum.
> **Yang kami janjikan:** harga pendiri Rp49rb/bulan seumur langganan, dan akses langsung ke saya (founder) via WhatsApp.

Kejujuran ini bukan kelemahan — ia adalah **strategi manajemen ekspektasi**. Kalau nanti ada bug, Anda sudah memberi tahu. Kalau ternyata mulus, Anda melampaui ekspektasi. Ditambah, "20 seller pertama" menciptakan kelangkaan yang jujur.

Wajib ada di halaman ini: tautan Kebijakan Privasi + S&K (perbaiki H1 dulu), dan blok **"Apa yang TIDAK kami lakukan dengan datamu"** dalam bahasa awam.

#### Taktik 4 — Build in Public (LinkedIn / X / Threads)

Posting 2×/minggu tentang proses, bukan produk: temuan dari audit gratis, keputusan sulit (*"kenapa saya matikan 9 fitur yang sudah saya bangun"*), angka yang mengejutkan.

| Kenapa efektif | Kenapa aman |
|---|---|
| Membangun kepercayaan pada **orangnya** dulu — persis yang dibutuhkan produk data finansial | Bug menjadi bagian dari cerita, bukan kegagalan yang disembunyikan |
| Menarik kandidat mitra & advisor | Nol janji produk |

#### Taktik 5 — Kemitraan B2B2C (pinjam kepercayaan)

Empat pintu yang sudah punya basis seller yang mempercayai mereka:

| Mitra | Tawaran ke mereka |
|---|---|
| **Konsultan pajak / akuntan UMKM** | "Klien Anda kirim data berantakan. Saya bereskan gratis untuk 5 klien pertama Anda" |
| **Agensi enabler marketplace** | Laporan kebocoran sebagai layanan tambahan untuk klien mereka |
| **Komunitas/grup seller** | Workshop gratis 60 menit: "Menghitung untung asli di marketplace" |
| **Koperasi / BUMDes** | Laporan siap-KUR untuk anggota |

Ini akselerator akuisisi termurah yang tersedia untuk Anda. Satu konsultan pajak bisa membuka 20 seller sekaligus.

#### Taktik 6 — Lead magnet tanpa risiko

**Kalkulator Kebocoran Marketplace** — halaman statis, tanpa login, tanpa penyimpanan data. User isi: omzet, marketplace, kategori produk → keluar estimasi potongan bulanan. CTA: gabung waitlist.

| Kenapa ini cerdas | |
|---|---|
| Nol risiko PDP | Tidak ada data disimpan sama sekali |
| Nol risiko reputasi | Terpisah dari aplikasi utama; app down tidak berpengaruh |
| Sangat bisa dibagikan | Orang menyebarkan kalkulator, bukan brosur |
| Menghasilkan lead terkualifikasi | Yang mengisi = punya masalah yang Anda selesaikan |

---

### Protokol Pengaman Reputasi (wajib sebelum orang luar menyentuh app)

| # | Pengaman | Alasan |
|---|---|---|
| 1 | Label **"Beta"** terlihat jelas di dalam app | Ekspektasi diatur sejak awal |
| 2 | **Jangan minta mutasi bank di fase beta** | Friksi tertinggi + risiko tertinggi. Cukup CSV marketplace |
| 3 | Kanal WhatsApp langsung ke founder | Keluhan masuk ke Anda, bukan ke publik |
| 4 | **Sentry terpasang (M1)** sebelum user pertama | Anda harus tahu error sebelum user memberitahu |
| 5 | Ekspor data manual mingguan | Jaring pengaman jika terjadi kehilangan data |
| 6 | Tidak pernah menyebut tanggal peluncuran publik | Tanggal yang meleset merusak kepercayaan lebih dari keterlambatan diam |
| 7 | Kuota beta jelas ("20 seller") | Membatasi beban support & menciptakan kelangkaan jujur |
| 8 | Semua klaim AI = yang benar-benar aktif (H7) | Klaim yang gagal saat diuji = kepercayaan hilang permanen |

### 💡 Rekomendasi Taktis Bagian 5

- **Jangan pasang iklan berbayar.** Orang tidak menyerahkan data keuangan karena melihat iklan. Anggaran iklan di tahap ini = uang dibakar.
- **Ukur SAVE, bukan VIEW.** Satu save dari seller yang tepat lebih berharga dari 10.000 view.
- **Satu aset visual yang wajib ada: screenshot layar Reveal.** Itu satu-satunya gambar yang menjual dirinya sendiri.

---

# 🎯 3 LANGKAH KONKRET MINGGUAN (7 HARI KE DEPAN)

> Prinsip: **berhenti menambah fitur.** Semua di bawah adalah validasi, penutupan risiko, dan distribusi.

### 🔴 LANGKAH 1 — Tutup blocker legal & klaim (Hari 1–2, ±4 jam kerja)

Empat perbaikan yang semuanya berbiaya nol dan menghilangkan risiko terbesar Anda:

| Aksi | File | Waktu |
|---|---|---|
| Isi `CONTROLLER_NAME` dengan identitas/badan usaha resmi; ganti `CONTACT_EMAIL` ke email domain usaha (bukan Gmail pribadi); naikkan `TERMS_VERSION` | `src/lib/legal.js` | 30 mnt |
| Kembalikan tautan `/ketentuan` + `/privasi` di footer + kalimat *"SmartBook AI adalah alat bantu pencatatan, bukan nasihat keuangan/pajak/hukum."* | `src/pages/Landing.jsx` | 30 mnt |
| Ganti "Siap diajukan ✓" → **"Laporan lengkap & siap dilampirkan"** | `src/pages/Reports.jsx` | 15 mnt |
| Verifikasi `SECURITY.md` memuat rencana respons kebocoran 3×24 jam (PIC, alur lapor, template notifikasi user, langkah rotasi kunci) | `SECURITY.md` | 45 mnt |

**Kriteria selesai:** tidak ada satu pun klaim di produk yang tidak bisa Anda pertanggungjawabkan secara hukum.

---

### 🔴 LANGKAH 2 — Jalankan 5 "Audit Kebocoran Gratis" (Hari 2–7)

Ini menjawab K1 — risiko terbesar di seluruh audit — sekaligus memverifikasi H5.

| Hari | Aksi |
|---|---|
| **Hari 2** | Susun daftar 30 seller yang bisa Anda jangkau (jaringan pribadi, grup WA/Telegram Shopee & TikTok Seller, komunitas UMKM). Saring dengan pre-screener 3 pertanyaan (Bagian 2) |
| **Hari 3** | Kirim 15 pesan WhatsApp. Template: *"Halo [nama], saya sedang riset soal biaya tersembunyi di marketplace. Boleh saya bantu hitungkan berapa yang terpotong dari omzet Anda bulan lalu? Gratis, hasilnya saya kirim 1 halaman. Tidak ada jualan."* |
| **Hari 4–6** | Terima file, olah lewat SmartBook AI sebagai alat internal, cocokkan manual bagian yang belum otomatis, kirim balik 1 halaman + **satu kalimat tajam** |
| **Hari 7** | Catat per orang: angka kebocoran yang ditemukan, reaksi emosional, apakah mereka bertanya lebih lanjut, apakah mereka menyebut angka WTP spontan |

**Kriteria selesai:** 5 audit terkirim. Minimal 2 orang bereaksi kuat terhadap angkanya.
**Bonus penting:** setiap audit ini menguji Reveal dengan file marketplace asli — H5 tervalidasi sebagai efek samping, dan setiap edge case yang Anda temukan adalah batu bata pertama moat Anda.

---

### 🔴 LANGKAH 3 — Ubah hero landing + posting 3 konten Reveal (Hari 3–7)

| Aksi | Detail |
|---|---|
| **Ganti hero landing** | Dari "pembukuan otomatis untuk 64 juta UMKM" → *"Omzet Rp50 juta, yang masuk rekening Rp43 juta. Ke mana Rp7 juta-nya?"* + screenshot layar Reveal + CTA **"Gabung Daftar Tunggu Beta"** (`src/pages/Landing.jsx`) |
| **Tambah blok transparansi** | "Apa yang TIDAK kami lakukan dengan datamu" — bahasa awam, 3 poin |
| **Posting 3 video** | 30–45 detik, angka dari audit nyata (disamarkan), format edukasi tanpa klaim produk |
| **Aktifkan waitlist** | Google Form cukup. Jangan bangun sistem waitlist |

**Kriteria selesai:** hero baru live, 3 konten terbit, ≥10 orang di daftar tunggu.

---

## ⛔ Yang TIDAK Boleh Dikerjakan Minggu Ini

| Jangan | Alasan |
|---|---|
| Menambah fitur baru apa pun | K4. Scope creep adalah pola yang membunuh BukuKas |
| Merekrut freelance sales | Matematikanya belum jalan (Bagian 4). Tunggu 10 closing tangan sendiri |
| Memasang iklan berbayar | Segmen ini tidak convert dari iklan |
| Menyempurnakan Admin Dashboard / Forum Feedback | Prematur untuk 0 user. Pakai Supabase Table Editor + grup WA |
| Membangun rekonsiliasi untuk 4 marketplace sekaligus | Kuasai Shopee dulu sampai akurat, baru meluas |
| Mengejar "bug-free" sebelum GO terbatas | Standar itu tidak pernah tercapai, dan bukan itu yang menahan Anda |

---

## Penutup

Anda sudah menyelesaikan bagian yang paling banyak orang gagal lakukan: membangun produk nyata yang aman, dengan RLS penuh, consent tercatat, dan pentest yang benar-benar dijalankan. Nilai portfolio-nya 85/100 dan itu tidak bisa diambil siapa pun, apa pun hasil bisnisnya.

Tapi membangun bukanlah taruhannya. **Distribusi dan kepercayaan adalah taruhannya.**

Risiko terbesar Anda hari ini bukan "produk kurang fitur" — justru sebaliknya. Anda punya 26 modul dan nol pelanggan. Setiap fitur baru yang Anda tambahkan minggu ini adalah cara yang sangat produktif-terasa untuk menghindari satu pertanyaan yang menakutkan:

> *Apakah ada orang yang sungguh-sungguh mau membayar dan menyerahkan datanya?*

Jawab itu bulan ini — dengan 5 audit gratis dan 10 percakapan, bukan dengan kode. Kalau jawabannya ya, walau hanya dari 3 orang yang membayar tulus dan merekomendasikan ke temannya, Anda punya bisnis. Kalau tidak, Anda baru saja menghemat 6 bulan hidup Anda dan tetap memegang portfolio yang kuat.

Dua-duanya kemenangan. Yang bukan kemenangan adalah menunda pertanyaannya selama 6 bulan lagi.

---

### Catatan Keterbatasan Analisis

| Hal | Status |
|---|---|
| Harga Accurate Online & Mekari Jurnal | Terverifikasi (riset audit internal) |
| Harga Majoo & Paper.id | **Perkiraan — wajib diverifikasi ke situs resmi** |
| Biaya AI (Claude Haiku) & Supabase | Terverifikasi (halaman harga resmi, Juni 2026) |
| Biaya OCR & kurs USD–IDR | Estimasi |
| Sampel Mom Test | 4 responden valid — **belum representatif**, dan dari segmen yang salah |
| Skema komisi & bagi hasil | Model matematis berdasarkan asumsi konversi 10% dari demo — **uji dengan data Anda sendiri** |
| Aspek legal (MoU/NDA/PDP) | Prinsip dasar perjanjian kerja sama. **Bukan nasihat hukum** — verifikasi final dengan konsultan hukum sebelum tanda tangan |
| Estimasi pajak | Mengacu PP 55/2022 — verifikasi resmi dengan DJP/konsultan pajak |
