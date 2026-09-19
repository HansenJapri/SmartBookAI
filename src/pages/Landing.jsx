import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Keyboard, Brain, LineChart, AlertTriangle, Users,
  ClipboardList, TrendingDown, PackageX,
  Globe, MessageCircle, Mail, MapPin, PlayCircle,
} from 'lucide-react'

// Ikon Instagram inline — versi lucide yang terpasang tidak mengekspor <Instagram/>.
const InstagramIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
)
// Ikon WhatsApp inline — lucide tidak menyediakan ikon merek ini.
const WhatsAppIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.14-.14.3-.35.45-.53.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.67-1.61-.92-2.2-.24-.58-.48-.5-.67-.51h-.57c-.2 0-.52.07-.8.38-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.87 1.22 3.07.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35z" />
    <path d="M12.04 2C6.6 2 2.17 6.43 2.16 11.87c0 1.74.46 3.44 1.32 4.94L2 22.5l5.85-1.53a9.87 9.87 0 0 0 4.18.93h.01c5.44 0 9.87-4.43 9.88-9.87A9.82 9.82 0 0 0 12.04 2zm0 17.86h-.01a8.2 8.2 0 0 1-4.18-1.14l-.3-.18-3.1.81.83-3.02-.2-.31a8.17 8.17 0 0 1-1.25-4.35c0-4.52 3.68-8.2 8.21-8.2 2.19 0 4.25.86 5.8 2.41a8.14 8.14 0 0 1 2.4 5.8c0 4.52-3.68 8.19-8.2 8.19z" />
  </svg>
)
import { CONTACT_EMAIL, SALES_WHATSAPP_URL } from '../lib/legal'
import { useLang } from '../context/LangContext'
import LangToggle from '../components/LangToggle'
import HeroAssistantMock from '../components/HeroAssistantMock'
import './landing.css'

const PROBLEM_ICONS = [ClipboardList, TrendingDown, PackageX]

// Tautan video demo. SENGAJA dikosongkan sampai videonya jadi: selama string ini
// kosong, tombol "Video Demo" dirender sebagai tombol nonaktif, bukan tautan mati
// yang membawa pengunjung ke halaman kosong. Isi dengan URL YouTube/Vimeo penuh
// (mis. 'https://youtu.be/xxxx') dan tombolnya otomatis hidup, membuka tab baru.
const VIDEO_DEMO_URL = ''

export default function Landing() {
  const { t } = useLang()
  const L = t.landing2

  // Landing selalu tampil mode terang (tak terpengaruh preferensi tema aplikasi).
  // Preferensi pengguna dipulihkan saat meninggalkan halaman.
  useEffect(() => {
    const html = document.documentElement
    const prev = html.dataset.theme
    html.dataset.theme = 'light'
    return () => { html.dataset.theme = prev || 'light' }
  }, [])

  // Reveal-on-scroll: .lp-rv element gets .in when in viewport.
  useEffect(() => {
    const els = document.querySelectorAll('.lp-rv')
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) }
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -40px' })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <div className="lp2">
      {/* Header */}
      <header className="lp-nav">
        <div className="lp-container lp-nav-inner">
          <Link to="/" className="lp-brand" aria-label="SmartBook AI">
            <img className="lp-brand-logo" src="/logo-mark.png" alt="" />
            SmartBook AI
          </Link>
          <nav className="lp-nav-links" aria-label="Utama">
            <a href="#fitur">{L.nav.fitur}</a>
            <a href="#cara">{L.nav.cara}</a>
            <a href="#solusi">{L.nav.solusi}</a>
          </nav>
          <div className="lp-nav-cta">
            <div className="lp-nav-tools">
              <LangToggle />
            </div>
            <Link to="/masuk" className="lp-btn lp-btn-ghost">{L.nav.masuk}</Link>
            <Link to="/daftar" className="lp-btn lp-btn-primary">{L.nav.bukaAI}</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="lp-hero">
        <div className="lp-hero-blob lp-hero-blob-a" aria-hidden="true" />
        <div className="lp-hero-blob lp-hero-blob-b" aria-hidden="true" />
        <div className="lp-container lp-hero-grid">
          <div className="lp-hero-copy">
            <h1 className="lp-rv">
              {L.hero.h1a}<span className="lp-hero-accent">{L.hero.h1b}</span>
            </h1>
            <p className="lp-lead lp-rv">{L.hero.lead}</p>
            <div className="lp-hero-cta lp-rv">
              <Link to="/daftar" className="lp-btn lp-btn-primary lp-btn-lg">{L.hero.ctaPrimary}</Link>
              {/* Tombol video demo. Selama VIDEO_DEMO_URL kosong, dirender sebagai
                  <button disabled> agar pengunjung tidak mengeklik tautan buntu;
                  judulnya menjelaskan kenapa. Begitu URL diisi, berubah jadi <a>
                  yang membuka tab baru. */}
              {VIDEO_DEMO_URL ? (
                <a
                  href={VIDEO_DEMO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lp-btn lp-btn-outline lp-btn-lg"
                >
                  <PlayCircle size={18} aria-hidden="true" /> {L.hero.ctaSecondary}
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  title={L.hero.ctaSecondarySoon}
                  className="lp-btn lp-btn-outline lp-btn-lg lp-btn-soon"
                >
                  <PlayCircle size={18} aria-hidden="true" /> {L.hero.ctaSecondary}
                </button>
              )}
            </div>
          </div>

          <HeroAssistantMock />
        </div>
      </section>

      {/* Problem */}
      <section className="lp-section lp-section-alt" id="solusi">
        <div className="lp-container">
          <div className="lp-head lp-center lp-rv">
            <h2>{L.problem.h2}</h2>
          </div>
          <div className="lp-grid-3">
            {L.problem.items.map((p, i) => {
              const Ic = PROBLEM_ICONS[i]
              return (
                <article className="lp-card lp-problem lp-rv" key={p.t} style={{ transitionDelay: `${i * 80}ms` }}>
                  <div className="lp-icon-tile lp-icon-danger" aria-hidden="true"><Ic size={24} /></div>
                  <h3>{p.t}</h3>
                  <p>{p.d}</p>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      {/* Features Bento */}
      <section className="lp-section" id="fitur">
        <div className="lp-container">
          <div className="lp-head lp-center lp-rv">
            <h2>{L.features.h2}</h2>
          </div>
          <div className="lp-bento">
            <article className="lp-bento-c lp-bento-1 lp-rv">
              <div className="lp-icon-tile lp-icon-primary" aria-hidden="true"><Keyboard size={22} /></div>
              <h3>{L.features.voiceT}</h3>
              <p>{L.features.voiceD}</p>
            </article>

            <article className="lp-bento-c lp-bento-2 lp-rv">
              <div className="lp-bento-2-copy">
                <h3>{L.features.scanT}</h3>
                <p>{L.features.scanD}</p>
              </div>
              <div className="lp-bento-2-art">
                {/* Foto, bukan grafis — dulu PNG 1,9 MB dan itu aset terberat di
                    halaman ini. Sekarang WebP 79 KB dengan cadangan JPEG 118 KB
                    untuk peramban yang belum mendukung WebP. */}
                <picture>
                  <source srcSet="/receipt-scanner.webp" type="image/webp" />
                  <img
                    src="/receipt-scanner.jpg"
                    alt="Ilustrasi pemindaian struk dengan kamera ponsel"
                    className="lp-bento-2-img"
                    width="1200"
                    height="685"
                    loading="lazy"
                    decoding="async"
                  />
                </picture>
              </div>
            </article>

            <article className="lp-bento-c lp-bento-3 lp-rv">
              <div className="lp-icon-tile lp-icon-soft" aria-hidden="true"><Brain size={22} /></div>
              <h4 className="lp-uppercase">{L.features.assistT}</h4>
              <p>{L.features.assistD}</p>
            </article>

            <article className="lp-bento-c lp-bento-4 lp-rv">
              <div className="lp-icon-tile lp-icon-primary" aria-hidden="true"><LineChart size={22} /></div>
              <h3>{L.features.predictT}</h3>
              <p>{L.features.predictD}</p>
            </article>

            <div className="lp-bento-stack">
              <article className="lp-bento-c lp-bento-mini lp-mini-danger lp-rv">
                <AlertTriangle size={20} aria-hidden="true" />
                <div>
                  <h5>{L.features.leakT}</h5>
                  <p>{L.features.leakD}</p>
                </div>
              </article>
              <article className="lp-bento-c lp-bento-mini lp-mini-info lp-rv">
                <Users size={20} aria-hidden="true" />
                <div>
                  <h5>{L.features.hrT}</h5>
                  <p>{L.features.hrD}</p>
                </div>
              </article>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="lp-section lp-section-dark" id="cara">
        <div className="lp-container">
          <div className="lp-head lp-center lp-rv">
            <h2>{L.how.h2}</h2>
            <p className="lp-head-sub">{L.how.sub}</p>
          </div>
          <div className="lp-steps">
            <div className="lp-steps-line" aria-hidden="true" />
            {L.how.steps.map((s, i) => (
              <div className="lp-step lp-rv" key={s.t} style={{ transitionDelay: `${i * 120}ms` }}>
                <div className="lp-step-num">{i + 1}</div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="lp-section lp-cta">
        <div className="lp-cta-blob lp-cta-blob-a" aria-hidden="true" />
        <div className="lp-cta-blob lp-cta-blob-b" aria-hidden="true" />
        <div className="lp-container lp-cta-inner lp-rv">
          <h2>{L.ctaFinal.h2}</h2>
          <p>{L.ctaFinal.p}</p>
          <div className="lp-cta-btns">
            <Link to="/daftar" className="lp-btn lp-btn-primary lp-btn-lg">{L.ctaFinal.primary}</Link>
            {/* Hubungi Sales membuka WhatsApp dengan pesan pembuka siap kirim.
                rel="noopener" wajib karena target="_blank": tanpa itu halaman
                tujuan bisa mengakses window.opener milik landing. */}
            <a
              href={SALES_WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="lp-btn lp-btn-outline-strong lp-btn-lg"
            >
              <WhatsAppIcon size={18} /> {L.ctaFinal.secondary}
            </a>
          </div>
          <p className="lp-cta-note">{L.ctaFinal.note}</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-grid">
          <div>
            <div className="lp-brand lp-brand-static">
              <img className="lp-brand-logo lp-brand-logo-footer" src="/logo-mark.png" alt="" />
              SmartBook AI
            </div>
            <p className="lp-foot-tag">{L.footer.tagline}</p>
            <div className="lp-foot-social">
              <a href="#" aria-label="Website"><Globe size={16} /></a>
              <a href="https://instagram.com/sovralytics_tech" target="_blank" rel="noopener noreferrer" aria-label="Instagram"><InstagramIcon size={16} /></a>
              <a href={SALES_WHATSAPP_URL} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"><WhatsAppIcon size={16} /></a>
              <a href={`mailto:${CONTACT_EMAIL}`} aria-label="Kontak"><MessageCircle size={16} /></a>
            </div>
          </div>
          <div>
            <h6>{L.footer.produk}</h6>
            <ul>
              <li><a href="#fitur">{L.footer.pFitur}</a></li>
              <li><a href="#fitur">{L.footer.pDash}</a></li>
              <li><a href="#fitur">{L.footer.pStok}</a></li>
              <li><Link to="/daftar">{L.footer.pHarga}</Link></li>
            </ul>
          </div>
          <div>
            <h6>{L.footer.perusahaan}</h6>
            <ul>
              <li><Link to="/masuk">{L.footer.cTentang}</Link></li>
              <li><Link to="/privasi">{L.footer.cPrivasi}</Link></li>
              <li><Link to="/ketentuan">{L.footer.cSyarat}</Link></li>
              <li><a href={`mailto:${CONTACT_EMAIL}`}>{L.footer.cBantuan}</a></li>
            </ul>
          </div>
          <div>
            <h6>{L.footer.kontak}</h6>
            <p className="lp-foot-line"><span className="lp-foot-ic"><MapPin size={14} aria-hidden="true" /></span> {L.footer.alamat}</p>
            <p className="lp-foot-line"><a href={SALES_WHATSAPP_URL} target="_blank" rel="noopener noreferrer"><span className="lp-foot-ic"><WhatsAppIcon size={14} /></span> {L.footer.whatsapp}</a></p>
            <p className="lp-foot-line"><a href={`mailto:${CONTACT_EMAIL}`}><span className="lp-foot-ic"><Mail size={14} aria-hidden="true" /></span> {CONTACT_EMAIL}</a></p>
            <p className="lp-foot-line"><a href="https://instagram.com/sovralytics_tech" target="_blank" rel="noopener noreferrer"><span className="lp-foot-ic"><InstagramIcon size={14} /></span> {L.footer.instagram}</a></p>
          </div>
        </div>
        <div className="lp-container lp-foot-bottom">
          <span>{L.footer.copyright}</span>
        </div>
      </footer>
    </div>
  )
}
