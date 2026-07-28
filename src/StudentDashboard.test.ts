import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDemoState } from './demoData'
import { PROFILE_AVATARS } from './profileAvatars'
import { StudentDashboard } from './StudentDashboard'

describe('student profile settings', () => {
  it('renders ten selectable cartoon avatars and a private upload control', () => {
    const demo = createDemoState()
    const account = demo.accounts.find((item) => item.role === 'student')
    if (!account) throw new Error('Student demo account is missing')

    const markup = renderToStaticMarkup(createElement(StudentDashboard, {
      account,
      state: demo,
      initialTab: 'profile',
      onChange: () => undefined,
      onLogout: () => undefined,
    }))

    expect(markup).toContain('รูปโปรไฟล์ของฉัน')
    expect(markup).toContain('ตัวละครชาย')
    expect(markup).toContain('ตัวละครหญิง')
    expect(markup).toContain('แตะรูปที่ต้องการ แล้วซูม ย่อ หรือเลื่อนตำแหน่งก่อนกดใช้รูปนี้')
    expect(markup).toContain('เลือกรูปจากเครื่อง')
    expect(markup).toContain('ซูม ย่อ และเลื่อนตำแหน่งก่อนบันทึกได้')
    expect(markup).toContain('นักเรียนเข้าถึงได้เฉพาะรูปของตนเอง')
    for (const avatar of PROFILE_AVATARS) expect(markup).toContain(avatar.src)
  })
})
