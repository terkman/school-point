import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LoginPage } from './LoginPage'

describe('login password visibility', () => {
  it('adds a show-password control to the normal login form', () => {
    const markup = renderToStaticMarkup(createElement(LoginPage, {
      mode: 'supabase',
      onAuthenticate: async () => undefined,
      onActivate: async () => undefined,
    }))

    expect(markup).toContain('type="password"')
    expect(markup).toContain('แสดงรหัสผ่าน')
    expect(markup).toContain('aria-pressed="false"')
  })
})
