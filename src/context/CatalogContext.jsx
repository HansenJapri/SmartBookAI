import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { fetchCategories, fetchChannels, ensureSeedData } from '../lib/api'

const CatalogCtx = createContext(null)

// Channel bawaan (fallback warna/label bila data belum dimuat)
const BUILTIN_CH = {
  manual: { label: 'Manual', color: '#64748b' },
  qris: { label: 'QRIS', color: '#1c36ee' },
  bank: { label: 'Bank', color: '#0ea5e9' },
  wa: { label: 'WhatsApp', color: '#16a34a' },
  marketplace: { label: 'Marketplace', color: '#f97316' },
  email: { label: 'Email', color: '#a855f7' },
  struk: { label: 'Struk', color: '#eab308' },
}
const PALETTE = ['#1c36ee', '#07bbd2', '#16a34a', '#f97316', '#a855f7', '#eab308', '#ec4899', '#00fed9', '#ef4444']
function colorFor(value) {
  let h = 0
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) % PALETTE.length
  return PALETTE[h]
}

// ============================================================
// KATALOG KATEGORI & CHANNEL.
//
// Berkas ini pernah menjadi penyebab keluhan "tiba-tiba tidak bisa input".
// Rantainya: katalog dimuat SEKALI saat AppLayout dipasang; kalau sinyal
// kebetulan sedang buruk, kegagalannya ditelan diam-diam dan `categories`
// tinggal array kosong. Dropdown Kategori di form transaksi lalu hanya berisi
// "(belum ada kategori)", dan tombol Simpan menolak dengan "Pilih kategori
// dulu" — untuk kategori yang tidak ada satu pun bisa dipilih. Pengguna
// terjebak sampai ia me-refresh halaman, dan tidak ada apa pun di layar yang
// menyuruhnya melakukan itu.
//
// Dua perubahan menutupnya: kegagalan sekarang DICATAT (`gagal`) sehingga UI
// bisa menawarkan jalan keluar, dan katalog dicoba lagi sendiri begitu koneksi
// kembali atau tab diaktifkan lagi — jalur pemulihan yang tidak menuntut
// pengguna memahami apa yang rusak.
// ============================================================

export function CatalogProvider({ children }) {
  const [categories, setCategories] = useState([])
  const [channels, setChannels] = useState([])
  const [ready, setReady] = useState(false)
  const [gagal, setGagal] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [cats, chs] = await Promise.all([fetchCategories(), fetchChannels()])
      setCategories(cats)
      setChannels(chs)
      setGagal(false)
      return true
    } catch (e) {
      setGagal(true)
      throw e
    }
  }, [])

  useEffect(() => {
    (async () => {
      try { await ensureSeedData() } catch { /* abaikan jika tabel belum dimigrasi */ }
      try { await reload() } catch { /* status kegagalan sudah dicatat di `gagal` */ }
      setReady(true)
    })()
  }, [reload])

  // Pemulihan otomatis. Hanya dipasang saat memang sedang gagal, jadi pemakaian
  // normal tidak menambah satu pun permintaan jaringan.
  useEffect(() => {
    if (!gagal) return
    const lagi = () => { reload().catch(() => {}) }
    const saatTampak = () => { if (document.visibilityState === 'visible') lagi() }
    window.addEventListener('online', lagi)
    document.addEventListener('visibilitychange', saatTampak)
    return () => {
      window.removeEventListener('online', lagi)
      document.removeEventListener('visibilitychange', saatTampak)
    }
  }, [gagal, reload])

  const catNames = (direction) =>
    categories.filter((c) => c.direction === direction).map((c) => c.name)

  const channelLabel = (value) => {
    const found = channels.find((c) => c.value === value)
    if (found) return found.label
    return BUILTIN_CH[value]?.label || value
  }
  const channelColor = (value) => BUILTIN_CH[value]?.color || colorFor(value || 'x')

  return (
    <CatalogCtx.Provider value={{ categories, channels, ready, gagal, reload, catNames, channelLabel, channelColor }}>
      {children}
    </CatalogCtx.Provider>
  )
}

// Fallback tanpa provider — pola yang sama dengan useWorkspace().
//
// Sebelumnya hook ini mengembalikan null begitu saja, sehingga komponen mana
// pun yang ter-render di luar <CatalogProvider> (rute yang salah pasang, modal
// yang dipindah, komponen yang diuji terpisah) langsung melempar
// "Cannot destructure property" — crash render yang mematikan SELURUH aplikasi
// lewat ErrorBoundary akar. Nilai kosong yang aman jauh lebih baik daripada
// layar error untuk sesuatu yang hanya salah pasang.
export const useCatalog = () => useContext(CatalogCtx) || {
  categories: [], channels: [], ready: false, gagal: false,
  reload: async () => {},
  catNames: () => [],
  channelLabel: (v) => v,
  channelColor: () => '#64748b',
}
