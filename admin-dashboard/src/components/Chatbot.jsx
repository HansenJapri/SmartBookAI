import { useEffect, useRef, useState } from 'react'
import { MessageCircle, X, Send, Mic, MicOff, Trash2 } from 'lucide-react'
import { askAdminAI } from '../lib/ai'

const CONSENT_KEY = 'bukupintar_admin_ai_consent'
const SpeechRec = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null

export default function Chatbot() {
  const [open, setOpen] = useState(false)
  const [consent, setConsent] = useState(false)
  const [messages, setMessages] = useState([]) // tidak disimpan
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [listening, setListening] = useState(false)
  const recRef = useRef(null)
  const bodyRef = useRef(null)

  useEffect(() => {
    try { setConsent(localStorage.getItem(CONSENT_KEY) === '1') } catch { /* abaikan */ }
  }, [])
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages, busy])

  const enableAI = () => {
    try { localStorage.setItem(CONSENT_KEY, '1') } catch { /* abaikan */ }
    setConsent(true)
  }

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setErr('')
    const history = messages.slice(-6)
    setMessages((m) => [...m, { role: 'user', text }])
    setInput('')
    setBusy(true)
    try {
      const reply = await askAdminAI(text, history)
      setMessages((m) => [...m, { role: 'assistant', text: reply }])
    } catch (e) {
      setErr(e.message)
      setMessages((m) => [...m, { role: 'assistant', text: 'Maaf, belum bisa menjawab sekarang. ' + e.message }])
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }

  const toggleVoice = () => {
    if (!SpeechRec) { setErr('Peramban ini belum mendukung input suara.'); return }
    if (listening) { recRef.current?.stop(); return }
    const rec = new SpeechRec()
    rec.lang = 'id-ID'; rec.interimResults = false; rec.continuous = false
    rec.onresult = (ev) => { const t = ev.results[0][0].transcript; setInput((p) => (p ? p + ' ' : '') + t) }
    rec.onerror = () => setErr('Gagal menangkap suara. Coba lagi.')
    rec.onend = () => setListening(false)
    recRef.current = rec
    setListening(true)
    rec.start()
  }

  const clearChat = () => { setMessages([]); setErr('') }

  if (!open) {
    return (
      <button className="chat-fab" onClick={() => setOpen(true)} aria-label="Buka asisten AI">
        <MessageCircle size={24} />
      </button>
    )
  }

  return (
    <div className="chat-panel" role="dialog" aria-label="Asisten AI Admin">
      <div className="chat-head">
        <div>
          <b>Asisten Admin</b>
          <div className="chat-sub">Tanya metrik & kesehatan platform</div>
        </div>
        <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Tutup"><X size={18} /></button>
      </div>

      {!consent ? (
        <div className="chat-consent">
          <p>Asisten AI membantu Anda memahami metrik platform.</p>
          <ul>
            <li>Yang dikirim ke layanan AI hanya <b>angka agregat</b> (jumlah pengguna, transaksi, rating), <b>bukan data pribadi</b> pengguna.</li>
            <li>Percakapan <b>tidak disimpan</b>.</li>
            <li>Saat ini memakai layanan AI gratis, jadi hindari mengetik informasi sangat rahasia.</li>
          </ul>
          <button className="btn btn-primary btn-block" onClick={enableAI}>Aktifkan Asisten AI</button>
        </div>
      ) : (
        <>
          <div className="chat-body" ref={bodyRef}>
            {messages.length === 0 && (
              <div className="chat-hint">
                <p>Halo, Admin. Contoh pertanyaan:</p>
                <div className="chat-chips">
                  <button onClick={() => setInput('Berapa total pengguna dan berapa yang aktif 30 hari terakhir?')}>Pengguna aktif?</button>
                  <button onClick={() => setInput('Berapa pengguna baru dalam 7 hari terakhir?')}>Pengguna baru?</button>
                  <button onClick={() => setInput('Bagaimana tingkat kepuasan pengguna sejauh ini?')}>Kepuasan pengguna?</button>
                  <button onClick={() => setInput('Berapa rata-rata rating dari pengguna?')}>Rata-rata rating?</button>
                  <button onClick={() => setInput('Berapa total nilai transaksi 30 hari terakhir?')}>Nilai transaksi 30 hari?</button>
                  <button onClick={() => setInput('Berapa jumlah power user di platform?')}>Power users?</button>
                  <button onClick={() => setInput('Berapa feedback yang belum ditangani?')}>Feedback belum ditangani?</button>
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role}`}>{m.text}</div>
            ))}
            {busy && <div className="chat-msg assistant chat-typing">Sedang mengetik...</div>}
          </div>

          {err && <div className="chat-err">{err}</div>}

          <div className="chat-input">
            <textarea rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey}
              placeholder="Tulis pertanyaan, atau tekan mikrofon untuk bicara..." />
            {SpeechRec && (
              <button className="icon-btn" onClick={toggleVoice} title="Input suara" aria-label="Input suara">
                {listening ? <MicOff size={18} color="#e11d48" /> : <Mic size={18} />}
              </button>
            )}
            <button className="icon-btn" onClick={() => setInput('')} title="Hapus teks" aria-label="Hapus teks" disabled={!input}>
              <Trash2 size={18} />
            </button>
            <button className="chat-send" onClick={send} disabled={busy || !input.trim()} aria-label="Kirim">
              <Send size={18} />
            </button>
          </div>
          <div className="chat-foot">
            <button className="linklike" onClick={clearChat} disabled={!messages.length}>Bersihkan percakapan</button>
            <span className="muted-sm">Jawaban AI bersifat bantuan, periksa kembali angka penting.</span>
          </div>
        </>
      )}
    </div>
  )
}
