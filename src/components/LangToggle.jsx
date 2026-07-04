import { useLang } from '../context/LangContext'
import { LANGS, LANG_LABEL } from '../lib/i18n'

// Pengalih bahasa ID / EN. Pilihan disimpan di perangkat (localStorage).
export default function LangToggle() {
  const { lang, setLang } = useLang()
  return (
    <div className="lang-toggle" role="group" aria-label="Pilih bahasa">
      {LANGS.map((l) => (
        <button key={l} type="button" className={lang === l ? 'on' : ''}
          onClick={() => setLang(l)} aria-pressed={lang === l}>{LANG_LABEL[l]}</button>
      ))}
    </div>
  )
}
