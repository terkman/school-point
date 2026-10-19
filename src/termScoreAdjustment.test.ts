import { describe, expect, it } from 'vitest'
import { createDemoState } from './demoData'
import { demoPrepareNextTerm, demoTransitionTerm } from './termManagement'
import { applyScoreDeltaInTerm } from './termScoreAdjustment'

function transitioned(closingScore = 70) {
  let state = createDemoState()
  state.term = { ...state.term, startsOn: '2026-05-01', endsOn: '2026-10-01' }
  state.students[0]!.score = closingScore
  state.additionRequests = []
  state.deductionRequests = []
  const admin = state.accounts.find(item => item.role === 'admin')!
  const sourceTermId = state.term.id
  const prepared = demoPrepareNextTerm(state, admin, { schoolYear: 2569, semester: 2, name: 'ภาคเรียนที่ 2/2569', startsOn: '2026-11-01', endsOn: '2027-03-01' })
  state = demoTransitionTerm(prepared.state, admin, { currentTermId: sourceTermId, nextTermId: prepared.result.termId, clientRequestId: 'e992f3f1-a116-4898-a571-de2c741de90d' }).state
  state.students[0]!.score = 95
  return { state, sourceTermId, studentId: state.students[0]!.id }
}

describe('original-term appeal adjustments', () => {
  it('changes the old account and remediation status while retaining the closing and active balances', () => {
    const { state, sourceTermId, studentId } = transitioned()
    const updated = applyScoreDeltaInTerm(state, studentId, sourceTermId, 10, '2026-11-02T03:00:00Z')
    expect(updated.change).toMatchObject({ before: 70, after: 80, appliedDelta: 10 })
    expect(updated.state.students[0]!.score).toBe(95)
    expect(updated.state.termRecords!.snapshots.find(item => item.studentId === studentId)).toMatchObject({ closingScore: 70, latestScore: 80 })
    expect(updated.state.termRecords!.cases.find(item => item.studentId === studentId)!.status).toBe('passed')
    expect(state.termRecords!.snapshots.find(item => item.studentId === studentId)!.latestScore).toBe(70)
  })

  it('creates an outstanding case when a later corrected decision drops a previously passing closing balance below 80', () => {
    const { state, sourceTermId, studentId } = transitioned(80)
    expect(state.termRecords!.cases.some(item => item.studentId === studentId)).toBe(false)
    const updated = applyScoreDeltaInTerm(state, studentId, sourceTermId, -10, '2026-11-03T03:00:00Z')
    expect(updated.state.termRecords!.cases.find(item => item.studentId === studentId)).toMatchObject({ closingScore: 80, threshold: 80, status: 'open' })
    expect(updated.state.students[0]!.score).toBe(95)
    expect(updated.state.termRecords!.snapshots.find(item => item.studentId === studentId)).toMatchObject({ closingScore: 80, latestScore: 70 })
  })

  it('does not silently apply an old appeal to the current score when its historical account is missing', () => {
    const { state, studentId } = transitioned()
    expect(() => applyScoreDeltaInTerm(state, studentId, 'unknown-old-term', 10, '2026-11-03T03:00:00Z')).toThrow('ไม่พบยอดคะแนน')
    expect(state.students[0]!.score).toBe(95)
  })
})
