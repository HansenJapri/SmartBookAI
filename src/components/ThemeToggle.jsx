import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'

// Tombol ganti tema terang/gelap. Preferensi disimpan di localStorage;
// nilai awal diset lebih dulu oleh skrip inline di index.html (anti-FOUC).
export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('bp-theme', theme) } catch { /* private mode */ }
  }, [theme])

  const dark = theme === 'dark'
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      title={dark ? 'Mode terang' : 'Mode gelap'}
      aria-label={dark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap'}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}
