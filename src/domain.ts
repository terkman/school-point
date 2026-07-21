export type Role = 'student' | 'teacher' | 'admin'
export type Severity = 'low' | 'medium' | 'serious' | 'critical'
export type RequestStatus = 'pending' | 'approved' | 'rejected'

export interface Account {
  id: string
  username: string
  password: string
  displayName: string
  role: Role
  studentId?: string
  teacherId?: string
}

export interface Student {
  id: string
  studentCode: string
  name: string
  classroomId: string
  classroomName: string
  score: number
  status: 'active' | 'graduated'
}

export interface Teacher {
  id: string
  name: string
  classroomIds: string[]
}

export interface BehaviorRule {
  id: string
  category: string
  title: string
  points: number
  severity: Severity
  guardianContactRequired: boolean
  active: boolean
}

export interface ScoreTransaction {
  id: string
  studentId: string
  termId: string
  kind: 'deduction' | 'addition' | 'reset'
  requestedDelta: number
  appliedDelta: number
  scoreBefore: number
  scoreAfter: number
  ruleId?: string
  reason: string
  occurredAt: string
  actorId: string
  incidentId?: string
  appealDeadline?: string
  sourceRequestId?: string
  sourceAppealId?: string
}

export interface AdditionRequest {
  id: string
  studentId: string
  teacherId: string
  requestedPoints: number
  reason: string
  status: RequestStatus
  createdAt: string
  decidedAt?: string
  decisionNote?: string
}

export interface Appeal {
  id: string
  transactionId: string
  studentId: string
  statement: string
  status: 'submitted' | 'reviewing' | 'accepted' | 'rejected'
  createdAt: string
}

export interface SeriousCase {
  id: string
  transactionId: string
  studentId: string
  severity: 'serious' | 'critical'
  status: 'open' | 'following_up' | 'resolved'
  guardianContactRequired: boolean
  guardianContactStatus: 'not_required' | 'pending' | 'completed'
  createdAt: string
  internalNote: string
}

export interface DemoState {
  version: 1
  term: {
    id: string
    label: string
    isActive: boolean
    resetCompletedAt?: string
  }
  accounts: Account[]
  students: Student[]
  teachers: Teacher[]
  rules: BehaviorRule[]
  transactions: ScoreTransaction[]
  additionRequests: AdditionRequest[]
  appeals: Appeal[]
  seriousCases: SeriousCase[]
}

export interface ScoreChange {
  requestedDelta: number
  appliedDelta: number
  before: number
  after: number
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function applyScoreDelta(score: number, requestedDelta: number): ScoreChange {
  const before = clampScore(score)
  const after = clampScore(before + requestedDelta)
  return {
    requestedDelta,
    appliedDelta: after - before,
    before,
    after,
  }
}

export function canAppeal(occurredAt: string, now = new Date()): boolean {
  const occurred = new Date(occurredAt).getTime()
  const deadline = occurred + 7 * 24 * 60 * 60 * 1000
  return Number.isFinite(occurred) && now.getTime() <= deadline
}

export function canAppealUntil(deadlineAt: string, now = new Date()): boolean {
  const deadline = new Date(deadlineAt).getTime()
  return Number.isFinite(deadline) && now.getTime() <= deadline
}

export function appealDeadline(occurredAt: string): Date {
  return new Date(new Date(occurredAt).getTime() + 7 * 24 * 60 * 60 * 1000)
}

export function formatThaiDate(value: string | Date, withTime = true): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' as const } : {}),
    timeZone: 'Asia/Bangkok',
  }).format(date)
}

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
