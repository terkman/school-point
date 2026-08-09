import { describe, expect, it } from 'vitest'
import {
  additionDecisionNeedsReason,
  guardianOutcomeClosesNotification,
  guardianReminderDueAt,
  validateAdditionDecision,
  validateAppealDecision,
} from './adminWorkflows'

describe('admin review decisions', () => {
  it('allows unchanged approval without a reason, but requires one for rejection or adjustment', () => {
    expect(additionDecisionNeedsReason(true, 5, 5)).toBe(false)
    expect(validateAdditionDecision({ approve: true, requestedPoints: 5, approvedPoints: 5, note: '' })).toBe('')
    expect(validateAdditionDecision({ approve: true, requestedPoints: 5, approvedPoints: 3, note: '' })).toContain('ปรับคะแนน')
    expect(validateAdditionDecision({ approve: false, requestedPoints: 5, approvedPoints: 5, note: '' })).toContain('ปฏิเสธ')
  })

  it('requires a public explanation and supports partial restoration', () => {
    expect(validateAppealDecision({ accepted: true, restoredPoints: 4, maximumRestorablePoints: 10, explanation: 'คืนคะแนนบางส่วนตามหลักฐาน' })).toBe('')
    expect(validateAppealDecision({ accepted: false, restoredPoints: 0, maximumRestorablePoints: 10, explanation: '' })).toContain('คำชี้แจง')
  })
})

describe('guardian contact outcomes', () => {
  it('closes only on answered calls or messages that were read/replied', () => {
    expect(guardianOutcomeClosesNotification('phone', 'answered')).toBe(true)
    expect(guardianOutcomeClosesNotification('phone', 'unanswered')).toBe(false)
    expect(guardianOutcomeClosesNotification('line', 'sent_waiting')).toBe(false)
    expect(guardianOutcomeClosesNotification('messenger', 'read_or_replied')).toBe(true)
    expect(guardianOutcomeClosesNotification('sms', 'sent_waiting')).toBe(false)
    expect(guardianOutcomeClosesNotification('sms', 'sent')).toBe(false)
    expect(guardianOutcomeClosesNotification('sms', 'read_or_replied')).toBe(true)
  })

  it('schedules the next reminder after 24 hours', () => {
    expect(guardianReminderDueAt('2026-08-03T00:00:00.000Z').toISOString()).toBe('2026-08-04T00:00:00.000Z')
  })
})
