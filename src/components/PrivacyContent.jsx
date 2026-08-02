import { Link } from 'react-router-dom'
import { APP_NAME, TERMS_VERSION, TERMS_EFFECTIVE, CONTROLLER_NAME, CONTACT_EMAIL } from '../lib/legal'
import LegalDoc from './LegalDoc'

// Isi bawaan (fallback) Kebijakan Privasi, dipakai bila dokumen di basis data
// belum tersedia. Disusun mengacu pada UU No. 27 Tahun 2022 tentang Pelindungan
// Data Pribadi (UU PDP), UU ITE, dan PP No. 71 Tahun 2019.
function PrivacyFallback() {
  return (
    <div className="legal-doc">
      <p className="legal-meta">Versi {TERMS_VERSION}. Berlaku sejak {TERMS_EFFECTIVE}.</p>

      <div className="alert alert-info" style={{ marginBottom: 22 }}>
        Kebijakan Privasi ini menjelaskan cara {APP_NAME} (selanjutnya disebut "Aplikasi")
        mengumpulkan, menggunakan, menyimpan, melindungi, dan membagikan data pribadi Anda.
        Kebijakan ini merupakan satu kesatuan dengan{' '}
        <Link to="/ketentuan" target="_blank" rel="noreferrer">Syarat dan Ketentuan</Link>.
        Dengan menyetujui, Anda memberikan persetujuan atas pemrosesan data sebagaimana
        dijelaskan di bawah ini sesuai Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan
        Data Pribadi (UU PDP). Aplikasi juga tunduk pada UU ITE dan Peraturan Pemerintah
        Nomor 71 Tahun 2019 tentang Penyelenggaraan Sistem dan Transaksi Elektronik.
      </div>

      <h3>1. Identitas Pengendali Data Pribadi</h3>
      <p>Pengendali Data Pribadi atas Aplikasi ini adalah <b>{CONTROLLER_NAME}</b>, selanjutnya
        disebut "Kami". Anda dapat menghubungi Kami melalui surel{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> untuk segala hal terkait data
        pribadi Anda.</p>

      <h3>2. Data Pribadi yang Kami Kumpulkan</h3>
      <p>Kami hanya mengumpulkan data yang diperlukan untuk menjalankan layanan, yaitu:</p>
      <ul>
        <li><b>Data akun</b>: alamat surel, kata sandi (tersimpan dalam bentuk terenkripsi dan
          tidak dapat Kami baca), serta nomor telepon bila Anda mengisinya.</li>
        <li><b>Data usaha</b>: nama usaha, nama pemilik, jenis usaha, dan jenis wajib pajak.</li>
        <li><b>Data transaksi keuangan</b>: catatan pemasukan dan pengeluaran, kategori, jumlah,
          waktu, serta keterangan yang Anda masukkan atau Anda impor.</li>
        <li><b>Data mutasi rekening dan laporan marketplace</b> yang Anda unggah secara sukarela
          untuk dirapikan oleh Aplikasi.</li>
        <li><b>Berkas struk</b> berupa foto atau dokumen yang Anda unggah.</li>
        <li><b>Data produk dan stok</b>: nama produk, satuan, jumlah stok, harga jual, dan harga modal (HPP).</li>
        <li><b>Data pelanggan pada invoice</b>: nama dan keterangan yang Anda masukkan untuk
          membuat invoice.</li>
        <li><b>Data pemasok (supplier)</b>: nama, kontak, dan catatan yang Anda masukkan.</li>
        <li><b>Data penggunaan teknis</b>: catatan aktivitas dalam Aplikasi untuk menjaga
          keamanan dan meningkatkan layanan.</li>
      </ul>
      <p>Sebagian data di atas, seperti mutasi rekening dan data pelanggan, dapat tergolong
        data pribadi yang bersifat spesifik atau sensitif. Anda memasukkannya secara sukarela
        dan bertanggung jawab memastikan Anda berhak melakukannya.</p>

      <h3>3. Dasar Hukum dan Tujuan Pemrosesan</h3>
      <p>Sesuai Pasal 20 UU PDP, Kami memproses data pribadi Anda berdasarkan <b>persetujuan
        Anda</b> dan untuk <b>pelaksanaan layanan</b> yang Anda minta. Tujuan pemrosesan meliputi:</p>
      <ul>
        <li>membuat dan mengelola akun serta mengamankan akses Anda;</li>
        <li>menyimpan, mengategorikan, dan menampilkan catatan keuangan Anda;</li>
        <li>menghasilkan laporan, estimasi pajak, invoice, dan ringkasan usaha;</li>
        <li>menjalankan fitur kecerdasan buatan yang Anda aktifkan (lihat Bagian 4);</li>
        <li>menjaga keamanan, mencegah penyalahgunaan, dan memenuhi kewajiban hukum.</li>
      </ul>
      <p>Kami <b>tidak menjual</b> data pribadi Anda kepada pihak mana pun, dan <b>tidak
        menggunakannya untuk iklan</b>.</p>

      <h3>4. Fitur Kecerdasan Buatan dan Pemrosesan oleh Pihak Ketiga</h3>
      <p>Aplikasi menyediakan fitur kecerdasan buatan (asisten percakapan dan pembacaan struk)
        yang diproses melalui layanan <b>Google Gemini</b>. Agar Anda dapat mengambil keputusan
        secara sadar, perlu Kami sampaikan dengan jujur:</p>
      <ul>
        <li>Fitur AI bersifat <b>opsional</b> dan baru aktif setelah Anda menyetujuinya secara
          terpisah.</li>
        <li>Untuk menjawab pertanyaan Anda, Aplikasi mengirimkan <b>ringkasan data yang sudah
          diolah dan disamarkan</b> kepada penyedia AI. Kami berupaya tidak mengirim data yang
          sangat sensitif seperti nomor rekening dan nama pelanggan secara utuh.</li>
        <li>Pada fitur <b>baca struk</b>, foto atau PDF struk yang Anda unggah dikirim ke penyedia
          AI untuk dibaca isinya. Hindari mengunggah dokumen yang memuat informasi sangat rahasia.</li>
        <li>Saat ini Aplikasi menggunakan layanan AI pada <b>paket gratis</b>. Sesuai ketentuan
          penyedia, masukan dan keluaran pada paket gratis <b>dapat digunakan oleh penyedia untuk
          meningkatkan model mereka</b>. Oleh karena itu, <b>mohon tidak memasukkan informasi yang
          sangat rahasia</b> ke dalam percakapan AI maupun mengunggah dokumen yang sangat rahasia.
          Kami berencana beralih ke layanan berbayar yang tidak memakai data untuk pelatihan
          begitu kondisi memungkinkan.</li>
        <li><b>Riwayat percakapan dengan asisten AI tidak Kami simpan.</b> Percakapan dihapus
          setelah sesi selesai.</li>
        <li>Hasil dari fitur AI bersifat perkiraan dan wajib Anda periksa kembali.</li>
      </ul>

      <h3>5. Prosesor Data dan Mitra Pihak Ketiga</h3>
      <p>Untuk menjalankan layanan, Kami bekerja sama dengan penyedia berikut sebagai Prosesor
        Data, yang terikat menjaga kerahasiaan dan keamanan data:</p>
      <ul>
        <li><b>Supabase</b>: penyimpanan basis data, autentikasi, dan penyimpanan berkas.</li>
        <li><b>Google Gemini</b>: pemrosesan fitur kecerdasan buatan (lihat Bagian 4).</li>
        <li><b>Penyedia pengiriman surel</b>: pengiriman kode verifikasi dan pemulihan kata sandi.</li>
      </ul>
      <p>Sesuai UU PDP, tanggung jawab atas pelindungan data Anda tetap berada pada Kami sebagai
        Pengendali Data, dan Kami mengawasi setiap pihak yang memproses data di bawah kendali Kami.</p>

      <h3>6. Transfer Data ke Luar Wilayah Indonesia</h3>
      <p>Sebagian penyedia di atas dapat menyimpan atau memproses data pada server yang berlokasi
        di luar wilayah Indonesia. Dengan menyetujui Kebijakan ini, Anda memahami dan menyetujui
        adanya transfer data lintas negara tersebut. Kami berupaya memastikan penyedia menerapkan
        tingkat pelindungan data yang memadai sesuai prinsip UU PDP.</p>

      <h3>7. Penyimpanan dan Keamanan Data</h3>
      <p>Kami menerapkan langkah keamanan yang wajar untuk melindungi data Anda, antara lain:</p>
      <ul>
        <li><b>Isolasi antarpengguna</b> melalui mekanisme keamanan tingkat baris, sehingga setiap
          pengguna hanya dapat mengakses datanya sendiri.</li>
        <li><b>Enkripsi saat pengiriman data</b> melalui koneksi aman.</li>
        <li>Penyimpanan kata sandi dalam bentuk terenkripsi yang tidak dapat Kami baca.</li>
        <li>Akses ke berkas struk melalui tautan sementara yang berlaku terbatas.</li>
      </ul>
      <p>Meskipun demikian, tidak ada sistem yang sepenuhnya bebas risiko. Anda turut bertanggung
        jawab menjaga kerahasiaan kata sandi akun Anda.</p>

      <h3>8. Jangka Waktu Penyimpanan</h3>
      <p>Kami menyimpan data Anda selama akun Anda aktif atau selama diperlukan untuk tujuan yang
        dijelaskan dalam Kebijakan ini. Apabila Anda menghapus data atau akun, data tersebut akan
        Kami hapus dari sistem, kecuali bila penyimpanan diwajibkan oleh peraturan yang berlaku.</p>

      <h3>9. Hak Anda sebagai Subjek Data Pribadi</h3>
      <p>Sesuai UU PDP, Anda memiliki hak untuk:</p>
      <ul>
        <li>memperoleh informasi dan mengakses data pribadi Anda;</li>
        <li>memperbaiki atau memperbarui data yang tidak akurat;</li>
        <li>menghapus data pribadi Anda;</li>
        <li>menarik persetujuan atas pemrosesan data;</li>
        <li>menolak atau membatasi pemrosesan tertentu, termasuk menonaktifkan fitur AI;</li>
        <li>memperoleh dan memindahkan salinan data Anda (portabilitas);</li>
        <li>menyampaikan keluhan atas pemrosesan data Anda.</li>
      </ul>
      <p>Anda dapat menggunakan sebagian hak ini langsung dari menu Pengaturan, atau dengan
        menghubungi Kami di <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Penarikan
        persetujuan tidak memengaruhi keabsahan pemrosesan yang telah dilakukan sebelumnya.</p>

      <h3>10. Pemberitahuan Kegagalan Pelindungan Data</h3>
      <p>Apabila terjadi kegagalan pelindungan data pribadi yang berisiko merugikan Anda, Kami
        akan memberitahukannya kepada Anda dan kepada otoritas yang berwenang paling lambat
        <b> 3 x 24 jam</b> sejak diketahui, sesuai ketentuan UU PDP, disertai langkah penanganan
        yang Kami lakukan.</p>

      <h3>11. Data Anak dan Kecakapan</h3>
      <p>Aplikasi ditujukan bagi pelaku usaha yang cakap secara hukum. Layanan tidak ditujukan
        bagi anak di bawah umur. Bila data anak terkumpul tanpa persetujuan yang sah, data
        tersebut akan Kami hapus.</p>

      <h3>12. Cookie dan Penyimpanan Lokal</h3>
      <p>Aplikasi menggunakan penyimpanan lokal pada peramban Anda untuk menjaga sesi masuk dan
        menyimpan preferensi. Penyimpanan ini diperlukan agar Aplikasi berfungsi dan tidak
        digunakan untuk pelacakan iklan.</p>

      <h3>13. Perubahan Kebijakan</h3>
      <p>Kami dapat memperbarui Kebijakan ini dari waktu ke waktu. Bila terjadi perubahan yang
        berarti, Kami akan menaikkan versi dokumen dan meminta persetujuan Anda kembali sebelum
        Anda melanjutkan penggunaan Aplikasi.</p>

      <h3>14. Kontak dan Penyampaian Keluhan</h3>
      <p>Pertanyaan, permintaan penggunaan hak, atau keluhan terkait data pribadi dapat Anda
        sampaikan kepada Kami melalui surel <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        Apabila keluhan Anda tidak terselesaikan, Anda berhak menyampaikannya kepada lembaga yang
        berwenang di bidang pelindungan data pribadi sesuai peraturan yang berlaku.</p>

      <p className="legal-foot">Dengan menekan tombol setuju, Anda menyatakan telah membaca dan
        memahami Kebijakan Privasi ini serta memberikan persetujuan atas pemrosesan data pribadi
        Anda sebagaimana dijelaskan di atas.</p>
    </div>
  )
}

// Kebijakan Privasi: diambil dari basis data (dapat diedit admin dan tampil
// real-time), dengan fallback ke konten bawaan di atas bila DB kosong.
export default function PrivacyContent() {
  return <LegalDoc slug="privacy" fallback={<PrivacyFallback />} />
}
