import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ONE_TIME_ACTIVATION_COPY,
  PasswordActivationPage,
  validatePersonalPassword,
} from './PasswordActivationPage'

describe('first-login password activation', () => {
  it('requires at least ten characters with letters and digits', () => {
    expect(validatePersonalPassword('short1')).toContain('10')
    expect(validatePersonalPassword('onlyletters')).toContain('ตัวเลข')
    expect(validatePersonalPassword('1234567890')).toContain('ตัวอักษร')
    expect(validatePersonalPassword('Student123')).toBeNull()
    expect(validatePersonalPassword('Student2569')).toBeNull()
  })

  it('describes the OTP as a one-time activation code, not a temporary password', () => {
    expect(ONE_TIME_ACTIVATION_COPY).toContain('รหัสเปิดใช้ครั้งเดียว')
    expect(ONE_TIME_ACTIVATION_COPY).not.toContain('รหัสชั่วคราว')
  })

  it('renders a password-authenticated retry without asking for the password again', () => {
    const markup = renderToStaticMarkup(createElement(PasswordActivationPage, {
      username: '69001',
      onSetPassword: async () => undefined,
      onResumeActivation: async () => undefined,
      passwordAuthenticated: true,
      onLogout: () => undefined,
    }))

    expect(markup).toContain('ยืนยันการเปิดใช้บัญชี')
    expect(markup).toContain('ยืนยันและเข้าสู่ระบบ')
    expect(markup).not.toContain('type="password"')
  })

  it('provides show-password controls for both new-password fields', () => {
    const markup = renderToStaticMarkup(createElement(PasswordActivationPage, {
      username: '69001',
      onSetPassword: async () => undefined,
      onLogout: () => undefined,
    }))

    expect(markup).toContain('แสดงรหัสผ่านใหม่')
    expect(markup).toContain('แสดงยืนยันรหัสผ่านใหม่')
    expect(markup.match(/type="password"/g)).toHaveLength(2)
  })
})
