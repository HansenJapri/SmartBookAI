import { createContext, useContext, useEffect, useState } from 'react'
import { translations, LANGS } from '../lib/i18n'

const LangCtx = createContext(null)
const KEY = 'bukupintar_lang'

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try { const s = localStorage.getItem(KEY); if (s && LANGS.includes(s)) return s } catch { /* abaikan */ }
    return 'id'
  })
  const setLang = (l) => {
    if (!LANGS.includes(l)) return
    setLangState(l)
    try { localStorage.setItem(KEY, l) } catch { /* abaikan */ }
  }
  useEffect(() => { try { document.documentElement.lang = lang } catch { /* abaikan */ } }, [lang])

  const t = translations[lang] || translations.id
  return <LangCtx.Provider value={{ lang, setLang, t }}>{children}</LangCtx.Provider>
}

export const useLang = () => useContext(LangCtx) || { lang: 'id', setLang: () => {}, t: translations.id }
