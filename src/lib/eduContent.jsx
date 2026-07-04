// Konten edukasi KUR & Pajak UMKM - ringkas, jelas, dengan SUMBER RESMI.
// Catatan: informasi bersifat umum/edukasi; untuk keputusan resmi rujuk sumber & konsultan.

const Src = ({ children, href }) => (
  <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--indigo)', fontWeight: 600 }}>{children}</a>
)

export const EDU = [
  {
    q: '🏦 Apa itu KUR & kenapa butuh laporan keuangan?',
    a: (
      <>
        <p><b>KUR (Kredit Usaha Rakyat)</b> adalah kredit/pembiayaan modal kerja & investasi untuk UMKM
        yang sebagian bunganya <b>disubsidi pemerintah</b>, sehingga bunganya rendah (sekitar 6% efektif/tahun).
        Disalurkan lewat bank penyalur resmi (BRI, BNI, Mandiri, BSI, dan lainnya).</p>
        <p>Bank wajib menilai <b>kelayakan & kemampuan bayar</b> usaha Anda. Laporan keuangan yang rapi
        (omzet, laba, arus kas) sangat membantu - banyak UMKM ditolak karena tidak punya catatan.
        Laporan dari aplikasi ini bisa Anda lampirkan untuk memperkuat pengajuan.</p>
        <p className="muted-sm">Sumber resmi: <Src href="https://kur.ekon.go.id">kur.ekon.go.id</Src> (Kemenko Perekonomian) ·
        <Src href="https://bri.co.id/kur"> bri.co.id/kur</Src></p>
      </>
    ),
  },
  {
    q: '📋 Syarat & jenis KUR',
    a: (
      <>
        <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
          <li><b>KUR Super Mikro:</b> plafon s.d. Rp 10 juta.</li>
          <li><b>KUR Mikro:</b> di atas Rp 10 juta s.d. Rp 100 juta.</li>
          <li><b>KUR Kecil:</b> di atas Rp 100 juta s.d. Rp 500 juta.</li>
        </ul>
        <p>Syarat umum:</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>Usaha produktif & layak, umumnya sudah berjalan <b>minimal 6 bulan</b>.</li>
          <li>WNI, punya identitas (KTP), dan dokumen usaha (mis. NIB lewat OSS).</li>
          <li>Tidak sedang menerima kredit produktif lain (pengecualian tertentu diperbolehkan).</li>
          <li><b>Catatan/laporan keuangan usaha</b> - terutama untuk plafon menengah ke atas.</li>
        </ul>
        <p className="muted-sm">Ketentuan dapat berubah; cek terbaru di <Src href="https://kur.ekon.go.id">kur.ekon.go.id</Src> atau bank penyalur.</p>
      </>
    ),
  },
  {
    q: '🧾 Apa itu PPh Final UMKM 0,5%? (dasar hukum)',
    a: (
      <>
        <p>Berdasarkan <b>PP No. 55 Tahun 2022</b>, UMKM dengan <b>peredaran bruto (omzet) sampai Rp 4,8 miliar
        per tahun</b> boleh memakai tarif <b>PPh Final 0,5%</b> dihitung dari <b>omzet bruto</b> (bukan dari laba).</p>
        <p>Untuk <b>Wajib Pajak Orang Pribadi</b>, berlaku fasilitas <b>omzet tidak kena pajak Rp 500 juta pertama
        per tahun</b> (UU No. 7 Tahun 2021 / UU HPP). Jadi 0,5% hanya dihitung atas omzet <b>di atas Rp 500 juta</b>.
        Untuk <b>Wajib Pajak Badan</b> (PT/CV/Koperasi), fasilitas Rp 500 juta ini <b>tidak berlaku</b>.</p>
        <p><b>Contoh (orang pribadi):</b> omzet setahun Rp 700 juta → kena pajak atas Rp 200 juta → PPh = 0,5% × Rp 200 jt = <b>Rp 1.000.000</b>.</p>
        <p className="muted-sm">Sumber: <Src href="https://jdih.kemenkeu.go.id/in/dokumen/peraturan/0c8d2f3e-2b6a-4e7c-9b0a-PP-55-2022">PP 55/2022</Src> ·
        <Src href="https://pajak.go.id"> pajak.go.id</Src> (DJP Kemenkeu)</p>
      </>
    ),
  },
  {
    q: '⏳ Batas waktu memakai tarif 0,5%',
    a: (
      <>
        <p>Skema PPh Final 0,5% punya <b>jangka waktu</b> sejak Wajib Pajak terdaftar:</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><b>7 tahun</b> - Wajib Pajak Orang Pribadi.</li>
          <li><b>4 tahun</b> - WP Badan berbentuk PT.</li>
          <li><b>3 tahun</b> - WP Badan berbentuk CV, Firma, Koperasi.</li>
        </ul>
        <p>Setelah jangka waktu habis, atau bila omzet melebihi Rp 4,8 M/tahun, perhitungan beralih ke
        <b> tarif PPh normal</b> (pembukuan). Aplikasi akan menandai bila omzet Anda melewati batas Rp 4,8 M.</p>
        <p className="muted-sm">Sumber: <Src href="https://jdih.kemenkeu.go.id">PP 55/2022, Pasal terkait</Src> · <Src href="https://pajak.go.id">DJP</Src></p>
      </>
    ),
  },
  {
    q: '🗓️ Kapan & bagaimana bayar/lapor pajak?',
    a: (
      <>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><b>Bulanan:</b> hitung 0,5% × omzet bulan tsb (setelah memperhitungkan batas Rp 500 jt untuk orang pribadi),
            buat kode billing & bayar paling lambat <b>tanggal 15 bulan berikutnya</b> via <b>Coretax/e-Billing</b> DJP.</li>
          <li><b>Tahunan:</b> laporkan rekap setahun lewat <b>SPT Tahunan</b> (orang pribadi paling lambat <b>31 Maret</b>).</li>
          <li>Perlu <b>NPWP</b>. Rekap omzet bulanan dari aplikasi ini bisa langsung dipakai mengisi Coretax/SPT.</li>
        </ul>
        <p className="muted-sm">Layanan resmi: <Src href="https://coretaxdjp.pajak.go.id">coretaxdjp.pajak.go.id</Src> ·
        <Src href="https://pajak.go.id"> pajak.go.id</Src> · Kring Pajak 1500200</p>
      </>
    ),
  },
  {
    q: '💡 Bagaimana aplikasi ini membantu (dan batasannya)?',
    a: (
      <>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>Mencatat semua transaksi → omzet, laba & arus kas terhitung otomatis.</li>
          <li><b>Laporan KUR (PDF):</b> laba-rugi + arus kas bulanan untuk lampiran ke bank.</li>
          <li><b>Rekap Pajak (PDF):</b> peredaran bruto/bulan + estimasi PPh Final 0,5% (sudah memperhitungkan
            batas Rp 500 jt untuk orang pribadi & batas Rp 4,8 M).</li>
        </ul>
        <p><b>Penting:</b> angka pajak di sini adalah <b>estimasi/alat bantu</b>, bukan pengganti penghitungan resmi.
        Selalu verifikasi dengan <Src href="https://pajak.go.id">DJP</Src> atau konsultan pajak sebelum membayar/melapor.</p>
      </>
    ),
  },
]
