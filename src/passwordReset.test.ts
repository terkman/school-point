import { describe, expect, it } from 'vitest'
import {
  createTemporaryRecoveryPassword,
  passwordResetReason,
} from '../supabase/functions/_shared/passwordReset'

describe('school account password reset helpers', () => {
  it('requires an audit reason and trims it', () => {
    expect(passwordResetReason('  ผู้ใช้แจ้งว่าลืมรหัสผ่าน  ')).toBe('ผู้ใช้แจ้งว่าลืมรหัสผ่าน')
    expect(() => passwordResetReason('ลืม')).toThrow('อย่างน้อย 5 ตัวอักษร')
    expect(() => passwordResetReason('ก'.repeat(501))).toThrow('ยาวเกิน 500 ตัวอักษร')
  })

  it('creates strong, non-reusable temporary passwords without exposing them', () => {
    const first = createTemporaryRecoveryPassword()
    const second = createTemporaryRecoveryPassword()
    expect(first).toMatch(/^Sp1![A-Za-z0-9_-]{43}$/)
    expect(second).not.toBe(first)
  })
})
