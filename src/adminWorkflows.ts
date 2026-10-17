import type { DemoState, GuardianContactChannel, GuardianContactOutcome } from './domain'

export const MIN_REVIEW_NOTE_LENGTH = 5
export const GUARDIAN_REMINDER_HOURS = 24

export function calculateAppealAdjustment(previousRestoredPoints: number | undefined, nextRestoredPoints: number): number {
  return nextRestoredPoints - (previousRestoredPoints ?? 0)
}

export function resolveOpenCaseSelection(
  openCases: DemoState['seriousCases'],
  selectedId: string,
): string {
  return openCases.some((item) => item.id === selectedId) ? selectedId : (openCases[0]?.id ?? '')
}

export function isCurrentGuardianContactsRequest(currentRequestId: number, requestId: number): boolean {
  return currentRequestId === requestId
}

export function additionDecisionNeedsReason(approve: boolean, requestedPoints: number, approvedPoints: number): boolean {
  return !approve || requestedPoints !== approvedPoints
}

export function validateAdditionDecision(input: {
  approve: boolean
  requestedPoints: number
  approvedPoints: number
  note: string
}): string {
  if (input.approve && (!Number.isInteger(input.approvedPoints) || input.approvedPoints < 1 || input.approvedPoints > 100)) {
    return 'คะแนนที่อนุมัติต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 100'
  }
  if (additionDecisionNeedsReason(input.approve, input.requestedPoints, input.approvedPoints)
    && input.note.trim().length < MIN_REVIEW_NOTE_LENGTH) {
    return input.approve
      ? 'กรุณาระบุเหตุผลที่ปรับคะแนนอย่างน้อย 5 ตัวอักษร'
      : 'กรุณาระบุเหตุผลที่ปฏิเสธอย่างน้อย 5 ตัวอักษร'
  }
  return ''
}

export function validateAppealDecision(input: {
  accepted: boolean
  restoredPoints: number
  maximumRestorablePoints: number
  explanation: string
}): string {
  if (input.explanation.trim().length < MIN_REVIEW_NOTE_LENGTH) {
    return 'กรุณาเขียนคำชี้แจงให้นักเรียนเห็นอย่างน้อย 5 ตัวอักษร'
  }
  if (input.accepted && input.maximumRestorablePoints < 1) {
    return 'รายการนี้ไม่ได้ตัดคะแนนจริง จึงไม่มีคะแนนให้คืน'
  }
  if (input.accepted && (!Number.isInteger(input.restoredPoints)
    || input.restoredPoints < 1
    || input.restoredPoints > input.maximumRestorablePoints)) {
    return `คะแนนที่คืนต้องอยู่ระหว่าง 1–${input.maximumRestorablePoints}`
  }
  return ''
}

export function validateAdminScoreAdjustment(input: {
  delta: number
  occurredAt: string
  reason: string
  now?: Date
}): string {
  if (!Number.isInteger(input.delta) || input.delta === 0 || input.delta < -100 || input.delta > 100) {
    return 'คะแนนที่ปรับต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 100 และเลือกเพิ่มหรือลดให้ชัดเจน'
  }
  if (input.reason.trim().length < MIN_REVIEW_NOTE_LENGTH) {
    return 'กรุณาระบุเหตุผลการปรับคะแนนอย่างน้อย 5 ตัวอักษร'
  }
  const occurredAt = new Date(input.occurredAt)
  if (!input.occurredAt || !Number.isFinite(occurredAt.getTime())) {
    return 'กรุณาระบุวันที่และเวลาที่ต้องการบันทึก'
  }
  const now = input.now ?? new Date()
  if (occurredAt.getTime() > now.getTime() + 5 * 60 * 1000) {
    return 'วันที่และเวลาปรับคะแนนต้องไม่เป็นเวลาในอนาคต'
  }
  return ''
}

export function guardianOutcomeClosesNotification(channel: GuardianContactChannel, outcome: GuardianContactOutcome): boolean {
  if (channel === 'phone') return outcome === 'answered'
  if (channel === 'line' || channel === 'messenger' || channel === 'sms') return outcome === 'read_or_replied'
  return false
}

export function guardianOutcomeLabel(channel: GuardianContactChannel, outcome: GuardianContactOutcome): string {
  if (channel === 'phone') return outcome === 'answered' ? 'รับสายและรับทราบแล้ว' : 'โทรแล้วไม่มีผู้รับ'
  if (channel === 'line' || channel === 'messenger' || channel === 'sms') {
    return outcome === 'read_or_replied' ? 'อ่านหรือตอบกลับแล้ว' : 'ส่งแล้ว รออ่านหรือตอบกลับ'
  }
  return 'รอการยืนยัน'
}

export function guardianReminderDueAt(createdAt: string): Date {
  return new Date(new Date(createdAt).getTime() + GUARDIAN_REMINDER_HOURS * 60 * 60 * 1000)
}

type ReminderCase = Pick<DemoState['seriousCases'][number], 'createdAt' | 'guardianContactAttempts' | 'guardianNextReminderAt'>

/** One deadline rule for both Today and the case queue, including legacy/demo cases. */
export function caseGuardianReminderAt(item: ReminderCase): string | undefined {
  if (item.guardianNextReminderAt && Number.isFinite(Date.parse(item.guardianNextReminderAt))) return item.guardianNextReminderAt
  const attempts = (item.guardianContactAttempts ?? []).map((attempt) => Date.parse(attempt.createdAt)).filter(Number.isFinite)
  const base = attempts.length ? Math.max(...attempts) : Date.parse(item.createdAt)
  return Number.isFinite(base) ? new Date(base + GUARDIAN_REMINDER_HOURS * 60 * 60 * 1000).toISOString() : undefined
}

export function compareGuardianCases(left: DemoState['seriousCases'][number], right: DemoState['seriousCases'][number]): number {
  const deadline = (item: DemoState['seriousCases'][number]) => {
    if (item.guardianContactStatus !== 'pending') return Number.POSITIVE_INFINITY
    const value = Date.parse(caseGuardianReminderAt(item) ?? '')
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
  }
  const a = deadline(left)
  const b = deadline(right)
  if (a !== b) return a < b ? -1 : 1
  if (left.severity !== right.severity) return left.severity === 'critical' ? -1 : 1
  return left.id.localeCompare(right.id)
}
