import type { GuardianContactChannel, GuardianContactOutcome } from './domain'

export const MIN_REVIEW_NOTE_LENGTH = 5
export const GUARDIAN_REMINDER_HOURS = 24

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
  if (input.accepted && (!Number.isInteger(input.restoredPoints)
    || input.restoredPoints < 1
    || input.restoredPoints > input.maximumRestorablePoints)) {
    return `คะแนนที่คืนต้องอยู่ระหว่าง 1–${input.maximumRestorablePoints}`
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
