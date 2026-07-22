import { useMemo, useState, type FormEvent } from 'react'
import {
  applyScoreDelta,
  createId,
  formatThaiDate,
  type Account,
  type BehaviorRule,
  type DemoState,
  type PositiveBehaviorRule,
  type Student,
} from './domain'
import type {
  AppDataActions,
  DeductionScope,
  RecordDeductionsResult,
} from './dataActions'
import {
  localDateTimeToIso,
  resolveDeductionTargets,
  toLocalDateTimeInputValue,
  validatePositiveRulePoints,
} from './teacherWorkflows'
import { AppShell, EmptyState, Icon, StatusBadge, type NavItem } from './ui'

type TeacherTab = 'overview' | 'deduct' | 'request' | 'cases'

interface TeacherDashboardProps {
  account: Account
  state: DemoState
  onChange: (next: DemoState) => void
  actions?: AppDataActions
  onLogout: () => void
}

interface ClassroomOption {
  id: string
  name: string
  students: Student[]
}

function newRequestId(): string {
  return globalThis.crypto.randomUUID()
}

function StudentPicker({
  students,
  scope,
  singleStudentId,
  selectedStudentIds,
  onSelectSingle,
  onToggleStudent,
  onToggleVisible,
  disabled,
}: {
  students: Student[]
  scope: Extract<DeductionScope, 'single' | 'selected'>
  singleStudentId: string
  selectedStudentIds: Set<string>
  onSelectSingle: (id: string) => void
  onToggleStudent: (id: string) => void
  onToggleVisible: (ids: string[], select: boolean) => void
  disabled: boolean
}) {
  const [query, setQuery] = useState('')
  const visible = students.filter((student) => `${student.studentCode} ${student.name} ${student.classroomName}`.toLowerCase().includes(query.toLowerCase()))
  const allVisibleSelected = visible.length > 0 && visible.every((student) => selectedStudentIds.has(student.id))

  return (
    <div className="picker-panel">
      <label className="search-label">
        <span className="sr-only">ค้นหานักเรียน</span>
        <input disabled={disabled} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อ รหัส หรือห้องเรียน" />
      </label>
      {scope === 'selected' ? (
        <div className="picker-toolbar">
          <span>เลือกแล้ว <strong>{selectedStudentIds.size}</strong> คน</span>
          <button type="button" className="text-button" disabled={disabled || !visible.length} onClick={() => onToggleVisible(visible.map((student) => student.id), !allVisibleSelected)}>
            {allVisibleSelected ? 'ยกเลิกที่ค้นพบ' : 'เลือกที่ค้นพบทั้งหมด'}
          </button>
        </div>
      ) : null}
      <div className="picker-list" role={scope === 'single' ? 'listbox' : undefined} aria-label="รายชื่อนักเรียน">
        {visible.length ? visible.map((student) => scope === 'single' ? (
          <button
            type="button"
            key={student.id}
            className={student.id === singleStudentId ? 'picker-row selected' : 'picker-row'}
            onClick={() => onSelectSingle(student.id)}
            role="option"
            aria-selected={student.id === singleStudentId}
            disabled={disabled}
          >
            <span className="student-avatar">{student.name.slice(-2)}</span>
            <span><strong>{student.name}</strong><small>{student.studentCode} • {student.classroomName}</small></span>
            <b>{student.score}</b>
          </button>
        ) : (
          <label className={selectedStudentIds.has(student.id) ? 'picker-check-row selected' : 'picker-check-row'} key={student.id}>
            <input type="checkbox" disabled={disabled} checked={selectedStudentIds.has(student.id)} onChange={() => onToggleStudent(student.id)} />
            <span className="student-avatar">{student.name.slice(-2)}</span>
            <span><strong>{student.name}</strong><small>{student.studentCode} • {student.classroomName}</small></span>
            <b>{student.score}</b>
          </label>
        )) : <p className="picker-empty">ไม่พบนักเรียนตามคำค้น</p>}
      </div>
    </div>
  )
}

function ClassroomPicker({
  classrooms,
  selectedId,
  onSelect,
  disabled,
}: {
  classrooms: ClassroomOption[]
  selectedId: string
  onSelect: (id: string) => void
  disabled: boolean
}) {
  const selectedClassroom = classrooms.find((classroom) => classroom.id === selectedId)
  return (
    <div className="picker-panel classroom-picker">
      <div className="picker-heading"><strong>เลือกห้องเรียน</strong><small>ระบบจะตรวจรายชื่อทั้งห้องอีกครั้งตอนบันทึก</small></div>
      <div className="classroom-options">
        {classrooms.map((classroom) => (
          <button type="button" disabled={disabled} className={classroom.id === selectedId ? 'classroom-option selected' : 'classroom-option'} key={classroom.id} onClick={() => onSelect(classroom.id)} aria-pressed={classroom.id === selectedId}>
            <span>{classroom.name}</span><strong>{classroom.students.length} คน</strong>
          </button>
        ))}
      </div>
      <div className="classroom-roster">
        <div className="picker-toolbar"><span>รายชื่อที่จะได้รับผล <strong>{selectedClassroom?.students.length ?? 0}</strong> คน</span></div>
        {selectedClassroom?.students.map((student) => (
          <div className="roster-row" key={student.id}>
            <span><strong>{student.name}</strong><small>{student.studentCode}</small></span>
            <b>{student.score}</b>
          </div>
        ))}
      </div>
    </div>
  )
}

function RuleOption({ rule, selected, onSelect, disabled }: { rule: BehaviorRule; selected: boolean; onSelect: () => void; disabled: boolean }) {
  return (
    <button type="button" disabled={disabled} className={selected ? 'rule-option selected' : 'rule-option'} onClick={onSelect} aria-pressed={selected}>
      <span><strong>{rule.title}</strong><small>{rule.category}</small></span>
      <span className="rule-points">−{rule.points}</span>
    </button>
  )
}

function PositiveRuleSummary({ rule }: { rule: PositiveBehaviorRule }) {
  return (
    <div className="positive-rule-summary">
      <div><span className="badge status-approved">{rule.code}</span><strong>{rule.title}</strong></div>
      <p>{rule.description || rule.category}</p>
      <small>{rule.discretionary ? `กำหนดได้ 1–${rule.maxPoints} คะแนน` : `คะแนนตามเกณฑ์ +${rule.defaultPoints ?? 0}`}</small>
    </div>
  )
}

export function TeacherDashboard({ account, state, onChange, actions, onLogout }: TeacherDashboardProps) {
  const [tab, setTab] = useState<TeacherTab>('overview')
  const teacher = state.teachers.find((item) => item.id === account.teacherId)
  const assignedStudents = useMemo(
    () => state.students.filter((student) => student.status === 'active' && teacher?.classroomIds.includes(student.classroomId)),
    [state.students, teacher?.classroomIds],
  )
  const classrooms = useMemo<ClassroomOption[]>(() => {
    const byId = new Map<string, ClassroomOption>()
    for (const student of assignedStudents) {
      const existing = byId.get(student.classroomId)
      if (existing) existing.students.push(student)
      else byId.set(student.classroomId, { id: student.classroomId, name: student.classroomName, students: [student] })
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'th'))
  }, [assignedStudents])

  const [deductionScope, setDeductionScope] = useState<DeductionScope>('single')
  const [singleStudentId, setSingleStudentId] = useState(assignedStudents[0]?.id ?? '')
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(() => new Set())
  const [classroomId, setClassroomId] = useState(classrooms[0]?.id ?? '')
  const [ruleId, setRuleId] = useState(state.rules.find((rule) => rule.active)?.id ?? '')
  const [occurredAt, setOccurredAt] = useState(() => toLocalDateTimeInputValue())
  const [internalNote, setInternalNote] = useState('')
  const [reviewingDeduction, setReviewingDeduction] = useState(false)
  const [confirmSeriousBulk, setConfirmSeriousBulk] = useState(false)
  const [deductionRequestId, setDeductionRequestId] = useState(() => newRequestId())
  const [deductionResult, setDeductionResult] = useState<RecordDeductionsResult | null>(null)

  const activePositiveRules = state.positiveRules.filter((rule) => rule.active)
  const [additionStudentId, setAdditionStudentId] = useState(assignedStudents[0]?.id ?? '')
  const [positiveRuleId, setPositiveRuleId] = useState(activePositiveRules[0]?.id ?? '')
  const initialPositiveRule = activePositiveRules[0]
  const [requestPoints, setRequestPoints] = useState(initialPositiveRule?.defaultPoints ?? 1)
  const [activityOccurredAt, setActivityOccurredAt] = useState(() => toLocalDateTimeInputValue())
  const [requestReason, setRequestReason] = useState('')
  const [evidenceNote, setEvidenceNote] = useState('')
  const [additionRequestId, setAdditionRequestId] = useState(() => newRequestId())

  const [announcement, setAnnouncement] = useState('')
  const [busy, setBusy] = useState(false)
  const selectedRule = state.rules.find((item) => item.id === ruleId)
  const selectedPositiveRule = activePositiveRules.find((item) => item.id === positiveRuleId)
  const additionStudent = assignedStudents.find((item) => item.id === additionStudentId)
  const additionPreview = additionStudent ? applyScoreDelta(additionStudent.score, requestPoints) : null
  const pointValidation = validatePositiveRulePoints(selectedPositiveRule, requestPoints)
  const deductionTargets = resolveDeductionTargets({
    scope: deductionScope,
    students: assignedStudents,
    singleStudentId,
    selectedStudentIds,
    classroomId,
  })
  const isSeriousBulk = Boolean(selectedRule && ['serious', 'critical'].includes(selectedRule.severity) && deductionTargets.length > 1)
  const teacherRequests = state.additionRequests.filter((item) => item.teacherId === teacher?.id)
  const assignedCases = state.seriousCases.filter((item) => assignedStudents.some((student) => student.id === item.studentId))
  const navItems: NavItem<TeacherTab>[] = [
    { id: 'overview', label: 'ห้องที่รับผิดชอบ', icon: 'users' },
    { id: 'deduct', label: 'บันทึกตัดคะแนน', icon: 'score' },
    { id: 'request', label: 'ขอเพิ่มคะแนน', icon: 'plus', count: teacherRequests.filter((item) => item.status === 'pending').length },
    { id: 'cases', label: 'กรณีติดตาม', icon: 'alert', count: assignedCases.filter((item) => item.status !== 'resolved').length },
  ]

  if (!teacher) return <p>ไม่พบข้อมูลครู</p>
  const currentTeacher = teacher

  function resetDeductionReview() {
    setReviewingDeduction(false)
    setConfirmSeriousBulk(false)
    setDeductionResult(null)
  }

  function invalidateDeductionRequest() {
    resetDeductionReview()
    setDeductionRequestId(newRequestId())
  }

  function invalidateAdditionRequest() {
    setAdditionRequestId(newRequestId())
  }

  function chooseScope(scope: DeductionScope) {
    setDeductionScope(scope)
    invalidateDeductionRequest()
  }

  function toggleSelectedStudent(studentId: string) {
    setSelectedStudentIds((current) => {
      const next = new Set(current)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
    invalidateDeductionRequest()
  }

  function toggleVisibleStudents(studentIds: string[], select: boolean) {
    setSelectedStudentIds((current) => {
      const next = new Set(current)
      for (const studentId of studentIds) {
        if (select) next.add(studentId)
        else next.delete(studentId)
      }
      return next
    })
    invalidateDeductionRequest()
  }

  async function recordDeductions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const eventIso = localDateTimeToIso(occurredAt)
    if (!selectedRule || !eventIso || internalNote.trim().length < 5) {
      setAnnouncement('กรุณาเลือกเกณฑ์ วันเวลา และระบุรายละเอียดเหตุการณ์อย่างน้อย 5 ตัวอักษร')
      return
    }
    if (deductionScope === 'selected' && deductionTargets.length < 2) {
      setAnnouncement('โหมดหลายคนต้องเลือกนักเรียนอย่างน้อย 2 คน')
      return
    }
    if (!deductionTargets.length) {
      setAnnouncement('กรุณาเลือกนักเรียนหรือห้องเรียนที่ต้องการตัดคะแนน')
      return
    }
    if (!deductionTargets.every((student) => currentTeacher.classroomIds.includes(student.classroomId))) {
      setAnnouncement('มีนักเรียนอยู่นอกห้องที่คุณครูรับผิดชอบ ระบบจึงยกเลิกรายการทั้งหมด')
      return
    }
    if (!reviewingDeduction) {
      setReviewingDeduction(true)
      setAnnouncement(`ตรวจสอบรายชื่อ ${deductionTargets.length} คนและคะแนนก่อนยืนยันบันทึก`)
      return
    }
    if (isSeriousBulk && !confirmSeriousBulk) {
      setAnnouncement('กรุณายืนยันว่าตรวจสอบรายชื่อนักเรียนกรณีร้ายแรงครบถ้วนแล้ว')
      return
    }

    setBusy(true)
    try {
      let result: RecordDeductionsResult
      if (actions) {
        result = await actions.recordDeductions({
          clientRequestId: deductionRequestId,
          scope: deductionScope,
          studentIds: deductionTargets.map((student) => student.id),
          classroomId: deductionScope === 'classroom' ? classroomId : undefined,
          ruleId: selectedRule.id,
          occurredAt: eventIso,
          internalNote: internalNote.trim(),
          confirmSeriousBulk: isSeriousBulk && confirmSeriousBulk,
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
          reason: internalNote.trim(),
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
            createdAt: occurredAtIso,
            internalNote: `ติดตามเหตุการณ์: ${internalNote.trim()}`,
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
          scope: deductionScope,
          classroomId: deductionScope === 'classroom' ? classroomId : undefined,
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
      setDeductionRequestId(newRequestId())
      setAnnouncement(`บันทึกครบ ${result.targetCount} คน ตัดคะแนนจริงรวม ${result.totalAppliedPoints} คะแนนเรียบร้อยแล้ว`)
    } catch (error) {
      setAnnouncement(error instanceof Error ? error.message : 'ไม่สามารถบันทึกการตัดคะแนนได้ ระบบไม่ได้บันทึกเพียงบางคน')
    } finally {
      setBusy(false)
    }
  }

  async function submitAdditionRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const activityIso = localDateTimeToIso(activityOccurredAt)
    if (!additionStudent || !selectedPositiveRule || !pointValidation.valid || !activityIso || requestReason.trim().length < 5 || evidenceNote.trim().length < 5) {
      setAnnouncement(pointValidation.message ?? 'กรุณากรอกเกณฑ์ วันทำกิจกรรม เหตุผล และหลักฐานให้ครบถ้วน')
      return
    }
    if (additionStudent.score >= 100) {
      setAnnouncement('นักเรียนมีคะแนนเต็ม 100 แล้ว จึงยังไม่สามารถส่งคำขอเพิ่มคะแนนได้')
      return
    }
    setBusy(true)
    try {
      if (actions) {
        await actions.requestPointAddition({
          clientRequestId: additionRequestId,
          studentId: additionStudent.id,
          positiveRuleId: selectedPositiveRule.id,
          points: requestPoints,
          activityOccurredAt: activityIso,
          reason: requestReason.trim(),
          evidenceNote: evidenceNote.trim(),
        })
      } else {
        onChange({
          ...state,
          additionRequests: [{
            id: createId('request'),
            studentId: additionStudent.id,
            teacherId: currentTeacher.id,
            positiveRuleId: selectedPositiveRule.id,
            positiveRuleCode: selectedPositiveRule.code,
            positiveRuleTitle: selectedPositiveRule.title,
            requestedPoints: requestPoints,
            reason: requestReason.trim(),
            evidenceNote: evidenceNote.trim(),
            activityOccurredAt: activityIso,
            status: 'pending',
            createdAt: new Date().toISOString(),
          }, ...state.additionRequests],
        })
      }
      setRequestReason('')
      setEvidenceNote('')
      setAdditionRequestId(newRequestId())
      setAnnouncement('ส่งคำขอพร้อมรายละเอียดและหลักฐานแล้ว คะแนนยังไม่เปลี่ยนจนกว่าแอดมินจะอนุมัติ')
    } catch (error) {
      setAnnouncement(error instanceof Error ? error.message : 'ไม่สามารถส่งคำขอเพิ่มคะแนนได้')
    } finally {
      setBusy(false)
    }
  }

  const classChip = classrooms.length === 1
    ? `${classrooms[0].name} • ${assignedStudents.length} คน`
    : `${classrooms.length} ห้องที่รับผิดชอบ • ${assignedStudents.length} คน`

  return (
    <AppShell account={account} state={state} items={navItems} active={tab} onNavigate={setTab} onLogout={onLogout}>
      <div className="page-heading">
        <div><p className="eyebrow">พื้นที่ของคุณครู</p><h1>{tab === 'overview' ? 'ห้องที่รับผิดชอบ' : tab === 'deduct' ? 'บันทึกการตัดคะแนน' : tab === 'request' ? 'ขอเพิ่มคะแนน' : 'กรณีติดตาม'}</h1></div>
        <span className="class-chip">{classrooms.length ? classChip : 'ยังไม่มอบหมายห้อง'}</span>
      </div>
      <div className="announcement" aria-live="polite">{announcement}</div>

      {tab === 'overview' ? (
        <section className="panel">
          <div className="section-heading"><div><p className="eyebrow">ภาคเรียนปัจจุบัน</p><h2>รายชื่อนักเรียนที่ดูแล</h2></div><button className="button primary compact" onClick={() => setTab('deduct')}><Icon name="plus" size={17} /> บันทึกตัดคะแนน</button></div>
          <div className="table-wrap"><table><thead><tr><th>รหัส</th><th>นักเรียน</th><th>ห้อง</th><th>คะแนนปัจจุบัน</th><th>ดำเนินการ</th></tr></thead><tbody>
            {assignedStudents.map((student) => <tr key={student.id}><td>{student.studentCode}</td><td><strong>{student.name}</strong></td><td>{student.classroomName}</td><td><span className={`score-text ${student.score < 60 ? 'danger' : ''}`}>{student.score}</span> / 100</td><td><button className="text-button" onClick={() => { setSingleStudentId(student.id); chooseScope('single'); setTab('deduct') }}>เลือกบันทึก</button></td></tr>)}
          </tbody></table></div>
          <p className="scope-note"><Icon name="shield" size={18} /> ระบบแสดงและอนุญาตให้ดำเนินการเฉพาะห้องที่ได้รับมอบหมายเท่านั้น</p>
        </section>
      ) : null}

      {tab === 'deduct' ? (
        <>
          <div className="scope-switch" role="group" aria-label="รูปแบบการเลือกนักเรียน">
            <button type="button" disabled={busy} className={deductionScope === 'single' ? 'active' : ''} aria-pressed={deductionScope === 'single'} onClick={() => chooseScope('single')}><strong>รายคน</strong><span>เลือกนักเรียน 1 คน</span></button>
            <button type="button" disabled={busy} className={deductionScope === 'selected' ? 'active' : ''} aria-pressed={deductionScope === 'selected'} onClick={() => chooseScope('selected')}><strong>หลายคน</strong><span>เลือกเฉพาะกลุ่มที่ต้องการ</span></button>
            <button type="button" disabled={busy} className={deductionScope === 'classroom' ? 'active' : ''} aria-pressed={deductionScope === 'classroom'} onClick={() => chooseScope('classroom')}><strong>ทั้งห้อง</strong><span>ใช้รายชื่อปัจจุบันทั้งห้อง</span></button>
          </div>
          <div className="workspace-grid">
            {deductionScope === 'classroom' ? (
              <ClassroomPicker classrooms={classrooms} selectedId={classroomId} onSelect={(id) => { setClassroomId(id); invalidateDeductionRequest() }} disabled={busy} />
            ) : (
              <StudentPicker
                students={assignedStudents}
                scope={deductionScope}
                singleStudentId={singleStudentId}
                selectedStudentIds={selectedStudentIds}
                onSelectSingle={(id) => { setSingleStudentId(id); invalidateDeductionRequest() }}
                onToggleStudent={toggleSelectedStudent}
                onToggleVisible={toggleVisibleStudents}
                disabled={busy}
              />
            )}
            <form className="panel action-form" onSubmit={recordDeductions}>
              <div className="selected-student-bar batch-target-bar">
                <div><span className="student-avatar large">{deductionTargets.length}</span><div><strong>{deductionScope === 'single' ? deductionTargets[0]?.name ?? 'ยังไม่เลือกนักเรียน' : deductionScope === 'selected' ? 'กลุ่มนักเรียนที่เลือก' : classrooms.find((item) => item.id === classroomId)?.name ?? 'ยังไม่เลือกห้อง'}</strong><small>{deductionScope === 'single' ? `${deductionTargets[0]?.studentCode ?? ''} • ${deductionTargets[0]?.classroomName ?? ''}` : 'ทุกคนจะใช้เกณฑ์และรายละเอียดเดียวกัน'}</small></div></div>
                <div><span>จำนวนเป้าหมาย</span><b>{deductionTargets.length} คน</b></div>
              </div>
              <fieldset disabled={busy}><legend>เลือกระเบียบ / ประเภทการกระทำ</legend><div className="rule-grid">{state.rules.filter((rule) => rule.active).map((rule) => <RuleOption key={rule.id} rule={rule} selected={rule.id === ruleId} onSelect={() => { setRuleId(rule.id); invalidateDeductionRequest() }} disabled={busy} />)}</div></fieldset>
              {selectedRule ? <div className="rule-summary"><div><StatusBadge severity={selectedRule.severity} /> <span>{selectedRule.category} • คนละ {selectedRule.points} คะแนน</span></div><strong>{deductionTargets.length ? deductionTargets.reduce((sum, student) => sum + student.score, 0) : 0} <span>→</span> {deductionTargets.reduce((sum, student) => sum + applyScoreDelta(student.score, -selectedRule.points).after, 0)}</strong></div> : null}
              <div className="date-field-grid">
                <label>วันและเวลาเกิดเหตุ<input type="datetime-local" disabled={busy} max={toLocalDateTimeInputValue()} value={occurredAt} onChange={(event) => { setOccurredAt(event.target.value); invalidateDeductionRequest() }} required /></label>
                <div className="field-help"><strong>คะแนนรวมก่อน → หลัง</strong><span>ตัวเลขด้านบนคำนวณโดยไม่ให้คะแนนต่ำกว่า 0</span></div>
              </div>
              <label>รายละเอียดเหตุการณ์ (เฉพาะบุคลากร)<textarea disabled={busy} value={internalNote} onChange={(event) => { setInternalNote(event.target.value); invalidateDeductionRequest() }} placeholder="ระบุข้อเท็จจริง สถานที่ และบริบทที่จำเป็น" minLength={5} required /></label>
              {selectedRule?.guardianContactRequired ? <div className="warning-note"><Icon name="alert" /><span>เกณฑ์นี้เป็นกรณีร้ายแรง ระบบจะเปิดเคสติดตามและงานติดต่อผู้ปกครองแยกให้นักเรียนทุกคนโดยอัตโนมัติ</span></div> : null}

              {reviewingDeduction ? (
                <section className="deduction-review" aria-label="ตรวจสอบก่อนยืนยัน">
                  <div className="review-heading"><div><p className="eyebrow">ขั้นตอนสุดท้าย</p><h2>ตรวจสอบรายชื่อก่อนบันทึก</h2></div><span className="counter">{deductionTargets.length}</span></div>
                  <div className="review-roster">
                    {deductionTargets.map((student) => {
                      const change = selectedRule ? applyScoreDelta(student.score, -selectedRule.points) : null
                      return <div className="review-student" key={student.id}><span><strong>{student.name}</strong><small>{student.studentCode} • {student.classroomName}</small></span><b>{change?.before} → {change?.after}</b></div>
                    })}
                  </div>
                  <dl className="review-facts"><div><dt>เกณฑ์</dt><dd>{selectedRule?.title}</dd></div><div><dt>วันเวลา</dt><dd>{formatThaiDate(localDateTimeToIso(occurredAt) ?? occurredAt)}</dd></div><div><dt>รายละเอียด</dt><dd>{internalNote.trim()}</dd></div></dl>
                  {isSeriousBulk ? <label className="confirmation-check"><input type="checkbox" disabled={busy} checked={confirmSeriousBulk} onChange={(event) => setConfirmSeriousBulk(event.target.checked)} /><span>ยืนยันว่าตรวจสอบรายชื่อกรณีร้ายแรงทั้ง {deductionTargets.length} คนแล้ว และรับทราบว่าจะสร้างงานแจ้งผู้ปกครองรายคน</span></label> : null}
                </section>
              ) : null}

              <div className="form-actions">
                <button type="button" className="button secondary" disabled={busy} onClick={() => { if (!reviewingDeduction) setInternalNote(''); invalidateDeductionRequest() }}>{reviewingDeduction ? 'กลับไปแก้ไข' : 'ล้างรายละเอียด'}</button>
                <button type="submit" className="button primary" disabled={busy || !deductionTargets.length}>{busy ? 'กำลังบันทึกทั้งชุด…' : reviewingDeduction ? `ยืนยันตัดคะแนน ${deductionTargets.length} คน` : 'ตรวจสอบก่อนยืนยัน'}</button>
              </div>

              {deductionResult ? (
                <section className="batch-result" aria-label="ผลการบันทึก">
                  <div className="review-heading"><div><p className="eyebrow">บันทึกสำเร็จ</p><h2>ตัดคะแนนจริงรวม {deductionResult.totalAppliedPoints} คะแนน</h2></div><span className="badge status-approved">ครบ {deductionResult.targetCount} คน</span></div>
                  {deductionResult.alreadyAtZeroCount ? <p>มี {deductionResult.alreadyAtZeroCount} คนที่คะแนนเดิมเป็น 0 จึงไม่มีคะแนนให้ตัดเพิ่ม</p> : null}
                  <div className="review-roster compact-roster">{deductionResult.results.map((row) => { const student = assignedStudents.find((item) => item.id === row.studentId); return <div className="review-student" key={row.studentId}><span><strong>{student?.name ?? row.studentId}</strong><small>ตัดจริง {row.appliedPoints} คะแนน</small></span><b>{row.balanceBefore} → {row.balanceAfter}</b></div> })}</div>
                </section>
              ) : null}
            </form>
          </div>
        </>
      ) : null}

      {tab === 'request' ? (
        <div className="two-column wide-left">
          <form className="panel stack-form" onSubmit={submitAdditionRequest}>
            <div className="section-heading"><div><p className="eyebrow">ต้องรออนุมัติ</p><h2>สร้างคำขอเพิ่มคะแนนพร้อมหลักฐาน</h2></div></div>
            <label>นักเรียน<select disabled={busy} value={additionStudentId} onChange={(event) => { setAdditionStudentId(event.target.value); invalidateAdditionRequest() }}>{assignedStudents.map((student) => <option key={student.id} value={student.id}>{student.studentCode} • {student.name} ({student.score}/100)</option>)}</select></label>
            <label>เกณฑ์การเพิ่มคะแนน<select disabled={busy} value={positiveRuleId} onChange={(event) => { const nextId = event.target.value; const nextRule = activePositiveRules.find((rule) => rule.id === nextId); setPositiveRuleId(nextId); setRequestPoints(nextRule?.defaultPoints ?? 1); invalidateAdditionRequest() }} required><option value="" disabled>เลือกเกณฑ์</option>{activePositiveRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.code} • {rule.title}</option>)}</select></label>
            {selectedPositiveRule ? <PositiveRuleSummary rule={selectedPositiveRule} /> : <p className="form-error">ยังไม่มีเกณฑ์การเพิ่มคะแนนที่เปิดใช้งาน</p>}
            <div className="date-field-grid">
              <label>วันและเวลาที่ทำกิจกรรม<input type="datetime-local" disabled={busy} max={toLocalDateTimeInputValue()} value={activityOccurredAt} onChange={(event) => { setActivityOccurredAt(event.target.value); invalidateAdditionRequest() }} required /></label>
              <label>จำนวนคะแนนที่ขอ<input type="number" disabled={busy} min="1" max={selectedPositiveRule?.maxPoints ?? 100} readOnly={!selectedPositiveRule?.discretionary} value={requestPoints} onChange={(event) => { setRequestPoints(Number(event.target.value)); invalidateAdditionRequest() }} /></label>
            </div>
            {!pointValidation.valid && pointValidation.message ? <p className="form-error">{pointValidation.message}</p> : null}
            {additionPreview ? <div className="addition-preview"><span>คะแนนหากแอดมินอนุมัติ</span><strong>{additionPreview.before} <i>→</i> {additionPreview.after}</strong><small>{additionPreview.appliedDelta < requestPoints ? `ระบบเพิ่มจริงได้ ${additionPreview.appliedDelta} คะแนน เพราะสูงสุดไม่เกิน 100` : `เพิ่ม ${additionPreview.appliedDelta} คะแนน`}</small></div> : null}
            <label>เหตุผล / งานที่นักเรียนทำ<textarea disabled={busy} value={requestReason} onChange={(event) => { setRequestReason(event.target.value); invalidateAdditionRequest() }} required minLength={5} placeholder="อธิบายงานหรือพฤติกรรมเชิงบวกที่ตรงกับเกณฑ์" /></label>
            <label>หลักฐานประกอบ<textarea disabled={busy} value={evidenceNote} onChange={(event) => { setEvidenceNote(event.target.value); invalidateAdditionRequest() }} required minLength={5} placeholder="ระบุชื่อเอกสาร ภาพถ่าย ผู้รับรอง หรือแหล่งตรวจสอบหลักฐาน" /></label>
            <p className="scope-note"><Icon name="shield" size={18} /> เหตุผลและหลักฐานจะแสดงเฉพาะครูและแอดมิน นักเรียนจะไม่เห็นข้อมูลภายในส่วนนี้</p>
            <button className="button primary" type="submit" disabled={busy || !selectedPositiveRule || additionStudent?.score === 100}>{busy ? 'กำลังส่ง…' : 'ส่งรายละเอียดให้แอดมินตรวจสอบ'}</button>
          </form>
          <section className="panel"><div className="section-heading"><div><p className="eyebrow">ประวัติคำขอ</p><h2>สถานะการอนุมัติ</h2></div><span className="counter">{teacherRequests.length}</span></div>
            {teacherRequests.length ? <div className="record-list">{teacherRequests.map((request) => { const student = state.students.find((item) => item.id === request.studentId); return <article className="record-row detailed-record" key={request.id}><div><strong>{student?.name} • +{request.requestedPoints}</strong><span>{request.positiveRuleTitle ?? 'ไม่ระบุเกณฑ์'}</span><span>{request.reason}</span>{request.evidenceNote ? <small>หลักฐาน: {request.evidenceNote}</small> : null}<small>ทำกิจกรรม {formatThaiDate(request.activityOccurredAt ?? request.createdAt)} • ส่ง {formatThaiDate(request.createdAt)}</small>{request.decisionNote ? <small>หมายเหตุแอดมิน: {request.decisionNote}</small> : null}</div><span className={`badge status-${request.status}`}>{request.status === 'pending' ? 'รออนุมัติ' : request.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}</span></article> })}</div> : <EmptyState title="ยังไม่มีคำขอ" detail="คำขอเพิ่มคะแนนที่ส่งแล้วจะแสดงพร้อมรายละเอียดที่นี่" />}
          </section>
        </div>
      ) : null}

      {tab === 'cases' ? (
        <section className="panel"><div className="section-heading"><div><p className="eyebrow">ระบบดูแลช่วยเหลือ</p><h2>กรณีร้ายแรงที่ต้องติดตาม</h2></div><span className="counter danger">{assignedCases.length}</span></div>
          {assignedCases.length ? <div className="record-list">{assignedCases.map((item) => { const student = state.students.find((entry) => entry.id === item.studentId); return <article className="case-row" key={item.id}><div className="case-marker"><Icon name="alert" /></div><div><strong>{student?.name}</strong><span>{item.internalNote}</span><small>เปิดเคสเมื่อ {formatThaiDate(item.createdAt)}</small></div><div><StatusBadge severity={item.severity} /><span className="badge status-pending">{item.guardianContactStatus === 'pending' ? 'รอติดต่อผู้ปกครอง' : 'กำลังติดตาม'}</span></div></article> })}</div> : <EmptyState title="ไม่มีกรณีร้ายแรงค้างอยู่" detail="เหตุการณ์ระดับร้ายแรงจะเปิดเป็นเคสติดตามอัตโนมัติ" />}
        </section>
      ) : null}
    </AppShell>
  )
}
