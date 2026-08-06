# RENCANA LAUNCH BERTAHAP — SmartBook AI
## Evaluasi strategi Soft Launch → Grand Launch, dan versi yang direkomendasikan

> **Tanggal:** 3 Agustus 2026
> **Menjawab:** usulan Founder — soft launch (aplikasi bisa diakses, testing ke market, pastikan tidak ada bug, kumpulkan feedback) lalu grand launch.
> **Pendamping:** `ANALISIS-STRATEGIS-KELAYAKAN-PASAR.md` · `RENCANA-EKSEKUSI-DAN-KLAIM-PENJUALAN.md` · `SPEC-REVISI-FITUR.md`

---

# 1. VONIS SINGKAT

**Naluri bertahapnya benar. Definisi soft launch-nya yang perlu diperbaiki.**

Meluncurkan bertahap adalah keputusan tepat, dan lebih baik daripada rilis publik sekaligus. Tapi dalam bentuk yang Anda tulis, rencana ini punya empat celah yang masing-masing bisa memakan 3–6 bulan tanpa menghasilkan jawaban apa pun.

Empat celah itu, urut dari yang paling mahal:

| # | Celah | Akibat kalau dibiarkan |
|---|---|---|
| 1 | **Tiga tujuan digabung dalam satu tahap** | Tujuan yang tidak ada ujungnya (QA + feedback) memakan tujuan yang menentukan (uji pasar) |
| 2 | **"Testing ke market" tanpa harga** | Menguji apakah orang *memakai*, bukan apakah orang *membayar* — padahal itu satu-satunya yang belum Anda tahu |
| 3 | **"Soft" tidak meringankan kewajiban hukum** | Rasa aman palsu di titik yang justru tidak aman |
| 4 | **"Supaya lebih sempurna" tidak punya aturan berhenti** | Soft launch tidak pernah selesai |

Sisanya dokumen ini membedah keempatnya, lalu memberi versi yang bisa dieksekusi dengan tanggal, kriteria angka, dan kriteria berhenti.

---

# 2. BEDAH EMPAT CELAH

## 2.1 Celah pertama — tiga tujuan yang tidak bisa hidup bersama

Rencana Anda menyebut tiga tujuan soft launch:

| Tujuan | Jenis kegiatan | Kapan selesai? |
|---|---|---|
| (a) Pastikan tidak ada bug/error | QA | **Tidak pernah** — selalu ada bug berikutnya |
| (b) Testing ke market | Validasi komersial | Saat ada orang membayar & kembali |
| (c) Kumpulkan feedback untuk perbaikan | Penyempurnaan produk | **Tidak pernah** — feedback selalu melahirkan backlog |

Dua dari tiga tujuan itu **tidak punya garis finis**. Satu-satunya yang punya garis finis adalah (b) — dan itu justru yang paling menakutkan untuk dijawab.

Yang terjadi dalam praktik: feedback masuk, backlog tumbuh, backlog terlihat seperti pekerjaan yang wajib diselesaikan sebelum grand launch, dan enam bulan lewat dengan nol pelanggan berbayar. Anda tetap sibuk, tetap merasa produktif, dan tetap tidak tahu apakah ada orang yang mau membayar.

**Ini persis pola yang sudah ditandai sebagai risiko nomor satu Anda** (K1 dan K4 di audit internal): menambah pekerjaan untuk menghindari pertanyaan yang menakutkan. Soft launch versi ini adalah bentuk paling meyakinkan dari pola itu, karena ia terlihat seperti kemajuan.

**Perbaikan:** pisahkan tiga tujuan ke tahap berbeda, dan beri **batas waktu keras** pada tahap yang tujuannya tidak punya garis finis alami.

---

## 2.2 Celah kedua — akses gratis tidak menguji apa yang perlu Anda uji

Ini celah terdalam, jadi saya uraikan dengan hati-hati supaya tidak terdengar berlebihan.

**Yang benar-benar diuji oleh soft launch gratis:**

| Yang teruji | Nilainya |
|---|---|
| Apakah produk berjalan di perangkat & data nyata | ✅ Nyata dan penting |
| Di mana orang tersendat saat onboarding | ✅ Nyata dan penting |
| Apakah orang kembali memakai | ✅ Sinyal retensi yang kuat |
| Bug yang tidak muncul di pengujian internal | ✅ Nyata |
| Bahan testimoni & studi kasus | ✅ Nyata |

**Yang TIDAK teruji:**

| Yang tidak teruji | Kenapa penting |
|---|---|
| **Apakah orang mau membayar** | Ini satu-satunya hal yang belum Anda ketahui sama sekali |

Jadi bukan "soft launch gratis tidak menguji apa-apa" — ia menguji banyak hal. Masalahnya lebih spesifik: **ia dirancang untuk tidak menyentuh satu-satunya pertanyaan yang menentukan apakah bisnis ini ada.**

Posisi Anda hari ini: 0 pelanggan berbayar, skor Willingness-to-Pay 55/100, Mom Test 0 dari 4 responden valid masuk kategori layak dikejar. Kalau ada satu variabel yang harus diprioritaskan untuk diukur, itu WTP. Soft launch gratis mengukur segalanya kecuali itu.

**Dua alasan tambahan kenapa gratis berisiko di kasus Anda:**

**(a) Jangkar harga.** Pengguna yang pertama kali mengenal produk Anda pada harga Rp0 akan menilai harga Rp99rb sebagai kenaikan tak berhingga, bukan sebagai harga wajar. Mengubah "gratis" jadi "berbayar" jauh lebih sulit daripada memulai dengan harga pendiri yang murah. 🟡 *Ini prinsip perilaku (anchoring), bukan angka terukur — tapi konsisten dengan pengalaman umum SaaS.*

**(b) Preseden di pasar Anda sendiri buruk.** Ini bukan teori. Audit internal Anda mencatat: **BukuKas bangkrut 2023** dan **BukuWarung pivot ke fintech** — keduanya membangun basis pengguna besar secara gratis, keduanya gagal memonetisasi pembukuan. Jalur "gratis dulu, monetisasi nanti" sudah dicoba di segmen persis ini oleh pemain yang jauh lebih bermodal, dan hasilnya dua kuburan. Anda tidak punya modal untuk mengulangi eksperimen itu.

Dokumen pricing Anda sendiri juga sudah mencatat konversi gratis→bayar di self-serve UMKM berkisar **3–8%** 🟡 *(estimasi umum di dokumen `03_Pricing`, bukan angka terverifikasi untuk pasar Indonesia)*. Pada 20 pengguna soft launch, itu berarti **0 sampai 1 orang** yang membayar. Sampel sekecil itu tidak akan memberi Anda kepastian apa pun.

**Perbaikan:** pungut bayaran sejak hari pertama soft launch, walaupun kecil. Rincian dan alternatifnya di bagian 4.2.

---

## 2.3 Celah ketiga — "soft" tidak meringankan kewajiban hukum

Ini bagian yang paling sering luput, dan konsekuensinya paling berat.

Begitu satu orang nyata memasukkan data keuangannya ke sistem Anda, Anda menjadi **Pengendali Data** sepenuhnya. Tidak ada versi "soft" dari status itu.

| Kewajiban | Berlaku saat soft launch? |
|---|---|
| Identitas Pengendali Data yang sah & bisa dihubungi | ✅ Ya, penuh |
| Kebijakan privasi & pencatatan persetujuan | ✅ Ya, penuh |
| Pelaporan kebocoran dalam 3×24 jam | ✅ Ya, penuh |
| Hak pengguna mengekspor & menghapus datanya | ✅ Ya, penuh |
| Sanksi kalau lalai | ✅ Ya, penuh |

🟡 *Rujukan sanksi UU PDP (hingga 2% pendapatan tahunan, denda korporasi hingga Rp60 miliar, pidana hingga 6 tahun, kewajiban lapor 3×24 jam) berasal dari audit internal Anda. Untuk keputusan hukum final, verifikasi dengan konsultan hukum — saya bukan penasihat hukum.*

**Konsekuensi praktis:** task **B1** (mengisi `CONTROLLER_NAME` dan `CONTACT_EMAIL` di `src/lib/legal.js` yang sekarang masih generik + Gmail pribadi) adalah **blocker mutlak untuk soft launch**, sama seperti untuk grand launch. Tidak ada keringanan.

Sisi baiknya: soft launch justru **kesempatan bagus untuk melatih kesiapan hukum** saat taruhannya masih kecil — dan ini manfaat yang tidak Anda sebut di rencana awal. Selama soft launch, uji tiga hal ini secara sengaja:

1. **Simulasi respons kebocoran.** Jalankan latihan: anggap ada insiden hari ini, siapa yang lapor, ke mana, dengan template apa. Ukur berapa lama. Kalau lebih dari 3×24 jam saat latihan, prosedurnya belum siap.
2. **Alur ekspor & hapus data.** Minta satu pilot benar-benar menghapus akunnya. Pastikan datanya benar-benar hilang.
3. **Waktu respons dukungan.** Tetapkan janji (mis. balas dalam 12 jam kerja) dan ukur apakah Anda sanggup memenuhinya di 20 orang. Kalau tidak sanggup di 20, Anda pasti tidak sanggup di 200.

---

## 2.4 Celah keempat — "supaya lebih sempurna" tidak punya aturan berhenti

Dua masalah di sini.

**Pertama: mencari bug lewat pengguna publik adalah metode termahal yang tersedia.**

| Bug ditemukan oleh | Biayanya |
|---|---|
| Pengujian internal terstruktur | Bug itu sendiri |
| Pengguna nyata | Bug + hubungan rusak + kemungkinan keluhan publik + kepercayaan yang tidak bisa dipulihkan |

Anda sudah punya `QA.md` dengan kriteria kelulusan yang terdefinisi rapi — dan **belum dijalankan sampai tuntas**. Menjalankannya lebih murah, lebih cepat, dan lebih menyeluruh daripada berharap 20 orang asing menemukan bug untuk Anda. Mereka tidak berutang apa pun kepada Anda; kalau menemukan bug, kebanyakan orang tidak melapor — mereka berhenti memakai dan diam.

**Kedua: "sempurna" bukan kriteria rilis.** Tidak ada produk yang rilis dalam keadaan sempurna, dan mengejarnya berarti tidak pernah rilis.

**Perbaikan — pakai standar yang sudah Anda tulis sendiri di `QA.md`:**

- 100% test case P0 lulus
- ≥95% test case P1 lulus
- Nol bug severity **Blocker** dan **Critical** yang terbuka
- Build produksi sukses, console browser bersih

Bug **Major** dan **Minor** boleh ikut masuk soft launch — asal tercatat dan dikomunikasikan. Ini standar yang punya garis finis dan bisa diverifikasi. Jangan buat standar baru; Anda sudah punya yang bagus.

---

## 2.5 Catatan tentang "Grand Launch"

Perlu diluruskan supaya tidak salah harap.

Grand launch bekerja kalau Anda punya tiga hal: **audiens yang bisa dituju**, **momen distribusi** (peluncuran media, mitra besar, komunitas besar), dan **produk yang bisa dikonversi sendiri tanpa Anda**.

Hari ini Anda punya nol dari tiga. Grand launch ke audiens yang belum ada bukan peluncuran — itu hari Selasa biasa dengan lebih banyak kecemasan.

**Definisi grand launch yang lebih berguna untuk Anda:**

> Grand launch bukan acara. Grand launch adalah **titik ketika Anda mulai membelanjakan uang dan tenaga orang lain untuk akuisisi** — iklan berbayar, freelance sales, kemitraan berskala — **karena Anda sudah tahu berapa nilai satu pelanggan dan berapa biaya mendapatkannya.**

Dengan definisi itu, grand launch bukan soal tanggal atau kemeriahan. Ia soal apakah angka LTV/CAC Anda sudah diketahui dan sehat. Sebelum itu, membelanjakan uang untuk akuisisi hanyalah membakar uang lebih cepat.

---

# 3. KOREKSI STRUKTURAL: SOFT LAUNCH ITU DUA TAHAP, BUKAN SATU

Ini temuan struktural terpenting di dokumen ini.

Yang Anda sebut "soft launch" sebenarnya harus menjawab **dua pertanyaan yang sangat berbeda**, dan keduanya tidak bisa dijawab bersamaan:

| Pertanyaan | Butuh setup apa | Kenapa bentrok |
|---|---|---|
| **"Apakah ada yang mau membayar?"** | Kelompok kecil, tertutup, Anda dampingi langsung, ada harga | Butuh pendampingan intensif — mustahil di banyak orang |
| **"Apakah orang bisa jalan tanpa saya?"** | Terbuka, self-serve, Anda sengaja menjauh | Butuh Anda tidak ikut campur — kebalikan dari yang di atas |

Kalau digabung, hasilnya kabur: Anda tidak tahu apakah orang bertahan karena produknya bagus atau karena Anda memegangi tangan mereka. Dan itu perbedaan yang menentukan apakah bisnis ini bisa tumbuh.

Karena itu ladder di bawah memecah soft launch jadi **Tertutup** dan **Terbuka**.

---

# 4. LADDER YANG DIREKOMENDASIKAN

Empat gerbang. Setiap gerbang punya **satu pertanyaan**, **kriteria masuk**, **kriteria lulus (angka)**, **kriteria berhenti**, dan **batas waktu keras**.

Batas waktu adalah mekanisme terpenting di seluruh dokumen ini. Tanpa tanggal mati, setiap tahap memuai tanpa batas.

---

## GATE 0 — Persiapan & Concierge
### 3–16 Agustus 2026 (2 minggu) · *bukan launch*

| | |
|---|---|
| **Pertanyaan** | Apakah angka kebocoran memicu reaksi pada orang nyata? |
| **Akses aplikasi** | **Tidak ada.** Anda yang mengolah, manual |

**Pekerjaan:**
- Task **B1, B2, B3, B4, C1** dari `SPEC-REVISI-FITUR.md`
- Jalankan `QA.md` sampai tuntas — catat hasilnya, jangan diasumsikan
- Pasang instrumen telemetri (bagian 5)
- Kirim **5 audit kebocoran gratis** via WhatsApp

**Lulus bila semua terpenuhi:**
- [ ] ≥5 audit terkirim
- [ ] ≥2 orang bereaksi kuat terhadap angkanya (bertanya lanjut, minta dihitungkan lagi, cerita ke orang lain)
- [ ] QA P0 100% lulus, nol bug Blocker/Critical
- [ ] B1 selesai — identitas Pengendali Data sah

**Berhenti & ubah arah bila:**
- 15 outreach → 0 respons. **Yang salah segmennya, bukan produknya.** Ganti segmen sebelum menyentuh kode apa pun.

---

## GATE 1 — Soft Launch Tertutup (BERBAYAR)
### 17 Agustus – 27 September 2026 (6 minggu) · maksimal 20 orang

| | |
|---|---|
| **Pertanyaan** | Apakah orang membayar, dan kembali di bulan kedua? |
| **Akses** | Undangan saja. Tidak ada pendaftaran publik |
| **Harga** | **Rp49.000/bulan, harga pendiri, dikunci seumur langganan** |
| **Pembayaran** | Transfer manual. **Jangan bangun sistem penagihan** untuk 20 orang |

**Kenapa periode ini penting:** kampanye **9.9 jatuh di dalamnya**. Pilot Anda akan mengalami momen kaget settlement — omzet melonjak, potongan ikut melonjak — **di dalam aplikasi Anda**. Itu momen emosional terkuat yang bisa Anda dapatkan, dan gratis. Melewatkannya berarti menunggu 11.11.

**Yang Anda lakukan:**
- Dampingi intensif. Ini fase belajar, bukan fase efisiensi
- Rekam setiap percakapan penjualan (dengan izin)
- Isi form baseline sebelum mereka mulai (`SPEC` task C2)
- Latihan respons kebocoran + uji alur hapus data

**Lulus bila:**

| Kriteria | Target 🟡 |
|---|---|
| Pelanggan membayar sukarela | **≥5 orang** |
| Kembali memakai di bulan ke-2 | **≥60%** |
| Aktivasi (sampai lihat Reveal dengan data sendiri) | ≥50% *(boleh dengan bantuan Anda)* |
| Bug Blocker/Critical baru | ≤2, semuanya sudah ditutup |
| Ada yang merekomendasikan ke orang lain tanpa diminta | ≥1 |

🟡 *Angka-angka ini adalah target awal berdasarkan pertimbangan praktis, bukan tolok ukur industri terverifikasi untuk SaaS UMKM Indonesia. Kalibrasi setelah 10 pilot pertama.*

**Berhenti & ubah arah bila:**
- Setelah 15 pilot, **<2 orang mau membayar Rp49rb** → masalahnya bukan fitur dan bukan bug. Masalahnya ada di segmen atau di cara Anda membingkai nilai. **Jangan tambah fitur.** Kembali ke Gate 0 dengan segmen berbeda.
- <30% kembali di bulan kedua → tidak ada ritual bulanan yang terbentuk. Cari tahu kenapa sebelum melangkah.

---

## GATE 2 — Soft Launch Terbuka (Open Beta)
### 28 September – 22 November 2026 (8 minggu)

| | |
|---|---|
| **Pertanyaan** | Apakah orang bisa berhasil **tanpa saya**? |
| **Akses** | Pendaftaran mandiri terbuka |
| **Harga** | Rp49rb (pendiri, 30 orang pertama) → lalu Rp99rb |
| **Akuisisi** | **Nol iklan berbayar.** Hanya referral, konten, kemitraan |

**Perubahan sikap yang menentukan:** di Gate 1 Anda memegangi tangan orang. Di Gate 2 Anda **sengaja menjauh**. Kalau ada yang tersendat, jangan langsung tolong — catat dulu di mana mereka tersendat. Itu datanya. Menolong terlalu cepat menghapus satu-satunya sinyal yang Anda cari di tahap ini.

**Periode ini memuat 11.11** — puncak volume dan puncak biaya iklan marketplace. Momen terbaik untuk konten "reveal kebocoran".

**Lulus bila:**

| Kriteria | Target 🟡 |
|---|---|
| Pelanggan berbayar | **≥30** |
| Aktivasi mandiri (lihat Reveal ≤7 hari, tanpa bantuan Anda) | **≥30%** |
| Churn bulanan | **<10%** |
| Beban dukungan | <2 jam per pelanggan per bulan |
| Biaya akuisisi organik | Diketahui angkanya |

**Berhenti & perbaiki bila:**
- Aktivasi mandiri **<15%** → onboarding rusak. **Hentikan semua pertumbuhan**, perbaiki dulu. Menambah pengguna ke onboarding yang bocor hanya membakar audiens yang mahal dikumpulkan.
- Churn >20%/bulan → produk belum jadi kebiasaan. Cari tahu sebelum membelanjakan apa pun.

---

## GATE 3 — Grand Launch
### Mulai 23 November 2026 — **hanya bila Gate 2 lulus**

| | |
|---|---|
| **Artinya** | Mulai membelanjakan uang & tenaga orang lain untuk akuisisi |
| **Isinya** | Iklan berbayar · freelance sales (Opsi A, paket sekali bayar) · kemitraan berskala · PR |

**Syarat masuk — semua wajib:**
- [ ] ≥30 pelanggan berbayar
- [ ] Churn bulanan <7%
- [ ] LTV/CAC diketahui dan **>3×**
- [ ] Aktivasi mandiri ≥30%
- [ ] Dukungan tidak lagi bergantung pada Anda seorang
- [ ] Sudah ada script penjualan yang terbukti (dari rekaman Gate 1)

**Kalau satu saja tidak terpenuhi: jangan grand launch.** Perpanjang Gate 2. Membelanjakan uang untuk akuisisi sebelum angka-angka ini sehat bukan mempercepat pertumbuhan — itu mempercepat kehabisan uang.

---

## 4.1 Ringkasan ladder

| Gate | Tanggal | Pertanyaan tunggal | Lulus bila |
|---|---|---|---|
| **0** Persiapan & Concierge | 3–16 Agu | Apakah angkanya memicu reaksi? | 5 audit, 2 reaksi kuat, QA P0 100% |
| **1** Soft Launch Tertutup | 17 Agu – 27 Sep | Apakah orang membayar & kembali? | 5 bayar, 60% kembali |
| **2** Soft Launch Terbuka | 28 Sep – 22 Nov | Apakah bisa jalan tanpa saya? | 30 bayar, aktivasi 30%, churn <10% |
| **3** Grand Launch | 23 Nov+ | Bisakah saya beli pertumbuhan? | LTV/CAC >3× |

**Total dari hari ini sampai grand launch: ±16 minggu.** Kalau di tengah jalan ada gerbang yang gagal, itu bukan kemunduran — itu penghematan berbulan-bulan.

---

## 4.2 Keputusan pivotal: gratis atau berbayar di Gate 1?

Ini titik yang paling menentukan, dan Anda belum menyebutkannya di rencana. Saya sajikan kedua opsi secara jujur.

### Opsi A ⭐ — Berbayar sejak hari pertama (rekomendasi)

Rp49.000/bulan, harga pendiri, dikunci seumur langganan, transfer manual.

| ✅ Keunggulan | ⚠️ Risiko |
|---|---|
| Menjawab satu-satunya pertanyaan yang belum terjawab | Membayar untuk produk yang masih ada bug bisa menimbulkan kekecewaan |
| Pengguna berbayar **mengeluh** — dan keluhan adalah feedback yang Anda cari. Pengguna gratis diam lalu hilang | Jumlah pilot akan lebih sedikit dibanding kalau gratis |
| Tidak ada jangkar Rp0 yang harus dilawan nanti | Di komunitas yang erat, satu orang kecewa menyebar cepat |
| Menyaring pilot serius dari yang sekadar penasaran | |

**Cara menekan risikonya:**
- Bingkai jujur: *"Harga pendiri Rp49rb, dikunci selamanya. Sebagai gantinya kamu dapat akses langsung ke saya, dan masukanmu ikut menentukan produk ini."*
- Perjanjian beta tertulis: status beta, bug yang sudah diketahui, tidak ada jaminan hasil
- **Uang kembali tanpa ditanya alasannya**, kapan pun. Ini menghapus hampir seluruh risiko bagi pembeli
- Batasi 20 orang — kelangkaan yang jujur

### Opsi B — Gratis 30 hari dengan komitmen harga di muka

Gratis bulan pertama, tapi harga disebutkan **sebelum** mereka mulai: *"Bulan pertama gratis. Mulai bulan kedua Rp49rb — oke?"* Lalu tagih di hari ke-25.

| ✅ Keunggulan | ⚠️ Kelemahan |
|---|---|
| Friksi masuk lebih rendah, pilot lebih banyak | Sinyal WTP lebih lemah — "iya" di awal ≠ transfer di akhir |
| Tidak ada kekecewaan "bayar untuk produk bermasalah" | Menunda jawaban 30 hari |
| Masih ada jangkar harga (disebut di muka) | Sebagian akan menghilang di hari ke-25 tanpa kabar |

**Rekomendasi: Opsi A.** Alasannya bukan soal uang Rp49rb — nilainya tidak berarti bagi arus kas Anda. Alasannya adalah **kualitas informasi**. Transfer bank adalah satu-satunya sinyal WTP yang tidak bisa dipalsukan oleh kesopanan. Semua sinyal lain — "menarik", "nanti saya coba", "kalau sudah jadi kabari" — bisa berarti apa saja.

Kalau Anda memilih Opsi B, syaratnya satu: **harga harus disebutkan sebelum akses diberikan, bukan sesudah.** Menyebut harga di akhir mengubah eksperimen WTP jadi negosiasi.

---

# 5. INSTRUMEN: PASANG SEBELUM GATE 1, BUKAN SESUDAH

Tanpa ini, Anda akan punya 20 pengguna dan nol pemahaman tentang apa yang mereka lakukan.

**Kabar baiknya: fondasinya sudah ada.** `src/lib/api.js` baris 403 sudah punya fungsi `track(type, meta)` yang menulis ke tabel `app_events`, dan sudah dipakai di `Reports.jsx`. Yang perlu dilakukan hanya memakainya secara konsisten di titik-titik corong.

**Event yang wajib dicatat:**

| Event | Titik pemasangan | Untuk mengukur |
|---|---|---|
| `signup_completed` | `Register.jsx` | Puncak corong |
| `import_started` | `Import.jsx` | Niat |
| `import_completed` | `Import.jsx` — sertakan `confidence` dari task C3 | Keberhasilan teknis |
| `reveal_viewed` | `Reveal.jsx` — sertakan `isDemo: true/false` | **⭐ Momen aktivasi** |
| `reveal_exported` | `Reveal.jsx` (task C1) | Nilai dirasakan |
| `baseline_submitted` | `Setup.jsx` (task C2) | Bahan klaim penjualan |
| `session_return` | `AuthContext` | Retensi |

**Definisi aktivasi — pakai ini, jangan yang lain:**

> Pengguna dianggap **aktif** bila mencapai `reveal_viewed` dengan **datanya sendiri** (`isDemo: false`) dalam **7 hari** setelah mendaftar.

Definisi tunggal yang tegas ini mencegah perdebatan dengan diri sendiri nanti. Semua kriteria kelulusan Gate 2 bergantung padanya.

**Yang lebih penting dari feedback lisan:** perilaku. Orang sering mengatakan hal yang sopan dan melakukan hal yang jujur. Tiga angka ini mengalahkan seluruh isi kotak masuk feedback Anda:

1. Apakah mereka **kembali** di bulan kedua
2. Di **langkah mana persisnya** mereka berhenti
3. Apakah mereka **mengunggah lagi** tanpa diingatkan

---

# 6. PROTOKOL FEEDBACK — INI YANG MEMBUNUH KEBANYAKAN SOFT LAUNCH

Feedback tidak membunuh soft launch karena isinya buruk. Ia membunuh karena **semuanya terasa wajib dikerjakan**.

## 6.1 Klasifikasi wajib

Setiap masukan yang masuk **harus** dimasukkan ke salah satu dari empat kotak. Tanpa klasifikasi, semuanya jadi backlog.

| Kotak | Definisi | Tindakan |
|---|---|---|
| 🐛 **Bug** | Ada yang rusak | Perbaiki menurut severity `QA.md`. Blocker/Critical segera; Major dalam gate ini; Minor ke backlog |
| 🧱 **Friksi** | Berfungsi tapi membingungkan | Perbaiki **hanya bila menghalangi aktivasi** (mencapai Reveal). Selebihnya catat saja |
| 💡 **Permintaan fitur** | "Tolong tambahkan X" | **CATAT SAJA. JANGAN BANGUN.** Lihat aturan 6.2 |
| 📊 **Sinyal** | Cara mereka menjelaskan masalahnya | Masuk ke copy & positioning, **bukan** ke backlog |

**Kotak 📊 adalah yang paling berharga dan paling sering dibuang.** Ketika seorang pilot berkata *"oh jadi ini yang bikin untungku tipis"* — itu bukan feedback produk, itu **kalimat hero landing page Anda**, ditulis oleh pelanggan. Salin mentah-mentah, jangan diparafrase.

## 6.2 Aturan pembangunan fitur selama soft launch

| Gate | Fitur baru yang boleh dibangun |
|---|---|
| **Gate 0** | **0** |
| **Gate 1** | **0** — hanya perbaikan bug & friksi yang menghalangi aktivasi |
| **Gate 2** | **Maksimal 1**, dan hanya bila memenuhi ketiga syarat di bawah |

**Tiga syarat sebelum satu fitur boleh dibangun:**
1. Diminta **≥3 pelanggan berbayar** secara spontan (tidak Anda pancing), **dan**
2. Ketiadaannya **menghalangi retensi** (bukan sekadar diinginkan), **dan**
3. Bisa selesai **<1 minggu**

Kalau ketiganya tidak terpenuhi bersamaan — catat, ucapkan terima kasih, lanjut.

## 6.3 Aturan 1-dari-3

Sebagai patokan kasar: **maksimal 1 dari setiap 3 masukan boleh berubah menjadi pekerjaan** selama soft launch. Kalau rasionya lebih tinggi, Anda bukan sedang menguji pasar — Anda sedang menerima perintah kerja dari orang yang membayar Rp49rb sebulan.

Cara menolak yang tetap menjaga hubungan:

> *"Bagus masukannya, saya catat. Untuk sekarang saya sedang fokus memastikan bagian kebocoran benar-benar akurat dulu. Kalau ternyata banyak yang butuh ini, saya kerjakan setelah itu."*

Jujur, hormat, dan tidak menjanjikan apa pun.

---

# 7. YANG TETAP BENAR DARI RENCANA ANDA

Supaya seimbang — beberapa hal dalam usulan Anda sudah tepat dan sebaiknya dipertahankan:

| Yang benar | Catatan |
|---|---|
| Meluncurkan bertahap, bukan sekaligus | ✅ Keputusan tepat |
| Mengumpulkan feedback pasar sebelum skala | ✅ Tepat — asal ada protokol triase (bagian 6) |
| Memastikan stabilitas sebelum publik luas | ✅ Tepat — asal standarnya `QA.md`, bukan "sempurna" |
| Menunda pengeluaran besar sampai teruji | ✅ Tepat, dan itulah inti Gate 3 |
| Melihat soft launch sebagai fase belajar | ✅ Tepat — yang perlu diperjelas hanya: belajar **apa**, dan kapan berhenti belajar |

Yang saya ubah hanya **definisi, kriteria, dan batas waktunya** — bukan strateginya.

---

# 8. TIGA KESALAHAN YANG PALING MUNGKIN ANDA LAKUKAN

Ditulis di sini supaya Anda bisa mengenalinya saat terjadi.

**1. Memperpanjang Gate 1 karena "belum sempurna."**
Ini akan terasa sangat masuk akal saat terjadi. Selalu ada satu bug lagi, satu perbaikan lagi. Tanggal 27 September adalah tanggal mati. Kalau Gate 1 belum lulus di tanggal itu, jawabannya bukan memperpanjang — jawabannya adalah **mengakui bahwa jawabannya tidak**, dan mengubah sesuatu yang mendasar.

**2. Membangun fitur karena satu pilot memintanya dengan meyakinkan.**
Pilot yang paling vokal biasanya bukan pilot yang paling representatif. Terapkan aturan tiga syarat di 6.2 tanpa pengecualian.

**3. Menunda meminta uang sampai "produknya pantas."**
Produk tidak akan pernah terasa pantas. Dan setiap minggu Anda menunda pertanyaan itu adalah seminggu keputusan yang diambil tanpa informasi. Minta di minggu pertama Gate 1, bukan di minggu terakhir.

---

# 9. YANG DIKERJAKAN MINGGU INI

| Hari | Aksi |
|---|---|
| **Sen 3 Agu** | Task B1 (identitas Pengendali Data). Tetapkan 4 tanggal gate di kalender — sebagai janji, bukan perkiraan |
| **Sel 4 Agu** | Task B2 (disclaimer REFERENSI untuk KUR & Pajak) |
| **Rab 5 Agu** | Susun daftar 30 seller. Kirim 15 pesan audit gratis |
| **Kam 6 Agu** | Task B3 (hero + section Reveal di landing) |
| **Jum 7 Agu** | Jalankan `QA.md` P0 sampai tuntas — **catat hasilnya secara tertulis** |
| **Sab–Min** | Olah audit yang masuk, kirim balik 1 halaman + satu kalimat tajam |

Minggu depan: B4, C1, pasang telemetri, siapkan perjanjian beta — lalu Gate 1 dibuka 17 Agustus.

---

# 10. CATATAN KETERBATASAN

| Hal | Status |
|---|---|
| Angka kriteria kelulusan (5 bayar, 60% kembali, 30% aktivasi, churn <10%, LTV/CAC >3) | 🟡 **Target awal berbasis pertimbangan praktis**, bukan tolok ukur terverifikasi untuk SaaS UMKM Indonesia. Kalibrasi setelah 10 pilot pertama |
| Konversi gratis→bayar 3–8% | 🟡 Dari dokumen `03_Pricing` Anda sendiri, ditandai di sana sebagai estimasi umum |
| Sanksi & kewajiban UU PDP | 🟡 Dari audit internal Anda. **Bukan nasihat hukum** — verifikasi dengan konsultan sebelum keputusan berisiko |
| Efek jangkar harga (Rp0 → berbayar) | 🟡 Prinsip perilaku yang mapan, tapi besarannya tidak terukur untuk kasus Anda |
| Preseden BukuKas & BukuWarung | ✅ Tercatat di audit internal Anda |
| Referensi kode (`api.js:403` `track()`, `app_events`, `QA.md`, `legal.js`) | ✅ Diverifikasi langsung dari repo, 3 Agustus 2026 |
| Tanggal kampanye 9.9 & 11.11 | ✅ Tanggal kalender tetap |
| Perhitungan tanggal gate | ✅ Diverifikasi |

---

*Satu kalimat penutup: soft launch yang baik bukan yang paling mulus, tapi yang paling cepat memberi tahu Anda apakah harus melanjutkan.*
