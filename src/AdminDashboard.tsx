import { useMemo, useState, type FormEvent } from 'react'
import {
  applyScoreDelta,
  createId,
  formatThaiDate,
  type Account,
  type DemoState,
  type GuardianContact,
} from './domain'
import type {
  AdminAddPointsBulkResult,
  AppDataActions,
  RecordDeductionsResult,
  UpdateTeacherClassroomsInput,
  UpdateTermScheduleInput,
} from './dataActions'
import { EvidenceField, EvidenceSummary } from './EvidenceField'
import {
  encodeEvidenceBundle,
  hasEvidence,
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
import { AppShell, EmptyState, Icon, StatusBadge, type NavItem } from './ui'

export type AdminTab = 'overview' | 'approvals' | 'cases' | 'manage'

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

type DetailedAdditionRequest = DemoState['additionRequests'][number] & {
  positiveRuleTitle?: string
  evidenceNote?: string
  activityOccurredAt?: string
  teacherName?: string
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
  const pending = state.additionRequests.filter((item) => item.status === 'pending')
  const openCases = state.seriousCases.filter((item) => item.status !== 'resolved')
  const openAppeals = state.appeals.filter((item) => item.status === 'submitted' || item.status === 'reviewing')
  const directAdditions = state.transactions.filter((item) => item.additionSource === 'admin_direct')
  const [tab, setTab] = useState<AdminTab>(initialTab)
  const [adminScoreAction, setAdminScoreAction] = useState<ScoreAction>('addition')
  const [adminSelection, setAdminSelection] = useState(() => createInitialStudentSelection(state.students))
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
  const [adminDeductionRuleId, setAdminDeductionRuleId] = useState(activeDeductionRules[0]?.id ?? '')
  const [adminDeductionOccurredAt, setAdminDeductionOccurredAt] = useState(() => toLocalDateTimeInputValue())
  const [adminDeductionNote, setAdminDeductionNote] = useState('')
  const [adminDeductionReview, setAdminDeductionReview] = useState(false)
  const [adminConfirmSeriousBulk, setAdminConfirmSeriousBulk] = useState(false)
  const [adminDeductionRequestId, setAdminDeductionRequestId] = useState(() => newRequestId())
  const [adminDeductionResult, setAdminDeductionResult] = useState<RecordDeductionsResult | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const [rulesDialogTab, setRulesDialogTab] = useState<ScoreRulesDialogTab | null>(null)
  const [selectedRequestId, setSelectedRequestId] = useState(pending[0]?.id ?? state.additionRequests[0]?.id ?? '')
  const [reviewRequestOpen, setReviewRequestOpen] = useState(initialTab === 'approvals' && Boolean(pending[0]))
  const [decisionNote, setDecisionNote] = useState('')
  const [decisionError, setDecisionError] = useState('')
  const [selectedCaseId, setSelectedCaseId] = useState(openCases[0]?.id ?? '')
  const [caseNote, setCaseNote] = useState(openCases[0]?.followUpNote ?? '')
  const [guardianContactNote, setGuardianContactNote] = useState(openCases[0]?.guardianContactNote ?? '')
  const [guardianContacts, setGuardianContacts] = useState<GuardianContact[]>([])
  const [guardianContactsLoading, setGuardianContactsLoading] = useState(false)
  const [caseActionError, setCaseActionError] = useState('')
  const [assignmentTeacherId, setAssignmentTeacherId] = useState(state.teachers[0]?.id ?? '')
  const assignmentClassrooms = useMemo(() => buildClassroomGroups(state.students), [state.students])
  const assignmentTeacher = state.teachers.find((teacher) => teacher.id === assignmentTeacherId) ?? state.teachers[0]
  const adminTargets = resolveStudentTargets(state.students, adminSelection)
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
  const selectedRequest = (state.additionRequests.find((item) => item.id === selectedRequestId)
    ?? pending[0]
    ?? state.additionRequests[0]) as DetailedAdditionRequest | undefined
  const selectedRequestStudent = state.students.find((item) => item.id === selectedRequest?.studentId)
  const selectedRequestTeacher = state.teachers.find((item) => item.id === selectedRequest?.teacherId)
  const selectedRequestScore = selectedRequestStudent?.score ?? 0
  const selectedRequestScoreAfter = Math.min(100, selectedRequestScore + (selectedRequest?.requestedPoints ?? 0))
  const selectedCase = openCases.find((item) => item.id === selectedCaseId) ?? openCases[0]
  const selectedCaseStudent = state.students.find((student) => student.id === selectedCase?.studentId)
  const decisionNoteReady = decisionNote.trim().length >= 5
  const navItems: NavItem<AdminTab>[] = [
    { id: 'overview', label: 'แดชบอร์ด', icon: 'home' },
    { id: 'approvals', label: 'ศูนย์อนุมัติ', icon: 'approval', count: pending.length },
    { id: 'cases', label: 'คิวกรณีร้ายแรง', icon: 'alert', count: openCases.length },
    { id: 'manage', label: 'จัดการระบบ', icon: 'settings' },
  ]

  function openRequestReview(requestId: string) {
    const request = state.additionRequests.find((item) => item.id === requestId)
    setSelectedRequestId(requestId)
    setDecisionNote(request?.decisionNote ?? '')
    setDecisionError('')
    setTab('approvals')
    setReviewRequestOpen(true)
  }

  async function decideAdditionRequest(requestId: string, approve: boolean, note: string) {
    if (mutationBusy) return
    const request = state.additionRequests.find((item) => item.id === requestId)
    const student = state.students.find((item) => item.id === request?.studentId)
    if (!request) {
      setDecisionError('ไม่พบคำขอนี้ กรุณาปิดหน้าต่างแล้วโหลดรายการใหม่')
      return
    }
    if (request.status !== 'pending') {
      setDecisionError('คำขอนี้ได้รับการพิจารณาไปแล้ว กรุณาโหลดรายการใหม่')
      return
    }
    const normalizedNote = note.trim()
    if (normalizedNote.length < 5) {
      setDecisionError('กรุณาระบุเหตุผลประกอบการตัดสินใจอย่างน้อย 5 ตัวอักษร')
      return
    }
    setDecisionError('')
    if (actions) {
      setBusyAction(`request-${requestId}`)
      try {
        await actions.reviewPointAddition({ requestId, approve, note: normalizedNote })
        const studentName = student?.name ?? `นักเรียนรหัส ${request.studentId}`
        setAnnouncement(approve
          ? `อนุมัติคำขอเพิ่มคะแนนของ ${studentName} แล้ว`
          : `ปฏิเสธคำขอของ ${studentName} แล้ว คะแนนไม่เปลี่ยนแปลง`)
        setDecisionNote('')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'ไม่สามารถบันทึกผลการพิจารณาได้'
        setDecisionError(message)
        setAnnouncement(message)
      } finally {
        setBusyAction('')
      }
      return
    }
    if (!student) {
      setDecisionError('ไม่พบข้อมูลนักเรียนสำหรับคำขอนี้ จึงไม่สามารถจำลองการเปลี่ยนคะแนนได้')
      return
    }
    if (approve) {
      const change = applyScoreDelta(student.score, request.requestedPoints)
      onChange({
        ...state,
        students: state.students.map((item) => item.id === student.id ? { ...item, score: change.after } : item),
        additionRequests: state.additionRequests.map((item) => item.id === requestId ? { ...item, status: 'approved', decidedAt: new Date().toISOString(), decisionNote: normalizedNote } : item),
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
      setAnnouncement(`อนุมัติคำขอแล้ว คะแนนของ ${student.name} เปลี่ยนจาก ${change.before} เป็น ${change.after}`)
    } else {
      onChange({
        ...state,
        additionRequests: state.additionRequests.map((item) => item.id === requestId ? { ...item, status: 'rejected', decidedAt: new Date().toISOString(), decisionNote: normalizedNote } : item),
      })
      setAnnouncement(`ปฏิเสธคำขอของ ${student.name} แล้ว คะแนนไม่เปลี่ยนแปลง`)
    }
    setDecisionNote('')
  }

  async function decideAppeal(appealId: string, accepted: boolean) {
    if (mutationBusy) return
    const appeal = state.appeals.find((item) => item.id === appealId)
    if (!appeal || !['submitted', 'reviewing'].includes(appeal.status)) return
    if (actions) {
      setBusyAction(`appeal-${appealId}`)
      try {
        await actions.reviewAppeal({
          appealId,
          accept: accepted,
          note: accepted ? 'ตรวจสอบแล้วเห็นควรคืนคะแนนตามคำอุทธรณ์' : 'ตรวจสอบแล้วให้คงรายการเดิม',
        })
        setAnnouncement(accepted ? 'อนุมัติคำอุทธรณ์และสร้างรายการคืนคะแนนแล้ว' : 'ปฏิเสธคำอุทธรณ์แล้ว คะแนนเดิมยังคงอยู่')
      } catch (error) {
        setAnnouncement(error instanceof Error ? error.message : 'ไม่สามารถพิจารณาคำอุทธรณ์ได้')
      } finally {
        setBusyAction('')
      }
      return
    }
    const source = state.transactions.find((item) => item.id === appeal?.transactionId)
    const student = state.students.find((item) => item.id === appeal?.studentId)
    if (!source || !student) return
    if (!accepted) {
      onChange({
        ...state,
        appeals: state.appeals.map((item) => item.id === appealId ? { ...item, status: 'rejected' } : item),
      })
      setAnnouncement('ปฏิเสธคำอุทธรณ์แล้ว ประวัติและคะแนนเดิมยังคงอยู่')
      return
    }
    const change = applyScoreDelta(student.score, Math.abs(source.appliedDelta))
    onChange({
      ...state,
      students: state.students.map((item) => item.id === student.id ? { ...item, score: change.after } : item),
      appeals: state.appeals.map((item) => item.id === appealId ? { ...item, status: 'accepted' } : item),
      transactions: [{
        id: createId('tx'),
        studentId: student.id,
        termId: state.term.id,
        kind: 'addition',
        requestedDelta: Math.abs(source.appliedDelta),
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

  function invalidateAdminRequest() {
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
    setAnnouncement('')
  }

  async function addPointsDirectly(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mutationBusy) return
    const activityIso = localDateTimeToIso(activityOccurredAt)
    if (!adminPositiveRule || !adminPointValidation.valid || !activityIso) {
      setAnnouncement(adminPointValidation.message ?? 'กรุณาเลือกเหตุผลในการเพิ่มคะแนนและวันทำกิจกรรม')
      return
    }
    if (!hasEvidence(adminEvidenceNote, adminUploadedEvidence.length ? adminUploadedEvidence : adminEvidenceFiles)) {
      setAnnouncement('กรุณาพิมพ์คำอธิบายหลักฐานอย่างน้อย 5 ตัวอักษร หรือแนบไฟล์อย่างน้อย 1 ไฟล์')
      return
    }
    if (adminSelection.scope === 'selected' && adminTargets.length < 2) {
      setAnnouncement('โหมดเฉพาะกลุ่มต้องเลือกนักเรียนอย่างน้อย 2 คน')
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
    const encodedEvidence = encodeEvidenceBundle(adminEvidenceNote, attachments)
    if (actions) {
      try {
        const result = await actions.adminAddPointsBulk({
          clientRequestId: adminRequestId,
          scope: adminSelection.scope,
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
      scope: adminSelection.scope,
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
    if (adminSelection.scope === 'selected' && adminTargets.length < 2) {
      setAnnouncement('โหมดเฉพาะกลุ่มต้องเลือกนักเรียนอย่างน้อย 2 คน')
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
          scope: adminSelection.scope,
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
          scope: adminSelection.scope,
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

  function openCaseDetails(caseId: string) {
    const nextCase = openCases.find((item) => item.id === caseId)
    setSelectedCaseId(caseId)
    setCaseNote(nextCase?.followUpNote ?? '')
    setGuardianContactNote(nextCase?.guardianContactNote ?? '')
    setGuardianContacts([])
    setCaseActionError('')
  }

  async function loadGuardianContacts() {
    if (!selectedCase?.guardianTaskId || guardianContactsLoading) return
    setGuardianContactsLoading(true)
    setCaseActionError('')
    try {
      if (actions) {
        setGuardianContacts(await actions.getGuardianContacts(selectedCase.guardianTaskId))
      } else {
        setGuardianContacts([{
          id: 'guardian-demo-01',
          name: 'ผู้ปกครองตัวอย่าง',
          relationship: 'ผู้ปกครองหลัก',
          phoneNumber: '08X-XXX-XXXX',
          isPrimary: true,
        }])
      }
    } catch (error) {
      setCaseActionError(error instanceof Error ? error.message : 'ไม่สามารถโหลดข้อมูลติดต่อผู้ปกครองได้')
    } finally {
      setGuardianContactsLoading(false)
    }
  }

  async function completeGuardianContact() {
    if (!selectedCase?.guardianTaskId || mutationBusy) return
    const note = guardianContactNote.trim()
    if (note.length < 5) {
      setCaseActionError('กรุณาระบุผลการติดต่อผู้ปกครองอย่างน้อย 5 ตัวอักษร')
      return
    }
    setBusyAction('case-guardian')
    setCaseActionError('')
    try {
      if (actions) {
        await actions.completeGuardianContact({ taskId: selectedCase.guardianTaskId, note })
      } else {
        onChange({
          ...state,
          seriousCases: state.seriousCases.map((item) => item.id === selectedCase.id
            ? {
              ...item,
              guardianContactStatus: 'completed',
              guardianContactNote: note,
              guardianContactCompletedAt: new Date().toISOString(),
            }
            : item),
        })
      }
      setAnnouncement(`บันทึกการแจ้งผู้ปกครองของ ${selectedCaseStudent?.name ?? 'นักเรียน'} แล้ว`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ไม่สามารถบันทึกการแจ้งผู้ปกครองได้'
      setCaseActionError(message)
      setAnnouncement(message)
    } finally {
      setBusyAction('')
    }
  }

  async function updateFollowUpCase(status: 'following_up' | 'resolved') {
    if (!selectedCase || mutationBusy) return
    const note = caseNote.trim()
    if (note.length < 5) {
      setCaseActionError('กรุณาระบุบันทึกการติดตามอย่างน้อย 5 ตัวอักษร')
      return
    }
    if (status === 'resolved' && selectedCase.guardianContactStatus === 'pending') {
      setCaseActionError('ต้องบันทึกว่าแจ้งผู้ปกครองแล้วก่อนปิดเคส')
      return
    }
    setBusyAction(status === 'resolved' ? 'case-resolve' : 'case-follow')
    setCaseActionError('')
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
      setAnnouncement(status === 'resolved'
        ? `ปิดเคสของ ${selectedCaseStudent?.name ?? 'นักเรียน'} เรียบร้อยแล้ว`
        : `บันทึกการติดตามของ ${selectedCaseStudent?.name ?? 'นักเรียน'} แล้ว`)
      if (status === 'resolved') {
        setGuardianContacts([])
        setCaseNote('')
        setGuardianContactNote('')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ไม่สามารถบันทึกสถานะกรณีติดตามได้'
      setCaseActionError(message)
      setAnnouncement(message)
    } finally {
      setBusyAction('')
    }
  }

  return (
    <AppShell account={account} state={state} items={navItems} active={tab} onNavigate={setTab} onLogout={onLogout}>
      <div className="page-heading">
        <div><p className="eyebrow">ศูนย์ควบคุมระบบ</p><h1>{tab === 'overview' ? 'ภาพรวมวันนี้' : tab === 'approvals' ? 'ศูนย์อนุมัติ' : tab === 'cases' ? 'คิวกรณีร้ายแรง' : 'จัดการระบบ'}</h1></div>
        <span className="class-chip">ผู้ดูแลระบบ • สิทธิ์ทั้งหมด</span>
      </div>
      <div className="announcement" aria-live="polite">{announcement}</div>

      {tab === 'overview' ? (
        <>
          <section className="metric-strip" aria-label="สรุปข้อมูล">
            <button onClick={() => setTab('approvals')}><span><Icon name="approval" /></span><div><strong>{pending.length}</strong><small>คำขอเพิ่มคะแนนรออนุมัติ</small></div></button>
            <button onClick={() => setTab('cases')}><span className="danger"><Icon name="alert" /></span><div><strong>{openCases.length}</strong><small>กรณีร้ายแรงที่กำลังติดตาม</small></div></button>
            <div><span><Icon name="score" /></span><div><strong>{state.students.length}</strong><small>นักเรียนในภาคเรียนปัจจุบัน</small></div></div>
            <div><span><Icon name="history" /></span><div><strong>{openAppeals.length}</strong><small>คำอุทธรณ์รอพิจารณา</small></div></div>
          </section>
          <div className="two-column wide-left">
            <section className="panel"><div className="section-heading"><div><p className="eyebrow">เร่งดำเนินการ</p><h2>คำขอเพิ่มคะแนนล่าสุด</h2></div><button className="text-button" onClick={() => setTab('approvals')}>ดูทั้งหมด</button></div>
              {pending.length ? <div className="record-list">{pending.slice(0, 4).map((request) => { const student = state.students.find((item) => item.id === request.studentId); const details = request as DetailedAdditionRequest; return <article className="approval-row" key={request.id}><div><strong>{student?.name}</strong><span>{details.positiveRuleTitle ?? request.reason}</span><small>{formatThaiDate(request.createdAt)} • ขอเพิ่ม {request.requestedPoints} คะแนน</small></div><button className="button secondary compact" onClick={() => openRequestReview(request.id)}>ตรวจสอบรายละเอียด</button></article> })}</div> : <EmptyState title="ไม่มีคำขอรออนุมัติ" detail="คำขอใหม่จากคุณครูจะแสดงที่นี่" />}
            </section>
            <section className="panel"><div className="section-heading"><div><p className="eyebrow">ความปลอดภัย</p><h2>คิวติดตาม</h2></div><span className="counter danger">{openCases.length}</span></div>
              {openCases.length ? <div className="mini-case-list">{openCases.slice(0, 3).map((item) => { const student = state.students.find((entry) => entry.id === item.studentId); return <article key={item.id}><StatusBadge severity={item.severity} /><strong>{student?.name}</strong><span>{item.guardianContactStatus === 'pending' ? 'รอติดต่อผู้ปกครอง' : 'กำลังติดตาม'}</span></article> })}</div> : <EmptyState title="ไม่มีเคสค้าง" detail="กรณีร้ายแรงจะปรากฏที่นี่" />}
            </section>
          </div>
        </>
      ) : null}

      {tab === 'approvals' ? (
        <div className="approval-stack">
          <section className="panel">
            <div className="section-heading"><div><p className="eyebrow">ตรวจสอบก่อนดำเนินการ</p><h2>คำขอเพิ่มคะแนนจากคุณครู</h2></div><span className="counter">{pending.length}</span></div>
            {state.additionRequests.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>วันที่</th><th>นักเรียน</th><th>เกณฑ์ / เหตุผล</th><th>คะแนน</th><th>สถานะ / จัดการ</th></tr></thead>
                  <tbody>{state.additionRequests.map((request) => {
                    const student = state.students.find((item) => item.id === request.studentId)
                    const details = request as DetailedAdditionRequest
                    const requestDetail = request.reason.trim() !== details.positiveRuleTitle?.trim()
                      ? request.reason.trim()
                      : ''
                    return (
                      <tr key={request.id}>
                        <td>{formatThaiDate(request.createdAt)}</td>
                        <td><strong>{student?.name ?? 'ไม่พบข้อมูลนักเรียน'}</strong><small>{student?.studentCode} • ปัจจุบัน {student?.score ?? '—'}</small></td>
                        <td>{details.positiveRuleTitle ?? request.reason}<small>{requestDetail || 'ไม่ได้ระบุรายละเอียดเพิ่มเติม'}</small></td>
                        <td><span className="delta positive">+{request.requestedPoints}</span></td>
                        <td>
                          <div className="inline-actions">
                            <span className={`badge status-${request.status}`}>{request.status === 'pending' ? 'รอตรวจสอบ' : request.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}</span>
                            <button className="button secondary compact" onClick={() => openRequestReview(request.id)}>{request.status === 'pending' ? 'ตรวจสอบ' : 'ดูรายละเอียด'}</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}</tbody>
                </table>
              </div>
            ) : <EmptyState title="ยังไม่มีคำขอ" detail="เมื่อครูขอเพิ่มคะแนน รายการจะปรากฏที่นี่" />}
          </section>
          {reviewRequestOpen && selectedRequest ? (
            <div className="addition-review-dialog-backdrop">
            <section className="panel stack-form addition-review-dialog" role="dialog" aria-modal="true" aria-labelledby="addition-review-title">
              <div className="section-heading">
                <div><p className="eyebrow">รายละเอียดคำขอ</p><h2 id="addition-review-title">ตรวจสอบหลักฐานก่อนตัดสินใจ</h2></div>
                <div className="addition-review-dialog-heading-actions">
                  <span className={`badge status-${selectedRequest.status}`}>{selectedRequest.status === 'pending' ? 'รอตรวจสอบ' : selectedRequest.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}</span>
                  <button
                    type="button"
                    className="score-rules-dialog-close"
                    aria-label="ปิดรายละเอียดคำขอเพิ่มคะแนน"
                    disabled={mutationBusy}
                    onClick={() => setReviewRequestOpen(false)}
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="two-column">
                <div className="selected-record">
                  <strong>นักเรียน</strong>
                  <span>{selectedRequestStudent?.studentCode ?? 'ไม่พบรหัสนักเรียน'} • {selectedRequestStudent?.name ?? 'ไม่พบข้อมูลนักเรียน'}</span>
                  <span>{selectedRequestStudent?.classroomName ?? 'ไม่พบข้อมูลห้องเรียน'}</span>
                </div>
                <div className="selected-record">
                  <strong>ผู้ยื่นคำขอ</strong>
                  <span>{selectedRequest.teacherName ?? selectedRequestTeacher?.name ?? 'ไม่พบข้อมูลคุณครู'}</span>
                  <span>ยื่นเมื่อ {formatThaiDate(selectedRequest.createdAt)}</span>
                </div>
              </div>
              <div className="two-column">
                <div className="selected-record">
                  <strong>เกณฑ์กิจกรรมเพิ่มคะแนน</strong>
                  <span>{selectedRequest.positiveRuleTitle ?? 'ไม่ได้ระบุเกณฑ์กิจกรรม'}</span>
                  <span>ทำกิจกรรมเมื่อ {formatThaiDate(selectedRequest.activityOccurredAt || selectedRequest.createdAt)}</span>
                </div>
                <div className="selected-record">
                  <strong>รายละเอียดเพิ่มเติม</strong>
                  <span>{selectedRequest.reason.trim() !== selectedRequest.positiveRuleTitle?.trim() ? selectedRequest.reason : 'ไม่ได้ระบุรายละเอียดเพิ่มเติม'}</span>
                </div>
              </div>
              <div className="selected-record">
                <strong>รายละเอียดและหลักฐานจากคุณครู</strong>
                <EvidenceSummary value={selectedRequest.evidenceNote} resolveFileUrl={actions?.createEvidenceUrl} />
              </div>
              <div className="rule-summary" aria-label={`คะแนนปัจจุบัน ${selectedRequestScore} คะแนน หากอนุมัติจะเป็น ${selectedRequestScoreAfter} คะแนน`}>
                <div><Icon name="score" />คะแนนปัจจุบัน → หลังอนุมัติ (สูงสุด 100)</div>
                <strong>{selectedRequestScore}<span>→</span>{selectedRequestScoreAfter}</strong>
              </div>
              {selectedRequest.status === 'pending' ? (
                <>
                  <div className="addition-review-instruction">
                    <Icon name="approval" />
                    <span>ตรวจรายละเอียดและหลักฐาน จากนั้นระบุเหตุผลอย่างน้อย 5 ตัวอักษรก่อนเลือกอนุมัติหรือปฏิเสธ</span>
                  </div>
                  <label htmlFor="addition-decision-note">บันทึกผลการพิจารณา
                    <textarea
                      id="addition-decision-note"
                      disabled={mutationBusy}
                      value={decisionNote}
                      minLength={5}
                      required
                      aria-invalid={Boolean(decisionError)}
                      aria-describedby={`addition-decision-help${decisionError ? ' addition-decision-error' : ''}`}
                      placeholder="ระบุเหตุผลที่อนุมัติหรือปฏิเสธ เพื่อเก็บในประวัติตรวจสอบ"
                      onChange={(event) => { setDecisionNote(event.target.value); setDecisionError('') }}
                    />
                  </label>
                  <small id="addition-decision-help">ต้องระบุอย่างน้อย 5 ตัวอักษรก่อนอนุมัติหรือปฏิเสธ</small>
                  {decisionError ? <p className="form-error" id="addition-decision-error" role="alert">{decisionError}</p> : null}
                  <div className="form-actions">
                    <button type="button" className="button reject" disabled={!decisionNoteReady || mutationBusy} onClick={() => decideAdditionRequest(selectedRequest.id, false, decisionNote)}>
                      {busyAction === `request-${selectedRequest.id}` ? 'กำลังบันทึก…' : 'ปฏิเสธคำขอ'}
                    </button>
                    <button type="button" className="button approve" disabled={!decisionNoteReady || mutationBusy} onClick={() => decideAdditionRequest(selectedRequest.id, true, decisionNote)}>
                      {busyAction === `request-${selectedRequest.id}` ? 'กำลังบันทึก…' : `อนุมัติ +${selectedRequest.requestedPoints} คะแนน`}
                    </button>
                  </div>
                </>
              ) : (
                <div className="selected-record">
                  <strong>บันทึกผลการพิจารณา</strong>
                  <span>{selectedRequest.decisionNote?.trim() || 'ไม่มีบันทึกประกอบ'}</span>
                  <span>{selectedRequest.decidedAt ? `ดำเนินการเมื่อ ${formatThaiDate(selectedRequest.decidedAt)}` : 'ไม่พบเวลาที่ดำเนินการ'}</span>
                </div>
              )}
            </section>
            </div>
          ) : null}
          <section className="panel"><div className="section-heading"><div><p className="eyebrow">ไม่แก้รายการเดิม</p><h2>คำอุทธรณ์จากนักเรียน</h2></div><span className="counter">{openAppeals.length}</span></div>
            {state.appeals.length ? <div className="record-list">{state.appeals.map((appeal) => { const student = state.students.find((item) => item.id === appeal.studentId); const source = state.transactions.find((item) => item.id === appeal.transactionId); return <article className="appeal-review-row" key={appeal.id}><div><strong>{student?.name} • {Math.abs(source?.appliedDelta ?? 0)} คะแนน</strong><span>{appeal.statement}</span><small>ยื่นเมื่อ {formatThaiDate(appeal.createdAt)}</small></div>{appeal.status === 'submitted' || appeal.status === 'reviewing' ? <div className="inline-actions"><button className="button approve compact" disabled={mutationBusy} onClick={() => decideAppeal(appeal.id, true)}>คืนคะแนน</button><button className="button reject compact" disabled={mutationBusy} onClick={() => decideAppeal(appeal.id, false)}>ปฏิเสธ</button></div> : <span className={`badge status-${appeal.status === 'accepted' ? 'approved' : 'rejected'}`}>{appeal.status === 'accepted' ? 'คืนคะแนนแล้ว' : 'ไม่อนุมัติ'}</span>}</article> })}</div> : <EmptyState title="ยังไม่มีคำอุทธรณ์" detail="คำอุทธรณ์ที่นักเรียนยื่นภายใน 7 วันจะแสดงที่นี่" />}
          </section>
        </div>
      ) : null}

      {tab === 'cases' ? (
        <div className="case-management-grid">
          <section className="panel">
            <div className="section-heading"><div><p className="eyebrow">แยกจากงานคะแนนทั่วไป</p><h2>คิวกรณีร้ายแรง</h2></div><span className="counter danger">{openCases.length}</span></div>
            {openCases.length ? (
              <div className="case-management-list">
                {openCases.map((item) => {
                  const student = state.students.find((entry) => entry.id === item.studentId)
                  return (
                    <button type="button" className={selectedCase?.id === item.id ? 'case-management-item selected' : 'case-management-item'} key={item.id} onClick={() => openCaseDetails(item.id)}>
                      <span className="case-marker"><Icon name="alert" /></span>
                      <span><strong>{student?.name} • {student?.classroomName}</strong><small>เปิดเมื่อ {formatThaiDate(item.createdAt)}</small></span>
                      <span className={`badge ${item.status === 'open' ? 'status-pending' : 'status-approved'}`}>{item.status === 'open' ? 'รอเริ่มติดตาม' : 'กำลังติดตาม'}</span>
                    </button>
                  )
                })}
              </div>
            ) : <EmptyState title="ไม่มีกรณีร้ายแรงค้างอยู่" detail="เหตุการณ์ร้ายแรงจะสร้างเคสและงานติดต่อผู้ปกครองอัตโนมัติ" />}
          </section>

          {selectedCase ? (
            <section className="panel case-workflow-panel">
              <div className="section-heading">
                <div><p className="eyebrow">ดำเนินการและบันทึกหลักฐาน</p><h2>{selectedCaseStudent?.name ?? 'ไม่พบข้อมูลนักเรียน'}</h2></div>
                <StatusBadge severity={selectedCase.severity} />
              </div>
              <div className="case-facts">
                <div><span>ห้องเรียน</span><strong>{selectedCaseStudent?.classroomName ?? 'ไม่ระบุ'}</strong></div>
                <div><span>สถานะเคส</span><strong>{selectedCase.status === 'open' ? 'รอเริ่มติดตาม' : 'กำลังติดตาม'}</strong></div>
                <div><span>การแจ้งผู้ปกครอง</span><strong>{selectedCase.guardianContactStatus === 'pending' ? 'ยังไม่เสร็จ' : selectedCase.guardianContactStatus === 'completed' ? 'แจ้งแล้ว' : 'ไม่จำเป็น'}</strong></div>
              </div>
              <div className="selected-record">
                <strong>รายละเอียดเหตุการณ์</strong>
                <span>{selectedCase.internalNote || 'ไม่ได้ระบุรายละเอียดเพิ่มเติม'}</span>
                {selectedCase.followUpNote ? <span>บันทึกล่าสุด: {selectedCase.followUpNote}</span> : null}
                {selectedCase.managedAt ? <small>อัปเดตเมื่อ {formatThaiDate(selectedCase.managedAt)}</small> : null}
              </div>

              {selectedCase.guardianContactRequired ? (
                <section className="guardian-contact-panel" aria-label="การติดต่อผู้ปกครอง">
                  <div className="section-heading">
                    <div><p className="eyebrow">ข้อมูลส่วนบุคคลสำหรับงานนี้เท่านั้น</p><h3>ติดต่อผู้ปกครอง</h3></div>
                    <span className={`badge ${selectedCase.guardianContactStatus === 'completed' ? 'status-approved' : 'status-pending'}`}>
                      {selectedCase.guardianContactStatus === 'completed' ? 'แจ้งแล้ว' : 'รอดำเนินการ'}
                    </span>
                  </div>
                  <button className="button secondary" type="button" disabled={guardianContactsLoading || !selectedCase.guardianTaskId} onClick={() => void loadGuardianContacts()}>
                    {guardianContactsLoading ? 'กำลังโหลดข้อมูล…' : guardianContacts.length ? 'โหลดข้อมูลติดต่ออีกครั้ง' : 'ดูข้อมูลติดต่อผู้ปกครอง'}
                  </button>
                  {guardianContacts.length ? (
                    <div className="guardian-contact-list">
                      {guardianContacts.map((contact) => (
                        <div key={contact.id}><span><strong>{contact.name}</strong><small>{contact.relationship}{contact.isPrimary ? ' • ผู้ติดต่อหลัก' : ''}</small></span><a href={`tel:${contact.phoneNumber}`}>{contact.phoneNumber}</a></div>
                      ))}
                    </div>
                  ) : null}
                  <label>ผลการติดต่อผู้ปกครอง
                    <textarea disabled={mutationBusy || selectedCase.guardianContactStatus === 'completed'} value={guardianContactNote} maxLength={2000} onChange={(event) => { setGuardianContactNote(event.target.value); setCaseActionError('') }} placeholder="เช่น ติดต่อมารดาแล้ว รับทราบเหตุการณ์และนัดหมายพบครู" />
                  </label>
                  {selectedCase.guardianContactStatus === 'pending' ? (
                    <button className="button approve full" type="button" disabled={mutationBusy} onClick={() => void completeGuardianContact()}>
                      {busyAction === 'case-guardian' ? 'กำลังบันทึก…' : 'บันทึกว่าแจ้งผู้ปกครองแล้ว'}
                    </button>
                  ) : (
                    <p className="scope-note"><Icon name="shield" size={18} /> บันทึกแล้ว{selectedCase.guardianContactCompletedAt ? `เมื่อ ${formatThaiDate(selectedCase.guardianContactCompletedAt)}` : ''}</p>
                  )}
                </section>
              ) : null}

              <label>บันทึกการติดตาม
                <textarea disabled={mutationBusy} value={caseNote} maxLength={2000} onChange={(event) => { setCaseNote(event.target.value); setCaseActionError('') }} placeholder="ระบุสิ่งที่ดำเนินการ ผลการพูดคุย หรือมาตรการช่วยเหลือนักเรียน" />
              </label>
              {caseActionError ? <p className="form-error" role="alert">{caseActionError}</p> : null}
              <div className="case-workflow-actions">
                <button className="button secondary" type="button" disabled={mutationBusy} onClick={() => void updateFollowUpCase('following_up')}>
                  {busyAction === 'case-follow' ? 'กำลังบันทึก…' : selectedCase.status === 'open' ? 'เริ่มติดตามเคส' : 'บันทึกความคืบหน้า'}
                </button>
                <button className="button approve" type="button" disabled={mutationBusy || selectedCase.status !== 'following_up' || selectedCase.guardianContactStatus === 'pending'} onClick={() => void updateFollowUpCase('resolved')}>
                  {busyAction === 'case-resolve' ? 'กำลังปิดเคส…' : selectedCase.guardianContactStatus === 'pending' ? 'แจ้งผู้ปกครองก่อนปิดเคส' : 'ปิดเคสเรียบร้อย'}
                </button>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === 'manage' ? (
        <div className="manage-grid">
          <section className="panel teacher-access-panel">
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
          </section>
          <ScoreActionSelector
            value={adminScoreAction}
            onChange={changeAdminScoreAction}
            disabled={mutationBusy}
          />
          <StudentTargetSelector
            students={state.students}
            value={adminSelection}
            onChange={changeAdminSelection}
            disabled={mutationBusy}
            actionLabel={adminScoreAction === 'addition' ? 'เพิ่มคะแนน' : 'หักคะแนน'}
            stepStart={2}
          />
          {adminScoreAction === 'addition' ? (
          <form className="panel stack-form" onSubmit={addPointsDirectly}><div className="section-heading"><div><p className="eyebrow">สิทธิ์ผู้ดูแลระบบ</p><h2>เพิ่มคะแนนโดยตรงพร้อมหลักฐาน</h2></div><button type="button" className="button ghost rules-reference-button" onClick={() => setRulesDialogTab('addition')}><Icon name="book" size={17} /> ดูระเบียบทั้งหมด</button></div>
            <div className="selected-student-bar batch-target-bar">
              <div><span className="student-avatar large">{adminTargets.length}</span><div><strong>{adminSelection.scope === 'single' ? adminTargets[0]?.name ?? 'ยังไม่เลือกนักเรียน' : adminSelection.scope === 'selected' ? 'กลุ่มนักเรียนที่เลือก' : adminTargets[0]?.classroomName ?? 'ยังไม่เลือกห้อง'}</strong><small>รายการทั้งหมดใช้เกณฑ์ เหตุผล และหลักฐานชุดเดียวกัน</small></div></div>
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
            <button className="button primary" type="submit" disabled={adminAdditionBusy || !adminPositiveRule || !adminTargets.length}>{adminAdditionBusy ? 'กำลังบันทึกทั้งชุด…' : `เพิ่มคะแนน ${adminTargets.length} คนและบันทึกรายละเอียด`}</button>
            {adminAdditionResult ? <div className="batch-result compact-result"><strong>บันทึกสำเร็จ {adminAdditionResult.targetCount} คน</strong><span>เพิ่มจริงรวม {adminAdditionResult.totalAppliedPoints} คะแนน</span></div> : null}
          </form>
          ) : (
          <form className="panel stack-form" onSubmit={deductPointsDirectly}>
            <div className="section-heading"><div><p className="eyebrow">สิทธิ์ผู้ดูแลระบบ</p><h2>ตัดคะแนนพร้อมตรวจสอบรายชื่อ</h2></div><button type="button" className="button ghost rules-reference-button" onClick={() => setRulesDialogTab('deduction')}><Icon name="book" size={17} /> ดูระเบียบทั้งหมด</button></div>
            <div className="selected-student-bar batch-target-bar">
              <div><span className="student-avatar large">{adminTargets.length}</span><div><strong>{adminSelection.scope === 'single' ? adminTargets[0]?.name ?? 'ยังไม่เลือกนักเรียน' : adminSelection.scope === 'selected' ? 'กลุ่มนักเรียนที่เลือก' : adminTargets[0]?.classroomName ?? 'ยังไม่เลือกห้อง'}</strong><small>ทุกคนจะใช้เกณฑ์ วันเวลา และรายละเอียดเหตุการณ์เดียวกัน</small></div></div>
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
          <TermScheduleForm
            key={`${state.term.id}:${state.term.startsOn ?? ''}:${state.term.endsOn ?? ''}:${state.term.isActive}`}
            term={state.term}
            busy={mutationBusy}
            activating={busyAction === 'term-activate'}
            onSave={updateTermSchedule}
            onActivate={activateTerm}
          />
          <section className="panel rules-panel"><div className="section-heading"><div><p className="eyebrow">ตรวจสอบย้อนหลัง</p><h2>ประวัติเพิ่มคะแนนโดยตรง</h2></div><span className="counter">{directAdditions.length}</span></div>
            {directAdditions.length ? <div className="record-list">{directAdditions.slice(0, 20).map((transaction) => { const student = state.students.find((item) => item.id === transaction.studentId); const detail = transaction.internalReason?.trim() !== transaction.positiveRuleTitle?.trim() ? transaction.internalReason?.trim() : ''; return <article className="record-row detailed-record" key={transaction.id}><div><strong>{student?.name ?? 'ไม่พบข้อมูลนักเรียน'} • +{transaction.appliedDelta} คะแนน</strong><span>{transaction.positiveRuleTitle ?? transaction.reason}</span>{detail ? <span>รายละเอียด: {detail}</span> : null}<small>หลักฐาน:</small><EvidenceSummary value={transaction.evidenceNote} resolveFileUrl={actions?.createEvidenceUrl} /><small>ทำกิจกรรม {formatThaiDate(transaction.activityOccurredAt ?? transaction.occurredAt)} • คะแนน {transaction.scoreBefore} → {transaction.scoreAfter}</small></div><span className="badge status-approved">บันทึกแล้ว</span></article> })}</div> : <EmptyState title="ยังไม่มีรายการเพิ่มโดยตรง" detail="รายการที่แอดมินเพิ่มพร้อมเกณฑ์และหลักฐานจะแสดงที่นี่" />}
          </section>
          <section className="panel"><div className="section-heading"><div><p className="eyebrow">ภาคเรียน</p><h2>เริ่มคะแนนที่ 100</h2></div></div><p>รายการคะแนนเดิมยังคงอยู่ เคสติดตามที่ไม่เสร็จจะยกไปต่อโดยไม่ยกคะแนนติดลบ</p><div className="reset-preview"><span>นักเรียนที่จะรีเซ็ต <strong>{state.students.length}</strong></span><span>เคสที่จะคงไว้ <strong>{openCases.length}</strong></span></div><button className="button warning full" disabled={Boolean(state.term.resetCompletedAt) || mutationBusy} onClick={resetTermScores}>{busyAction === 'initialize-term' ? 'กำลังเตรียมคะแนน…' : state.term.resetCompletedAt ? `รีเซ็ตแล้ว ${formatThaiDate(state.term.resetCompletedAt)}` : 'ตรวจสอบและรีเซ็ตคะแนน'}</button></section>
          {onResetDemo ? <section className="panel danger-zone"><div className="section-heading"><div><p className="eyebrow">สำหรับการทดสอบ</p><h2>คืนค่าข้อมูลสาธิต</h2></div></div><p>ล้างเฉพาะข้อมูลสมมติในเบราว์เซอร์นี้ ไม่มีผลต่อฐานข้อมูลจริง</p><button className="button reject" disabled={mutationBusy} onClick={onResetDemo}>คืนค่าข้อมูลตัวอย่าง</button></section> : null}
          {rulesDialogTab ? <ScoreRulesDialog initialTab={rulesDialogTab} deductionRules={state.rules} positiveRules={state.positiveRules} onClose={() => setRulesDialogTab(null)} /> : null}
        </div>
      ) : null}
    </AppShell>
  )
}
