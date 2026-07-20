import { test as setup, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// Login SATU KALI, simpan sesinya, lalu dipakai ulang oleh seluruh test
// ter-login. Tanpa ini setiap test akan login sendiri dan berisiko menabrak
// batas laju (rate limit) endpoint auth Supabase — sumber flaky yang klasik.
export const STATE_FILE = 'e2e/.auth/user.json'

const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD

setup('login sekali dan simpan sesi', async ({ page }) => {
  mkdirSync(dirname(STATE_FILE), { recursive: true })

  // Tanpa kredensial: tulis state kosong agar proyek test tetap bisa jalan
  // (test ter-loginnya sendiri akan melewati diri sendiri / skip).
  if (!EMAIL || !PASSWORD) {
    writeFileSync(STATE_FILE, JSON.stringify({ cookies: [], origins: [] }))
    setup.skip(true, 'E2E_EMAIL / E2E_PASSWORD belum diset — melewati login.')
    return
  }

  await page.goto('/masuk')
  await page.locator('#login-email').fill(EMAIL)
  await page.locator('#login-password').fill(PASSWORD)
  await page.getByRole('button', { name: /^Masuk$|^Sign in$/i }).click()

  await page.waitForURL('**/app**', { timeout: 20_000 })
  await expect(page.locator('main#main-content')).toBeVisible()

  await page.context().storageState({ path: STATE_FILE })
})
