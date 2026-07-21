import { describe, expect, it } from 'vitest'
import { validatePersonalPassword } from './PasswordActivationPage'

describe('first-login password activation', () => {
  it('requires at least ten characters with letters and digits', () => {
    expect(validatePersonalPassword('short1')).toContain('10')
    expect(validatePersonalPassword('onlyletters')).toContain('ตัวเลข')
    expect(validatePersonalPassword('1234567890')).toContain('ตัวอักษร')
    expect(validatePersonalPassword('Student2569')).toBeNull()
  })
})
