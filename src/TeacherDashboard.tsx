import { useMemo, useState, type FormEvent } from 'react'
import {
  applyScoreDelta,
  createId,
  formatThaiDate,
  studentDisplayName,
  type Account,
  type DemoState,
} from './domain'
import type {
  AppDataActions,
  RecordDeductionsResult,
  RequestDeductionsResult,
  RequestPointAdditionsResult,
} from './dataActions'
import { requiresDeductionApproval } from './adminDomain'
import {
  localDateTimeToIso,
  toLocalDateTimeInputValue,
  validatePositiveRulePoints,
} from './teacherWorkflows'
import { EvidenceField, EvidenceSummary } from './EvidenceField'
import {
  encodeEvidenceBundle,
  type EvidenceAttachment,
} from './evidence'
import {
  DeductionRuleSelect,
  PositiveRuleSelect,
  PositiveRuleSummary,
  ScoreRulesDialog,
  type ScoreRulesDialogTab,
} from './ScoreRulesDialog'
import { StudentTargetSelector } from './StudentTargetSelector'
import { StudentAvatar } from './ProfileAvatar'
import {
  buildClassroomGroups,
  createInitialStudentSelection,
  resolveStudentTargets,
  selectionForStudent,
} from './studentSelection'
import { AppShell, EmptyState, Icon, StatusBadge, type NavItem } from './ui'

type TeacherTab = 'overview' | 'deduct' | 'request' | 'cases' | 'rules'

interface TeacherDashboardProps {
  account: Account
  state: DemoState
  onChange: (next: DemoState) => void
  actions?: AppDataActions
  initialTab?: TeacherTab
  onLogout: () => void
}

function newRequestId(): string {
  return globalThis.crypto.randomUUID()
}

function behaviorSeverityForProposal(points: number) {
  if (points >= 50) return 'critical' as const
  if (points >= 25) return 'serious' as const
  if (points >= 10) return 'medium' as const
  return 'low' as const
}

export function TeacherDashboard({
  account,
  state,
  onChange,
  actions,
  initialTab = 'overview',
  onLogout,
}: TeacherDashboardProps) {
  const [tab, setTab] = useState<TeacherTab>(initialTab)
  const teacher = state.teachers.find((item) => item.id === account.teacherId)
  const assignedStudents = useMemo(
    () => state.students.filter((student) => student.status === 'active'
      && (teacher?.canScoreAllClassrooms || teacher?.classroomIds.includes(student.classroomId))),
    [state.students, teacher?.canScoreAllClassrooms, teacher?.classroomIds],
  )
  const classrooms = useMemo(() => buildClassroomGroups(assignedStudents), [assignedStudents])
  const activeDeductionRules = useMemo(
    () => state.rules
      .filter((rule) => rule.active)
      .sort((left, right) => left.points - right.points
        || left.category.localeCompare(right.category, 'th')
        || left.title.localeCompare(right.title, 'th')),
    [state.rules],
  )
  const activePositiveRules = useMemo(
    () => state.positiveRules
      .filter((rule) => rule.active)
      .sort((left, right) => left.title.localeCompare(right.title, 'th')),
    [state.positiveRules],
  )

  const [deductionSelection, setDeductionSelection] = useState(() => createInitialStudentSelection(assignedStudents))
  const [ruleId, setRuleId] = useState(activeDeductionRules[0]?.id ?? '')
  const [occurredAt, setOccurredAt] = useState(() => toLocalDateTimeInputValue())
  const [internalNote, setInternalNote] = useState('')
  const [reviewingDeduction, setReviewingDeduction] = useState(false)
  const [confirmSeriousBulk, setConfirmSeriousBulk] = useState(false)
  const [deductionRequestId, setDeductionRequestId] = useState(() => newRequestId())
  const [deductionResult, setDeductionResult] = useState<RecordDeductionsResult | null>(null)
  const [deductionApprovalResult, setDeductionApprovalResult] = useState<RequestDeductionsResult | null>(null)

  const [additionSelection, setAdditionSelection] = useState(() => createInitialStudentSelection(assignedStudents))
  const [positiveRuleId, setPositiveRuleId] = useState(activePositiveRules[0]?.id ?? '')
  const initialPositiveRule = activePositiveRules[0]
  const [requestPoints, setRequestPoints] = useState(initialPositiveRule?.defaultPoints ?? 1)
  const [activityOccurredAt, setActivityOccurredAt] = useState(() => toLocalDateTimeInputValue())
  const [requestReason, setRequestReason] = useState('')
  const [evidenceNote, setEvidenceNote] = useState('')
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([])
  const [uploadedEvidence, setUploadedEvidence] = useState<EvidenceAttachment[]>([])
  const [additionRequestId, setAdditionRequestId] = useState(() => newRequestId())
  const [additionResult, setAdditionResult] = useState<RequestPointAdditionsResult | null>(null)

  const [announcement, setAnnouncement] = useState('')
  const [deductionError, setDeductionError] = useState('')
  const [additionError, setAdditionError] = useState('')
  const [deductionBusy, setDeductionBusy] = useState(false)
  const [additionBusy, setAdditionBusy] = useState(false)
  const [rulesDialogTab, setRulesDialogTab] = useState<ScoreRulesDialogTab | null>(null)
  const [proposalKind, setProposalKind] = useState<'deduction' | 'positive'>('deduction')
  const [proposalTitle, setProposalTitle] = useState('')
  const [proposalDescription, setProposalDescription] = useState('')
  const [proposalPoints, setProposalPoints] = useState(5)
  const [proposalDiscretionary, setProposalDiscretionary] = useState(false)
  const [proposalBusy, setProposalBusy] = useState(false)
  const [proposalError, setProposalError] = useState('')
  const selectedRule = activeDeductionRules.find((item) => item.id === ruleId)
  const deductionNeedsApproval = Boolean(selectedRule && requiresDeductionApproval(selectedRule.points))
  const selectedPositiveRule = activePositiveRules.find((item) => item.id === positiveRuleId)
  const additionTargets = resolveStudentTargets(assignedStudents, additionSelection)
  const additionBeforeTotal = additionTargets.reduce((sum, student) => sum + student.score, 0)
  const additionAfterTotal = additionTargets.reduce((sum, student) => sum + applyScoreDelta(student.score, requestPoints).after, 0)
  const additionAppliedTotal = additionAfterTotal - additionBeforeTotal
  const pointValidation = validatePositiveRulePoints(selectedPositiveRule, requestPoints)
  const deductionTargets = resolveStudentTargets(assignedStudents, deductionSelection)
  const isSeriousBulk = Boolean(selectedRule && ['serious', 'critical'].includes(selectedRule.severity) && deductionTargets.length > 1)
  const teacherRequests = state.additionRequests.filter((item) => item.teacherId === teacher?.id)
  const teacherDeductionRequests = state.deductionRequests.filter((item) => item.teacherId === teacher?.id)
  const assignedCases = state.seriousCases.filter((item) => assignedStudents.some((student) => student.id === item.studentId))
  const teacherRuleProposals = state.ruleProposals.filter((item) => item.proposedBy === account.id)
  const navItems: NavItem<TeacherTab>[] = [
    { id: 'overview', label: 'ห้องที่รับผิดชอบ', icon: 'users' },
    { id: 'deduct', label: 'ตัดคะแนน', icon: 'score', count: teacherDeductionRequests.filter((item) => item.status === 'pending').length },
    { id: 'request', label: 'เพิ่มคะแนน', icon: 'plus', count: teacherRequests.filter((item) => item.status === 'pending').length },
    { id: 'cases', label: 'กรณีติดตาม', icon: 'alert', count: assignedCases.filter((item) => item.status !== 'resolved').length },
    { id: 'rules', label: 'เสนอเกณฑ์', icon: 'book', count: teacherRuleProposals.filter((item) => item.status === 'pending').length },
  ]

  if (!teacher) return <p>ไม่พบข้อมูลครู</p>
  const currentTeacher = teacher

  function resetDeductionReview() {
    setReviewingDeduction(false)
    setConfirmSeriousBulk(false)
    setDeductionResult(null)
    setDeductionApprovalResult(null)
  }

  function invalidateDeductionRequest() {
    resetDeductionReview()
    setDeductionError('')
    setDeductionRequestId(newRequestId())
  }

  function invalidateAdditionRequest() {
    setAdditionResult(null)
    setAdditionError('')
    setAdditionRequestId(newRequestId())
  }

  function changeDeductionSelection(next: typeof deductionSelection) {
    setDeductionSelection(next)
    invalidateDeductionRequest()
  }

  function changeAdditionSelection(next: typeof additionSelection) {
    setAdditionSelection(next)
    invalidateAdditionRequest()
  }

  async function submitRuleProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = proposalTitle.trim()
    if (title.length < 3) {
      setProposalError('กรุณาระบุชื่อเกณฑ์อย่างน้อย 3 ตัวอักษร')
      return
    }
    if (!Number.isInteger(proposalPoints) || proposalPoints < 1 || proposalPoints > 100) {
      setProposalError('คะแนนต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 100')
      return
    }
    setProposalBusy(true)
    setProposalError('')
    try {
      if (actions) {
        await actions.proposeRule({
          kind: proposalKind,
          title,
          points: proposalPoints,
          description: proposalDescription.trim() || undefined,
          discretionary: proposalKind === 'positive' && proposalDiscretionary,
        })
      } else {
        onChange({
          ...state,
          ruleProposals: [{
            id: createId('rule-proposal'),
            proposedBy: account.id,
            kind: proposalKind,
            title,
            description: proposalDescription.trim() || undefined,
            points: proposalPoints,
            discretionary: proposalKind === 'positive' && proposalDiscretionary,
            status: 'pending',
            createdAt: new Date().toISOString(),
          }, ...state.ruleProposals],
        })
      }
      setProposalTitle('')
      setProposalDescription('')
      setAnnouncement('ส่งข้อเสนอเกณฑ์ให้แอดมินตรวจสอบแล้ว เกณฑ์ยังไม่เปิดใช้จนกว่าจะได้รับอนุมัติ')
    } catch (error) {
      setProposalError(error instanceof Error ? error.message : 'ไม่สามารถส่งข้อเสนอเกณฑ์ได้')
    } finally {
      setProposalBusy(false)
    }
  }

  function navigateTeacherTab(nextTab: TeacherTab) {
    if (nextTab !== tab) {
      if (nextTab !== 'deduct') {
        setReviewingDeduction(false)
        setConfirmSeriousBulk(false)
      }
      setRulesDialogTab(null)
      setAnnouncement('')
      setDeductionError('')
      setAdditionError('')
    }
    setTab(nextTab)
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }

  function reportDeductionError(message: string) {
    setDeductionError(message)
    setAnnouncement(message)
  }

  function reportAdditionError(message: string) {
    setAdditionError(message)
    setAnnouncement(message)
  }

  async function recordDeductions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const eventIso = localDateTimeToIso(occurredAt)
    if (!selectedRule || !eventIso) {
      reportDeductionError('กรุณาเลือกเหตุผลในการตัดคะแนนและวันเวลาเกิดเหตุ')
      return
    }
    if (!deductionTargets.length) {
      reportDeductionError('กรุณาเลือกนักเรียนหรือห้องเรียนที่ต้องการตัดคะแนน')
      return
    }
    if (!currentTeacher.canScoreAllClassrooms && !deductionTargets.every((student) => currentTeacher.classroomIds.includes(student.classroomId))) {
      reportDeductionError('มีนักเรียนอยู่นอกห้องที่คุณครูรับผิดชอบ ระบบจึงยกเลิกรายการทั้งหมด')
      return
    }
    if (!reviewingDeduction) {
      setDeductionError('')
      setReviewingDeduction(true)
      setAnnouncement(`ตรวจสอบรายชื่อ ${deductionTargets.length} คนและคะแนนก่อนยืนยันบันทึก`)
      return
    }
    if (isSeriousBulk && !confirmSeriousBulk) {
      reportDeductionError('กรุณายืนยันว่าตรวจสอบรายชื่อนักเรียนกรณีร้ายแรงครบถ้วนแล้ว')
      return
    }

    setDeductionBusy(true)
    try {
      const input = {
        clientRequestId: deductionRequestId,
        scope: deductionTargets.length === 1 ? 'single' as const : 'selected' as const,
        studentIds: deductionTargets.map((student) => student.id),
        classroomId: deductionSelection.classroomId,
        ruleId: selectedRule.id,
        occurredAt: eventIso,
        internalNote: internalNote.trim() || selectedRule.title,
        confirmSeriousBulk: isSeriousBulk && confirmSeriousBulk,
      }

      if (deductionNeedsApproval) {
        let approvalResult: RequestDeductionsResult
        if (actions) {
          approvalResult = await actions.requestDeductions({ ...input, internalNote: internalNote.trim() })
        } else {
          const batchId = createId('deduction-request-batch')
          const createdAt = new Date().toISOString()
          const requests = deductionTargets.map((student) => ({
            studentId: student.id,
            requestId: createId('deduction-request'),
            status: 'pending' as const,
          }))
          onChange({
            ...state,
            deductionRequests: [
              ...requests.map((request) => ({
                id: request.requestId,
                batchId,
                studentId: request.studentId,
                teacherId: currentTeacher.id,
                ruleId: selectedRule.id,
                ruleTitle: selectedRule.title,
                requestedPoints: selectedRule.points,
                occurredAt: eventIso,
                internalNote: internalNote.trim(),
                status: 'pending' as const,
                createdAt,
              })),
              ...state.deductionRequests,
            ],
          })
          approvalResult = {
            ok: true,
            replayed: false,
            batchId,
            scope: input.scope,
            classroomId: input.classroomId,
            targetCount: requests.length,
            requestedPointsEach: selectedRule.points,
            requests,
          }
        }
        setDeductionApprovalResult(approvalResult)
        setDeductionResult(null)
        setInternalNote('')
        setReviewingDeduction(false)
        setConfirmSeriousBulk(false)
        setDeductionError('')
        setDeductionRequestId(newRequestId())
        setAnnouncement(`ส่งคำขอตัดคะแนน ${approvalResult.targetCount} คนให้แอดมินตรวจแล้ว คะแนนยังไม่เปลี่ยนแปลง`)
        return
      }

      let result: RecordDeductionsResult
      if (actions) {
        result = await actions.recordDeductions({
          ...input,
        })
      } else {
        const resultRows = deductionTargets.map((student) => {
          const change = applyScoreDelta(student.score, -selectedRule.points)
          return {
            studentId: student.id,
            incidentId: createId('incident'),
            requestedPoints: selectedRule.points,
            appliedPoints: Math.abs(change.appliedDelta),
            balanceBefore: change.before,
            balanceAfter: change.after,
          }
        })
        const occurredAtIso = eventIso
        const newTransactions = resultRows.map((row) => ({
          id: createId('tx'),
          studentId: row.studentId,
          termId: state.term.id,
          kind: 'deduction' as const,
          requestedDelta: -row.requestedPoints,
          appliedDelta: -row.appliedPoints,
          scoreBefore: row.balanceBefore,
          scoreAfter: row.balanceAfter,
          ruleId: selectedRule.id,
          reason: internalNote.trim() || selectedRule.title,
          occurredAt: occurredAtIso,
          actorId: account.id,
          incidentId: row.incidentId,
        }))
        const newCases = selectedRule.severity === 'serious' || selectedRule.severity === 'critical'
          ? newTransactions.map((transaction) => ({
            id: createId('case'),
            transactionId: transaction.id,
            studentId: transaction.studentId,
            severity: selectedRule.severity as 'serious' | 'critical',
            status: 'open' as const,
            guardianContactRequired: selectedRule.guardianContactRequired,
            guardianContactStatus: selectedRule.guardianContactRequired ? 'pending' as const : 'not_required' as const,
            guardianTaskId: selectedRule.guardianContactRequired ? createId('guardian-task') : undefined,
            createdAt: occurredAtIso,
            internalNote: `ติดตามเหตุการณ์: ${internalNote.trim() || selectedRule.title}`,
          }))
          : []
        const resultByStudent = new Map(resultRows.map((row) => [row.studentId, row]))
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
          batchId: createId('batch'),
          scope: deductionTargets.length === 1 ? 'single' : 'selected',
          classroomId: deductionSelection.classroomId,
          targetCount: resultRows.length,
          requestedPointsEach: selectedRule.points,
          totalRequestedPoints: resultRows.length * selectedRule.points,
          totalAppliedPoints: resultRows.reduce((sum, row) => sum + row.appliedPoints, 0),
          alreadyAtZeroCount: resultRows.filter((row) => row.appliedPoints === 0).length,
          guardianTaskCount: selectedRule.guardianContactRequired ? resultRows.length : 0,
          results: resultRows,
        }
      }
      setDeductionResult(result)
      setInternalNote('')
      setReviewingDeduction(false)
      setConfirmSeriousBulk(false)
      setDeductionError('')
      setDeductionRequestId(newRequestId())
      setAnnouncement(`บันทึกครบ ${result.targetCount} คน ตัดคะแนนจริงรวม ${result.totalAppliedPoints} คะแนนเรียบร้อยแล้ว`)
    } catch (error) {
      reportDeductionError(error instanceof Error ? error.message : 'ไม่สามารถบันทึกการตัดคะแนนได้ ระบบไม่ได้บันทึกเพียงบางคน')
    } finally {
      setDeductionBusy(false)
    }
  }

  async function submitAdditionRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const activityIso = localDateTimeToIso(activityOccurredAt)
    if (!selectedPositiveRule || !pointValidation.valid || !activityIso) {
      reportAdditionError(pointValidation.message ?? 'กรุณาเลือกเหตุผลในการเพิ่มคะแนนและวันทำกิจกรรม')
      return
    }
    if (!additionTargets.length) {
      reportAdditionError('กรุณาเลือกนักเรียนหรือห้องเรียนที่ต้องการเพิ่มคะแนน')
      return
    }
    if (!currentTeacher.canScoreAllClassrooms && !additionTargets.every((student) => currentTeacher.classroomIds.includes(student.classroomId))) {
      reportAdditionError('มีนักเรียนอยู่นอกห้องที่คุณครูรับผิดชอบ ระบบจึงยกเลิกรายการทั้งหมด')
      return
    }
    setAdditionBusy(true)
    try {
      const attachments = uploadedEvidence.length
        ? uploadedEvidence
        : evidenceFiles.length
          ? actions
            ? await actions.uploadEvidenceFiles(evidenceFiles)
            : evidenceFiles.map((file) => ({
              path: `demo/${newRequestId()}/${file.name}`,
              name: file.name,
              size: file.size,
              contentType: file.type,
            }))
          : []
      if (actions && attachments.length) setUploadedEvidence(attachments)
      const normalizedReason = requestReason.trim() || selectedPositiveRule.title
      const encodedEvidence = encodeEvidenceBundle(evidenceNote, attachments)
      let result: RequestPointAdditionsResult
      if (actions) {
        result = await actions.requestPointAdditions({
          clientRequestId: additionRequestId,
          scope: additionTargets.length === 1 ? 'single' : 'selected',
          studentIds: additionTargets.map((student) => student.id),
          classroomId: additionSelection.classroomId,
          positiveRuleId: selectedPositiveRule.id,
          points: requestPoints,
          activityOccurredAt: activityIso,
          reason: normalizedReason,
          evidenceNote: encodedEvidence,
        })
      } else {
        const requestRows = additionTargets.map((student) => ({
          student,
          requestId: createId('request'),
        }))
        onChange({
          ...state,
          additionRequests: [...requestRows.map(({ student, requestId }) => ({
            id: requestId,
            studentId: student.id,
            teacherId: currentTeacher.id,
            positiveRuleId: selectedPositiveRule.id,
            positiveRuleCode: selectedPositiveRule.code,
            positiveRuleTitle: selectedPositiveRule.title,
            requestedPoints: requestPoints,
            reason: normalizedReason,
            evidenceNote: encodedEvidence,
            activityOccurredAt: activityIso,
            status: 'pending' as const,
            createdAt: new Date().toISOString(),
          })), ...state.additionRequests],
        })
        result = {
          ok: true,
          replayed: false,
          batchId: createId('addition-batch'),
          scope: additionTargets.length === 1 ? 'single' : 'selected',
          classroomId: additionSelection.classroomId,
          targetCount: requestRows.length,
          requestedPointsEach: requestPoints,
          requests: requestRows.map(({ student, requestId }) => ({
            studentId: student.id,
            requestId,
            status: 'pending',
          })),
        }
      }
      setAdditionResult(result)
      setRequestReason('')
      setEvidenceNote('')
      setEvidenceFiles([])
      setUploadedEvidence([])
      setAdditionError('')
      setAdditionRequestId(newRequestId())
      setAnnouncement(`ส่งคำขอครบ ${result.targetCount} คนแล้ว คะแนนยังไม่เปลี่ยนจนกว่าแอดมินจะอนุมัติรายคน`)
    } catch (error) {
      reportAdditionError(error instanceof Error ? error.message : 'ไม่สามารถส่งคำขอเพิ่มคะแนนทั้งชุดได้ ระบบไม่ได้บันทึกเพียงบางคน')
    } finally {
      setAdditionBusy(false)
    }
  }

  const classChip = classrooms.length === 1
    ? `${classrooms[0].name} • ${assignedStudents.length} คน`
    : currentTeacher.canScoreAllClassrooms
      ? `ทุกชั้นเรียน • ${assignedStudents.length} คน`
      : `${classrooms.length} ห้องที่รับผิดชอบ • ${assignedStudents.length} คน`

  return (
    <AppShell account={account} state={state} items={navItems} active={tab} onNavigate={navigateTeacherTab} onLogout={onLogout}>
      <div className="page-heading">
        <div><p className="eyebrow">พื้นที่ของคุณครู</p><h1>{tab === 'overview' ? 'นักเรียนที่ดูแล' : tab === 'deduct' ? 'ตัดคะแนนนักเรียน' : tab === 'request' ? 'เพิ่มคะแนนนักเรียน' : tab === 'cases' ? 'กรณีติดตาม' : 'เสนอเกณฑ์คะแนน'}</h1></div>
        <span className="class-chip">{classrooms.length ? classChip : 'ยังไม่มอบหมายห้อง'}</span>
      </div>
      <div className="announcement" aria-live="polite">{announcement}</div>

      {tab === 'overview' ? (
        <section className="panel">
          <div className="section-heading"><div><p className="eyebrow">ภาคเรียนปัจจุบัน</p><h2>รายชื่อนักเรียนที่ดูแล</h2></div><button className="button primary compact" onClick={() => navigateTeacherTab('deduct')}><Icon name="plus" size={17} /> ตัดคะแนน</button></div>
          <div className="table-wrap"><table className="teacher-roster-table"><thead><tr><th>รหัส</th><th>นักเรียน</th><th>ห้อง</th><th>คะแนนปัจจุบัน</th><th>ดำเนินการ</th></tr></thead><tbody>
            {assignedStudents.map((student) => <tr key={student.id}><td data-label="รหัส">{student.studentCode}</td><td data-label="นักเรียน"><div className="student-name-cell"><StudentAvatar student={student} /><strong>{studentDisplayName(student)}</strong></div></td><td data-label="ห้อง">{student.classroomName}</td><td data-label="คะแนน"><span className={`score-text ${student.score < 60 ? 'danger' : ''}`}>{student.score}</span> / 100</td><td data-label="ดำเนินการ"><button className="text-button" onClick={() => { setDeductionSelection(selectionForStudent(assignedStudents, student.id)); invalidateDeductionRequest(); navigateTeacherTab('deduct') }}>เลือกตัดคะแนน</button></td></tr>)}
          </tbody></table></div>
          <p className="scope-note"><Icon name="shield" size={18} /> {currentTeacher.canScoreAllClassrooms ? 'บัญชีนี้ได้รับสิทธิ์ให้คะแนนนักเรียนได้ทุกชั้น โดยยังใช้ขั้นตอนอนุมัติเดิม' : 'ระบบแสดงและอนุญาตให้ดำเนินการเฉพาะห้องที่ได้รับมอบหมายเท่านั้น'}</p>
        </section>
      ) : null}

      {tab === 'deduct' ? (
        <>
        <div className="workspace-grid">
            <StudentTargetSelector
              students={assignedStudents}
              value={deductionSelection}
              onChange={changeDeductionSelection}
              disabled={deductionBusy}
              actionLabel="ตัดคะแนน"
              emptyDetail="บัญชีครูยังไม่ได้รับมอบหมายห้อง กรุณาให้ผู้ดูแลระบบกำหนดห้องที่รับผิดชอบก่อน"
            />
            <form className="panel action-form" onSubmit={recordDeductions}>
              <div className="section-heading"><div><p className="eyebrow">บันทึกตามสิทธิ์ห้องที่รับผิดชอบ</p><h2>ตัดคะแนนพร้อมตรวจสอบรายชื่อ</h2></div><button type="button" className="button ghost rules-reference-button" onClick={() => setRulesDialogTab('deduction')}><Icon name="book" size={17} /> ดูระเบียบทั้งหมด</button></div>
              <div className="selected-student-bar batch-target-bar">
                <div>{deductionSelection.scope === 'single' && deductionTargets[0] ? <StudentAvatar student={deductionTargets[0]} className="large" /> : <span className="student-avatar large">{deductionTargets.length}</span>}<div><strong>{deductionSelection.scope === 'single' ? deductionTargets[0] ? studentDisplayName(deductionTargets[0]) : 'ยังไม่เลือกนักเรียน' : deductionSelection.scope === 'selected' ? 'กลุ่มนักเรียนที่เลือก' : classrooms.find((item) => item.id === deductionSelection.classroomId)?.name ?? 'ยังไม่เลือกห้อง'}</strong><small>{deductionSelection.scope === 'single' ? `${deductionTargets[0]?.studentCode ?? ''} • ${deductionTargets[0]?.classroomName ?? ''}` : 'ทุกคนจะใช้เกณฑ์และรายละเอียดเดียวกัน'}</small></div></div>
                <div><span>จำนวนเป้าหมาย</span><b>{deductionTargets.length} คน</b></div>
              </div>
              <DeductionRuleSelect
                rules={activeDeductionRules}
                value={ruleId}
                disabled={deductionBusy}
                onChange={(nextRuleId) => { setRuleId(nextRuleId); invalidateDeductionRequest() }}
              />
              {selectedRule ? <div className="rule-summary"><div><StatusBadge severity={selectedRule.severity} /> <span>{selectedRule.category} • คนละ {selectedRule.points} คะแนน</span></div><strong>{deductionTargets.length ? deductionTargets.reduce((sum, student) => sum + student.score, 0) : 0} <span>→</span> {deductionTargets.reduce((sum, student) => sum + applyScoreDelta(student.score, -selectedRule.points).after, 0)}</strong></div> : null}
              {deductionNeedsApproval ? <div className="warning-note"><Icon name="shield" /><span>ตั้งแต่ 10 คะแนนขึ้นไปจะส่งให้แอดมินอนุมัติก่อน คะแนนนักเรียนยังไม่เปลี่ยนจนกว่าจะอนุมัติ</span></div> : null}
              <div className="date-field-grid">
                <label>วันและเวลาเกิดเหตุ<input type="datetime-local" disabled={deductionBusy} max={toLocalDateTimeInputValue()} value={occurredAt} onChange={(event) => { setOccurredAt(event.target.value); invalidateDeductionRequest() }} required /></label>
                <div className="field-help"><strong>คะแนนรวมก่อน → หลัง</strong><span>ตัวเลขด้านบนคำนวณโดยไม่ให้คะแนนต่ำกว่า 0</span></div>
              </div>
              <label>รายละเอียดเหตุการณ์เพิ่มเติม (ไม่บังคับ)<textarea disabled={deductionBusy} value={internalNote} maxLength={2000} onChange={(event) => { setInternalNote(event.target.value); invalidateDeductionRequest() }} placeholder="หากมี สามารถระบุข้อเท็จจริง สถานที่ หรือบริบทเพิ่มเติมได้" /></label>
              {selectedRule?.guardianContactRequired ? <div className="warning-note"><Icon name="alert" /><span>เกณฑ์นี้เป็นกรณีร้ายแรง ระบบจะเปิดเคสติดตามและงานติดต่อผู้ปกครองแยกให้นักเรียนทุกคนโดยอัตโนมัติ</span></div> : null}

              {reviewingDeduction ? (
                <section className="deduction-review" aria-label="ตรวจสอบก่อนยืนยัน">
                  <div className="review-heading"><div><p className="eyebrow">ขั้นตอนสุดท้าย</p><h2>ตรวจสอบรายชื่อก่อนบันทึก</h2></div><span className="counter">{deductionTargets.length}</span></div>
                  <div className="review-roster">
                    {deductionTargets.map((student) => {
                      const change = selectedRule ? applyScoreDelta(student.score, -selectedRule.points) : null
                      return <div className="review-student" key={student.id}><StudentAvatar student={student} /><span><strong>{studentDisplayName(student)}</strong><small>{student.studentCode} • {student.classroomName}</small></span><b>{change?.before} → {change?.after}</b></div>
                    })}
                  </div>
                  <dl className="review-facts"><div><dt>เหตุผล</dt><dd>{selectedRule?.title}</dd></div><div><dt>วันเวลา</dt><dd>{formatThaiDate(localDateTimeToIso(occurredAt) ?? occurredAt)}</dd></div><div><dt>รายละเอียดเพิ่มเติม</dt><dd>{internalNote.trim() || 'ไม่ได้ระบุรายละเอียดเพิ่มเติม'}</dd></div></dl>
                  {isSeriousBulk ? <label className="confirmation-check"><input type="checkbox" disabled={deductionBusy} checked={confirmSeriousBulk} onChange={(event) => { setConfirmSeriousBulk(event.target.checked); setDeductionError('') }} /><span>ยืนยันว่าตรวจสอบรายชื่อกรณีร้ายแรงทั้ง {deductionTargets.length} คนแล้ว และรับทราบว่าจะสร้างงานแจ้งผู้ปกครองรายคน</span></label> : null}
                </section>
              ) : null}

              {deductionError ? <p className="form-error" role="alert">{deductionError}</p> : null}
              <div className="form-actions">
                <button type="button" className="button secondary" disabled={deductionBusy} onClick={() => { if (!reviewingDeduction) setInternalNote(''); invalidateDeductionRequest() }}>{deductionResult || deductionApprovalResult ? 'ทำรายการใหม่' : reviewingDeduction ? 'กลับไปแก้ไข' : 'ล้างรายละเอียด'}</button>
                <button type="submit" className="button primary" disabled={deductionBusy || Boolean(deductionResult || deductionApprovalResult)}>{deductionBusy ? (deductionNeedsApproval ? 'กำลังส่งคำขอ…' : 'กำลังบันทึกทั้งชุด…') : reviewingDeduction ? (deductionNeedsApproval ? `ยืนยันส่งคำขอ ${deductionTargets.length} คน` : `ยืนยันตัดคะแนน ${deductionTargets.length} คน`) : 'ตรวจสอบก่อนยืนยัน'}</button>
              </div>

              {deductionApprovalResult ? (
                <section className="batch-result" aria-label="ผลการส่งคำขอ">
                  <div className="review-heading"><div><p className="eyebrow">ส่งคำขอสำเร็จ</p><h2>รอแอดมินตรวจ {deductionApprovalResult.targetCount} รายการ</h2></div><span className="badge status-pending">คะแนนยังไม่เปลี่ยน</span></div>
                  <p>ระบบเก็บคำขอแล้วและปิดปุ่มยืนยันเพื่อป้องกันการส่งซ้ำ กด “ทำรายการใหม่” เมื่อต้องการบันทึกเหตุการณ์ถัดไป</p>
                </section>
              ) : null}

              {deductionResult ? (
                <section className="batch-result" aria-label="ผลการบันทึก">
                  <div className="review-heading"><div><p className="eyebrow">บันทึกสำเร็จ</p><h2>ตัดคะแนนจริงรวม {deductionResult.totalAppliedPoints} คะแนน</h2></div><span className="badge status-approved">ครบ {deductionResult.targetCount} คน</span></div>
                  {deductionResult.alreadyAtZeroCount ? <p>มี {deductionResult.alreadyAtZeroCount} คนที่คะแนนเดิมเป็น 0 จึงไม่มีคะแนนให้ตัดเพิ่ม</p> : null}
                  <div className="review-roster compact-roster">{deductionResult.results.map((row) => { const student = assignedStudents.find((item) => item.id === row.studentId); return <div className="review-student" key={row.studentId}>{student ? <StudentAvatar student={student} /> : null}<span><strong>{student ? studentDisplayName(student) : row.studentId}</strong><small>ตัดจริง {row.appliedPoints} คะแนน</small></span><b>{row.balanceBefore} → {row.balanceAfter}</b></div> })}</div>
                </section>
              ) : null}
            </form>
          </div>
          {teacherDeductionRequests.length ? <section className="panel"><div className="section-heading"><div><p className="eyebrow">ประวัติคำขอตัดคะแนน</p><h2>ผลการพิจารณาจากแอดมิน</h2></div><span className="counter">{teacherDeductionRequests.length}</span></div>
            <div className="record-list">{teacherDeductionRequests.map((request) => { const student = state.students.find((item) => item.id === request.studentId); return <article className="record-row detailed-record" key={request.id}>{student ? <StudentAvatar student={student} /> : null}<div><strong>{student ? studentDisplayName(student) : 'ไม่พบนักเรียน'} • -{request.approvedPoints ?? request.requestedPoints}</strong><span>{request.ruleTitle}</span><small>เกิดเหตุ {formatThaiDate(request.occurredAt)} • ส่ง {formatThaiDate(request.createdAt)}</small>{request.decisionNote ? <small>หมายเหตุแอดมิน: {request.decisionNote}</small> : null}</div><span className={`badge status-${request.status}`}>{request.status === 'pending' ? 'รออนุมัติ' : request.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}</span></article> })}</div>
          </section> : null}
        </>
      ) : null}

      {tab === 'request' ? (
        <>
          <div className="workspace-grid">
          <StudentTargetSelector
            students={assignedStudents}
            value={additionSelection}
            onChange={changeAdditionSelection}
            disabled={additionBusy}
            actionLabel="เพิ่มคะแนน"
            emptyDetail="บัญชีครูยังไม่ได้รับมอบหมายห้อง กรุณาให้ผู้ดูแลระบบกำหนดห้องที่รับผิดชอบก่อน"
          />
          <form className="panel stack-form" onSubmit={submitAdditionRequest}>
            <div className="section-heading"><div><p className="eyebrow">ต้องรออนุมัติ</p><h2>สร้างคำขอเพิ่มคะแนน</h2></div><button type="button" className="button ghost rules-reference-button" onClick={() => setRulesDialogTab('addition')}><Icon name="book" size={17} /> ดูระเบียบทั้งหมด</button></div>
            <div className="selected-student-bar batch-target-bar">
                <div>{additionSelection.scope === 'single' && additionTargets[0] ? <StudentAvatar student={additionTargets[0]} className="large" /> : <span className="student-avatar large">{additionTargets.length}</span>}<div><strong>{additionSelection.scope === 'single' ? additionTargets[0] ? studentDisplayName(additionTargets[0]) : 'ยังไม่เลือกนักเรียน' : additionSelection.scope === 'selected' ? 'กลุ่มนักเรียนที่เลือก' : classrooms.find((item) => item.id === additionSelection.classroomId)?.name ?? 'ยังไม่เลือกห้อง'}</strong><small>ระบบจะสร้างคำขอแยกให้นักเรียนทุกคน เพื่อให้แอดมินตรวจสอบรายคน</small></div></div>
              <div><span>จำนวนคำขอ</span><b>{additionTargets.length} รายการ</b></div>
            </div>
            <PositiveRuleSelect rules={activePositiveRules} value={positiveRuleId} disabled={additionBusy} onChange={(nextId) => { const nextRule = activePositiveRules.find((rule) => rule.id === nextId); setPositiveRuleId(nextId); setRequestPoints(nextRule?.defaultPoints ?? 1); invalidateAdditionRequest() }} />
            {selectedPositiveRule ? <PositiveRuleSummary rule={selectedPositiveRule} /> : <p className="form-error">ยังไม่มีเกณฑ์การเพิ่มคะแนนที่เปิดใช้งาน</p>}
            <div className="date-field-grid">
              <label>วันและเวลาที่ทำกิจกรรม<input type="datetime-local" disabled={additionBusy} max={toLocalDateTimeInputValue()} value={activityOccurredAt} onChange={(event) => { setActivityOccurredAt(event.target.value); invalidateAdditionRequest() }} required /></label>
              <label>จำนวนคะแนนที่ขอ<input type="number" disabled={additionBusy} min="1" max={selectedPositiveRule?.maxPoints ?? 100} readOnly={!selectedPositiveRule?.discretionary} value={requestPoints} onChange={(event) => { setRequestPoints(Number(event.target.value)); invalidateAdditionRequest() }} /></label>
            </div>
            {!pointValidation.valid && pointValidation.message ? <p className="form-error">{pointValidation.message}</p> : null}
            {additionTargets.length ? <div className="addition-preview"><span>คะแนนรวม หากแอดมินอนุมัติครบ</span><strong>{additionBeforeTotal} <i>→</i> {additionAfterTotal}</strong><small>เพิ่มจริงรวมสูงสุด {additionAppliedTotal} คะแนน โดยแต่ละคนไม่เกิน 100</small></div> : null}
            <label>รายละเอียดเพิ่มเติม (ไม่บังคับ)<textarea disabled={additionBusy} value={requestReason} maxLength={2000} onChange={(event) => { setRequestReason(event.target.value); invalidateAdditionRequest() }} placeholder="หากมี สามารถอธิบายงานหรือพฤติกรรมเพิ่มเติมได้" /></label>
            <EvidenceField
              note={evidenceNote}
              files={evidenceFiles}
              disabled={additionBusy}
              onNoteChange={(note) => { setEvidenceNote(note); invalidateAdditionRequest() }}
              onFilesChange={(files) => { setEvidenceFiles(files); setUploadedEvidence([]); invalidateAdditionRequest() }}
            />
            <p className="scope-note"><Icon name="shield" size={18} /> รายละเอียดและไฟล์หลักฐานจะแสดงเฉพาะครูกับแอดมิน นักเรียนจะไม่เห็นข้อมูลภายในส่วนนี้</p>
            {additionError ? <p className="form-error" role="alert">{additionError}</p> : null}
            <button className="button primary" type="submit" disabled={additionBusy || !selectedPositiveRule}>{additionBusy ? 'กำลังส่งทั้งชุด…' : `ส่งคำขอ ${additionTargets.length} คนให้แอดมินตรวจสอบ`}</button>
            {additionResult ? <div className="batch-result compact-result"><strong>ส่งคำขอสำเร็จ {additionResult.targetCount} คน</strong><span>แอดมินจะอนุมัติหรือปฏิเสธแยกเป็นรายคน</span></div> : null}
          </form>
          </div>
          <section className="panel"><div className="section-heading"><div><p className="eyebrow">ประวัติคำขอ</p><h2>สถานะการอนุมัติ</h2></div><span className="counter">{teacherRequests.length}</span></div>
            {teacherRequests.length ? <div className="record-list">{teacherRequests.map((request) => { const student = state.students.find((item) => item.id === request.studentId); const detail = request.reason.trim() !== request.positiveRuleTitle?.trim() ? request.reason.trim() : ''; return <article className="record-row detailed-record" key={request.id}>{student ? <StudentAvatar student={student} /> : null}<div><strong>{student ? studentDisplayName(student) : 'ไม่พบนักเรียน'} • +{request.requestedPoints}</strong><span>{request.positiveRuleTitle ?? 'ไม่ระบุเหตุผล'}</span>{detail ? <span>รายละเอียด: {detail}</span> : null}<small>หลักฐาน:</small><EvidenceSummary value={request.evidenceNote} resolveFileUrl={actions?.createEvidenceUrl} /><small>ทำกิจกรรม {formatThaiDate(request.activityOccurredAt ?? request.createdAt)} • ส่ง {formatThaiDate(request.createdAt)}</small>{request.decisionNote ? <small>หมายเหตุแอดมิน: {request.decisionNote}</small> : null}</div><span className={`badge status-${request.status}`}>{request.status === 'pending' ? 'รออนุมัติ' : request.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}</span></article> })}</div> : <EmptyState title="ยังไม่มีคำขอ" detail="คำขอเพิ่มคะแนนที่ส่งแล้วจะแสดงพร้อมรายละเอียดที่นี่" />}
          </section>
        </>
      ) : null}

      {tab === 'rules' ? (
        <div className="workspace-grid rule-proposal-workspace">
          <form className="panel stack-form rule-create-form" onSubmit={submitRuleProposal} noValidate>
            <div className="section-heading"><div><p className="eyebrow">เสนอระเบียบใหม่</p><h2>สร้างข้อเสนอเกณฑ์คะแนน</h2></div></div>
            <p className="form-help">ข้อเสนอจะส่งให้แอดมินตรวจสอบก่อน ครูทุกคนจึงจะเลือกใช้เกณฑ์นี้ได้หลังอนุมัติ</p>
            <div className="rule-catalog-tabs" role="tablist" aria-label="ประเภทข้อเสนอ">
              <button type="button" role="tab" aria-selected={proposalKind === 'deduction'} className={proposalKind === 'deduction' ? 'active' : ''} onClick={() => { setProposalKind('deduction'); setProposalPoints(5); setProposalDiscretionary(false); setProposalError('') }}>เกณฑ์ตัดคะแนน</button>
              <button type="button" role="tab" aria-selected={proposalKind === 'positive'} className={proposalKind === 'positive' ? 'active' : ''} onClick={() => { setProposalKind('positive'); setProposalPoints(5); setProposalError('') }}>เกณฑ์เพิ่มคะแนน</button>
            </div>
            <label>ชื่อเกณฑ์ <b>จำเป็น</b><input value={proposalTitle} maxLength={300} disabled={proposalBusy} onChange={(event) => { setProposalTitle(event.target.value); setProposalError('') }} placeholder={proposalKind === 'deduction' ? 'เช่น ไม่รักษาความสะอาดพื้นที่รับผิดชอบ' : 'เช่น ช่วยเหลืองานส่วนรวม'} /></label>
            <div className="rule-form-grid">
              <label>{proposalKind === 'deduction' ? 'จำนวนคะแนนที่เสนอให้ตัด' : proposalDiscretionary ? 'คะแนนสูงสุด' : 'จำนวนคะแนนที่เสนอให้เพิ่ม'}<input type="number" min="1" max="100" step="1" value={proposalPoints} disabled={proposalBusy} onChange={(event) => { setProposalPoints(Number(event.target.value)); setProposalError('') }} /></label>
              {proposalKind === 'positive' ? <label className="confirmation-check rule-discretionary-check"><input type="checkbox" checked={proposalDiscretionary} disabled={proposalBusy} onChange={(event) => setProposalDiscretionary(event.target.checked)} /><span>ให้ครูกำหนดคะแนนได้ไม่เกินจำนวนนี้</span></label> : <div className="rule-policy-preview"><StatusBadge severity={behaviorSeverityForProposal(proposalPoints)} /><span>{proposalPoints >= 10 ? 'เมื่อใช้จริงต้องผ่านแอดมิน' : 'เมื่ออนุมัติเกณฑ์แล้วจึงใช้ได้'}</span></div>}
            </div>
            <label>คำอธิบายเพิ่มเติม (ไม่บังคับ)<textarea value={proposalDescription} maxLength={2000} disabled={proposalBusy} onChange={(event) => setProposalDescription(event.target.value)} /></label>
            {proposalError ? <p className="form-error" role="alert">{proposalError}</p> : null}
            <button className="button primary full" type="submit" disabled={proposalBusy}>{proposalBusy ? 'กำลังส่ง…' : 'ส่งข้อเสนอให้แอดมิน'}</button>
          </form>
          <section className="panel"><div className="section-heading"><div><p className="eyebrow">ติดตามผล</p><h2>ข้อเสนอของฉัน</h2></div><span className="counter">{teacherRuleProposals.length}</span></div>
            {teacherRuleProposals.length ? <div className="record-list">{teacherRuleProposals.map((proposal) => <article className="record-row detailed-record" key={proposal.id}><div><strong>{proposal.title}</strong><span>{proposal.kind === 'deduction' ? `ตัด ${proposal.points} คะแนน` : proposal.discretionary ? `เพิ่มได้ถึง ${proposal.points} คะแนน` : `เพิ่ม ${proposal.points} คะแนน`}</span><small>ส่งเมื่อ {formatThaiDate(proposal.createdAt)}</small>{proposal.reviewNote ? <small>หมายเหตุแอดมิน: {proposal.reviewNote}</small> : null}</div><span className={`badge status-${proposal.status}`}>{proposal.status === 'pending' ? 'รอตรวจ' : proposal.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}</span></article>)}</div> : <EmptyState title="ยังไม่มีข้อเสนอ" detail="ใช้แบบฟอร์มเพื่อเสนอเกณฑ์ใหม่ให้ผู้ดูแลระบบพิจารณา" />}
          </section>
        </div>
      ) : null}

      {tab === 'cases' ? (
        <section className="panel"><div className="section-heading"><div><p className="eyebrow">ระบบดูแลช่วยเหลือ</p><h2>กรณีร้ายแรงที่ต้องติดตาม</h2></div><span className="counter danger">{assignedCases.length}</span></div>
          {assignedCases.length ? <div className="record-list">{assignedCases.map((item) => { const student = state.students.find((entry) => entry.id === item.studentId); return <article className="case-row" key={item.id}><div className="case-marker">{student ? <StudentAvatar student={student} /> : <Icon name="alert" />}</div><div><strong>{student ? studentDisplayName(student) : 'ไม่พบนักเรียน'}</strong><span>{item.internalNote}</span><small>เปิดเคสเมื่อ {formatThaiDate(item.createdAt)}</small></div><div><StatusBadge severity={item.severity} /><span className="badge status-pending">{item.guardianContactStatus === 'pending' ? 'รอติดต่อผู้ปกครอง' : 'กำลังติดตาม'}</span></div></article> })}</div> : <EmptyState title="ไม่มีกรณีร้ายแรงค้างอยู่" detail="เหตุการณ์ระดับร้ายแรงจะเปิดเป็นเคสติดตามอัตโนมัติ" />}
        </section>
      ) : null}
      {rulesDialogTab ? <ScoreRulesDialog initialTab={rulesDialogTab} deductionRules={state.rules} positiveRules={state.positiveRules} onClose={() => setRulesDialogTab(null)} /> : null}
    </AppShell>
  )
}
