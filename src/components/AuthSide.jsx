import { Link } from 'react-router-dom'
import LangToggle from './LangToggle'

export default function AuthSide({ title, subtitle, points }) {
  return (
    <div className="auth-side">
      <div className="auth-side-top">
        <Link to="/" className="brand"><img src="/logo-mark.png" alt="" /><span>Smart<b>Book</b> AI</span></Link>
        <LangToggle />
      </div>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
        <ul>
          {points.map((p) => <li key={p}><span className="ck">✓</span> {p}</li>)}
        </ul>
      </div>
      <p style={{ fontSize: 13, opacity: .7 }}>© 2026 SmartBook AI</p>
    </div>
  )
}
