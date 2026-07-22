import type { DeductionScope } from './dataActions'
import type { PositiveBehaviorRule, Student } from './domain'

export interface DeductionTargetSelection {
  scope: DeductionScope
  students: Student[]
  singleStudentId?: string
  selectedStudentIds?: Iterable<string>
  classroomId?: string
}

export interface PositivePointsValidation {
  valid: boolean
  points: number | null
  message?: string
}

export function resolveDeductionTargets(selection: DeductionTargetSelection): Student[] {
  const activeStudents = selection.students.filter((student) => student.status === 'active')

  if (selection.scope === 'single') {
    return activeStudents.filter((student) => student.id === selection.singleStudentId)
  }

  if (selection.scope === 'classroom') {
    return activeStudents.filter((student) => student.classroomId === selection.classroomId)
  }

  const selectedIds = new Set(selection.selectedStudentIds ?? [])
  return activeStudents.filter((student) => selectedIds.has(student.id))
}

export function validatePositiveRulePoints(
  rule: PositiveBehaviorRule | undefined,
  requestedPoints: number,
): PositivePointsValidation {
  if (!rule || !rule.active) {
    return { valid: false, points: null, message: 'กรุณาเลือกเกณฑ์การเพิ่มคะแนนที่ยังใช้งานอยู่' }
  }

  if (!rule.discretionary) {
    if (rule.defaultPoints === null) {
      return { valid: false, points: null, message: 'เกณฑ์นี้ยังไม่ได้กำหนดคะแนน' }
    }
    if (requestedPoints !== rule.defaultPoints) {
      return {
        valid: false,
        points: rule.defaultPoints,
        message: `เกณฑ์นี้กำหนดไว้ ${rule.defaultPoints} คะแนน`,
      }
    }
    return { valid: true, points: rule.defaultPoints }
  }

  if (!Number.isInteger(requestedPoints) || requestedPoints < 1 || requestedPoints > rule.maxPoints) {
    return {
      valid: false,
      points: null,
      message: `กรุณาระบุคะแนนตั้งแต่ 1 ถึง ${rule.maxPoints}`,
    }
  }

  return { valid: true, points: requestedPoints }
}

export function toLocalDateTimeInputValue(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function localDateTimeToIso(value: string): string | null {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}
