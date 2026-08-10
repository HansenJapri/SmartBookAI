import { describe, it, expect } from 'vitest'
import {
  hargaPerSatuan, biayaBarisPerUnit, hppKomposisi, yieldDariStok, applyAdjustments,
} from '../hpp'

describe('hargaPerSatuan — akar bug "1.200 terbaca 12.000"', () => {
  it('menghitung harga satuan dari harga kemasan dibagi isinya', () => {
    // Satu bungkus Rp 12.000 isi 800 gram -> Rp 15 per gram.
    expect(hargaPerSatuan({ pack_price: 12000, pack_size: 800 })).toBe(15)
  })

  it('resep 10 gram tepung berharga Rp 150, bukan Rp 12.000', () => {
    // Inilah kasus dari layar pengguna: kolom "harga/satuan" diisi harga
    // kemasan, lalu dikalikan takaran resep.
    const baris = { qty_per_unit: 10, pack_price: 12000, pack_size: 800 }
    expect(biayaBarisPerUnit(baris)).toBe(150)
  })

  it('jatuh ke harga per satuan manual bila kemasan belum diisi', () => {
    expect(hargaPerSatuan({ price_per_unit: 15 })).toBe(15)
    expect(hargaPerSatuan({ price_per_unit: 15, pack_size: 0, pack_price: 0 })).toBe(15)
  })

  it('harga kemasan menang atas harga satuan manual saat keduanya ada', () => {
    // Kemasan adalah angka yang benar-benar diketahui pengguna dari struk belanja.
    expect(hargaPerSatuan({ price_per_unit: 999, pack_price: 12000, pack_size: 800 })).toBe(15)
  })

  it('nilai kosong / tidak masuk akal tidak melempar', () => {
    expect(hargaPerSatuan(undefined)).toBe(0)
    expect(hargaPerSatuan({})).toBe(0)
    expect(hargaPerSatuan({ pack_price: 12000, pack_size: 0 })).toBe(0)
  })
})

describe('biayaBarisPerUnit — biaya per periode', () => {
  it('membagi biaya periode dengan jumlah produk periode itu', () => {
    // Sewa Rp 3 juta/bulan, produksi 1.500 pcs/bulan -> Rp 2.000 per pcs.
    expect(biayaBarisPerUnit({
      cost_basis: 'per_periode', period_amount: 3000000, period_output: 1500,
    })).toBe(2000)
  })

  it('mengembalikan 0 bila jumlah produksi belum diisi, bukan tak hingga', () => {
    expect(biayaBarisPerUnit({ cost_basis: 'per_periode', period_amount: 3000000, period_output: 0 })).toBe(0)
    expect(biayaBarisPerUnit({ cost_basis: 'per_periode', period_amount: 3000000 })).toBe(0)
  })

  it('mengabaikan takaran & harga pada baris per periode', () => {
    expect(biayaBarisPerUnit({
      cost_basis: 'per_periode', period_amount: 1000, period_output: 10,
      qty_per_unit: 999, pack_price: 999, pack_size: 1,
    })).toBe(100)
  })
})

describe('hppKomposisi', () => {
  it('menjumlahkan bahan berkemasan dan biaya per periode', () => {
    const rows = [
      { qty_per_unit: 100, pack_price: 12000, pack_size: 800 },      // 1500
      { qty_per_unit: 2, price_per_unit: 500 },                       // 1000
      { cost_basis: 'per_periode', period_amount: 500000, period_output: 1000 }, // 500
    ]
    expect(hppKomposisi(rows)).toBe(3000)
  })

  it('daftar kosong menghasilkan 0', () => {
    expect(hppKomposisi([])).toBe(0)
    expect(hppKomposisi(null)).toBe(0)
  })
})

describe('applyAdjustments tetap kompatibel dengan bentuk baris lama', () => {
  it('baris { qty, price_per_unit } menghasilkan angka yang sama seperti sebelumnya', () => {
    const rows = [{ qty: 2, price_per_unit: 1000 }, { qty: 3, price_per_unit: 500 }]
    expect(applyAdjustments(rows, () => 0)).toBe(3500)
    expect(applyAdjustments(rows, () => 10)).toBeCloseTo(3850, 6)
  })

  it('kenaikan ikut berlaku pada biaya per periode (mis. sewa naik)', () => {
    const rows = [{ cost_basis: 'per_periode', period_amount: 1000, period_output: 10 }]
    expect(applyAdjustments(rows, () => 20)).toBeCloseTo(120, 6)
  })
})

describe('yieldDariStok', () => {
  it('menghitung dari isi kemasan dikurangi pemakaian kemasan terbuka', () => {
    // 12 bungkus x 800 gram = 9.600 gram; resep 100 gram -> 96 produk.
    expect(yieldDariStok({ stock: 12, pack_size: 800, opened_used: 0 }, 100)).toBe(96)
    // Setelah 1 bungkus habis dan 100 gram terpakai dari bungkus berikutnya.
    expect(yieldDariStok({ stock: 11, pack_size: 800, opened_used: 100 }, 100)).toBe(87)
  })

  it('tanpa konversi kemasan, takaran dianggap dalam satuan stok', () => {
    // Stok 30 butir telur, resep 2 butir -> 15 produk.
    expect(yieldDariStok({ stock: 30, pack_size: 0 }, 2)).toBe(15)
  })

  it('tidak pernah negatif dan menolak takaran nol', () => {
    expect(yieldDariStok({ stock: 0, pack_size: 800, opened_used: 500 }, 100)).toBe(0)
    expect(yieldDariStok({ stock: 5, pack_size: 0 }, 0)).toBe(null)
  })
})
