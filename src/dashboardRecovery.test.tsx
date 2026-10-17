import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AdminCaseCenter } from './AdminCaseCenter'
import { buildLocalPaperDocument } from './AdminPaperCenter'
import { severityFromDeductionPoints } from './adminDomain'
import { validateAppealDecision } from './adminWorkflows'
import { createDemoState } from './demoData'

describe('dashboard recovery regressions', () => {
  function paperFixture() {
    const state = createDemoState()
    const student = state.students[0]!
    const incident = state.transactions.find((item) => item.studentId === student.id && item.kind === 'deduction')!
    incident.reason = 'บันทึกภายในที่ไม่ควรอยู่ในเอกสาร'
    incident.internalReason = incident.reason
    incident.appealDeadline = undefined
    return { state, student, incident }
  }

  it('keeps internal notes and actor identity out of demo paper snapshots, including old demo records', () => {
    const { state, student, incident } = paperFixture()
    const document = buildLocalPaperDocument(state, student, 'score_appeal_form', incident)
    const rule = state.rules.find((item) => item.id === incident.ruleId)!
    expect(document.snapshot.incident?.reason).toBe(rule.title)
    expect(document.snapshot.transactions.find((item) => item.id === incident.id)?.reason).toBe(rule.title)
    expect(JSON.stringify(document.snapshot)).not.toContain(incident.internalReason)
    expect(JSON.stringify(document.snapshot)).not.toContain(incident.actorId)
  })

  it('redacts a legacy internal reason even if its rule is missing', () => {
    const { state, student, incident } = paperFixture()
    incident.ruleId = undefined
    const document = buildLocalPaperDocument(state, student, 'score_appeal_form', incident)
    expect(document.snapshot.incident?.reason).toBe('รายการตัดคะแนน')
    expect(JSON.stringify(document.snapshot)).not.toContain(incident.reason)
  })

  it('calculates a missing paper deadline from the incident rather than document issue time', () => {
    const { state, student, incident } = paperFixture()
    incident.occurredAt = '2026-08-01T03:00:00.000Z'
    const document = buildLocalPaperDocument(state, student, 'score_appeal_form', incident)
    expect(document.snapshot.incident?.appealDeadline).toBe('2026-08-08T03:00:00.000Z')
  })

  it('preserves a stored deadline even when it differs from incident time plus seven days', () => {
    const { state, student, incident } = paperFixture()
    incident.appealDeadline = '2026-09-12T16:59:59.000Z'
    const document = buildLocalPaperDocument(state, student, 'score_appeal_form', incident)
    expect(document.snapshot.incident?.appealDeadline).toBe(incident.appealDeadline)
  })

  it('refuses restoration for a zero-applied deduction while allowing an explanatory no-restoration decision', () => {
    const decision = { restoredPoints: 1, maximumRestorablePoints: 0, explanation: 'ชี้แจงผลตรวจสอบเหตุการณ์' }
    expect(validateAppealDecision({ ...decision, accepted: true })).toContain('ไม่มีคะแนนให้คืน')
    expect(validateAppealDecision({ ...decision, accepted: false, restoredPoints: 0 })).toBe('')
  })

  it('caps restoration at the actual deduction, including partial deductions at the score floor', () => {
    const decision = { accepted: true, maximumRestorablePoints: 3, explanation: 'คืนคะแนนตามหลักฐานที่ตรวจสอบ' }
    expect(validateAppealDecision({ ...decision, restoredPoints: 3 })).toBe('')
    expect(validateAppealDecision({ ...decision, restoredPoints: 5 })).not.toBe('')
  })

  it('matches the deployed rule severity boundaries at 49, 50 and 54 points', () => {
    expect(severityFromDeductionPoints(49)).toBe('serious')
    expect(severityFromDeductionPoints(50)).toBe('critical')
    expect(severityFromDeductionPoints(54)).toBe('critical')
  })

  it('keeps the private note available to case administrators while excluding it from paper snapshots', () => {
    const state = createDemoState()
    const currentCase = state.seriousCases[0]!
    const transaction = state.transactions.find((item) => item.id === currentCase.transactionId)!
    const student = state.students.find((item) => item.id === currentCase.studentId)!
    transaction.internalReason = 'ข้อเท็จจริงสำหรับแอดมินเท่านั้น'
    const markup = renderToStaticMarkup(createElement(AdminCaseCenter, {
      state, busyAction: '', onLoadGuardianContacts: async () => [],
      onRecordGuardianAttempt: async () => undefined, onUpdateCase: async () => undefined,
    }))
    expect(markup).toContain('บันทึกภายใน: ' + transaction.internalReason)
    const paper = buildLocalPaperDocument(state, student, 'behavior_score_summary')
    expect(JSON.stringify(paper.snapshot)).not.toContain(transaction.internalReason)
  })

  it('never describes an unneeded guardian contact as pending or completed', () => {
    const state = createDemoState()
    state.seriousCases = [{ ...state.seriousCases[0]!, guardianContactRequired: false, guardianContactStatus: 'not_required', guardianTaskId: undefined }]
    const markup = renderToStaticMarkup(createElement(AdminCaseCenter, {
      state, busyAction: '', onLoadGuardianContacts: async () => [],
      onRecordGuardianAttempt: async () => undefined, onUpdateCase: async () => undefined,
    }))
    expect(markup).toContain('ไม่ต้องแจ้งผู้ปกครอง')
    expect(markup).not.toContain('แจ้งผู้ปกครองสำเร็จแล้ว')
    expect(markup).not.toContain('รอแจ้งผู้ปกครอง')
    expect(markup).not.toContain('ครบกำหนดติดตามแล้ว')
    expect(markup).not.toContain('นัดเตือนครั้งถัดไป')
    expect(markup).not.toContain('ถึงเวลาติดตามอีกครั้ง')
    expect(markup.match(/ไม่ต้องแจ้งผู้ปกครอง/g)).toHaveLength(2)
    expect(markup).not.toContain('ช่องทางแจ้งผู้ปกครอง')
  })
})
