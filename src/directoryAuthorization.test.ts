import { describe, expect, it } from 'vitest'
import {
  isActiveDirectoryAdmin,
  tokenHasPasswordAuthentication,
} from '../supabase/functions/_shared/directoryAuthorization'

function accessTokenWithAmr(method: string): string {
  const payload = btoa(JSON.stringify({ amr: [{ method, timestamp: 1 }] }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `header.${payload}.signature`
}

describe('school directory authorization', () => {
  it('allows only an active admin whose first activation is complete', () => {
    expect(isActiveDirectoryAdmin({
      role: 'admin',
      is_active: true,
      activation_required: false,
    })).toBe(true)

    expect(isActiveDirectoryAdmin({
      role: 'teacher',
      is_active: true,
      activation_required: false,
    })).toBe(false)
    expect(isActiveDirectoryAdmin({
      role: 'admin',
      is_active: false,
      activation_required: false,
    })).toBe(false)
    expect(isActiveDirectoryAdmin({
      role: 'admin',
      is_active: true,
      activation_required: true,
    })).toBe(false)
    expect(isActiveDirectoryAdmin(null)).toBe(false)
  })

  it('requires password AMR for sensitive directory actions', () => {
    expect(tokenHasPasswordAuthentication(accessTokenWithAmr('password'))).toBe(true)
    expect(tokenHasPasswordAuthentication(accessTokenWithAmr('otp'))).toBe(false)
    expect(tokenHasPasswordAuthentication('malformed-token')).toBe(false)
  })
})
