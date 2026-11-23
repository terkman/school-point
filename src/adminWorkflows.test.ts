import { describe, expect, it } from 'vitest'
import {
  additionDecisionNeedsReason,
  calculateAppealAdjustment,
  guardianOutcomeClosesNotification,
  guardianReminderDueAt,
  validateAdditionDecision,
  validateAppealDecision,
  validateAdminScoreAdjustment,
} from './adminWorkflows'
import type { Appeal, ScoreTransaction } from './domain'

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

  it('reconsiders an appeal from net posted points, including a legacy capped credit', () => {
    const appeal: Appeal = {
      id: 'appeal-a', studentId: 'student-a', transactionId: 'deduction-a',
      statement: 'Test appeal', status: 'reviewing', restoredPoints: 20, createdAt: '2026-10-03T04:00:00Z',
    }
    const source: ScoreTransaction = {
      id: 'deduction-a', incidentId: 'incident-a', studentId: 'student-a', termId: 'term-a',
      kind: 'deduction', requestedDelta: -20, appliedDelta: -20, scoreBefore: 100, scoreAfter: 80,
      reason: 'Test deduction', occurredAt: '2026-10-02T04:00:00Z', actorId: 'admin-a',
    }
    const credit: ScoreTransaction = {
      ...source, id: 'legacy-credit', kind: 'addition', ledgerEntryType: 'appeal_reversal',
      requestedDelta: 20, appliedDelta: 5, scoreBefore: 95, scoreAfter: 100,
    }
    const withdrawal: ScoreTransaction = {
      ...source, id: 'demo-withdrawal', incidentId: undefined, sourceAppealId: appeal.id,
      requestedDelta: -5, appliedDelta: -2, scoreBefore: 2, scoreAfter: 0,
    }
    const unrelatedCredits: ScoreTransaction[] = [
      { ...credit, id: 'different-incident', incidentId: 'incident-b' },
      { ...credit, id: 'different-student', studentId: 'student-b' },
      { ...credit, id: 'different-term', termId: 'term-b' },
      { ...credit, id: 'different-appeal', sourceAppealId: 'appeal-b' },
    ]

    expect(calculateAppealAdjustment(appeal, source, [source, ...unrelatedCredits], 20)).toBe(20)
    expect(calculateAppealAdjustment(appeal, source, [source, credit, ...unrelatedCredits], 0)).toBe(-5)
    expect(calculateAppealAdjustment(appeal, source, [source, credit, ...unrelatedCredits], 20)).toBe(15)
    expect(calculateAppealAdjustment(appeal, source, [source, credit, withdrawal, ...unrelatedCredits], 0)).toBe(-3)
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

describe('administrator score adjustments', () => {
  it('requires a signed non-zero integer, a reason, and a nonfuture date', () => {
    const now = new Date('2026-08-31T12:00:00.000Z')
    expect(validateAdminScoreAdjustment({ delta: -5, occurredAt: '2026-08-31T10:00:00.000Z', reason: 'แก้ไขยอดที่บันทึกคลาดเคลื่อน', now })).toBe('')
    expect(validateAdminScoreAdjustment({ delta: 0, occurredAt: '2026-08-31T10:00:00.000Z', reason: 'แก้ไขยอดเดิม', now })).toContain('จำนวนเต็ม')
    expect(validateAdminScoreAdjustment({ delta: 5, occurredAt: '2026-08-31T10:00:00.000Z', reason: '', now })).toContain('เหตุผล')
    expect(validateAdminScoreAdjustment({ delta: 5, occurredAt: '2026-09-01T10:00:00.000Z', reason: 'แก้ไขยอดเดิม', now })).toContain('อนาคต')
  })
})
