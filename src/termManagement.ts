import { createId, type Account, type DemoState, type RequestStatus, type ScoreTransaction } from './domain'
import type { MutationResult, UpdateTermScheduleInput } from './dataActions'
import { validateTermSchedule } from './termSchedule'

/**
 * Term lifecycle and original-term remediation contract.
 *
 * Policy (confirmed with the school):
 * - every term opens at 100 for every carried-over student;
 * - the closing score of a term is captured once and never changes;
 * - a student whose closing score is below the threshold gets one remediation
 *   case for that ORIGINAL term; approved credits are added to the original
 *   term's balance only and never to the current term;
 * - the case passes automatically when the original-term balance reaches the
 *   threshold (80); credits are capped at 100;
 * - teachers (or admins) request credits, admins approve or reject them.
 */
export const REMEDIATION_THRESHOLD = 80
export const MAX_TERM_SCORE = 100

export type TermStatus = 'planned' | 'active' | 'closed'
export type RemediationStatus = 'open' | 'passed'

export interface AcademicTermSummary {
  id: string
  schoolYear: number
  semester: number
  name: string
  startsOn?: string
  endsOn?: string
  status: TermStatus
  closedAt?: string
  nextTermId?: string
}

export type TermLedgerEntryType =
  | 'semester_opening'
  | 'deduction'
  | 'teacher_request_approved'
  | 'admin_addition'
  | 'appeal_reversal'
  | 'appeal_adjustment'
  | 'admin_adjustment'
  | 'remediation_credit'

/** Student-safe ledger row: never carries staff identity. */
export interface TermLedgerEntry {
  id: string
  termId: string
  entryType: TermLedgerEntryType | (string & {})
  requestedDelta: number
  appliedDelta: number
  balanceBefore: number
  balanceAfter: number
  reason: string
  incidentId?: string
  remediationRequestId?: string
  activityOccurredAt?: string
  createdAt: string
}

export interface TermStudentHistory {
  studentId: string
  studentCode: string
  name: string
  nickname?: string
  studentStatus: 'active' | 'graduated' | (string & {})
  classroomName?: string
  gradeLevel?: string
  roomNumber?: string
  enrolled: boolean
  /** null when the student has no score account in this term. */
  latestScore: number | null
  /** null until the term is closed. Never changes once set. */
  closingScore: number | null
  threshold: number
  remediation?: { caseId: string; status: RemediationStatus; passedAt?: string }
  history: TermLedgerEntry[]
}

export interface TermHistory {
  term: AcademicTermSummary
  threshold: number
  closedAt?: string
  students: TermStudentHistory[]
}

export interface RemediationRequestSummary {
  id: string
  requestedPoints: number
  approvedPoints?: number
  activityOccurredAt: string
  /** Omitted for students. */
  reason?: string
  status: RequestStatus
  createdAt: string
  reviewedAt?: string
  /** Omitted for students. */
  reviewNote?: string
  ledgerId?: string
  requestedByMe?: boolean
  /** Admin/director only. */
  requestedBySnapshot?: string
}

export interface RemediationCase {
  caseId: string
  sourceTerm: AcademicTermSummary
  student: {
    id: string
    studentCode: string
    name: string
    nickname?: string
    status: 'active' | 'graduated' | (string & {})
  }
  /** Current-term classroom, absent when the student is not on the current roster. */
  currentClassroomName?: string
  closingScore: number
  /** Latest balance of the ORIGINAL term account. */
  currentScore: number
  threshold: number
  pointsNeeded: number
  status: RemediationStatus
  passedAt?: string
  openedAt: string
  responsibleTeacherId?: string
  pendingRequestCount: number
  requests: RemediationRequestSummary[]
  changesSinceClose: TermLedgerEntry[]
}

export interface PrepareNextTermInput {
  schoolYear: number
  semester: number
  name: string
  startsOn: string
  endsOn: string
}

export interface PrepareNextTermResult {
  ok: boolean
  replayed: boolean
  termId: string
  sourceTermId: string
  classroomCount: number
  enrollmentCount: number
  assignmentCount: number
}

export type TermTransitionBlocker =
  | 'NO_ACTIVE_TERM'
  | 'CURRENT_TERM_NOT_ACTIVE'
  | 'CURRENT_TERM_MISSING_ACCOUNTS'
  | 'CURRENT_TERM_ALREADY_TRANSITIONED'
  | 'NEXT_TERM_NOT_FOUND'
  | 'SAME_TERM'
  | 'NEXT_TERM_NOT_PLANNED'
  | 'NEXT_TERM_DATES_MISSING'
  | 'NEXT_TERM_NOT_LATER'
  | 'NEXT_TERM_OVERLAPS'
  | 'NEXT_TERM_OVERLAPS_CURRENT'
  | 'NEXT_TERM_EMPTY_ROSTER'
  | 'NEXT_TERM_INACTIVE_CLASSROOM'
  | 'NEXT_TERM_INVALID_ROSTER'
  | 'NEXT_TERM_HAS_SCORE_ACTIVITY'
  | 'PENDING_ADDITION_REQUESTS'
  | 'PENDING_DEDUCTION_REQUESTS'
  | 'ALREADY_TRANSITIONED'

export interface TermTransitionPreviewStudent {
  studentId: string
  studentCode: string
  name: string
  classroomName?: string
  balance: number | null
  belowThreshold: boolean
  carriedToNextTerm: boolean
}

export interface TermTransitionPreview {
  currentTermId?: string
  nextTermId: string
  threshold: number
  blockers: Array<TermTransitionBlocker | (string & {})>
  canTransition: boolean
  counts: {
    currentStudents: number
    belowThreshold: number
    pendingAdditionRequests: number
    pendingDeductionRequests: number
    pendingAppeals: number
    openAppealWindows: number
    nextEnrolled: number
    notCarriedOver: number
    openRemediationCases: number
  }
  students: TermTransitionPreviewStudent[]
}

export interface TransitionTermInput {
  currentTermId: string
  nextTermId: string
  clientRequestId: string
}

export interface TransitionTermResult {
  ok: boolean
  replayed: boolean
  transitionId: string
  closedTermId: string
  activeTermId: string
  snapshotCount: number
  remediationCaseCount: number
  initializedAccounts: number
  threshold: number
}

export interface RequestTermRemediationInput {
  caseId: string
  points: number
  activityOccurredAt: string
  reason: string
  clientRequestId: string
}

export interface RequestTermRemediationResult {
  ok: boolean
  replayed: boolean
  requestId: string
  caseId: string
  status: RequestStatus
}

export interface ReviewTermRemediationInput {
  requestId: string
  approve: boolean
  note?: string
  clientRequestId: string
}

export interface ReviewTermRemediationResult {
  ok: boolean
  replayed: boolean
  requestId: string
  status: 'approved' | 'rejected'
  appliedPoints?: number
  balanceBefore?: number
  balanceAfter?: number
  caseStatus: RemediationStatus
  ledgerId?: string
}

/**
 * Backend contract (Supabase RPC names in brackets). Mutations must refresh the
 * shared app state themselves, like the other AppDataActions; TermWorkspace
 * reloads its own term data after every mutation.
 */
export interface TermManagementActions {
  /** Existing admin_update_term_schedule, dates only. */
  updateTermSchedule: (input: UpdateTermScheduleInput) => Promise<MutationResult<{ updated: boolean }>>
  /** list_academic_terms_v1 */
  listAcademicTerms: () => Promise<AcademicTermSummary[]>
  /** get_term_history_v1 */
  getTermHistory: (termId: string, studentId?: string) => Promise<TermHistory>
  /** list_term_remediations_v1 */
  listTermRemediations: () => Promise<RemediationCase[]>
  /** admin_prepare_next_term_v1 */
  prepareNextTerm: (input: PrepareNextTermInput) => Promise<MutationResult<PrepareNextTermResult>>
  /** admin_preview_term_transition_v1 */
  previewTermTransition: (nextTermId: string) => Promise<TermTransitionPreview>
  /** admin_transition_term_v1 */
  transitionTerm: (input: TransitionTermInput) => Promise<MutationResult<TransitionTermResult>>
  /** request_term_remediation_v1 */
  requestTermRemediation: (input: RequestTermRemediationInput) => Promise<MutationResult<RequestTermRemediationResult>>
  /** review_term_remediation_v1 */
  reviewTermRemediation: (input: ReviewTermRemediationInput) => Promise<MutationResult<ReviewTermRemediationResult>>
}

// ---------------------------------------------------------------------------
// Pure policy helpers
// ---------------------------------------------------------------------------

export function remediationStatusFor(score: number, threshold = REMEDIATION_THRESHOLD): RemediationStatus {
  return score >= threshold ? 'passed' : 'open'
}

export function remediationPointsNeeded(score: number, threshold = REMEDIATION_THRESHOLD): number {
  return Math.max(0, threshold - score)
}

export function applyRemediationCredit(balance: number, points: number): { applied: number; after: number } {
  const before = Math.max(0, Math.min(MAX_TERM_SCORE, Math.round(balance)))
  const applied = Math.max(0, Math.min(Math.round(points), MAX_TERM_SCORE - before))
  return { applied, after: before + applied }
}

export function termStatusLabel(status: TermStatus): string {
  if (status === 'active') return 'กำลังใช้งาน'
  if (status === 'planned') return 'เตรียมเปิด'
  return 'ปิดแล้ว'
}

export function remediationStatusLabel(status: RemediationStatus): string {
  return status === 'passed' ? 'ผ่านเกณฑ์แล้ว' : 'ยังไม่ผ่าน'
}

const blockerLabels: Record<TermTransitionBlocker, string> = {
  NO_ACTIVE_TERM: 'ยังไม่มีภาคเรียนที่กำลังใช้งาน',
  CURRENT_TERM_NOT_ACTIVE: 'ภาคเรียนปัจจุบันไม่ได้อยู่ในสถานะกำลังใช้งาน',
  CURRENT_TERM_MISSING_ACCOUNTS: 'มีนักเรียนที่ยังไม่เตรียมบัญชีคะแนน ต้องตรวจสอบคะแนนให้ครบก่อนปิดภาคเรียน',
  CURRENT_TERM_ALREADY_TRANSITIONED: 'ภาคเรียนนี้ปิดและเปลี่ยนไปแล้ว',
  NEXT_TERM_NOT_FOUND: 'ไม่พบภาคเรียนถัดไป',
  SAME_TERM: 'ภาคเรียนถัดไปต้องไม่ใช่ภาคเรียนเดิม',
  NEXT_TERM_NOT_PLANNED: 'ภาคเรียนถัดไปต้องอยู่ในสถานะเตรียมเปิด',
  NEXT_TERM_DATES_MISSING: 'ยังไม่ได้กำหนดวันเปิด–ปิดของภาคเรียนถัดไป',
  NEXT_TERM_NOT_LATER: 'ภาคเรียนถัดไปต้องอยู่หลังภาคเรียนปัจจุบัน',
  NEXT_TERM_OVERLAPS: 'วันเปิดภาคเรียนถัดไปต้องอยู่หลังวันปิดภาคเรียนปัจจุบัน',
  NEXT_TERM_OVERLAPS_CURRENT: 'วันเปิดภาคเรียนถัดไปต้องอยู่หลังวันปิดภาคเรียนปัจจุบัน',
  NEXT_TERM_EMPTY_ROSTER: 'ภาคเรียนถัดไปยังไม่มีรายชื่อนักเรียน',
  NEXT_TERM_INACTIVE_CLASSROOM: 'มีนักเรียนลงทะเบียนในห้องที่ปิดใช้งาน',
  NEXT_TERM_INVALID_ROSTER: 'ทะเบียนนักเรียนหรือห้องของภาคเรียนใหม่ไม่พร้อมใช้งาน กรุณาตรวจสอบรายชื่อ',
  NEXT_TERM_HAS_SCORE_ACTIVITY: 'ภาคเรียนถัดไปมีรายการคะแนนแล้ว',
  PENDING_ADDITION_REQUESTS: 'ยังมีคำขอเพิ่มคะแนนรอพิจารณา',
  PENDING_DEDUCTION_REQUESTS: 'ยังมีคำขอตัดคะแนนรอพิจารณา',
  ALREADY_TRANSITIONED: 'ภาคเรียนนี้ปิดและเปลี่ยนไปแล้ว',
}

export function termTransitionBlockerLabel(code: string): string {
  return blockerLabels[code as TermTransitionBlocker] ?? `ยังเปลี่ยนภาคเรียนไม่ได้ (${code})`
}

export function termEntryTypeLabel(entryType: string): string {
  switch (entryType) {
    case 'semester_opening': return 'เปิดภาคเรียน'
    case 'deduction': return 'ตัดคะแนน'
    case 'teacher_request_approved':
    case 'admin_addition': return 'เพิ่มคะแนน'
    case 'appeal_reversal':
    case 'appeal_adjustment': return 'ผลอุทธรณ์'
    case 'admin_adjustment': return 'ปรับโดยผู้ดูแล'
    case 'remediation_credit': return 'คะแนนแก้ไขภาคเรียนเดิม'
    default: return 'รายการคะแนน'
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Returns an error message, or '' when valid. Mirrors admin_prepare_next_term_v1. */
export function validatePrepareNextTermInput(input: PrepareNextTermInput, current?: AcademicTermSummary): string {
  const name = input.name.trim()
  if (!name) return 'กรุณาระบุชื่อภาคเรียนถัดไป'
  if (name.length > 200) return 'ชื่อภาคเรียนยาวเกิน 200 ตัวอักษร'
  if (!input.startsOn || !input.endsOn) return 'กรุณาระบุวันเปิดและวันปิดภาคเรียนถัดไป'
  if (!isIsoDate(input.startsOn) || !isIsoDate(input.endsOn)) return 'รูปแบบวันที่ไม่ถูกต้อง'
  if (input.startsOn > input.endsOn) return 'วันปิดภาคเรียนต้องไม่มาก่อนวันเปิดภาคเรียน'
  if (!current || current.status !== 'active') return 'ต้องมีภาคเรียนที่กำลังใช้งานก่อนเตรียมภาคเรียนถัดไป'
  if (input.schoolYear !== current.schoolYear || input.semester !== current.semester + 1) {
    return `ภาคเรียนถัดไปต้องเป็นภาคเรียนที่ ${current.semester + 1}/${current.schoolYear}`
  }
  if (current.endsOn && input.startsOn <= current.endsOn) return 'วันเปิดภาคเรียนถัดไปต้องอยู่หลังวันปิดภาคเรียนปัจจุบัน'
  return ''
}

/** Returns an error message, or '' when valid. Mirrors request_term_remediation_v1. */
export function validateRemediationRequestInput(
  input: Pick<RequestTermRemediationInput, 'points' | 'activityOccurredAt' | 'reason'>,
  sourceTerm?: Pick<AcademicTermSummary, 'startsOn'>,
  now = new Date(),
): string {
  if (!Number.isInteger(input.points) || input.points < 1 || input.points > MAX_TERM_SCORE) return 'คะแนนต้องเป็นจำนวนเต็ม 1–100'
  const reason = input.reason.trim()
  if (reason.length < 5 || reason.length > 2000) return 'กรุณาระบุรายละเอียดกิจกรรม 5–2000 ตัวอักษร'
  const occurred = new Date(input.activityOccurredAt).getTime()
  if (!input.activityOccurredAt || !Number.isFinite(occurred)) return 'กรุณาระบุวันเวลาที่ทำกิจกรรม'
  if (occurred > now.getTime() + 5 * 60 * 1000) return 'วันเวลาที่ทำกิจกรรมต้องไม่อยู่ในอนาคต'
  if (sourceTerm?.startsOn && bangkokDate(input.activityOccurredAt) < sourceTerm.startsOn) return 'วันที่ทำกิจกรรมต้องไม่ก่อนวันเปิดภาคเรียนเดิม'
  return ''
}

export function validateRemediationReview(approve: boolean, note?: string): string {
  const trimmed = note?.trim() ?? ''
  if (!approve && !trimmed) return 'กรุณาระบุเหตุผลที่ไม่อนุมัติ'
  if (trimmed && (trimmed.length < 5 || trimmed.length > 2000)) return 'หมายเหตุต้องมี 5–2000 ตัวอักษร'
  return ''
}

export function bangkokDate(value: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}

/** Derives year/semester from demo ids like `term-2569-1` or labels like `ภาคเรียนที่ 1/2569`. */
export function parseTermIdentity(term: Pick<DemoState['term'], 'id' | 'label'>): { schoolYear: number; semester: number } {
  const fromId = /(\d{4})-(\d)(?!\d)/.exec(term.id)
  if (fromId) return { schoolYear: Number(fromId[1]), semester: Number(fromId[2]) }
  const fromLabel = /(\d)\s*\/\s*(\d{4})/.exec(term.label)
  if (fromLabel) return { schoolYear: Number(fromLabel[2]), semester: Number(fromLabel[1]) }
  return { schoolYear: new Date().getFullYear() + 543, semester: 1 }
}

export function suggestNextTerm(current: AcademicTermSummary): PrepareNextTermInput {
  const semester = current.semester + 1
  return { schoolYear: current.schoolYear, semester, name: `ภาคเรียนที่ ${semester}/${current.schoolYear}`, startsOn: '', endsOn: '' }
}

// ---------------------------------------------------------------------------
// Demo persistence (optional DemoState.termRecords, backward compatible)
// ---------------------------------------------------------------------------

export interface DemoTermSnapshot {
  termId: string
  studentId: string
  studentCode: string
  name: string
  nickname?: string
  studentStatus: 'active' | 'graduated'
  classroomName?: string
  gradeLevel?: string
  roomNumber?: string
  closingScore: number
  threshold: number
  /** Original-term balance, changes only through remediation credits. */
  latestScore: number
  closedAt: string
}

export interface DemoRemediationCase {
  id: string
  sourceTermId: string
  studentId: string
  closingScore: number
  threshold: number
  status: RemediationStatus
  openedAt: string
  passedAt?: string
  responsibleTeacherId?: string
}

export interface DemoRemediationRequest {
  id: string
  caseId: string
  requestedPoints: number
  approvedPoints?: number
  activityOccurredAt: string
  reason: string
  status: RequestStatus
  createdAt: string
  reviewedAt?: string
  reviewNote?: string
  requestedByAccountId: string
  requestedBySnapshot: string
  clientRequestId: string
  payloadKey: string
  reviewClientRequestId?: string
  reviewPayloadKey?: string
  ledgerId?: string
  balanceBefore?: number
  balanceAfter?: number
  appliedPoints?: number
}

export interface DemoTermPreparation {
  termId: string
  sourceTermId: string
  payloadKey: string
  studentIds: string[]
  classroomCount: number
  enrollmentCount: number
  assignmentCount: number
}

export interface DemoTermTransition {
  id: string
  fromTermId: string
  toTermId: string
  clientRequestId: string
  payloadKey: string
  createdAt: string
  result: TransitionTermResult
}

export interface DemoTermRecords {
  version: 1
  terms: AcademicTermSummary[]
  snapshots: DemoTermSnapshot[]
  cases: DemoRemediationCase[]
  requests: DemoRemediationRequest[]
  preparations: DemoTermPreparation[]
  transitions: DemoTermTransition[]
}

function currentTermSummary(term: DemoState['term']): AcademicTermSummary {
  const identity = parseTermIdentity(term)
  return {
    id: term.id,
    schoolYear: identity.schoolYear,
    semester: identity.semester,
    name: term.label,
    startsOn: term.startsOn,
    endsOn: term.endsOn,
    status: term.isActive ? 'active' : 'planned',
  }
}

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

/** Accepts persisted (possibly older or malformed) records; never throws. */
export function normalizeTermRecords(value: unknown): DemoTermRecords | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<DemoTermRecords>
  if (raw.version !== 1) return undefined
  return {
    version: 1,
    terms: arrayOrEmpty<AcademicTermSummary>(raw.terms).filter((term) => term && typeof term.id === 'string'),
    snapshots: arrayOrEmpty<DemoTermSnapshot>(raw.snapshots),
    cases: arrayOrEmpty<DemoRemediationCase>(raw.cases),
    requests: arrayOrEmpty<DemoRemediationRequest>(raw.requests),
    preparations: arrayOrEmpty<DemoTermPreparation>(raw.preparations),
    transitions: arrayOrEmpty<DemoTermTransition>(raw.transitions),
  }
}

/** Returns records that always include the state's current term with its live status. */
export function ensureTermRecords(state: DemoState): DemoTermRecords {
  const records = normalizeTermRecords(state.termRecords) ?? {
    version: 1 as const, terms: [], snapshots: [], cases: [], requests: [], preparations: [], transitions: [],
  }
  const current = currentTermSummary(state.term)
  const existing = records.terms.find((term) => term.id === current.id)
  const terms = existing
    ? records.terms.map((term) => term.id === current.id
      ? { ...term, name: current.name, startsOn: current.startsOn, endsOn: current.endsOn, status: term.status === 'closed' ? 'closed' as const : current.status }
      : term)
    : [...records.terms, current]
  return { ...records, terms: sortTerms(terms) }
}

function sortTerms(terms: AcademicTermSummary[]): AcademicTermSummary[] {
  return [...terms].sort((left, right) => right.schoolYear - left.schoolYear || right.semester - left.semester)
}

// ---------------------------------------------------------------------------
// Demo implementation (mirrors backend authorization and invariants)
// ---------------------------------------------------------------------------

export class TermActionError extends Error {}

function fail(message: string): never {
  throw new TermActionError(message)
}

function requireAdmin(account: Account) {
  if (account.role !== 'admin') fail('เฉพาะผู้ดูแลระบบเท่านั้นที่ดำเนินการนี้ได้')
}

function teacherOf(state: DemoState, account: Account) {
  return account.role === 'teacher' ? state.teachers.find((item) => item.id === account.teacherId) : undefined
}

function teacherCanSeeStudent(state: DemoState, account: Account, studentId: string): boolean {
  const teacher = teacherOf(state, account)
  if (!teacher) return false
  const student = state.students.find((item) => item.id === studentId && item.status === 'active')
  return Boolean(student && (teacher.canScoreAllClassrooms || teacher.classroomIds.includes(student.classroomId)))
}

function canSeeAllTerms(account: Account): boolean {
  return account.role === 'admin' || account.role === 'director'
}

function canSeeCase(state: DemoState, account: Account, item: DemoRemediationCase): boolean {
  if (canSeeAllTerms(account)) return true
  if (account.role === 'student') return account.studentId === item.studentId
  if (account.role === 'teacher') {
    return teacherCanSeeStudent(state, account, item.studentId)
      || (Boolean(account.teacherId) && item.responsibleTeacherId === account.teacherId)
  }
  return false
}

function canManageCase(state: DemoState, account: Account, item: DemoRemediationCase): boolean {
  if (account.role === 'admin') return true
  if (account.role !== 'teacher') return false
  return teacherCanSeeStudent(state, account, item.studentId)
    || (Boolean(account.teacherId) && item.responsibleTeacherId === account.teacherId)
}

function ledgerEntryFromTransaction(transaction: ScoreTransaction): TermLedgerEntry {
  const entryType: TermLedgerEntryType = transaction.remediationRequestId
    ? 'remediation_credit'
    : transaction.kind === 'deduction'
      ? 'deduction'
      : transaction.kind === 'reset'
        ? 'semester_opening'
        : transaction.kind === 'adjustment'
          ? 'admin_adjustment'
          : transaction.additionSource === 'appeal' ? 'appeal_adjustment' : 'teacher_request_approved'
  return {
    id: transaction.id,
    termId: transaction.termId,
    entryType,
    requestedDelta: transaction.requestedDelta,
    appliedDelta: transaction.appliedDelta,
    balanceBefore: transaction.scoreBefore,
    balanceAfter: transaction.scoreAfter,
    reason: transaction.positiveRuleTitle ?? transaction.reason,
    incidentId: transaction.incidentId,
    remediationRequestId: transaction.remediationRequestId,
    activityOccurredAt: transaction.activityOccurredAt,
    createdAt: transaction.occurredAt,
  }
}

function termHistoryFor(state: DemoState, studentId: string, termId: string): TermLedgerEntry[] {
  return state.transactions
    .filter((item) => item.studentId === studentId && item.termId === termId)
    .map(ledgerEntryFromTransaction)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
}

export function demoListAcademicTerms(state: DemoState, account: Account): AcademicTermSummary[] {
  const terms = ensureTermRecords(state).terms
  return canSeeAllTerms(account) ? terms : terms.filter((term) => term.status !== 'planned')
}

export function demoGetTermHistory(state: DemoState, account: Account, termId: string, studentId?: string): TermHistory {
  const records = ensureTermRecords(state)
  const term = records.terms.find((item) => item.id === termId)
  if (!term || (term.status === 'planned' && !canSeeAllTerms(account))) fail('ไม่พบภาคเรียนที่เลือก')
  const isCurrent = term.id === state.term.id
  const visible = (id: string, responsibleCase?: DemoRemediationCase) => {
    if (studentId && id !== studentId) return false
    if (canSeeAllTerms(account)) return true
    if (account.role === 'student') return account.studentId === id
    if (account.role === 'teacher') {
      return teacherCanSeeStudent(state, account, id)
        || (Boolean(account.teacherId) && responsibleCase?.responsibleTeacherId === account.teacherId)
    }
    return false
  }
  const caseFor = (id: string) => records.cases.find((item) => item.sourceTermId === termId && item.studentId === id)
  let students: TermStudentHistory[]
  if (isCurrent) {
    students = term.status === 'planned' ? [] : state.students.filter((student) => visible(student.id)).map((student): TermStudentHistory => ({
      studentId: student.id,
      studentCode: student.studentCode,
      name: student.name,
      nickname: student.nickname,
      studentStatus: student.status,
      classroomName: student.classroomName,
      gradeLevel: student.gradeLevel,
      roomNumber: student.roomNumber,
      enrolled: true,
      latestScore: student.score,
      closingScore: null,
      threshold: REMEDIATION_THRESHOLD,
      history: termHistoryFor(state, student.id, termId),
    }))
  } else if (term.status === 'planned') {
    const preparation = records.preparations.find((item) => item.termId === termId)
    students = (preparation?.studentIds ?? []).flatMap((id): TermStudentHistory[] => {
      const student = state.students.find((item) => item.id === id)
      if (!student || !visible(id)) return []
      return [{
        studentId: student.id, studentCode: student.studentCode, name: student.name, nickname: student.nickname,
        studentStatus: student.status, classroomName: student.classroomName, gradeLevel: student.gradeLevel,
        roomNumber: student.roomNumber, enrolled: true, latestScore: null, closingScore: null,
        threshold: REMEDIATION_THRESHOLD, history: [],
      }]
    })
  } else {
    students = records.snapshots.filter((snapshot) => snapshot.termId === termId && visible(snapshot.studentId, caseFor(snapshot.studentId))).map((snapshot): TermStudentHistory => {
      const remediation = caseFor(snapshot.studentId)
      return {
        studentId: snapshot.studentId,
        studentCode: snapshot.studentCode,
        name: snapshot.name,
        nickname: snapshot.nickname,
        studentStatus: snapshot.studentStatus,
        classroomName: snapshot.classroomName,
        gradeLevel: snapshot.gradeLevel,
        roomNumber: snapshot.roomNumber,
        enrolled: true,
        latestScore: snapshot.latestScore,
        closingScore: snapshot.closingScore,
        threshold: snapshot.threshold,
        remediation: remediation ? { caseId: remediation.id, status: remediation.status, passedAt: remediation.passedAt } : undefined,
        history: termHistoryFor(state, snapshot.studentId, termId),
      }
    })
  }
  students.sort((left, right) => (left.classroomName ?? '').localeCompare(right.classroomName ?? '', 'th') || left.studentCode.localeCompare(right.studentCode))
  return { term, threshold: REMEDIATION_THRESHOLD, closedAt: term.closedAt, students }
}

export function demoListTermRemediations(state: DemoState, account: Account): RemediationCase[] {
  const records = ensureTermRecords(state)
  const isStudent = account.role === 'student'
  return records.cases.filter((item) => canSeeCase(state, account, item)).map((item): RemediationCase => {
    const term = records.terms.find((entry) => entry.id === item.sourceTermId)
    const snapshot = records.snapshots.find((entry) => entry.termId === item.sourceTermId && entry.studentId === item.studentId)
    const current = state.students.find((entry) => entry.id === item.studentId)
    const currentScore = snapshot?.latestScore ?? item.closingScore
    const requests = records.requests
      .filter((request) => request.caseId === item.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .map((request): RemediationRequestSummary => ({
        id: request.id,
        requestedPoints: request.requestedPoints,
        approvedPoints: request.approvedPoints,
        activityOccurredAt: request.activityOccurredAt,
        reason: isStudent ? undefined : request.reason,
        status: request.status,
        createdAt: request.createdAt,
        reviewedAt: request.reviewedAt,
        reviewNote: isStudent ? undefined : request.reviewNote,
        ledgerId: isStudent ? undefined : request.ledgerId,
        requestedByMe: isStudent ? undefined : request.requestedByAccountId === account.id,
        requestedBySnapshot: canSeeAllTerms(account) ? request.requestedBySnapshot : undefined,
      }))
    return {
      caseId: item.id,
      sourceTerm: term ?? { id: item.sourceTermId, schoolYear: 0, semester: 0, name: 'ภาคเรียนเดิม', status: 'closed' },
      student: {
        id: item.studentId,
        studentCode: snapshot?.studentCode ?? current?.studentCode ?? '',
        name: snapshot?.name ?? current?.name ?? 'ไม่พบข้อมูลนักเรียน',
        nickname: snapshot?.nickname ?? current?.nickname,
        status: current?.status ?? snapshot?.studentStatus ?? 'active',
      },
      currentClassroomName: current?.classroomName,
      closingScore: item.closingScore,
      currentScore,
      threshold: item.threshold,
      pointsNeeded: remediationPointsNeeded(currentScore, item.threshold),
      status: item.status,
      passedAt: item.passedAt,
      openedAt: item.openedAt,
      responsibleTeacherId: isStudent ? undefined : item.responsibleTeacherId,
      pendingRequestCount: requests.filter((request) => request.status === 'pending').length,
      requests,
      changesSinceClose: termHistoryFor(state, item.studentId, item.sourceTermId).filter((entry) => entry.createdAt >= item.openedAt),
    }
  }).sort((left, right) => (left.status === right.status ? 0 : left.status === 'open' ? -1 : 1)
    || right.sourceTerm.schoolYear - left.sourceTerm.schoolYear
    || right.sourceTerm.semester - left.sourceTerm.semester
    || left.student.studentCode.localeCompare(right.student.studentCode))
}

function activeTerm(records: DemoTermRecords): AcademicTermSummary | undefined {
  return records.terms.find((term) => term.status === 'active')
}

function payloadKey(value: unknown): string {
  return JSON.stringify(value)
}

export function demoPrepareNextTerm(
  state: DemoState,
  account: Account,
  input: PrepareNextTermInput,
): { state: DemoState; result: PrepareNextTermResult } {
  requireAdmin(account)
  const records = ensureTermRecords(state)
  const current = activeTerm(records)
  const validation = validatePrepareNextTermInput(input, current)
  if (validation) fail(validation)
  const source = current as AcademicTermSummary
  const key = payloadKey({ sourceTermId: source.id, ...input, name: input.name.trim() })
  const existing = records.terms.find((term) => term.schoolYear === input.schoolYear && term.semester === input.semester)
  if (existing) {
    const preparation = records.preparations.find((item) => item.termId === existing.id)
    if (preparation && preparation.payloadKey === key) {
      return {
        state,
        result: {
          ok: true, replayed: true, termId: existing.id, sourceTermId: preparation.sourceTermId,
          classroomCount: preparation.classroomCount, enrollmentCount: preparation.enrollmentCount, assignmentCount: preparation.assignmentCount,
        },
      }
    }
    if (preparation) fail('ภาคเรียนนี้ถูกเตรียมไว้แล้วด้วยข้อมูลอื่น กรุณาตรวจสอบชื่อและวันที่')
    fail('มีภาคเรียนนี้อยู่แล้ว กรุณาตรวจรายชื่อของภาคเรียนนั้นก่อนเปลี่ยนภาคเรียน')
  }
  const carried = state.students.filter((student) => student.status === 'active')
  const classroomIds = new Set(carried.map((student) => student.classroomId))
  const assignmentCount = state.teachers.reduce((sum, teacher) => sum + teacher.classroomIds.filter((id) => classroomIds.has(id)).length, 0)
  const termId = `term-${input.schoolYear}-${input.semester}`
  const preparation: DemoTermPreparation = {
    termId, sourceTermId: source.id, payloadKey: key, studentIds: carried.map((student) => student.id),
    classroomCount: classroomIds.size, enrollmentCount: carried.length, assignmentCount,
  }
  const term: AcademicTermSummary = {
    id: termId, schoolYear: input.schoolYear, semester: input.semester, name: input.name.trim(),
    startsOn: input.startsOn, endsOn: input.endsOn, status: 'planned',
  }
  return {
    state: { ...state, termRecords: { ...records, terms: sortTerms([...records.terms, term]), preparations: [...records.preparations, preparation] } },
    result: {
      ok: true, replayed: false, termId, sourceTermId: source.id,
      classroomCount: preparation.classroomCount, enrollmentCount: preparation.enrollmentCount, assignmentCount,
    },
  }
}

export function demoUpdateTermSchedule(state: DemoState, account: Account, input: UpdateTermScheduleInput): { state: DemoState; result: { updated: boolean } } {
  requireAdmin(account)
  const records = ensureTermRecords(state)
  const target = records.terms.find((term) => term.id === input.termId)
  if (!target) fail('ไม่พบภาคเรียน')
  if (target.status === 'closed') fail('ภาคเรียนที่ปิดแล้วแก้วันเปิด–ปิดไม่ได้')
  const validation = validateTermSchedule(input.startsOn, input.endsOn)
  if (validation) fail(validation)
  const current = activeTerm(records)
  const planned = records.terms.find((term) => term.status === 'planned' && term.id !== input.termId)
  if (target.status === 'planned' && current?.endsOn && input.startsOn <= current.endsOn) fail('วันเปิดภาคเรียนถัดไปต้องอยู่หลังวันปิดภาคเรียนปัจจุบัน')
  if (target.status === 'active' && planned?.startsOn && input.endsOn >= planned.startsOn) fail('วันปิดภาคเรียนซ้อนกับภาคเรียนถัดไป')
  if (target.startsOn === input.startsOn && target.endsOn === input.endsOn) return { state, result: { updated: false } }
  const next = { ...state, termRecords: { ...records, terms: records.terms.map((term) => term.id === input.termId ? { ...term, startsOn: input.startsOn, endsOn: input.endsOn } : term) } }
  if (input.termId === state.term.id) next.term = { ...state.term, startsOn: input.startsOn, endsOn: input.endsOn }
  return { state: next, result: { updated: true } }
}

export function demoPreviewTermTransition(state: DemoState, account: Account, nextTermId: string): TermTransitionPreview {
  requireAdmin(account)
  const records = ensureTermRecords(state)
  const current = activeTerm(records)
  const next = records.terms.find((term) => term.id === nextTermId)
  const preparation = records.preparations.find((item) => item.termId === nextTermId)
  const blockers: TermTransitionBlocker[] = []
  if (!current) blockers.push('NO_ACTIVE_TERM')
  if (!next) blockers.push('NEXT_TERM_NOT_FOUND')
  if (current && next) {
    if (current.id === next.id) blockers.push('SAME_TERM')
    if (next.status !== 'planned') blockers.push('NEXT_TERM_NOT_PLANNED')
    if (!next.startsOn || !next.endsOn) blockers.push('NEXT_TERM_DATES_MISSING')
    if (next.schoolYear < current.schoolYear || (next.schoolYear === current.schoolYear && next.semester <= current.semester)) blockers.push('NEXT_TERM_NOT_LATER')
    if (next.startsOn && current.endsOn && next.startsOn <= current.endsOn) blockers.push('NEXT_TERM_OVERLAPS')
    if (records.transitions.some((item) => item.fromTermId === current.id)) blockers.push('ALREADY_TRANSITIONED')
  }
  const carried = new Set(preparation?.studentIds ?? [])
  if (next && !carried.size) blockers.push('NEXT_TERM_EMPTY_ROSTER')
  const pendingAdditionRequests = state.additionRequests.filter((item) => item.status === 'pending').length
  const pendingDeductionRequests = state.deductionRequests.filter((item) => item.status === 'pending').length
  if (pendingAdditionRequests) blockers.push('PENDING_ADDITION_REQUESTS')
  if (pendingDeductionRequests) blockers.push('PENDING_DEDUCTION_REQUESTS')
  const students = state.students.map((student): TermTransitionPreviewStudent => ({
    studentId: student.id,
    studentCode: student.studentCode,
    name: student.name,
    classroomName: student.classroomName,
    balance: student.score,
    belowThreshold: student.score < REMEDIATION_THRESHOLD,
    carriedToNextTerm: carried.has(student.id),
  }))
  return {
    currentTermId: current?.id,
    nextTermId,
    threshold: REMEDIATION_THRESHOLD,
    blockers,
    canTransition: blockers.length === 0,
    counts: {
      currentStudents: students.length,
      belowThreshold: students.filter((student) => student.belowThreshold).length,
      pendingAdditionRequests,
      pendingDeductionRequests,
      pendingAppeals: state.appeals.filter((item) => item.status === 'submitted' || item.status === 'reviewing').length,
      openAppealWindows: 0,
      nextEnrolled: carried.size,
      notCarriedOver: students.filter((student) => !student.carriedToNextTerm).length,
      openRemediationCases: records.cases.filter((item) => item.status === 'open').length,
    },
    students,
  }
}

export function demoTransitionTerm(
  state: DemoState,
  account: Account,
  input: TransitionTermInput,
  now = new Date(),
): { state: DemoState; result: TransitionTermResult } {
  requireAdmin(account)
  if (!input.clientRequestId) fail('ไม่พบรหัสคำขอ กรุณาลองใหม่')
  const records = ensureTermRecords(state)
  const key = payloadKey({ currentTermId: input.currentTermId, nextTermId: input.nextTermId })
  const replay = records.transitions.find((item) => item.clientRequestId === input.clientRequestId)
  if (replay) {
    if (replay.payloadKey !== key) fail('รหัสคำขอนี้ถูกใช้กับการเปลี่ยนภาคเรียนอื่นแล้ว')
    return { state, result: { ...replay.result, replayed: true } }
  }
  const current = activeTerm(records)
  if (!current || current.id !== input.currentTermId) fail('ภาคเรียนปัจจุบันเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลใหม่')
  const preview = demoPreviewTermTransition(state, account, input.nextTermId)
  if (!preview.canTransition) fail(preview.blockers.map(termTransitionBlockerLabel).join(' • '))
  const next = records.terms.find((term) => term.id === input.nextTermId) as AcademicTermSummary
  const preparation = records.preparations.find((item) => item.termId === next.id) as DemoTermPreparation
  const closedAt = now.toISOString()
  const snapshots: DemoTermSnapshot[] = state.students.map((student) => ({
    termId: current.id,
    studentId: student.id,
    studentCode: student.studentCode,
    name: student.name,
    nickname: student.nickname,
    studentStatus: student.status,
    classroomName: student.classroomName,
    gradeLevel: student.gradeLevel,
    roomNumber: student.roomNumber,
    closingScore: student.score,
    threshold: REMEDIATION_THRESHOLD,
    latestScore: student.score,
    closedAt,
  }))
  const cases: DemoRemediationCase[] = snapshots.filter((snapshot) => snapshot.closingScore < snapshot.threshold).map((snapshot) => ({
    id: createId('remediation'),
    sourceTermId: current.id,
    studentId: snapshot.studentId,
    closingScore: snapshot.closingScore,
    threshold: snapshot.threshold,
    status: 'open',
    openedAt: closedAt,
  }))
  const carried = new Set(preparation.studentIds)
  const carriedStudents = state.students.filter((student) => carried.has(student.id)).map((student) => ({ ...student, score: MAX_TERM_SCORE }))
  const openings: ScoreTransaction[] = carriedStudents.map((student) => ({
    id: createId('opening'),
    studentId: student.id,
    termId: next.id,
    kind: 'reset',
    requestedDelta: MAX_TERM_SCORE,
    appliedDelta: MAX_TERM_SCORE,
    scoreBefore: 0,
    scoreAfter: MAX_TERM_SCORE,
    reason: 'เปิดคะแนนประจำภาคเรียน',
    occurredAt: closedAt,
    actorId: account.id,
  }))
  const transitionId = createId('transition')
  const result: TransitionTermResult = {
    ok: true,
    replayed: false,
    transitionId,
    closedTermId: current.id,
    activeTermId: next.id,
    snapshotCount: snapshots.length,
    remediationCaseCount: cases.length,
    initializedAccounts: carriedStudents.length,
    threshold: REMEDIATION_THRESHOLD,
  }
  const terms = records.terms.map((term) => term.id === current.id
    ? { ...term, status: 'closed' as const, closedAt, nextTermId: next.id }
    : term.id === next.id ? { ...term, status: 'active' as const } : term)
  return {
    state: {
      ...state,
      term: { id: next.id, label: next.name, isActive: true, startsOn: next.startsOn, endsOn: next.endsOn, resetCompletedAt: closedAt },
      students: carriedStudents,
      transactions: [...openings, ...state.transactions],
      termRecords: {
        ...records,
        terms: sortTerms(terms),
        snapshots: [...records.snapshots, ...snapshots],
        cases: [...records.cases, ...cases],
        transitions: [...records.transitions, { id: transitionId, fromTermId: current.id, toTermId: next.id, clientRequestId: input.clientRequestId, payloadKey: key, createdAt: closedAt, result }],
      },
    },
    result,
  }
}

export function demoRequestTermRemediation(
  state: DemoState,
  account: Account,
  input: RequestTermRemediationInput,
  now = new Date(),
): { state: DemoState; result: RequestTermRemediationResult } {
  if (account.role !== 'admin' && account.role !== 'teacher') fail('เฉพาะคุณครูหรือผู้ดูแลระบบเท่านั้นที่ส่งคำขอได้')
  if (!input.clientRequestId) fail('ไม่พบรหัสคำขอ กรุณาลองใหม่')
  const records = ensureTermRecords(state)
  const key = payloadKey({ caseId: input.caseId, points: input.points, activityOccurredAt: new Date(input.activityOccurredAt).getTime(), reason: input.reason.trim() })
  const replay = records.requests.find((item) => item.requestedByAccountId === account.id && item.clientRequestId === input.clientRequestId)
  if (replay) {
    if (replay.payloadKey !== key) fail('รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว กรุณาส่งใหม่')
    return { state, result: { ok: true, replayed: true, requestId: replay.id, caseId: replay.caseId, status: replay.status } }
  }
  const item = records.cases.find((entry) => entry.id === input.caseId)
  if (!item) fail('ไม่พบเคสแก้ไขคะแนน')
  if (!canManageCase(state, account, item)) fail('คุณไม่มีสิทธิ์ส่งคำขอสำหรับนักเรียนคนนี้')
  if (item.status !== 'open') fail('เคสนี้ผ่านเกณฑ์แล้ว')
  const sourceTerm = records.terms.find((term) => term.id === item.sourceTermId)
  const validation = validateRemediationRequestInput(input, sourceTerm, now)
  if (validation) fail(validation)
  if (records.requests.some((entry) => entry.caseId === item.id && entry.status === 'pending')) fail('เคสนี้มีคำขอรอพิจารณาอยู่แล้ว')
  const request: DemoRemediationRequest = {
    id: createId('remediation-request'),
    caseId: item.id,
    requestedPoints: input.points,
    activityOccurredAt: new Date(input.activityOccurredAt).toISOString(),
    reason: input.reason.trim(),
    status: 'pending',
    createdAt: now.toISOString(),
    requestedByAccountId: account.id,
    requestedBySnapshot: account.displayName,
    clientRequestId: input.clientRequestId,
    payloadKey: key,
  }
  return {
    state: { ...state, termRecords: { ...records, requests: [...records.requests, request] } },
    result: { ok: true, replayed: false, requestId: request.id, caseId: item.id, status: 'pending' },
  }
}

export function demoReviewTermRemediation(
  state: DemoState,
  account: Account,
  input: ReviewTermRemediationInput,
  now = new Date(),
): { state: DemoState; result: ReviewTermRemediationResult } {
  requireAdmin(account)
  if (!input.clientRequestId) fail('ไม่พบรหัสคำขอ กรุณาลองใหม่')
  const validation = validateRemediationReview(input.approve, input.note)
  if (validation) fail(validation)
  const records = ensureTermRecords(state)
  const note = input.note?.trim() || undefined
  const key = payloadKey({ requestId: input.requestId, approve: input.approve, note: note ?? null })
  const resultFor = (request: DemoRemediationRequest, replayed: boolean): ReviewTermRemediationResult => {
    const item = records.cases.find((entry) => entry.id === request.caseId)
    return {
      ok: true,
      replayed,
      requestId: request.id,
      status: request.status === 'approved' ? 'approved' : 'rejected',
      appliedPoints: request.appliedPoints,
      balanceBefore: request.balanceBefore,
      balanceAfter: request.balanceAfter,
      caseStatus: item?.status ?? 'open',
      ledgerId: request.ledgerId,
    }
  }
  const replay = records.requests.find((item) => item.reviewClientRequestId === input.clientRequestId)
  if (replay) {
    if (replay.id !== input.requestId || replay.reviewPayloadKey !== key) fail('รหัสคำขอนี้ถูกใช้กับการพิจารณาอื่นแล้ว')
    return { state, result: resultFor(replay, true) }
  }
  const request = records.requests.find((item) => item.id === input.requestId)
  if (!request) fail('ไม่พบคำขอแก้ไขคะแนน')
  if (request.status !== 'pending') fail('คำขอนี้ได้รับการพิจารณาแล้ว')
  const item = records.cases.find((entry) => entry.id === request.caseId)
  if (!item) fail('ไม่พบเคสแก้ไขคะแนน')
  const reviewedAt = now.toISOString()
  if (!input.approve) {
    const rejected: DemoRemediationRequest = { ...request, status: 'rejected', reviewedAt, reviewNote: note, reviewClientRequestId: input.clientRequestId, reviewPayloadKey: key }
    const nextRecords = { ...records, requests: records.requests.map((entry) => entry.id === request.id ? rejected : entry) }
    return { state: { ...state, termRecords: nextRecords }, result: { ...resultFor(rejected, false), caseStatus: item.status } }
  }
  const snapshot = records.snapshots.find((entry) => entry.termId === item.sourceTermId && entry.studentId === item.studentId)
  const before = snapshot?.latestScore ?? item.closingScore
  const credit = applyRemediationCredit(before, request.requestedPoints)
  const caseStatus = remediationStatusFor(credit.after, item.threshold)
  const ledgerId = createId('remediation-credit')
  const ledger: ScoreTransaction = {
    id: ledgerId,
    studentId: item.studentId,
    termId: item.sourceTermId,
    kind: 'addition',
    requestedDelta: request.requestedPoints,
    appliedDelta: credit.applied,
    scoreBefore: before,
    scoreAfter: credit.after,
    reason: 'คะแนนจากกิจกรรมแก้ไขพฤติกรรมของภาคเรียนเดิม',
    occurredAt: reviewedAt,
    activityOccurredAt: request.activityOccurredAt,
    actorId: account.id,
    remediationRequestId: request.id,
  }
  const approved: DemoRemediationRequest = {
    ...request, status: 'approved', approvedPoints: request.requestedPoints, reviewedAt, reviewNote: note,
    reviewClientRequestId: input.clientRequestId, reviewPayloadKey: key, ledgerId,
    balanceBefore: before, balanceAfter: credit.after, appliedPoints: credit.applied,
  }
  const nextRecords: DemoTermRecords = {
    ...records,
    snapshots: records.snapshots.map((entry) => entry === snapshot ? { ...entry, latestScore: credit.after } : entry),
    cases: records.cases.map((entry) => entry.id === item.id
      ? { ...entry, status: caseStatus, passedAt: caseStatus === 'passed' ? entry.passedAt ?? reviewedAt : undefined }
      : entry),
    requests: records.requests.map((entry) => entry.id === request.id ? approved : entry),
  }
  return {
    // Current-term students and scores are intentionally untouched.
    state: { ...state, transactions: [ledger, ...state.transactions], termRecords: nextRecords },
    result: { ok: true, replayed: false, requestId: request.id, status: 'approved', appliedPoints: credit.applied, balanceBefore: before, balanceAfter: credit.after, caseStatus, ledgerId },
  }
}

/**
 * Wraps the demo functions as TermManagementActions. `getState` must return
 * the latest state (use a ref) so consecutive actions never act on stale data.
 * Without `commit` (read-only screens) every mutation fails safely.
 */
export function createDemoTermActions(
  getState: () => DemoState,
  commit: ((next: DemoState) => void) | undefined,
  account: Account,
): TermManagementActions {
  function mutate<T>(run: (state: DemoState) => { state: DemoState; result: T }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      try {
        if (!commit) fail('บัญชีนี้ดูข้อมูลได้อย่างเดียว')
        const outcome = run(getState())
        if (outcome.state !== getState()) commit(outcome.state)
        resolve(outcome.result)
      } catch (error) {
        reject(error)
      }
    })
  }
  function read<T>(run: (state: DemoState) => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      try {
        resolve(run(getState()))
      } catch (error) {
        reject(error)
      }
    })
  }
  return {
    updateTermSchedule: (input) => mutate((state) => demoUpdateTermSchedule(state, account, input)),
    listAcademicTerms: () => read((state) => demoListAcademicTerms(state, account)),
    getTermHistory: (termId, studentId) => read((state) => demoGetTermHistory(state, account, termId, studentId)),
    listTermRemediations: () => read((state) => demoListTermRemediations(state, account)),
    prepareNextTerm: (input) => mutate((state) => demoPrepareNextTerm(state, account, input)),
    previewTermTransition: (nextTermId) => read((state) => demoPreviewTermTransition(state, account, nextTermId)),
    transitionTerm: (input) => mutate((state) => demoTransitionTerm(state, account, input)),
    requestTermRemediation: (input) => mutate((state) => demoRequestTermRemediation(state, account, input)),
    reviewTermRemediation: (input) => mutate((state) => demoReviewTermRemediation(state, account, input)),
  }
}
