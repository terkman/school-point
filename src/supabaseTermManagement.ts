import type { SupabaseClient } from '@supabase/supabase-js'
import type { MutationSyncWarning } from './dataActions'
import type {
  AcademicTermSummary, RemediationCase, RemediationRequestSummary,
  TermHistory, TermLedgerEntry, TermManagementActions, TermTransitionPreview,
} from './termManagement'

type JsonRow = Record<string, unknown>
type Result<M extends keyof TermManagementActions> = Awaited<ReturnType<TermManagementActions[M]>>

function row(value: unknown): JsonRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('รูปแบบข้อมูลภาคเรียนไม่ถูกต้อง')
  return value as JsonRow
}
function rows(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('รูปแบบรายการข้อมูลภาคเรียนไม่ถูกต้อง')
  return value
}
function id(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  throw new Error('ไม่พบรหัสข้อมูลภาคเรียน')
}
function optionalId(value: unknown): string | undefined { return value == null ? undefined : id(value) }
function text(value: unknown): string { return typeof value === 'string' ? value : '' }
function optionalText(value: unknown): string | undefined { return text(value) || undefined }
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('ข้อมูลจำนวนหรือคะแนนภาคเรียนไม่ถูกต้อง')
  return value
}
function score(value: unknown): number {
  const result = number(value)
  if (result < 0 || result > 100) throw new Error('คะแนนภาคเรียนอยู่นอกช่วง 0–100')
  return result
}
function fullName(value: JsonRow): string {
  return text(value.name) || `${text(value.title)}${text(value.givenName)} ${text(value.familyName)}`.trim()
}
function status<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (allowed.includes(value as T)) return value as T
  throw new Error('สถานะข้อมูลภาคเรียนไม่ถูกต้อง')
}
function term(value: unknown): AcademicTermSummary {
  const item = row(value)
  return {
    id: id(item.id), schoolYear: number(item.schoolYear), semester: number(item.semester),
    name: text(item.name), startsOn: optionalText(item.startsOn), endsOn: optionalText(item.endsOn),
    status: status(item.status, ['planned', 'active', 'closed']),
    closedAt: optionalText(item.closedAt), nextTermId: optionalId(item.nextTermId),
  }
}
function ledger(value: unknown): TermLedgerEntry {
  const item = row(value)
  return {
    id: id(item.id), termId: id(item.termId), entryType: text(item.entryType),
    requestedDelta: number(item.requestedDelta), appliedDelta: number(item.appliedDelta),
    balanceBefore: score(item.balanceBefore), balanceAfter: score(item.balanceAfter),
    reason: text(item.reason), incidentId: optionalId(item.incidentId),
    remediationRequestId: optionalId(item.remediationRequestId),
    activityOccurredAt: optionalText(item.activityOccurredAt), createdAt: text(item.createdAt),
  }
}
export function normalizeTermHistory(value: unknown): TermHistory {
  const item = row(value)
  return {
    term: term(item.term), threshold: score(item.threshold), closedAt: optionalText(item.closedAt),
    students: rows(item.students).map(value => {
      const student = row(value)
      const classroom = student.classroom == null ? undefined : row(student.classroom)
      const remediation = student.remediation == null ? undefined : row(student.remediation)
      return {
        studentId: id(student.studentId), studentCode: text(student.studentCode), name: fullName(student),
        nickname: optionalText(student.nickname), studentStatus: text(student.status),
        classroomName: classroom ? optionalText(classroom.name) : undefined,
        gradeLevel: classroom ? optionalText(classroom.gradeLevel) : undefined,
        roomNumber: classroom ? optionalText(classroom.roomNumber) : undefined,
        enrolled: student.enrolled === true,
        latestScore: student.latestScore == null ? null : score(student.latestScore),
        closingScore: student.closingScore == null ? null : score(student.closingScore),
        threshold: score(student.threshold),
        remediation: remediation ? {
          caseId: id(remediation.caseId), status: status(remediation.status, ['open', 'passed']),
          passedAt: optionalText(remediation.passedAt),
        } : undefined,
        history: rows(student.history).map(ledger),
      }
    }),
  }
}
function remediationRequest(value: unknown): RemediationRequestSummary {
  const item = row(value)
  return {
    id: id(item.id), requestedPoints: number(item.requestedPoints),
    approvedPoints: item.approvedPoints == null ? undefined : number(item.approvedPoints),
    activityOccurredAt: text(item.activityOccurredAt), reason: optionalText(item.reason),
    status: status(item.status, ['pending', 'approved', 'rejected']), createdAt: text(item.createdAt),
    reviewedAt: optionalText(item.reviewedAt), reviewNote: optionalText(item.reviewNote),
    ledgerId: optionalId(item.ledgerId), requestedByMe: item.requestedByMe === true,
    requestedBySnapshot: optionalText(item.requestedBySnapshot),
  }
}
export function normalizeTermRemediations(value: unknown): RemediationCase[] {
  return rows(value).map(value => {
    const item = row(value), student = row(item.student)
    const classroom = item.currentClassroom == null ? undefined : row(item.currentClassroom)
    return {
      caseId: id(item.caseId), sourceTerm: term(item.sourceTerm),
      student: { id: id(student.id), studentCode: text(student.studentCode), name: fullName(student),
        nickname: optionalText(student.nickname), status: text(student.status) },
      currentClassroomName: classroom ? optionalText(classroom.name) : undefined,
      closingScore: score(item.closingScore), currentScore: score(item.currentScore),
      threshold: score(item.threshold), pointsNeeded: number(item.pointsNeeded),
      status: status(item.status, ['open', 'passed']), passedAt: optionalText(item.passedAt),
      openedAt: text(item.openedAt), responsibleTeacherId: optionalId(item.responsibleTeacherId),
      pendingRequestCount: number(item.pendingRequestCount),
      requests: rows(item.requests).map(remediationRequest), changesSinceClose: rows(item.changesSinceClose).map(ledger),
    }
  })
}
function preview(value: unknown): TermTransitionPreview {
  const item = row(value), counts = row(item.counts)
  return {
    currentTermId: optionalId(item.currentTermId), nextTermId: id(item.nextTermId), threshold: score(item.threshold),
    canTransition: item.canTransition === true, blockers: rows(item.blockers).map(text),
    counts: {
      currentStudents: number(counts.currentEnrolled), belowThreshold: number(counts.expectedRemediationCases),
      pendingAdditionRequests: number(counts.pendingAdditionRequests), pendingDeductionRequests: number(counts.pendingDeductionRequests),
      pendingAppeals: number(counts.pendingAppeals), openAppealWindows: number(counts.openAppealWindows),
      nextEnrolled: number(counts.nextEnrolled), notCarriedOver: number(counts.studentsNotCarriedOver),
      openRemediationCases: number(counts.openRemediationCases),
    },
    students: rows(item.students).map(value => {
      const student = row(value)
      return { studentId: id(student.studentId), studentCode: text(student.studentCode), name: fullName(student),
        classroomName: optionalText(student.classroomName), balance: student.balance == null ? null : score(student.balance),
        belowThreshold: student.belowThreshold === true, carriedToNextTerm: student.carriedToNextTerm === true }
    }),
  }
}

/** Keep a completed write distinct from a failed follow-up screen refresh. */
export function createSupabaseTermActions(
  client: SupabaseClient,
  refresh: () => Promise<void>,
  onSyncWarning?: (warning: MutationSyncWarning) => void,
): TermManagementActions {
  async function read<T>(name: string, parameters: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await client.rpc(name, parameters)
    if (error) throw new Error(error.message)
    if (data === null || data === undefined) throw new Error('ฐานข้อมูลไม่ได้ส่งผลการดำเนินการภาคเรียนกลับมา')
    return data as T
  }

  async function mutate<T extends object>(name: string, parameters: Record<string, unknown>): Promise<T> {
    const result = await read<T>(name, parameters)
    try {
      await refresh()
    } catch (error) {
      const syncWarning: MutationSyncWarning = {
        code: 'refresh_failed',
        message: error instanceof Error ? error.message : 'บันทึกสำเร็จ แต่โหลดข้อมูลล่าสุดไม่สำเร็จ',
      }
      onSyncWarning?.(syncWarning)
      Object.assign(result, { syncWarning })
    }
    return result
  }

  return {
    listAcademicTerms: async () => rows(await read('list_academic_terms_v1')).map(term),
    getTermHistory: async (termId, studentId) => normalizeTermHistory(await read('get_term_history_v1', {
      p_term_id: termId, p_student_id: studentId ?? null,
    })),
    listTermRemediations: async () => normalizeTermRemediations(await read('list_term_remediations_v1')),
    prepareNextTerm: async (input) => {
      const result = await mutate<JsonRow>('admin_prepare_next_term_v1', {
      p_school_year: input.schoolYear,
      p_semester: input.semester,
      p_name: input.name,
      p_starts_on: input.startsOn,
      p_ends_on: input.endsOn,
      })
      return { ...result, ok: result.ok === true, replayed: result.replayed === true,
        termId: id(row(result.term).id), sourceTermId: id(result.sourceTermId),
        classroomCount: number(result.classroomCount), enrollmentCount: number(result.enrollmentCount),
        assignmentCount: number(result.assignmentCount) } as Result<'prepareNextTerm'>
    },
    previewTermTransition: async (nextTermId) => preview(await read('admin_preview_term_transition_v1', { p_next_term_id: nextTermId })),
    transitionTerm: async (input) => {
      const result = await mutate<JsonRow>('admin_transition_term_v1', {
      p_current_term_id: input.currentTermId,
      p_next_term_id: input.nextTermId,
      p_client_request_id: input.clientRequestId,
      })
      return { ...result, ok: result.ok === true, replayed: result.replayed === true,
        transitionId: id(result.transitionId), closedTermId: id(result.closedTermId), activeTermId: id(result.activeTermId),
        snapshotCount: number(result.snapshotCount), remediationCaseCount: number(result.remediationCaseCount),
        initializedAccounts: number(result.initializedAccountCount), threshold: score(result.threshold) } as Result<'transitionTerm'>
    },
    requestTermRemediation: async (input) => {
      const result = await mutate<JsonRow>('request_term_remediation_v1', {
      p_case_id: input.caseId,
      p_points: input.points,
      p_activity_occurred_at: input.activityOccurredAt,
      p_reason: input.reason,
      p_client_request_id: input.clientRequestId,
      })
      return { ...result, ok: result.ok === true, replayed: result.replayed === true,
        requestId: id(result.requestId), caseId: id(result.caseId),
        status: status(result.status, ['pending', 'approved', 'rejected']) } as Result<'requestTermRemediation'>
    },
    reviewTermRemediation: async (input) => {
      const result = await mutate<JsonRow>('review_term_remediation_v1', {
      p_request_id: input.requestId,
      p_approve: input.approve,
      p_review_note: input.note ?? null,
      p_client_request_id: input.clientRequestId,
      })
      return { ...result, ok: result.ok === true, replayed: result.replayed === true, requestId: id(result.requestId),
        status: status(result.status, ['approved', 'rejected']), caseStatus: status(result.caseStatus, ['open', 'passed']),
        appliedPoints: result.appliedPoints == null ? undefined : number(result.appliedPoints),
        balanceBefore: result.balanceBefore == null ? undefined : score(result.balanceBefore),
        balanceAfter: result.balanceAfter == null ? undefined : score(result.balanceAfter),
        ledgerId: optionalId(result.ledgerId) } as Result<'reviewTermRemediation'>
    },
  }
}
