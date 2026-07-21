import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { AppDataActions } from './dataActions'
import type {
  Account,
  Appeal,
  BehaviorRule,
  DemoState,
  RequestStatus,
  Role,
  ScoreTransaction,
  SeriousCase,
  Severity,
  Student,
  Teacher,
} from './domain'

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
  requested_points: number
  reason: string
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
  opened_at: string
}

interface GuardianTaskRow {
  id: number | string
  incident_id: number | string
  status: 'pending' | 'completed' | 'cancelled'
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

async function loadActiveTermAndRules(client: SupabaseClient): Promise<{ term: TermRow; rules: BehaviorRule[] }> {
  const [termResult, rulesResult] = await Promise.all([
    client.from('academic_terms').select('id,name').eq('status', 'active').limit(1).maybeSingle(),
    fetchAllPages<RuleRow>('โหลดระเบียบ', (from, to) => client
      .from('behavior_rules')
      .select('id,category,title_th,default_deduction,severity,guardian_contact_required,is_active')
      .order('rule_code')
      .order('id')
      .range(from, to)),
  ])
  const term = unwrap<TermRow>('โหลดภาคเรียนปัจจุบัน', termResult as QueryResult<TermRow>)
  return { term, rules: mapRules(rulesResult) }
}

async function loadStudentState(
  client: SupabaseClient,
  user: User,
  profile: ProfileRow,
  term: TermRow,
  rules: BehaviorRule[],
): Promise<DemoState> {
  const termId = asId(term.id)
  const [studentResult, enrollmentResult, classroomResult, scoreResult, ledgerResult, incidentResult] = await Promise.all([
    client.from('students').select('id,user_id,student_code,title,given_name,family_name,status').eq('user_id', user.id).maybeSingle(),
    client.from('enrollments').select('classroom_id,student_id').eq('term_id', term.id).eq('is_active', true).maybeSingle(),
    client.from('classrooms').select('id,display_name').eq('term_id', term.id).eq('is_active', true).maybeSingle(),
    client.from('student_current_scores').select('term_id,balance').eq('term_id', term.id).maybeSingle(),
    fetchAllPages<StudentLedgerRow>('โหลดประวัติคะแนน', (from, to) => client
      .from('student_score_history')
      .select('id,term_id,entry_type,requested_delta,applied_delta,balance_before,balance_after,reason,incident_id,created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)),
    fetchAllPages<StudentIncidentRow>('โหลดเหตุการณ์', (from, to) => client
      .from('student_incident_history')
      .select('id,occurred_at,recorded_at,appeal_deadline,appeal_id,appeal_status,appeal_created_at')
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)),
  ])
  const studentRow = unwrap<StudentRow>('โหลดข้อมูลนักเรียน', studentResult as QueryResult<StudentRow>)
  const enrollment = unwrap<EnrollmentRow>('โหลดห้องเรียนของนักเรียน', enrollmentResult as QueryResult<EnrollmentRow>)
  const classroom = unwrap<ClassroomRow>('โหลดชื่อห้องเรียน', classroomResult as QueryResult<ClassroomRow>)
  const score = scoreResult.error ? (() => { throw new Error(`โหลดคะแนนปัจจุบัน: ${scoreResult.error.message}`) })() : scoreResult.data as StudentScoreRow | null
  const ledgerRows = ledgerResult
  const incidentRows = incidentResult
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
    score: score?.balance ?? 100,
    status: studentRow.status === 'graduated' ? 'graduated' : 'active',
  }
  const account = { ...profileAccount(profile, user, getSessionUsername(user)), studentId }
  return {
    version: 1,
    term: { id: termId, label: term.name, isActive: true },
    accounts: [account],
    students: [student],
    teachers: [],
    rules,
    transactions,
    additionRequests: [],
    appeals,
    seriousCases: [],
  }
}

async function loadStaffState(
  client: SupabaseClient,
  user: User,
  profile: ProfileRow,
  term: TermRow,
  rules: BehaviorRule[],
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
      .select('id,display_name')
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
      .select('id,student_id,term_id,entry_type,requested_delta,applied_delta,balance_before,balance_after,incident_id,addition_request_id,reason,actor_user_id,created_at')
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
      .select('id,student_id,requested_points,reason,requested_by,status,created_at,reviewed_at,review_note')
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
      .select('id,incident_id,student_id,status,internal_note,opened_at')
      .in('status', ['open', 'following_up'])
      .order('opened_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)),
    fetchAllPages<GuardianTaskRow>('โหลดงานติดต่อผู้ปกครอง', (from, to) => client
      .from('guardian_contact_tasks')
      .select('id,incident_id,status')
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
    }
  })
  const transactionByIncident = new Map(
    transactions.filter((row) => row.incidentId).map((row) => [row.incidentId as string, row.id]),
  )
  const additionRequests = requestRows.map((row) => ({
    id: asId(row.id),
    studentId: asId(row.student_id),
    teacherId: row.requested_by ? teacherIdByUserId.get(row.requested_by) ?? row.requested_by : '',
    requestedPoints: row.requested_points,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.reviewed_at ?? undefined,
    decisionNote: row.review_note ?? undefined,
  }))
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
      createdAt: row.opened_at,
      internalNote: row.internal_note ?? '',
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
    version: 1,
    term: { id: asId(term.id), label: term.name, isActive: true, resetCompletedAt: initializedAt },
    accounts: [account],
    students,
    teachers,
    rules,
    transactions,
    additionRequests,
    appeals,
    seriousCases,
  }
}

export async function loadSupabaseState(client: SupabaseClient, user: User): Promise<DemoState> {
  const profile = await loadProfile(client, user)
  const { term, rules } = await loadActiveTermAndRules(client)
  return profile.role === 'student'
    ? loadStudentState(client, user, profile, term, rules)
    : loadStaffState(client, user, profile, term, rules)
}

async function runRpc(client: SupabaseClient, name: string, parameters: Record<string, unknown>): Promise<void> {
  const { error } = await client.rpc(name, parameters)
  if (error) throw new Error(error.message)
}

export function createSupabaseActions(client: SupabaseClient, refresh: () => Promise<void>): AppDataActions {
  const mutate = async (name: string, parameters: Record<string, unknown>) => {
    await runRpc(client, name, parameters)
    await refresh()
  }
  return {
    recordDeduction: (input) => mutate('record_deduction', {
      p_student_id: input.studentId,
      p_rule_id: input.ruleId,
      p_occurred_at: new Date().toISOString(),
      p_student_visible_note: null,
      p_internal_note: input.note,
    }),
    requestPointAddition: (input) => mutate('request_point_addition', {
      p_student_id: input.studentId,
      p_points: input.points,
      p_reason: input.reason,
      p_evidence_note: null,
    }),
    submitAppeal: (input) => mutate('submit_appeal', {
      p_incident_id: input.incidentId,
      p_reason: input.reason,
    }),
    reviewPointAddition: (input) => mutate('review_point_addition', {
      p_request_id: input.requestId,
      p_approve: input.approve,
      p_review_note: input.note ?? null,
    }),
    reviewAppeal: (input) => mutate('review_appeal', {
      p_appeal_id: input.appealId,
      p_accept: input.accept,
      p_decision_note: input.note,
    }),
    adminAddPoints: (input) => mutate('admin_add_points', {
      p_student_id: input.studentId,
      p_points: input.points,
      p_reason: input.reason,
      p_term_id: input.termId,
    }),
    initializeTermScores: (termId) => mutate('initialize_term_scores', { p_term_id: termId }),
  }
}
