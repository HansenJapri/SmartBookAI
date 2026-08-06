import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Mic, ScanLine, Brain, LineChart, AlertTriangle, Users,
  Bot, CheckCircle2, MoreVertical, Image as ImageIcon,
  Send, ChevronRight, ClipboardList, TrendingDown, PackageX,
  Globe, MessageCircle, Mail, MapPin,
} from 'lucide-react'

// Ikon Instagram inline — versi lucide yang terpasang tidak mengekspor <Instagram/>.
const InstagramIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
)
import { CONTACT_EMAIL } from '../lib/legal'
import { useLang } from '../context/LangContext'
import LangToggle from '../components/LangToggle'
import './landing.css'

const PROBLEM_ICONS = [ClipboardList, TrendingDown, PackageX]

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
          <Link to="/" className="lp-brand" aria-label="SmartBook AI">SmartBook AI</Link>
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
              {/* Diarahkan ke /demo (task B4): tujuannya kini laporan kebocoran
                  berdata contoh, bukan jangkar #cara. Label dan ikon ikut diganti
                  karena tidak pernah ada video di balik tautan ini. */}
              <Link to="/demo" className="lp-btn lp-btn-outline lp-btn-lg">
                <TrendingDown size={18} aria-hidden="true" /> {L.hero.ctaSecondary}
              </Link>
            </div>
          </div>

          {/* Chat mockup card */}
          <div className="lp-hero-mock lp-rv">
            <div className="lp-mock-frame">
              <div className="lp-mock-head">
                <div className="lp-mock-head-l">
                  <div className="lp-mock-avatar"><Bot size={20} aria-hidden="true" /></div>
                  <div>
                    <div className="lp-mock-name">{L.hero.chatTitle}</div>
                    <div className="lp-mock-sub">{L.hero.chatStatus}</div>
                  </div>
                </div>
                <MoreVertical size={18} className="lp-mock-menu" aria-hidden="true" />
              </div>

              <div className="lp-mock-body">
                <div className="lp-msg lp-msg-bot lp-msg-anim" style={{ animationDelay: '.2s' }}>
                  {L.hero.msgBot}
                </div>
                <div className="lp-msg lp-msg-me lp-msg-anim" style={{ animationDelay: '.9s' }}>
                  {L.hero.msgUser}
                </div>
                <div className="lp-msg lp-msg-bot lp-msg-card lp-msg-anim" style={{ animationDelay: '1.6s' }}>
                  <div className="lp-msg-card-head">
                    <CheckCircle2 size={16} aria-hidden="true" />
                    <span>{L.hero.recTitle}</span>
                  </div>
                  <div className="lp-msg-card-list">
                    <p>{L.hero.recL1}</p>
                    <p>{L.hero.recL2}</p>
                    <p className="lp-strong">{L.hero.recL3}</p>
                  </div>
                  <p className="lp-msg-card-note">{L.hero.recNote}</p>
                </div>
                <div className="lp-typing lp-msg-anim" style={{ animationDelay: '2.3s' }} aria-hidden="true">
                  <span /><span /><span />
                </div>
              </div>

              <div className="lp-mock-input">
                <ImageIcon size={18} aria-hidden="true" />
                <div className="lp-mock-textbox">{L.hero.inputPh}</div>
                <button type="button" className="lp-mock-send" aria-label="Kirim"><Send size={16} /></button>
              </div>
            </div>
          </div>
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
              <div className="lp-icon-tile lp-icon-primary" aria-hidden="true"><Mic size={22} /></div>
              <h3>{L.features.voiceT}</h3>
              <p>{L.features.voiceD}</p>
            </article>

            <article className="lp-bento-c lp-bento-2 lp-rv">
              <div className="lp-bento-2-copy">
                <h3>{L.features.scanT}</h3>
                <p>{L.features.scanD}</p>
              </div>
              <div className="lp-bento-2-art">
                <img
                  src="/receipt-scanner.png"
                  alt="Ilustrasi pemindaian struk dengan kamera ponsel"
                  className="lp-bento-2-img"
                  loading="lazy"
                  decoding="async"
                />
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
            <a href={`mailto:${CONTACT_EMAIL}`} className="lp-btn lp-btn-outline-strong lp-btn-lg">{L.ctaFinal.secondary}</a>
          </div>
          <p className="lp-cta-note">{L.ctaFinal.note}</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-grid">
          <div>
            <div className="lp-brand lp-brand-static">SmartBook AI</div>
            <p className="lp-foot-tag">{L.footer.tagline}</p>
            <div className="lp-foot-social">
              <a href="#" aria-label="Website"><Globe size={16} /></a>
              <a href="https://instagram.com/sovralytics_tech" target="_blank" rel="noopener noreferrer" aria-label="Instagram"><InstagramIcon size={16} /></a>
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
