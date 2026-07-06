// ============================================================
// Supabase Edge Function: ai  (deploy dengan nama: BukuPencatatan)
// Proxy aman ke Google Gemini untuk chatbot tutorial BukuPintar AI.
//
// Prinsip keamanan & privasi (sesuai Kebijakan Privasi & UU PDP):
//   - Kunci GEMINI_API_KEY disimpan sebagai SECRET di server, tidak pernah
//     dikirim ke browser.
//   - Memakai token login pengguna (JWT) sehingga RLS berlaku: fungsi hanya
//     bisa membaca data milik pengguna yang sedang login.
//   - Yang dikirim ke Gemini hanya RINGKASAN TERAGREGASI (total, kategori,
//     jumlah). Data sensitif (nama/kontak pelanggan, deskripsi mentah,
//     nomor rekening) TIDAK dikirim.
//   - Tidak menyimpan riwayat percakapan.
//
// Deploy:
//   supabase functions deploy ai
//   supabase secrets set GEMINI_API_KEY=...   (kunci dari Google AI Studio)
// ============================================================
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? ''
const CHAT_MODEL = 'gemini-2.5-flash-lite'

const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://localhost:5174', APP_ORIGIN].filter(Boolean)

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : (ALLOWED_ORIGINS[0] || '*')
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

const rupiah = (n: number) => 'Rp ' + Math.round(n || 0).toLocaleString('id-ID')

const SYSTEM = `Kamu adalah asisten BukuPintar AI untuk pemilik UMKM di Indonesia.
Tugasmu: memandu pengguna memakai aplikasi dan menjawab pertanyaan tentang keuangan usaha mereka.

CARA MENJAWAB (wajib dipatuhi):
- Tulis dalam TEKS BIASA. DILARANG memakai format markdown: tidak boleh ada tanda bintang (*), pagar (#), garis bawah (_), atau tanda kutip kode. Jangan menebalkan teks.
- STRUKTUR JAWABAN: mulai dengan jawaban inti 1-2 kalimat. Bila memakai angka, sebutkan angkanya persis. Bila menjelaskan cara, lanjutkan dengan langkah bernomor.
- Jawab SINGKAT dan langsung ke inti. Hindari basa-basi.
- Jika menjelaskan cara melakukan sesuatu, beri LANGKAH BERNOMOR yang jelas dan berurutan. Sebutkan nama menu dan tombol yang harus ditekan. Contoh gaya:
1. Buka menu Transaksi.
2. Tekan tombol + Tambah.
3. Pilih jenis Pemasukan, isi nominal, lalu tekan Simpan.
- Gunakan ANGKA hanya dari "Ringkasan data usaha". DILARANG KERAS mengarang atau memperkirakan angka. Bila angka yang ditanya tidak ada di ringkasan, jawab persis: "Data itu belum tercatat di aplikasi." lalu sarankan cara mencatatnya.
- Jangan memberi nasihat hukum atau pajak yang final; ingatkan verifikasi ke pihak berwenang bila perlu.
- Jangan meminta data sensitif seperti nomor rekening atau kata sandi.
- Akhiri jawaban tentang angka dengan pengingat singkat bahwa jawaban AI perlu diperiksa ulang di menu Laporan.

NAVIGASI SESUAI PERANGKAT:
- Bila "Perangkat: mobile" -> menu utama ada di BAR BAWAH layar (Dashboard, Transaksi, tombol + Catat di tengah, Radar, Menu). Menu lain (Stok, Laporan, dll) dibuka lewat tombol Menu di bar bawah.
- Bila "Perangkat: desktop" -> semua menu ada di SIDEBAR KIRI.
Sesuaikan instruksi langkahmu dengan perangkat pengguna.

PETA MENU APLIKASI (untuk panduan navigasi yang akurat):
- Dashboard: ringkasan pemasukan, pengeluaran, laba, margin, filter rentang tanggal, kartu Insight AI (narasi tren otomatis), kartu Target Penjualan (prediksi 3 skenario), peringatan stok menipis.
- Transaksi: catat dan lihat transaksi; tombol "+ Tambah"; ada filter jenis dan status bayar; tiap pemasukan punya tombol "Invoice".
- Import Data: unggah file CSV atau Excel dari mutasi bank, QRIS, atau marketplace.
- Foto/PDF Struk: unggah foto atau PDF struk, dibaca AI, ditinjau dulu sebelum disimpan.
- Rekonsiliasi: mendeteksi transaksi duplikat.
- Stok Produk: kelola produk, stok, satuan, dan kategori produk; ada peringatan stok menipis.
- Simulasi HPP: hitung modal (HPP) per produk dari komposisi bahan, lengkap dengan simulasi bila harga bahan naik. Ada tombol Buat Draf AI untuk mengisi komposisi awal.
- Pemasok: kelola data pemasok.
- Radar Harga: sinyal arah harga bahan pokok dari berita ekonomi (diperbarui harian), kurs USD/IDR, dan info inflasi BPS.
- Reveal Kebocoran: melihat biaya dan potongan marketplace.
- Laporan: unduh laporan laba/rugi (PDF dan Excel) serta rekap pajak.
- Pengaturan: profil usaha, kategori Pemasukan dan Pengeluaran, channel, serta status persetujuan.
- Asisten (jendela chat ini): mode Tanya untuk bertanya, mode Catat untuk mencatat transaksi lewat ketikan atau suara.

PENTING: JANGAN mengarang nama menu. Menu yang TERSEDIA hanya yang ada di daftar di atas. TIDAK ADA menu bernama "Penjualan". Untuk mencatat penjualan/pemasukan, gunakan menu Transaksi atau mode Catat di asisten ini.

ALUR UMUM (ikuti persis, sebutkan langkah bernomor):
- Mencatat penjualan/pemasukan cepat lewat asisten:
1. Di jendela asisten ini, pindah ke mode Catat.
2. Ketik atau ucapkan transaksinya, misal: laku 3 kue coklat total 45 ribu.
3. Periksa kartu hasil baca AI, perbaiki bila salah, lalu tekan Simpan.
- Mencatat penjualan/pemasukan manual:
1. Buka menu Transaksi.
2. Tekan tombol + Tambah.
3. Pada pilihan Jenis, pilih Pemasukan.
4. Isi Nominal dan pilih Kategori. Bila perlu, isi Nama pelanggan dan pilih status Lunas atau Belum Lunas.
5. Tekan Simpan.
- Mencatat pengeluaran:
1. Buka menu Transaksi.
2. Tekan tombol + Tambah.
3. Pada Jenis, pilih Pengeluaran.
4. Isi Nominal dan Kategori, lalu tekan Simpan.
- Membuat atau membagikan invoice:
1. Buka menu Transaksi.
2. Pada baris transaksi Pemasukan, tekan tombol Invoice.
3. Pilih Unduh PDF, Unduh Gambar (PNG), atau Bagikan.
- Menambah produk/stok:
1. Buka menu Stok Produk.
2. Isi formulir Tambah Produk (nama, satuan, stok, harga).
3. Tekan tombol + Tambah Produk.
- Membaca struk dengan AI:
1. Buka menu Foto/PDF Struk.
2. Unggah foto atau PDF struk (paling akurat: struk cetak kasir).
3. Tekan tombol Baca Struk dengan AI, tinjau hasilnya, lalu simpan.
- Menghitung HPP / simulasi kenaikan bahan:
1. Buka menu Simulasi HPP.
2. Pilih produk, lalu isi komposisi bahan atau tekan Buat Draf AI.
3. Koreksi draf bila perlu, simpan, lalu lihat simulasi di bagian bawah.
- Melihat prediksi harga bahan pokok:
1. Buka menu Radar Harga.
2. Lihat kartu sinyal per bahan beserta sumber beritanya.
- Mengunduh laporan:
1. Buka menu Laporan.
2. Tekan Unduh PDF atau Unduh Excel.`

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsHeaders(origin)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    if (!GEMINI_API_KEY) return json({ error: 'GEMINI_API_KEY belum diatur di server.' }, 501)

    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Harus masuk (login) untuk memakai asisten AI.' }, 401)

    // Klien dengan token pengguna: RLS berlaku, hanya data miliknya yang terbaca.
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) return json({ error: 'Sesi tidak valid. Silakan masuk kembali.' }, 401)

    // Batas pemakaian harian per akun (kontrol biaya). Aman bila RPC belum dimigrasi.
    const { data: allowed } = await supabase.rpc('bump_ai_usage', { p_kind: 'chat', p_limit: 60 })
    if (allowed === false) return json({ error: 'Batas pemakaian asisten AI harian tercapai. Silakan coba lagi besok.' }, 429)

    const { message, history, device } = await req.json()
    if (!message || typeof message !== 'string') return json({ error: 'Pesan kosong.' }, 400)
    if (message.length > 2000) return json({ error: 'Pesan terlalu panjang.' }, 400)
    const dev = device === 'mobile' ? 'mobile' : 'desktop'

    // ---- Susun RINGKASAN TERAGREGASI (tanpa data pribadi mentah) ----
    const { data: txs } = await supabase
      .from('transactions')
      .select('direction, amount, category, payment_status, occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(2000)

    let income = 0, expense = 0
    const catExpense: Record<string, number> = {}
    let unpaidCount = 0, unpaidTotal = 0
    const now = new Date(); const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const weekAgo = new Date(Date.now() - 7 * 86400000)
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000)
    let monthIncome = 0, monthExpense = 0, wk1Income = 0, wk2Income = 0
    for (const t of txs || []) {
      const amt = Number(t.amount) || 0
      const dt = new Date(t.occurred_at)
      const inMonth = dt >= monthStart
      if (t.direction === 'in') {
        income += amt; if (inMonth) monthIncome += amt
        if (dt >= weekAgo) wk1Income += amt
        else if (dt >= twoWeeksAgo) wk2Income += amt
        if (t.payment_status === 'belum') { unpaidCount++; unpaidTotal += amt }
      } else {
        expense += amt; if (inMonth) monthExpense += amt
        catExpense[t.category] = (catExpense[t.category] || 0) + amt
      }
    }
    const topCats = Object.entries(catExpense).sort((a, b) => b[1] - a[1]).slice(0, 5)
    const wow = wk2Income > 0 ? Math.round(((wk1Income - wk2Income) / wk2Income) * 100) : null

    const { data: products } = await supabase.from('products').select('name, stock, min_stock, unit')
    const lowStock = (products || []).filter((p) => Number(p.min_stock) > 0 && Number(p.stock) <= Number(p.min_stock))

    const summary = [
      `Total pemasukan (semua waktu): ${rupiah(income)}`,
      `Total pengeluaran (semua waktu): ${rupiah(expense)}`,
      `Laba bersih (semua waktu): ${rupiah(income - expense)}`,
      `Pemasukan bulan ini: ${rupiah(monthIncome)}; Pengeluaran bulan ini: ${rupiah(monthExpense)}`,
      `Pemasukan 7 hari terakhir: ${rupiah(wk1Income)}; 7 hari sebelumnya: ${rupiah(wk2Income)}${wow === null ? '' : `; perubahan minggu-ke-minggu: ${wow}%`}`,
      `Jumlah transaksi tercatat: ${(txs || []).length}`,
      `Penjualan belum lunas: ${unpaidCount} (total ${rupiah(unpaidTotal)})`,
      topCats.length ? `Pengeluaran terbesar per kategori: ${topCats.map(([k, v]) => `${k} ${rupiah(v)}`).join('; ')}` : 'Belum ada data pengeluaran per kategori.',
      `Jumlah produk: ${(products || []).length}; Produk stok menipis: ${lowStock.length}${lowStock.length ? ' (' + lowStock.slice(0, 8).map((p) => p.name).join(', ') + ')' : ''}`,
      `Perangkat: ${dev}`,
    ].join('\n')

    // ---- Riwayat singkat dalam sesi (tidak disimpan di server) ----
    const contents: any[] = []
    if (Array.isArray(history)) {
      for (const h of history.slice(-6)) {
        if (h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string') {
          contents.push({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(h.text).slice(0, 2000) }] })
        }
      }
    }
    contents.push({ role: 'user', parts: [{ text: `Ringkasan data usaha pengguna:\n${summary}\n\nPertanyaan pengguna:\n${message}` }] })

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents,
          generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
        }),
      },
    )
    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      return json({ error: 'Layanan AI sedang tidak tersedia.', detail: errText.slice(0, 300) }, 502)
    }
    const data = await geminiRes.json()
    const reply = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? ''
    return json({ reply: reply || 'Maaf, saya belum bisa menjawab itu. Coba tanyakan dengan cara lain.' })
  } catch (e) {
    return json({ error: 'Terjadi kesalahan.', detail: String(e).slice(0, 300) }, 500)
  }
})
