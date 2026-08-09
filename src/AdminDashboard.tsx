import { lazy, Suspense, useMemo, useState, type FormEvent } from 'react'
import {
  applyScoreDelta,
  createId,
  formatThaiDate,
  type Account,
  type DemoState,
} from './domain'
import type {
  AdminAddPointsBulkResult,
  AppDataActions,
  DeductionScope,
  RecordDeductionsResult,
  UpdateTeacherClassroomsInput,
  UpdateTermScheduleInput,
} from './dataActions'
import { EvidenceField, EvidenceSummary } from './EvidenceField'
import {
  encodeEvidenceBundle,
  type EvidenceAttachment,
} from './evidence'
import { validateTermSchedule } from './termSchedule'
import { localDateTimeToIso, toLocalDateTimeInputValue, validatePositiveRulePoints } from './teacherWorkflows'
import {
  DeductionRuleSelect,
  PositiveRuleSelect,
  PositiveRuleSummary,
  ScoreRulesDialog,
  type ScoreRulesDialogTab,
} from './ScoreRulesDialog'
import { ScoreActionSelector, StudentTargetSelector, type ScoreAction } from './StudentTargetSelector'
import { buildClassroomGroups, createInitialStudentSelection, resolveStudentTargets } from './studentSelection'
import { SchoolDirectoryPanel } from './SchoolDirectoryPanel'
import { AppShell, EmptyState, Icon, StatusBadge, type NavItem } from './ui'
import { useAdminRoute } from './useAdminRoute'
import type { AdminTab } from './adminRoute'
import { AdminToday } from './AdminToday'
import { AdminReviewCenter, type AdditionDecisionInput, type AppealDecisionInput, type DeductionDecisionInput } from './AdminReviewCenter'
import { AdminCaseCenter, type GuardianAttemptInput } from './AdminCaseCenter'
import { guardianOutcomeClosesNotification, guardianOutcomeLabel, guardianReminderDueAt } from './adminWorkflows'

export type { AdminTab } from './adminRoute'

const AdminPaperCenter = lazy(() => import('./AdminPaperCenter').then((module) => ({ default: module.AdminPaperCenter })))

function newRequestId(): string {
  return globalThis.crypto.randomUUID()
}

interface AdminDashboardProps {
  account: Account
  state: DemoState
  onChange: (next: DemoState) => void
  actions?: AppDataActions
  onResetDemo?: () => void
  onLogout: () => void
  initialTab?: AdminTab
}

interface TermScheduleFormProps {
  term: DemoState['term']
  busy: boolean
  activating: boolean
  onSave: (input: UpdateTermScheduleInput) => Promise<void>
  onActivate: (termId: string) => Promise<void>
}

export function TermScheduleForm({ term, busy, activating, onSave, onActivate }: TermScheduleFormProps) {
  const [startsOn, setStartsOn] = useState(term.startsOn ?? '')
  const [endsOn, setEndsOn] = useState(term.endsOn ?? '')
  const [error, setError] = useState('')
  const [activationConfirmed, setActivationConfirmed] = useState(false)
  const unchanged = startsOn === (term.startsOn ?? '') && endsOn === (term.endsOn ?? '')
  const hasSavedSchedule = Boolean(term.startsOn && term.endsOn)
  const activationReady = hasSavedSchedule && unchanged

  async function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const validationError = validateTermSchedule(startsOn, endsOn)
    if (validationError) {
      setError(validationError)
      return
    }
    if (unchanged) return
    setError('')
    try {
      await onSave({ termId: term.id, startsOn, endsOn })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'ไม่สามารถบันทึกวันที่ภาคเรียนได้')
    }
  }

  async function activateSchedule() {
    if (busy || !activationReady || !activationConfirmed) return
    setError('')
    try {
      await onActivate(term.id)
    } catch (activationError) {
      setError(activationError instanceof Error ? activationError.message : 'ไม่สามารถเปิดใช้งานภาคเรียนได้')
    }
  }

  return (
    <form className="panel stack-form term-schedule-form" onSubmit={saveSchedule} noValidate>
      <div className="section-heading">
        <div><p className="eyebrow">ปฏิทินภาคเรียน</p><h2>กำหนดวันเปิด–ปิด</h2></div>
        <span className={`badge ${term.isActive ? 'status-approved' : 'status-pending'}`}>
          {term.isActive ? 'กำลังใช้งาน' : 'เตรียมเปิดใช้'}
        </span>
      </div>
      <p id="term-schedule-help" className="form-help">ปรับวันที่ได้เองเมื่อปฏิทินโรงเรียนเปลี่ยน การแก้ไขในระบบจริงจะถูกเก็บในประวัติตรวจสอบ</p>
      <div className="date-field-grid">
        <label>วันเปิดภาคเรียน
          <input
            type="date"
            disabled={busy}
            value={startsOn}
            max={endsOn || undefined}
            required
            aria-invalid={Boolean(error)}
            aria-describedby={`term-schedule-help${error ? ' term-schedule-error' : ''}`}
            onChange={(event) => { setStartsOn(event.target.value); setError('') }}
          />
        </label>
        <label>วันปิดภาคเรียน
          <input
            type="date"
            disabled={busy}
            value={endsOn}
            min={startsOn || undefined}
            required
            aria-invalid={Boolean(error)}
            aria-describedby={`term-schedule-help${error ? ' term-schedule-error' : ''}`}
            onChange={(event) => { setEndsOn(event.target.value); setError('') }}
          />
        </label>
      </div>
      {error ? <p className="form-error" id="term-schedule-error" role="alert">{error}</p> : null}
      <button className="button primary full" type="submit" disabled={busy || unchanged}>
        {busy ? 'กำลังบันทึก…' : unchanged
          ? hasSavedSchedule ? 'วันที่เป็นปัจจุบันแล้ว' : 'กรุณาระบุวันเปิด–ปิด'
          : 'บันทึกวันเปิด–ปิด'}
      </button>
      {!term.isActive ? (
        <div className="term-activation">
          <div className="warning-note">
            <Icon name="alert" />
            <span>เมื่อเปิดใช้งานแล้ว คุณครูและนักเรียนจะเข้าสู่ภาคเรียนนี้ได้ ระบบไม่อนุญาตให้มีภาคเรียนที่กำลังใช้งานพร้อมกันมากกว่าหนึ่งภาคเรียน</span>
          </div>
          <label className="confirmation-check">
            <input
              type="checkbox"
              checked={activationConfirmed}
              disabled={busy || !activationReady}
              onChange={(event) => setActivationConfirmed(event.target.checked)}
            />
            <span>ยืนยันว่าตรวจสอบวันเปิด–ปิดและรายชื่อนักเรียนของภาคเรียนนี้แล้ว</span>
          </label>
          <button
            className="button warning full"
            type="button"
            disabled={busy || !activationReady || !activationConfirmed}
            onClick={() => void activateSchedule()}
          >
            {activating ? 'กำลังเปิดใช้งานภาคเรียน…' : activationReady ? 'เปิดใช้งานภาคเรียน' : 'บันทึกวันเปิด–ปิดก่อน'}
          </button>
        </div>
      ) : null}
    </form>
  )
}

type ClassroomGroup = ReturnType<typeof buildClassroomGroups>[number]

interface TeacherClassroomAssignmentEditorProps {
  teacher: DemoState['teachers'][number]
  classrooms: ClassroomGroup[]
  busy: boolean
  onSave: (input: UpdateTeacherClassroomsInput) => Promise<void>
  termId: string
}

export function TeacherClassroomAssignmentEditor({
  teacher,
  classrooms,
  busy,
  onSave,
  termId,
}: TeacherClassroomAssignmentEditorProps) {
  const [selectedIds, setSelectedIds] = useState(() => new Set(teacher.classroomIds))
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [error, setError] = useState('')
  const originalIds = useMemo(() => new Set(teacher.classroomIds), [teacher.classroomIds])
  const changed = selectedIds.size !== originalIds.size
    || [...selectedIds].some((classroomId) => !originalIds.has(classroomId))
  const allSelected = classrooms.length > 0 && classrooms.every((classroom) => selectedIds.has(classroom.id))

  function toggleClassroom(classroomId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(classroomId)) next.delete(classroomId)
      else next.add(classroomId)
      return next
    })
    setConfirmEmpty(false)
    setError('')
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(classrooms.map((classroom) => classroom.id)))
    setConfirmEmpty(false)
    setError('')
  }

  async function saveAssignments() {
    if (busy || !changed) return
    if (!selectedIds.size && !confirmEmpty) {
      setError('กรุณายืนยันก่อนนำสิทธิ์ห้องทั้งหมดออกจากบัญชีครู')
      return
    }
    setError('')
    try {
      await onSave({
        termId,
        teacherId: teacher.id,
        classroomIds: [...selectedIds],
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'ไม่สามารถบันทึกสิทธิ์ห้องได้')
    }
  }

  return (
    <div className="teacher-assignment-editor">
      <div className="assignment-summary">
        <div><strong>{teacher.name}</strong><span>เลือกห้องที่ครูสามารถดูรายชื่อ ตัดคะแนน และส่งคำขอเพิ่มคะแนนได้</span></div>
        <b>{selectedIds.size} ห้อง</b>
      </div>
      <div className="assignment-toolbar">
        <span>ห้องเรียนในภาคเรียนปัจจุบัน {classrooms.length} ห้อง</span>
        <button className="text-button" type="button" disabled={busy || !classrooms.length} onClick={toggleAll}>
          {allSelected ? 'ยกเลิกเลือกทั้งหมด' : 'เลือกทุกห้อง'}
        </button>
      </div>
      {classrooms.length ? (
        <div className="classroom-access-grid">
          {classrooms.map((classroom) => (
            <label className={selectedIds.has(classroom.id) ? 'classroom-access-option selected' : 'classroom-access-option'} key={classroom.id}>
              <input type="checkbox" disabled={busy} checked={selectedIds.has(classroom.id)} onChange={() => toggleClassroom(classroom.id)} />
              <span><strong>{classroom.name}</strong><small>{classroom.gradeLabel} • {classroom.students.length} คน</small></span>
            </label>
          ))}
        </div>
      ) : <EmptyState title="ยังไม่มีห้องเรียน" detail="นำเข้ารายชื่อนักเรียนและห้องเรียนก่อนกำหนดสิทธิ์ให้ครู" />}
      {!selectedIds.size && changed ? (
        <label className="confirmation-check">
          <input type="checkbox" disabled={busy} checked={confirmEmpty} onChange={(event) => { setConfirmEmpty(event.target.checked); setError('') }} />
          <span>ยืนยันให้นำสิทธิ์ห้องทั้งหมดออก ครูคนนี้จะยังเลือกชั้น ห้อง และนักเรียนไม่ได้</span>
        </label>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button primary full" type="button" disabled={busy || !changed || (!selectedIds.size && !confirmEmpty)} onClick={() => void saveAssignments()}>
        {busy ? 'กำลังบันทึกสิทธิ์…' : changed ? `บันทึกสิทธิ์ ${selectedIds.size} ห้อง` : 'สิทธิ์ห้องเป็นปัจจุบันแล้ว'}
      </button>
    </div>
  )
}

export function AdminDashboard({ account, state, onChange, actions, onResetDemo, onLogout, initialTab = 'overview' }: AdminDashboardProps) {
  const pendingDeductions = state.deductionRequests.filter((item) => item.status === 'pending')
  const pending = state.additionRequests.filter((item) => item.status === 'pending')
  const openCases = state.seriousCases.filter((item) => item.status !== 'resolved')
  const openAppeals = state.appeals.filter((item) => item.status === 'submitted' || item.status === 'reviewing')
  const directAdditions = state.transactions.filter((item) => item.additionSource === 'admin_direct')
  const [tab, setTab] = useAdminRoute(initialTab)
  const [adminScoreAction, setAdminScoreAction] = useState<ScoreAction>('deduction')
  const [adminSelection, setAdminSelection] = useState(() => createInitialStudentSelection(state.students, 'selected'))
  const activePositiveRules = useMemo(
    () => state.positiveRules
      .filter((rule) => rule.active)
      .sort((left, right) => left.title.localeCompare(right.title, 'th')),
    [state.positiveRules],
  )
  const activeDeductionRules = useMemo(
    () => state.rules
      .filter((rule) => rule.active)
      .sort((left, right) => left.points - right.points
        || left.category.localeCompare(right.category, 'th')
        || left.title.localeCompare(right.title, 'th')),
    [state.rules],
  )
  const initialPositiveRule = activePositiveRules[0]
  const [adminPositiveRuleId, setAdminPositiveRuleId] = useState(initialPositiveRule?.id ?? '')
  const [points, setPoints] = useState(initialPositiveRule?.defaultPoints ?? 1)
  const [activityOccurredAt, setActivityOccurredAt] = useState(() => toLocalDateTimeInputValue())
  const [reason, setReason] = useState('')
  const [adminEvidenceNote, setAdminEvidenceNote] = useState('')
  const [adminEvidenceFiles, setAdminEvidenceFiles] = useState<File[]>([])
  const [adminUploadedEvidence, setAdminUploadedEvidence] = useState<EvidenceAttachment[]>([])
  const [adminRequestId, setAdminRequestId] = useState(() => newRequestId())
  const [adminAdditionResult, setAdminAdditionResult] = useState<AdminAddPointsBulkResult | null>(null)
  const [adminAdditionReview, setAdminAdditionReview] = useState(false)
  const [adminDeductionRuleId, setAdminDeductionRuleId] = useState(activeDeductionRules[0]?.id ?? '')
  const [adminDeductionOccurredAt, setAdminDeductionOccurredAt] = useState(() => toLocalDateTimeInputValue())
  const [adminDeductionNote, setAdminDeductionNote] = useState('')
  const [adminDeductionReview, setAdminDeductionReview] = useState(false)
  const [adminConfirmSeriousBulk, setAdminConfirmSeriousBulk] = useState(false)
  const [adminDeductionRequestId, setAdminDeductionRequestId] = useState(() => newRequestId())
  const [adminDeductionResult, setAdminDeductionResult] = useState<RecordDeductionsResult | null>(null)
  const [adminScoreStage, setAdminScoreStage] = useState<'select' | 'details'>('select')
  const [announcement, setAnnouncement] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const [rulesDialogTab, setRulesDialogTab] = useState<ScoreRulesDialogTab | null>(null)
  const [assignmentTeacherId, setAssignmentTeacherId] = useState(state.teachers[0]?.id ?? '')
  const assignmentClassrooms = useMemo(() => buildClassroomGroups(state.students), [state.students])
  const assignmentTeacher = state.teachers.find((teacher) => teacher.id === assignmentTeacherId) ?? state.teachers[0]
  const adminTargets = resolveStudentTargets(state.students, adminSelection)
  const adminSubmissionScope: DeductionScope = adminTargets.length === 1 ? 'single' : 'selected'
  const adminPositiveRule = activePositiveRules.find((item) => item.id === adminPositiveRuleId)
  const adminPointValidation = validatePositiveRulePoints(adminPositiveRule, points)
  const adminDeductionRule = activeDeductionRules.find((rule) => rule.id === adminDeductionRuleId)
  const adminAdditionBeforeTotal = adminTargets.reduce((sum, student) => sum + student.score, 0)
  const adminAdditionAfterTotal = adminTargets.reduce((sum, student) => sum + applyScoreDelta(student.score, points).after, 0)
  const adminAdditionAppliedTotal = adminAdditionAfterTotal - adminAdditionBeforeTotal
  const adminDeductionBeforeTotal = adminTargets.reduce((sum, student) => sum + student.score, 0)
  const adminDeductionAfterTotal = adminTargets.reduce((sum, student) => sum + applyScoreDelta(student.score, -(adminDeductionRule?.points ?? 0)).after, 0)
  const adminSeriousBulk = Boolean(adminDeductionRule && ['serious', 'critical'].includes(adminDeductionRule.severity) && adminTargets.length > 1)
  const mutationBusy = Boolean(busyAction)
  const adminAdditionBusy = mutationBusy
  const approvalQueueCount = pendingDeductions.length + pending.length + openAppeals.length
  const navItems: NavItem<AdminTab>[] = [
    { id: 'overview', label: 'แดชบอร์ด', icon: 'home' },
    { id: 'score', label: 'คะแนน', icon: 'star' },
    { id: 'approvals', label: 'งานรอตรวจ', icon: 'approval', count: approvalQueueCount },
    { id: 'cases', label: 'เคสร้ายแรง', icon: 'alert', count: openCases.length },
    { id: 'manage', label: 'จัดการระบบ', icon: 'settings' },
  ]
  const mobileNavItems: NavItem<AdminTab>[] = [
    { id: 'overview', label: 'วันนี้', icon: 'calendar' },
    { id: 'score', label: 'คะแนน', icon: 'star' },
    { id: 'approvals', label: 'ตรวจ', icon: 'approval', count: approvalQueueCount },
    { id: 'cases', label: 'เคส', icon: 'alert', count: openCases.length },
    { id: 'manage', label: 'ระบบ', icon: 'settings' },
  ]

  function navigateAdmin(next: AdminTab) {
    setAnnouncement('')
    setTab(next)
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }

  async function decideAdditionRequest(requestId: string, input: AdditionDecisionInput) {
    if (mutationBusy) return
    const request = state.additionRequests.find((item) => item.id === requestId)
    const student = state.students.find((item) => item.id === request?.studentId)
    if (!request) {
      throw new Error('ไม่พบคำขอนี้ กรุณาโหลดรายการใหม่')
    }
    if (request.status !== 'pending') {
      throw new Error('คำขอนี้ได้รับการพิจารณาไปแล้ว กรุณาโหลดรายการใหม่')
    }
    const normalizedNote = input.note.trim()
    if (actions) {
      setBusyAction(`request-${requestId}`)
      try {
        await actions.reviewPointAddition({
          requestId,
          approve: input.approve,
          approvedPoints: input.approvedPoints,
          note: normalizedNote || undefined,
        })
        const studentName = student?.name ?? `นักเรียนรหัส ${request.studentId}`
        setAnnouncement(input.approve
          ? `อนุมัติคำขอเพิ่มคะแนนของ ${studentName} แล้ว`
          : `ปฏิเสธคำขอของ ${studentName} แล้ว คะแนนไม่เปลี่ยนแปลง`)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'ไม่สามารถบันทึกผลการพิจารณาได้'
        setAnnouncement(message)
        throw error
      } finally {
        setBusyAction('')
      }
      return
    }
    if (!student) {
      throw new Error('ไม่พบข้อมูลนักเรียนสำหรับคำขอนี้ จึงไม่สามารถจำลองการเปลี่ยนคะแนนได้')
    }
    if (input.approve) {
      const change = applyScoreDelta(student.score, input.approvedPoints)
      onChange({
        ...state,
        students: state.students.map((item) => item.id === student.id ? { ...item, score: change.after } : item),
        additionRequests: state.additionRequests.map((item) => item.id === requestId ? { ...item, status: 'approved', approvedPoints: input.approvedPoints, decidedAt: new Date().toISOString(), decisionNote: normalizedNote } : item),
        transactions: [{
          id: createId('tx'),
          studentId: student.id,
          termId: state.term.id,
          kind: 'addition',
          requestedDelta: change.requestedDelta,
          appliedDelta: change.appliedDelta,
          scoreBefore: change.before,
          scoreAfter: change.after,
          reason: request.positiveRuleTitle ?? 'เพิ่มคะแนนตามเกณฑ์ความประพฤติ',
          occurredAt: new Date().toISOString(),
          actorId: account.id,
          sourceRequestId: request.id,
          positiveRuleId: request.positiveRuleId,
          positiveRuleTitle: request.positiveRuleTitle,
          activityOccurredAt: request.activityOccurredAt,
          evidenceNote: request.evidenceNote,
          internalReason: request.reason,
          additionSource: 'teacher_request',
        }, ...state.transactions],
      })
      setAnnouncement(`อนุมัติ ${input.approvedPoints} คะแนนแล้ว คะแนนของ ${student.name} เปลี่ยนจาก ${change.before} เป็น ${change.after}`)
    } else {
      onChange({
        ...state,
        additionRequests: state.additionRequests.map((item) => item.id === requestId ? { ...item, status: 'rejected', decidedAt: new Date().toISOString(), decisionNote: normalizedNote } : item),
      })
      setAnnouncement(`ปฏิเสธคำขอของ ${student.name} แล้ว คะแนนไม่เปลี่ยนแปลง`)
    }
  }

  async function decideDeductionRequest(requestId: string, input: DeductionDecisionInput) {
    if (mutationBusy) return
    const request = state.deductionRequests.find((item) => item.id === requestId)
    const student = state.students.find((item) => item.id === request?.studentId)
    const rule = state.rules.find((item) => item.id === request?.ruleId)
    if (!request || request.status !== 'pending') throw new Error('ไม่พบคำขอตัดคะแนน หรือรายการนี้ได้รับการพิจารณาแล้ว')
    if (!student || !rule) throw new Error('ไม่พบข้อมูลนักเรียนหรือกฎของคำขอนี้')
    const normalizedNote = input.note.trim()
    if (actions) {
      setBusyAction(`deduction-request-${requestId}`)
      try {
        await actions.reviewDeduction({
          requestId,
          approve: input.approve,
          approvedPoints: input.approvedPoints,
          note: normalizedNote || undefined,
        })
        setAnnouncement(input.approve
          ? `อนุมัติตัด ${input.approvedPoints} คะแนนของ ${student.name} แล้ว`
          : `ปฏิเสธคำขอตัดคะแนนของ ${student.name} แล้ว คะแนนไม่เปลี่ยนแปลง`)
      } catch (error) {
        setAnnouncement(error instanceof Error ? error.message : 'ไม่สามารถบันทึกผลการพิจารณาได้')
        throw error
      } finally {
        setBusyAction('')
      }
      return
    }

    const decidedAt = new Date().toISOString()
    if (!input.approve) {
      onChange({
        ...state,
        deductionRequests: state.deductionRequests.map((item) => item.id === requestId
          ? { ...item, status: 'rejected', decidedAt, decisionNote: normalizedNote }
          : item),
      })
      setAnnouncement(`ปฏิเสธคำขอตัดคะแนนของ ${student.name} แล้ว คะแนนไม่เปลี่ยนแปลง`)
      return
    }

    const change = applyScoreDelta(student.score, -input.approvedPoints)
    const incidentId = createId('incident')
    const transactionId = createId('tx')
    const newCase = rule.severity === 'serious' || rule.severity === 'critical'
      ? {
        id: createId('case'),
        transactionId,
        studentId: student.id,
        severity: rule.severity as 'serious' | 'critical',
        status: 'open' as const,
        guardianContactRequired: rule.guardianContactRequired,
        guardianContactStatus: rule.guardianContactRequired ? 'pending' as const : 'not_required' as const,
        guardianTaskId: rule.guardianContactRequired ? createId('guardian-task') : undefined,
        createdAt: decidedAt,
        internalNote: `ติดตามเหตุการณ์: ${request.internalNote || request.ruleTitle}`,
      }
      : null
    onChange({
      ...state,
      students: state.students.map((item) => item.id === student.id ? { ...item, score: change.after } : item),
      deductionRequests: state.deductionRequests.map((item) => item.id === requestId
        ? { ...item, status: 'approved', approvedPoints: input.approvedPoints, decidedAt, decisionNote: normalizedNote }
        : item),
      transactions: [{
        id: transactionId,
        studentId: student.id,
        termId: state.term.id,
        kind: 'deduction',
        requestedDelta: -input.approvedPoints,
        appliedDelta: change.appliedDelta,
        scoreBefore: change.before,
        scoreAfter: change.after,
        ruleId: rule.id,
        reason: rule.title,
        occurredAt: request.occurredAt,
        actorId: account.id,
        incidentId,
        sourceRequestId: request.id,
        internalReason: request.internalNote,
      }, ...state.transactions],
      seriousCases: newCase ? [newCase, ...state.seriousCases] : state.seriousCases,
    })
    setAnnouncement(`อนุมัติตัด ${Math.abs(change.appliedDelta)} คะแนนแล้ว คะแนนของ ${student.name} เปลี่ยนจาก ${change.before} เป็น ${change.after}`)
  }

  async function decideAppeal(appealId: string, input: AppealDecisionInput) {
    if (mutationBusy) return
    const appeal = state.appeals.find((item) => item.id === appealId)
    if (!appeal || !['submitted', 'reviewing'].includes(appeal.status)) throw new Error('ไม่พบคำอุทธรณ์ หรือรายการนี้ได้รับการพิจารณาแล้ว')
    const source = state.transactions.find((item) => item.id === appeal.transactionId)
    const student = state.students.find((item) => item.id === appeal.studentId)
    if (!source || !student) throw new Error('ไม่พบรายการคะแนนต้นทางของคำอุทธรณ์')
    if (actions) {
      setBusyAction(`appeal-${appealId}`)
      try {
        await actions.reviewAppeal({
          appealId,
          restoredPoints: input.accepted ? input.restoredPoints : 0,
          note: input.explanation,
        })
        setAnnouncement(input.accepted ? 'อนุมัติคำอุทธรณ์และสร้างรายการคืนคะแนนแล้ว' : 'ปฏิเสธคำอุทธรณ์แล้ว คะแนนเดิมยังคงอยู่')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'ไม่สามารถพิจารณาคำอุทธรณ์ได้'
        setAnnouncement(message)
        throw error
      } finally {
        setBusyAction('')
      }
      return
    }
    const decidedAt = new Date().toISOString()
    if (!input.accepted) {
      onChange({
        ...state,
        appeals: state.appeals.map((item) => item.id === appealId ? { ...item, status: 'rejected', restoredPoints: 0, decisionNote: input.explanation, decidedAt } : item),
      })
      setAnnouncement('ปฏิเสธคำอุทธรณ์แล้ว ประวัติและคะแนนเดิมยังคงอยู่')
      return
    }
    const change = applyScoreDelta(student.score, input.restoredPoints)
    onChange({
      ...state,
      students: state.students.map((item) => item.id === student.id ? { ...item, score: change.after } : item),
      appeals: state.appeals.map((item) => item.id === appealId ? { ...item, status: 'accepted', restoredPoints: input.restoredPoints, decisionNote: input.explanation, decidedAt } : item),
      transactions: [{
        id: createId('tx'),
        studentId: student.id,
        termId: state.term.id,
        kind: 'addition',
        requestedDelta: input.restoredPoints,
        appliedDelta: change.appliedDelta,
        scoreBefore: change.before,
        scoreAfter: change.after,
        reason: `คืนคะแนนจากคำอุทธรณ์: ${source.reason}`,
        occurredAt: new Date().toISOString(),
        actorId: account.id,
        sourceAppealId: appeal.id,
      }, ...state.transactions],
    })
    setAnnouncement(`อนุมัติคำอุทธรณ์แล้ว สร้างรายการคืน ${change.appliedDelta} คะแนน โดยไม่แก้ประวัติเดิม`)
  }

  async function reopenAppeal(appealId: string, reason: string) {
    if (mutationBusy) return
    const appeal = state.appeals.find((item) => item.id === appealId)
    if (!appeal || !['accepted', 'rejected'].includes(appeal.status)) {
      throw new Error('ไม่พบคำอุทธรณ์ที่ตัดสินแล้ว หรือรายการนี้ถูกเปิดใหม่ไปแล้ว')
    }
    setBusyAction(`appeal-reopen-${appealId}`)
    try {
      if (actions) {
        await actions.reopenAppeal({ appealId, reason })
      } else {
        onChange({
          ...state,
          appeals: state.appeals.map((item) => item.id === appealId
            ? { ...item, status: 'reviewing', reopenReason: reason }
            : item),
        })
      }
      setAnnouncement('เปิดคำอุทธรณ์เพื่อพิจารณาใหม่แล้ว ผลและรายการคะแนนเดิมยังอยู่ในประวัติ')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ไม่สามารถเปิดคำอุทธรณ์เพื่อพิจารณาใหม่ได้'
      setAnnouncement(message)
      throw error
    } finally {
      setBusyAction('')
    }
  }

  function invalidateAdminRequest() {
    setAdminAdditionReview(false)
    setAdminAdditionResult(null)
    setAdminRequestId(newRequestId())
  }

  function invalidateAdminDeduction() {
    setAdminDeductionReview(false)
    setAdminConfirmSeriousBulk(false)
    setAdminDeductionResult(null)
    setAdminDeductionRequestId(newRequestId())
  }

  function changeAdminSelection(next: typeof adminSelection) {
    setAdminSelection(next)
    invalidateAdminRequest()
    invalidateAdminDeduction()
  }

  function changeAdminScoreAction(next: ScoreAction) {
    setAdminScoreAction(next)
    setAdminScoreStage('select')
    setAnnouncement('')
  }

  function openAdminScore(next: ScoreAction = 'deduction') {
    setAdminScoreAction(next)
    setAdminScoreStage('select')
    setAnnouncement('')
    navigateAdmin('score')
  }

  async function addPointsDirectly(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mutationBusy) return
    const activityIso = localDateTimeToIso(activityOccurredAt)
    if (!adminPositiveRule || !adminPointValidation.valid || !activityIso) {
      setAnnouncement(adminPointValidation.message ?? 'กรุณาเลือกเหตุผลในการเพิ่มคะแนนและวันทำกิจกรรม')
      return
    }
    if (!adminTargets.length) {
      setAnnouncement('กรุณาเลือกนักเรียนหรือห้องเรียนที่ต้องการเพิ่มคะแนน')
      return
    }
    if (adminTargets.every((student) => student.score >= 100)) {
      setAnnouncement('นักเรียนที่เลือกทุกคนมีคะแนนเต็ม 100 แล้ว จึงไม่มีคะแนนให้เพิ่ม')
      return
    }
    if (!adminAdditionReview) {
      setAdminAdditionReview(true)
      setAnnouncement(`ตรวจสอบรายชื่อ ${adminTargets.length} คนและคะแนนก่อนยืนยันบันทึก`)
      return
    }
    if (actions) setBusyAction('admin-add')
    let attachments: EvidenceAttachment[]
    try {
      attachments = adminUploadedEvidence.length
        ? adminUploadedEvidence
        : adminEvidenceFiles.length
          ? actions
            ? await actions.uploadEvidenceFiles(adminEvidenceFiles)
            : adminEvidenceFiles.map((file) => ({
              path: `demo/${newRequestId()}/${file.name}`,
              name: file.name,
              size: file.size,
              contentType: file.type,
            }))
          : []
    } catch (error) {
      setBusyAction('')
      setAnnouncement(error instanceof Error ? error.message : 'ไม่สามารถอัปโหลดไฟล์หลักฐานได้')
      return
    }
    if (actions && attachments.length) setAdminUploadedEvidence(attachments)
    const normalizedReason = reason.trim() || adminPositiveRule.title
    const encodedEvidence = encodeEvidenceBundle(adminEvidenceNote, attachments) || 'ไม่มีหลักฐานประกอบ'
    if (actions) {
      try {
        const result = await actions.adminAddPointsBulk({
          clientRequestId: adminRequestId,
          scope: adminSubmissionScope,
          studentIds: adminTargets.map((student) => student.id),
          classroomId: adminSelection.classroomId,
          positiveRuleId: adminPositiveRule.id,
          points,
          activityOccurredAt: activityIso,
          reason: normalizedReason,
          evidenceNote: encodedEvidence,
          termId: state.term.id,
        })
        setReason('')
        setAdminEvidenceNote('')
        setAdminEvidenceFiles([])
        setAdminUploadedEvidence([])
        setAdminRequestId(newRequestId())
        setAdminAdditionReview(false)
        setAdminAdditionResult(result)
        setAnnouncement(`เพิ่มคะแนนครบ ${result.targetCount} คน รวมเพิ่มจริง ${result.totalAppliedPoints} คะแนน และบันทึกรายละเอียดแล้ว`)
      } catch (error) {
        setAnnouncement(error instanceof Error ? error.message : 'ไม่สามารถเพิ่มคะแนนทั้งชุดได้ ระบบไม่ได้บันทึกเพียงบางคน')
      } finally {
        setBusyAction('')
      }
      return
    }
    const resultRows = adminTargets.map((student) => {
      const change = applyScoreDelta(student.score, points)
      return { student, change, ledgerId: createId('tx') }
    })
    const resultByStudent = new Map(resultRows.map((row) => [row.student.id, row.change]))
    onChange({
      ...state,
      students: state.students.map((student) => {
        const change = resultByStudent.get(student.id)
        return change ? { ...student, score: change.after } : student
      }),
      transactions: [...resultRows.map(({ student, change, ledgerId }) => ({
        id: ledgerId,
        studentId: student.id,
        termId: state.term.id,
        kind: 'addition' as const,
        requestedDelta: change.requestedDelta,
        appliedDelta: change.appliedDelta,
        scoreBefore: change.before,
        scoreAfter: change.after,
        reason: adminPositiveRule.title,
        occurredAt: activityIso,
        actorId: account.id,
        positiveRuleId: adminPositiveRule.id,
        positiveRuleTitle: adminPositiveRule.title,
        activityOccurredAt: activityIso,
        evidenceNote: encodedEvidence,
        internalReason: normalizedReason,
        additionSource: 'admin_direct' as const,
      })), ...state.transactions],
    })
    const localResult: AdminAddPointsBulkResult = {
      ok: true,
      replayed: false,
      batchId: createId('admin-addition-batch'),
      scope: adminSubmissionScope,
      classroomId: adminSelection.classroomId,
      targetCount: resultRows.length,
      requestedPointsEach: points,
      totalAppliedPoints: resultRows.reduce((sum, row) => sum + row.change.appliedDelta, 0),
      results: resultRows.map(({ student, change, ledgerId }) => ({
        ok: true,
        replayed: false,
        ledgerId,
        studentId: student.id,
        requestedPoints: points,
        appliedPoints: change.appliedDelta,
        balanceBefore: change.before,
        balanceAfter: change.after,
      })),
    }
    setReason('')
    setAdminEvidenceNote('')
    setAdminEvidenceFiles([])
    setAdminUploadedEvidence([])
    setAdminRequestId(newRequestId())
    setAdminAdditionReview(false)
    setAdminAdditionResult(localResult)
    setAnnouncement(`เพิ่มคะแนนครบ ${localResult.targetCount} คน รวมเพิ่มจริง ${localResult.totalAppliedPoints} คะแนนเรียบร้อยแล้ว`)
  }

  async function deductPointsDirectly(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mutationBusy) return
    const eventIso = localDateTimeToIso(adminDeductionOccurredAt)
    if (!adminDeductionRule || !eventIso) {
      setAnnouncement('กรุณาเลือกเหตุผลในการตัดคะแนนและวันเวลาเกิดเหตุ')
      return
    }
    if (!adminTargets.length) {
      setAnnouncement('กรุณาเลือกนักเรียนหรือห้องเรียนที่ต้องการตัดคะแนน')
      return
    }
    if (!adminDeductionReview) {
      setAdminDeductionReview(true)
      setAnnouncement(`ตรวจสอบรายชื่อ ${adminTargets.length} คนและคะแนนก่อนยืนยันบันทึก`)
      return
    }
    if (adminSeriousBulk && !adminConfirmSeriousBulk) {
      setAnnouncement('กรุณายืนยันว่าตรวจสอบรายชื่อนักเรียนกรณีร้ายแรงครบถ้วนแล้ว')
      return
    }

    setBusyAction('admin-deduct')
    try {
      let result: RecordDeductionsResult
      if (actions) {
        result = await actions.recordDeductions({
          clientRequestId: adminDeductionRequestId,
          scope: adminSubmissionScope,
          studentIds: adminTargets.map((student) => student.id),
          classroomId: adminSelection.classroomId,
          ruleId: adminDeductionRule.id,
          occurredAt: eventIso,
          internalNote: adminDeductionNote.trim() || adminDeductionRule.title,
          confirmSeriousBulk: adminSeriousBulk && adminConfirmSeriousBulk,
        })
      } else {
        const resultRows = adminTargets.map((student) => {
          const change = applyScoreDelta(student.score, -adminDeductionRule.points)
          return {
            studentId: student.id,
            incidentId: createId('incident'),
            requestedPoints: adminDeductionRule.points,
            appliedPoints: Math.abs(change.appliedDelta),
            balanceBefore: change.before,
            balanceAfter: change.after,
          }
        })
        const resultByStudent = new Map(resultRows.map((row) => [row.studentId, row]))
        const newTransactions = resultRows.map((row) => ({
          id: createId('tx'),
          studentId: row.studentId,
          termId: state.term.id,
          kind: 'deduction' as const,
          requestedDelta: -row.requestedPoints,
          appliedDelta: -row.appliedPoints,
          scoreBefore: row.balanceBefore,
          scoreAfter: row.balanceAfter,
          ruleId: adminDeductionRule.id,
          reason: adminDeductionNote.trim() || adminDeductionRule.title,
          occurredAt: eventIso,
          actorId: account.id,
          incidentId: row.incidentId,
        }))
        const newCases = ['serious', 'critical'].includes(adminDeductionRule.severity)
          ? newTransactions.map((transaction) => ({
            id: createId('case'),
            transactionId: transaction.id,
            studentId: transaction.studentId,
            severity: adminDeductionRule.severity as 'serious' | 'critical',
            status: 'open' as const,
            guardianContactRequired: adminDeductionRule.guardianContactRequired,
            guardianContactStatus: adminDeductionRule.guardianContactRequired ? 'pending' as const : 'not_required' as const,
            guardianTaskId: adminDeductionRule.guardianContactRequired ? createId('guardian-task') : undefined,
            createdAt: eventIso,
            internalNote: `ติดตามเหตุการณ์: ${adminDeductionNote.trim() || adminDeductionRule.title}`,
          }))
          : []
        onChange({
          ...state,
          students: state.students.map((student) => {
            const row = resultByStudent.get(student.id)
            return row ? { ...student, score: row.balanceAfter } : student
          }),
          transactions: [...newTransactions, ...state.transactions],
          seriousCases: [...newCases, ...state.seriousCases],
        })
        result = {
          ok: true,
          replayed: false,
          batchId: createId('deduction-batch'),
          scope: adminSubmissionScope,
          classroomId: adminSelection.classroomId,
          targetCount: resultRows.length,
          requestedPointsEach: adminDeductionRule.points,
          totalRequestedPoints: resultRows.length * adminDeductionRule.points,
          totalAppliedPoints: resultRows.reduce((sum, row) => sum + row.appliedPoints, 0),
          alreadyAtZeroCount: resultRows.filter((row) => row.appliedPoints === 0).length,
          guardianTaskCount: adminDeductionRule.guardianContactRequired ? resultRows.length : 0,
          results: resultRows,
        }
      }
      setAdminDeductionResult(result)
      setAdminDeductionNote('')
      setAdminDeductionReview(false)
      setAdminConfirmSeriousBulk(false)
      setAdminDeductionRequestId(newRequestId())
      setAnnouncement(`บันทึกครบ ${result.targetCount} คน ตัดคะแนนจริงรวม ${result.totalAppliedPoints} คะแนนเรียบร้อยแล้ว`)
    } catch (error) {
      setAnnouncement(error instanceof Error ? error.message : 'ไม่สามารถบันทึกการตัดคะแนนทั้งชุดได้ ระบบไม่ได้บันทึกเพียงบางคน')
    } finally {
      setBusyAction('')
    }
  }

  async function resetTermScores() {
    if (mutationBusy || state.term.resetCompletedAt) return
    const confirmed = window.confirm(`ยืนยันเริ่มคะแนน ${state.term.label} ที่ 100 สำหรับนักเรียน ${state.students.length} คน? เคสติดตามที่ยังไม่เสร็จจะยังคงอยู่`)
    if (!confirmed) return
    if (actions) {
      setBusyAction('initialize-term')
      try {
        await actions.initializeTermScores(state.term.id)
        setAnnouncement(`เตรียมคะแนนเริ่มต้น 100 สำหรับ ${state.term.label} เรียบร้อยแล้ว และคงเคสติดตามไว้ต่อเนื่อง`)
      } catch (error) {
        setAnnouncement(error instanceof Error ? error.message : 'ไม่สามารถเตรียมคะแนนภาคเรียนได้')
      } finally {
        setBusyAction('')
      }
      return
    }
    const occurredAt = new Date().toISOString()
    const resetTransactions = state.students.map((student) => ({
      id: createId('reset'),
      studentId: student.id,
      termId: state.term.id,
      kind: 'reset' as const,
      requestedDelta: 100 - student.score,
      appliedDelta: 100 - student.score,
      scoreBefore: student.score,
      scoreAfter: 100,
      reason: `เปิดคะแนนประจำ${state.term.label}`,
      occurredAt,
      actorId: account.id,
    }))
    onChange({
      ...state,
      term: { ...state.term, resetCompletedAt: occurredAt },
      students: state.students.map((student) => ({ ...student, score: 100 })),
      transactions: [...resetTransactions, ...state.transactions],
    })
    setAnnouncement(`รีเซ็ตคะแนนเป็น 100 แล้ว และคงเคสติดตาม ${openCases.length} เคสไว้ต่อเนื่อง`)
  }

  async function updateTermSchedule(input: UpdateTermScheduleInput) {
    if (mutationBusy) return
    setBusyAction('term-schedule')
    setAnnouncement('')
    try {
      if (actions) {
        await actions.updateTermSchedule(input)
      } else {
        onChange({
          ...state,
          term: { ...state.term, startsOn: input.startsOn, endsOn: input.endsOn },
        })
      }
      setAnnouncement(`บันทึกวันเปิด–ปิด ${state.term.label} เรียบร้อยแล้ว`)
    } finally {
      setBusyAction('')
    }
  }

  async function activateTerm(termId: string) {
    if (mutationBusy || state.term.isActive) return
    setBusyAction('term-activate')
    setAnnouncement('')
    try {
      if (actions) {
        await actions.activateTerm(termId)
      } else {
        onChange({
          ...state,
          term: { ...state.term, isActive: true },
        })
      }
      setAnnouncement(`เปิดใช้งาน ${state.term.label} แล้ว คุณครูและนักเรียนสามารถเข้าสู่ระบบได้`)
    } finally {
      setBusyAction('')
    }
  }

  async function updateTeacherClassrooms(input: UpdateTeacherClassroomsInput) {
    if (mutationBusy) return
    setBusyAction('teacher-classrooms')
    setAnnouncement('')
    try {
      if (actions) {
        await actions.updateTeacherClassrooms(input)
      } else {
        onChange({
          ...state,
          teachers: state.teachers.map((teacher) => teacher.id === input.teacherId
            ? { ...teacher, classroomIds: [...new Set(input.classroomIds)] }
            : teacher),
        })
      }
      const teacherName = state.teachers.find((teacher) => teacher.id === input.teacherId)?.name ?? 'ครูที่เลือก'
      setAnnouncement(input.classroomIds.length
        ? `บันทึกสิทธิ์ ${input.classroomIds.length} ห้องให้ ${teacherName} แล้ว`
        : `นำสิทธิ์ห้องทั้งหมดออกจาก ${teacherName} แล้ว`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ไม่สามารถบันทึกสิทธิ์ห้องได้'
      setAnnouncement(message)
      throw error
    } finally {
      setBusyAction('')
    }
  }

  async function loadGuardianContacts(taskId: string) {
    if (actions) return actions.getGuardianContacts(taskId)
    return [{
      id: 'guardian-demo-01',
      name: 'นางสาวกาญจนา ใจดี',
      relationship: 'มารดา • ผู้ปกครองหลัก',
      phoneNumber: '08X-XXX-XXXX',
      isPrimary: true,
    }]
  }

  async function recordGuardianContactAttempt(caseId: string, input: GuardianAttemptInput) {
    if (mutationBusy) return
    const selectedCase = state.seriousCases.find((item) => item.id === caseId)
    if (!selectedCase?.guardianTaskId) throw new Error('ไม่พบงานแจ้งผู้ปกครองของเคสนี้')
    const closesNotification = guardianOutcomeClosesNotification(input.channel, input.outcome)
    const occurredAt = new Date().toISOString()
    const channelLabel = input.channel === 'phone' ? 'โทรศัพท์' : input.channel === 'line' ? 'LINE' : input.channel === 'messenger' ? 'Messenger' : 'SMS'
    const persistedNote = `${channelLabel}: ${guardianOutcomeLabel(input.channel, input.outcome)}${input.note ? ` — ${input.note}` : ''}${input.evidenceNote ? ` | หลักฐาน: ${input.evidenceNote}` : ''}`
    setBusyAction('case-guardian')
    try {
      if (actions) {
        await actions.recordGuardianContactAttempt({
          taskId: selectedCase.guardianTaskId,
          channel: input.channel,
          outcome: input.outcome,
          note: input.note || undefined,
          evidenceNote: input.evidenceNote || undefined,
        })
      } else {
        onChange({
          ...state,
          seriousCases: state.seriousCases.map((item) => item.id === selectedCase.id
            ? {
              ...item,
              status: closesNotification ? 'resolved' : item.status === 'open' ? 'following_up' : item.status,
              guardianContactStatus: closesNotification ? 'completed' : 'pending',
              guardianContactNote: persistedNote,
              guardianContactCompletedAt: closesNotification ? occurredAt : undefined,
              guardianNextReminderAt: closesNotification ? undefined : guardianReminderDueAt(occurredAt).toISOString(),
              followUpNote: closesNotification ? 'ปิดเคสอัตโนมัติหลังผู้ปกครองยืนยันรับทราบ' : item.followUpNote,
              managedAt: occurredAt,
              guardianContactAttempts: [{ id: createId('contact'), ...input, createdAt: occurredAt }, ...(item.guardianContactAttempts ?? [])],
            }
            : item),
        })
      }
      const studentName = state.students.find((item) => item.id === selectedCase.studentId)?.name ?? 'นักเรียน'
      setAnnouncement(closesNotification
        ? `บันทึกการแจ้งผู้ปกครองและปิดเคสของ ${studentName} สำเร็จแล้ว`
        : `บันทึกผลการติดต่อแล้ว เคสของ ${studentName} ยังอยู่ในคิวและจะเตือนอีกครั้งใน 1 วัน`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ไม่สามารถบันทึกการแจ้งผู้ปกครองได้'
      setAnnouncement(message)
      throw error
    } finally {
      setBusyAction('')
    }
  }

  async function updateFollowUpCase(caseId: string, status: 'following_up' | 'resolved', note: string) {
    if (mutationBusy) return
    const selectedCase = state.seriousCases.find((item) => item.id === caseId)
    if (!selectedCase) throw new Error('ไม่พบเคสนี้ กรุณาโหลดรายการใหม่')
    if (status === 'resolved' && selectedCase.guardianContactStatus === 'pending') {
      throw new Error('ต้องแจ้งผู้ปกครองสำเร็จก่อนปิดเคส')
    }
    setBusyAction(status === 'resolved' ? 'case-resolve' : 'case-follow')
    try {
      if (actions) {
        await actions.updateFollowUpCase({ caseId: selectedCase.id, status, note })
      } else {
        const managedAt = new Date().toISOString()
        onChange({
          ...state,
          seriousCases: state.seriousCases.map((item) => item.id === selectedCase.id
            ? {
              ...item,
              status,
              followUpNote: note,
              managedAt,
            }
            : item),
        })
      }
      const selectedCaseStudent = state.students.find((item) => item.id === selectedCase.studentId)
      setAnnouncement(status === 'resolved'
        ? `ปิดเคสของ ${selectedCaseStudent?.name ?? 'นักเรียน'} เรียบร้อยแล้ว`
        : `บันทึกการติดตามของ ${selectedCaseStudent?.name ?? 'นักเรียน'} แล้ว`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ไม่สามารถบันทึกสถานะกรณีติดตามได้'
      setAnnouncement(message)
      throw error
    } finally {
      setBusyAction('')
    }
  }

  return (
    <AppShell account={account} state={state} items={navItems} mobileItems={mobileNavItems} active={tab === 'directory' || tab === 'paper' ? 'manage' : tab} onNavigate={navigateAdmin} onLogout={onLogout}>
      {tab !== 'overview' && tab !== 'directory' ? <div className="page-heading">
        <div><p className="eyebrow">ศูนย์ควบคุมระบบ</p><h1>{tab === 'score' ? 'จัดการคะแนน' : tab === 'approvals' ? 'งานรอตรวจ' : tab === 'cases' ? 'เคสร้ายแรง' : tab === 'paper' ? 'ศูนย์เอกสารกระดาษ' : 'จัดการระบบ'}</h1></div>
        <span className="class-chip">ผู้ดูแลระบบ • สิทธิ์ทั้งหมด</span>
      </div> : null}
      <div className="announcement" aria-live="polite">{announcement}</div>

      {tab === 'manage' || tab === 'directory' || tab === 'paper' ? (
        <nav className="system-subnav" aria-label="เมนูจัดการระบบ">
          <button className={tab === 'manage' ? 'active' : ''} aria-current={tab === 'manage' ? 'page' : undefined} onClick={() => navigateAdmin('manage')}>
            <Icon name="settings" size={18} />
            <span><strong>สิทธิ์และภาคเรียน</strong><small>ครู ห้องเรียน และรอบปี</small></span>
          </button>
          <button className={tab === 'directory' ? 'active' : ''} aria-current={tab === 'directory' ? 'page' : undefined} onClick={() => navigateAdmin('directory')}>
            <Icon name="users" size={18} />
            <span><strong>บุคคลและบัญชี</strong><small>นักเรียน บุคลากร และรหัสผ่าน</small></span>
          </button>
          <button className={tab === 'paper' ? 'active' : ''} aria-current={tab === 'paper' ? 'page' : undefined} onClick={() => navigateAdmin('paper')}>
            <Icon name="document" size={18} />
            <span><strong>เอกสารกระดาษ</strong><small>สรุปคะแนน อุทธรณ์ และแจ้งผล</small></span>
          </button>
        </nav>
      ) : null}

      {tab === 'overview' ? <AdminToday
        state={state}
        pendingDeductions={pendingDeductions}
        pendingAdditions={pending}
        openAppeals={openAppeals}
        openCases={openCases}
        onOpenScore={() => openAdminScore('deduction')}
        onOpenReviews={() => navigateAdmin('approvals')}
        onOpenCases={() => navigateAdmin('cases')}
      /> : null}

      {tab === 'approvals' ? (
        <AdminReviewCenter
          state={state}
          busyAction={busyAction}
          supportsAdditionAdjustment
          supportsDeductionAdjustment
          supportsPartialAppeal
          resolveFileUrl={actions?.createEvidenceUrl}
          onDecideAddition={decideAdditionRequest}
          onDecideDeduction={decideDeductionRequest}
          onDecideAppeal={decideAppeal}
          onReopenAppeal={reopenAppeal}
        />
      ) : null}

      {tab === 'cases' ? (
        <AdminCaseCenter
          state={state}
          busyAction={busyAction}
          onLoadGuardianContacts={loadGuardianContacts}
          onRecordGuardianAttempt={recordGuardianContactAttempt}
          onUpdateCase={updateFollowUpCase}
        />
      ) : null}

      {tab === 'directory' ? <SchoolDirectoryPanel actions={actions} /> : null}

      {tab === 'paper' ? (
        <Suspense fallback={<div className="panel"><p className="form-help">กำลังเปิดศูนย์เอกสารกระดาษ…</p></div>}>
          <AdminPaperCenter state={state} actions={actions} />
        </Suspense>
      ) : null}

      {tab === 'manage' || tab === 'score' ? (
        <div className={tab === 'score' ? 'manage-grid score-workspace' : 'manage-grid system-workspace'}>
          {tab === 'manage' ? <section className="panel teacher-access-panel">
            <div className="section-heading">
              <div><p className="eyebrow">สิทธิ์การเข้าถึงของครู</p><h2>มอบหมายห้องที่รับผิดชอบ</h2></div>
              <span className="counter">{state.teachers.length}</span>
            </div>
            <p className="form-help">ครูจะเห็นและจัดการได้เฉพาะนักเรียนในห้องที่เลือกไว้ การเปลี่ยนแปลงจะมีผลเมื่อครูรีเฟรชหรือเข้าสู่ระบบใหม่</p>
            <label>เลือกครู
              <select disabled={mutationBusy || !state.teachers.length} value={assignmentTeacher?.id ?? ''} onChange={(event) => setAssignmentTeacherId(event.target.value)}>
                {state.teachers.length
                  ? state.teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name} • {teacher.classroomIds.length} ห้อง</option>)
                  : <option value="">ยังไม่มีข้อมูลครู</option>}
              </select>
            </label>
            {assignmentTeacher ? (
              <TeacherClassroomAssignmentEditor
                key={`${assignmentTeacher.id}:${[...assignmentTeacher.classroomIds].sort().join(',')}`}
                teacher={assignmentTeacher}
                classrooms={assignmentClassrooms}
                busy={busyAction === 'teacher-classrooms'}
                onSave={updateTeacherClassrooms}
                termId={state.term.id}
              />
            ) : <EmptyState title="ยังไม่มีข้อมูลครู" detail="นำเข้าข้อมูลครูก่อนกำหนดห้องที่รับผิดชอบ" />}
          </section> : null}
          {tab === 'score' ? <>
          <ScoreActionSelector
            value={adminScoreAction}
            onChange={changeAdminScoreAction}
            disabled={mutationBusy}
          />
          {adminScoreStage === 'select' ? <>
          <StudentTargetSelector
            students={state.students}
            value={adminSelection}
            onChange={changeAdminSelection}
            disabled={mutationBusy}
            actionLabel={adminScoreAction === 'addition' ? 'เพิ่มคะแนน' : 'หักคะแนน'}
            stepStart={1}
          />
          <div className="score-selection-footer">
            <span>เลือกแล้ว <strong>{adminTargets.length}</strong> คน</span>
            <button className="button primary" type="button" disabled={mutationBusy || !adminTargets.length} onClick={() => { setAdminScoreStage('details'); setAnnouncement('') }}>
              ถัดไป <Icon name="chevronRight" size={18} />
            </button>
          </div>
          </> : <>
          <button className="score-back-button" type="button" disabled={mutationBusy} onClick={() => { setAdminScoreStage('select'); setAnnouncement('') }}>
            <Icon name="chevronRight" size={17} /> เปลี่ยนนักเรียน
          </button>
          {adminScoreAction === 'addition' ? (
          <form className="panel stack-form score-details-form" onSubmit={addPointsDirectly}><div className="section-heading"><div><p className="eyebrow">ขั้นตอนที่ 2 จาก 3</p><h2>รายละเอียดการเพิ่มคะแนน</h2></div><button type="button" className="button ghost rules-reference-button" onClick={() => setRulesDialogTab('addition')}><Icon name="book" size={17} /> ดูระเบียบทั้งหมด</button></div>
            <div className="selected-student-bar batch-target-bar">
              <div><span className="student-avatar large">{adminTargets.length}</span><div><strong>{adminTargets.length === 1 ? adminTargets[0]?.name : 'กลุ่มนักเรียนที่เลือก'}</strong><small>รายการทั้งหมดใช้เกณฑ์ เหตุผล และหลักฐานชุดเดียวกัน</small></div></div>
              <div><span>จำนวนเป้าหมาย</span><b>{adminTargets.length} คน</b></div>
            </div>
            <PositiveRuleSelect rules={activePositiveRules} value={adminPositiveRuleId} disabled={adminAdditionBusy} onChange={(nextId) => { const nextRule = activePositiveRules.find((rule) => rule.id === nextId); setAdminPositiveRuleId(nextId); setPoints(nextRule?.defaultPoints ?? 1); invalidateAdminRequest() }} />
            {adminPositiveRule ? <PositiveRuleSummary rule={adminPositiveRule} /> : <p className="form-error">ยังไม่มีเกณฑ์การเพิ่มคะแนนที่เปิดใช้งาน</p>}
            <div className="date-field-grid">
              <label>วันและเวลาที่ทำกิจกรรม<input type="datetime-local" disabled={adminAdditionBusy} max={toLocalDateTimeInputValue()} value={activityOccurredAt} onChange={(event) => { setActivityOccurredAt(event.target.value); invalidateAdminRequest() }} required /></label>
              <label>จำนวนคะแนน<input type="number" disabled={adminAdditionBusy} min="1" max={adminPositiveRule?.maxPoints ?? 100} readOnly={!adminPositiveRule?.discretionary} value={points} onChange={(event) => { setPoints(Number(event.target.value)); invalidateAdminRequest() }} /></label>
            </div>
            {!adminPointValidation.valid && adminPointValidation.message ? <p className="form-error">{adminPointValidation.message}</p> : null}
            {adminTargets.length ? <div className="addition-preview"><span>คะแนนรวมหลังบันทึก (รายคนสูงสุด 100)</span><strong>{adminAdditionBeforeTotal} <i>→</i> {adminAdditionAfterTotal}</strong><small>ระบบจะเพิ่มจริงรวม {adminAdditionAppliedTotal} คะแนน</small></div> : null}
            <label>รายละเอียดเพิ่มเติม (ไม่บังคับ)<textarea disabled={adminAdditionBusy} value={reason} maxLength={2000} onChange={(event) => { setReason(event.target.value); invalidateAdminRequest() }} placeholder="หากมี สามารถอธิบายกิจกรรมหรือพฤติกรรมเพิ่มเติมได้" /></label>
            <EvidenceField
              note={adminEvidenceNote}
              files={adminEvidenceFiles}
              disabled={adminAdditionBusy}
              onNoteChange={(note) => { setAdminEvidenceNote(note); invalidateAdminRequest() }}
              onFilesChange={(files) => { setAdminEvidenceFiles(files); setAdminUploadedEvidence([]); invalidateAdminRequest() }}
            />
            <p className="scope-note"><Icon name="shield" size={18} /> นักเรียนเห็นเฉพาะชื่อเหตุผลและคะแนน ไม่เห็นรายละเอียดภายในหรือไฟล์หลักฐาน</p>
            {adminAdditionReview ? (
              <section className="deduction-review addition-review" aria-label="ตรวจสอบก่อนยืนยัน">
                <div className="review-heading"><div><p className="eyebrow">ขั้นตอนที่ 3 จาก 3</p><h2>ตรวจสอบก่อนเพิ่มคะแนน</h2></div><span className="counter">{adminTargets.length}</span></div>
                <div className="review-roster">
                  {adminTargets.map((student) => {
                    const change = applyScoreDelta(student.score, points)
                    return <div className="review-student" key={student.id}><span><strong>{student.name}</strong><small>{student.studentCode} • {student.classroomName}</small></span><b>{change.before} → {change.after}</b></div>
                  })}
                </div>
                <dl className="review-facts"><div><dt>เกณฑ์</dt><dd>{adminPositiveRule?.title}</dd></div><div><dt>วันเวลา</dt><dd>{formatThaiDate(localDateTimeToIso(activityOccurredAt) ?? activityOccurredAt)}</dd></div><div><dt>รายละเอียดเพิ่มเติม</dt><dd>{reason.trim() || 'ไม่ได้ระบุรายละเอียดเพิ่มเติม'}</dd></div></dl>
              </section>
            ) : null}
            <div className="form-actions">
              <button type="button" className="button secondary" disabled={adminAdditionBusy} onClick={() => { if (adminAdditionReview) setAdminAdditionReview(false); else { setReason(''); setAdminEvidenceNote(''); setAdminEvidenceFiles([]) } }}>{adminAdditionReview ? 'กลับไปแก้ไข' : 'ล้างรายละเอียด'}</button>
              <button className="button primary" type="submit" disabled={adminAdditionBusy || !adminPositiveRule || !adminTargets.length}>{adminAdditionBusy ? 'กำลังบันทึกทั้งชุด…' : adminAdditionReview ? `ยืนยันเพิ่มคะแนน ${adminTargets.length} คน` : 'ตรวจสอบก่อนยืนยัน'}</button>
            </div>
            {adminAdditionResult ? <div className="batch-result compact-result"><strong>บันทึกสำเร็จ {adminAdditionResult.targetCount} คน</strong><span>เพิ่มจริงรวม {adminAdditionResult.totalAppliedPoints} คะแนน</span></div> : null}
          </form>
          ) : (
          <form className="panel stack-form score-details-form" onSubmit={deductPointsDirectly}>
            <div className="section-heading"><div><p className="eyebrow">ขั้นตอนที่ 2 จาก 3</p><h2>รายละเอียดการตัดคะแนน</h2></div><button type="button" className="button ghost rules-reference-button" onClick={() => setRulesDialogTab('deduction')}><Icon name="book" size={17} /> ดูระเบียบทั้งหมด</button></div>
            <div className="selected-student-bar batch-target-bar">
              <div><span className="student-avatar large">{adminTargets.length}</span><div><strong>{adminTargets.length === 1 ? adminTargets[0]?.name : 'กลุ่มนักเรียนที่เลือก'}</strong><small>ทุกคนจะใช้เกณฑ์ วันเวลา และรายละเอียดเหตุการณ์เดียวกัน</small></div></div>
              <div><span>จำนวนเป้าหมาย</span><b>{adminTargets.length} คน</b></div>
            </div>
            <DeductionRuleSelect
              rules={activeDeductionRules}
              value={adminDeductionRuleId}
              disabled={mutationBusy}
              onChange={(ruleId) => { setAdminDeductionRuleId(ruleId); invalidateAdminDeduction() }}
            />
            {adminDeductionRule ? <div className="rule-summary"><div><StatusBadge severity={adminDeductionRule.severity} /> <span>{adminDeductionRule.category} • คนละ {adminDeductionRule.points} คะแนน</span></div><strong>{adminDeductionBeforeTotal} <span>→</span> {adminDeductionAfterTotal}</strong></div> : null}
            <label>วันและเวลาเกิดเหตุ<input type="datetime-local" disabled={mutationBusy} max={toLocalDateTimeInputValue()} value={adminDeductionOccurredAt} onChange={(event) => { setAdminDeductionOccurredAt(event.target.value); invalidateAdminDeduction() }} required /></label>
            <label>รายละเอียดเหตุการณ์เพิ่มเติม (ไม่บังคับ)<textarea disabled={mutationBusy} value={adminDeductionNote} maxLength={2000} onChange={(event) => { setAdminDeductionNote(event.target.value); invalidateAdminDeduction() }} placeholder="หากมี สามารถระบุข้อเท็จจริง สถานที่ หรือบริบทเพิ่มเติมได้" /></label>
            {adminDeductionRule?.guardianContactRequired ? <div className="warning-note"><Icon name="alert" /><span>เกณฑ์นี้เป็นกรณีร้ายแรง ระบบจะเปิดเคสติดตามและงานติดต่อผู้ปกครองแยกให้นักเรียนทุกคนโดยอัตโนมัติ</span></div> : null}
            {adminDeductionReview ? (
              <section className="deduction-review" aria-label="ตรวจสอบก่อนยืนยัน">
                <div className="review-heading"><div><p className="eyebrow">ขั้นตอนสุดท้าย</p><h2>ตรวจสอบรายชื่อก่อนบันทึก</h2></div><span className="counter">{adminTargets.length}</span></div>
                <div className="review-roster">
                  {adminTargets.map((student) => {
                    const change = applyScoreDelta(student.score, -(adminDeductionRule?.points ?? 0))
                    return <div className="review-student" key={student.id}><span><strong>{student.name}</strong><small>{student.studentCode} • {student.classroomName}</small></span><b>{change.before} → {change.after}</b></div>
                  })}
                </div>
                <dl className="review-facts"><div><dt>เหตุผล</dt><dd>{adminDeductionRule?.title}</dd></div><div><dt>วันเวลา</dt><dd>{formatThaiDate(localDateTimeToIso(adminDeductionOccurredAt) ?? adminDeductionOccurredAt)}</dd></div><div><dt>รายละเอียดเพิ่มเติม</dt><dd>{adminDeductionNote.trim() || 'ไม่ได้ระบุรายละเอียดเพิ่มเติม'}</dd></div></dl>
                {adminSeriousBulk ? <label className="confirmation-check"><input type="checkbox" disabled={mutationBusy} checked={adminConfirmSeriousBulk} onChange={(event) => setAdminConfirmSeriousBulk(event.target.checked)} /><span>ยืนยันว่าตรวจสอบรายชื่อกรณีร้ายแรงทั้ง {adminTargets.length} คนแล้ว และรับทราบว่าจะสร้างงานแจ้งผู้ปกครองรายคน</span></label> : null}
              </section>
            ) : null}
            <div className="form-actions">
              <button type="button" className="button secondary" disabled={mutationBusy} onClick={() => { if (!adminDeductionReview) setAdminDeductionNote(''); invalidateAdminDeduction() }}>{adminDeductionReview ? 'กลับไปแก้ไข' : 'ล้างรายละเอียด'}</button>
              <button type="submit" className="button primary" disabled={mutationBusy || !adminDeductionRule || !adminTargets.length}>{busyAction === 'admin-deduct' ? 'กำลังบันทึกทั้งชุด…' : adminDeductionReview ? `ยืนยันตัดคะแนน ${adminTargets.length} คน` : 'ตรวจสอบก่อนยืนยัน'}</button>
            </div>
            {adminDeductionResult ? <div className="batch-result compact-result"><strong>บันทึกสำเร็จ {adminDeductionResult.targetCount} คน</strong><span>ตัดคะแนนจริงรวม {adminDeductionResult.totalAppliedPoints} คะแนน</span></div> : null}
          </form>
          )}
          <section className="panel rules-panel"><div className="section-heading"><div><p className="eyebrow">ตรวจสอบย้อนหลัง</p><h2>ประวัติเพิ่มคะแนนโดยตรง</h2></div><span className="counter">{directAdditions.length}</span></div>
            {directAdditions.length ? <div className="record-list">{directAdditions.slice(0, 20).map((transaction) => { const student = state.students.find((item) => item.id === transaction.studentId); const detail = transaction.internalReason?.trim() !== transaction.positiveRuleTitle?.trim() ? transaction.internalReason?.trim() : ''; return <article className="record-row detailed-record" key={transaction.id}><div><strong>{student?.name ?? 'ไม่พบข้อมูลนักเรียน'} • +{transaction.appliedDelta} คะแนน</strong><span>{transaction.positiveRuleTitle ?? transaction.reason}</span>{detail ? <span>รายละเอียด: {detail}</span> : null}<small>หลักฐาน:</small><EvidenceSummary value={transaction.evidenceNote} resolveFileUrl={actions?.createEvidenceUrl} /><small>ทำกิจกรรม {formatThaiDate(transaction.activityOccurredAt ?? transaction.occurredAt)} • คะแนน {transaction.scoreBefore} → {transaction.scoreAfter}</small></div><span className="badge status-approved">บันทึกแล้ว</span></article> })}</div> : <EmptyState title="ยังไม่มีรายการเพิ่มโดยตรง" detail="รายการที่แอดมินเพิ่มพร้อมเกณฑ์และหลักฐานจะแสดงที่นี่" />}
          </section>
          </>}
          </> : null}
          {tab === 'manage' ? <>
          <TermScheduleForm
            key={`${state.term.id}:${state.term.startsOn ?? ''}:${state.term.endsOn ?? ''}:${state.term.isActive}`}
            term={state.term}
            busy={mutationBusy}
            activating={busyAction === 'term-activate'}
            onSave={updateTermSchedule}
            onActivate={activateTerm}
          />
          <section className="panel"><div className="section-heading"><div><p className="eyebrow">ภาคเรียน</p><h2>เริ่มคะแนนที่ 100</h2></div></div><p>รายการคะแนนเดิมยังคงอยู่ เคสติดตามที่ไม่เสร็จจะยกไปต่อโดยไม่ยกคะแนนติดลบ</p><div className="reset-preview"><span>นักเรียนที่จะรีเซ็ต <strong>{state.students.length}</strong></span><span>เคสที่จะคงไว้ <strong>{openCases.length}</strong></span></div><button className="button warning full" disabled={Boolean(state.term.resetCompletedAt) || mutationBusy} onClick={resetTermScores}>{busyAction === 'initialize-term' ? 'กำลังเตรียมคะแนน…' : state.term.resetCompletedAt ? `รีเซ็ตแล้ว ${formatThaiDate(state.term.resetCompletedAt)}` : 'ตรวจสอบและรีเซ็ตคะแนน'}</button></section>
          {onResetDemo ? <section className="panel danger-zone"><div className="section-heading"><div><p className="eyebrow">สำหรับการทดสอบ</p><h2>คืนค่าข้อมูลสาธิต</h2></div></div><p>ล้างเฉพาะข้อมูลสมมติในเบราว์เซอร์นี้ ไม่มีผลต่อฐานข้อมูลจริง</p><button className="button reject" disabled={mutationBusy} onClick={onResetDemo}>คืนค่าข้อมูลตัวอย่าง</button></section> : null}
          </> : null}
          {rulesDialogTab ? <ScoreRulesDialog initialTab={rulesDialogTab} deductionRules={state.rules} positiveRules={state.positiveRules} onClose={() => setRulesDialogTab(null)} /> : null}
        </div>
      ) : null}
    </AppShell>
  )
}
