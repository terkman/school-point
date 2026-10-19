import { applyScoreDelta, createId, type DemoState } from './domain'
import { ensureTermRecords, remediationStatusFor, type DemoRemediationCase } from './termManagement'

/** Post a demo adjustment to its source term, including late appeal decisions. */
export function applyScoreDeltaInTerm(
  state: DemoState,
  studentId: string,
  termId: string,
  delta: number,
  occurredAt: string,
) {
  if (termId === state.term.id) {
    const student = state.students.find(item => item.id === studentId)
    if (!student) throw new Error('ไม่พบข้อมูลคะแนนนักเรียนในภาคเรียนปัจจุบัน')
    const change = applyScoreDelta(student.score, delta)
    return { change, state: { ...state, students: state.students.map(item => item.id === studentId ? { ...item, score: change.after } : item) } }
  }

  const records = ensureTermRecords(state)
  const snapshot = records.snapshots.find(item => item.termId === termId && item.studentId === studentId)
  if (!snapshot) throw new Error('ไม่พบยอดคะแนนของภาคเรียนต้นเรื่อง กรุณาตรวจสอบประวัติก่อนพิจารณา')
  const change = applyScoreDelta(snapshot.latestScore, delta)
  const existingCase = records.cases.find(item => item.sourceTermId === termId && item.studentId === studentId)
  const caseStatus = remediationStatusFor(change.after, snapshot.threshold)
  let cases: DemoRemediationCase[] = records.cases
  if (existingCase) {
    cases = cases.map(item => item.id === existingCase.id ? {
      ...item, status: caseStatus,
      passedAt: caseStatus === 'passed' ? item.passedAt ?? occurredAt : undefined,
    } : item)
  } else if (caseStatus === 'open') {
    cases = [...cases, {
      id: createId('term-remediation'), sourceTermId: termId, studentId,
      closingScore: snapshot.closingScore, threshold: snapshot.threshold,
      status: 'open', openedAt: occurredAt,
    }]
  }
  return {
    change,
    state: {
      ...state,
      termRecords: {
        ...records, cases,
        snapshots: records.snapshots.map(item => item === snapshot ? { ...item, latestScore: change.after } : item),
      },
    },
  }
}
