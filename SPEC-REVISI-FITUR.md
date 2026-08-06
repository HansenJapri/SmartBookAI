# SPEC REVISI FITUR — SmartBook AI
## Dokumen kerja untuk Claude Code

> **Cara pakai:** buka Claude Code di root repo, lalu instruksikan: *"Baca `SPEC-REVISI-FITUR.md`, kerjakan Bagian B urut dari B1."* Kerjakan **per task**, bukan sekaligus.
>
> **Versi:** 1.0 · **Tanggal:** 2 Agustus 2026
> **Basis:** pembacaan kode aktual per 2 Agustus 2026 (bukan audit Juli — beberapa item audit lama sudah selesai dan **tidak** dimasukkan ke sini).

---

# 0. KONTEKS & ATURAN MAIN

## 0.1 Tujuan revisi ini

Produk sudah lengkap secara teknis (26 modul, RLS penuh, AI tersambung). Yang belum: **produk belum bisa menjual dirinya sendiri, dan belum siap dipegang orang luar.**

Tiga sasaran dokumen ini:

1. **Menonjolkan pembeda yang sudah ada tapi tersembunyi** — `Reveal` sudah dibangun dengan baik (`reveal.js` menghitung `marginAsli` vs `marginDikira`), tapi **tidak muncul sama sekali di landing page**. Ini gap terbesar.
2. **Membuat laporan KUR & Pajak aman secara hukum** — fitur dipertahankan, tapi **wajib berlabel referensi/estimasi** di setiap titik keluaran.
3. **Menambah instrumen pengukuran** supaya klaim penjualan bisa berbasis data nyata, bukan karangan.

## 0.2 Aturan yang tidak boleh dilanggar

| # | Aturan |
|---|---|
| 1 | **Jangan menambah modul baru.** Semua task di sini adalah revisi/upgrade fitur yang sudah ada, kecuali yang ditandai `[BARU]` (hanya 2 task) |
| 2 | **Jangan ubah skema DB tanpa file migration baru** di `supabase/`. Ikuti pola penamaan yang sudah ada (`migration_*.sql`) |
| 3 | **Jangan sentuh RLS policy** yang sudah berjalan. Kalau task butuh kolom baru, tambahkan dengan policy yang mengikuti pola tabel induknya |
| 4 | **Jangan hapus fitur.** Yang diminta "sembunyikan" berarti dihapus dari navigasi/landing, **bukan** dari kode |
| 5 | **Jalankan `npx vitest run`** setelah setiap task. Test yang sudah ada harus tetap hijau |
| 6 | **Jalankan `graphify update .`** setelah task selesai (tanpa biaya API) |
| 7 | **Bahasa UI: Indonesia.** Ikuti pola `useLang()` / `LangContext` yang sudah ada — jangan hardcode string kalau file itu sudah memakai sistem bahasa |
| 8 | **Satu task = satu commit.** Pesan commit: `[ID] deskripsi singkat` |

## 0.3 Status yang sudah beres — JANGAN dikerjakan ulang

Pembacaan kode terkini menunjukkan ini sudah selesai. Kalau menemukan dokumen audit lama yang menyuruh mengerjakannya, abaikan:

- ✅ Footer landing sudah punya tautan `/privasi` dan `/ketentuan` (`Landing.jsx` baris ~276–281)
- ✅ Klaim "Siap diajukan ✓" sudah tidak ada di mana pun. `Reports.jsx` sudah memakai "Dapat dilampirkan untuk pengajuan KUR"
- ✅ Disclaimer pajak sudah ada di PDF pajak (`Reports.jsx` baris ~205)
- ✅ `TX_FETCH_LIMIT` sudah dinaikkan ke 5000 + ada RPC server `my_monthly_summary` + peringatan data terpotong
- ✅ `marketplaceFees.js` sudah mendukung 5 platform dengan deteksi kolom berbasis sinonim
- ✅ Monitoring error sudah ada (`monitoring.js` → tabel `app_events`)
- ✅ 2FA sudah ada (`TwoFactor.jsx`, `MfaChallenge.jsx`)
- ✅ AI sudah tersambung nyata (14 Edge Function di `supabase/functions/`)
- ✅ Unit test sudah ada untuk logika berbahaya (`src/lib/__tests__/`)

---

# A. FITUR YANG DIPERTAHANKAN — JANGAN DIUTAK-ATIK

Fitur di bawah ini adalah inti produk dan kualitasnya sudah baik. **Jangan refactor, jangan "rapikan", jangan optimasi** kecuali ada task eksplisit di Bagian B/C.

| Fitur | File | Kenapa dipertahankan apa adanya |
|---|---|---|
| **Reveal / Deteksi Kebocoran** | `src/lib/reveal.js` | Logika `revealLeak()` sudah benar: memisahkan `FEE_CATEGORIES` dari `opex`, menghitung `marginAsli` vs `marginDikira`, rincian `perChannel` dengan `pct`. **Ini pembeda utama produk.** UI-nya butuh promosi (Bagian B), logikanya tidak butuh apa-apa |
| **Import laporan marketplace** | `src/lib/marketplaceFees.js` | Deteksi kolom berbasis sinonim lintas 5 platform + rekonstruksi gross dari net + penandaan "Potongan lain". Arsitekturnya tepat |
| **Parser CSV/Excel** | `src/lib/csvImport.js` | Pipeline paling matang di repo |
| **Auto-kategorisasi** | `src/lib/categorize.js` | Rule-based, murah, teruji |
| **Deteksi duplikat** | `findDuplicateGroups` | Berfungsi, ada test |
| **Isolasi workspace & RLS** | `wsOwner()`, `wsSelect()`, `tenancy.guard.test.js` | 96 edge di graph — ini tulang punggung keamanan. **Sentuh hanya kalau benar-benar terpaksa** |
| **Autentikasi + OTP + 2FA + AppLock** | `AuthContext`, `auth-login-otp`, `TwoFactor`, `applock.js` | Sudah lengkap dan teruji |
| **Sistem legal & consent** | `legal.js`, `LegalDoc`, `PrivacyContent`, `DisclaimerGate`, `AIDisclaimer` | Fondasinya benar. Hanya nilai konstantanya yang perlu diisi (task B1) |
| **HPP** | `src/lib/hpp.js`, `Hpp.jsx` | Relevan untuk FnB & produksi — ICP sekunder |
| **Radar Harga Makro + RAG** | `radar.js`, `ragPrice.js`, `sp2kp.js` | Unik, sudah ada test. Bukan alasan orang membayar, tapi jangan dibongkar |
| **Struk / OCR** | `Struk.jsx`, `ai-struk` | Titik friksi terendah — kandidat pintu masuk onboarding |
| **Laporan Keuangan + KUR + Pajak** | `Reports.jsx` | **Dipertahankan penuh.** Hanya butuh pelabelan disclaimer yang konsisten (task B2) |

---

# B. REVISI — WAJIB DIKERJAKAN

## B1 — Isi identitas Pengendali Data 🔴 BLOCKER

**File:** `src/lib/legal.js`

**Kondisi sekarang:**
```js
export const CONTROLLER_NAME = 'Pengelola SmartBook AI'   // generik, bukan badan hukum
export const CONTACT_EMAIL = 'sovralyticstech@gmail.com'  // Gmail pribadi
export const TERMS_VERSION = 'v3'
```

**Yang harus dilakukan:**
1. Ganti `CONTROLLER_NAME` dengan nama badan usaha / identitas resmi yang bisa dituntut dan dihubungi.
2. Ganti `CONTACT_EMAIL` ke email berdomain usaha (mis. `privasi@domainanda.com`). **Jangan Gmail.**
3. Naikkan `TERMS_VERSION` ke `'v4'` dan perbarui `TERMS_EFFECTIVE` ke tanggal hari ini.
4. Pastikan perubahan versi memicu dialog persetujuan ulang untuk pengguna lama (cek alur `TERMS_ACK_KEY` + kolom `accepted_terms`).

> ⚠️ **Nilai asli harus diisi oleh Founder, bukan ditebak.** Kalau nilainya belum tersedia, hentikan task ini dan laporkan — jangan isi placeholder baru.

**Kriteria terima:**
- [ ] Tidak ada Gmail di `legal.js`
- [ ] Halaman `/privasi` dan `/ketentuan` menampilkan identitas baru
- [ ] Pengguna lama diminta menyetujui ulang saat login berikutnya
- [ ] `npx vitest run` hijau

---

## B2 — Label "REFERENSI" konsisten untuk KUR & Pajak 🔴 PRIORITAS FOUNDER

**File:** `src/pages/Reports.jsx` · `src/components/AIDisclaimer.jsx` (rujukan pola)

**Kondisi sekarang:** disclaimer sudah ada, tapi **tidak merata**. PDF pajak punya (baris ~205), sementara ekspor Excel, laporan KUR, dan tampilan layar belum konsisten.

**Yang harus dilakukan — disclaimer wajib muncul di 5 titik:**

| # | Titik keluaran | Yang ditambahkan |
|---|---|---|
| 1 | **Layar, sebelum tombol unduh** | Blok peringatan permanen (bukan tooltip, bukan yang bisa ditutup) |
| 2 | **Footer setiap halaman PDF** (KUR & Pajak) | Teks disclaimer di semua halaman, bukan hanya halaman terakhir |
| 3 | **Sheet pertama setiap ekspor Excel** | Baris disclaimer di atas data, sebelum tabel dimulai |
| 4 | **Nama file** | Awali dengan `Referensi-` → `Referensi-Rekap-Pajak-{nama}-{tahun}.pdf` |
| 5 | **Modal konfirmasi sebelum unduh** | Sekali per sesi, wajib klik "Saya mengerti" |

**Teks baku — pakai persis ini, jangan diparafrase:**

Untuk laporan **Pajak**:
```
REFERENSI — BUKAN DOKUMEN RESMI PERPAJAKAN.
Perhitungan ini adalah estimasi alat bantu berdasarkan PP 55/2022 dan UU 7/2021 (HPP),
dihitung dari data yang Anda masukkan sendiri. Angka dapat berbeda dari kewajiban
pajak sebenarnya. Wajib diverifikasi ulang dengan DJP atau konsultan pajak sebelum
digunakan untuk pelaporan apa pun. SmartBook AI tidak bertanggung jawab atas
keputusan perpajakan yang diambil berdasarkan dokumen ini.
```

Untuk laporan **KUR**:
```
REFERENSI — BUKAN JAMINAN PERSETUJUAN KREDIT.
Laporan ini disusun dari data yang Anda masukkan sendiri dan dapat dilampirkan sebagai
dokumen pendukung. Keputusan pemberian KUR sepenuhnya ada pada bank penyalur dan
mengacu pada penilaian SLIK OJK serta kebijakan internal bank. Kelengkapan laporan
ini tidak menentukan kelolosan pengajuan. Verifikasi kembali seluruh angka sebelum
diserahkan ke pihak mana pun.
```

**Tambahan UI:** beri badge `REFERENSI` (warna kuning/amber) di sebelah judul kedua laporan, di layar maupun di header PDF.

**Kriteria terima:**
- [ ] Unduh PDF pajak → disclaimer ada di **setiap** halaman
- [ ] Unduh PDF KUR → disclaimer KUR ada di **setiap** halaman
- [ ] Unduh Excel → baris disclaimer ada di sheet pertama, di atas tabel
- [ ] Semua nama file berawalan `Referensi-`
- [ ] Modal konfirmasi muncul sekali per sesi
- [ ] Badge `REFERENSI` terlihat di layar

---

## B3 — Landing page: munculkan Reveal 🔴 DAMPAK TERBESAR

**File:** `src/pages/Landing.jsx` (+ file bahasa terkait)

**Kondisi sekarang:** kata "Reveal" / "kebocoran" **nol kemunculan** di landing. Satu-satunya hasil pencarian adalah komentar CSS `reveal-on-scroll` yang tidak berhubungan. Pembeda terkuat produk ini tidak dipasarkan sama sekali.

**Yang harus dilakukan:**

**(a) Ganti hero.** Struktur baru:
- Headline: **"Omzetmu Rp50 juta. Yang masuk rekening Rp43 juta. Ke mana Rp7 juta-nya?"**
- Subheadline: *"SmartBook AI menyatukan semua channel jualanmu dan menunjukkan berapa yang hilang di biaya admin, ongkir, dan iklan — sebelum uangnya sampai ke kamu."*
- CTA utama: **"Lihat contoh laporan kebocoran"** → arahkan ke demo data contoh (task B4), **bukan** ke form pendaftaran
- CTA sekunder: "Masuk"

**(b) Tambah section "Reveal" tepat di bawah hero** — section paling atas setelah hero:
- Screenshot/replika komponen KPI dari `Reveal.jsx`: angka kebocoran (merah), `leakPct`, dan **`marginAsli` vs `marginDikira` bersebelahan**
- Tabel rincian per channel: nama channel · omzet kotor · potongan · net · % potongan
- Caption: *"Angka contoh. Dengan datamu sendiri, angkanya jadi milikmu."*

**(c) Susun ulang urutan fitur** — sebut **maksimal 3** di bagian utama:
1. Import multi-channel (Shopee, Tokopedia, TikTok, Lazada, Blibli)
2. Reveal kebocoran + margin asli per channel
3. Laporan keuangan, KUR & Pajak *(dengan catatan kecil: "sebagai referensi")*

**(d) Sembunyikan dari landing** (tetap ada di aplikasi): Payroll, Absensi, KPI, Data Karyawan, Purchase Order, Stock Opname, Supplier, Papan Tugas, Invoice, Feedback.

**(e) Tambah blok "Apa yang TIDAK kami lakukan dengan datamu"** — 3 poin bahasa awam: data tidak dijual, tidak dibagikan ke pihak ketiga untuk pemasaran, bisa diekspor & dihapus kapan saja.

**(f) Audit setiap klaim.** Untuk setiap kalimat di landing, pastikan bisa dibuktikan dalam demo 3 menit. Kalau tidak bisa — hapus. Khusus kata "AI": pakai hanya untuk fitur yang benar-benar memanggil Edge Function AI (kategori, struk, chat, narasi). Untuk yang rule-based, tulis "otomatis".

**Kriteria terima:**
- [ ] Kata "kebocoran" muncul di layar pertama tanpa perlu scroll
- [ ] Section Reveal ada dengan `marginAsli` vs `marginDikira` bersebelahan
- [ ] Maksimal 3 fitur di bagian utama
- [ ] 10 modul di poin (d) tidak muncul di landing
- [ ] Blok transparansi data ada
- [ ] Tidak ada klaim yang tidak bisa didemonstrasikan

---

## B4 — Aha-moment < 60 detik lewat data contoh 🟠

**File:** `src/pages/Dashboard.jsx` · `src/lib/sampleData.js` · `src/pages/Reveal.jsx` · `src/pages/Landing.jsx`

**Kondisi sekarang:** `sampleTransactions` sudah diimpor di `Dashboard.jsx`, dan `Import.jsx` punya `downloadSample()` — tapi itu **mengunduh file CSV**, yang justru menambah friksi. Belum ada jalur "lihat hasilnya sekarang tanpa melakukan apa-apa".

**Yang harus dilakukan:**
1. Buat mode demo yang bisa diakses **tanpa login** di rute `/demo`.
2. Mode ini memuat `sampleTransactions` ke state (**tidak menyentuh database sama sekali**) dan langsung menampilkan **halaman Reveal**, bukan Dashboard. Reveal adalah momen "aha"-nya; Dashboard hanya ringkasan.
3. Pastikan `sampleTransactions` menghasilkan angka yang **realistis, bukan dramatis** — kebocoran 15–20% dari omzet kotor, tersebar di ≥3 channel, dengan `marginDikira` sekitar 22% dan `marginAsli` sekitar 14%.
4. Banner tetap di atas: *"Ini data contoh. Masuk untuk memakai datamu sendiri."* + tombol Daftar.
5. Hubungkan CTA hero landing (task B3) ke rute ini.

**Kriteria terima:**
- [ ] `/demo` bisa dibuka tanpa login
- [ ] Dari klik CTA sampai angka kebocoran terlihat: **< 5 detik, nol input**
- [ ] Tidak ada satu pun query tulis ke database di mode demo
- [ ] Angka contoh masuk akal untuk seller multi-channel

---

## B5 — Nomor telepon jadi opsional 🟠

**File:** `src/pages/Register.jsx`

**Kondisi sekarang:** telepon wajib saat daftar, padahal OTP telepon belum aktif. Ini friksi tanpa manfaat + mengumpulkan data sensitif yang tidak dipakai — bertentangan dengan prinsip minimalisasi data UU PDP.

**Yang harus dilakukan:**
1. Ubah field telepon jadi opsional, tambahkan label "(opsional)".
2. Pertahankan validasi format dan normalisasi `+62` **hanya kalau diisi**.
3. Pertahankan pengecekan duplikat nomor **hanya kalau diisi**.
4. Pindahkan pengisian telepon ke `Settings.jsx` sebagai data pelengkap.

**Kriteria terima:**
- [ ] Bisa mendaftar tanpa mengisi telepon
- [ ] Kalau diisi, validasi & normalisasi tetap jalan
- [ ] `auth.otp.test.js` tetap hijau

---

## B6 — Tandai baris dengan tanggal meragukan saat impor 🟠

**File:** `src/lib/csvImport.js` (fungsi `parseDate`) · `src/pages/Import.jsx`

**Kondisi sekarang:** kalau parsing tanggal gagal, sistem diam-diam memakai tanggal hari ini. Akibatnya transaksi masuk ke periode yang salah **tanpa peringatan apa pun** — laporan bulanan jadi salah dan tidak ada yang tahu.

**Yang harus dilakukan:**
1. Saat `parseDate` gagal, tandai baris dengan flag `date_uncertain: true` alih-alih diam-diam memakai hari ini.
2. Di layar pratinjau impor, kelompokkan baris bertanda ini di bagian terpisah: *"N baris tanggalnya tidak terbaca — periksa sebelum menyimpan."*
3. Beri user 3 pilihan: perbaiki manual · pakai tanggal hari ini · lewati baris.
4. Tambah unit test di `src/lib/__tests__/logic.test.js` untuk format tanggal yang gagal.

**Kriteria terima:**
- [ ] Impor file dengan tanggal rusak → muncul peringatan, bukan diam
- [ ] User bisa memilih tindakan
- [ ] Ada test baru yang menutupi kasus ini

---

# C. UPGRADE — TAMBAHAN KEMAMPUAN PADA FITUR YANG SUDAH ADA

## C1 — Ekspor "Laporan Kebocoran" 1 halaman `[BARU]` ⭐ NILAI TERTINGGI

**File:** `src/pages/Reveal.jsx` · `src/lib/invoice.js` (rujukan pola jsPDF)

**Kenapa ini prioritas:** Founder akan menjalankan 5–10 "audit kebocoran gratis" sebagai aktivitas penjualan utama. Saat ini laporannya harus disusun manual satu per satu. Fitur ini mengubah pekerjaan 30 menit jadi satu klik — dan hasilnya adalah **aset penjualan paling penting** yang dimiliki produk ini.

**Yang harus dilakukan — PDF 1 halaman, urutan tetap:**

| Bagian | Isi |
|---|---|
| Header | Nama usaha · periode · logo |
| **Angka utama** (paling besar di halaman) | Total kebocoran dalam rupiah + `leakPct` |
| **Perbandingan margin** | `marginDikira` vs `marginAsli` bersebelahan, dengan selisih poin persen ditonjolkan |
| Rincian biaya | 3 baris: Biaya Admin · Ongkir · Iklan — nominal + % dari omzet kotor |
| Tabel per channel | Diurutkan dari potongan terbesar: channel · gross · fee · net · pct |
| **Satu kalimat kesimpulan** | Dihasilkan otomatis, template: *"Dari omzet kotor {gross}, sebanyak {leak} ({pct}%) habis sebelum masuk rekening. Margin aslimu {marginAsli}%, bukan {marginDikira}%."* |
| Footer | Disclaimer: *"Dihitung dari data yang Anda masukkan. Verifikasi dengan laporan resmi marketplace."* |

Nama file: `Laporan-Kebocoran-{namaUsaha}-{periode}.pdf`

**Kriteria terima:**
- [ ] Satu halaman, terbaca jelas saat dibuka di HP
- [ ] Semua angka konsisten dengan yang tampil di layar Reveal
- [ ] Kalimat kesimpulan terisi otomatis dan tata bahasanya benar
- [ ] Berfungsi juga di mode demo (task B4)

---

## C2 — Simpan "margin yang kamu kira" sebagai baseline `[BARU]` ⭐

**File:** migration baru `supabase/migration_baseline.sql` · `src/pages/Setup.jsx` · `src/pages/Reveal.jsx`

**Kenapa ini penting:** ini instrumen yang mengubah produk jadi mesin pengumpul bukti. Selisih antara **tebakan pengguna** dan **angka asli** adalah nilai produk dalam satu angka — dan sekaligus materi penjualan yang bisa dipakai selama 12 bulan.

**Yang harus dilakukan:**

1. **Migration:** tabel `user_baseline`
   ```
   user_id (FK, RLS mengikuti pola tabel workspace)
   margin_perceived   numeric   -- tebakan margin bersih (%)
   hours_monthly      numeric   -- jam per bulan untuk rekap manual
   channels_count     int
   fees_known         text[]    -- biaya yang mereka sadar ada
   created_at         timestamptz
   ```
   RLS: user hanya bisa membaca/menulis barisnya sendiri. Ikuti pola `wsOwner()`.

2. **Saat onboarding** (`Setup.jsx`), 3 pertanyaan opsional — bisa dilewati:
   - "Menurut perkiraanmu, berapa persen margin bersihmu bulan lalu?"
   - "Berapa jam kamu habiskan untuk merekap semua channel bulan lalu?"
   - "Biaya marketplace apa saja yang kamu hitung?" (checkbox: admin · ongkir · iklan · program gratis ongkir · potongan lain)

3. **Di halaman Reveal**, kalau baseline ada, tampilkan kartu pembanding:
   > *"Kamu memperkirakan margin 22%. Angka sebenarnya 14%. Selisihnya 8 poin persen."*

4. Kalau baseline kosong, jangan tampilkan apa pun. Jangan memaksa.

**Kriteria terima:**
- [ ] Migration jalan tanpa error, RLS teruji (user A tidak bisa baca baseline user B)
- [ ] Onboarding bisa dilewati tanpa mengisi
- [ ] Kartu pembanding muncul hanya kalau baseline ada
- [ ] Ada test RLS di `tenancy.guard.test.js`

---

## C3 — Diagnostik impor marketplace 🟠

**File:** `src/lib/marketplaceFees.js` · `src/pages/Import.jsx`

**Kondisi sekarang:** deteksi kolom berbasis sinonim sudah bagus, tapi **diam** saat gagal. Kalau kolom biaya iklan tidak terdeteksi, angka kebocoran jadi terlalu kecil — dan tidak ada yang tahu. Untuk fitur yang menjadi pembeda utama, kegagalan diam adalah risiko terbesar.

**Yang harus dilakukan:**
1. `parseMarketplaceReport()` mengembalikan objek diagnostik tambahan:
   ```js
   { platform, matched: { gross:'Total Harga Produk', admin:'Biaya Administrasi', ... },
     unmatched: ['iklan','ongkir'], unknownColumns: [...],
     unexplainedAmount: 125000, rowCount, confidence: 'tinggi'|'sedang'|'rendah' }
   ```
2. `confidence`: **tinggi** = gross + ≥2 kolom biaya terdeteksi · **sedang** = gross + 1 biaya · **rendah** = gross direkonstruksi dari net, atau tidak ada kolom biaya terdeteksi.
3. Di layar pratinjau impor, tampilkan hasilnya:
   - Kolom yang cocok (hijau), yang tidak ditemukan (kuning)
   - Kalau `confidence === 'rendah'`: peringatan **"Angka kebocoran mungkin tidak lengkap — beberapa kolom biaya tidak terdeteksi di file ini."**
   - Daftar kolom file yang tidak dikenali, supaya sinonim baru bisa ditambahkan
4. Simpan `confidence` di batch impor agar Reveal bisa menandai periode berdasarkan data berkeyakinan rendah.

**Kriteria terima:**
- [ ] Impor file lengkap → confidence "tinggi", nol peringatan
- [ ] Impor file tanpa kolom iklan → confidence turun + peringatan muncul
- [ ] Kolom tak dikenal terdaftar dan bisa disalin
- [ ] Test dengan minimal 2 format berbeda

---

## C4 — Perbandingan periode di Reveal 🟡

**File:** `src/lib/reveal.js` · `src/pages/Reveal.jsx`

**Kenapa:** angka satu bulan itu informasi. Angka dua bulan berdampingan itu **keputusan**. Ini juga yang membuat orang membuka aplikasi setiap bulan — mesin retensi.

**Yang harus dilakukan:**
1. Tambah fungsi `revealCompare(transactions, periodA, periodB)` di `reveal.js` yang memakai ulang `revealLeak()` — jangan duplikasi logika.
2. Kembalikan delta untuk: `leak`, `leakPct`, `marginAsli`, dan per channel.
3. Di UI, tampilkan panah naik/turun dengan warna: potongan naik = merah, turun = hijau.
4. Sorot perubahan terbesar: *"Biaya iklan Shopee naik 34% dibanding bulan lalu."*
5. Tambah unit test di `src/lib/__tests__/`.

**Kriteria terima:**
- [ ] Perbandingan tampil kalau ada ≥2 bulan data
- [ ] Kalau data hanya 1 bulan, tidak error dan tidak menampilkan kolom kosong
- [ ] Ada test

---

## C5 — Lampirkan ringkasan Reveal ke laporan KUR 🟡

**File:** `src/pages/Reports.jsx`

**Kenapa:** laporan KUR saat ini hanya laba-rugi standar — sama seperti yang bisa dihasilkan aplikasi mana pun. Menambahkan halaman rincian biaya channel membuatnya berbeda, dan menunjukkan ke bank bahwa pemilik usaha memahami struktur biayanya sendiri.

**Yang harus dilakukan:**
1. Tambah satu halaman di PDF KUR: "Rincian Biaya Penjualan per Channel", mengambil dari `revealLeak()`.
2. Tetap berlabel **REFERENSI** sesuai task B2.
3. Jadikan opsional lewat checkbox: "Sertakan rincian biaya per channel".

**Kriteria terima:**
- [ ] Halaman tambahan muncul saat checkbox aktif
- [ ] Angka konsisten dengan halaman Reveal
- [ ] Disclaimer B2 tetap ada di halaman baru ini

---

# D. TUNDA / SEMBUNYIKAN

Fitur di bawah **tetap ada di kode dan tetap berfungsi**. Yang diminta hanyalah menghapusnya dari jalur utama supaya produk punya satu cerita, bukan sepuluh.

| Fitur | File | Tindakan |
|---|---|---|
| Payroll · Absensi · KPI · Data Karyawan | `Payroll.jsx`, `Attendance.jsx`, `Kpi.jsx`, `Employees.jsx` | Kelompokkan di navigasi bawah menu **"Karyawan"** yang tertutup secara default. Hapus dari landing |
| Purchase Order · Stock Opname · Supplier | `PurchaseOrders.jsx`, `Opname.jsx`, `Supplier.jsx` | Kelompokkan di menu **"Gudang"** yang tertutup default. Hapus dari landing |
| Papan Tugas | `Tasks.jsx` | Sembunyikan dari navigasi utama |
| Invoice | `InvoiceModal.jsx`, `invoice.js` | Pertahankan sebagai aksi di dalam transaksi, hapus dari menu utama |
| Forum Feedback | `Feedback.jsx` | Ganti jadi tautan ke grup WhatsApp. Jangan dikembangkan lagi |
| Admin Dashboard | `admin-dashboard/` | **Jangan sentuh sama sekali.** Pakai Supabase Table Editor sampai >100 user |
| Voice Interaction | `voice-live-token` | Jangan kembangkan. Jangan sebut di landing |
| OTP telepon | — | Tetap tunda |

**Aturan navigasi setelah revisi** — menu utama maksimal 7 item:
`Dashboard · Transaksi · Impor · Reveal · Stok · Laporan · Pengaturan`

---

# E. URUTAN EKSEKUSI

| Urutan | Task | Perkiraan | Alasan urutan |
|---|---|---|---|
| 1 | **B1** | 30 mnt | Blocker legal. Semua hal lain menunggu ini |
| 2 | **B2** | 3 jam | Permintaan eksplisit Founder. Menutup risiko liability |
| 3 | **B3** | 4 jam | Dampak penjualan terbesar |
| 4 | **B4** | 3 jam | Melengkapi B3 — CTA hero butuh tujuan |
| 5 | **C1** | 3 jam | Aset penjualan yang dipakai setiap hari mulai minggu ini |
| 6 | **B5 + B6** | 2 jam | Cepat, menurunkan friksi & risiko data salah |
| 7 | **C3** | 4 jam | Melindungi pembeda utama dari kegagalan diam |
| 8 | **C2** | 4 jam | Instrumen pengukuran — makin cepat dipasang, makin cepat ada data |
| 9 | **D** | 2 jam | Rapikan navigasi |
| 10 | **C4 + C5** | 5 jam | Retensi & nilai tambah laporan |

**Total: ± 30 jam.** Kalau harus memilih hanya 5: **B1 → B2 → B3 → B4 → C1.**

---

# F. VERIFIKASI AKHIR

Jalankan setelah seluruh Bagian B selesai:

```bash
npx vitest run          # semua test hijau
npm run build           # build sukses, nol error
graphify update .       # perbarui knowledge graph
```

**Uji manual — checklist:**

- [ ] Buka landing → kata "kebocoran" terlihat tanpa scroll
- [ ] Klik CTA hero → halaman Reveal dengan data contoh muncul **< 5 detik**
- [ ] Daftar akun baru **tanpa mengisi telepon** → berhasil
- [ ] Impor file marketplace asli (Shopee/Tokopedia) → cek diagnostik & confidence
- [ ] Buka Reveal → `marginAsli` vs `marginDikira` tampil berdampingan
- [ ] Unduh Laporan Kebocoran PDF → 1 halaman, terbaca di HP
- [ ] Unduh laporan Pajak → disclaimer REFERENSI di **setiap** halaman, nama file berawalan `Referensi-`
- [ ] Unduh laporan KUR → disclaimer KUR di **setiap** halaman
- [ ] Menu utama maksimal 7 item
- [ ] Console browser bersih, nol error

---

# G. YANG TIDAK BOLEH DIKERJAKAN

| ❌ Jangan | Alasan |
|---|---|
| Menambah modul baru di luar C1 & C2 | Scope freeze. 26 modul dengan 0 pelanggan sudah terlalu banyak |
| Refactor `wsOwner()` / `wsSelect()` / RLS | 96 edge di graph. Risiko kebocoran data antar-user terlalu besar untuk perbaikan kosmetik |
| Menyentuh `admin-dashboard/` | Prematur untuk 0 user |
| Mengembangkan Voice Interaction | Belum terverifikasi, menambah pesan kedua yang melemahkan fokus |
| Mengganti library atau upgrade mayor dependency | Tidak ada hubungan dengan sasaran dokumen ini |
| Menyalakan AI/OCR untuk tier gratis | Free-rider akan membakar biaya. AI hanya untuk tier berbayar |
| Menambah klaim baru di landing tanpa bukti | Setiap klaim harus bisa didemonstrasikan dalam 3 menit |
| Menghapus fitur dari kode | Yang diminta "sembunyikan", bukan "hapus" |

---

*Setiap task di dokumen ini punya kriteria terima yang bisa diuji. Kalau sebuah task tidak bisa diselesaikan sampai memenuhi kriterianya, hentikan dan laporkan — jangan tandai selesai sebagian.*
