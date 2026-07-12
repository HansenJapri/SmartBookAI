# Panduan Validasi Pasar — SmartBookAI vs LocalAgent
**Dokumen kerja untuk wawancara Mom Test dengan pemilik UMKM**  
Versi 1.1 · Juli 2026 — Revisi pasca audit kritis

> **Tujuan dokumen ini:** Membantu Anda melakukan wawancara Mom Test yang terstruktur untuk menjawab satu pertanyaan bisnis krusial: *Apakah pemilik UMKM benar-benar butuh software yang Anda bikin — dan kalau butuh, yang mana?*

---

## DAFTAR ISI

1. [Profil Kedua Software](#1-profil-kedua-software)
2. [Perbandingan Cepat (Untuk Pewawancara)](#2-perbandingan-cepat-untuk-pewawancara)
3. [Panduan Wawancara Mom Test](#3-panduan-wawancara-mom-test)
4. [Sistem Penilaian Urgency & Niat Beli](#4-sistem-penilaian-urgency--niat-beli)
5. [Cara Menginterpretasikan Hasil](#5-cara-menginterpretasikan-hasil)
6. [Template Catatan Per Responden](#6-template-catatan-per-responden)
7. [Tabel Tabulasi 10 Responden](#7-tabel-tabulasi-10-responden)

---

## 1. PROFIL KEDUA SOFTWARE

### 1.1 SmartBookAI (BukuPintar)

**Deskripsi singkat:**
Aplikasi web pembukuan & manajemen bisnis untuk UMKM. Cloud-based (Supabase), bisa diakses dari browser mana saja. Model bisnis: subscription bulanan. Targetnya adalah UMKM yang butuh catatan keuangan rapi — untuk keperluan KUR, pajak, tracking stok, dan piutang.

**Fitur yang sudah ada & berfungsi:**

| Modul | Fitur | Status |
|---|---|---|
| **Autentikasi** | Daftar & login email/password, Row Level Security | ✅ Live |
| **Transaksi** | Tambah, edit, hapus, cari, filter; per user terisolasi | ✅ Live |
| **Import CSV/Excel** | Upload mutasi bank, ekspor Shopee/Tokopedia; auto-parse kolom | ✅ Live |
| **Auto-kategorisasi** | Rule-based (PLN, QRIS, Shopee, Grab, dll.); bisa tambah aturan sendiri | ✅ Live |
| **Reconciliation** | Deteksi duplikat lintas-channel (notif WA + mutasi bank) | ✅ Live |
| **Dashboard** | KPI real-time, tren arus kas, sumber pemasukan, pengeluaran per kategori | ✅ Live |
| **Laporan PDF** | Laporan KUR (L/R + arus kas), Rekap Pajak PPh Final 0,5% | ✅ Live |
| **Piutang/Utang** | Tracking transaksi belum lunas, umur piutang (aging), pengingat WA | ✅ Live |
| **Purchase Order** | Alur PO: Draf → Disetujui → Diterima (stok bertambah otomatis) | ✅ Live |
| **Stok & Inventory** | Kelola produk, stok minimum, alert stok rendah | ✅ Live |
| **Stock Opname** | Rekonsiliasi stok fisik vs sistem | ✅ Live |
| **Supplier** | Manajemen data supplier, terhubung ke PO | ✅ Live |
| **HPP** | Hitung Harga Pokok Penjualan per produk | ✅ Live |
| **Target/Goal** | Set target omzet, tracking progress, proyeksi (regresi) | ✅ Live |
| **AI Insights** | Narasi AI (via Claude) atas data dashboard | ✅ Live |
| **Multi-user/Team** | Undang anggota tim, manajemen akses | ✅ Live |
| **Audit Log** | Rekam jejak perubahan data | ✅ Live |
| **Struk** | Cetak/bagikan struk transaksi | ✅ Live |
| **Multi-bahasa** | UI tersedia dalam beberapa bahasa | ✅ Live |
| **Admin Dashboard** | Panel admin untuk monitor semua user & transaksi | ✅ Live |
| **Forum Feedback** | User bisa kasih rating & masukan langsung di app | ✅ Live |
| **Edukasi KUR & Pajak** | Penjelasan syarat KUR dan PPh Final UMKM di halaman Laporan | ✅ Live |

**Masalah yang ada (gap & isu nyata):**
- Tidak ada AI analitik lintas channel secara mendalam — hanya narasi singkat, bukan rekomendasi actionable harian
- Tidak ada integrasi langsung ke marketplace (Shopee/Tokopedia) atau aplikasi pesan-antar (GoFood/GrabFood) — data masih perlu diimport manual via CSV
- Tidak ada notifikasi push/WhatsApp otomatis untuk ringkasan harian
- Model subscription berpotensi terkendala oleh resistensi UMKM terhadap biaya berulang
- Tidak ada mode offline — butuh koneksi internet
- Data tersimpan di cloud (Supabase) — bisa jadi hambatan bagi UMKM yang khawatir privasi data

**Masalah yang diselesaikan:**

| Masalah UMKM | Cara SmartBookAI Menyelesaikannya |
|---|---|
| "Saya ga tau kondisi keuangan usaha saya" | Dashboard real-time: KPI, arus kas, laba-rugi langsung kelihatan |
| "Susah bikin laporan kalau tiba-tiba bank/investor minta" | Laporan KUR & pajak bisa di-generate PDF dalam hitungan detik |
| "Rekap mutasi bank makan waktu lama" | Import CSV/Excel langsung dari file ekspor bank/marketplace |
| "Saya ga tau mana transaksi yang dobel" | Reconciliation engine otomatis deteksi duplikat |
| "Piutang ke customer sering lupa ditagih" | Modul aging piutang + kirim pengingat via WhatsApp langsung dari app |
| "Stok sering ga cocok antara catatan dan kenyataan" | Stock opname + purchase order yang update stok otomatis |
| "Bingung berapa HPP produk saya" | Modul HPP per produk |
| "Butuh laporan pajak tapi ga paham PPh" | Rekap PPh Final UMKM 0,5% siap lapor + penjelasan edukatif |
| "Kalau karyawan bisa akses, takut datanya kacau" | Multi-user dengan role + audit log semua perubahan |

---

### 1.2 LocalAgent (PT Sovralytics Tech)

**Deskripsi singkat:**
Asisten bisnis ber-AI yang berjalan **100% lokal** di server/VPS milik pemilik usaha. Bukan aplikasi cloud — data tidak pernah keluar perangkat. Setiap pagi, sistem merangkum data penjualan yang diinput pemilik, menganalisisnya dengan AI lokal (Ollama), lalu menyajikan **1 ringkasan + 1 rekomendasi** di dashboard (opsional dikirim ke WhatsApp). Model bisnis: **bayar sekali, tanpa langganan**. Target utama: pemilik warung F&B / coffee shop independen yang jualan di banyak channel (kasir + GoFood + GrabFood + WhatsApp).

**Fitur yang sudah ada & berfungsi (Increment 1 — lulus 28 tes):**

| Modul | Fitur | Status |
|---|---|---|
| **Input penjualan harian** | Form manual (agregat per channel: POS, GoFood, WA, dll.) | ✅ Live |
| **Import CSV** | Upload data penjualan dari file CSV | ✅ Live |
| **AI Digest harian** | Ringkasan + analisa + 1 rekomendasi AI (Ollama lokal `gemma3n:e4b`) | ✅ Live |
| **Dashboard** | Tampil semua data & riwayat, filter tanggal & channel | ✅ Live |
| **Notifikasi WhatsApp** | Kirim digest ke WA owner (opsional, via WhatsApp Cloud API) | ✅ Live |
| **Export laporan** | Download laporan harian/periode dalam format PDF atau DOCX | ✅ Live |
| **Pengaturan** | Nama bisnis, nomor WA, jam kirim, pilih kanal (dashboard/WA/keduanya) | ✅ Live |
| **Fallback** | Jalan normal saat data kosong / AI gagal / WA gagal kirim | ✅ Live |

**Fitur direncanakan (Increment 2 — belum dibangun):**

| Modul | Fitur | Status |
|---|---|---|
| **Katalog produk** | CRUD produk (nama, kategori, harga), aktif/nonaktif | 🔄 Direncanakan |
| **Input cepat (ketuk)** | Catat pesanan dengan ketuk produk + isi qty | 🔄 Direncanakan |
| **Auto-hitung omzet** | Omzet & transaksi dihitung otomatis dari pesanan | 🔄 Direncanakan |
| **Riwayat pesanan** | Lihat, edit, hapus riwayat pesanan | 🔄 Direncanakan |

**Masalah yang ada (gap & isu nyata):**
- Butuh VPS dan setup teknis — tidak semua pemilik UMKM bisa install sendiri (barrier teknis tinggi)
- Tidak ada integrasi marketplace otomatis — data masih perlu diinput manual (konektor Shopee/GoFood pasca-MVP)
- Tidak ada modul keuangan lengkap (tidak ada laporan L/R formal, HPP, piutang, stok, pajak) — ini di luar scope produk
- Model "bayar sekali" bagus untuk user, tapi revenue model lebih sulit diprediksi untuk founder
- AI lokal butuh hardware cukup kuat — VPS kecil mungkin lambat
- Belum ada validasi WTP yang cukup (1 orang tertarik belum cukup)
- Segmen beachhead (Pontianak/Kalbar) sangat sempit — perlu diperluas untuk validasi yang kuat

**Masalah yang diselesaikan:**

| Masalah UMKM | Cara LocalAgent Menyelesaikannya |
|---|---|
| "Tiap pagi rekap penjualan dari 3 aplikasi makan 30-60 menit" | Agregasi otomatis lintas channel → satu ringkasan |
| "Saya ga punya satu angka gabungan yang bisa dipercaya" | Total + % perubahan dihitung deterministik di kode (bukan AI ngarang) |
| "Saya ambil keputusan stok & promo pakai feeling" | 1 rekomendasi actionable AI setiap pagi (berbasis data aktual) |
| "Buka 3 aplikasi cuma buat tau omzet kemarin" | Satu pesan WhatsApp / satu layar dashboard, sudah cukup |
| "Takut data bisnis saya bocor ke cloud asing" | 100% lokal — data tidak pernah keluar server/VPS owner |
| "Banyak tool bayar bulanan, menguras cashflow" | Bayar sekali, selamanya dipakai |

---

## 2. PERBANDINGAN CEPAT (UNTUK PEWAWANCARA)

| Dimensi | SmartBookAI | LocalAgent |
|---|---|---|
| **Fungsi inti** | Pembukuan & manajemen bisnis lengkap | Analitik penjualan harian berbasis AI |
| **Model bisnis** | Subscription bulanan | Bayar sekali |
| **Infrastruktur** | Cloud (internet wajib) | Self-hosted / lokal (VPS) |
| **Data privasi** | Di server Supabase | 100% di perangkat owner |
| **AI** | Narasi AI (opsional, via Claude cloud) | AI lokal harian (Ollama, wajib untuk digest) |
| **Target user** | UMKM butuh laporan keuangan, pajak, KUR | UMKM F&B multi-channel yang kewalahan rekap manual |
| **Kompleksitas setup** | Daftar lewat browser, langsung pakai | Butuh VPS + setup teknis |
| **Fitur keuangan** | Lengkap (L/R, neraca, piutang, stok, HPP, pajak) | Tidak ada — bukan scope produk |
| **Notifikasi harian** | Tidak ada (belum) | WhatsApp digest setiap pagi (opsional) |
| **Pain yang dituju** | "Laporan keuangan berantakan / butuh modal / butuh stok rapi" | "Data penjualan terpencar, setiap pagi rekap manual" |

**Kapan SmartBookAI lebih relevan untuk interviewee:**
- Mereka punya banyak transaksi yang susah dilacak
- Pernah gagal dapat KUR karena tidak punya laporan keuangan
- Punya admin/karyawan yang perlu akses terpisah
- Punya stok yang sering tidak cocok antara catatan dan kenyataan

**Kapan LocalAgent lebih relevan untuk interviewee:**
- Mereka jual di banyak platform (kasir/POS + GoFood/Grab + WhatsApp/marketplace)
- Mereka menghabiskan waktu signifikan setiap pagi untuk rekap dari banyak app
- Mereka ingin tahu channel mana yang paling laku / kapan jam ramai — tapi tidak punya waktu analisis
- Mereka khawatir data bisnis mereka disimpan di server orang lain

---

## 3. PANDUAN WAWANCARA MOM TEST

> **Aturan wajib Mom Test:**
> 1. Jangan sebut nama produk Anda sama sekali — sepanjang wawancara
> 2. Jangan menjual, jangan pitching
> 3. Tanya tentang masa lalu mereka, bukan pendapat/impian masa depan
> 4. Yang valid hanya: kejadian nyata + dampak nyata + tindakan nyata
> 5. Pujian ("wah bagus tuh") bukan validasi — abaikan

**Format:** Interview 1-on-1, 25–35 menit  
**Target responden:** Pemilik atau pengelola aktif UMKM (bukan karyawan biasa)  
**Jumlah minimum:** 10 orang sebelum menarik kesimpulan

---

### BAGIAN 0 — SCREENING (3 menit)

Lakukan sebelum mulai. Kalau tidak lolos, hentikan dengan sopan.

**S1.** Usahanya sudah jalan berapa lama?  
*(Lanjut hanya jika ≥ 6 bulan — usaha baru belum cukup punya history pain)*

**S2.** Sehari-hari Anda yang langsung pegang operasional dan keputusan bisnisnya, atau ada orang lain yang lebih tahu soal keuangan dan tools yang dipakai?  
*(Lanjut hanya jika mereka sendiri yang pegang — kalau ada manajer/admin yang mengelola, pindah ke orang itu. Data WTP dari orang yang bukan pengambil keputusan tidak bisa dipegang.)*

**S3.** Produk atau layanannya apa, dan jualan di mana saja?  
*(Catat: online/offline, channel apa saja. Ini penting untuk tahu relevansi produk mana)*

**S4.** Dalam sebulan, kira-kira ada berapa transaksi atau pesanan yang masuk?  
*(Catat estimasi volume — ini sinyal seberapa parah pain mereka)*

**S5.** Saat ini ada aplikasi atau tools yang Anda bayar untuk bantu jalankan usaha — kasir, pembukuan, laporan, marketplace, apapun? Kalau ada, berapa per bulannya kira-kira?  
*(Penting: UMKM yang belum pernah bayar tools apapun sangat unlikely jadi customer pertama. Kalau nol — wawancara tetap lanjut, tapi catat ini dan turunkan bobot kesimpulannya. Kalau sudah bayar sesuatu — ini sinyal kuat bahwa mereka mau invest untuk tools.)*

> **Kriteria lolos screening:** Usaha ≥6 bulan, pengambil keputusan langsung, dan ada volume transaksi nyata.  
> **Bonus poin:** Sudah pernah bayar tools/software apapun untuk bisnis mereka.

---

### BAGIAN 1 — WARM-UP: PAHAMI KONTEKS BISNIS (3–5 menit)

Tujuan: bangun rapport, biarkan mereka cerita bebas tentang bisnisnya.

**W1.** Kalau saya tanya, sehari-hari di bisnis ini waktu Anda habis paling banyak ngapain?

**W2.** Dari semua hal yang Anda kerjakan setiap hari, bagian mana yang paling bikin capek atau frustrasi?

> **Yang Anda cari:** Apakah mereka spontan sebut "catat", "laporan", "rekap", "buka aplikasi", "stok", "piutang"? Itu sinyal kuat.  
> **Jangan arahkan** — biarkan kata-kata datang dari mereka.

---

### BAGIAN 2 — GALI PAIN: KEUANGAN & PEMBUKUAN (SmartBookAI)

> Tujuan: pahami seberapa parah masalah pencatatan keuangan mereka.  
> **Skip logic:** Kalau di A1 mereka bilang sudah pakai software pembukuan berbayar dan puas → lewati A2–A6, langsung ke A7 lalu lanjut ke Blok B.

**A1.** Gimana cara Anda sekarang mencatat pemasukan dan pengeluaran usaha — bisa ceritakan prosesnya dari awal sampai akhir?  
*(Tujuan: pahami alur nyata mereka. Dengerin: buku tulis, Excel, aplikasi, atau tidak dicatat sama sekali? Siapa yang melakukan? Seberapa sering?)*

**A2.** Kapan terakhir kali Anda tahu persis berapa keuntungan bersih usaha Anda — bukan kira-kira, tapi angka yang Anda yakini?  
*(Framing ini netral — tidak mensyaratkan mereka harus tahu. Kalau jawabannya "tidak pernah tahu" atau "sudah lama" → pain nyata. Kalau "setiap bulan" → gali lebih dalam: prosesnya gimana?)*

**A3.** Ceritakan satu kejadian dalam 3 bulan terakhir di mana Anda bingung atau keteteran karena kondisi keuangan usaha tidak jelas — kejadiannya seperti apa?  
*(Kalau ada kejadian: apa dampaknya — kehilangan uang, waktu, keputusan yang ternyata salah? Gimana perasaan Anda waktu itu? Tanyakan ini untuk menangkap emosi — itu sinyal urgency yang sesungguhnya.)*  
*(Kalau tidak ada kejadian dalam 3 bulan → pain-nya rendah. Lanjut ke A4 tapi turunkan skor.)*

**A4.** Kalau bank atau investor minta laporan keuangan usaha Anda besok pagi — Anda bisa siapin? Prosesnya gimana, dan berapa lama?  
*(Pernah kejadian nyata seperti ini? Kalau pernah → cerita lebih detail. Ini salah satu trigger urgency terkuat.)*

**A5.** Untuk mengatasi masalah pencatatan ini — sekarang Anda sudah keluarkan apa? Bayar admin? Beli aplikasi? Atau waktu Anda sendiri yang habis? Estimasi berapa per bulan?  
*(Ini bukan WTP — ini biaya masalah saat ini. Tanpa tahu angka ini, WTP yang ditanya nanti tidak bisa dibandingkan.)*

**A6.** *(Tanya hanya kalau relevan dari profil bisnis mereka)* Stok dan piutang Anda dikelola di mana? Pernah ada kejadian stok kosong saat ramai, atau tagihan yang tidak tertagih sampai lupa? Ceritakan.

**A7.** Pernah coba tools — Excel, Google Sheets, atau aplikasi apapun — untuk bantu pencatatan keuangan? *(Kalau pernah)* Apa yang membuat Anda berhenti atau tidak puas?  
*(Jawaban ini mengungkap barrier adopsi yang sesungguhnya — lebih berharga dari sekedar "pernah/tidak".)*

> **Sinyal kuat pain ini nyata:**
> - Menyebut kejadian konkret dalam 90 hari terakhir dengan dampak finansial
> - Sudah punya workaround aktif yang diupayakan sendiri (tanda pain cukup parah untuk dicoba atasi)
> - Ekspresi emosional — frustrasi, stres, malu — saat cerita kejadian
> - Sudah keluarkan uang/waktu signifikan untuk workaround (A5)

---

### BAGIAN 3 — GALI PAIN: DATA PENJUALAN MULTI-CHANNEL (LocalAgent)

> Tujuan: pahami seberapa parah masalah data yang terpencar lintas platform.  
> **Skip logic:** Kalau di S3 mereka hanya punya 1 channel penjualan → lewati seluruh Blok B, langsung ke Bagian 4.

**B1.** Anda jualan di berapa tempat atau platform berbeda? Sebutkan satu per satu.  
*(Catat: kasir fisik, GoFood, GrabFood, Shopee, TikTok Shop, WhatsApp, dll. Kalau ≤2 platform → pain ini kemungkinan rendah, pertimbangkan skip ke Bagian 4.)*

**B2.** Saya mau tanya soal rutinitas harian Anda. Setiap pagi, bagaimana Anda tahu kemarin penjualan Anda berapa — total dari semua tempat jualan? Bisa ceritakan prosesnya langkah per langkah?  
*(Apakah mereka buka beberapa aplikasi satu per satu? Berapa lama? Ada yang ditulis manual? Atau tidak ada rutinitas sama sekali?)*

**B3.** Dari semua platform itu, ada tidak satu tempat yang langsung menggabungkan semua angkanya jadi satu? Kalau tidak ada — apa yang Anda lakukan sekarang kalau mau lihat total penjualan lintas semua channel?

**B4.** Ceritakan satu kejadian di mana Anda buat keputusan — soal stok, menu/produk, promo, atau jam operasional — yang ternyata salah atau tidak optimal karena waktu itu data yang Anda punya tidak lengkap.  
*(Apa keputusannya? Apa dampaknya — kehilangan penjualan, stok mubazir, promo tidak tepat sasaran? Kapan terjadi? Gimana perasaan Anda waktu sadar itu salah keputusan?)*

**B5.** Dalam seminggu terakhir, kalau dijumlah, berapa lama total waktu yang Anda atau tim Anda habiskan hanya untuk rekap, lihat, atau laporan dari berbagai platform itu?  
*(Kalau mereka tidak bisa estimasi → tanda masalah belum cukup sakit untuk dirasakan. Kalau langsung sebut angka konkret → pain sangat nyata.)*

**B6.** Pernah kepikiran atau sudah coba cara lain untuk atasi masalah rekap dari banyak platform ini — apapun caranya? Hasilnya gimana?  
*(Ini menggali workaround dan barrier adopsi. Jangan tanya "apa solusinya" — biarkan mereka cerita sendiri.)*

> **⚠️ Pertanyaan yang DIHAPUS dari versi sebelumnya:**  
> ~~"Apakah Anda khawatir kalau data bisa dilihat pihak lain?"~~ — ini pertanyaan LEADING. Kita menanam kekhawatiran yang mungkin tidak ada. Kalau privasi data memang jadi concern mereka, mereka akan menyebutnya sendiri saat B3 atau B6.

> **Sinyal kuat pain ini nyata:**
> - Sebut ≥3 platform/channel berbeda
> - Bisa langsung estimasi berapa menit per hari habis untuk rekap
> - Ada kejadian konkret salah keputusan dalam 60 hari terakhir
> - Punya workaround aktif tapi merasa tidak puas dengan workaround itu
> - Ekspresi frustrasi atau kelelahan spontan saat menjelaskan prosesnya

---

### BAGIAN 4 — PRIORITAS & WILLINGNESS TO PAY

> Lakukan setelah Blok A dan B selesai. Jangan jelaskan produk Anda dulu.

**P1.** Dari semua yang kita obrolin tadi — kalau besok ada satu masalah operasional yang bisa hilang selamanya, mana yang paling Anda mau?  
*(Biarkan mereka pilih tanpa diberi pilihan. JANGAN sebut "keuangan" atau "data multi-channel" — itu membocorkan bahwa Anda punya dua produk. Diam dan tunggu jawaban mereka.)*

**P2.** Masalah yang Anda sebut tadi — seberapa sering itu muncul? Terakhir kali kapan terasa paling parah?  
*(Pain yang terjadi minggu ini lebih urgent dari pain yang terjadi setahun lalu. Ini mengkalibrasi skala waktu.)*

**P3.** Untuk masalah itu, sekarang Anda sudah keluarkan berapa per bulan — waktu atau uang — untuk mencoba mengatasinya? Ini bisa apa saja: gaji admin, beli aplikasi, waktu Anda sendiri setelah jam tutup, apapun.  
*(Ini adalah pertanyaan biaya masalah — WAJIB ditanya sebelum WTP. Kalau masalah ini sudah "biaya" Rp 2 juta/bulan untuk mereka, membayar Rp 200 ribu untuk solusi adalah mudah. Kalau biaya masalahnya nol — WTP mereka akan rendah dan Anda tidak bisa bandingkan.)*

**P4.** Kalau ada solusi yang benar-benar menyelesaikan masalah itu — Anda mau bayar berapa per bulan?  
*(Jangan kasih angka dulu. Tunggu. Kalau diam lebih dari 10 detik: "lebih dari Rp 50 ribu?" Kalau ya: "lebih dari Rp 100 ribu?" Naik bertahap — jangan langsung loncat ke angka tinggi.)*

**P5.** Kenapa Anda pilih angka itu — dibanding apa?  
*(Ini mengungkap referensi harga mereka. Apakah dibanding gaji admin? Aplikasi lain yang sudah dipakai? Atau angka acak? Referensi yang nyata = tanda WTP yang bisa dipercaya.)*

**P6.** Saya ingin tunjukkan sesuatu yang mungkin relevan untuk masalah yang kita obrolin. Kapan waktu Anda punya 20 menit untuk lihat ini — minggu ini atau minggu depan?  
*(Commitment nyata = mereka kasih hari & jam spesifik dalam 7 hari ke depan. "Nanti kalau sempat" atau "kapan aja bisa" = sinyal lemah, jangan hitung sebagai komitmen.)*

---

### BAGIAN 5 — PENUTUP (2 menit)

**C1.** Dari seluruh obrolan kita tadi, ada hal lain soal operasional bisnis yang terasa paling berat tapi belum kita bahas?

**C2.** Kalau saya mau tanya lebih lanjut nanti, boleh saya hubungi lagi?  
*(Kalau ya = sinyal keterlibatan tinggi)*

> **Jangan lupa:** Setelah wawancara selesai, **langsung isi Template Catatan (Bagian 6)** sebelum memori kabur.

---

## 4. SISTEM PENILAIAN URGENCY & NIAT BELI

Isi setelah setiap wawancara. Satu penilaian per responden.

### 4.1 Skor Urgency (0–10)

Jumlahkan poin dari setiap indikator di bawah:

**Indikator Pain (maks 4 poin):**

| Indikator | Poin |
|---|---|
| Menyebut kejadian konkret dengan dampak nyata — bukan generik, bukan "pernah sih" | +1 |
| Kejadian itu terjadi dalam 60 hari terakhir (bukan 6 bulan – 1 tahun lalu) | +1 |
| Ada dampak finansial yang bisa diestimasi (kehilangan uang / waktu yang nilainya bisa dihitung) | +1 |
| Menyebut masalah ini spontan di Warm-Up, tanpa dipancing — ATAU ekspresi emosional kuat saat cerita | +1 |

**Indikator Biaya Masalah & WTP (maks 3 poin):**

| Indikator | Poin |
|---|---|
| Sudah keluar uang/waktu nyata untuk workaround (P3) — bukan nol | +1 |
| WTP yang disebut ≥ biaya workaround saat ini, ATAU ≥ Rp 100.000/bulan spontan | +1 |
| WTP ≥ Rp 200.000/bulan — dan mereka bisa jelaskan kenapa (P5 ada referensi nyata) | +1 |

> **Catatan penting:** WTP yang rendah tapi biaya workaround-nya juga rendah = wajar, bukan diskualifikasi. Yang perlu diwaspadai adalah WTP tinggi tapi tidak ada workaround sama sekali — itu sering sekadar angka aspiratif, bukan komitmen nyata.

**Indikator Komitmen Tindakan (maks 3 poin):**

| Indikator | Poin |
|---|---|
| Mereka kasih hari & jam spesifik untuk followup dalam 7 hari ke depan | +1 |
| Mereka punya workaround aktif tapi tidak puas — aktif cari alternatif | +1 |
| Mereka sudah bayar tools/software apapun sebelumnya (dari S5) | +1 |

**Total Skor Urgency: __ / 10**

### 4.2 Interpretasi Skor Urgency

| Skor | Interpretasi | Tindakan |
|---|---|---|
| **8–10** | 🔴 **Sangat urgent.** Pain nyata, WTP anchored ke biaya masalah, komitmen konkret. | Undang ke beta / demo dalam 7 hari. Ini target pertama Anda. |
| **6–7** | 🟠 **Cukup urgent.** Pain nyata tapi WTP atau komitmen masih lemah — atau salah satunya. | Followup 1x. Kalau tidak ada progress setelah 1 minggu, deprioritaskan. |
| **4–5** | 🟡 **Sedang.** Pain ada tapi belum cukup menyakitkan untuk mereka bertindak sekarang. | Nurture dengan konten edukasi. Tunggu trigger (tax season, gagal KUR, dll.) |
| **0–3** | 🟢 **Rendah / Tidak relevan.** Pain tidak nyata atau bukan pain yang produk Anda selesaikan. | Catat pola untuk insight, tapi jangan invest waktu untuk pitch. |

> **⚠️ Jebakan umum:** Responden yang ramah dan antusias sering dapat skor tinggi tapi tidak convert. Yang menentukan bukan keramahan — tapi apakah mereka punya workaround aktif (tanda pain nyata) dan kasih waktu spesifik (tanda komitmen nyata).

### 4.3 Skor Kesesuaian Produk

Setelah menilai urgency, tentukan produk mana yang paling cocok untuk responden ini:

| Sinyal | Produk yang lebih cocok |
|---|---|
| Sebut masalah laporan keuangan, stok, piutang, KUR, pajak | → **SmartBookAI** |
| Sebut masalah rekap dari banyak platform, data terpencar, tidak ada insight penjualan harian | → **LocalAgent** |
| Keduanya | → Keduanya (tandai sebagai "dual pain") |
| Tidak ada yang relevan | → Bukan target saat ini |

**Scoring relevansi:**

| Skor Kesesuaian | Arti |
|---|---|
| **A** | Sangat cocok — pain mereka persis yang diselesaikan produk Anda |
| **B** | Cocok sebagian — ada overlap tapi ada kebutuhan di luar produk Anda |
| **C** | Kurang cocok — pain mereka di luar scope kedua produk saat ini |

### 4.4 Matriks Prioritas Responden

Gabungkan kedua skor:

```
Urgency Tinggi (7-10) + Kesesuaian A → 🎯 PRIORITAS UTAMA (target beta pertama)
Urgency Tinggi (7-10) + Kesesuaian B → 🟠 FOLLOW-UP (gali lebih lanjut)
Urgency Sedang (4-6) + Kesesuaian A  → 🟡 NURTURE (butuh trigger)
Urgency Rendah (0-3) + Apapun        → ⬇️  DEPRIORITASKAN
```

---

## 5. CARA MENGINTERPRETASIKAN HASIL

Setelah 10 wawancara, isi Tabel Tabulasi (Bagian 7), lalu baca pola berikut:

### 5.1 SmartBookAI lebih dibutuhkan jika:
- ≥6 dari 10 menyebut masalah keuangan/laporan di Warm-Up tanpa dipancing
- ≥5 punya kejadian konkret di A3 atau A4 (minta laporan mendadak)
- Rata-rata WTP ≥ Rp 150.000/bulan
- ≥4 menyebut pernah pakai Excel/Sheets tapi frustasi

### 5.2 LocalAgent lebih dibutuhkan jika:
- ≥6 dari 10 jual di ≥3 channel berbeda
- ≥5 tidak bisa jawab "berapa omzet kemarin" dalam 30 detik (B2)
- ≥4 menghabiskan >30 menit per hari untuk rekap manual
- ≥3 menyebut kekhawatiran soal data privasi

### 5.3 Keduanya dibutuhkan tapi segmen berbeda jika:
- Bisnis kecil (1–3 orang) cenderung ke SmartBookAI (butuh laporan, pajak)
- F&B multi-channel (≥3 platform, >Rp 30 juta/bulan) cenderung ke LocalAgent
- Tandai ini: dua produk bisa berjalan untuk dua segmen yang berbeda

### 5.4 Red Flags — Jangan dihitung sebagai validasi:
- ❌ "Idenya bagus!" tanpa mau kasih waktu followup konkret
- ❌ "Kalau ada sih mau pakai" tanpa bisa cerita kejadian masa lalu
- ❌ WTP yang disebut sangat rendah (<Rp 50.000) tanpa argumen
- ❌ Mereka tidak bisa cerita satu kejadian konkret dari 6 bulan terakhir

---

## 6. TEMPLATE CATATAN PER RESPONDEN

Isi **langsung setelah wawancara selesai**, maksimal 10 menit kemudian.

```
═══════════════════════════════════════
RESPONDEN #__
Tanggal wawancara  : 
Durasi             : __ menit
Pewawancara        : 
═══════════════════════════════════════

── PROFIL BISNIS ──────────────────────
Jenis usaha        : 
Channel jualan     : 
Lama usaha         : 
Jumlah karyawan    : 
Omzet estimasi     : Rp ___/bulan
Lokasi             : 

── PAIN YANG MUNCUL ───────────────────
Pain keuangan/pembukuan (A1–A7):
  → [tuliskan dengan kata-kata mereka sendiri]

Pain data penjualan multi-channel (B1–B6):
  → [tuliskan dengan kata-kata mereka sendiri]

Pain lain yang tidak terduga:
  → 

── WORKAROUND SAAT INI ────────────────
Mereka sekarang pakai apa untuk atasi masalah ini?
  →

Biaya workaround (waktu atau uang):
  →

── BIAYA MASALAH & WTP ─────────────────────
Biaya masalah saat ini (P3)       : Rp ___/bulan
Bentuknya                         : [admin, waktu sendiri, app lain, dll.]
WTP yang disebut spontan (P4)     : Rp ___/bulan
Angka setelah dipancing (jika ada): Rp ___/bulan
Referensi harga mereka (P5)       : [dibanding apa — gaji admin? app lain? acak?]
WTP masuk akal?                   : Ya/Tidak — karena ___

── PRIORITAS (P1) ─────────────────────────
Yang mereka pilih sebagai masalah utama (kata-kata mereka sendiri):
  →
Interpretasi setelah wawancara:
  [ ] Keuangan/laporan/stok/piutang  → SmartBookAI
  [ ] Data penjualan multi-channel   → LocalAgent
  [ ] Keduanya sama penting
  [ ] Lainnya (di luar scope kedua produk): ___

── KOMITMEN ───────────────────────────
Bersedia followup/demo?      : Ya / Tidak
Hari & jam yang disepakati   : [spesifik — "Senin 15 Juli jam 10" bukan "kapan aja"]
Kontak yang diberikan        : Ya / Tidak
Sudah bayar software lain?   : Ya (Rp ___/bulan untuk ___) / Tidak pernah

── PENILAIAN ──────────────────────────
Skor Urgency               : __ / 10
  Pain (maks 4)            : __ /4  [kejadian konkret, ≤60 hari, dampak finansial, spontan/emosional]
  Biaya masalah & WTP (3)  : __ /3  [workaround nyata, WTP ≥ anchor, WTP ≥200k + referensi]
  Komitmen (3)             : __ /3  [waktu spesifik 7 hari, cari alternatif aktif, sudah pernah bayar]

Kesesuaian produk          : A / B / C
Produk yang cocok          : SmartBookAI / LocalAgent / Keduanya / Tidak ada

Prioritas responden ini    : 🎯 UTAMA (8-10) / 🟠 FOLLOWUP (6-7) / 🟡 NURTURE (4-5) / ⬇️ SKIP (0-3)

── QUOTE TERBAIK ──────────────────────
(1 kalimat paling kuat yang mereka ucapkan — pakai kata-kata aslinya)
"..."

── CATATAN LAIN ───────────────────────
Hal menarik / tidak terduga / perlu digali lebih:
```

---

## 7. TABEL TABULASI 10 RESPONDEN

Isi setelah semua wawancara selesai.

| # | Jenis Usaha | Jml Channel | Sudah Bayar Software? | Pain Keuangan? | Pain Multi-Channel? | Biaya Masalah/bln | WTP/bln | WTP vs Biaya | Urgency /10 | Produk Cocok | Prioritas |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | Ya/Tidak | Kuat/Lemah/Tidak | Kuat/Lemah/Tidak | Rp | Rp | Wajar/Rendah | /10 | | |
| 2 | | | | | | Rp | Rp | | /10 | | |
| 3 | | | | | | Rp | Rp | | /10 | | |
| 4 | | | | | | Rp | Rp | | /10 | | |
| 5 | | | | | | Rp | Rp | | /10 | | |
| 6 | | | | | | Rp | Rp | | /10 | | |
| 7 | | | | | | Rp | Rp | | /10 | | |
| 8 | | | | | | Rp | Rp | | /10 | | |
| 9 | | | | | | Rp | Rp | | /10 | | |
| 10 | | | | | | Rp | Rp | | /10 | | |
| **TOTAL** | | | __/10 ya | __/10 kuat | __/10 kuat | Rata2: Rp | Rata2: Rp | | Rata2: /10 | SB:__ / LA:__ | |

### Kesimpulan Tabulasi

Isi setelah tabel di atas lengkap:

```
Tanggal selesai  : 
Total responden  : 

SmartBookAI:
  - Yang cerita pain keuangan konkret   : __ / 10
  - Yang pilih ini di P1                : __ / 10
  - Rata-rata WTP                       : Rp ___/bulan
  - Yang bersedia followup              : __ / 10
  
LocalAgent:
  - Yang punya ≥3 channel berbeda       : __ / 10
  - Yang tidak bisa jawab omzet kemarin : __ / 10
  - Yang pilih ini di P1                : __ / 10
  - Rata-rata WTP                       : Rp ___/bulan
  - Yang bersedia followup              : __ / 10

Responden prioritas utama (🎯):
  1. [nama/kode] — [produk] — WTP Rp___
  2. 
  3.

Kesimpulan:
  Validasi kuat untuk: [ ] SmartBookAI  [ ] LocalAgent  [ ] Keduanya  [ ] Pivot perlu

Langkah berikutnya:
  → 
```

---

## REFERENSI CEPAT — SINYAL VALIDASI

**Validasi KUAT (Anda di jalur yang benar):**
- Mereka cerita kejadian spesifik tanpa Anda tanya
- Mereka sudah kehilangan uang atau waktu karena masalah ini
- Mereka sudah punya workaround (tanda masalah cukup parah untuk dicoba atasi)
- WTP ≥ Rp 150.000/bulan spontan, tanpa tawar-menawar
- Mereka mau kasih nomor & waktu untuk followup

**Validasi LEMAH (perlu investigasi lebih lanjut):**
- Mereka bilang "mau" tapi tidak punya story konkret
- WTP < Rp 50.000 atau dijawab "tergantung fiturnya"
- Tidak mau kasih waktu followup yang spesifik
- Pain yang mereka sebut adalah pain orang lain, bukan diri mereka sendiri

**PIVOT jika:**
- < 3 dari 10 punya pain konkret yang relevan
- Rata-rata WTP < Rp 100.000/bulan untuk kedua produk
- Pain yang dominan muncul adalah sesuatu yang di luar scope kedua produk Anda

---

*Dokumen ini dibuat sebagai panduan validasi pasar awal. Update setelah setiap batch 5 wawancara selesai.*
