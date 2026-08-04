import {
  addProduct, addReminder, addTransactionsBulk, deleteProduct, fetchProducts, updateProduct,
} from './api'

// ============================================================
// Pelaksana perintah suara.
//
// Satu-satunya berkas di jalur suara yang benar-benar MENULIS ke database.
// Ia sengaja dibuat kecil dan tanpa cabang pintar: makin sedikit yang terjadi
// di sini, makin mudah dipastikan tidak ada yang tersimpan tanpa persetujuan.
//
// Pemanggilnya (useLiveVoice) hanya boleh masuk ke sini SETELAH pengguna
// menyetujui secara lisan. Tidak ada jalur lain — model Gemini tidak pernah
// memanggil fungsi-fungsi ini secara langsung.
// ============================================================

/** Field wajib per perintah. Kurang satu saja, perintah ditolak sebelum menyentuh jaringan. */
const REQUIRED = {
  create_transaksi: ['direction', 'amount'],
  create_produk: ['name'],
  update_produk: ['name'],
  delete_produk: ['name'],
  create_pengingat: ['title'],
}

export class VoiceCommandError extends Error {
  constructor(message, code = 'INVALID') {
    super(message)
    this.name = 'VoiceCommandError'
    this.code = code
  }
}

const MISSING = {
  id: (labels) => `Data belum lengkap: ${labels.join(', ')} belum disebutkan.`,
  en: (labels) => `Incomplete data: ${labels.join(', ')} not mentioned yet.`,
}

const NOT_FOUND = {
  id: (name) => `Produk "${name}" tidak ditemukan di katalog Anda.`,
  en: (name) => `Product "${name}" was not found in your catalogue.`,
}

const AMBIGUOUS = {
  id: (name, list) => `Ada beberapa produk yang cocok dengan "${name}": ${list.join(', ')}. Sebutkan yang mana.`,
  en: (name, list) => `Several products match "${name}": ${list.join(', ')}. Please say which one.`,
}

const UNSUPPORTED = {
  id: (name) => `Perintah "${name}" belum didukung lewat suara.`,
  en: (name) => `The command "${name}" is not supported by voice yet.`,
}

const L = (lang) => (lang === 'en' ? 'en' : 'id')

function requireFields(name, args, lang) {
  const missing = (REQUIRED[name] || []).filter((f) => {
    const v = args[f]
    return v === undefined || v === null || v === '' || (typeof v === 'number' && !Number.isFinite(v))
  })
  if (missing.length) throw new VoiceCommandError(MISSING[L(lang)](missing), 'MISSING_FIELDS')
}

/**
 * Cocokkan nama produk yang DIUCAPKAN dengan katalog nyata.
 *
 * Pencocokan longgar (tanpa huruf besar, tanpa spasi ganda) karena pengenal
 * suara menulis "Tepung Terigu" dan katalog menyimpan "tepung terigu".
 * Tapi bila lebih dari satu produk cocok, perintah DIHENTIKAN dan pengguna
 * ditanya — menebak produk mana yang dimaksud pada operasi hapus adalah cara
 * tercepat menghapus barang yang salah.
 */
export async function resolveProduct(name, lang = 'id') {
  const products = await fetchProducts()
  const needle = String(name || '').toLowerCase().replace(/\s+/g, ' ').trim()

  const exact = products.filter((p) => String(p.name || '').toLowerCase().trim() === needle)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) throw new VoiceCommandError(AMBIGUOUS[L(lang)](name, exact.map((p) => p.name)), 'AMBIGUOUS')

  const partial = products.filter((p) => String(p.name || '').toLowerCase().includes(needle))
  if (partial.length === 1) return partial[0]
  if (partial.length > 1) {
    throw new VoiceCommandError(AMBIGUOUS[L(lang)](name, partial.slice(0, 5).map((p) => p.name)), 'AMBIGUOUS')
  }
  throw new VoiceCommandError(NOT_FOUND[L(lang)](name), 'NOT_FOUND')
}

/** Susun satu baris transaksi dari argumen suara. */
export function buildTransactionRow(args) {
  const now = new Date()
  return {
    description: String(args.description || '').slice(0, 200)
      || (args.direction === 'in' ? 'Penjualan' : 'Pengeluaran'),
    amount: Math.round(Number(args.amount)),
    direction: args.direction === 'in' ? 'in' : 'out',
    category: args.category || null,
    // Ditandai 'asisten' supaya baris yang lahir dari suara bisa ditelusuri
    // kembali di menu Transaksi — pengguna berhak tahu asal sebuah catatan.
    channel: 'asisten',
    occurred_at: now.toISOString(),
    payment_status: 'lunas',
  }
}

/**
 * Jalankan satu perintah yang SUDAH disetujui pengguna.
 * Mengembalikan ringkasan hasil untuk dibacakan kembali.
 */
export async function executeCommand(pending, lang = 'id') {
  const name = pending?.name
  const args = pending?.args || {}
  requireFields(name, args, lang)

  switch (name) {
    case 'create_transaksi': {
      if (!(Number(args.amount) > 0)) {
        throw new VoiceCommandError(MISSING[L(lang)](['nominal']), 'MISSING_FIELDS')
      }
      await addTransactionsBulk([buildTransactionRow(args)])
      return { ok: true, entity: 'transaksi', operation: 'create' }
    }

    case 'create_produk': {
      await addProduct({
        name: String(args.name).slice(0, 120),
        category: args.category || '',
        unit: args.unit || 'pcs',
        stock: Number(args.stock) || 0,
        price: Number(args.price) || 0,
        cost_price: Number(args.cost_price) || 0,
      })
      return { ok: true, entity: 'produk', operation: 'create' }
    }

    case 'update_produk': {
      const product = await resolveProduct(args.name, lang)
      const patch = {}
      if (args.stock !== undefined && args.stock !== null) patch.stock = Number(args.stock)
      if (args.price !== undefined && args.price !== null) patch.price = Number(args.price)
      if (args.cost_price !== undefined && args.cost_price !== null) patch.cost_price = Number(args.cost_price)
      if (!Object.keys(patch).length) {
        throw new VoiceCommandError(MISSING[L(lang)](['nilai baru']), 'MISSING_FIELDS')
      }
      await updateProduct(product.id, patch)
      return { ok: true, entity: 'produk', operation: 'update', target: product.name }
    }

    case 'delete_produk': {
      const product = await resolveProduct(args.name, lang)
      await deleteProduct(product.id)
      return { ok: true, entity: 'produk', operation: 'delete', target: product.name }
    }

    case 'create_pengingat': {
      await addReminder({
        title: String(args.title).slice(0, 200),
        note: args.note ? String(args.note).slice(0, 500) : '',
        // Tanpa waktu yang jelas, pengingat dijadwalkan satu jam dari sekarang
        // dan waktunya ikut dibacakan saat konfirmasi — pengguna masih sempat
        // membetulkan sebelum menyetujui.
        remind_at: args.remind_at || new Date(Date.now() + 3600_000).toISOString(),
      })
      return { ok: true, entity: 'pengingat', operation: 'create' }
    }

    default:
      throw new VoiceCommandError(UNSUPPORTED[L(lang)](name), 'UNSUPPORTED')
  }
}
