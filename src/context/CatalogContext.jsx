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

export function CatalogProvider({ children }) {
  const [categories, setCategories] = useState([])
  const [channels, setChannels] = useState([])
  const [ready, setReady] = useState(false)

  const reload = useCallback(async () => {
    const [cats, chs] = await Promise.all([fetchCategories(), fetchChannels()])
    setCategories(cats)
    setChannels(chs)
  }, [])

  useEffect(() => {
    (async () => {
      try { await ensureSeedData() } catch { /* abaikan jika tabel belum dimigrasi */ }
      try { await reload() } catch { /* tabel belum ada */ }
      setReady(true)
    })()
  }, [reload])

  const catNames = (direction) =>
    categories.filter((c) => c.direction === direction).map((c) => c.name)

  const channelLabel = (value) => {
    const found = channels.find((c) => c.value === value)
    if (found) return found.label
    return BUILTIN_CH[value]?.label || value
  }
  const channelColor = (value) => BUILTIN_CH[value]?.color || colorFor(value || 'x')

  return (
    <CatalogCtx.Provider value={{ categories, channels, ready, reload, catNames, channelLabel, channelColor }}>
      {children}
    </CatalogCtx.Provider>
  )
}

export const useCatalog = () => useContext(CatalogCtx)
