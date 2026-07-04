import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dashboard admin berjalan di port terpisah (5174) dari aplikasi utama (5173).
// Keduanya tetap "localhost" tapi terhubung ke database Supabase yang sama (online).
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: false },
})
