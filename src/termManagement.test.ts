import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { createDemoState } from './demoData'
import { TermWorkspace } from './TermWorkspace'
import {
  demoGetTermHistory, demoListTermRemediations, demoPrepareNextTerm,
  demoRequestTermRemediation, demoReviewTermRemediation, demoTransitionTerm,
} from './termManagement'

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
function setup() {
  const state = createDemoState()
  state.term = { ...state.term, startsOn: day(-90), endsOn: day(-1) }
  state.students = state.students.map((item, index) => ({ ...item, score: index ? 100 : 70 }))
  state.additionRequests = []
  state.deductionRequests = []
  const admin = state.accounts.find(item => item.role === 'admin')!
  const teacher = state.accounts.find(item => item.role === 'teacher')!
  const input = { schoolYear: 2569, semester: 2, name: 'ภาคเรียนที่ 2/2569', startsOn: day(0), endsOn: day(90) }
  const prepared = demoPrepareNextTerm(state, admin, input)
  const transitionInput = { currentTermId: state.term.id, nextTermId: prepared.result.termId, clientRequestId: '018071dc-f0ed-41a5-b176-46adc61d6da1' }
  return { state, admin, teacher, input, prepared, transitionInput }
}

describe('semester lifecycle and remediation policy', () => {
  it('replays preparation and transition without duplicating snapshots, opening entries, or cases', () => {
    const { admin, input, prepared, transitionInput } = setup()
    const replayPrepare = demoPrepareNextTerm(prepared.state, admin, input)
    expect(replayPrepare.result.replayed).toBe(true)
    const first = demoTransitionTerm(replayPrepare.state, admin, transitionInput)
    const replay = demoTransitionTerm(first.state, admin, transitionInput)
    expect(replay.result.replayed).toBe(true)
    expect(replay.state).toBe(first.state)
    expect(first.state.termRecords!.cases).toHaveLength(1)
    expect(first.state.transactions.filter(item => item.termId === transitionInput.nextTermId)).toHaveLength(first.state.students.length)
    expect(() => demoTransitionTerm(first.state, admin, { ...transitionInput, nextTermId: 'different-term' })).toThrow()
  })

  it('blocks pending ordinary requests before recording any closing snapshots', () => {
    const { admin, prepared, transitionInput } = setup()
    const blocked = { ...prepared.state, additionRequests: createDemoState().additionRequests }
    expect(() => demoTransitionTerm(blocked, admin, transitionInput)).toThrow('คำขอเพิ่มคะแนน')
    expect(blocked.term.id).toBe(transitionInput.currentTermId)
    expect(blocked.termRecords!.snapshots).toHaveLength(0)
  })

  it('caps original-term credits at 100 and never re-applies the approved request or changes the new term', () => {
    const { admin, teacher, prepared, transitionInput } = setup()
    const closed = demoTransitionTerm(prepared.state, admin, transitionInput).state
    closed.students[0]!.score = 95
    const sourceCase = closed.termRecords!.cases[0]!
    const creditInput = { caseId: sourceCase.id, points: 50,
      activityOccurredAt: new Date().toISOString(), reason: 'ทำกิจกรรมจิตอาสาตามแผนครบแล้ว', clientRequestId: '3913d844-0b18-4765-b254-729809d8faac' }
    const request = demoRequestTermRemediation(closed, teacher, creditInput)
    expect(() => demoRequestTermRemediation(request.state, teacher, { caseId: sourceCase.id, points: 10,
      activityOccurredAt: new Date().toISOString(), reason: 'ขอเพิ่มซ้ำระหว่างรออนุมัติ', clientRequestId: '6902c2dd-99b7-4f48-8931-a5b9fb12977e' })).toThrow()
    const decision = { requestId: request.result.requestId, approve: true, clientRequestId: '705141ee-fe28-42f0-9be4-34fc0ccdbdd3' }
    const approved = demoReviewTermRemediation(request.state, admin, decision)
    expect(approved.result).toMatchObject({ appliedPoints: 30, balanceBefore: 70, balanceAfter: 100, caseStatus: 'passed' })
    expect(approved.state.students[0]!.score).toBe(95)
    expect(approved.state.termRecords!.snapshots[0]).toMatchObject({ closingScore: 70, latestScore: 100 })
    expect(demoReviewTermRemediation(approved.state, admin, decision).state).toBe(approved.state)
    expect(demoRequestTermRemediation(approved.state, teacher, creditInput).result).toMatchObject({ replayed: true, status: 'approved' })
  })

  it('restricts student histories to their own records and retains departed pupils for the admin', () => {
    const { admin, prepared, transitionInput } = setup()
    const closed = demoTransitionTerm(prepared.state, admin, transitionInput).state
    const student = closed.accounts.find(item => item.role === 'student')!
    expect(demoGetTermHistory(closed, student, transitionInput.currentTermId).students.map(item => item.studentId)).toEqual([student.studentId])
    const departed = closed.students.shift()!
    expect(demoListTermRemediations(closed, admin)[0]!.student.id).toBe(departed.id)
    expect(demoGetTermHistory(closed, admin, transitionInput.currentTermId).students.some(item => item.studentId === departed.id)).toBe(true)
  })

  it('shows an unavailable server explicitly instead of silently rendering a demo implementation', () => {
    const state = createDemoState()
    const account = state.accounts.find(item => item.role === 'admin')!
    const markup = renderToStaticMarkup(createElement(TermWorkspace, { account, termActions: null }))
    expect(markup).toContain('ระบบภาคเรียนยังไม่พร้อมใช้งาน')
    expect(markup).not.toContain('เตรียมภาคเรียนถัดไป')
  })
})
