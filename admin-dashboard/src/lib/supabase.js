import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured =
  Boolean(url && anonKey) && !url.includes('xxxxxxxx') && !anonKey.includes('anon-public')

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Sesi admin disimpan di key terpisah agar tidak bentrok dengan aplikasi
        // utama bila kebetulan dibuka di origin yang sama.
        storageKey: 'bukupintar-admin-auth',
      },
    })
  : null
