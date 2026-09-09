import { Link } from 'react-router-dom'
import {APP_NAME, CONTROLLER_NAME, CONTACT_EMAIL} from '../lib/legal'
import LegalDoc from './LegalDoc'

// Ringkasan poin terpenting, dipakai pada dialog persetujuan singkat.
export function DisclaimerSummary() {
  return (
    <ul className="legal-summary">
      <li><b>{APP_NAME} adalah alat bantu pencatatan keuangan.</b> Aplikasi ini bukan
        nasihat keuangan, perpajakan, hukum, maupun akuntansi profesional.</li>
      <li>Aplikasi disediakan <b>apa adanya</b> tanpa jaminan atas keakuratan hasil,
        ketersediaan, maupun kecocokan untuk tujuan tertentu.</li>
      <li><b>Seluruh keputusan dan risiko menjadi tanggung jawab pengguna.</b> Pengelola
        tidak menanggung kerugian, kesalahan data, hasil pengajuan KUR atau pajak, maupun
        kehilangan apa pun yang timbul dari penggunaan aplikasi.</li>
      <li>Verifikasikan setiap angka penting kepada <b>akuntan, konsultan pajak, pihak bank,
        atau Direktorat Jenderal Pajak</b> sebelum dipakai untuk pelaporan resmi atau
        pengambilan keputusan.</li>
      <li>Dengan menekan tombol setuju, Anda juga menyetujui cara kami mengelola data Anda
        sebagaimana dijelaskan pada <Link to="/privasi" target="_blank" rel="noreferrer">Kebijakan Privasi</Link>.</li>
    </ul>
  )
}

// Isi bawaan (fallback) dipakai bila dokumen di basis data belum tersedia.
function TermsFallback() {
  return (
    <div className="legal-doc">

      <div className="alert alert-info" style={{ marginBottom: 22 }}>
        Dengan mendaftar, masuk, atau menggunakan {APP_NAME} (selanjutnya disebut "Aplikasi"),
        Anda menyatakan telah membaca, memahami, dan menyetujui seluruh Syarat dan Ketentuan
        serta Penafian ini, yang merupakan satu kesatuan dengan{' '}
        <Link to="/privasi" target="_blank" rel="noreferrer">Kebijakan Privasi</Link>. Apabila Anda
        tidak menyetujui, mohon hentikan penggunaan Aplikasi.
      </div>

      <h3>1. Definisi</h3>
      <ul>
        <li><b>Aplikasi</b> adalah perangkat lunak pencatatan keuangan {APP_NAME} beserta
          seluruh fitur di dalamnya.</li>
        <li><b>Pengelola</b> adalah {CONTROLLER_NAME}, pihak yang menyediakan dan mengelola Aplikasi.</li>
        <li><b>Pengguna</b> adalah setiap orang yang membuat akun dan menggunakan Aplikasi.</li>
        <li><b>Konten Pengguna</b> adalah seluruh data yang Anda masukkan, termasuk transaksi,
          unggahan berkas, data produk, data pelanggan, dan data pemasok.</li>
      </ul>

      <h3>2. Keabsahan Persetujuan Elektronik</h3>
      <p>Persetujuan Anda atas Ketentuan ini dilakukan secara elektronik dengan menekan tombol
        persetujuan atau dengan terus menggunakan Aplikasi. Sesuai Pasal 1320 Kitab Undang-Undang
        Hukum Perdata, persetujuan ini memenuhi syarat sahnya perjanjian. Sesuai Undang-Undang
        Nomor 11 Tahun 2008 tentang Informasi dan Transaksi Elektronik sebagaimana telah diubah
        (UU ITE), khususnya Pasal 18, perjanjian yang dibuat secara elektronik adalah sah dan
        mengikat para pihak. Catatan persetujuan elektronik Anda (waktu, versi dokumen, dan
        identitas akun) disimpan sebagai alat bukti yang sah.</p>

      <h3>3. Kecakapan dan Kelayakan Pengguna</h3>
      <p>Anda menyatakan bahwa Anda cakap secara hukum untuk membuat perjanjian, yaitu telah
        berusia paling sedikit 18 tahun atau sudah menikah, serta tidak berada di bawah
        pengampuan. Anda menjamin bahwa seluruh data yang Anda berikan saat mendaftar adalah
        benar, lengkap, dan terkini.</p>

      <h3>4. Sifat Layanan: Hanya Alat Bantu</h3>
      <p>{APP_NAME} adalah <b>alat bantu pencatatan keuangan</b> untuk membantu pelaku usaha
        merapikan catatan transaksi. Aplikasi <b>bukan</b> dan tidak dimaksudkan sebagai pengganti
        nasihat atau jasa profesional di bidang <b>akuntansi, perpajakan, hukum, perbankan, maupun
        keuangan</b>. Seluruh fitur, termasuk kategori otomatis, rekonsiliasi, estimasi pajak,
        laporan KUR, dan asisten kecerdasan buatan, bersifat <b>bantuan dan perkiraan</b>, bukan
        hasil final yang dijamin benar.</p>

      <h3>5. Akun dan Keamanan</h3>
      <ul>
        <li>Anda bertanggung jawab menjaga kerahasiaan kata sandi dan keamanan akun.</li>
        <li>Setiap aktivitas yang terjadi melalui akun Anda menjadi tanggung jawab Anda.</li>
        <li>Segera beri tahu Pengelola apabila Anda menduga ada penggunaan akun tanpa izin.</li>
      </ul>

      <h3>6. Fitur Kecerdasan Buatan (AI)</h3>
      <p>Aplikasi menyediakan fitur berbasis kecerdasan buatan, antara lain asisten percakapan
        dan pembacaan struk, yang diproses melalui penyedia layanan AI pihak ketiga. Fitur ini
        bersifat opsional dan baru aktif setelah Anda menyetujuinya. Hasil dari fitur AI bersifat
        <b> perkiraan</b> dan dapat keliru, sehingga wajib Anda periksa kembali sebelum digunakan.
        Penjelasan lengkap mengenai data yang diproses oleh fitur AI diatur dalam{' '}
        <Link to="/privasi" target="_blank" rel="noreferrer">Kebijakan Privasi</Link>.</p>

      <h3>7. Tanpa Jaminan (Apa Adanya)</h3>
      <p>Aplikasi disediakan <b>apa adanya (as is)</b> dan <b>sebagaimana tersedia (as available)</b>,
        tanpa jaminan dalam bentuk apa pun, baik tersurat maupun tersirat. Pengelola tidak menjamin
        bahwa: (a) hasil perhitungan, kategori, atau laporan selalu akurat dan bebas kesalahan;
        (b) Aplikasi selalu tersedia, bebas gangguan, atau bebas dari kesalahan teknis; (c) data
        tidak akan pernah hilang atau rusak; (d) Aplikasi cocok untuk tujuan tertentu Anda atau
        memenuhi seluruh peraturan yang berlaku bagi usaha Anda.</p>

      <h3>8. Batasan Tanggung Jawab</h3>
      <p>Sepanjang diizinkan oleh hukum yang berlaku, <b>Pengelola dan pihak yang terkait dengan
        Aplikasi tidak bertanggung jawab</b> atas segala kerugian, baik langsung maupun tidak
        langsung, insidental, khusus, atau konsekuensial, termasuk namun tidak terbatas pada:</p>
      <ul>
        <li>kerugian finansial, kehilangan keuntungan, denda, atau sanksi pajak;</li>
        <li>penolakan atau permasalahan pengajuan KUR, kredit, atau pinjaman;</li>
        <li>kesalahan pelaporan pajak atau ketidakpatuhan terhadap peraturan;</li>
        <li>kesalahan input, kesalahan kategori, salah hitung, atau data ganda maupun hilang;</li>
        <li>keputusan bisnis apa pun yang diambil berdasarkan informasi dari Aplikasi;</li>
        <li>gangguan layanan, kebocoran, atau kehilangan data akibat sebab di luar kendali yang wajar.</li>
      </ul>
      <p><b>Seluruh penggunaan Aplikasi sepenuhnya menjadi tanggung jawab dan risiko pengguna sendiri.</b></p>

      <h3>9. Tanggung Jawab Pengguna</h3>
      <ul>
        <li>Memastikan kebenaran, kelengkapan, dan keabsahan seluruh data yang dimasukkan.</li>
        <li>Memverifikasi setiap angka, laporan, dan estimasi pajak kepada akuntan, konsultan
          pajak, pihak bank, atau Direktorat Jenderal Pajak sebelum digunakan untuk pelaporan
          resmi atau pengambilan keputusan.</li>
        <li>Memastikan Anda berhak memasukkan data pihak lain (misalnya pelanggan atau pemasok)
          dan telah memenuhi kewajiban hukum atas data tersebut.</li>
        <li>Mematuhi seluruh peraturan perundang-undangan yang berlaku bagi usaha Anda.</li>
        <li>Membuat cadangan (backup) data penting secara mandiri.</li>
      </ul>

      <h3>10. Estimasi Pajak dan Laporan KUR</h3>
      <p>Estimasi pajak mengacu pada pemahaman umum atas ketentuan yang berlaku, misalnya PPh Final
        UMKM 0,5% berdasarkan PP Nomor 55 Tahun 2022, dan dapat berubah sewaktu-waktu seiring
        perubahan regulasi. Estimasi ini <b>bukan perhitungan resmi</b>. Laporan yang dihasilkan
        adalah alat bantu penyusunan dan <b>tidak menjamin</b> diterimanya pengajuan KUR maupun
        kebenaran kewajiban pajak Anda.</p>

      <h3>11. Data Pribadi dan Privasi</h3>
      <p>Pengelolaan data pribadi Anda diatur secara terperinci dalam{' '}
        <Link to="/privasi" target="_blank" rel="noreferrer">Kebijakan Privasi</Link>, yang disusun
        mengacu pada Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi. Dengan
        menyetujui Ketentuan ini, Anda juga menyatakan menyetujui Kebijakan Privasi tersebut.</p>

      <h3>12. Penggunaan yang Dilarang</h3>
      <p>Anda dilarang menggunakan Aplikasi untuk tujuan yang melanggar hukum, pencucian uang,
        penipuan, memasukkan data milik orang lain tanpa hak, mengganggu atau merusak sistem,
        maupun upaya mengakses data pengguna lain tanpa izin.</p>

      <h3>13. Hak Kekayaan Intelektual</h3>
      <p>Seluruh hak atas Aplikasi, termasuk perangkat lunak, tampilan, logo, dan merek, adalah
        milik Pengelola. Konten Pengguna tetap menjadi milik Anda. Anda memberikan izin terbatas
        kepada Pengelola untuk memproses Konten Pengguna semata-mata untuk menjalankan layanan
        Aplikasi sebagaimana dijelaskan dalam Kebijakan Privasi.</p>

      <h3>14. Ganti Rugi (Indemnifikasi)</h3>
      <p>Anda setuju untuk membebaskan dan melindungi Pengelola serta pihak terkait dari segala
        tuntutan, gugatan, kerugian, atau biaya, termasuk biaya hukum, yang timbul akibat
        penggunaan Aplikasi oleh Anda atau pelanggaran Anda atas Ketentuan ini.</p>

      <h3>15. Perubahan Layanan dan Ketentuan</h3>
      <p>Pengelola dapat mengubah, menambah, menangguhkan, atau menghentikan Aplikasi maupun
        Ketentuan ini. Apabila terjadi perubahan yang berarti, Pengelola akan menaikkan versi
        dokumen dan meminta persetujuan Anda kembali. Penggunaan yang berlanjut setelah perubahan
        berarti Anda menyetujui perubahan tersebut.</p>

      <h3>16. Penghentian Akun</h3>
      <p>Anda dapat berhenti menggunakan Aplikasi dan meminta penghapusan akun kapan saja.
        Pengelola dapat menangguhkan atau menghentikan akun yang melanggar Ketentuan ini atau
        peraturan yang berlaku.</p>

      <h3>17. Hukum yang Berlaku dan Penyelesaian Sengketa</h3>
      <p>Ketentuan ini diatur dan ditafsirkan menurut hukum Republik Indonesia. Apabila timbul
        sengketa, para pihak akan mengutamakan penyelesaian secara musyawarah. Bila tidak tercapai,
        sengketa diselesaikan melalui pengadilan negeri yang berwenang di wilayah hukum Republik
        Indonesia.</p>

      <h3>18. Kontak</h3>
      <p>Pertanyaan mengenai Ketentuan ini dapat disampaikan kepada Pengelola melalui surel{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>

      <p className="legal-foot">Dengan menggunakan {APP_NAME}, Anda menyatakan memahami bahwa
        Aplikasi ini hanyalah alat bantu dan <b>menanggung sendiri seluruh risiko serta tanggung
        jawab</b> atas penggunaannya.</p>
    </div>
  )
}

// Dokumen Syarat & Ketentuan: diambil dari basis data (dapat diedit admin dan
// tampil real-time), dengan fallback ke konten bawaan di atas bila DB kosong.
export default function LegalContent() {
  return <LegalDoc slug="terms" fallback={<TermsFallback />} />
}
