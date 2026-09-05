import type { SupabaseClient, User } from '@supabase/supabase-js'
import type {
  AdminAddPointsBulkResult,
  AdminAddPointsResult,
  AdminAdjustScoreResult,
  AppDataActions,
  CreateRuleResult,
  PaperDocumentRecord,
  PaperDocumentSnapshot,
  RecordGuardianContactAttemptResult,
  RecordDeductionsResult,
  RequestDeductionsResult,
  RequestPointAdditionsResult,
  RemoveRuleResult,
  MutationSyncWarning,
} from './dataActions'
import type {
  Account,
  Appeal,
  BehaviorRule,
  DemoState,
  DeductionRequest,
  GuardianContact,
  GuardianContactAttempt,
  GuardianContactChannel,
  GuardianContactOutcome,
  PositiveBehaviorRule,
  RuleProposal,
  RequestStatus,
  Role,
  ScoreTransaction,
  SeriousCase,
  Severity,
  Student,
  Teacher,
} from './domain'
import {
  EVIDENCE_BUCKET,
  validateEvidenceFiles,
  type EvidenceAttachment,
} from './evidence'
import {
  getProfileAvatar,
  PROFILE_AVATAR_BUCKET,
  PROFILE_AVATAR_OUTPUT_BYTES,
} from './profileAvatars'
import {
  normalizeDirectorySnapshot,
  type ActivationCodeResult,
  type CreateSchoolClassroomResult,
  type CreateSchoolPersonResult,
  type PasswordResetCodeResult,
} from './schoolDirectory'
import {
  normalizeSchoolImportPreview,
  normalizeSchoolImportResult,
  type SchoolImportPreview,
  type SchoolImportResult,
} from './schoolImport'

interface QueryResult<T> {
  data: T | null
  error: { message: string } | null
}

interface ProfileRow {
  user_id: string
  role: Role
  display_name: string
  is_active: boolean
  activation_required: boolean
  avatar_preset: string | null
  avatar_path: string | null
}

interface TermRow {
  id: number | string
  name: string
  starts_on: string | null
  ends_on: string | null
  status: 'planned' | 'active' | 'closed'
}

interface RuleRow {
  id: number | string
  rule_code: string
  category: string
  title_th: string
  description_th: string | null
  default_deduction: number
  severity: Severity
  guardian_contact_required: boolean
  is_active: boolean
}

interface PositiveRuleRow {
  id: number | string
  rule_code: string
  category: string
  title_th: string
  description_th: string | null
  default_addition: number | null
  max_addition: number
  is_discretionary: boolean
  is_active: boolean
}

interface StudentRow {
  id: number | string
  user_id: string | null
  student_code: string
  title: string | null
  given_name: string
  family_name: string
  nickname: string | null
  status: string
}

interface TeacherRow {
  id: number | string
  user_id: string | null
  title: string | null
  given_name: string
  family_name: string
}

interface EnrollmentRow {
  classroom_id: number | string
  student_id: number | string
}

interface ClassroomRow {
  id: number | string
  display_name: string
  grade_level: string
  room_number: string
}

interface AssignmentRow {
  classroom_id: number | string
  teacher_id: number | string
}

interface ScoreAccountRow {
  student_id: number | string
  balance: number
  opened_at: string
}

interface StudentScoreRow {
  term_id: number | string
  balance: number
}

interface LedgerRow {
  id: number | string
  student_id: number | string
  term_id: number | string
  entry_type: string
  requested_delta: number
  applied_delta: number
  balance_before: number
  balance_after: number
  incident_id: number | string | null
  addition_request_id: number | string | null
  deduction_request_id?: number | string | null
  reason: string
  actor_user_id: string | null
  created_at: string
  positive_rule_id?: number | string | null
  positive_rule_snapshot?: Record<string, unknown> | null
  activity_occurred_at?: string | null
  internal_reason?: string | null
  evidence_note?: string | null
}

interface StudentLedgerRow extends Omit<LedgerRow, 'student_id' | 'actor_user_id' | 'addition_request_id'> {}

interface IncidentRow {
  id: number | string
  student_id: number | string
  rule_id: number | string
  severity: Severity
  occurred_at: string
}

interface StudentIncidentRow {
  id: number | string
  occurred_at: string
  recorded_at: string
  appeal_deadline: string
  appeal_id: number | string | null
  appeal_status: Appeal['status'] | null
  public_explanation?: string | null
  restored_points?: number | null
  review_version?: number | null
  appeal_created_at?: string | null
  appeal_decided_at?: string | null
}

interface RequestRow {
  id: number | string
  student_id: number | string
  positive_rule_id: number | string | null
  rule_snapshot: Record<string, unknown> | null
  requested_points: number
  approved_points: number | null
  reason: string
  evidence_note: string | null
  activity_occurred_at: string | null
  requested_by: string | null
  status: RequestStatus
  created_at: string
  reviewed_at: string | null
  review_note: string | null
}

interface DeductionRequestRow {
  id: number | string
  batch_id: number | string
  student_id: number | string
  rule_id: number | string
  rule_snapshot: Record<string, unknown>
  requested_points: number
  approved_points: number | null
  occurred_at: string
  internal_note: string | null
  requested_by: string | null
  status: RequestStatus
  created_at: string
  reviewed_at: string | null
  review_note: string | null
}

interface AppealRow {
  id: number | string
  incident_id: number | string
  student_id: number | string
  reason: string
  status: Appeal['status']
  restored_points: number
  public_explanation: string | null
  decided_at: string | null
  reopen_reason: string | null
  review_version: number
  created_at: string
}

interface CaseRow {
  id: number | string
  incident_id: number | string
  student_id: number | string
  status: SeriousCase['status']
  internal_note: string | null
  follow_up_note: string | null
  opened_at: string
  managed_at: string | null
}

interface GuardianTaskRow {
  id: number | string
  incident_id: number | string
  status: 'pending' | 'completed' | 'cancelled'
  note: string | null
  completed_at: string | null
  next_reminder_at: string | null
}

interface GuardianContactAttemptRow {
  id: number | string
  task_id: number | string
  channel: GuardianContactChannel
  outcome: GuardianContactOutcome
  note: string | null
  evidence_note: string | null
  closes_notification: boolean
  attempted_at: string
}

interface GuardianContactRow {
  contact_id: number | string
  contact_name: string
  relationship: string
  phone_number: string
  is_primary: boolean
}

const SUPABASE_PAGE_SIZE = 1000

function unwrap<T>(label: string, result: QueryResult<T>): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  if (result.data === null) throw new Error(`${label}: ไม่พบข้อมูล`)
  return result.data
}

export async function fetchAllPages<T>(
  label: string,
  loadPage: (from: number, to: number) => PromiseLike<QueryResult<T[]>>,
  pageSize = SUPABASE_PAGE_SIZE,
): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new Error(`${label}: ขนาดหน้าต้องเป็นจำนวนเต็มบวก`)
  }

  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const page = unwrap<T[]>(label, await loadPage(from, from + pageSize - 1))
    if (page.length > pageSize) {
      throw new Error(`${label}: ฐานข้อมูลส่งข้อมูลเกินขนาดหน้าที่ร้องขอ`)
    }
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

function asId(value: number | string): string {
  return String(value)
}

function fullName(row: { title: string | null; given_name: string; family_name: string }): string {
  return [row.title, row.given_name, row.family_name].filter(Boolean).join(' ')
}

function ledgerKind(entryType: string, appliedDelta: number): ScoreTransaction['kind'] {
  if (entryType === 'admin_adjustment') return 'adjustment'
  if (entryType === 'deduction' || appliedDelta < 0) return 'deduction'
  if (entryType === 'semester_opening') return 'reset'
  return 'addition'
}

export function ledgerAdditionSource(entryType: string): ScoreTransaction['additionSource'] {
  if (entryType === 'admin_addition') return 'admin_direct'
  if (entryType === 'teacher_request_approved') return 'teacher_request'
  if (entryType === 'appeal_reversal' || entryType === 'appeal_adjustment') return 'appeal'
  return undefined
}

function profileAccount(profile: ProfileRow, user: User, username: string, avatarUrl?: string): Account {
  return {
    id: user.id,
    username,
    password: '',
    displayName: profile.display_name,
    role: profile.role,
    ...(profile.avatar_preset ? { avatarPreset: profile.avatar_preset } : {}),
    ...(profile.avatar_path ? { avatarPath: profile.avatar_path } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  }
}

function mapRules(rows: RuleRow[]): BehaviorRule[] {
  return rows.map((row) => ({
    id: asId(row.id),
    code: row.rule_code,
    category: row.category,
    title: row.title_th,
    description: row.description_th ?? '',
    points: row.default_deduction,
    severity: row.severity,
    guardianContactRequired: row.guardian_contact_required,
    active: row.is_active,
  }))
}

function mapPositiveRules(rows: PositiveRuleRow[]): PositiveBehaviorRule[] {
  return rows.map((row) => ({
    id: asId(row.id),
    code: row.rule_code,
    category: row.category,
    title: row.title_th,
    description: row.description_th ?? '',
    defaultPoints: row.default_addition,
    maxPoints: row.max_addition,
    discretionary: row.is_discretionary,
    active: row.is_active,
  }))
}

function snapshotText(snapshot: Record<string, unknown> | null, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = snapshot?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function syncWarningFrom(value: Record<string, unknown>): MutationSyncWarning | undefined {
  const warning = value.syncWarning
  if (!warning || typeof warning !== 'object') return undefined
  const row = warning as Record<string, unknown>
  return row.code === 'refresh_failed' && typeof row.message === 'string'
    ? { code: 'refresh_failed', message: row.message }
    : undefined
}

function syncWarningProperty(value: Record<string, unknown>) {
  const syncWarning = syncWarningFrom(value)
  return syncWarning ? { syncWarning } : {}
}

function normalizeRecordDeductionsResult(value: unknown): RecordDeductionsResult {
  if (!value || typeof value !== 'object') throw new Error('ฐานข้อมูลไม่ส่งผลสรุปการตัดคะแนนกลับมา')
  const row = value as Record<string, unknown>
  if (!['single', 'selected', 'classroom'].includes(String(row.scope)) || !Array.isArray(row.results)) {
    throw new Error('รูปแบบผลสรุปการตัดคะแนนไม่ถูกต้อง')
  }
  const numberValue = (item: unknown): number => typeof item === 'number' ? item : Number(item)
  const optionalId = (item: unknown): string | undefined => item === null || item === undefined ? undefined : String(item)
  return {
    ok: row.ok === true,
    replayed: row.replayed === true,
    batchId: String(row.batchId ?? ''),
    scope: String(row.scope) as RecordDeductionsResult['scope'],
    ...(optionalId(row.classroomId) ? { classroomId: optionalId(row.classroomId) } : {}),
    targetCount: numberValue(row.targetCount),
    requestedPointsEach: numberValue(row.requestedPointsEach),
    ...(row.totalRequestedPoints === undefined ? {} : { totalRequestedPoints: numberValue(row.totalRequestedPoints) }),
    totalAppliedPoints: numberValue(row.totalAppliedPoints),
    alreadyAtZeroCount: numberValue(row.alreadyAtZeroCount),
    guardianTaskCount: numberValue(row.guardianTaskCount),
    results: row.results.map((result) => {
      const item = result as Record<string, unknown>
      return {
        studentId: String(item.studentId ?? ''),
        incidentId: String(item.incidentId ?? ''),
        requestedPoints: numberValue(item.requestedPoints),
        appliedPoints: numberValue(item.appliedPoints),
        balanceBefore: numberValue(item.balanceBefore),
        balanceAfter: numberValue(item.balanceAfter),
      }
    }),
    ...syncWarningProperty(row),
  }
}

function normalizeRequestDeductionsResult(value: unknown): RequestDeductionsResult {
  if (!value || typeof value !== 'object') throw new Error('ฐานข้อมูลไม่ส่งผลสรุปคำขอตัดคะแนนกลับมา')
  const row = value as Record<string, unknown>
  if (!['single', 'selected', 'classroom'].includes(String(row.scope)) || !Array.isArray(row.requests)) {
    throw new Error('รูปแบบผลสรุปคำขอตัดคะแนนไม่ถูกต้อง')
  }
  return {
    ok: row.ok === true,
    replayed: row.replayed === true,
    batchId: String(row.batchId ?? ''),
    scope: String(row.scope) as RequestDeductionsResult['scope'],
    ...(row.classroomId === null || row.classroomId === undefined ? {} : { classroomId: String(row.classroomId) }),
    targetCount: Number(row.targetCount),
    requestedPointsEach: Number(row.requestedPointsEach),
    requests: row.requests.map((value) => {
      const item = value as Record<string, unknown>
      return {
        studentId: String(item.studentId ?? ''),
        requestId: String(item.requestId ?? ''),
        status: 'pending' as const,
      }
    }),
    ...syncWarningProperty(row),
  }
}

function normalizeAdminAddPointsResult(value: unknown): AdminAddPointsResult {
  if (!value || typeof value !== 'object') throw new Error('ฐานข้อมูลไม่ส่งผลสรุปการเพิ่มคะแนนกลับมา')
  const row = value as Record<string, unknown>
  const numberValue = (item: unknown): number => typeof item === 'number' ? item : Number(item)
  const result = {
    ok: row.ok === true,
    replayed: row.replayed === true,
    ledgerId: String(row.ledgerId ?? ''),
    studentId: String(row.studentId ?? ''),
    requestedPoints: numberValue(row.requestedPoints),
    appliedPoints: numberValue(row.appliedPoints),
    balanceBefore: numberValue(row.balanceBefore),
    balanceAfter: numberValue(row.balanceAfter),
    ...syncWarningProperty(row),
  }
  if (!result.ok || !result.ledgerId || !result.studentId || [result.requestedPoints, result.appliedPoints, result.balanceBefore, result.balanceAfter].some((item) => !Number.isFinite(item))) {
    throw new Error('รูปแบบผลสรุปการเพิ่มคะแนนไม่ถูกต้อง')
  }
  return result
}

interface PermissionGrantRow {
  id: number | string
  user_id: string
  term_id: number | string | null
}

interface RuleProposalRow {
  id: number | string
  proposed_by: string
  kind: 'deduction' | 'positive'
  title_th: string
  description_th: string | null
  points: number
  is_discretionary: boolean
  status: RequestStatus
  review_note: string | null
  created_at: string
}
interface StudentProfileCardRow { student_id: number | string; nickname: string | null; avatar_preset: string | null; avatar_path: string | null; avatar_updated_at: string | null }

function normalizeAdminAdjustScoreResult(value: unknown): AdminAdjustScoreResult {
  if (!value || typeof value !== 'object') throw new Error('ฐานข้อมูลไม่ส่งผลสรุปการปรับคะแนนกลับมา')
  const row = value as Record<string, unknown>
  const result: AdminAdjustScoreResult = {
    ok: row.ok === true,
    replayed: row.replayed === true,
    ledgerId: String(row.ledgerId ?? ''),
    studentId: String(row.studentId ?? ''),
    requestedDelta: Number(row.requestedDelta),
    appliedDelta: Number(row.appliedDelta),
    balanceBefore: Number(row.balanceBefore),
    balanceAfter: Number(row.balanceAfter),
    ...syncWarningProperty(row),
  }
  if (!result.ok || !result.ledgerId || !result.studentId
    || [result.requestedDelta, result.appliedDelta, result.balanceBefore, result.balanceAfter].some((item) => !Number.isFinite(item))) {
    throw new Error('รูปแบบผลสรุปการปรับคะแนนไม่ถูกต้อง')
  }
  return result
}

function normalizeCreateRuleResult(value: unknown): CreateRuleResult {
  if (!value || typeof value !== 'object') throw new Error('ฐานข้อมูลไม่ส่งข้อมูลเกณฑ์ที่สร้างกลับมา')
  const row = value as Record<string, unknown>
  const result: CreateRuleResult = {
    ok: row.ok === true,
    id: String(row.id ?? ''),
    code: String(row.code ?? ''),
    ...syncWarningProperty(row),
  }
  if (!result.ok || !result.id || !result.code) throw new Error('รูปแบบข้อมูลเกณฑ์ที่สร้างไม่ถูกต้อง')
  return result
}

function normalizeRemoveRuleResult(value: unknown): RemoveRuleResult {
  if (!value || typeof value !== 'object') throw new Error('ฐานข้อมูลไม่ส่งผลการนำเกณฑ์ออกกลับมา')
  const row = value as Record<string, unknown>
  const outcome = String(row.outcome)
  if (row.ok !== true || (outcome !== 'deleted' && outcome !== 'archived')) {
    throw new Error('รูปแบบผลการนำเกณฑ์ออกไม่ถูกต้อง')
  }
  return { ok: true, outcome, ...syncWarningProperty(row) }
}

function normalizeRequestPointAdditionsResult(value: unknown): RequestPointAdditionsResult {
  if (!value || typeof value !== 'object') throw new Error('ฐานข้อมูลไม่ส่งผลสรุปคำขอเพิ่มคะแนนกลับมา')
  const row = value as Record<string, unknown>
  if (!['single', 'selected', 'classroom'].includes(String(row.scope)) || !Array.isArray(row.requests)) {
    throw new Error('รูปแบบผลสรุปคำขอเพิ่มคะแนนไม่ถูกต้อง')
  }
  const result: RequestPointAdditionsResult = {
    ok: row.ok === true,
    replayed: row.replayed === true,
    batchId: String(row.batchId ?? ''),
    scope: String(row.scope) as RequestPointAdditionsResult['scope'],
    classroomId: String(row.classroomId ?? ''),
    targetCount: Number(row.targetCount),
    requestedPointsEach: Number(row.requestedPointsEach),
    requests: row.requests.map((request) => {
      const item = request as Record<string, unknown>
      return {
        studentId: String(item.studentId ?? ''),
        requestId: String(item.requestId ?? ''),
        status: 'pending' as const,
      }
    }),
    ...syncWarningProperty(row),
  }
  if (!result.ok || !result.batchId || !result.classroomId || !Number.isFinite(result.targetCount)
    || result.requests.length !== result.targetCount
    || result.requests.some((item) => !item.studentId || !item.requestId)) {
    throw new Error('รูปแบบผลสรุปคำขอเพิ่มคะแนนไม่ถูกต้อง')
  }
  return result
}

function normalizeAdminAddPointsBulkResult(value: unknown): AdminAddPointsBulkResult {
  if (!value || typeof value !== 'object') throw new Error('ฐานข้อมูลไม่ส่งผลสรุปการเพิ่มคะแนนแบบกลุ่มกลับมา')
  const row = value as Record<string, unknown>
  if (!['single', 'selected', 'classroom'].includes(String(row.scope)) || !Array.isArray(row.results)) {
    throw new Error('รูปแบบผลสรุปการเพิ่มคะแนนแบบกลุ่มไม่ถูกต้อง')
  }
  const results = row.results.map((item) => normalizeAdminAddPointsResult({ ...(item as Record<string, unknown>), ok: true }))
  const result: AdminAddPointsBulkResult = {
    ok: row.ok === true,
    replayed: row.replayed === true,
    batchId: String(row.batchId ?? ''),
    scope: String(row.scope) as AdminAddPointsBulkResult['scope'],
    classroomId: String(row.classroomId ?? ''),
    targetCount: Number(row.targetCount),
    requestedPointsEach: Number(row.requestedPointsEach),
    totalAppliedPoints: Number(row.totalAppliedPoints),
    results,
    ...syncWarningProperty(row),
  }
  if (!result.ok || !result.batchId || !result.classroomId || !Number.isFinite(result.targetCount)
    || !Number.isFinite(result.totalAppliedPoints) || results.length !== result.targetCount) {
    throw new Error('รูปแบบผลสรุปการเพิ่มคะแนนแบบกลุ่มไม่ถูกต้อง')
  }
  return result
}

function normalizeGuardianContactAttemptResult(value: unknown): RecordGuardianContactAttemptResult {
  if (!value || typeof value !== 'object') {
    throw new Error('ฐานข้อมูลไม่ส่งผลการติดต่อผู้ปกครองกลับมา')
  }
  const row = value as Record<string, unknown>
  const status = String(row.status)
  if (row.ok !== true || !['pending', 'completed'].includes(status)
    || !row.attemptId || !row.taskId || typeof row.closesNotification !== 'boolean'
    || typeof row.attemptedAt !== 'string') {
    throw new Error('รูปแบบผลการติดต่อผู้ปกครองไม่ถูกต้อง')
  }
  return {
    ok: true,
    attemptId: String(row.attemptId),
    taskId: String(row.taskId),
    status: status as RecordGuardianContactAttemptResult['status'],
    closesNotification: row.closesNotification,
    attemptedAt: row.attemptedAt,
    nextReminderAt: typeof row.nextReminderAt === 'string' ? row.nextReminderAt : undefined,
    ...syncWarningProperty(row),
  }
}

function normalizePaperDocumentSnapshot(value: unknown): PaperDocumentSnapshot {
  if (!value || typeof value !== 'object') throw new Error('ข้อมูลสำหรับพิมพ์เอกสารไม่ถูกต้อง')
  const row = value as Record<string, unknown>
  const student = row.student as Record<string, unknown> | undefined
  const term = row.term as Record<string, unknown> | undefined
  const transactions = Array.isArray(row.transactions) ? row.transactions : []
  if (!student || !term || !student.id || !student.code || !student.name || !term.id) {
    throw new Error('ข้อมูลนักเรียนหรือภาคเรียนในเอกสารไม่ครบถ้วน')
  }
  const optionalText = (item: unknown): string | undefined => typeof item === 'string' && item.trim() ? item : undefined
  const incident = row.incident && typeof row.incident === 'object'
    ? row.incident as Record<string, unknown>
    : undefined
  const appeal = row.appeal && typeof row.appeal === 'object'
    ? row.appeal as Record<string, unknown>
    : undefined
  return {
    student: {
      id: String(student.id),
      code: String(student.code),
      name: String(student.name),
      classroomName: String(student.classroomName ?? ''),
      gradeLevel: optionalText(student.gradeLevel),
      roomNumber: optionalText(student.roomNumber),
    },
    term: {
      id: String(term.id),
      schoolYear: Number(term.schoolYear),
      semester: Number(term.semester),
      name: String(term.name ?? ''),
    },
    score: Number(row.score ?? 0),
    transactions: transactions.map((value) => {
      const item = value as Record<string, unknown>
      return {
        id: String(item.id ?? ''),
        occurredAt: String(item.occurredAt ?? ''),
        reason: String(item.reason ?? ''),
        appliedDelta: Number(item.appliedDelta ?? 0),
        scoreBefore: Number(item.scoreBefore ?? 0),
        scoreAfter: Number(item.scoreAfter ?? 0),
      }
    }),
    ...(incident ? {
      incident: {
        id: String(incident.id ?? ''),
        occurredAt: String(incident.occurredAt ?? ''),
        reason: String(incident.reason ?? ''),
        appliedPoints: Number(incident.appliedPoints ?? 0),
        appealDeadline: String(incident.appealDeadline ?? ''),
      },
    } : {}),
    ...(appeal ? {
      appeal: {
        id: String(appeal.id ?? ''),
        incidentId: String(appeal.incidentId ?? ''),
        status: String(appeal.status) as NonNullable<PaperDocumentSnapshot['appeal']>['status'],
        statement: String(appeal.statement ?? ''),
        restoredPoints: Number(appeal.restoredPoints ?? 0),
        publicExplanation: optionalText(appeal.publicExplanation),
        createdAt: String(appeal.createdAt ?? ''),
        decidedAt: optionalText(appeal.decidedAt),
      },
    } : {}),
  }
}

function normalizePaperDocumentRecord(value: unknown): PaperDocumentRecord {
  if (!value || typeof value !== 'object') throw new Error('ฐานข้อมูลไม่ส่งข้อมูลเอกสารกลับมา')
  const row = value as Record<string, unknown>
  const documentType = String(row.documentType)
  const status = String(row.status)
  if (!['behavior_score_summary', 'score_appeal_form', 'appeal_decision_notice'].includes(documentType)
    || !['generated', 'printed', 'received', 'delivered', 'delivery_failed', 'voided'].includes(status)
    || !row.id || !row.documentNumber || !row.studentId || !row.termId || !row.issuedAt) {
    throw new Error('รูปแบบข้อมูลเอกสารไม่ถูกต้อง')
  }
  return {
    id: String(row.id),
    documentNumber: String(row.documentNumber),
    documentType: documentType as PaperDocumentRecord['documentType'],
    status: status as PaperDocumentRecord['status'],
    studentId: String(row.studentId),
    termId: String(row.termId),
    incidentId: row.incidentId === null || row.incidentId === undefined ? undefined : String(row.incidentId),
    appealId: row.appealId === null || row.appealId === undefined ? undefined : String(row.appealId),
    issuedAt: String(row.issuedAt),
    snapshot: normalizePaperDocumentSnapshot(row.snapshot),
  }
}

export function getSessionUsername(user: User): string {
  const metadataUsername = user.user_metadata?.username
  if (typeof metadataUsername === 'string' && metadataUsername.trim()) return metadataUsername.trim().toLowerCase()
  return user.email?.split('@')[0] ?? user.id
}

async function loadProfile(client: SupabaseClient, user: User): Promise<ProfileRow> {
  const result = await client
    .from('profiles')
    .select('user_id,role,display_name,is_active,activation_required,avatar_preset,avatar_path')
    .eq('user_id', user.id)
    .maybeSingle()
  const profile = unwrap<ProfileRow>('โหลดสิทธิ์ผู้ใช้', result as QueryResult<ProfileRow>)
  if (!profile.is_active) throw new Error('บัญชีนี้ถูกระงับการใช้งาน')
  if (profile.activation_required) throw new Error('ต้องตั้งรหัสผ่านส่วนตัวก่อนใช้งานข้อมูลโรงเรียน')
  if (!['student', 'teacher', 'director', 'admin'].includes(profile.role)) throw new Error('บทบาทผู้ใช้ไม่ถูกต้อง')
  return profile
}

async function createProfileAvatarUrl(client: SupabaseClient, profile: ProfileRow): Promise<string | undefined> {
  if (!profile.avatar_path) return undefined
  if (profile.avatar_path !== `${profile.user_id}/profile.webp`) {
    throw new Error('ตำแหน่งรูปโปรไฟล์ไม่ถูกต้อง')
  }
  const { data, error } = await client.storage
    .from(PROFILE_AVATAR_BUCKET)
    .createSignedUrl(profile.avatar_path, 3600)
  if (error) throw new Error(`โหลดรูปโปรไฟล์ไม่สำเร็จ: ${error.message}`)
  const separator = data.signedUrl.includes('?') ? '&' : '?'
  return `${data.signedUrl}${separator}profile-version=${Date.now()}`
}

export function selectAccessibleTerm(role: Role, activeTerm: TermRow | null, plannedTerm: TermRow | null): TermRow | null {
  if (activeTerm) return activeTerm
  return role === 'admin' || role === 'director' ? plannedTerm : null
}

async function loadAccessibleTermAndRules(
  client: SupabaseClient,
  role: Role,
): Promise<{ term: TermRow; rules: BehaviorRule[]; positiveRules: PositiveBehaviorRule[] }> {
  const termColumns = 'id,name,starts_on,ends_on,status'
  const activeTermQuery = client
    .from('academic_terms')
    .select(termColumns)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()
  const rulesQuery = fetchAllPages<RuleRow>('โหลดระเบียบ', (from, to) => client
    .from('behavior_rules')
    .select('id,rule_code,category,title_th,description_th,default_deduction,severity,guardian_contact_required,is_active')
    .order('rule_code')
    .order('id')
    .range(from, to))
  const positiveRulesQuery = role === 'student'
    ? Promise.resolve([] as PositiveRuleRow[])
    : fetchAllPages<PositiveRuleRow>('โหลดเกณฑ์เพิ่มคะแนน', (from, to) => {
      const query = client
        .from('positive_behavior_rules')
        .select('id,rule_code,category,title_th,description_th,default_addition,max_addition,is_discretionary,is_active')
      const visibleQuery = role === 'admin' || role === 'director' ? query : query.eq('is_active', true)
      return visibleQuery.order('rule_code').order('id').range(from, to)
    })

  if (role !== 'admin' && role !== 'director') {
    const [activeResult, rulesResult, positiveRulesResult] = await Promise.all([
      activeTermQuery,
      rulesQuery,
      positiveRulesQuery,
    ])
    if (activeResult.error) throw new Error(`โหลดภาคเรียนปัจจุบัน: ${activeResult.error.message}`)
    const term = activeResult.data as TermRow | null
    if (!term) throw new Error('ภาคเรียนยังไม่เปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ')
    return {
      term,
      rules: mapRules(rulesResult),
      positiveRules: mapPositiveRules(positiveRulesResult),
    }
  }

  const plannedTermQuery = client
    .from('academic_terms')
    .select(termColumns)
    .eq('status', 'planned')
    .order('school_year', { ascending: false })
    .order('semester', { ascending: false })
    .limit(1)
    .maybeSingle()
  const [activeResult, plannedResult, rulesResult, positiveRulesResult] = await Promise.all([
    activeTermQuery,
    plannedTermQuery,
    rulesQuery,
    positiveRulesQuery,
  ])
  if (activeResult.error) throw new Error(`โหลดภาคเรียนปัจจุบัน: ${activeResult.error.message}`)
  const activeTerm = activeResult.data as TermRow | null
  let plannedTerm: TermRow | null = null
  if (!activeTerm) {
    if (plannedResult.error) throw new Error(`โหลดภาคเรียนที่วางแผนไว้: ${plannedResult.error.message}`)
    plannedTerm = plannedResult.data as TermRow | null
  }
  const term = selectAccessibleTerm(role, activeTerm, plannedTerm)
  if (!term) throw new Error('โหลดภาคเรียน: ไม่พบภาคเรียนที่กำลังใช้งานหรือวางแผนไว้')
  return {
    term,
    rules: mapRules(rulesResult),
    positiveRules: mapPositiveRules(positiveRulesResult),
  }
}

async function loadStudentState(
  client: SupabaseClient,
  user: User,
  profile: ProfileRow,
  term: TermRow,
  rules: BehaviorRule[],
): Promise<DemoState> {
  const termId = asId(term.id)
  const [avatarUrl, studentResult, enrollmentResult, classroomResult, scoreResult, history] = await Promise.all([
    createProfileAvatarUrl(client, profile),
    client.from('students').select('id,user_id,student_code,title,given_name,family_name,nickname,status').eq('user_id', user.id).maybeSingle(),
    client.from('enrollments').select('classroom_id,student_id').eq('term_id', term.id).eq('is_active', true).maybeSingle(),
    client.from('classrooms').select('id,display_name,grade_level,room_number').eq('term_id', term.id).eq('is_active', true).maybeSingle(),
    client.from('student_current_scores').select('term_id,balance').eq('term_id', term.id).maybeSingle(),
    loadMyStudentHistory(client),
  ])
  const studentRow = unwrap<StudentRow>('โหลดข้อมูลนักเรียน', studentResult as QueryResult<StudentRow>)
  const enrollment = unwrap<EnrollmentRow>('โหลดห้องเรียนของนักเรียน', enrollmentResult as QueryResult<EnrollmentRow>)
  const classroom = unwrap<ClassroomRow>('โหลดชื่อห้องเรียน', classroomResult as QueryResult<ClassroomRow>)
  const score = scoreResult.error ? (() => { throw new Error(`โหลดคะแนนปัจจุบัน: ${scoreResult.error.message}`) })() : scoreResult.data as StudentScoreRow | null
  const { ledgerRows, incidentRows } = history
  const studentId = asId(studentRow.id)
  const incidentById = new Map(incidentRows.map((row) => [asId(row.id), row]))
  const transactions: ScoreTransaction[] = ledgerRows.map((row) => {
    const incidentId = row.incident_id === null ? undefined : asId(row.incident_id)
    const incident = incidentId ? incidentById.get(incidentId) : undefined
    return {
      id: asId(row.id),
      studentId,
      termId: asId(row.term_id),
      kind: ledgerKind(row.entry_type, row.applied_delta),
      requestedDelta: row.requested_delta,
      appliedDelta: row.applied_delta,
      scoreBefore: row.balance_before,
      scoreAfter: row.balance_after,
      reason: row.reason,
      occurredAt: incident?.occurred_at ?? row.activity_occurred_at ?? row.created_at,
      actorId: '',
      incidentId,
      appealDeadline: incident?.appeal_deadline,
      additionSource: ledgerAdditionSource(row.entry_type),
    }
  })
  const transactionByIncident = new Map(
    transactions.filter((row) => row.incidentId).map((row) => [row.incidentId as string, row.id]),
  )
  const appeals: Appeal[] = incidentRows.flatMap((row) => {
    if (row.appeal_id === null || row.appeal_status === null) return []
    return [{
      id: asId(row.appeal_id),
      transactionId: transactionByIncident.get(asId(row.id)) ?? `incident-${asId(row.id)}`,
      studentId,
      statement: '',
      status: row.appeal_status,
      createdAt: row.appeal_created_at ?? row.recorded_at,
      restoredPoints: row.restored_points ?? undefined,
      decisionNote: row.public_explanation ?? undefined,
      decidedAt: row.appeal_decided_at ?? undefined,
      reviewVersion: row.review_version ?? undefined,
    }]
  })
  const student: Student = {
    id: studentId,
    studentCode: studentRow.student_code,
    name: fullName(studentRow),
    nickname: studentRow.nickname ?? undefined,
    classroomId: asId(enrollment.classroom_id),
    classroomName: classroom.display_name,
    gradeLevel: classroom.grade_level,
    roomNumber: classroom.room_number,
    score: score?.balance ?? 100,
    status: studentRow.status === 'graduated' ? 'graduated' : 'active',
  }
  const account = { ...profileAccount(profile, user, getSessionUsername(user), avatarUrl), nickname: studentRow.nickname ?? undefined, studentId }
  return {
    version: 2,
    term: {
      id: termId,
      label: term.name,
      isActive: term.status === 'active',
      startsOn: term.starts_on ?? undefined,
      endsOn: term.ends_on ?? undefined,
    },
    accounts: [account],
    students: [student],
    teachers: [],
    rules,
    positiveRules: [],
    ruleProposals: [],
    transactions,
    deductionRequests: [],
    additionRequests: [],
    appeals,
    seriousCases: [],
  }
}

export async function loadMyStudentHistory(client: SupabaseClient): Promise<{
  ledgerRows: StudentLedgerRow[]
  incidentRows: StudentIncidentRow[]
}> {
  const [ledgerRows, incidentRows] = await Promise.all([
    fetchAllPages<StudentLedgerRow>('โหลดประวัติคะแนน', (from, to) => client
      .rpc('get_my_score_history')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)),
    fetchAllPages<StudentIncidentRow>('โหลดเหตุการณ์', (from, to) => client
      .rpc('get_my_incident_history_v2')
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)),
  ])
  return { ledgerRows, incidentRows }
}

async function loadStaffState(
  client: SupabaseClient,
  user: User,
  profile: ProfileRow,
  term: TermRow,
  rules: BehaviorRule[],
  positiveRules: PositiveBehaviorRule[],
): Promise<DemoState> {
  const [studentsResult, teachersResult, enrollmentsResult, classroomsResult, assignmentsResult, scoresResult,
    ledgerResult, incidentsResult, deductionRequestsResult, requestsResult, appealsResult, casesResult, guardianResult,
    scoreScopeGrantsResult, ruleProposalsResult] = await Promise.all([
    fetchAllPages<StudentRow>('โหลดนักเรียน', (from, to) => client
      .from('students')
      .select('id,user_id,student_code,title,given_name,family_name,nickname,status')
      .order('id')
      .range(from, to)),
    fetchAllPages<TeacherRow>('โหลดครู', (from, to) => client
      .from('teachers')
      .select('id,user_id,title,given_name,family_name,status')
      .order('id')
      .range(from, to)),
    fetchAllPages<EnrollmentRow>('โหลดการลงทะเบียน', (from, to) => client
      .from('enrollments')
      .select('classroom_id,student_id')
      .eq('term_id', term.id)
      .eq('is_active', true)
      .order('student_id')
      .range(from, to)),
    fetchAllPages<ClassroomRow>('โหลดห้องเรียน', (from, to) => client
      .from('classrooms')
      .select('id,display_name,grade_level,room_number')
      .eq('term_id', term.id)
      .eq('is_active', true)
      .order('id')
      .range(from, to)),
    fetchAllPages<AssignmentRow>('โหลดห้องที่รับผิดชอบ', (from, to) => client
      .from('teacher_classroom_assignments')
      .select('classroom_id,teacher_id')
      .eq('term_id', term.id)
      .eq('is_active', true)
      .order('teacher_id')
      .order('classroom_id')
      .range(from, to)),
    fetchAllPages<ScoreAccountRow>('โหลดคะแนนปัจจุบัน', (from, to) => client
      .from('score_accounts')
      .select('student_id,balance,opened_at')
      .eq('term_id', term.id)
      .order('student_id')
      .range(from, to)),
    fetchAllPages<LedgerRow>('โหลดประวัติคะแนน', (from, to) => client
      .from('score_ledger')
      .select('id,student_id,term_id,entry_type,requested_delta,applied_delta,balance_before,balance_after,incident_id,addition_request_id,deduction_request_id,positive_rule_id,positive_rule_snapshot,activity_occurred_at,internal_reason,evidence_note,reason,actor_user_id,created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)),
    fetchAllPages<IncidentRow>('โหลดเหตุการณ์', (from, to) => client
      .from('incidents')
      .select('id,student_id,rule_id,severity,occurred_at')
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)),
    fetchAllPages<DeductionRequestRow>('โหลดคำขอตัดคะแนน', (from, to) => client
      .from('deduction_approval_requests')
      .select('id,batch_id,student_id,rule_id,rule_snapshot,requested_points,approved_points,occurred_at,internal_note,requested_by,status,created_at,reviewed_at,review_note')
      .eq('term_id', term.id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)),
    fetchAllPages<RequestRow>('โหลดคำขอเพิ่มคะแนน', (from, to) => client
      .from('point_addition_requests')
      .select('id,student_id,positive_rule_id,rule_snapshot,requested_points,approved_points,reason,evidence_note,activity_occurred_at,requested_by,status,created_at,reviewed_at,review_note')
      .eq('term_id', term.id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)),
    fetchAllPages<AppealRow>('โหลดคำอุทธรณ์', (from, to) => client
      .from('appeals')
      .select('id,incident_id,student_id,reason,status,restored_points,public_explanation,decided_at,reopen_reason,review_version,created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)),
    fetchAllPages<CaseRow>('โหลดกรณีติดตาม', (from, to) => client
      .from('follow_up_cases')
      .select('id,incident_id,student_id,status,internal_note,follow_up_note,opened_at,managed_at')
      .in('status', ['open', 'following_up'])
      .order('opened_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)),
    fetchAllPages<GuardianTaskRow>('โหลดงานติดต่อผู้ปกครอง', (from, to) => client
      .from('guardian_contact_tasks')
      .select('id,incident_id,status,note,completed_at,next_reminder_at')
      .order('id')
      .range(from, to)),
    fetchAllPages<PermissionGrantRow>('โหลดสิทธิ์ให้คะแนนข้ามชั้น', (from, to) => client
      .from('staff_permission_grants')
      .select('id,user_id,term_id')
      .eq('bundle', 'score_all_classrooms')
      .eq('term_id', term.id)
      .is('revoked_at', null)
      .order('id')
      .range(from, to)),
    fetchAllPages<RuleProposalRow>('โหลดข้อเสนอเกณฑ์', (from, to) => client
      .from('teacher_rule_proposals')
      .select('id,proposed_by,kind,title_th,description_th,points,is_discretionary,status,review_note,created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)),
  ])
  const studentRows = studentsResult
  const teacherRows = teachersResult
  const enrollments = enrollmentsResult
  const classrooms = classroomsResult
  const assignments = assignmentsResult
  const scores = scoresResult
  const ledgerRows = ledgerResult
  const incidents = incidentsResult
  const deductionRequestRows = deductionRequestsResult
  const requestRows = requestsResult
  const appealRows = appealsResult
  const caseRows = casesResult
  const guardianRows = guardianResult
  const scoreScopeGrants = scoreScopeGrantsResult
  const guardianAttemptRows = profile.role === 'admin' && guardianRows.length
    ? await runRpc<GuardianContactAttemptRow[]>(client, 'get_guardian_contact_attempts_v2', {
      p_task_ids: guardianRows.map((row) => row.id),
    })
    : []
  const profileCards = profile.role === 'director' ? [] : await runRpc<StudentProfileCardRow[]>(client, 'get_staff_student_profile_cards', {
    p_student_ids: studentRows.map((row) => row.id),
  })
  const avatarPaths = profileCards.flatMap((row) => row.avatar_path ? [row.avatar_path] : [])
  const signedAvatarUrlByPath = new Map<string, string>()
  if (avatarPaths.length) {
    const { data: signedAvatars, error: signedAvatarError } = await client.storage
      .from(PROFILE_AVATAR_BUCKET)
      .createSignedUrls(avatarPaths, 3600)
    if (signedAvatarError) throw new Error(`โหลดรูปโปรไฟล์นักเรียนไม่สำเร็จ: ${signedAvatarError.message}`)
    for (const signedAvatar of signedAvatars ?? []) {
      if (signedAvatar.path && signedAvatar.signedUrl) signedAvatarUrlByPath.set(signedAvatar.path, signedAvatar.signedUrl)
    }
  }
  const profileCardByStudent = new Map(profileCards.map((row) => [asId(row.student_id), row]))

  const classroomById = new Map(classrooms.map((row) => [asId(row.id), row]))
  const enrollmentByStudent = new Map(enrollments.map((row) => [asId(row.student_id), row]))
  const scoreByStudent = new Map(scores.map((row) => [asId(row.student_id), row]))
  const currentStudentIds = new Set(enrollments.map((row) => asId(row.student_id)))
  const students: Student[] = studentRows.filter((row) => currentStudentIds.has(asId(row.id))).map((row) => {
    const enrollment = enrollmentByStudent.get(asId(row.id))
    const classroomId = enrollment ? asId(enrollment.classroom_id) : ''
    return {
      id: asId(row.id),
      studentCode: row.student_code,
      name: fullName(row),
      nickname: row.nickname ?? undefined,
      avatarPreset: profileCardByStudent.get(asId(row.id))?.avatar_preset ?? undefined,
      avatarPath: profileCardByStudent.get(asId(row.id))?.avatar_path ?? undefined,
      avatarUrl: profileCardByStudent.get(asId(row.id))?.avatar_path
        ? signedAvatarUrlByPath.get(profileCardByStudent.get(asId(row.id))!.avatar_path!)
        : undefined,
      classroomId,
      classroomName: classroomById.get(classroomId)?.display_name ?? 'ไม่ระบุห้อง',
      gradeLevel: classroomById.get(classroomId)?.grade_level,
      roomNumber: classroomById.get(classroomId)?.room_number,
      score: scoreByStudent.get(asId(row.id))?.balance ?? 100,
      status: row.status === 'graduated' ? 'graduated' : 'active',
    }
  })
  const classroomIdsByTeacher = new Map<string, string[]>()
  for (const assignment of assignments) {
    const teacherId = asId(assignment.teacher_id)
    const next = classroomIdsByTeacher.get(teacherId) ?? []
    next.push(asId(assignment.classroom_id))
    classroomIdsByTeacher.set(teacherId, next)
  }
  const teachers: Teacher[] = teacherRows.map((row) => ({
    id: asId(row.id),
    userId: row.user_id ?? undefined,
    name: fullName(row),
    classroomIds: classroomIdsByTeacher.get(asId(row.id)) ?? [],
    canScoreAllClassrooms: scoreScopeGrants.some((grant) => grant.user_id === row.user_id),
    scoreAllClassroomsGrantId: scoreScopeGrants.find((grant) => grant.user_id === row.user_id)
      ? asId(scoreScopeGrants.find((grant) => grant.user_id === row.user_id)!.id)
      : undefined,
  }))
  const ruleProposals: RuleProposal[] = ruleProposalsResult.map((row) => ({
    id: asId(row.id),
    proposedBy: row.proposed_by,
    kind: row.kind,
    title: row.title_th,
    description: row.description_th ?? undefined,
    points: row.points,
    discretionary: row.is_discretionary,
    status: row.status,
    reviewNote: row.review_note ?? undefined,
    createdAt: row.created_at,
  }))
  const teacherIdByUserId = new Map(teacherRows.filter((row) => row.user_id).map((row) => [row.user_id as string, asId(row.id)]))
  const incidentById = new Map(incidents.map((row) => [asId(row.id), row]))
  const transactions: ScoreTransaction[] = ledgerRows.map((row) => {
    const incidentId = row.incident_id === null ? undefined : asId(row.incident_id)
    const incident = incidentId ? incidentById.get(incidentId) : undefined
    return {
      id: asId(row.id),
      studentId: asId(row.student_id),
      termId: asId(row.term_id),
      kind: ledgerKind(row.entry_type, row.applied_delta),
      requestedDelta: row.requested_delta,
      appliedDelta: row.applied_delta,
      scoreBefore: row.balance_before,
      scoreAfter: row.balance_after,
      ruleId: incident ? asId(incident.rule_id) : undefined,
      reason: row.reason,
      occurredAt: incident?.occurred_at ?? row.activity_occurred_at ?? row.created_at,
      actorId: row.actor_user_id ?? '',
      incidentId,
      sourceRequestId: row.deduction_request_id !== null && row.deduction_request_id !== undefined
        ? asId(row.deduction_request_id)
        : row.addition_request_id === null ? undefined : asId(row.addition_request_id),
      positiveRuleId: row.positive_rule_id === null || row.positive_rule_id === undefined ? undefined : asId(row.positive_rule_id),
      positiveRuleTitle: snapshotText(row.positive_rule_snapshot ?? null, 'title_th', 'title'),
      activityOccurredAt: row.activity_occurred_at ?? undefined,
      evidenceNote: row.evidence_note ?? undefined,
      internalReason: row.internal_reason ?? undefined,
      additionSource: ledgerAdditionSource(row.entry_type),
    }
  })
  const transactionByIncident = new Map(
    transactions.filter((row) => row.incidentId).map((row) => [row.incidentId as string, row.id]),
  )
  const positiveRuleById = new Map(positiveRules.map((rule) => [rule.id, rule]))
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]))
  const deductionRequests: DeductionRequest[] = deductionRequestRows.map((row) => {
    const ruleId = asId(row.rule_id)
    return {
      id: asId(row.id),
      batchId: asId(row.batch_id),
      studentId: asId(row.student_id),
      teacherId: row.requested_by ? teacherIdByUserId.get(row.requested_by) ?? row.requested_by : '',
      ruleId,
      ruleTitle: snapshotText(row.rule_snapshot, 'title_th', 'title') ?? ruleById.get(ruleId)?.title ?? 'เหตุการณ์ตามระเบียบ',
      requestedPoints: row.requested_points,
      approvedPoints: row.approved_points ?? undefined,
      occurredAt: row.occurred_at,
      internalNote: row.internal_note ?? '',
      status: row.status,
      createdAt: row.created_at,
      decidedAt: row.reviewed_at ?? undefined,
      decisionNote: row.review_note ?? undefined,
    }
  })
  const additionRequests = requestRows.map((row) => {
    const positiveRuleId = row.positive_rule_id === null ? undefined : asId(row.positive_rule_id)
    const positiveRule = positiveRuleId ? positiveRuleById.get(positiveRuleId) : undefined
    return {
      id: asId(row.id),
      studentId: asId(row.student_id),
      teacherId: row.requested_by ? teacherIdByUserId.get(row.requested_by) ?? row.requested_by : '',
      positiveRuleId,
      positiveRuleCode: snapshotText(row.rule_snapshot, 'rule_code', 'code') ?? positiveRule?.code,
      positiveRuleTitle: snapshotText(row.rule_snapshot, 'title_th', 'title') ?? positiveRule?.title,
      requestedPoints: row.requested_points,
      approvedPoints: row.approved_points ?? undefined,
      reason: row.reason,
      evidenceNote: row.evidence_note ?? undefined,
      activityOccurredAt: row.activity_occurred_at ?? undefined,
      status: row.status,
      createdAt: row.created_at,
      decidedAt: row.reviewed_at ?? undefined,
      decisionNote: row.review_note ?? undefined,
    }
  })
  const appeals: Appeal[] = appealRows.map((row) => ({
    id: asId(row.id),
    transactionId: transactionByIncident.get(asId(row.incident_id)) ?? `incident-${asId(row.incident_id)}`,
    studentId: asId(row.student_id),
    statement: row.reason,
    status: row.status,
    createdAt: row.created_at,
    restoredPoints: row.restored_points,
    decisionNote: row.public_explanation ?? undefined,
    decidedAt: row.decided_at ?? undefined,
    reopenReason: row.reopen_reason ?? undefined,
    reviewVersion: row.review_version,
  }))
  const guardianAttemptsByTask = new Map<string, GuardianContactAttempt[]>()
  for (const row of guardianAttemptRows) {
    const taskId = asId(row.task_id)
    const attempts = guardianAttemptsByTask.get(taskId) ?? []
    attempts.push({
      id: asId(row.id),
      channel: row.channel,
      outcome: row.outcome,
      note: row.note ?? undefined,
      evidenceNote: row.evidence_note ?? undefined,
      createdAt: row.attempted_at,
    })
    guardianAttemptsByTask.set(taskId, attempts)
  }
  const guardianByIncident = new Map(guardianRows.map((row) => [asId(row.incident_id), row]))
  const seriousCases: SeriousCase[] = caseRows.map((row) => {
    const incidentId = asId(row.incident_id)
    const incident = incidentById.get(incidentId)
    const guardian = guardianByIncident.get(incidentId)
    return {
      id: asId(row.id),
      transactionId: transactionByIncident.get(incidentId) ?? `incident-${incidentId}`,
      studentId: asId(row.student_id),
      severity: incident?.severity === 'critical' ? 'critical' : 'serious',
      status: row.status,
      guardianContactRequired: Boolean(guardian),
      guardianContactStatus: !guardian ? 'not_required' : guardian.status === 'completed' ? 'completed' : 'pending',
      guardianTaskId: guardian ? asId(guardian.id) : undefined,
      guardianContactNote: guardian?.note ?? undefined,
      guardianContactCompletedAt: guardian?.completed_at ?? undefined,
      guardianNextReminderAt: guardian?.next_reminder_at ?? undefined,
      guardianContactAttempts: guardian ? guardianAttemptsByTask.get(asId(guardian.id)) ?? [] : [],
      createdAt: row.opened_at,
      internalNote: row.internal_note ?? '',
      followUpNote: row.follow_up_note ?? undefined,
      managedAt: row.managed_at ?? undefined,
    }
  })
  const currentTeacherId = teacherIdByUserId.get(user.id)
  const account = {
    ...profileAccount(profile, user, getSessionUsername(user)),
    ...(profile.role === 'teacher' ? { teacherId: currentTeacherId } : {}),
  }
  const allAccountsInitialized = enrollments.length > 0 && scores.length >= enrollments.length
  const initializedAt = allAccountsInitialized
    ? scores.reduce<string | undefined>((latest, row) => !latest || row.opened_at > latest ? row.opened_at : latest, undefined)
    : undefined
  return {
    version: 2,
    term: {
      id: asId(term.id),
      label: term.name,
      isActive: term.status === 'active',
      startsOn: term.starts_on ?? undefined,
      endsOn: term.ends_on ?? undefined,
      resetCompletedAt: initializedAt,
    },
    accounts: [account],
    students,
    teachers,
    rules,
    positiveRules,
    ruleProposals,
    transactions,
    deductionRequests,
    additionRequests,
    appeals,
    seriousCases,
  }
}

export async function loadSupabaseState(client: SupabaseClient, user: User): Promise<DemoState> {
  const profile = await loadProfile(client, user)
  const { term, rules, positiveRules } = await loadAccessibleTermAndRules(client, profile.role)
  return profile.role === 'student'
    ? loadStudentState(client, user, profile, term, rules)
    : loadStaffState(client, user, profile, term, rules, positiveRules)
}

async function runRpc<T>(client: SupabaseClient, name: string, parameters: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, parameters)
  if (error) throw new Error(error.message)
  return data as T
}

async function invokeAdminDirectory<T>(
  client: SupabaseClient,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.functions.invoke('admin-directory', { body })
  if (error) {
    let detail = error.message
    const context = 'context' in error ? error.context : undefined
    if (context instanceof Response) {
      try {
        const payload = await context.clone().json() as { error?: unknown }
        if (typeof payload.error === 'string' && payload.error.trim()) detail = payload.error
      } catch {
        // Keep the SDK error when the server did not return a JSON explanation.
      }
    }
    throw new Error(detail)
  }
  if (!data || data.ok !== true) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'บริการศูนย์บริหารโรงเรียนไม่ส่งผลลัพธ์กลับมา')
  }
  return data.data as T
}

async function invokeAdminSchoolImport<T>(
  client: SupabaseClient,
  file: File,
  mode: 'preview' | 'apply',
  fingerprint = '',
): Promise<T> {
  const body = new FormData()
  body.append('mode', mode)
  body.append('file', file, file.name)
  if (fingerprint) body.append('fingerprint', fingerprint)
  const { data, error } = await client.functions.invoke('admin-school-import', { body })
  if (error) {
    let detail = error.message
    const context = 'context' in error ? error.context : undefined
    if (context instanceof Response) {
      try {
        const payload = await context.clone().json() as { error?: unknown }
        if (typeof payload.error === 'string' && payload.error.trim()) detail = payload.error
      } catch {
        // Keep the SDK error when the server did not return a JSON explanation.
      }
    }
    throw new Error(detail)
  }
  if (!data || data.ok !== true) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'บริการนำเข้าข้อมูลไม่ส่งผลลัพธ์กลับมา')
  }
  return data.data as T
}

const evidenceExtensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
}

function assertSafeEvidencePath(path: string): void {
  const parts = path.split('/')
  if (parts.length !== 3 || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('ตำแหน่งไฟล์หลักฐานไม่ถูกต้อง')
  }
}

export function createSupabaseActions(
  client: SupabaseClient,
  refresh: () => Promise<void>,
  onSyncWarning?: (warning: MutationSyncWarning) => void,
): AppDataActions {
  const refreshAfterMutation = async (): Promise<MutationSyncWarning | undefined> => {
    try {
      await refresh()
      return undefined
    } catch (error) {
      const warning: MutationSyncWarning = {
        code: 'refresh_failed',
        message: error instanceof Error ? error.message : 'บันทึกสำเร็จ แต่โหลดข้อมูลล่าสุดไม่สำเร็จ',
      }
      onSyncWarning?.(warning)
      return warning
    }
  }
  const mutate = async <T>(name: string, parameters: Record<string, unknown>): Promise<T> => {
    const result = await runRpc<T>(client, name, parameters)
    const warning = await refreshAfterMutation()
    if (warning) {
      // The RPC already succeeded. Keep that outcome distinct from a stale UI
      // snapshot so callers never present a completed write as a failed write.
      if (result && typeof result === 'object') {
        Object.assign(result, {
          syncWarning: warning,
        })
      }
    }
    return result
  }
  return {
    uploadEvidenceFiles: async (files) => {
      const validationError = validateEvidenceFiles(files)
      if (validationError) throw new Error(validationError)
      const { data: sessionData, error: sessionError } = await client.auth.getSession()
      if (sessionError) throw new Error(`ตรวจสอบสิทธิ์อัปโหลดหลักฐานไม่สำเร็จ: ${sessionError.message}`)
      const userId = sessionData.session?.user.id
      if (!userId) throw new Error('กรุณาเข้าสู่ระบบใหม่ก่อนอัปโหลดหลักฐาน')

      const uploadedPaths: string[] = []
      try {
        const attachments: EvidenceAttachment[] = []
        for (const file of files) {
          const extension = evidenceExtensions[file.type]
          if (!extension) throw new Error(`ไม่รองรับชนิดไฟล์ ${file.name}`)
          const path = `${userId}/${new Date().toISOString().slice(0, 10)}/${globalThis.crypto.randomUUID()}.${extension}`
          const { error } = await client.storage.from(EVIDENCE_BUCKET).upload(path, file, {
            cacheControl: '3600',
            contentType: file.type,
            upsert: false,
          })
          if (error) throw new Error(`อัปโหลด ${file.name} ไม่สำเร็จ: ${error.message}`)
          uploadedPaths.push(path)
          attachments.push({
            path,
            name: file.name,
            size: file.size,
            contentType: file.type,
          })
        }
        return attachments
      } catch (error) {
        if (uploadedPaths.length) {
          await client.storage.from(EVIDENCE_BUCKET).remove(uploadedPaths)
        }
        throw error
      }
    },
    createEvidenceUrl: async (attachment) => {
      assertSafeEvidencePath(attachment.path)
      const { data, error } = await client.storage
        .from(EVIDENCE_BUCKET)
        .createSignedUrl(attachment.path, 300, { download: attachment.name })
      if (error) throw new Error(`ไม่สามารถเปิดไฟล์หลักฐานได้: ${error.message}`)
      return data.signedUrl
    },
    recordDeductions: async (input) => normalizeRecordDeductionsResult(
      await mutate<unknown>('record_deductions_bulk', {
        p_client_request_id: input.clientRequestId,
        p_scope: input.scope,
        p_student_ids: input.studentIds,
        p_classroom_id: input.classroomId ?? null,
        p_rule_id: input.ruleId,
        p_occurred_at: input.occurredAt,
        p_student_visible_note: input.studentVisibleNote?.trim() || null,
        p_internal_note: input.internalNote.trim(),
        p_confirm_serious_bulk: input.confirmSeriousBulk,
      }),
    ),
    requestDeductions: async (input) => normalizeRequestDeductionsResult(
      await mutate<unknown>('request_deductions_bulk_v1', {
        p_client_request_id: input.clientRequestId,
        p_scope: input.scope,
        p_student_ids: input.studentIds,
        p_classroom_id: input.classroomId ?? null,
        p_rule_id: input.ruleId,
        p_occurred_at: input.occurredAt,
        p_student_visible_note: input.studentVisibleNote?.trim() || null,
        p_internal_note: input.internalNote.trim(),
        p_confirm_serious_bulk: input.confirmSeriousBulk,
      }),
    ),
    reviewDeduction: (input) => mutate<void>('review_deduction_request_v1', {
      p_request_id: input.requestId,
      p_approve: input.approve,
      p_approved_points: input.approvedPoints,
      p_review_note: input.note ?? null,
    }),
    requestPointAddition: (input) => mutate<void>('request_point_addition_v2', {
      p_client_request_id: input.clientRequestId,
      p_student_id: input.studentId,
      p_positive_rule_id: input.positiveRuleId,
      p_points: input.points,
      p_activity_occurred_at: input.activityOccurredAt,
      p_reason: input.reason.trim(),
      p_evidence_note: input.evidenceNote.trim(),
    }),
    requestPointAdditions: async (input) => normalizeRequestPointAdditionsResult(
      await mutate<unknown>('request_point_additions_bulk_v2', {
        p_client_request_id: input.clientRequestId,
        p_scope: input.scope,
        p_student_ids: input.studentIds,
        p_classroom_id: input.classroomId,
        p_positive_rule_id: input.positiveRuleId,
        p_points: input.points,
        p_activity_occurred_at: input.activityOccurredAt,
        p_reason: input.reason.trim(),
        p_evidence_note: input.evidenceNote.trim(),
      }),
    ),
    submitAppeal: (input) => mutate<void>('submit_appeal', {
      p_incident_id: input.incidentId,
      p_reason: input.reason,
    }),
    reviewPointAddition: (input) => mutate<void>('review_point_addition_v2', {
      p_request_id: input.requestId,
      p_approve: input.approve,
      p_approved_points: input.approvedPoints,
      p_review_note: input.note ?? null,
    }),
    reviewAppeal: (input) => mutate<void>('review_appeal_v2', {
      p_appeal_id: input.appealId,
      p_restored_points: input.restoredPoints,
      p_public_explanation: input.note,
    }),
    reopenAppeal: (input) => mutate<void>('reopen_appeal_v2', {
      p_appeal_id: input.appealId,
      p_reason: input.reason.trim(),
    }),
    adminAddPoints: async (input) => normalizeAdminAddPointsResult(
      await mutate<unknown>('admin_add_points_detailed', {
        p_client_request_id: input.clientRequestId,
        p_student_id: input.studentId,
        p_positive_rule_id: input.positiveRuleId,
        p_points: input.points,
        p_activity_occurred_at: input.activityOccurredAt,
        p_reason: input.reason.trim(),
        p_evidence_note: input.evidenceNote.trim(),
        p_term_id: input.termId,
      }),
    ),
    adminAddPointsBulk: async (input) => normalizeAdminAddPointsBulkResult(
      await mutate<unknown>('admin_add_points_bulk', {
        p_client_request_id: input.clientRequestId,
        p_scope: input.scope,
        p_student_ids: input.studentIds,
        p_classroom_id: input.classroomId,
        p_positive_rule_id: input.positiveRuleId,
        p_points: input.points,
        p_activity_occurred_at: input.activityOccurredAt,
        p_reason: input.reason.trim(),
        p_evidence_note: input.evidenceNote.trim(),
        p_term_id: input.termId,
      }),
    ),
    adminAdjustScore: async (input) => normalizeAdminAdjustScoreResult(
      await mutate<unknown>('admin_adjust_score', {
        p_client_request_id: input.clientRequestId,
        p_student_id: input.studentId,
        p_delta: input.delta,
        p_activity_occurred_at: input.occurredAt,
        p_reason: input.reason.trim(),
        p_term_id: input.termId,
      }),
    ),
    createBehaviorRule: async (input) => normalizeCreateRuleResult(
      await mutate<unknown>('admin_create_behavior_rule', {
        p_title: input.title.trim(),
        p_points: input.points,
        p_description: input.description?.trim() || null,
      }),
    ),
    createPositiveRule: async (input) => normalizeCreateRuleResult(
      await mutate<unknown>('admin_create_positive_rule', {
        p_title: input.title.trim(),
        p_points: input.points,
        p_is_discretionary: input.discretionary,
        p_description: input.description?.trim() || null,
      }),
    ),
    proposeRule: async (input) => ({
      id: asId(await mutate<number | string>('teacher_propose_rule', {
        p_kind: input.kind,
        p_title: input.title.trim(),
        p_points: input.points,
        p_description: input.description?.trim() || null,
        p_is_discretionary: input.discretionary ?? false,
      })),
    }),
    reviewRuleProposal: (input) => mutate<void>('admin_review_teacher_rule', {
      p_proposal_id: input.proposalId,
      p_approve: input.approve,
      p_note: input.note?.trim() || null,
    }),
    updateBehaviorRule: async (input) => {
      const result = await mutate<Record<string, unknown>>('admin_update_behavior_rule', {
        p_rule_id: input.ruleId,
        p_title: input.title.trim(),
        p_points: input.points,
        p_description: input.description?.trim() || null,
      })
      const id = result.id
      if (typeof id !== 'string' && typeof id !== 'number') throw new Error('ฐานข้อมูลไม่ส่งรหัสเกณฑ์ฉบับใหม่กลับมา')
      return { id: asId(id) }
    },
    updatePositiveRule: async (input) => {
      const result = await mutate<Record<string, unknown>>('admin_update_positive_rule', {
        p_rule_id: input.ruleId,
        p_title: input.title.trim(),
        p_points: input.points,
        p_is_discretionary: input.discretionary,
        p_description: input.description?.trim() || null,
      })
      const id = result.id
      if (typeof id !== 'string' && typeof id !== 'number') throw new Error('ฐานข้อมูลไม่ส่งรหัสเกณฑ์ฉบับใหม่กลับมา')
      return { id: asId(id) }
    },
    removeBehaviorRule: async (ruleId) => normalizeRemoveRuleResult(
      await mutate<unknown>('admin_remove_behavior_rule', { p_rule_id: ruleId }),
    ),
    removePositiveRule: async (ruleId) => normalizeRemoveRuleResult(
      await mutate<unknown>('admin_remove_positive_rule', { p_rule_id: ruleId }),
    ),
    initializeTermScores: (termId) => mutate<void>('initialize_term_scores', { p_term_id: termId }),
    updateTermSchedule: (input) => mutate<void>('admin_update_term_schedule', {
      p_term_id: input.termId,
      p_starts_on: input.startsOn,
      p_ends_on: input.endsOn,
    }),
    updateTeacherClassrooms: (input) => mutate<void>('admin_set_teacher_classrooms', {
      p_term_id: input.termId,
      p_teacher_id: input.teacherId,
      p_classroom_ids: [...new Set(input.classroomIds)],
    }),
    setTeacherSchoolwideScoring: (input) => input.enabled
      ? mutate<void>('admin_set_score_all_classrooms_grant', {
        p_user_id: input.teacherUserId,
        p_term_id: input.termId,
        p_reason: input.reason.trim(),
      })
      : mutate<void>('admin_revoke_score_all_classrooms_grant', {
        p_grant_id: input.grantId,
        p_reason: input.reason.trim(),
      }),
    getGuardianContacts: async (taskId) => {
      const rows = await runRpc<GuardianContactRow[]>(client, 'get_guardian_contacts_for_task', {
        p_task_id: taskId,
      })
      return rows.map((row): GuardianContact => ({
        id: asId(row.contact_id),
        name: row.contact_name,
        relationship: row.relationship,
        phoneNumber: row.phone_number,
        isPrimary: row.is_primary,
      }))
    },
    recordGuardianContactAttempt: async (input) => {
      const clientRequestId = input.clientRequestId ?? globalThis.crypto.randomUUID()
      return normalizeGuardianContactAttemptResult(
        await mutate<unknown>('record_guardian_contact_attempt_v3', {
          p_client_request_id: clientRequestId,
          p_task_id: input.taskId,
          p_channel: input.channel,
          p_outcome: input.outcome,
          p_note: input.note?.trim() || null,
          p_evidence_note: input.evidenceNote?.trim() || null,
        }),
      )
    },
    completeGuardianContact: (input) => mutate<void>('complete_guardian_contact_task', {
      p_task_id: input.taskId,
      p_note: input.note.trim(),
    }),
    updateFollowUpCase: (input) => mutate<void>('admin_update_follow_up_case', {
      p_case_id: input.caseId,
      p_status: input.status,
      p_note: input.note.trim(),
    }),
    getPaperDocuments: async (termId) => {
      const rows = await runRpc<unknown[]>(client, 'list_paper_documents_v1', { p_term_id: termId })
      return rows.map(normalizePaperDocumentRecord)
    },
    issuePaperDocument: async (input) => normalizePaperDocumentRecord(
      await runRpc<unknown>(client, 'issue_paper_document_v1', {
        p_document_type: input.documentType,
        p_student_id: input.studentId,
        p_term_id: input.termId,
        p_incident_id: input.incidentId ?? null,
        p_appeal_id: input.appealId ?? null,
      }),
    ),
    recordPaperDocumentEvent: async (input) => normalizePaperDocumentRecord(
      await runRpc<unknown>(client, 'record_paper_document_event_v1', {
        p_document_id: input.documentId,
        p_event_type: input.eventType,
        p_note: input.note?.trim() || null,
      }),
    ),
    submitPaperAppeal: (input) => mutate<void>('submit_paper_appeal_v1', {
      p_document_id: input.documentId,
      p_reason: input.reason.trim(),
      p_received_at: input.receivedAt,
    }),
    setMyAvatarPreset: async (preset) => {
      if (!getProfileAvatar(preset)) throw new Error('ไม่พบตัวการ์ตูนที่เลือก')
      const result = await runRpc<{ previousPath?: string | null }>(client, 'update_my_profile_avatar', {
        p_preset: preset,
        p_avatar_path: null,
      })
      if (result.previousPath) {
        await client.storage.from(PROFILE_AVATAR_BUCKET).remove([result.previousPath])
      }
      await refreshAfterMutation()
    },
    updateMyNickname: async (nickname) => {
      await runRpc(client, 'update_my_student_nickname', { p_nickname: nickname.trim() || null })
      await refreshAfterMutation()
    },
    uploadMyAvatar: async (file) => {
      if (file.type !== 'image/webp') throw new Error('รูปโปรไฟล์ต้องเป็นไฟล์ WEBP ที่ระบบเตรียมไว้')
      if (file.size > PROFILE_AVATAR_OUTPUT_BYTES) throw new Error('รูปโปรไฟล์มีขนาดเกิน 2 MB')
      const { data: sessionData, error: sessionError } = await client.auth.getSession()
      if (sessionError) throw new Error(`ตรวจสอบสิทธิ์อัปโหลดรูปไม่สำเร็จ: ${sessionError.message}`)
      const userId = sessionData.session?.user.id
      if (!userId) throw new Error('กรุณาเข้าสู่ระบบใหม่ก่อนอัปโหลดรูป')
      const path = `${userId}/profile.webp`
      const { error: uploadError } = await client.storage.from(PROFILE_AVATAR_BUCKET).upload(path, file, {
        cacheControl: '0',
        contentType: 'image/webp',
        upsert: true,
      })
      if (uploadError) throw new Error(`อัปโหลดรูปโปรไฟล์ไม่สำเร็จ: ${uploadError.message}`)
      await runRpc(client, 'update_my_profile_avatar', {
        p_preset: null,
        p_avatar_path: path,
      })
      await refreshAfterMutation()
    },
    activateTerm: (termId) => mutate<void>('admin_activate_term', { p_term_id: termId }),
    getSchoolDirectory: async () => normalizeDirectorySnapshot(
      await invokeAdminDirectory<unknown>(client, { action: 'snapshot' }),
    ),
    createSchoolClassroom: async (input) => {
      const classroom = await invokeAdminDirectory<CreateSchoolClassroomResult>(client, {
        action: 'create-classroom',
        input,
      })
      await refreshAfterMutation()
      return classroom
    },
    createSchoolPerson: async (input) => {
      const result = await invokeAdminDirectory<CreateSchoolPersonResult>(client, {
        action: 'create-person',
        input,
      })
      await refreshAfterMutation()
      return result
    },
    updateSchoolStudent: async (input) => {
      await invokeAdminDirectory<void>(client, { action: 'update-student', input })
      await refreshAfterMutation()
    },
    updateSchoolStaff: async (input) => {
      await invokeAdminDirectory<void>(client, { action: 'update-staff', input })
      await refreshAfterMutation()
    },
    issueActivationCode: (username) => invokeAdminDirectory<ActivationCodeResult>(client, {
      action: 'issue-activation',
      input: { username },
    }),
    resetSchoolAccountPassword: (input) => invokeAdminDirectory<PasswordResetCodeResult>(client, {
      action: 'reset-password',
      input,
    }),
    previewSchoolImport: async (file): Promise<SchoolImportPreview> => normalizeSchoolImportPreview(
      await invokeAdminSchoolImport<unknown>(client, file, 'preview'),
    ),
    applySchoolImport: async (file, fingerprint): Promise<SchoolImportResult> => {
      const result = normalizeSchoolImportResult(
        await invokeAdminSchoolImport<unknown>(client, file, 'apply', fingerprint),
      )
      await refreshAfterMutation()
      return result
    },
  }
}
