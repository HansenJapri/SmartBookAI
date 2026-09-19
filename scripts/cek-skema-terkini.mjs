#!/usr/bin/env node
// Menjalankan penjaga kesegaran supabase/schema.sql.
// Logikanya ada di cekSkemaTerkini.mjs supaya ikut diuji vitest.
//
//   node scripts/cek-skema-terkini.mjs

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { periksaSkemaTerkini, laporanSkemaTerkini } from './cekSkemaTerkini.mjs'

const DIR = join(process.cwd(), 'supabase')
const DUMP = join(DIR, 'schema.sql')

if (!existsSync(DUMP)) {
  console.error('::error::supabase/schema.sql tidak ada. Gerbang DB membangun skemanya dari berkas itu.')
  process.exit(1)
}

const migrasi = readdirSync(DIR)
  .filter((n) => n.startsWith('migration_') && n.endsWith('.sql'))
  .map((n) => ({ path: `supabase/${n}`, isi: readFileSync(join(DIR, n), 'utf8') }))

const { kurang, dikecualikan } = periksaSkemaTerkini(migrasi, readFileSync(DUMP, 'utf8'))
console.log(`[skema-terkini] Memeriksa ${migrasi.length} berkas migrasi terhadap supabase/schema.sql.`)
console.log(laporanSkemaTerkini(kurang, dikecualikan))

if (kurang.length) {
  console.error(`::error::${kurang.length} berkas migrasi memuat objek yang tidak ada di supabase/schema.sql.`)
  process.exit(1)
}
