import { useEffect, useRef, useState } from 'react'
import { MessageCircle, X, Send, Mic, MicOff, Trash2 } from 'lucide-react'
import { askAI } from '../lib/ai'

const CONSENT_KEY = 'bukupintar_ai_consent'
const SpeechRec = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null

export default function Chatbot() {
  const [open, setOpen] = useState(false)
  const [consent, setConsent] = useState(false)
  const [messages, setMessages] = useState([]) // {role:'user'|'assistant', text} - TIDAK disimpan
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
    const next = [...messages, { role: 'user', text }]
    setMessages(next)
    setInput('')
    setBusy(true)
    try {
      const reply = await askAI(text, history)
      setMessages((m) => [...m, { role: 'assistant', text: reply }])
    } catch (e) {
      setErr(e.message)
      setMessages((m) => [...m, { role: 'assistant', text: 'Maaf, saya belum bisa menjawab sekarang. ' + e.message }])
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const toggleVoice = () => {
    if (!SpeechRec) { setErr('Perangkat/peramban ini belum mendukung input suara.'); return }
    if (listening) { recRef.current?.stop(); return }
    const rec = new SpeechRec()
    rec.lang = 'id-ID'
    rec.interimResults = false
    rec.continuous = false
    rec.onresult = (ev) => {
      const t = ev.results[0][0].transcript
      setInput((prev) => (prev ? prev + ' ' : '') + t)
    }
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
    <div className="chat-panel" role="dialog" aria-label="Asisten AI">
      <div className="chat-head">
        <div>
          <b>Asisten BukuPintar</b>
          <div className="chat-sub">Panduan & tanya jawab usaha Anda</div>
        </div>
        <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Tutup"><X size={18} /></button>
      </div>

      {!consent ? (
        <div className="chat-consent">
          <p>Asisten AI membantu Anda memakai aplikasi dan menjawab pertanyaan tentang angka usaha Anda.</p>
          <ul>
            <li>Yang dikirim ke layanan AI hanya <b>ringkasan angka</b> (total, kategori), bukan data pelanggan atau nomor rekening.</li>
            <li>Percakapan <b>tidak disimpan</b>.</li>
            <li>Saat ini memakai layanan AI gratis, jadi <b>jangan mengetik informasi yang sangat rahasia</b>.</li>
          </ul>
          <p className="muted-sm">Selengkapnya pada Kebijakan Privasi.</p>
          <button className="btn btn-primary btn-block" onClick={enableAI}>Aktifkan Asisten AI</button>
        </div>
      ) : (
        <>
          <div className="chat-body" ref={bodyRef}>
            {messages.length === 0 && (
              <div className="chat-hint">
                <p>Halo! Ada yang bisa saya bantu? Contoh pertanyaan:</p>
                <div className="chat-chips">
                  <button onClick={() => setInput('Berapa laba bersih saya bulan ini?')}>Laba bersih bulan ini?</button>
                  <button onClick={() => setInput('Berapa total pemasukan dan pengeluaran saya?')}>Pemasukan &amp; pengeluaran?</button>
                  <button onClick={() => setInput('Apa pengeluaran terbesar saya?')}>Pengeluaran terbesar?</button>
                  <button onClick={() => setInput('Bagaimana cara mencatat pemasukan dan membuat invoice?')}>Cara buat invoice?</button>
                  <button onClick={() => setInput('Produk apa saja yang stoknya menipis?')}>Stok menipis?</button>
                  <button onClick={() => setInput('Apakah ada penjualan yang belum lunas?')}>Penjualan belum lunas?</button>
                  <button onClick={() => setInput('Bagaimana cara membaca struk dengan AI?')}>Cara baca struk?</button>
                  <button onClick={() => setInput('Bagaimana cara mengunduh laporan laba rugi?')}>Cara unduh laporan?</button>
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
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Tulis pertanyaan, atau tekan mikrofon untuk bicara..."
            />
            {SpeechRec && (
              <button className="icon-btn" onClick={toggleVoice} title="Input suara" aria-label="Input suara">
                {listening ? <MicOff size={18} color="#dc2626" /> : <Mic size={18} />}
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
