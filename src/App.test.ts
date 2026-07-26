import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StatusPage } from './App'

describe('status page recovery actions', () => {
  it('renders retry and logout actions together on a recoverable error', () => {
    const markup = renderToStaticMarkup(createElement(StatusPage, {
      title: 'ยังเปิดระบบไม่ได้',
      detail: 'ภาคเรียนยังไม่เปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ',
      action: { label: 'ลองโหลดใหม่', run: () => undefined },
      secondaryAction: { label: 'ออกจากระบบ', run: () => undefined },
    }))

    expect(markup).toContain('ภาคเรียนยังไม่เปิดใช้งาน')
    expect(markup).toContain('ลองโหลดใหม่')
    expect(markup).toContain('ออกจากระบบ')
    expect(markup).toContain('status-actions')
  })
})
