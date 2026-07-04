// Supabase Edge Function — auto-kategori transaksi pakai Claude (OPSIONAL).
// Deploy:  supabase functions deploy categorize
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Frontend tetap berjalan tanpa ini (memakai mesin rule-based di src/lib/categorize.js).
// Fungsi ini hanya dipakai bila Anda ingin akurasi lebih tinggi via LLM.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const MODEL = 'claude-haiku-4-5-20251001'

const CATEGORIES = {
  in: ['Penjualan', 'Penjualan QRIS', 'Penjualan Marketplace', 'Modal/Investasi', 'Pendapatan Lain'],
  out: ['Pembelian Stok', 'Biaya Admin & Transaksi', 'Operasional Listrik', 'Operasional Pulsa/Internet',
    'Sewa Tempat', 'Gaji Karyawan', 'Transportasi & Ongkir', 'Iklan & Promosi', 'Pajak', 'Pengeluaran Lain'],
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY belum diset' }), {
        status: 501, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    // items: [{ description, direction }]
    const { items } = await req.json()
    const valid = [...CATEGORIES.in, ...CATEGORIES.out].join(', ')

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: `Anda asisten pembukuan UMKM Indonesia. Kategorikan tiap transaksi ke SALAH SATU kategori berikut: ${valid}. Balas HANYA array JSON kategori, urut sesuai input. Contoh: ["Penjualan QRIS","Operasional Listrik"]`,
        messages: [{
          role: 'user',
          content: JSON.stringify(items.map((i: any) => `[${i.direction === 'in' ? 'masuk' : 'keluar'}] ${i.description}`)),
        }],
      }),
    })
    const data = await res.json()
    const text = data?.content?.[0]?.text ?? '[]'
    const categories = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]')
    return new Response(JSON.stringify({ categories }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
