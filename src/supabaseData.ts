import type { SupabaseClient, User } from '@supabase/supabase-js'
import type {
  AdminAddPointsBulkResult,
  AdminAddPointsResult,
  AppDataActions,
  RecordDeductionsResult,
  RequestPointAdditionsResult,
} from './dataActions'
import type {
  Account,
  Appeal,
  BehaviorRule,
  DemoState,
  GuardianContact,
  PositiveBehaviorRule,
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
  category: string
  title_th: string
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
  appeal_created_at?: string | null
}

interface RequestRow {
  id: number | string
  student_id: number | string
  positive_rule_id: number | string | null
  rule_snapshot: Record<string, unknown> | null
  requested_points: number
  reason: string
  evidence_note: string | null
  activity_occurred_at: string | null
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

function ledgerKind(entryType: string): ScoreTransaction['kind'] {
  if (entryType === 'deduction') return 'deduction'
  if (entryType === 'semester_opening') return 'reset'
  return 'addition'
}

function profileAccount(profile: ProfileRow, user: User, username: string): Account {
  return {
    id: user.id,
    username,
    password: '',
    displayName: profile.display_name,
    role: profile.role,
  }
}

function mapRules(rows: RuleRow[]): BehaviorRule[] {
  return rows.map((row) => ({
    id: asId(row.id),
    category: row.category,
    title: row.title_th,
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
  }
  if (!result.ok || !result.ledgerId || !result.studentId || [result.requestedPoints, result.appliedPoints, result.balanceBefore, result.balanceAfter].some((item) => !Number.isFinite(item))) {
    throw new Error('รูปแบบผลสรุปการเพิ่มคะแนนไม่ถูกต้อง')
  }
  return result
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
  }
  if (!result.ok || !result.batchId || !result.classroomId || !Number.isFinite(result.targetCount)
    || !Number.isFinite(result.totalAppliedPoints) || results.length !== result.targetCount) {
    throw new Error('รูปแบบผลสรุปการเพิ่มคะแนนแบบกลุ่มไม่ถูกต้อง')
  }
  return result
}

export function getSessionUsername(user: User): string {
  const metadataUsername = user.user_metadata?.username
  if (typeof metadataUsername === 'string' && metadataUsername.trim()) return metadataUsername.trim().toLowerCase()
  return user.email?.split('@')[0] ?? user.id
}

async function loadProfile(client: SupabaseClient, user: User): Promise<ProfileRow> {
  const result = await client
    .from('profiles')
    .select('user_id,role,display_name,is_active,activation_required')
    .eq('user_id', user.id)
    .maybeSingle()
  const profile = unwrap<ProfileRow>('โหลดสิทธิ์ผู้ใช้', result as QueryResult<ProfileRow>)
  if (!profile.is_active) throw new Error('บัญชีนี้ถูกระงับการใช้งาน')
  if (profile.activation_required) throw new Error('ต้องตั้งรหัสผ่านส่วนตัวก่อนใช้งานข้อมูลโรงเรียน')
  if (!['student', 'teacher', 'admin'].includes(profile.role)) throw new Error('บทบาทผู้ใช้ไม่ถูกต้อง')
  return profile
}

export function selectAccessibleTerm(role: Role, activeTerm: TermRow | null, plannedTerm: TermRow | null): TermRow | null {
  if (activeTerm) return activeTerm
  return role === 'admin' ? plannedTerm : null
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
    .select('id,category,title_th,default_deduction,severity,guardian_contact_required,is_active')
    .order('rule_code')
    .order('id')
    .range(from, to))
  const positiveRulesQuery = role === 'student'
    ? Promise.resolve([] as PositiveRuleRow[])
    : fetchAllPages<PositiveRuleRow>('โหลดเกณฑ์เพิ่มคะแนน', (from, to) => client
      .from('positive_behavior_rules')
      .select('id,rule_code,category,title_th,description_th,default_addition,max_addition,is_discretionary,is_active')
      .eq('is_active', true)
      .order('rule_code')
      .order('id')
      .range(from, to))

  if (role !== 'admin') {
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
  const [studentResult, enrollmentResult, classroomResult, scoreResult, history] = await Promise.all([
    client.from('students').select('id,user_id,student_code,title,given_name,family_name,status').eq('user_id', user.id).maybeSingle(),
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
      kind: ledgerKind(row.entry_type),
      requestedDelta: row.requested_delta,
      appliedDelta: row.applied_delta,
      scoreBefore: row.balance_before,
      scoreAfter: row.balance_after,
      reason: row.reason,
      occurredAt: incident?.occurred_at ?? row.created_at,
      actorId: '',
      incidentId,
      appealDeadline: incident?.appeal_deadline,
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
    }]
  })
  const student: Student = {
    id: studentId,
    studentCode: studentRow.student_code,
    name: fullName(studentRow),
    classroomId: asId(enrollment.classroom_id),
    classroomName: classroom.display_name,
    gradeLevel: classroom.grade_level,
    roomNumber: classroom.room_number,
    score: score?.balance ?? 100,
    status: studentRow.status === 'graduated' ? 'graduated' : 'active',
  }
  const account = { ...profileAccount(profile, user, getSessionUsername(user)), studentId }
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
    transactions,
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
      .rpc('get_my_incident_history')
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
    ledgerResult, incidentsResult, requestsResult, appealsResult, casesResult, guardianResult] = await Promise.all([
    fetchAllPages<StudentRow>('โหลดนักเรียน', (from, to) => client
      .from('students')
      .select('id,user_id,student_code,title,given_name,family_name,status')
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
      .select('id,student_id,term_id,entry_type,requested_delta,applied_delta,balance_before,balance_after,incident_id,addition_request_id,positive_rule_id,positive_rule_snapshot,activity_occurred_at,internal_reason,evidence_note,reason,actor_user_id,created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)),
    fetchAllPages<IncidentRow>('โหลดเหตุการณ์', (from, to) => client
      .from('incidents')
      .select('id,student_id,rule_id,severity,occurred_at')
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)),
    fetchAllPages<RequestRow>('โหลดคำขอเพิ่มคะแนน', (from, to) => client
      .from('point_addition_requests')
      .select('id,student_id,positive_rule_id,rule_snapshot,requested_points,reason,evidence_note,activity_occurred_at,requested_by,status,created_at,reviewed_at,review_note')
      .eq('term_id', term.id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)),
    fetchAllPages<AppealRow>('โหลดคำอุทธรณ์', (from, to) => client
      .from('appeals')
      .select('id,incident_id,student_id,reason,status,created_at')
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
      .select('id,incident_id,status,note,completed_at')
      .order('id')
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
  const requestRows = requestsResult
  const appealRows = appealsResult
  const caseRows = casesResult
  const guardianRows = guardianResult

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
    name: fullName(row),
    classroomIds: classroomIdsByTeacher.get(asId(row.id)) ?? [],
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
      kind: ledgerKind(row.entry_type),
      requestedDelta: row.requested_delta,
      appliedDelta: row.applied_delta,
      scoreBefore: row.balance_before,
      scoreAfter: row.balance_after,
      ruleId: incident ? asId(incident.rule_id) : undefined,
      reason: row.reason,
      occurredAt: incident?.occurred_at ?? row.created_at,
      actorId: row.actor_user_id ?? '',
      incidentId,
      sourceRequestId: row.addition_request_id === null ? undefined : asId(row.addition_request_id),
      positiveRuleId: row.positive_rule_id === null || row.positive_rule_id === undefined ? undefined : asId(row.positive_rule_id),
      positiveRuleTitle: snapshotText(row.positive_rule_snapshot ?? null, 'title_th', 'title'),
      activityOccurredAt: row.activity_occurred_at ?? undefined,
      evidenceNote: row.evidence_note ?? undefined,
      internalReason: row.internal_reason ?? undefined,
      additionSource: row.entry_type === 'admin_addition'
        ? 'admin_direct'
        : row.entry_type === 'teacher_request_approved'
          ? 'teacher_request'
          : row.entry_type === 'appeal_reversal'
            ? 'appeal'
            : undefined,
    }
  })
  const transactionByIncident = new Map(
    transactions.filter((row) => row.incidentId).map((row) => [row.incidentId as string, row.id]),
  )
  const positiveRuleById = new Map(positiveRules.map((rule) => [rule.id, rule]))
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
  }))
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
    transactions,
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

export function createSupabaseActions(client: SupabaseClient, refresh: () => Promise<void>): AppDataActions {
  const mutate = async <T>(name: string, parameters: Record<string, unknown>): Promise<T> => {
    const result = await runRpc<T>(client, name, parameters)
    await refresh()
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
    requestPointAddition: (input) => mutate<void>('request_point_addition_detailed', {
      p_client_request_id: input.clientRequestId,
      p_student_id: input.studentId,
      p_positive_rule_id: input.positiveRuleId,
      p_points: input.points,
      p_activity_occurred_at: input.activityOccurredAt,
      p_reason: input.reason.trim(),
      p_evidence_note: input.evidenceNote.trim(),
    }),
    requestPointAdditions: async (input) => normalizeRequestPointAdditionsResult(
      await mutate<unknown>('request_point_additions_bulk', {
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
    reviewPointAddition: (input) => mutate<void>('review_point_addition', {
      p_request_id: input.requestId,
      p_approve: input.approve,
      p_review_note: input.note ?? null,
    }),
    reviewAppeal: (input) => mutate<void>('review_appeal', {
      p_appeal_id: input.appealId,
      p_accept: input.accept,
      p_decision_note: input.note,
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
    completeGuardianContact: (input) => mutate<void>('complete_guardian_contact_task', {
      p_task_id: input.taskId,
      p_note: input.note.trim(),
    }),
    updateFollowUpCase: (input) => mutate<void>('admin_update_follow_up_case', {
      p_case_id: input.caseId,
      p_status: input.status,
      p_note: input.note.trim(),
    }),
    activateTerm: (termId) => mutate<void>('admin_activate_term', { p_term_id: termId }),
  }
}
