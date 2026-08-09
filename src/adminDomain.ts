export const MIN_DEDUCTION_POINTS = 1
export const MAX_SCORE = 100
export const DEDUCTION_APPROVAL_THRESHOLD = 10

export type AdminSeverity = 'low' | 'medium' | 'serious' | 'critical'

export type PermissionBundle =
  | 'teacher'
  | 'discipline'
  | 'executive_read_only'
  | 'data_manager'
  | 'admin'

export type PermissionScope =
  | { type: 'school' }
  | { type: 'classrooms'; termId: string; classroomIds: string[] }

export type StudentLifecycleStatus = 'active' | 'suspended' | 'graduated' | 'archived'

export type PaperDocumentType =
  | 'behavior_score_summary'
  | 'score_appeal_form'
  | 'appeal_decision_notice'

export type PaperDocumentStatus =
  | 'generated'
  | 'printed'
  | 'received'
  | 'delivered'
  | 'delivery_failed'
  | 'voided'

export type PaperDocumentEventType = PaperDocumentStatus | 'paper_appeal_entered'

export function assertDeductionPoints(points: number): void {
  if (!Number.isInteger(points) || points < MIN_DEDUCTION_POINTS || points > MAX_SCORE) {
    throw new RangeError('คะแนนตัดต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 100')
  }
}

export function severityFromDeductionPoints(points: number): AdminSeverity {
  assertDeductionPoints(points)
  if (points <= 9) return 'low'
  if (points <= 24) return 'medium'
  if (points <= 54) return 'serious'
  return 'critical'
}

export function requiresDeductionApproval(points: number): boolean {
  assertDeductionPoints(points)
  return points >= DEDUCTION_APPROVAL_THRESHOLD
}

export function normalizePermissionScope(scope: PermissionScope): PermissionScope {
  if (scope.type === 'school') return scope
  const termId = scope.termId.trim()
  const classroomIds = [...new Set(scope.classroomIds.map((id) => id.trim()).filter(Boolean))]
  if (!termId || classroomIds.length === 0) {
    throw new Error('สิทธิ์แบบเลือกห้องต้องมีภาคเรียนและอย่างน้อยหนึ่งห้อง')
  }
  return { type: 'classrooms', termId, classroomIds }
}
