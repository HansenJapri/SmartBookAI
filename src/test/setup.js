// Setup global Vitest untuk component test (jsdom).
// Menambahkan matcher @testing-library/jest-dom (toBeInTheDocument, toHaveFocus,
// dsb.) dan membersihkan DOM antar-test agar tidak ada kebocoran state.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------
// Penjaga isolasi jaringan (metrik §1.4: "Panggilan Gemini nyata dari
// npm test = 0"). Diaktifkan dengan BLOCK_NET=1.
//
// Mencabut kabel LAN membuktikan hal yang sama, tapi hanya bisa dilakukan
// manusia dan tidak bisa dijalankan CI. Ini versi yang bisa diotomasi:
// setiap upaya keluar jaringan langsung melempar dengan nama test yang
// melakukannya, bukan diam-diam timeout.
//   BLOCK_NET=1 npx vitest run
// ---------------------------------------------------------------
if (process.env.BLOCK_NET === '1') {
  const tolak = (asal) => (...args) => {
    const tujuan = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? args[0]?.href ?? '(tidak diketahui)')
    throw new Error(`[ISOLASI] Test mencoba keluar jaringan lewat ${asal} → ${tujuan}`)
  }
  globalThis.fetch = tolak('fetch')
  if (globalThis.XMLHttpRequest) {
    globalThis.XMLHttpRequest.prototype.open = tolak('XMLHttpRequest')
  }
  if (globalThis.WebSocket) {
    globalThis.WebSocket = function () { throw new Error('[ISOLASI] Test mencoba membuka WebSocket') }
  }
  const { default: http } = await import('node:http')
  const { default: https } = await import('node:https')
  const net = await import('node:net')
  http.request = tolak('http.request')
  https.request = tolak('https.request')
  net.default.connect = tolak('net.connect')
}

// jsdom tidak mengimplementasikan matchMedia; beberapa komponen (tema) memakainya.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}
