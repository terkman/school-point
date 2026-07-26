import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TermScheduleForm } from './AdminDashboard'
import { createDemoState } from './demoData'

describe('admin academic-term activation', () => {
  it('requires an explicit confirmation before enabling a planned term', () => {
    const demo = createDemoState()
    const term = {
      ...demo.term,
      isActive: false,
      startsOn: '2026-05-18',
      endsOn: '2026-10-09',
    }

    const markup = renderToStaticMarkup(createElement(TermScheduleForm, {
      term,
      busy: false,
      activating: false,
      onSave: async () => undefined,
      onActivate: async () => undefined,
    }))

    expect(markup).toContain('เตรียมเปิดใช้')
    expect(markup).toContain('เปิดใช้งานภาคเรียน')
    expect(markup).toContain('ยืนยันว่าตรวจสอบวันเปิด–ปิด')
    expect(markup).toContain('type="checkbox"')
  })
})
