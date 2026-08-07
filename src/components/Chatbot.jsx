import { useEffect, useRef, useState } from 'react'
import { MessageCircle, X, Send, Trash2, HelpCircle, PencilLine, AudioLines } from 'lucide-react'
import { askAI, catatAI, crudAI } from '../lib/ai'
import { addTransactionsBulk, fetchCategories, fetchTodayTotals } from '../lib/api'
import { saveDraftAction } from '../lib/aiActions'
import { rupiah } from '../lib/format'
import AIDisclaimer from './AIDisclaimer'
import VoiceAssistant from './VoiceAssistant'
import { liveVoiceSupported } from '../lib/liveAudio'
import { useLang } from '../context/LangContext'
import { BATAS_DATE, bersihkanTanggal } from '../lib/dateInput'

const CONSENT_KEY = 'bukupintar_ai_consent'

// ============================================================
// SAKELAR MODE CATAT UNIVERSAL (ai-crud).
//
// `false` = mode Catat memakai `ai-catat` lama: hanya transaksi kas.
// `true`  = mode Catat memakai `ai-crud`: 11 entitas (transaksi, pelanggan,
// produk, pemasok, karyawan, absensi, KPI, PO, tugas, pengingat) dengan
// slot-filling, dan satu kalimat boleh menghasilkan beberapa catatan.
//
// DINYALAKAN 3 Agustus 2026 setelah P3 selesai. Sebelumnya sengaja dimatikan
// karena `ai-crud` hanya sanggup satu aksi per kalimat, sehingga menyalakannya
// akan menukar kemampuan "beberapa transaksi sekaligus" (dipakai sehari-hari)
// dengan jangkauan entitas. P3 memulihkan kemampuan itu, jadi penukarannya
// tidak ada lagi.
//
// Kalau perlu dikembalikan ke jalur lama, ubah ke `false`: `ai-catat` masih
// ter-deploy dan cabang kodenya sengaja dibiarkan utuh di komponen ini.
const UNIVERSAL_CATAT_ENABLED = true
// ============================================================

// Gabungkan tanggal (YYYY-MM-DD dari AI) dengan waktu jam:menit:detik SAAT INI.
// Dibangun dari komponen tanggal lokal agar tanggal tidak bergeser ke UTC, dan
// menghindari bug lama yang memaksa semua transaksi AI ke jam 12:00.
function occurredAtIso(dateStr) {
  const now = new Date()
  const ds = /^\d{4}-\d{2}-\d{2}$/.test(dateStr || '') ? dateStr : now.toISOString().slice(0, 10)
  const [y, m, d] = ds.split('-').map(Number)
  return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString()
}
// ============================================================
// SAKELAR TAB SUARA — sengaja dimatikan untuk rilis ini.
//
// Fitur suara 2 arah (Gemini Live) SUDAH LENGKAP dan tetap ada di repo:
//   klien   : src/lib/liveAudio.js, liveClient.js, useLiveVoice.js,
//             voiceCommand.js, voiceInstruction.js, voiceExecutor.js,
//             src/components/VoiceAssistant.jsx
//   backend : supabase/functions/voice-live-token (ter-deploy),
//             RPC kuota + kunci sesi di database
//   test    : liveAudio / liveClient / voiceCommand / liveToken
//
// Yang dimatikan HANYA pintu masuknya di UI. Untuk rilis ini pencatatan
// berjalan lewat prompt saja; suara menyusul di pengembangan berikutnya.
//
// Menyalakan kembali: ubah baris di bawah menjadi `true`. Tidak ada langkah
// lain — seluruh cabang render tab Suara sengaja DIBIARKAN UTUH di komponen
// ini. Menghapusnya akan menghemat beberapa baris hari ini dan menuntut
// menyusun ulang alur mode + subjudul + gerbang kemampuan nanti, yang jauh
// lebih mudah salah daripada satu boolean.
const VOICE_TAB_ENABLED = false
// ============================================================

// Catatan: input suara juga sudah dicabut dari mode Tanya/Catat. Dua pintu
// masuk suara yang berbeda perilaku (dikte sekali jalan vs percakapan penuh)
// hanya membingungkan — pengguna menekan mikrofon di mode Catat lalu heran
// kenapa asisten tidak menjawab balik.

export default function Chatbot() {
  const { t, lang } = useLang()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('tanya') // 'tanya' (Q&A) | 'catat' (input transaksi)
  const [consent, setConsent] = useState(false)
  // Pesan: {role:'user'|'assistant', text} ATAU {role:'assistant', type:'draft', drafts, note, saved}
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [cats, setCats] = useState([]) // kategori user (untuk select di kartu draf)
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

  // Kartu aksi PERTAMA yang masih menunggu jawaban. Selama ada yang menunggu,
  // ketikan pengguna dibaca sebagai JAWABAN atas pertanyaan itu — bukan sebagai
  // perintah baru. Tanpa aturan ini, menjawab "tunai" akan ditafsirkan sebagai
  // perintah pencatatan baru yang tidak berarti apa-apa.
  //
  // Dipindai dari DEPAN, bukan dari belakang: satu kalimat kini bisa melahirkan
  // beberapa kartu sekaligus, dan orang menjawabnya berurutan dari atas.
  const pendingActionIndex = () => {
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      if (m.type === 'action' && m.needsClarification && !m.saved) return i
    }
    return -1
  }

  const actionMessage = (res) => ({
    role: 'assistant',
    type: 'action',
    draft: res.draft,
    question: res.question || null,
    summary: res.summary || [],
    needsClarification: !!res.needsClarification,
    requiresConfirmation: !!res.requiresConfirmation,
    saved: false,
    savedText: '',
  })

  const mergeActionResponse = (idx, res) => {
    setMessages((all) => all.map((m, i) => (i === idx ? {
      ...m,
      draft: res.draft,
      question: res.question || null,
      summary: res.summary || m.summary,
      needsClarification: !!res.needsClarification,
      requiresConfirmation: !!res.requiresConfirmation,
    } : m)))
  }

  // Kirim jawaban satu field ke server. Tidak memakai kuota AI: putaran
  // slot-filling dijalankan deterministik di Edge Function.
  const answerField = async (idx, answer) => {
    const m = messages[idx]
    if (!m?.question) return
    setBusy(true); setErr('')
    try {
      const res = await crudAI({ draft: m.draft, field: m.question.field, answer })
      mergeActionResponse(idx, res)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const chooseOption = async (idx, value, shownText) => {
    setMessages((all) => [...all, { role: 'user', text: shownText || String(value) }])
    await answerField(idx, value)
  }

  // Suntingan pada kartu ringkasan bersifat lokal — tidak memanggil server.
  const patchAction = (idx, field, value) => {
    setMessages((all) => all.map((m, i) => {
      if (i !== idx || m.type !== 'action') return m
      return {
        ...m,
        draft: { ...m.draft, values: { ...m.draft.values, [field]: value } },
        summary: m.summary.map((s) => (s.field === field ? { ...s, value } : s)),
      }
    }))
  }

  const saveAction = async (idx) => {
    const m = messages[idx]
    if (!m || m.saved || saving) return
    setSaving(true); setErr('')
    try {
      const text = await saveDraftAction(m.draft)
      setMessages((all) => all.map((x, i) => (i === idx ? { ...x, saved: true, savedText: text } : x)))
      // Rekap angka DIHITUNG DARI DATABASE, bukan dari AI — pola bebas
      // halusinasi yang sama dengan alur draf transaksi lama.
      //
      // Ditahan selama masih ada kartu lain yang belum disimpan: menampilkan
      // "laba hari ini" tiga kali berturut-turut dengan angka yang berubah-ubah
      // di tengah pemeriksaan hanya membuat bingung. Rekapnya menyusul setelah
      // kartu terakhir tersimpan.
      const masihAda = messages.some((x, j) => j !== idx && x.type === 'action' && !x.saved)
      if (m.draft?.entity === 'transaksi' && !masihAda) {
        try {
          const tot = await fetchTodayTotals()
          setMessages((all) => [...all, {
            role: 'assistant',
            text: `Ringkasan hari ini: pemasukan ${rupiah(tot.income)}, pengeluaran ${rupiah(tot.expense)}, laba ${rupiah(tot.profit)}.`,
          }])
        } catch { /* rekap opsional */ }
      }
    } catch (e) {
      setErr('Gagal menyimpan: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setErr('')
    const pendingIdx = mode === 'catat' && UNIVERSAL_CATAT_ENABLED ? pendingActionIndex() : -1
    const next = [...messages, { role: 'user', text }]
    setMessages(next)
    setInput('')
    if (pendingIdx >= 0) { await answerField(pendingIdx, text); return }
    setBusy(true)
    try {
      if (mode === 'tanya') {
        // Riwayat hanya dari pesan teks biasa (kartu draf tidak ikut).
        const history = messages.filter((m) => !m.type && typeof m.text === 'string').slice(-6)
        const reply = await askAI(text, history, lang)
        setMessages((m) => [...m, { role: 'assistant', text: reply }])
      } else if (UNIVERSAL_CATAT_ENABLED) {
        const res = await crudAI({ message: text })
        // Satu kalimat bisa menghasilkan beberapa catatan. Tiap aksi jadi kartu
        // sendiri supaya bisa diperiksa, disunting, dan disimpan satu per satu.
        const daftar = Array.isArray(res?.actions) && res.actions.length ? res.actions : [res]
        setMessages((m) => [
          ...m,
          ...(daftar.length > 1
            ? [{ role: 'assistant', text: `Saya menangkap ${daftar.length} catatan dari kalimat itu. Periksa satu per satu ya:` }]
            : []),
          ...daftar.map(actionMessage),
          ...(res?.truncated
            ? [{ role: 'assistant', text: `Saya hanya memproses ${daftar.length} catatan pertama. Sisanya kirim di pesan terpisah ya.` }]
            : []),
        ])
      } else {
        const res = await catatAI(text, lang)
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

  // Mode suara hanya sah bila sakelarnya menyala. Dipakai sebagai SATU sumber
  // kebenaran di seluruh render: kalau tiap tempat memeriksa `mode === 'suara'`
  // sendiri-sendiri, satu yang terlewat saat sakelar mati akan menyembunyikan
  // badan chat tanpa menampilkan apa pun sebagai gantinya — panel kosong.
  const voiceMode = VOICE_TAB_ENABLED && mode === 'suara'

  return (
    <div className="chat-panel" role="dialog" aria-label="Asisten AI">
      <div className="chat-head">
        <div>
          <b>Asisten SmartBook</b>
          <div className="chat-sub">
            {voiceMode ? t.voice.subtitle
              : mode === 'tanya' ? 'Panduan & tanya jawab usaha Anda'
                : 'Catat transaksi lewat ketikan'}
          </div>
        </div>
        <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Tutup"><X size={18} /></button>
      </div>

      {!consent ? (
        <div className="chat-consent">
          {/* Kalimat persetujuan ikut sakelar tab suara. Menjanjikan input
              suara saat pintunya ditutup membuat teks izin ini tidak akurat —
              dan teks izin adalah hal terakhir yang boleh meleset. */}
          <p>
            Asisten AI membantu Anda memakai aplikasi, menjawab pertanyaan angka usaha,
            dan mencatat transaksi dari {VOICE_TAB_ENABLED ? 'ketikan atau suara' : 'ketikan'}.
          </p>
          <ul>
            <li>
              Yang dikirim ke layanan AI hanya <b>ringkasan angka</b> dan{' '}
              <b>kalimat yang Anda {VOICE_TAB_ENABLED ? 'ketik/ucapkan' : 'ketik'}</b> — bukan
              data pelanggan atau nomor rekening.
            </li>
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
            {VOICE_TAB_ENABLED && liveVoiceSupported() && (
              <button type="button" className={mode === 'suara' ? 'on-in' : ''} onClick={() => { setMode('suara'); setErr('') }}>
                <AudioLines size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />{t.voice.tab}
              </button>
            )}
          </div>

          {/* Mode Suara memakai alur sendiri (sesi persisten + konfirmasi lisan),
              jadi dirender terpisah dari daftar pesan mode Tanya/Catat. */}
          {voiceMode && <VoiceAssistant />}

          {!voiceMode && (
          <>
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
                <p>Ketik transaksi Anda, nanti saya buatkan kartunya untuk Anda periksa dulu. Contoh:</p>
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
              if (m.type === 'action') {
                const op = m.draft?.operation
                const judul = op === 'delete' ? 'Menghapus' : op === 'update' ? 'Mengubah' : 'Menambah'
                // Yang ditampilkan: field yang sudah terisi + field wajib.
                // Sisanya disembunyikan agar kartu tidak jadi formulir panjang.
                const terlihat = (m.summary || []).filter(
                  (s) => s.required || (s.value !== null && s.value !== undefined && s.value !== ''),
                )
                return (
                  <div key={i} className="chat-msg assistant draft-wrap">
                    <div style={{ marginBottom: 6 }}>
                      {m.saved ? `✅ ${m.savedText}` : `${judul} ${m.draft?.entityLabel || 'data'}`}
                    </div>

                    {!m.saved && m.needsClarification && m.question && (
                      <div className="draft-card">
                        <div>{m.question.question}</div>
                        {!!m.question.options?.length && (
                          <div className="chat-chips">
                            {m.question.options.slice(0, 12).map((o) => (
                              <button key={o} type="button" disabled={busy} onClick={() => chooseOption(i, o)}>{o}</button>
                            ))}
                          </div>
                        )}
                        {!m.question.required && (
                          <button type="button" className="linklike" disabled={busy}
                            onClick={() => chooseOption(i, 'lewati', 'Lewati')}>Lewati pertanyaan ini</button>
                        )}
                      </div>
                    )}

                    {!m.saved && !m.needsClarification && (
                      <>
                        <div className="draft-card">
                          {terlihat.map((s) => (
                            <div key={s.field} className="draft-field">
                              <label htmlFor={`act-${i}-${s.field}`}>{s.label}</label>
                              {s.options?.length ? (
                                <select id={`act-${i}-${s.field}`} className="input" value={s.value ?? ''}
                                  onChange={(e) => patchAction(i, s.field, e.target.value)}>
                                  <option value="">(kosong)</option>
                                  {s.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                              ) : (
                                <input id={`act-${i}-${s.field}`} className="input"
                                  type={s.type === 'money' || s.type === 'number' ? 'number' : s.type === 'date' ? 'date' : 'text'}
                                  value={s.value ?? ''}
                                  onChange={(e) => patchAction(i, s.field, e.target.value)} />
                              )}
                            </div>
                          ))}
                        </div>
                        <AIDisclaimer text="Hasil baca AI bisa keliru — periksa isinya sebelum simpan." />
                        <button className="btn btn-primary btn-block" style={{ marginTop: 8 }}
                          disabled={saving} onClick={() => saveAction(i)}>
                          {saving ? 'Menyimpan...' : 'Simpan'}
                        </button>
                      </>
                    )}
                  </div>
                )
              }
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
                            <input className="input" type="date" {...BATAS_DATE} value={d.occurred_at}
                              onChange={(e) => patchDraft(i, j, { occurred_at: bersihkanTanggal(e.target.value) })} />
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
                ? 'Tulis pertanyaan Anda...'
                : 'cth: laku 3 kue coklat total 45 ribu...'}
            />
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
        </>
      )}
    </div>
  )
}
