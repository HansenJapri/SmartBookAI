import { useEffect, useRef, useState } from 'react'
import { MessageCircle, X, Send, Mic, MicOff, Trash2, HelpCircle, PencilLine } from 'lucide-react'
import { askAI, catatAI } from '../lib/ai'
import { addTransactionsBulk, fetchCategories, fetchTodayTotals } from '../lib/api'
import { rupiah } from '../lib/format'
import AIDisclaimer from './AIDisclaimer'

const CONSENT_KEY = 'bukupintar_ai_consent'

// Gabungkan tanggal (YYYY-MM-DD dari AI) dengan waktu jam:menit:detik SAAT INI.
// Dibangun dari komponen tanggal lokal agar tanggal tidak bergeser ke UTC, dan
// menghindari bug lama yang memaksa semua transaksi AI ke jam 12:00.
function occurredAtIso(dateStr) {
  const now = new Date()
  const ds = /^\d{4}-\d{2}-\d{2}$/.test(dateStr || '') ? dateStr : now.toISOString().slice(0, 10)
  const [y, m, d] = ds.split('-').map(Number)
  return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString()
}
const SpeechRec = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null

export default function Chatbot() {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('tanya') // 'tanya' (Q&A) | 'catat' (input transaksi)
  const [consent, setConsent] = useState(false)
  // Pesan: {role:'user'|'assistant', text} ATAU {role:'assistant', type:'draft', drafts, note, saved}
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [listening, setListening] = useState(false)
  const [cats, setCats] = useState([]) // kategori user (untuk select di kartu draf)
  const recRef = useRef(null)
  const bodyRef = useRef(null)

  useEffect(() => {
    try { setConsent(localStorage.getItem(CONSENT_KEY) === '1') } catch { /* abaikan */ }
  }, [])

  // Tombol "+ Catat" di bar bawah HP membuka asisten langsung dalam mode Catat.
  useEffect(() => {
    const h = () => { setOpen(true); setMode('catat') }
    window.addEventListener('open-chat-catat', h)
    return () => window.removeEventListener('open-chat-catat', h)
  }, [])

  useEffect(() => {
    if (open && consent && cats.length === 0) {
      fetchCategories().then(setCats).catch(() => {})
    }
  }, [open, consent]) // eslint-disable-line

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages, busy])

  const catNames = (direction) => cats.filter((c) => c.direction === direction).map((c) => c.name)

  const enableAI = () => {
    try { localStorage.setItem(CONSENT_KEY, '1') } catch { /* abaikan */ }
    setConsent(true)
  }

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setErr('')
    const next = [...messages, { role: 'user', text }]
    setMessages(next)
    setInput('')
    setBusy(true)
    try {
      if (mode === 'tanya') {
        // Riwayat hanya dari pesan teks biasa (kartu draf tidak ikut).
        const history = messages.filter((m) => !m.type && typeof m.text === 'string').slice(-6)
        const reply = await askAI(text, history)
        setMessages((m) => [...m, { role: 'assistant', text: reply }])
      } else {
        const res = await catatAI(text)
        const drafts = res?.transactions || []
        if (!drafts.length) {
          setMessages((m) => [...m, {
            role: 'assistant',
            text: res?.note || 'Saya belum menangkap transaksi dari kalimat itu. Sebutkan nominalnya ya, contoh: "laku 3 donat total 15 ribu".',
          }])
        } else {
          setMessages((m) => [...m, { role: 'assistant', type: 'draft', drafts, note: res?.note || '', saved: false }])
        }
      }
    } catch (e) {
      setErr(e.message)
      setMessages((m) => [...m, { role: 'assistant', text: 'Maaf, saya belum bisa memproses sekarang. ' + e.message }])
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const toggleVoice = () => {
    if (!SpeechRec) { setErr('Perangkat/peramban ini belum mendukung input suara. Gunakan mikrofon keyboard HP Anda.'); return }
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

  // ---- Aksi pada kartu draf (human-in-the-loop sebelum simpan) ----
  const patchDraft = (msgIdx, draftIdx, patch) => {
    setMessages((all) => all.map((m, i) => {
      if (i !== msgIdx || m.type !== 'draft') return m
      return { ...m, drafts: m.drafts.map((d, j) => (j === draftIdx ? { ...d, ...patch } : d)) }
    }))
  }
  const removeDraft = (msgIdx, draftIdx) => {
    setMessages((all) => all.map((m, i) => {
      if (i !== msgIdx || m.type !== 'draft') return m
      return { ...m, drafts: m.drafts.filter((_, j) => j !== draftIdx) }
    }))
  }

  const saveDrafts = async (msgIdx) => {
    const msg = messages[msgIdx]
    if (!msg || msg.type !== 'draft' || msg.saved || saving) return
    const rows = msg.drafts
      .filter((d) => Number(d.amount) > 0)
      .map((d) => ({
        description: String(d.description || '').slice(0, 200) || (d.direction === 'in' ? 'Penjualan' : 'Pengeluaran'),
        amount: Math.round(Number(d.amount)),
        direction: d.direction === 'in' ? 'in' : 'out',
        category: d.category,
        channel: 'asisten',
        occurred_at: occurredAtIso(d.occurred_at),
        payment_status: d.direction === 'in' && d.payment_status === 'belum' ? 'belum' : 'lunas',
      }))
    if (!rows.length) { setErr('Tidak ada transaksi valid untuk disimpan (nominal harus lebih dari 0).'); return }
    setSaving(true); setErr('')
    try {
      await addTransactionsBulk(rows)
      setMessages((all) => all.map((m, i) => (i === msgIdx ? { ...m, saved: true } : m)))
      // Rekap DETERMINISTIK dari database (bukan AI) — nol risiko halusinasi.
      let recap = `${rows.length} transaksi tersimpan.`
      try {
        const t = await fetchTodayTotals()
        recap += ` Ringkasan hari ini: pemasukan ${rupiah(t.income)}, pengeluaran ${rupiah(t.expense)}, laba ${rupiah(t.profit)}.`
      } catch { /* rekap opsional */ }
      setMessages((m) => [...m, { role: 'assistant', text: recap }])
    } catch (e) {
      setErr('Gagal menyimpan: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

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
          <b>Asisten SmartBook</b>
          <div className="chat-sub">{mode === 'tanya' ? 'Panduan & tanya jawab usaha Anda' : 'Catat transaksi lewat ketikan / suara'}</div>
        </div>
        <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Tutup"><X size={18} /></button>
      </div>

      {!consent ? (
        <div className="chat-consent">
          <p>Asisten AI membantu Anda memakai aplikasi, menjawab pertanyaan angka usaha, dan mencatat transaksi dari ketikan atau suara.</p>
          <ul>
            <li>Yang dikirim ke layanan AI hanya <b>ringkasan angka</b> dan <b>kalimat yang Anda ketik/ucapkan</b> — bukan data pelanggan atau nomor rekening.</li>
            <li>Percakapan <b>tidak disimpan</b>. Transaksi hasil mode Catat baru tersimpan <b>setelah Anda tekan Simpan</b>.</li>
            <li>Saat ini memakai layanan AI gratis, jadi <b>jangan mengetik informasi yang sangat rahasia</b>.</li>
          </ul>
          <p className="muted-sm">Selengkapnya pada Kebijakan Privasi.</p>
          <button className="btn btn-primary btn-block" onClick={enableAI}>Aktifkan Asisten AI</button>
        </div>
      ) : (
        <>
          <div className="chat-mode seg">
            <button type="button" className={mode === 'tanya' ? 'on-in' : ''} onClick={() => { setMode('tanya'); setErr('') }}>
              <HelpCircle size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />Tanya
            </button>
            <button type="button" className={mode === 'catat' ? 'on-in' : ''} onClick={() => { setMode('catat'); setErr('') }}>
              <PencilLine size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />Catat
            </button>
          </div>

          <div className="chat-body" ref={bodyRef}>
            {messages.length === 0 && mode === 'tanya' && (
              <div className="chat-hint">
                <p>Halo! Ada yang bisa saya bantu? Contoh pertanyaan:</p>
                <div className="chat-chips">
                  <button onClick={() => setInput('Berapa laba bersih saya bulan ini?')}>Laba bersih bulan ini?</button>
                  <button onClick={() => setInput('Berapa total pemasukan dan pengeluaran saya?')}>Pemasukan &amp; pengeluaran?</button>
                  <button onClick={() => setInput('Apa pengeluaran terbesar saya?')}>Pengeluaran terbesar?</button>
                  <button onClick={() => setInput('Bagaimana cara mencatat pemasukan dan membuat invoice?')}>Cara buat invoice?</button>
                  <button onClick={() => setInput('Produk apa saja yang stoknya menipis?')}>Stok menipis?</button>
                  <button onClick={() => setInput('Bagaimana cara melihat prediksi harga bahan?')}>Prediksi harga bahan?</button>
                </div>
              </div>
            )}
            {messages.length === 0 && mode === 'catat' && (
              <div className="chat-hint">
                <p>Ketik atau ucapkan transaksi Anda, nanti saya buatkan kartunya untuk Anda periksa dulu. Contoh:</p>
                <div className="chat-chips">
                  <button onClick={() => setInput('Laku 3 kue coklat total 45 ribu')}>Laku 3 kue coklat 45rb</button>
                  <button onClick={() => setInput('Beli gas 22 ribu sama plastik 10 ribu')}>Beli gas 22rb + plastik 10rb</button>
                  <button onClick={() => setInput('Kemarin bayar listrik 150 ribu')}>Kemarin bayar listrik 150rb</button>
                  <button onClick={() => setInput('Orderan kue ultah 350 ribu belum dibayar')}>Order 350rb belum lunas</button>
                </div>
                <p className="muted-sm" style={{ marginTop: 8 }}>Transaksi TIDAK langsung tersimpan — Anda selalu meninjau dulu.</p>
              </div>
            )}

            {messages.map((m, i) => {
              if (m.type === 'draft') {
                return (
                  <div key={i} className="chat-msg assistant draft-wrap">
                    <div style={{ marginBottom: 6 }}>
                      {m.saved ? '✅ Tersimpan. Rincian:' : `Saya menangkap ${m.drafts.length} transaksi. Periksa & perbaiki dulu ya:`}
                    </div>
                    {m.drafts.map((d, j) => (
                      m.saved ? (
                        <div key={j} className="draft-card saved">
                          <b>{d.direction === 'in' ? '+' : '-'}{rupiah(d.amount)}</b> · {d.category} · {d.description}
                        </div>
                      ) : (
                        <div key={j} className="draft-card">
                          <div className="draft-row">
                            <select className="input" value={d.direction}
                              onChange={(e) => patchDraft(i, j, { direction: e.target.value, category: (catNames(e.target.value)[0] || '') })}>
                              <option value="in">Pemasukan</option>
                              <option value="out">Pengeluaran</option>
                            </select>
                            <input className="input" type="number" min="0" value={d.amount}
                              onChange={(e) => patchDraft(i, j, { amount: e.target.value })} placeholder="Nominal (Rp)" />
                            <button type="button" className="icon-btn danger" title="Hapus" onClick={() => removeDraft(i, j)}><Trash2 size={14} /></button>
                          </div>
                          <div className="draft-row">
                            <select className="input" value={d.category} onChange={(e) => patchDraft(i, j, { category: e.target.value })}>
                              {catNames(d.direction).map((c) => <option key={c} value={c}>{c}</option>)}
                              {!catNames(d.direction).includes(d.category) && <option value={d.category}>{d.category}</option>}
                            </select>
                            <input className="input" type="date" value={d.occurred_at}
                              onChange={(e) => patchDraft(i, j, { occurred_at: e.target.value })} />
                          </div>
                          <div className="draft-row">
                            <input className="input" value={d.description}
                              onChange={(e) => patchDraft(i, j, { description: e.target.value })} placeholder="Keterangan" />
                            {d.direction === 'in' && (
                              <select className="input" value={d.payment_status || 'lunas'}
                                onChange={(e) => patchDraft(i, j, { payment_status: e.target.value })}>
                                <option value="lunas">Lunas</option>
                                <option value="belum">Belum</option>
                              </select>
                            )}
                          </div>
                          {d.flag_large && <div className="draft-warn">Nominal sangat besar — pastikan benar.</div>}
                        </div>
                      )
                    ))}
                    {!m.saved && (
                      <>
                        {m.note && <div className="muted-sm" style={{ margin: '6px 0' }}>{m.note}</div>}
                        <AIDisclaimer text="Hasil baca AI bisa keliru — periksa nominal & kategori sebelum simpan." />
                        <button className="btn btn-primary btn-block" style={{ marginTop: 8 }}
                          disabled={saving || !m.drafts.length} onClick={() => saveDrafts(i)}>
                          {saving ? 'Menyimpan...' : `Simpan ${m.drafts.length} Transaksi`}
                        </button>
                      </>
                    )}
                  </div>
                )
              }
              return <div key={i} className={`chat-msg ${m.role}`}>{m.text}</div>
            })}
            {busy && <div className="chat-msg assistant chat-typing">{mode === 'tanya' ? 'Sedang mengetik...' : 'Membaca kalimat Anda...'}</div>}
          </div>

          {err && <div className="chat-err">{err}</div>}

          <div className="chat-input">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder={mode === 'tanya'
                ? 'Tulis pertanyaan, atau tekan mikrofon untuk bicara...'
                : 'cth: laku 3 kue coklat total 45 ribu...'}
            />
            {SpeechRec && (
              <button className="icon-btn" onClick={toggleVoice} title="Input suara" aria-label="Input suara">
                {listening ? <MicOff size={18} style={{ color: 'var(--red)' }} /> : <Mic size={18} />}
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
