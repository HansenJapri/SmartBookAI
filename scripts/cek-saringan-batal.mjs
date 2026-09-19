#!/usr/bin/env node
// Menjalankan penjaga saringan transaksi batal ke seluruh repo.
// Logikanya ada di cekSaringanBatal.mjs supaya ikut diuji vitest.
//
//   node scripts/cek-saringan-batal.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { periksaSaringanBatal, laporanSaringanBatal } from './cekSaringanBatal.mjs'

const AKAR = process.cwd()
const TARGET = ['src', join('supabase', 'functions')]
const EKSTENSI = ['.js', '.jsx', '.ts', '.tsx']
const LEWATI = new Set(['node_modules', 'dist', '.git', 'coverage', '.claude'])

function kumpulkan(dir, keluar = []) {
  let isi
  try {
    isi = readdirSync(dir)
  } catch {
    return keluar
  }
  for (const nama of isi) {
    if (LEWATI.has(nama)) continue
    const penuh = join(dir, nama)
    if (statSync(penuh).isDirectory()) kumpulkan(penuh, keluar)
    else if (EKSTENSI.some((e) => nama.endsWith(e))) keluar.push(penuh)
  }
  return keluar
}

const berkas = TARGET.flatMap((t) => kumpulkan(join(AKAR, t)))
  .map((p) => ({ path: relative(AKAR, p).split(sep).join('/'), isi: readFileSync(p, 'utf8') }))

const pelanggaran = periksaSaringanBatal(berkas)
console.log(`[saringan-batal] Memeriksa ${berkas.length} berkas.`)
console.log(laporanSaringanBatal(pelanggaran))

if (pelanggaran.length) {
  console.error(`::error::${pelanggaran.length} pembacaan transactions tidak memutuskan soal baris batal.`)
  process.exit(1)
}
