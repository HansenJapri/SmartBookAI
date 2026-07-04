-- ============================================================
-- MIGRASI LEGAL - Dokumen Syarat & Ketentuan dan Kebijakan Privasi
-- yang bisa diedit admin dan tampil real-time di sisi pengguna.
-- Jalankan SETELAH migration_admin.sql. Aman diulang.
-- ============================================================

create table if not exists public.legal_docs (
  slug       text primary key,           -- 'terms' atau 'privacy'
  title      text not null,
  content    text not null,              -- markdown sederhana
  updated_at timestamptz not null default now()
);

alter table public.legal_docs enable row level security;

-- Boleh dibaca siapa saja (termasuk tamu), karena ditampilkan saat mendaftar.
drop policy if exists "legal read all" on public.legal_docs;
create policy "legal read all" on public.legal_docs for select using (true);

-- Hanya admin yang boleh mengubah isi dokumen.
drop policy if exists "legal admin write" on public.legal_docs;
create policy "legal admin write" on public.legal_docs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Realtime agar perubahan admin langsung tampil di sisi pengguna.
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.legal_docs'; exception when duplicate_object then null; end;
end $$;

-- ---------- ISI AWAL: SYARAT & KETENTUAN ----------
insert into public.legal_docs (slug, title, content) values ('terms', 'Syarat dan Ketentuan', $md$Dengan mendaftar, masuk, atau menggunakan BukuPintar AI ("Aplikasi"), Anda menyatakan telah membaca, memahami, dan menyetujui seluruh Syarat dan Ketentuan serta Penafian ini, yang merupakan satu kesatuan dengan Kebijakan Privasi. Apabila Anda tidak menyetujui, mohon hentikan penggunaan Aplikasi.

## 1. Definisi
- **Aplikasi** adalah perangkat lunak pencatatan keuangan BukuPintar AI beserta seluruh fiturnya.
- **Pengelola** adalah pihak yang menyediakan dan mengelola Aplikasi.
- **Pengguna** adalah setiap orang yang membuat akun dan menggunakan Aplikasi.
- **Konten Pengguna** adalah seluruh data yang Anda masukkan, termasuk transaksi, unggahan berkas, data produk, data pelanggan, dan data pemasok.

## 2. Keabsahan Persetujuan Elektronik
Persetujuan dilakukan secara elektronik dengan menekan tombol persetujuan atau dengan terus menggunakan Aplikasi. Sesuai Pasal 1320 Kitab Undang-Undang Hukum Perdata, persetujuan ini memenuhi syarat sahnya perjanjian. Sesuai UU No. 11 Tahun 2008 tentang Informasi dan Transaksi Elektronik sebagaimana telah diubah (UU ITE), khususnya Pasal 18, perjanjian yang dibuat secara elektronik adalah sah dan mengikat. Catatan persetujuan elektronik Anda (waktu, versi dokumen, dan identitas akun) disimpan sebagai alat bukti yang sah.

## 3. Kecakapan dan Kelayakan Pengguna
Anda menyatakan cakap secara hukum untuk membuat perjanjian, yaitu berusia paling sedikit 18 tahun atau sudah menikah, serta tidak berada di bawah pengampuan. Anda menjamin seluruh data yang diberikan benar, lengkap, dan terkini.

## 4. Sifat Layanan: Hanya Alat Bantu
BukuPintar AI adalah alat bantu pencatatan keuangan. Aplikasi bukan pengganti nasihat atau jasa profesional di bidang akuntansi, perpajakan, hukum, perbankan, maupun keuangan. Seluruh fitur, termasuk kategori otomatis, rekonsiliasi, estimasi pajak, laporan, dan asisten kecerdasan buatan, bersifat bantuan dan perkiraan, bukan hasil final yang dijamin benar.

## 5. Akun dan Keamanan
- Anda bertanggung jawab menjaga kerahasiaan kata sandi dan keamanan akun.
- Setiap aktivitas yang terjadi melalui akun Anda menjadi tanggung jawab Anda.
- Segera beri tahu Pengelola apabila Anda menduga ada penggunaan akun tanpa izin.

## 6. Fitur Kecerdasan Buatan (AI)
Aplikasi menyediakan fitur berbasis kecerdasan buatan, antara lain asisten percakapan dan pembacaan struk, yang diproses melalui penyedia layanan AI pihak ketiga. Fitur ini opsional dan baru aktif setelah Anda menyetujuinya. Hasil fitur AI bersifat perkiraan dan dapat keliru sehingga wajib Anda periksa kembali. Penjelasan lengkap mengenai data yang diproses diatur dalam Kebijakan Privasi.

## 7. Tanpa Jaminan (Apa Adanya)
Aplikasi disediakan apa adanya (as is) dan sebagaimana tersedia (as available), tanpa jaminan dalam bentuk apa pun. Pengelola tidak menjamin hasil perhitungan selalu akurat, ketersediaan tanpa gangguan, data tidak akan hilang, maupun kecocokan untuk tujuan tertentu Anda.

## 8. Batasan Tanggung Jawab
Sepanjang diizinkan oleh hukum yang berlaku, Pengelola tidak bertanggung jawab atas segala kerugian, baik langsung maupun tidak langsung, termasuk namun tidak terbatas pada:
- kerugian finansial, kehilangan keuntungan, denda, atau sanksi pajak;
- penolakan atau permasalahan pengajuan KUR, kredit, atau pinjaman;
- kesalahan pelaporan pajak atau ketidakpatuhan terhadap peraturan;
- kesalahan input, kategori, salah hitung, atau data ganda maupun hilang;
- keputusan bisnis yang diambil berdasarkan informasi dari Aplikasi;
- gangguan, kebocoran, atau kehilangan data akibat sebab di luar kendali yang wajar.

Seluruh penggunaan Aplikasi sepenuhnya menjadi tanggung jawab dan risiko pengguna sendiri.

## 9. Tanggung Jawab Pengguna
- Memastikan kebenaran, kelengkapan, dan keabsahan seluruh data yang dimasukkan.
- Memverifikasi setiap angka, laporan, dan estimasi pajak kepada akuntan, konsultan pajak, pihak bank, atau Direktorat Jenderal Pajak sebelum digunakan untuk pelaporan resmi.
- Memastikan Anda berhak memasukkan data pihak lain (pelanggan atau pemasok) dan memenuhi kewajiban hukum atasnya.
- Mematuhi seluruh peraturan perundang-undangan yang berlaku bagi usaha Anda.
- Membuat cadangan (backup) data penting secara mandiri.

## 10. Estimasi Pajak dan Laporan KUR
Estimasi pajak mengacu pada pemahaman umum atas ketentuan yang berlaku, misalnya PPh Final UMKM 0,5% berdasarkan PP No. 55 Tahun 2022, dan dapat berubah sewaktu-waktu. Estimasi ini bukan perhitungan resmi. Laporan yang dihasilkan adalah alat bantu dan tidak menjamin diterimanya pengajuan KUR maupun kebenaran kewajiban pajak Anda.

## 11. Data Pribadi dan Privasi
Pengelolaan data pribadi Anda diatur dalam Kebijakan Privasi yang disusun mengacu pada UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi. Dengan menyetujui Ketentuan ini, Anda juga menyetujui Kebijakan Privasi tersebut.

## 12. Penggunaan yang Dilarang
Anda dilarang menggunakan Aplikasi untuk tujuan yang melanggar hukum, pencucian uang, penipuan, memasukkan data milik orang lain tanpa hak, mengganggu atau merusak sistem, maupun mengakses data pengguna lain tanpa izin.

## 13. Hak Kekayaan Intelektual
Seluruh hak atas Aplikasi, termasuk perangkat lunak, tampilan, logo, dan merek, adalah milik Pengelola. Konten Pengguna tetap menjadi milik Anda. Anda memberikan izin terbatas kepada Pengelola untuk memproses Konten Pengguna semata-mata untuk menjalankan layanan sesuai Kebijakan Privasi.

## 14. Ganti Rugi (Indemnifikasi)
Anda setuju membebaskan dan melindungi Pengelola serta pihak terkait dari segala tuntutan, gugatan, kerugian, atau biaya, termasuk biaya hukum, yang timbul akibat penggunaan Aplikasi oleh Anda atau pelanggaran Anda atas Ketentuan ini.

## 15. Perubahan Layanan dan Ketentuan
Pengelola dapat mengubah, menambah, menangguhkan, atau menghentikan Aplikasi maupun Ketentuan ini. Bila terjadi perubahan berarti, Pengelola akan menaikkan versi dokumen dan meminta persetujuan Anda kembali. Penggunaan yang berlanjut setelah perubahan berarti Anda menyetujuinya.

## 16. Penghentian Akun
Anda dapat berhenti menggunakan Aplikasi dan meminta penghapusan akun kapan saja. Pengelola dapat menangguhkan atau menghentikan akun yang melanggar Ketentuan ini atau peraturan yang berlaku.

## 17. Hukum yang Berlaku dan Penyelesaian Sengketa
Ketentuan ini diatur dan ditafsirkan menurut hukum Republik Indonesia. Apabila timbul sengketa, para pihak mengutamakan penyelesaian secara musyawarah; bila tidak tercapai, diselesaikan melalui pengadilan negeri yang berwenang.

## 18. Kontak
Pertanyaan mengenai Ketentuan ini dapat disampaikan kepada Pengelola melalui surel resmi yang tertera pada Aplikasi.$md$)
on conflict (slug) do nothing;

-- ---------- ISI AWAL: KEBIJAKAN PRIVASI ----------
insert into public.legal_docs (slug, title, content) values ('privacy', 'Kebijakan Privasi', $md$Kebijakan Privasi ini menjelaskan cara BukuPintar AI ("Aplikasi") mengumpulkan, menggunakan, menyimpan, melindungi, dan membagikan data pribadi Anda. Kebijakan ini merupakan satu kesatuan dengan Syarat dan Ketentuan. Dengan menyetujui, Anda memberikan persetujuan atas pemrosesan data sesuai UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP). Aplikasi juga tunduk pada UU ITE dan PP No. 71 Tahun 2019 tentang Penyelenggaraan Sistem dan Transaksi Elektronik.

## 1. Identitas Pengendali Data Pribadi
Pengendali Data Pribadi atas Aplikasi ini adalah Pengelola BukuPintar AI ("Kami"). Anda dapat menghubungi Kami melalui surel resmi yang tertera pada Aplikasi untuk segala hal terkait data pribadi Anda.

## 2. Data Pribadi yang Kami Kumpulkan
- **Data akun**: alamat surel, kata sandi (tersimpan terenkripsi dan tidak dapat Kami baca), serta nomor telepon bila Anda mengisinya.
- **Data usaha**: nama usaha, nama pemilik, jenis usaha, dan jenis wajib pajak.
- **Data transaksi keuangan**: pemasukan dan pengeluaran, kategori, jumlah, waktu, serta keterangan.
- **Data mutasi rekening dan laporan marketplace** yang Anda unggah secara sukarela.
- **Berkas struk** berupa foto atau dokumen yang Anda unggah.
- **Data produk dan stok**: nama produk, satuan, jumlah stok, harga jual, dan harga modal (HPP).
- **Data pelanggan pada invoice**: nama dan keterangan yang Anda masukkan.
- **Data pemasok**: nama, kontak, dan catatan yang Anda masukkan.
- **Data penggunaan teknis** untuk menjaga keamanan dan meningkatkan layanan.

Sebagian data, seperti mutasi rekening dan data pelanggan, dapat tergolong data pribadi spesifik. Anda memasukkannya secara sukarela dan bertanggung jawab memastikan berhak melakukannya.

## 3. Dasar Hukum dan Tujuan Pemrosesan
Sesuai Pasal 20 UU PDP, Kami memproses data berdasarkan persetujuan Anda dan untuk pelaksanaan layanan. Tujuan pemrosesan:
- membuat dan mengamankan akun Anda;
- menyimpan, mengategorikan, dan menampilkan catatan keuangan;
- menghasilkan laporan, estimasi pajak, invoice, dan ringkasan usaha;
- menjalankan fitur kecerdasan buatan yang Anda aktifkan;
- menjaga keamanan, mencegah penyalahgunaan, dan memenuhi kewajiban hukum.

Kami tidak menjual data pribadi Anda dan tidak menggunakannya untuk iklan.

## 4. Fitur Kecerdasan Buatan dan Pihak Ketiga
Fitur AI (asisten percakapan dan pembacaan struk) diproses melalui layanan Google Gemini.
- Fitur AI opsional dan aktif setelah Anda menyetujuinya.
- Untuk menjawab pertanyaan, Aplikasi mengirim ringkasan data yang sudah diolah dan disamarkan; Kami berupaya tidak mengirim nomor rekening atau nama pelanggan secara utuh.
- Pada fitur baca struk, foto atau PDF struk yang Anda unggah dikirim ke penyedia AI untuk dibaca. Hindari mengunggah dokumen yang sangat rahasia.
- Saat ini memakai layanan AI paket gratis; sesuai ketentuan penyedia, masukan dan keluaran pada paket gratis dapat digunakan untuk meningkatkan model mereka. Karena itu, jangan memasukkan informasi yang sangat rahasia. Kami berencana beralih ke layanan berbayar yang tidak memakai data untuk pelatihan.
- Riwayat percakapan dengan asisten AI tidak Kami simpan.

## 5. Prosesor Data dan Mitra Pihak Ketiga
- **Supabase**: penyimpanan basis data, autentikasi, dan berkas.
- **Google Gemini**: pemrosesan fitur kecerdasan buatan.
- **Penyedia pengiriman surel**: pengiriman kode verifikasi dan pemulihan kata sandi.

Sesuai UU PDP, tanggung jawab pelindungan data tetap pada Kami sebagai Pengendali Data, dan Kami mengawasi setiap pihak yang memproses data di bawah kendali Kami.

## 6. Transfer Data ke Luar Wilayah Indonesia
Sebagian penyedia dapat menyimpan atau memproses data pada server di luar Indonesia. Dengan menyetujui Kebijakan ini, Anda memahami dan menyetujui transfer data lintas negara tersebut. Kami berupaya memastikan penyedia menerapkan tingkat pelindungan yang memadai sesuai prinsip UU PDP.

## 7. Penyimpanan dan Keamanan Data
- Isolasi antarpengguna melalui keamanan tingkat baris, sehingga setiap pengguna hanya mengakses datanya sendiri.
- Enkripsi saat pengiriman data melalui koneksi aman.
- Kata sandi disimpan dalam bentuk terenkripsi yang tidak dapat Kami baca.
- Akses berkas struk melalui tautan sementara yang berlaku terbatas.

Tidak ada sistem yang sepenuhnya bebas risiko. Anda turut bertanggung jawab menjaga kerahasiaan kata sandi.

## 8. Jangka Waktu Penyimpanan
Kami menyimpan data selama akun aktif atau selama diperlukan untuk tujuan pada Kebijakan ini. Bila Anda menghapus data atau akun, data akan dihapus dari sistem, kecuali penyimpanan diwajibkan peraturan.

## 9. Hak Anda sebagai Subjek Data Pribadi
Sesuai UU PDP, Anda berhak:
- memperoleh informasi dan mengakses data pribadi Anda;
- memperbaiki data yang tidak akurat;
- menghapus data pribadi Anda;
- menarik persetujuan atas pemrosesan;
- menolak atau membatasi pemrosesan tertentu, termasuk menonaktifkan fitur AI;
- memperoleh dan memindahkan salinan data Anda (portabilitas);
- menyampaikan keluhan atas pemrosesan data Anda.

Sebagian hak dapat digunakan langsung dari menu Pengaturan, atau dengan menghubungi Kami. Penarikan persetujuan tidak memengaruhi keabsahan pemrosesan sebelumnya.

## 10. Pemberitahuan Kegagalan Pelindungan Data
Apabila terjadi kegagalan pelindungan data pribadi yang berisiko merugikan Anda, Kami memberitahukannya kepada Anda dan otoritas berwenang paling lambat 3 x 24 jam sejak diketahui, sesuai UU PDP, disertai langkah penanganan.

## 11. Data Anak dan Kecakapan
Aplikasi ditujukan bagi pelaku usaha yang cakap secara hukum dan tidak ditujukan bagi anak di bawah umur. Bila data anak terkumpul tanpa persetujuan yang sah, data tersebut akan Kami hapus.

## 12. Cookie dan Penyimpanan Lokal
Aplikasi menggunakan penyimpanan lokal pada peramban untuk menjaga sesi masuk dan preferensi. Penyimpanan ini diperlukan agar Aplikasi berfungsi dan tidak untuk pelacakan iklan.

## 13. Perubahan Kebijakan
Kami dapat memperbarui Kebijakan ini. Bila terjadi perubahan berarti, Kami menaikkan versi dan meminta persetujuan Anda kembali sebelum melanjutkan penggunaan Aplikasi.

## 14. Kontak dan Penyampaian Keluhan
Pertanyaan, permintaan penggunaan hak, atau keluhan terkait data pribadi dapat Anda sampaikan melalui surel resmi yang tertera pada Aplikasi. Bila tidak terselesaikan, Anda berhak menyampaikannya kepada lembaga yang berwenang di bidang pelindungan data pribadi.$md$)
on conflict (slug) do nothing;

-- ============================================================
-- SELESAI.
-- ============================================================
