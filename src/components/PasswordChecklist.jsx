import { checkPassword, PASSWORD_RULES } from '../lib/validators'

export default function PasswordChecklist({ value }) {
  const c = checkPassword(value)
  if (!value) return null
  return (
    <ul className="pw-check">
      {PASSWORD_RULES.map(([key, label]) => (
        <li key={key} className={c[key] ? 'ok' : ''}>
          <span className="pw-dot">{c[key] ? '✓' : '○'}</span> {label}
        </li>
      ))}
    </ul>
  )
}
