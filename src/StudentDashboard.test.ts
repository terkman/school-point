import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDemoState } from './demoData'
import { PROFILE_AVATARS } from './profileAvatars'
import { StudentAppealError, StudentDashboard, TransactionRow } from './StudentDashboard'

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

describe('student appeal safeguards', () => {
  it('renders appeal submission errors visibly and never offers an appeal for an appeal adjustment', () => {
    const errorMarkup = renderToStaticMarkup(createElement(StudentAppealError, { error: 'ส่งคำอุทธรณ์ไม่สำเร็จ' }))
    expect(errorMarkup).toContain('class="form-error"')
    expect(errorMarkup).toContain('role="alert"')
    expect(errorMarkup).not.toContain('sr-only')

    const demo = createDemoState()
    const source = demo.transactions.find((item) => item.kind === 'deduction')
    if (!source) throw new Error('Deduction demo fixture is missing')
    const adjustment = {
      ...source,
      id: 'appeal-adjustment',
      appliedDelta: -3,
      sourceAppealId: 'appeal-1',
      additionSource: 'appeal' as const,
    }
    const rowMarkup = renderToStaticMarkup(createElement(TransactionRow, {
      transaction: adjustment,
      state: demo,
      onAppeal: () => undefined,
    }))
    expect(rowMarkup).not.toContain('ยื่นอุทธรณ์')
  })
})
