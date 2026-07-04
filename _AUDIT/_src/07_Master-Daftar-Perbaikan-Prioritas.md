# BukuPintar AI — Master Daftar Perbaikan (Prioritas)
## Konsolidasi semua dokumen audit → Kritis / High / Medium / Low

> Tujuan: satu daftar tindakan yang bisa langsung Anda kerjakan. Tiap item: **Kenapa** (dampak/risiko), **Lakukan** (aksi konkret), **Lokasi** (file/area).
> **Dikecualikan sesuai permintaan Anda:** (1) desain/penyetelan revenue stream & billing, (2) poin "permintaan data bank perlu diperbaiki". Keduanya tidak dimasukkan.

---

## Sudah beres — JANGAN diulang (kredit untuk Anda)

Dari pembacaan kode terkini, ini sudah Anda kerjakan sejak audit awal:
- **Halaman Kebijakan Privasi (/privasi)** + pencatatan **consent** (accepted_terms + versi) + dokumen legal → gap UU PDP terbesar sudah ditutup sebagian besar.
- **AI benar-benar tersambung**: chatbot (`askAI`) + baca struk/OCR (`readReceipt`) via Edge Function.
- **Rekonsiliasi diperdalam**: fitur **Reveal Kebocoran** (pemisahan biaya admin/ongkir/iklan lintas marketplace).
- **UI dirapikan** (ikon lucide, tanpa emoji).

Sisanya di bawah ini adalah yang **masih perlu** dikerjakan.

---

## KRITIS (kerjakan lebih dulu — risiko fatal atau pemblokir)

**K1. Validasi kemauan bayar sebelum menambah fitur apa pun.**
- **Kenapa:** Ini risiko terbesar di seluruh audit. Belum ada bukti seorang pun mau membayar & memakai ulang. Tanpa ini, semua perbaikan teknis bisa sia-sia.
- **Lakukan:** 10 obrolan Mom Test + 3–5 pilot concierge memakai Kit & Worksheet yang sudah dibuat. Ukur: apakah mereka kembali bulan depan & mau bayar.
- **Lokasi:** Non-teknis. `_AUDIT/05_Kit-Concierge-dan-Outreach.docx` + `Worksheet-Reveal-Kebocoran.xlsx`.

**K2. Ganti identitas Pengendali Data yang masih placeholder.**
- **Kenapa:** Dokumen UU PDP (privasi/consent) baru sah jika ada pihak resmi yang bisa dihubungi. Saat ini masih nama placeholder + email pribadi → secara hukum lemah, dan terlihat tidak profesional bagi user yang menyerahkan data sensitif.
- **Lakukan:** Isi `CONTROLLER_NAME` dengan identitas/badan usaha resmi, dan `CONTACT_EMAIL` dengan email domain usaha (bukan gmail pribadi). Naikkan `TERMS_VERSION` bila isi berubah.
- **Lokasi:** `src/lib/legal.js` (baris `CONTROLLER_NAME`, `CONTACT_EMAIL`).

**K3. Buat rencana respons kebocoran data (3×24 jam).**
- **Kenapa:** UU PDP mewajibkan pelaporan kebocoran ke otoritas & user maksimal 3×24 jam. Tanpa prosedur tertulis, Anda panik saat insiden dan berisiko sanksi (s/d 2% omzet).
- **Lakukan:** Tulis 1 halaman: siapa yang bertanggung jawab, lapor ke mana, template pemberitahuan user, langkah teknis (rotasi kunci, cabut akses). Simpan & siapkan sebelum, bukan sesudah, insiden.
- **Lokasi:** Dokumen operasional (boleh taruh di repo, mis. `SECURITY.md`).

**K4. Hentikan penambahan fitur baru sampai K1 terjawab (fokus).**
- **Kenapa:** Gejala scope creep nyata — Stok, Supplier, Invoice, Chatbot ditambah sebelum ada pelanggan bayar. Ini pola yang membunuh BukuKas/Lummo (bangun luas, bakar waktu, tak termonetisasi).
- **Lakukan:** Bekukan fitur baru. Energi hanya untuk: validasi (K1), memperdalam Reveal, dan memperbaiki item High di bawah.
- **Lokasi:** Keputusan strategis.

---

## HIGH (penting — kerjakan setelah Kritis, dampak besar)

**H1. Kembalikan tautan Legal + disclaimer di footer landing.**
- **Kenapa:** Footer landing sekarang hanya "© 2026" — **tautan Syarat & Ketentuan / Kebijakan Privasi dan kalimat disclaimer hilang** (regresi dari versi sebelumnya). Ini menurunkan kepercayaan & melemahkan posisi hukum.
- **Lakukan:** Tambah kembali kolom/again tautan ke `/ketentuan` dan `/privasi`, plus kalimat: "BukuPintar AI adalah alat bantu pencatatan, bukan nasihat keuangan/pajak/hukum."
- **Lokasi:** `src/pages/Landing.jsx` (bagian `<footer>`).

**H2. Soften klaim "Siap diajukan ✓" pada laporan KUR.**
- **Kenapa:** Laporan menampilkan status "Siap diajukan" tanpa syarat — padahal kelolosan KUR ditentukan SLIK OJK (riwayat kredit), bukan kerapian laporan. Ini over-claim → risiko komplain & liability.
- **Lakukan:** Ganti jadi "Laporan lengkap & siap dilampirkan". Pertahankan disclaimer di PDF.
- **Lokasi:** `src/pages/Reports.jsx`.

**H3. Perpendek onboarding & tambah "Coba dengan data contoh".**
- **Kenapa:** User harus daftar + isi banyak + upload file sebelum melihat manfaat apa pun. Momen "aha" terlalu jauh → drop-off tinggi → konversi rendah.
- **Lakukan:** Tombol "Coba data contoh" yang langsung mengisi dashboard tanpa upload; tampilkan nilai dulu, baru ajak memasukkan data nyata.
- **Lokasi:** `src/pages/Dashboard.jsx` / `Import.jsx` (+ data contoh sudah ada di `downloadSample`).

**H4. 2FA wajib untuk akun admin + audit log akses admin.**
- **Kenapa:** Admin tunggal bisa membaca email + omzet + seluruh data finansial semua user. Bila akun admin kena phishing → bocor total. Ini titik kiamat tunggal.
- **Lakukan:** Aktifkan 2FA untuk admin; catat log siapa-akses-apa; pertimbangkan membatasi/mask data finansial di panel admin.
- **Lokasi:** `admin-dashboard/`, kebijakan Supabase Auth, `supabase/migration_admin.sql`.

**H5. Verifikasi Reveal & AI bekerja end-to-end.**
- **Kenapa:** Reveal & AI adalah diferensiasi inti. AI hanya jalan bila Edge Function ter-deploy + `ANTHROPIC_API_KEY` diset; Reveal perlu diuji dengan file marketplace asli (format Shopee/Tokopedia/TikTok/Lazada berbeda-beda).
- **Lakukan:** Deploy Edge Function AI; uji impor laporan Shopee & Tokopedia asli → cek angka kebocoran di halaman Reveal masuk akal.
- **Lokasi:** `supabase/functions/`, `src/lib/ai.js`, `src/lib/marketplaceFees.js`, `src/pages/Reveal.jsx`.

**H6. Pasarkan diferensiasi terkuat ("Reveal Kebocoran") di landing.**
- **Kenapa:** Fitur paling tajam Anda — menunjukkan "ke mana uang bocor" — sama sekali tidak muncul di landing. Hero masih generik "pembukuan otomatis", yang mudah ditiru & tak menonjol.
- **Lakukan:** Jadikan hook utama: contoh "Omzet Rp50jt, bersih cuma Rp43jt — Rp7jt bocor di biaya admin/ongkir/iklan." Tambah section yang menampilkan Reveal.
- **Lokasi:** `src/pages/Landing.jsx`.

**H7. Pastikan klaim "AI" di landing sesuai yang benar-benar aktif.**
- **Kenapa:** Branding "BukuPintar AI" + janji fitur harus = yang ter-deploy. Bila Edge Function AI belum di-deploy di produksi, klaim "AI" menyesatkan dan merusak kepercayaan saat diuji calon pembeli.
- **Lakukan:** Jika AI aktif → tonjolkan jujur. Jika belum → gunakan kata "otomatis" sampai aktif. Konsisten antara landing & realita.
- **Lokasi:** `src/pages/Landing.jsx`.

---

## MEDIUM (kerjakan menyusul — memperkuat fondasi)

**M1. Pasang monitoring error (mis. Sentry).**
- **Kenapa:** Saat ini tidak ada pemantauan error produksi → Anda "buta" jika app error di HP user; tidak tahu kejadian & tidak bisa memperbaiki.
- **Lakukan:** Integrasikan Sentry (atau sejenis) di frontend; pantau error & rute yang gagal.
- **Lokasi:** `src/main.jsx` / `ErrorBoundary.jsx`.

**M2. Pindahkan agregasi ke server + naikkan plafon 1.000 transaksi.**
- **Kenapa:** `fetchTransactions` dibatasi 1.000 baris dan semua perhitungan dilakukan di browser. Untuk seller volume tinggi (justru pelanggan ideal), data terpotong & laporan tak lengkap tanpa peringatan.
- **Lakukan:** Buat Postgres view/RPC untuk ringkasan; paginasi/impor bertahap; agregasi di sisi server.
- **Lokasi:** `src/lib/api.js`, `src/lib/analytics.js`, `supabase/` (RPC baru).

**M3. Jadikan nomor telepon opsional saat daftar (minimalkan data).**
- **Kenapa:** Telepon wajib saat daftar padahal OTP telepon belum aktif → friksi + data sensitif tak terpakai. Prinsip UU PDP: kumpulkan seperlunya.
- **Lakukan:** Ubah telepon jadi opsional (atau pindahkan ke Pengaturan).
- **Lokasi:** `src/pages/Register.jsx`.

**M4. Cek lokasi/region data (Supabase).**
- **Kenapa:** Bila data PII finansial WNI tersimpan di luar Indonesia (mis. Singapura), UU PDP punya aturan transfer lintas negara.
- **Lakukan:** Cek region project Supabase; bila di luar negeri, ungkapkan jujur di Kebijakan Privasi & siapkan dasar transfer.
- **Lokasi:** Dashboard Supabase + `src/components/PrivacyContent.jsx`.

**M5. Tambah rate-limit/captcha pada autentikasi.**
- **Kenapa:** Tanpa pembatasan, signup/login bisa disalahgunakan → biaya email (Resend) membengkak & risiko abuse.
- **Lakukan:** Aktifkan proteksi rate-limit Supabase Auth / captcha pada form daftar & login.
- **Lokasi:** Konfigurasi Supabase Auth, `src/pages/Register.jsx` / `Login.jsx`.

**M6. Pertajam positioning copy ke "seller online multi-channel".**
- **Kenapa:** Hero "64 jt UMKM" memposisikan ke semua UMKM (terlalu lebar). Pesan yang sempit & tajam lebih meyakinkan segmen yang benar.
- **Lakukan:** Sesuaikan headline/lead ke seller multi-channel + jual "pengurangan kerugian", bukan "kerapian".
- **Lokasi:** `src/pages/Landing.jsx`.

**M7. Tambah blok transparansi "apa yang TIDAK kami lakukan dengan datamu".**
- **Kenapa:** User menyerahkan data finansial; bahasa keamanan sederhana (bukan jargon) membangun kepercayaan.
- **Lakukan:** Blok singkat bahasa awam: data milik Anda, tidak dijual, bisa dihapus/ekspor kapan saja.
- **Lokasi:** `src/pages/Landing.jsx` + `Settings.jsx`.

**M8. Pantau & batasi biaya AI/OCR (disiplin biaya).**
- **Kenapa:** OCR struk kini lewat LLM-vision (`readReceipt`) — berbiaya per pemakaian. Tanpa batas wajar, pemakaian berlebih menggerus efisiensi.
- **Lakukan:** Pakai model murah (Haiku) + batch; beri batas pemakaian wajar per akun untuk menjaga biaya. (Catatan: ini murni kontrol biaya, bukan desain harga.)
- **Lokasi:** `supabase/functions/`, `src/lib/ai.js`.

---

## LOW (rapikan saat ada waktu — polish & utang teknis)

**L1. Unit test untuk logika berbahaya.**
- **Kenapa:** Logika uang & pajak (parse angka, kategori, pajak, kebocoran) paling fatal kalau salah diam-diam.
- **Lakukan:** Tambah tes untuk `parseAmount`, `categorize`, `taxYearly`, `revealLeak`, `findDuplicateGroups`; commit ke repo.
- **Lokasi:** `src/lib/*` (+ folder test).

**L2. Tandai baris dengan tanggal meragukan saat impor.**
- **Kenapa:** Jika tanggal gagal di-parse, sistem diam-diam memakai tanggal hari ini → laporan bisa salah periode tanpa user sadar.
- **Lakukan:** Saat parse tanggal gagal, tandai baris agar user mengecek (bukan diam-diam pakai hari ini).
- **Lokasi:** `src/lib/csvImport.js` (`parseDate`).

**L3. Kebijakan retensi + kontrol data pengguna.**
- **Kenapa:** Menyimpan data mentah selamanya menambah risiko & kewajiban; user perlu kontrol.
- **Lakukan:** Auto-hapus kolom `raw`/data lama setelah X bulan; sediakan tombol "Hapus semua data saya" + ekspor.
- **Lokasi:** `supabase/` (job/policy), `src/pages/Settings.jsx`.

**L4. Sembunyikan/atur jelas fitur "Segera" (WA/Email parser).**
- **Kenapa:** Sudah ditandai "Segera" (jujur — bagus), tapi fitur yang belum ada bisa membingungkan calon pembeli.
- **Lakukan:** Pertahankan label jujur, atau sembunyikan sampai benar-benar jadi.
- **Lokasi:** `src/pages/Landing.jsx`.

**L5. Sederhanakan kustomisasi untuk pemula.**
- **Kenapa:** Tiga lapis kustomisasi (kategori + channel + aturan) bisa membingungkan pemula yang ingin "langsung jalan".
- **Lakukan:** Sembunyikan pengaturan lanjutan di balik "Pengaturan lanjutan"; beri default yang cukup.
- **Lokasi:** `src/pages/Settings.jsx`.

**L6. Tinjau ulang investasi pada Admin Dashboard & Forum Feedback.**
- **Kenapa:** Keduanya prematur untuk produk ~0 user; effort lebih baik ke validasi & Reveal.
- **Lakukan:** Jangan kembangkan lebih jauh dulu; cukup Supabase Table Editor + grup WhatsApp untuk masukan pilot.
- **Lokasi:** `admin-dashboard/`, `src/pages/Feedback.jsx`.

---

## Ringkasan jumlah

- **Kritis: 4** (validasi bayar, identitas pengendali data, rencana respons kebocoran, hentikan scope creep)
- **High: 7** (footer legal, klaim KUR, onboarding, 2FA admin, verifikasi Reveal/AI, pasarkan Reveal, klaim AI jujur)
- **Medium: 8** (monitoring, skalabilitas, telepon opsional, region data, rate-limit, positioning, transparansi data, biaya AI)
- **Low: 6** (unit test, tanggal meragukan, retensi, fitur "Segera", sederhanakan kustomisasi, tinjau admin/forum)

Urutan eksekusi yang disarankan: **K1–K4 → H1, H2, H7 (cepat & murah) → H3–H6 → Medium → Low.**
