import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AdminToday, guardianFollowUpLabel, isGuardianReminderDue } from './AdminToday'
import { createDemoState } from './demoData'

describe('admin today guardian reminders', () => {
  it('uses the scheduled reminder time and counts only pending cases that are due', () => {
    const now = Date.now()
    expect(isGuardianReminderDue(new Date(now - 1).toISOString(), now)).toBe(true)
    expect(isGuardianReminderDue(new Date(now + 60 * 60 * 1000).toISOString(), now)).toBe(false)
    expect(isGuardianReminderDue(undefined, now)).toBe(false)
    expect(guardianFollowUpLabel(undefined, now).label).toBe('ยังไม่กำหนดเวลาติดตาม')

    const state = createDemoState()
    state.seriousCases = [
      {
        id: 'due', transactionId: state.transactions[0].id, studentId: state.students[0].id,
        severity: 'serious', status: 'open', guardianContactRequired: true,
        guardianContactStatus: 'pending', guardianNextReminderAt: new Date(now - 1).toISOString(),
        createdAt: new Date(now).toISOString(), internalNote: '',
      },
      {
        id: 'future', transactionId: state.transactions[0].id, studentId: state.students[0].id,
        severity: 'serious', status: 'open', guardianContactRequired: true,
        guardianContactStatus: 'pending', guardianNextReminderAt: new Date(now + 60 * 60 * 1000).toISOString(),
        createdAt: new Date(now - 48 * 60 * 60 * 1000).toISOString(), internalNote: '',
      },
      {
        id: 'completed', transactionId: state.transactions[0].id, studentId: state.students[0].id,
        severity: 'serious', status: 'following_up', guardianContactRequired: true,
        guardianContactStatus: 'completed', guardianNextReminderAt: new Date(now - 1).toISOString(),
        createdAt: new Date(now - 48 * 60 * 60 * 1000).toISOString(), internalNote: '',
      },
    ]

    const markup = renderToStaticMarkup(createElement(AdminToday, {
      state,
      pendingDeductions: [], pendingAdditions: [], openAppeals: [], openCases: state.seriousCases,
      onOpenScore: () => undefined, onOpenReviews: () => undefined, onOpenCases: () => undefined,
    }))

    expect(markup).toContain('ต้องติดตามวันนี้</small><strong>1</strong>')
    expect(markup).toContain('ครบกำหนดติดตาม')
    expect(markup).not.toContain('เหลือ 24 ชม.')
  })
})
