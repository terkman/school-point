import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (client) return client
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!url || !anonKey) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  return client
}

export const dataMode = import.meta.env.VITE_DATA_MODE === 'supabase' ? 'supabase' : 'demo'

const USERNAME_PATTERN = /^[a-z0-9._-]+$/
const DEFAULT_AUTH_EMAIL_DOMAIN = 'accounts.school-point.invalid'

export function normalizeUsername(username: string): string {
  const normalized = username.trim().toLowerCase()
  if (!normalized || normalized.length > 64 || !USERNAME_PATTERN.test(normalized)) {
    throw new Error('ชื่อผู้ใช้ใช้ได้เฉพาะ a-z, 0-9, จุด, ขีดกลาง และขีดล่าง')
  }
  if (normalized.startsWith('.') || normalized.endsWith('.') || normalized.includes('..')) {
    throw new Error('ชื่อผู้ใช้ไม่สามารถขึ้นต้น ลงท้าย หรือมีจุดติดกันได้')
  }
  return normalized
}

export function usernameToInternalEmail(username: string, configuredDomain?: string): string {
  const normalized = normalizeUsername(username)
  const domain = (configuredDomain ?? import.meta.env.VITE_SUPABASE_AUTH_EMAIL_DOMAIN ?? DEFAULT_AUTH_EMAIL_DOMAIN)
    .trim()
    .toLowerCase()
  if (!/^[a-z0-9.-]+$/.test(domain) || domain.startsWith('.') || domain.endsWith('.') || !domain.includes('.')) {
    throw new Error('VITE_SUPABASE_AUTH_EMAIL_DOMAIN ไม่ถูกต้อง')
  }
  return `${normalized}@${domain}`
}
