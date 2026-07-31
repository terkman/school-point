import { describe, expect, it } from 'vitest'
import { isActiveDirectoryAdmin } from '../supabase/functions/_shared/directoryAuthorization'

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
})
