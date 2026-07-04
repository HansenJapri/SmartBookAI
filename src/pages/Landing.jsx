import { Link } from 'react-router-dom'
import {
  Camera, FileText, Smartphone, Store, MessageCircle, Mail,
  Landmark, Receipt, Puzzle, ArrowLeftRight, BarChart3,
} from 'lucide-react'
import { CONTACT_EMAIL } from '../lib/legal'
import { useLang } from '../context/LangContext'
import LangToggle from '../components/LangToggle'

// Ikon tetap (teks diambil dari kamus i18n, dicocokkan berdasarkan urutan).
const CHAN_ICONS = [Camera, FileText, Smartphone, Store, MessageCircle, Mail]
const CHAN_SOON = [false, false, false, false, true, true]
const PROB_ICONS = [Landmark, Receipt, Puzzle]
const FITUR_ICONS = [ArrowLeftRight, BarChart3, FileText]

export default function Landing() {
  const { t } = useLang()
  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <div className="brand"><img src="/logo.svg" alt="" /><span>Buku<b>Pintar</b> AI</span></div>
          <nav className="nav-links">
            <a href="#masalah">{t.nav.masalah}</a>
            <a href="#reveal">{t.nav.kebocoran}</a>
            <a href="#channel">{t.nav.channel}</a>
            <a href="#fitur">{t.nav.fitur}</a>
          </nav>
          <div className="nav-spacer" />
          <div className="nav-cta">
            <LangToggle />
            <Link to="/masuk" className="btn btn-ghost">{t.nav.masuk}</Link>
            <Link to="/daftar" className="btn btn-primary">{t.nav.coba}</Link>
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="hero-blob" />
        <div className="container hero-grid">
          <div>
            <span className="eyebrow">{t.hero.eyebrow}</span>
            <h1>{t.hero.h1pre}<em>{t.hero.h1em}</em>{t.hero.h1post}</h1>
            <p className="lead">{t.hero.lead}</p>
            <div className="hero-cta">
              <Link to="/daftar" className="btn btn-primary btn-lg">{t.hero.cta1}</Link>
              <a href="#channel" className="btn btn-ghost btn-lg">{t.hero.cta2}</a>
            </div>
            <div className="hero-trust">
              <div><div className="t-num">{t.hero.t1n}</div><div className="t-lbl">{t.hero.t1l}</div></div>
              <div><div className="t-num">{t.hero.t2n}</div><div className="t-lbl">{t.hero.t2l}</div></div>
              <div><div className="t-num">{t.hero.t3n}</div><div className="t-lbl">{t.hero.t3l}</div></div>
            </div>
            <div className="hero-source">{t.hero.source}</div>
          </div>
          <div className="phone">
            <div className="phone-screen">
              <div className="phone-top">
                <div className="ptitle">{t.hero.pOmzet}</div>
                <div className="pomzet">Rp 2.400.000</div>
                <div className="pdelta">{t.hero.pNote}</div>
              </div>
              <div className="notif-feed">
                {[
                  { Ic: MessageCircle, bg: '#f0fdf4', tt: t.hero.n1t, d: t.hero.n1d, tag: t.hero.tagJual, cls: 'tag-in' },
                  { Ic: Store, bg: '#fff7ed', tt: t.hero.n2t, d: t.hero.n2d, tag: t.hero.tagJual, cls: 'tag-in' },
                  { Ic: Camera, bg: '#fffbeb', tt: t.hero.n3t, d: t.hero.n3d, tag: t.hero.tagStok, cls: 'tag-out' },
                ].map((n, i) => (
                  <div className="notif" key={i} style={{ animationDelay: `${i * 0.12}s` }}>
                    <div className="ic" style={{ background: n.bg }}><n.Ic size={18} /></div>
                    <div><div className="nt">{n.tt}</div><div className="nd">{n.d}</div></div>
                    <span className={`tag ${n.cls}`}>{n.tag}</span>
                  </div>
                ))}
              </div>
              <div className="phone-note">{t.hero.pIlus}</div>
            </div>
          </div>
        </div>
      </section>

      <div className="strip">
        <div className="container">
          <div className="strip-title">{t.strip}</div>
          <div className="strip-row">
            {[['QRIS', '#4f46e5'], ['BCA', '#0ea5e9'], ['Mandiri', '#eab308'], ['BRI', '#1d4ed8'], ['GoPay', '#16a34a'], ['OVO', '#7c3aed'], ['Dana', '#2563eb'], ['Tokopedia', '#16a34a'], ['Shopee', '#f97316'], ['TikTok Shop', '#0f172a']].map(([n, c]) => (
              <span className="chip" key={n}><span className="dot" style={{ background: c }} />{n}</span>
            ))}
          </div>
        </div>
      </div>

      <section className="section" id="masalah">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">{t.masalah.eyebrow}</span>
            <h2>{t.masalah.h2}</h2>
            <p>{t.masalah.p}</p>
          </div>
          <div className="prob-grid">
            {t.masalah.items.map((p, i) => { const Ic = PROB_ICONS[i]; return (
              <div className="prob-card" key={p.t}><div className="pe"><Ic size={24} /></div><h3>{p.t}</h3><p>{p.d}</p></div>
            ) })}
          </div>
        </div>
      </section>

      <section className="section" id="reveal">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">{t.reveal.eyebrow}</span>
            <h2>{t.reveal.h2}</h2>
            <p>{t.reveal.p}</p>
          </div>
          <div className="reveal-card">
            <div className="reveal-top">
              <div><div className="reveal-k">{t.reveal.gross}</div><div className="reveal-gross">Rp 50.000.000</div></div>
              <div className="reveal-net-wrap"><div className="reveal-k">{t.reveal.net}</div><div className="reveal-net">Rp 43.000.000</div></div>
            </div>
            <div className="reveal-bar" role="img" aria-label="86% : 14%"><span className="reveal-bar-net" style={{ width: '86%' }} /><span className="reveal-bar-leak" style={{ width: '14%' }} /></div>
            <div className="reveal-legend"><span><i className="dot net" />{t.reveal.legNet}</span><span><i className="dot leak" />{t.reveal.legLeak}</span></div>
            <ul className="reveal-list">
              <li><span>{t.reveal.l1}</span><b>Rp 3.100.000</b></li>
              <li><span>{t.reveal.l2}</span><b>Rp 1.800.000</b></li>
              <li><span>{t.reveal.l3}</span><b>Rp 1.500.000</b></li>
              <li><span>{t.reveal.l4}</span><b>Rp 600.000</b></li>
            </ul>
            <div className="reveal-sum">{t.reveal.sumPre}<b>Rp 7.000.000</b>{t.reveal.sumPost}</div>
          </div>
          <p className="reveal-note">{t.reveal.note}</p>
        </div>
      </section>

      <section className="section section-alt" id="channel">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">{t.channel.eyebrow}</span>
            <h2>{t.channel.h2}</h2>
            <p>{t.channel.p}</p>
          </div>
          <div className="chan-grid">
            {t.channel.items.map((c, i) => { const Ic = CHAN_ICONS[i]; return (
              <div className="chan-card" key={c.t}>
                <div className="cic"><Ic size={24} /></div>
                <h3>{c.t} {CHAN_SOON[i] && <span className="soon-badge">{t.channel.soon}</span>}</h3>
                <p>{c.d}</p>
              </div>
            ) })}
          </div>
        </div>
      </section>

      <section className="section" id="fitur">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">{t.fitur.eyebrow}</span>
            <h2>{t.fitur.h2}</h2>
          </div>
          <div className="prob-grid">
            {t.fitur.items.map((f, i) => { const Ic = FITUR_ICONS[i]; return (
              <div className="prob-card" key={f.t}><div className="pe"><Ic size={24} /></div><h3>{f.t}</h3><p>{f.d}</p></div>
            ) })}
          </div>
        </div>
      </section>

      <section className="section section-alt" id="metrik">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">{t.metrik.eyebrow}</span>
            <h2>{t.metrik.h2}</h2>
            <p>{t.metrik.p}</p>
          </div>
          <div className="metric-grid">
            {t.metrik.items.map((m) => (
              <div className="metric" key={m.l}><div className="mv">{m.v}</div><div className="ml">{m.l}</div></div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-alt" id="privasi-ringkas">
        <div className="container">
          <div className="section-head">
            <span className="eyebrow">{t.trust.eyebrow}</span>
            <h2>{t.trust.h2}</h2>
            <p>{t.trust.p}</p>
          </div>
          <div className="trust-grid">
            {t.trust.items.map((it) => (
              <div className="trust-item" key={it.b}><b>{it.b}</b>{it.t}</div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="cta">
            <h2>{t.cta.h2}</h2>
            <p>{t.cta.p}</p>
            <Link to="/daftar" className="btn btn-primary btn-lg">{t.cta.btn}</Link>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="container">
          <div className="footer-grid">
            <div>
              <div className="brand"><img src="/logo.svg" alt="" /><span>Buku<b>Pintar</b> AI</span></div>
              <p>{t.footer.tagline}</p>
              <p className="foot-contact">{t.footer.kontak}: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
            </div>
            <div className="fcol">
              <h5>{t.footer.produk}</h5>
              <a href="#channel">{t.footer.channelInput}</a><a href="#fitur">{t.footer.fitur}</a><Link to="/daftar">{t.footer.daftar}</Link>
            </div>
            <div className="fcol">
              <h5>{t.footer.untukUmkm}</h5>
              <a href="#metrik">{t.footer.laporanKur}</a><a href="#metrik">{t.footer.persiapanSpt}</a><Link to="/masuk">{t.footer.masuk}</Link>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© 2026 BukuPintar AI</span>
            <span className="foot-disc">{t.footer.disc}</span>
          </div>
        </div>
      </footer>
    </>
  )
}
