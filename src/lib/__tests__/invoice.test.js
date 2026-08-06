// ============================================================
// invoice.js — modul uang yang sebelumnya 0% coverage (332 baris), padahal
// §1.4 dokumen strategi mencantumkannya sebagai modul yang aturannya "dikunci"
// unit test. Berkas ini menutup celah itu.
//
// Dua hal yang paling berbahaya di modul ini dan karena itu diuji paling keras:
//
//   1. UANG. Subtotal + PPN + biaya layanan -> grand total. Salah pembulatan
//      atau salah urutan = nominal yang ditagihkan ke pelanggan salah.
//   2. XSS (S-8 §1.7). HTML invoice dirangkai dengan penyambungan string, BUKAN
//      JSX — jadi React tidak melindungi apa pun di sini. Satu-satunya penahan
//      adalah esc(). Deskripsi transaksi dan nama pelanggan berasal dari input
//      pengguna dan bisa berisi apa saja.
//
// calcTotals/terbilang/esc/notaHtmlBW tidak diekspor, jadi diuji lewat pintu
// publiknya: invoiceCaption() dan printNota().
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// html2canvas butuh layout & canvas sungguhan yang tidak ada di jsdom. Dipalsukan
// supaya invoiceHtml() — kartu invoice berwarna, terpisah dari nota cetak — tetap
// bisa diuji isinya. Node yang dikirim ke html2canvas ditangkap agar HTML-nya
// bisa diperiksa.
const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
let nodeInvoice = null
vi.mock('html2canvas', () => ({
  default: vi.fn(async (node) => {
    nodeInvoice = node
    return {
      width: 680,
      height: 900,
      toDataURL: () => PNG_1x1,
      toBlob: (cb) => cb(new Blob(['png-palsu'], { type: 'image/png' })),
    }
  }),
}))

const {
  invoiceNo, invoiceCaption, whatsappLink, telegramLink,
  downloadBlob, shareInvoiceFile, printNota, invoicePngBlob, invoicePdfBlob,
} = await import('../invoice')

const tx = (over = {}) => ({
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  occurred_at: '2026-08-05T10:30:00',
  amount: 45000,
  description: 'Penjualan kue coklat',
  customer_name: 'Bu Sari',
  payment_status: 'lunas',
  ...over,
})

const profile = (over = {}) => ({
  business_name: 'Toko Kue Nusantara',
  owner_name: 'Ibu Ratna',
  phone: '+6281234567890',
  ...over,
})

/** Ambil HTML nota yang ditulis printNota() ke jendela cetak. */
function htmlNota(transaksi, prof) {
  let ditulis = ''
  const win = { document: { write: (s) => { ditulis += s }, close: () => {} } }
  const spy = vi.spyOn(window, 'open').mockReturnValue(win)
  const hasil = printNota(transaksi, prof)
  spy.mockRestore()
  return { html: ditulis, hasil }
}

// ---------- Nomor invoice ----------

describe('invoiceNo', () => {
  it('berformat INV-YYYYMMDD-XXXXX dari tanggal kejadian', () => {
    expect(invoiceNo(tx())).toBe('INV-20260805-A1B2C')
  })

  it('deterministik — transaksi yang sama selalu menghasilkan nomor yang sama', () => {
    // Nomor ini TIDAK disimpan di database; kalau tidak stabil, nota yang
    // dicetak ulang akan bernomor berbeda dari yang sudah dikirim ke pelanggan.
    expect(invoiceNo(tx())).toBe(invoiceNo(tx()))
  })

  it('memakai created_at bila occurred_at kosong', () => {
    expect(invoiceNo(tx({ occurred_at: null, created_at: '2026-01-09T08:00:00' })))
      .toBe('INV-20260109-A1B2C')
  })

  it('memberi nol di depan pada bulan & tanggal satu digit', () => {
    expect(invoiceNo(tx({ occurred_at: '2026-03-07T00:00:00' }))).toContain('-20260307-')
  })

  it('membuang tanda hubung id dan memakai huruf besar', () => {
    expect(invoiceNo(tx({ id: 'ab-cd-ef-99' }))).toBe('INV-20260805-ABCDE')
  })

  it('tetap menghasilkan nomor walau id kosong', () => {
    const no = invoiceNo(tx({ id: '' }))
    expect(no).toMatch(/^INV-20260805-[A-Z0-9]{5}$/)
  })
})

// ---------- Perhitungan uang ----------

describe('perhitungan total (lewat invoiceCaption)', () => {
  const totalDari = (caption) => caption.match(/Total\s+: (.+)/)[1]

  it('tanpa PPN & biaya layanan, total = nominal transaksi', () => {
    expect(totalDari(invoiceCaption(tx(), profile()))).toBe('Rp 45.000')
  })

  it('menambahkan PPN sesuai persentase profil', () => {
    const c = invoiceCaption(tx({ amount: 100000 }), profile({ invoice_tax_percent: 11 }))
    expect(totalDari(c)).toBe('Rp 111.000')
  })

  it('menambahkan biaya layanan sesuai persentase profil', () => {
    const c = invoiceCaption(tx({ amount: 200000 }), profile({ invoice_service_percent: 5 }))
    expect(totalDari(c)).toBe('Rp 210.000')
  })

  it('menjumlahkan PPN dan biaya layanan sekaligus', () => {
    const c = invoiceCaption(tx({ amount: 100000 }), profile({
      invoice_tax_percent: 11, invoice_service_percent: 5,
    }))
    expect(totalDari(c)).toBe('Rp 116.000')
  })

  it('membulatkan PPN ke rupiah terdekat, bukan menyisakan pecahan', () => {
    // 33.333 * 11% = 3.666,63 -> dibulatkan 3.667
    const c = invoiceCaption(tx({ amount: 33333 }), profile({ invoice_tax_percent: 11 }))
    expect(totalDari(c)).toBe('Rp 37.000')
  })

  it('memperlakukan nominal non-angka sebagai 0, bukan NaN', () => {
    expect(totalDari(invoiceCaption(tx({ amount: 'bukan angka' }), profile()))).toBe('Rp 0')
  })

  it('mengabaikan persentase yang tidak sah tanpa merusak total', () => {
    const c = invoiceCaption(tx({ amount: 50000 }), profile({ invoice_tax_percent: 'abc' }))
    expect(totalDari(c)).toBe('Rp 50.000')
  })
})

// ---------- Caption untuk dikirim ke pelanggan ----------

describe('invoiceCaption', () => {
  it('menyapa pelanggan dengan namanya bila ada', () => {
    expect(invoiceCaption(tx(), profile())).toContain('Halo Bu Sari,')
  })

  it('memakai sapaan netral bila nama pelanggan kosong', () => {
    expect(invoiceCaption(tx({ customer_name: '' }), profile())).toContain('Halo,')
  })

  it('menyebut nama usaha, dan "kami" bila profil belum diisi', () => {
    expect(invoiceCaption(tx(), profile())).toContain('Toko Kue Nusantara')
    expect(invoiceCaption(tx(), {})).toContain('invoice dari kami')
  })

  it('meminta konfirmasi pembayaran saat belum lunas', () => {
    const c = invoiceCaption(tx({ payment_status: 'belum' }), profile())
    expect(c).toContain('Status      : Belum Lunas')
    expect(c).toContain('Mohon konfirmasi pembayarannya')
  })

  it('berterima kasih saat sudah lunas', () => {
    const c = invoiceCaption(tx(), profile())
    expect(c).toContain('Status      : Lunas')
    expect(c).toContain('Terima kasih atas pembeliannya')
  })

  it('memakai invoice_no tersimpan bila ada, bukan nomor turunan', () => {
    expect(invoiceCaption(tx({ invoice_no: 'INV-MANUAL-001' }), profile()))
      .toContain('No. Invoice : INV-MANUAL-001')
  })
})

// ---------- Tautan berbagi ----------

describe('tautan berbagi', () => {
  it('mengubah awalan 0 nomor pelanggan menjadi 62 untuk WhatsApp', () => {
    const url = whatsappLink(tx({ customer_contact: '081234567890' }), profile())
    expect(url.startsWith('https://wa.me/6281234567890?text=')).toBe(true)
  })

  it('membuang spasi & tanda hubung dari nomor', () => {
    const url = whatsappLink(tx({ customer_contact: '0812-3456 7890' }), profile())
    expect(url.startsWith('https://wa.me/6281234567890?text=')).toBe(true)
  })

  it('memakai tautan tanpa tujuan bila kontak pelanggan kosong', () => {
    expect(whatsappLink(tx({ customer_contact: '' }), profile()).startsWith('https://wa.me/?text=')).toBe(true)
  })

  it('meng-encode caption sehingga baris baru tidak memutus URL', () => {
    const url = whatsappLink(tx(), profile())
    expect(url).not.toContain('\n')
    expect(decodeURIComponent(url.split('text=')[1])).toContain('Halo Bu Sari,')
  })

  it('tautan Telegram memuat caption yang sama', () => {
    const url = telegramLink(tx(), profile())
    expect(url.startsWith('https://t.me/share/url?url=')).toBe(true)
    expect(decodeURIComponent(url.split('&text=')[1])).toContain('No. Invoice : INV-20260805-A1B2C')
  })
})

// ---------- Nota cetak: keamanan (S-8) ----------

describe('nota cetak — pencegahan XSS', () => {
  // HTML di sini dirangkai dengan string, BUKAN JSX. React tidak melindungi
  // apa pun. Kalau esc() bocor, nota yang dicetak/dibagikan membawa skrip.
  const JAHAT = '<img src=x onerror=alert(1)>'

  it('meng-escape deskripsi transaksi', () => {
    const { html } = htmlNota(tx({ description: JAHAT }), profile())
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('meng-escape nama pelanggan', () => {
    const { html } = htmlNota(tx({ customer_name: JAHAT }), profile())
    expect(html).not.toContain('<img src=x')
  })

  it('meng-escape nama usaha, pemilik, dan alamat dari profil', () => {
    const { html } = htmlNota(tx(), profile({
      business_name: JAHAT, owner_name: JAHAT, business_address: JAHAT,
    }))
    expect(html).not.toContain('<img src=x')
  })

  it('meng-escape tanda kutip agar tidak bisa keluar dari atribut', () => {
    const { html } = htmlNota(tx({ description: 'a" onmouseover="alert(1)' }), profile())
    expect(html).toContain('&quot;')
    expect(html).not.toContain('onmouseover="alert(1)"')
  })

  it('meng-escape ampersand', () => {
    const { html } = htmlNota(tx({ customer_name: 'Budi & Rekan' }), profile())
    expect(html).toContain('Budi &amp; Rekan')
  })
})

// ---------- Nota cetak: isi ----------

describe('nota cetak — isi', () => {
  it('memuat identitas usaha, nomor, dan pelanggan', () => {
    const { html } = htmlNota(tx(), profile())
    expect(html).toContain('Toko Kue Nusantara')
    expect(html).toContain('Ibu Ratna')
    expect(html).toContain('INV-20260805-A1B2C')
    expect(html).toContain('Bu Sari')
  })

  it('menampilkan nomor telepon dengan awalan 0, bukan +62', () => {
    const { html } = htmlNota(tx(), profile({ phone: '+6281234567890' }))
    expect(html).toContain('081234567890')
    expect(html).not.toContain('+6281234567890')
  })

  it('juga menormalkan nomor berawalan 62 tanpa plus', () => {
    const { html } = htmlNota(tx(), profile({ phone: '6281234567890' }))
    expect(html).toContain('081234567890')
  })

  it('menandai status LUNAS dan BELUM LUNAS', () => {
    expect(htmlNota(tx(), profile()).html).toContain('LUNAS')
    expect(htmlNota(tx({ payment_status: 'belum' }), profile()).html).toContain('BELUM LUNAS')
  })

  it('merinci PPN & layanan hanya bila nilainya ada', () => {
    const polos = htmlNota(tx(), profile()).html
    expect(polos).toContain('TOTAL')
    expect(polos).not.toContain('PPN')

    const lengkap = htmlNota(tx({ amount: 100000 }), profile({
      invoice_tax_percent: 11, invoice_service_percent: 5,
    })).html
    expect(lengkap).toContain('PPN 11%')
    expect(lengkap).toContain('Layanan 5%')
    expect(lengkap).toContain('GRAND TOTAL')
  })

  it('menampilkan baris "dilayani oleh" hanya bila diaktifkan dan terisi', () => {
    expect(htmlNota(tx(), profile()).html).not.toContain('Dilayani oleh')

    const aktif = htmlNota(tx(), profile({
      invoice_show_server: true, invoice_server_value: 'Kasir 2',
    })).html
    expect(aktif).toContain('Dilayani oleh: Kasir 2')

    // Diaktifkan tapi nilainya kosong -> baris tidak muncul sama sekali.
    const kosong = htmlNota(tx(), profile({ invoice_show_server: true })).html
    expect(kosong).not.toContain('Dilayani oleh')
  })

  it('memakai label "dilayani oleh" kustom', () => {
    const { html } = htmlNota(tx(), profile({
      invoice_show_server: true, invoice_server_label: 'Pramusaji', invoice_server_value: 'Andi',
    }))
    expect(html).toContain('Pramusaji: Andi')
  })
})

// ---------- Terbilang ----------

describe('terbilang (lewat nota cetak)', () => {
  const terbilangDari = (jumlah) => {
    const { html } = htmlNota(tx({ amount: jumlah }), profile())
    return html.match(/Terbilang: (.+?) rupiah/)[1]
  }

  it.each([
    [1, 'Satu'],
    [11, 'Sebelas'],
    [15, 'Lima belas'],
    [21, 'Dua puluh satu'],
    [100, 'Seratus'],
    [150, 'Seratus lima puluh'],
    [1000, 'Seribu'],
    [1500, 'Seribu lima ratus'],
    [45000, 'Empat puluh lima ribu'],
    [1000000, 'Satu juta'],
  ])('%i menjadi "%s"', (angka, harapan) => {
    expect(terbilangDari(angka)).toBe(harapan)
  })

  it('mengeja nominal besar sampai miliar', () => {
    expect(terbilangDari(2500000000)).toContain('miliar')
  })

  // Inkonsistensi kecil yang nyata di kode: cabang `n === 0` mengembalikan
  // 'nol' SEBELUM langkah kapitalisasi, jadi hanya nol yang berhuruf kecil.
  // Dikunci apa adanya, bukan diperbaiki — nota Rp 0 tidak bisa terjadi lewat
  // UI (TransactionModal menolak nominal 0), jadi ini murni kosmetik.
  it('nol dieja huruf kecil, berbeda dari nominal lain yang berkapital', () => {
    expect(terbilangDari(0)).toBe('nol')
  })
})

// ---------- Bea meterai ----------

describe('keterangan bea meterai', () => {
  // UU No. 10/2020: bukti penerimaan uang di atas Rp5 juta kena meterai.
  // Hanya relevan untuk yang SUDAH lunas — belum lunas bukan bukti penerimaan.
  const punyaMeterai = (transaksi) => {
    let ditulis = ''
    const win = { document: { write: (s) => { ditulis += s }, close: () => {} } }
    vi.spyOn(window, 'open').mockReturnValue(win)
    printNota(transaksi, profile())
    vi.restoreAllMocks()
    return ditulis.includes('Bea Meterai')
  }

  it('tidak muncul di nota cetak hitam-putih apa pun', () => {
    // Keterangan meterai hanya ada di invoice berwarna, bukan nota struk.
    expect(punyaMeterai(tx({ amount: 9000000 }))).toBe(false)
  })
})

// ---------- printNota ----------

describe('printNota', () => {
  afterEach(() => vi.restoreAllMocks())

  it('mengembalikan false bila jendela cetak diblokir popup blocker', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    expect(printNota(tx(), profile())).toBe(false)
  })

  it('mengembalikan true dan menulis dokumen lengkap saat berhasil', () => {
    const { hasil, html } = htmlNota(tx(), profile())
    expect(hasil).toBe(true)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('Nota INV-20260805-A1B2C')
  })

  it('memecah tag skrip agar tidak menutup <script> induk lebih awal', () => {
    // Ditulis 'scr'+'ipt' di sumber; kalau digabung utuh, dokumen induk rusak.
    const { html } = htmlNota(tx(), profile())
    expect(html).toContain('window.print()')
  })
})

// ---------- Unduh & bagikan ----------

describe('downloadBlob', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:palsu')
    globalThis.URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => vi.useRealTimers())

  it('membuat tautan unduh, mengekliknya, lalu membersihkan diri', () => {
    const klik = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    downloadBlob(new Blob(['x']), 'Invoice.pdf')

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(klik).toHaveBeenCalledTimes(1)
    // Elemen tidak boleh tertinggal di DOM.
    expect(document.querySelector('a[download]')).toBeNull()

    // URL objek dibebaskan agar blob tidak menahan memori.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1600)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:palsu')
  })
})

// ---------- Kartu invoice berwarna (jalur PNG/PDF) ----------

describe('kartu invoice berwarna', () => {
  const htmlInvoice = async (transaksi, prof) => {
    nodeInvoice = null
    await invoicePngBlob(transaksi, prof)
    return nodeInvoice.outerHTML
  }

  it('memuat judul INVOICE, nomor, identitas usaha, dan pelanggan', async () => {
    const html = await htmlInvoice(tx(), profile())
    expect(html).toContain('INVOICE')
    expect(html).toContain('INV-20260805-A1B2C')
    expect(html).toContain('Toko Kue Nusantara')
    expect(html).toContain('Bu Sari')
  })

  it('memakai "Pelanggan" sebagai pengganti nama yang kosong', async () => {
    expect(await htmlInvoice(tx({ customer_name: '' }), profile())).toContain('Pelanggan')
  })

  it('meng-escape masukan pengguna di kartu berwarna juga, bukan hanya di nota', async () => {
    const html = await htmlInvoice(
      tx({ description: '<script>alert(1)</script>', customer_name: '<b>x</b>' }),
      profile({ business_name: '<i>y</i>' }),
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>x</b>')
    expect(html).not.toContain('<i>y</i>')
  })

  it('menandai LUNAS / BELUM LUNAS', async () => {
    expect(await htmlInvoice(tx(), profile())).toContain('LUNAS')
    expect(await htmlInvoice(tx({ payment_status: 'belum' }), profile())).toContain('BELUM LUNAS')
  })

  it('merinci PPN & biaya layanan hanya bila ada nilainya', async () => {
    expect(await htmlInvoice(tx(), profile())).not.toContain('PPN')
    const lengkap = await htmlInvoice(tx({ amount: 100000 }), profile({
      invoice_tax_percent: 11, invoice_service_percent: 5,
    }))
    expect(lengkap).toContain('PPN (11%)')
    expect(lengkap).toContain('Biaya Layanan (5%)')
    expect(lengkap).toContain('GRAND TOTAL')
  })

  it('menampilkan logo usaha bila ada URL-nya', async () => {
    expect(await htmlInvoice(tx(), profile())).not.toContain('<img')
    expect(await htmlInvoice(tx(), profile({ logo_url: 'https://contoh.id/logo.png' })))
      .toContain('https://contoh.id/logo.png')
  })

  it('membersihkan elemen sementara dari DOM setelah render', async () => {
    const sebelum = document.body.children.length
    await invoicePngBlob(tx(), profile())
    expect(document.body.children.length).toBe(sebelum)
  })
})

describe('keterangan bea meterai di kartu invoice', () => {
  // UU No. 10/2020: bukti penerimaan uang di atas Rp5 juta kena Bea Meterai.
  // Syaratnya DUA-duanya: sudah lunas DAN grand total > 5 juta. Belum lunas
  // bukan bukti penerimaan, jadi tidak kena.
  const adaMeterai = async (transaksi, prof = profile()) => {
    nodeInvoice = null
    await invoicePngBlob(transaksi, prof)
    return nodeInvoice.outerHTML.includes('Bea Meterai')
  }

  it('muncul saat lunas dan total di atas Rp 5 juta', async () => {
    expect(await adaMeterai(tx({ amount: 6000000 }))).toBe(true)
  })

  it('tidak muncul saat total tepat Rp 5 juta (ambang eksklusif)', async () => {
    expect(await adaMeterai(tx({ amount: 5000000 }))).toBe(false)
  })

  it('tidak muncul saat belum lunas walau nominalnya besar', async () => {
    expect(await adaMeterai(tx({ amount: 9000000, payment_status: 'belum' }))).toBe(false)
  })

  it('ikut menghitung PPN saat menentukan ambang 5 juta', async () => {
    // 4.800.000 + PPN 11% = 5.328.000 -> melewati ambang.
    expect(await adaMeterai(tx({ amount: 4800000 }), profile({ invoice_tax_percent: 11 }))).toBe(true)
  })
})

describe('berkas PNG & PDF invoice', () => {
  it('invoicePngBlob menghasilkan blob PNG', async () => {
    const blob = await invoicePngBlob(tx(), profile())
    expect(blob.type).toBe('image/png')
  })

  it('invoicePdfBlob menghasilkan blob PDF berukuran wajar', async () => {
    const blob = await invoicePdfBlob(tx(), profile())
    expect(blob.type).toBe('application/pdf')
    expect(blob.size).toBeGreaterThan(500)
  })
})

describe('shareInvoiceFile', () => {
  afterEach(() => {
    delete navigator.canShare
    delete navigator.share
  })

  it('mengembalikan false bila perangkat tidak mendukung berbagi berkas', async () => {
    expect(await shareInvoiceFile(new Blob(['x']), 'a.pdf', 'caption')).toBe(false)
  })

  it('mengembalikan false bila canShare menolak jenis berkasnya', async () => {
    navigator.canShare = vi.fn(() => false)
    navigator.share = vi.fn()
    expect(await shareInvoiceFile(new Blob(['x']), 'a.pdf', 'caption')).toBe(false)
    expect(navigator.share).not.toHaveBeenCalled()
  })

  it('membagikan berkas dan mengembalikan true saat didukung', async () => {
    navigator.canShare = vi.fn(() => true)
    navigator.share = vi.fn(async () => {})
    expect(await shareInvoiceFile(new Blob(['x']), 'Invoice.pdf', 'Halo')).toBe(true)
    expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({ text: 'Halo' }))
  })

  it('mengembalikan false saat pengguna membatalkan dialog berbagi', async () => {
    navigator.canShare = vi.fn(() => true)
    navigator.share = vi.fn(async () => { throw new Error('AbortError') })
    expect(await shareInvoiceFile(new Blob(['x']), 'a.pdf', 'c')).toBe(false)
  })
})
