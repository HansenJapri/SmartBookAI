// ============================================================
// PENYIMPAN AKSI ASISTEN — jembatan antara draft `ai-crud` dan API aplikasi.
//
// Prinsip yang dipegang berkas ini:
//   1. Draft dari AI TIDAK PERNAH masuk database sendiri. Fungsi di sini baru
//      dipanggil setelah pengguna menekan Simpan pada kartu ringkasan.
//   2. Penyimpanan memakai fungsi api.js YANG SAMA dengan form manual — jadi
//      RLS, workspace, jejak audit, dan pengurangan stok berlaku identik.
//      Tidak ada jalur tulis khusus AI yang bisa melewati aturan itu.
//   3. Nilai yang dihasilkan sistem (nomor dokumen) dibuat DI SINI, bukan
//      ditanyakan ke pengguna dan bukan dikarang model.
//
// Pemetaan entitas -> tabel mengikuti `entity-schemas.ts` di Edge Function.
// ============================================================
import {
  addTransaction, addTransactionWithStock, updateTransaction, deleteTransaction,
  addProduct, updateProduct, deleteProduct,
  addSupplier, updateSupplier, deleteSupplier,
  addCustomer, updateCustomer, deleteCustomer, resolveCustomer,
  addEmployee, updateEmployee, deleteEmployee,
  setAttendance,
  addKpiCriteria, updateKpiCriteria, deleteKpiCriteria, saveKpiScores,
  addPurchaseOrder, updatePurchaseOrder, fetchPurchaseOrders,
  addTask, updateTask, deleteTask,
  addReminder, deleteReminder,
} from './api'
import { nextDocNumber } from './gudang'
import { setAsalAI } from './supabase'

/**
 * Gabungkan tanggal (YYYY-MM-DD) dengan jam SAAT INI, dibangun dari komponen
 * lokal agar tanggal tidak bergeser sehari ketika dikonversi ke UTC.
 */
export function occurredAtIso(dateStr) {
  const now = new Date()
  const ds = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || '')) ? dateStr : now.toISOString().slice(0, 10)
  const [y, m, d] = ds.split('-').map(Number)
  return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString()
}

/**
 * Waktu pengingat. Bila pengguna hanya menyebut tanggal, pukul 09.00 dipakai
 * sebagai jam default — pengingat tengah malam praktis tidak pernah terbaca.
 */
export function remindAtIso(value) {
  const v = String(value || '').trim()
  if (!v) return new Date().toISOString()
  if (v.includes('T')) {
    const dt = new Date(v)
    return Number.isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString()
  }
  const [y, m, d] = v.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return new Date().toISOString()
  return new Date(y, m - 1, d, 9, 0, 0).toISOString()
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
const txt = (v) => (v === null || v === undefined || v === '' ? null : String(v))

/** Draft transaksi -> baris tabel `transactions`. */
export function toTransactionRow(values = {}) {
  const direction = values.direction === 'out' ? 'out' : 'in'
  const row = {
    description: String(values.description || '').slice(0, 200)
      || (direction === 'in' ? 'Pemasukan' : 'Pengeluaran'),
    amount: Math.round(Number(values.amount) || 0),
    direction,
    category: values.category || 'Lain-lain',
    // Channel sudah diterjemahkan ke slug oleh Edge Function; 'asisten' hanya
    // dipakai bila pengguna memang tidak menyebut channel apa pun.
    channel: values.channel || 'asisten',
    occurred_at: occurredAtIso(values.occurred_at),
    payment_status: values.payment_status === 'belum' ? 'belum' : 'lunas',
  }
  if (row.payment_status === 'belum' && values.due_date) row.due_date = values.due_date
  if (values.customer_name) row.customer_name = txt(values.customer_name)
  if (values.customer_contact) row.customer_contact = txt(values.customer_contact)
  if (values.product_id) {
    row.product_id = values.product_id
    row.qty = num(values.qty) ?? 1
  }
  return row
}

/** Draft tugas -> baris tabel `tasks` (nilai status/prioritas ikut CHECK constraint). */
export function toTaskRow(values = {}) {
  return {
    title: String(values.title || '').slice(0, 160),
    note: txt(values.note),
    status: ['antre', 'dikerjakan', 'selesai'].includes(values.status) ? values.status : 'antre',
    priority: ['rendah', 'normal', 'tinggi'].includes(values.priority) ? values.priority : 'normal',
    due_date: values.due_date || null,
    assignee_id: values.assignee_id || null,
  }
}

async function saveTransaction(operation, targetId, values) {
  if (operation === 'delete') {
    await deleteTransaction(targetId)
    return 'Transaksi dihapus.'
  }
  const row = toTransactionRow(values)

  // Tautkan ke baris pelanggan bila kalimatnya menyebut nama/kontak. Kolom teks
  // `customer_name`/`customer_contact` TETAP diisi: halaman Piutang & Utang dan
  // Invoice masih membacanya, jadi mengosongkannya akan mematahkan keduanya.
  let catatanPelanggan = ''
  if (row.customer_name || row.customer_contact) {
    try {
      const hasil = await resolveCustomer({ name: row.customer_name, phone: row.customer_contact })
      if (hasil.customer) {
        row.customer_id = hasil.customer.id
        if (hasil.created) catatanPelanggan = ` Pelanggan baru "${hasil.customer.name}" ikut disimpan.`
      } else if (hasil.candidates?.length) {
        // Ada beberapa pelanggan bernama sama. Menebak salah satunya akan
        // menempelkan penjualan ke riwayat orang yang keliru, jadi transaksi
        // tetap disimpan tanpa tautan dan pengguna diberi tahu.
        catatanPelanggan = ` Ada ${hasil.candidates.length} pelanggan bernama "${row.customer_name}" —`
          + ' transaksi belum ditautkan ke salah satunya. Pilih manual di menu Transaksi.'
      }
    } catch {
      // Penautan pelanggan bersifat pelengkap; kegagalannya tidak boleh
      // menggagalkan pencatatan transaksi itu sendiri.
    }
  }

  if (operation === 'update') {
    await updateTransaction(targetId, row)
    return 'Transaksi diperbarui.' + catatanPelanggan
  }
  // Transaksi ber-produk memakai RPC atomik supaya stok & transaksi tersimpan
  // dalam SATU transaksi database — persis jalur form manual.
  if (row.product_id) {
    await addTransactionWithStock(row, [{ productId: row.product_id, qty: row.qty }])
    return 'Transaksi tersimpan dan stok produk sudah disesuaikan.' + catatanPelanggan
  }
  await addTransaction(row)
  return 'Transaksi tersimpan.' + catatanPelanggan
}

async function savePurchaseOrder(operation, targetId, values) {
  if (operation === 'update') {
    await updatePurchaseOrder(targetId, {
      qty: num(values.qty),
      unit_price: num(values.unit_price),
      supplier_id: values.supplier_id || null,
      expected_date: values.expected_date || null,
      note: txt(values.note),
    })
    return 'Purchase Order diperbarui.'
  }
  // `po_number` NOT NULL tanpa default di database. Nomor dokumen adalah milik
  // sistem: dihitung dari nomor tertinggi yang sudah ada, tidak pernah ditanyakan.
  const existing = await fetchPurchaseOrders()
  const po = await addPurchaseOrder({
    po_number: nextDocNumber('PO', existing.map((p) => p.po_number)),
    product_id: values.product_id,
    qty: num(values.qty),
    unit_price: num(values.unit_price) ?? 0,
    supplier_id: values.supplier_id || null,
    expected_date: values.expected_date || null,
    note: txt(values.note),
    status: 'draft',
  })
  return `Purchase Order ${po.po_number} dibuat sebagai draf.`
}

// Field yang HARUS berisi UUID saat sampai ke database, beserta nama yang
// dikenali pengguna untuk menjelaskannya bila tidak.
const KOLOM_REF = {
  product_id: 'Produk', supplier_id: 'Pemasok', employee_id: 'Karyawan',
  criteria_id: 'Kriteria KPI', assignee_id: 'Penanggung jawab', customer_id: 'Pelanggan',
}
const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Jaring pengaman terakhir sebelum menulis ke database.
 *
 * Kartu ringkasan bisa disunting, dan hasilnya disimpan LANGSUNG dari klien
 * tanpa melewati Edge Function lagi — jadi tidak ada pemeriksaan server di
 * antara suntingan dan INSERT. Kalau sebuah field ref entah bagaimana masih
 * berisi nama alih-alih ID, Postgres akan menolaknya dengan
 * "invalid input syntax for type uuid" — kalimat yang tidak berarti apa pun
 * bagi pemilik warung dan tidak menunjuk ke apa yang harus ia perbaiki.
 *
 * Resolusi nama->ID sudah ditangani di server (crud-tools.ts); ini hanya
 * memastikan kegagalannya, bila ada, bisa dibaca manusia.
 */
function pastikanRefBerupaId(values = {}) {
  for (const [kolom, label] of Object.entries(KOLOM_REF)) {
    const v = values[kolom]
    if (v === undefined || v === null || v === '') continue
    if (!POLA_UUID.test(String(v))) {
      throw new Error(`${label} "${v}" belum dikenali. Pilih ${label.toLowerCase()} dari daftar pada kartu di atas.`)
    }
  }
}

/**
 * Simpan satu draft yang sudah dikonfirmasi pengguna.
 *
 * Pembungkus ini yang menyalakan penanda asal aksi, sehingga baris audit yang
 * dihasilkan penulisan di bawahnya tercatat `via = 'ai'`. Ia dimatikan di blok
 * finally, termasuk saat penyimpanan melempar — bendera yang tertinggal menyala
 * akan salah melabeli aksi manual berikutnya sebagai aksi AI.
 *
 * @returns {Promise<string>} kalimat ringkas untuk ditampilkan di percakapan.
 */
/**
 * Ke MANA data ini tersimpan — daftar menu yang benar-benar akan memuatnya.
 *
 * Kebutuhannya datang dari laporan pengguna 9 September 2026: setelah asisten
 * menjawab "Transaksi tersimpan", tidak ada satu pun petunjuk di mana barisnya
 * bisa dilihat. Untuk piutang ini terasa seperti data hilang — halaman
 * Transaksi memang memuatnya, tetapi yang dibuka pengguna adalah Piutang &
 * Utang, dan tidak ada yang pernah memberitahu bahwa keduanya berbeda halaman.
 *
 * Satu catatan bisa mendarat di LEBIH DARI SATU tempat, dan justru itu yang
 * paling membingungkan kalau tidak disebut: transaksi belum lunas masuk
 * Transaksi DAN Piutang & Utang; produk baru bermodal masuk Stok Produk DAN
 * Transaksi (sebagai pengeluaran).
 *
 * Dipakai HANYA setelah penyimpanan benar-benar berhasil. Menyebut tujuan
 * untuk data yang gagal tersimpan adalah kebohongan yang paling mahal:
 * pengguna berhenti mencari, lalu menemukan lubangnya berminggu-minggu kemudian.
 */
export function tujuanSimpan(draft) {
  const { entity, values = {}, operation = 'create' } = draft || {}
  if (operation === 'delete') return []

  const t = []
  switch (entity) {
    case 'transaksi':
      t.push({ label: 'Transaksi', to: '/app/transaksi' })
      // 'belum' pada pemasukan = piutang; pada pengeluaran = utang.
      if (values.payment_status === 'belum') {
        t.push({ label: 'Piutang & Utang', to: '/app/piutang' })
      }
      break
    case 'produk':
      t.push({ label: 'Stok Produk', to: '/app/stok' })
      if (values.catat_pengeluaran) t.push({ label: 'Transaksi', to: '/app/transaksi' })
      break
    case 'supplier':       t.push({ label: 'Pemasok', to: '/app/supplier' }); break
    case 'pelanggan':
    case 'customer':       t.push({ label: 'Piutang & Utang', to: '/app/piutang' }); break
    case 'purchase_order': t.push({ label: 'Purchase Order', to: '/app/po' }); break
    case 'karyawan':       t.push({ label: 'Karyawan', to: '/app/karyawan' }); break
    case 'absensi':        t.push({ label: 'Absensi', to: '/app/absensi' }); break
    case 'kpi_criteria':
    case 'kpi_score':      t.push({ label: 'KPI', to: '/app/kpi' }); break
    case 'tugas':
    case 'task':           t.push({ label: 'Papan Tugas', to: '/app/tugas' }); break
    case 'pengingat':
    case 'reminder':       t.push({ label: 'Dashboard (Pengingat)', to: '/app/dashboard' }); break
    default: break
  }
  return t
}

export async function saveDraftAction(draft) {
  setAsalAI(true)
  try {
    return await simpanDraft(draft)
  } finally {
    setAsalAI(false)
  }
}

async function simpanDraft(draft) {
  const { entity, operation = 'create', targetId, values = {} } = draft || {}
  if (operation !== 'delete') pastikanRefBerupaId(values)

  switch (entity) {
    case 'transaksi':
      return saveTransaction(operation, targetId, values)

    case 'produk': {
      if (operation === 'delete') { await deleteProduct(targetId); return 'Produk dihapus.' }
      const row = {
        name: values.name, unit: values.unit || 'pcs',
        price: num(values.price) ?? 0, cost_price: num(values.cost_price) ?? 0,
        stock: num(values.stock) ?? 0, min_stock: num(values.min_stock) ?? 0,
        category: txt(values.category), supplier_id: values.supplier_id || null,
        kind: values.kind === 'bahan' ? 'bahan' : 'jual',
      }
      if (operation === 'update') { await updateProduct(targetId, row); return 'Produk diperbarui.' }
      const produk = await addProduct(row)

      // ---- Multi-routing: stok masuk = uang keluar ----
      //
      // Menambah stok tanpa mencatat pengeluarannya membuat laporan laba rugi
      // terlalu bagus: barangnya bertambah di gudang, uangnya tidak pernah
      // tercatat keluar. Karena itu penambahan stok yang biayanya diketahui ikut
      // menulis satu baris pengeluaran.
      //
      // Persetujuannya EKSPLISIT lewat field `catat_pengeluaran` pada kartu
      // pratinjau — mencatat uang keluar diam-diam sama merusaknya dengan tidak
      // mencatatnya sama sekali, hanya ke arah sebaliknya.
      const modal = num(values.cost_price) ?? 0
      const jumlah = num(values.stock) ?? 0
      const nilai = Math.round(modal * jumlah)
      const ikutCatat = values.catat_pengeluaran !== false && values.catat_pengeluaran !== 'false'
      if (ikutCatat && nilai > 0) {
        try {
          await addTransactionWithStock(
            {
              description: `Pembelian stok awal: ${jumlah} ${row.unit} ${row.name}`.slice(0, 200),
              amount: nilai,
              direction: 'out',
              category: values.expense_category || 'Pembelian Stok',
              channel: 'asisten',
              occurred_at: occurredAtIso(values.occurred_at),
              supplier_id: row.supplier_id,
              product_id: produk.id,
              qty: jumlah,
            },
            // Stok awal sudah ikut tersimpan lewat addProduct; kalau baris produk
            // dikirim juga, stoknya akan bertambah dua kali.
            [],
          )
          return `Produk "${row.name}" ditambahkan, dan pengeluaran ${nilai.toLocaleString('id-ID')} tercatat sebagai pembelian stok.`
        } catch {
          // Produknya sudah tersimpan; katakan apa adanya supaya pengguna bisa
          // mencatat pengeluarannya manual alih-alih mengira semuanya gagal.
          return `Produk "${row.name}" ditambahkan, tetapi pencatatan pengeluarannya gagal — catat manual di menu Transaksi.`
        }
      }
      return `Produk "${row.name}" ditambahkan.`
    }

    case 'pemasok': {
      if (operation === 'delete') { await deleteSupplier(targetId); return 'Pemasok dihapus.' }
      const row = {
        name: values.name, phone: txt(values.phone), email: txt(values.email),
        address: txt(values.address), note: txt(values.note),
      }
      if (operation === 'update') { await updateSupplier(targetId, row); return 'Pemasok diperbarui.' }
      await addSupplier(row)
      return `Pemasok "${row.name}" ditambahkan.`
    }

    case 'pelanggan': {
      if (operation === 'delete') { await deleteCustomer(targetId); return 'Pelanggan dihapus.' }
      const row = {
        name: values.name, phone: txt(values.phone), email: txt(values.email),
        address: txt(values.address), note: txt(values.note),
      }
      if (operation === 'update') { await updateCustomer(targetId, row); return 'Data pelanggan diperbarui.' }
      await addCustomer(row)
      return `Pelanggan "${row.name}" ditambahkan.`
    }

    case 'karyawan': {
      if (operation === 'delete') { await deleteEmployee(targetId); return 'Data karyawan dihapus.' }
      const row = {
        name: values.name, role: txt(values.role), phone: txt(values.phone),
        salary_type: values.salary_type === 'harian' ? 'harian' : 'bulanan',
        salary_amount: num(values.salary_amount) ?? 0,
        join_date: values.join_date || null, note: txt(values.note),
      }
      if (operation === 'update') { await updateEmployee(targetId, row); return 'Data karyawan diperbarui.' }
      await addEmployee(row)
      return `Karyawan "${row.name}" ditambahkan.`
    }

    case 'absensi': {
      // UNIQUE (employee_id, date): create & update sama-sama upsert, supaya
      // koreksi status ("ternyata sakit, bukan izin") tidak menabrak constraint.
      const date = values.date || new Date().toISOString().slice(0, 10)
      await setAttendance(values.employee_id, date, values.status, values.note)
      return `Absensi tanggal ${date} tersimpan (${values.status}).`
    }

    case 'kpi_kriteria': {
      if (operation === 'delete') { await deleteKpiCriteria(targetId); return 'Kriteria KPI dihapus.' }
      const row = { name: values.name, weight: num(values.weight) ?? 0, source: values.source || 'manual' }
      if (operation === 'update') { await updateKpiCriteria(targetId, row); return 'Kriteria KPI diperbarui.' }
      await addKpiCriteria(row)
      return `Kriteria KPI "${row.name}" ditambahkan.`
    }

    case 'kpi_skor':
      // UNIQUE (employee_id, criteria_id, period) -> upsert, bukan insert.
      await saveKpiScores([{
        employee_id: values.employee_id,
        criteria_id: values.criteria_id,
        period: values.period,
        score: num(values.score) ?? 0,
      }])
      return `Skor KPI periode ${values.period} tersimpan.`

    case 'purchase_order':
      return savePurchaseOrder(operation, targetId, values)

    case 'tugas': {
      if (operation === 'delete') { await deleteTask(targetId); return 'Tugas dihapus.' }
      const row = toTaskRow(values)
      if (operation === 'update') { await updateTask(targetId, row); return 'Tugas diperbarui.' }
      await addTask(row)
      return `Tugas "${row.title}" ditambahkan ke papan tugas.`
    }

    case 'pengingat': {
      if (operation === 'delete') { await deleteReminder(targetId); return 'Pengingat dihapus.' }
      await addReminder({
        title: String(values.title || '').slice(0, 160),
        remind_at: remindAtIso(values.remind_at),
        note: txt(values.note),
      })
      return 'Pengingat dibuat.'
    }

    default:
      throw new Error(`Aksi untuk "${entity}" belum didukung asisten.`)
  }
}
