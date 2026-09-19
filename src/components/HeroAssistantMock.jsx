import { useEffect, useRef, useState } from 'react'
import {
  Bot, MoreVertical, HelpCircle, PencilLine,
  ChevronDown, AlertTriangle, CheckCircle2, Send,
} from 'lucide-react'
import { useLang } from '../context/LangContext'

// Mockup panel "Asisten SmartBook" di hero landing.
//
// Meniru mode Catat yang sebenarnya ada di src/components/Chatbot.jsx: tab
// Tanya/Catat, kalimat yang diketik pengguna, kartu pratinjau "Menambah
// Transaksi" yang isinya masih bisa dikoreksi, lalu tombol Simpan. Alur ini
// sengaja tidak dilebih-lebihkan — memamerkan langkah yang tidak ada di produk
// hanya menciptakan harapan yang meleset begitu pengunjung mendaftar.
//
// Tidak ada panggilan AI di sini. Landing terbuka untuk publik, jadi memanggil
// Edge Function dari halaman ini berarti kuota token terbakar oleh lalu lintas
// anonim, termasuk bot perayap.

// Tonggak waktu satu putaran animasi, dalam milidetik sejak putaran dimulai.
const KETIK_PER_HURUF = 45
const JEDA_KIRIM = 700        // jeda setelah kalimat selesai diketik
const DURASI_BERPIKIR = 1100  // titik-titik "AI sedang membaca"
const JEDA_FIELD = 170        // jarak antar baris field yang muncul
const JEDA_TOMBOL = 320       // jeda sebelum peringatan + tombol Simpan
const TAHAN_AKHIR = 3600      // berapa lama hasil akhir dibiarkan terbaca

export default function HeroAssistantMock() {
  const { t } = useLang()
  const L = t.landing2.hero
  const jumlahField = L.fields.length

  const kalimat = L.msgUser
  const mulaiKirim = kalimat.length * KETIK_PER_HURUF + JEDA_KIRIM
  const mulaiKartu = mulaiKirim + DURASI_BERPIKIR
  const mulaiTombol = mulaiKartu + jumlahField * JEDA_FIELD + JEDA_TOMBOL
  const putaran = mulaiTombol + TAHAN_AKHIR

  // Fase dihitung dari jam putaran, bukan dari rantai setTimeout: satu sumber
  // waktu berarti animasi tidak bisa "tercecer" saat tab di-background lalu
  // dibuka lagi, dan menghentikannya cukup dengan membuang satu interval.
  //
  // Jamnya mulai dari NOL, bukan dari kondisi akhir: pengunjung harus melihat
  // kalimat diketik dari panel kosong dulu, baru terkirim, baru kartunya muncul.
  // Membuka halaman dengan hasil yang sudah jadi tidak menjelaskan apa pun
  // tentang cara kerja fitur Catat — padahal justru itu yang mau ditunjukkan.
  const [waktu, setWaktu] = useState(0)
  // Baru bernilai true setelah satu putaran penuh selesai. Dipakai untuk
  // membedakan "panel memang masih kosong" dari "ini sisa hasil sebelumnya".
  const [pernahSelesai, setPernahSelesai] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    // Hormati prefers-reduced-motion: tampilkan kondisi akhir, tanpa gerak.
    const diamSaja = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    if (diamSaja) { setWaktu(putaran); setPernahSelesai(true); return undefined }

    let timer = null
    let mulai = 0
    const jalan = () => {
      if (timer) return
      mulai = performance.now()
      timer = setInterval(() => {
        const lewat = performance.now() - mulai
        if (lewat >= putaran) {
          mulai = performance.now()
          setPernahSelesai(true)
          setWaktu(0)
        } else setWaktu(lewat)
      }, 60)
    }
    const berhenti = () => { if (timer) { clearInterval(timer); timer = null } }

    // Animasi hanya berjalan saat panelnya benar-benar terlihat. Membiarkannya
    // berdetak saat pengunjung sudah menggulir jauh ke bawah hanya membakar
    // baterai tanpa ada yang menonton.
    //
    // Kedua syarat dipegang di satu tempat. Sempat dipisah — observer menyalakan,
    // visibilitychange mematikan — dan akibatnya animasi mati permanen begitu
    // pengunjung pindah tab lalu kembali: tidak ada perubahan perpotongan yang
    // menyalakannya lagi.
    let terlihat = false
    const perbarui = () => ((terlihat && !document.hidden) ? jalan() : berhenti())

    const io = new IntersectionObserver(([e]) => { terlihat = e.isIntersecting; perbarui() }, { threshold: 0.25 })
    if (wrapRef.current) io.observe(wrapRef.current)
    document.addEventListener('visibilitychange', perbarui)

    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', perbarui)
      berhenti()
    }
  }, [putaran])

  const terketik = Math.min(kalimat.length, Math.floor(waktu / KETIK_PER_HURUF))
  const sedangKetik = waktu < mulaiKirim
  const sudahKirim = waktu >= mulaiKirim
  const sedangBerpikir = sudahKirim && waktu < mulaiKartu
  const fieldTampil = waktu >= mulaiKartu ? Math.floor((waktu - mulaiKartu) / JEDA_FIELD) : -1

  // Mulai putaran KEDUA, hasil sebelumnya dibiarkan di layar selama kalimat
  // berikutnya diketik — persis seperti riwayat chat sungguhan. Tanpa ini panel
  // jadi kosong melompong beberapa detik tiap putaran dan terlihat seperti
  // rusak. Di putaran pertama justru sebaliknya: panel HARUS kosong, karena
  // belum ada apa pun yang dikirim.
  const sisaSebelumnya = sedangKetik && pernahSelesai
  const gelembungTampil = sudahKirim || sisaSebelumnya
  const kartuTampil = waktu >= mulaiKartu || sisaSebelumnya
  const tombolTampil = waktu >= mulaiTombol || sisaSebelumnya
  const fieldAktif = (i) => (sisaSebelumnya ? true : i <= fieldTampil)

  return (
    <div className="lp-hero-mock lp-rv" ref={wrapRef}>
      <div className="lp-mock-frame">
        <div className="lp-mock-head">
          <div className="lp-mock-head-l">
            <div className="lp-mock-avatar"><Bot size={18} aria-hidden="true" /></div>
            <div>
              <div className="lp-mock-name">{L.chatTitle}</div>
              <div className="lp-mock-sub">{L.chatStatus}</div>
            </div>
          </div>
          <MoreVertical size={16} className="lp-mock-menu" aria-hidden="true" />
        </div>

        <div className="lp-mock-tabs" aria-hidden="true">
          <span className="lp-mock-tab"><HelpCircle size={13} /> {L.tabTanya}</span>
          <span className="lp-mock-tab is-on"><PencilLine size={13} /> {L.tabCatat}</span>
        </div>

        {/* Isi panel dirender utuh sejak awal dan hanya di-fade per tahap, jadi
            tinggi bingkai tidak pernah berubah. Menambah elemen satu per satu ke
            DOM akan membuat hero melonjak-lonjak tiap putaran animasi. */}
        <div className="lp-mock-body" aria-hidden="true">
          <div className={`lp-msg lp-msg-me lp-mock-step${gelembungTampil ? ' is-on' : ''}`}>
            {kalimat}
          </div>

          <div className={`lp-typing lp-mock-step${sedangBerpikir ? ' is-on' : ''}`}>
            <span /><span /><span />
          </div>

          <div className={`lp-mock-draft lp-mock-step${kartuTampil ? ' is-on' : ''}`}>
            <div className="lp-mock-draft-title">{L.cardTitle}</div>
            <div className="lp-mock-draft-card">
              {L.fields.map((f, i) => (
                <div className={`lp-mock-field lp-mock-step${fieldAktif(i) ? ' is-on' : ''}`} key={f.l}>
                  <span className="lp-mock-field-l">{f.l}</span>
                  <span className={`lp-mock-field-v${f.pilih ? ' is-select' : ''}`}>
                    <span className="lp-mock-field-t">{f.v}</span>
                    {f.pilih && <ChevronDown size={13} aria-hidden="true" />}
                  </span>
                </div>
              ))}
            </div>
            <div className={`lp-mock-tail lp-mock-step${tombolTampil ? ' is-on' : ''}`}>
              <p className="lp-mock-warn">
                <AlertTriangle size={12} aria-hidden="true" /> {L.cardWarn}
              </p>
              <span className="lp-mock-save">
                <CheckCircle2 size={14} aria-hidden="true" /> {L.cardSave}
              </span>
            </div>
          </div>
        </div>

        <div className="lp-mock-foot">
          <div className="lp-mock-input">
            <div className={`lp-mock-textbox${sedangKetik ? ' is-typing' : ''}`}>
              {sedangKetik
                ? <>{kalimat.slice(0, terketik)}<i className="lp-caret" aria-hidden="true" /></>
                : L.inputPh}
            </div>
            <button type="button" className="lp-mock-send" tabIndex={-1} aria-hidden="true">
              <Send size={15} />
            </button>
          </div>
          <p className="lp-mock-footnote">{L.footNote}</p>
        </div>
      </div>
    </div>
  )
}
