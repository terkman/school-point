import { useState, type FormEvent } from 'react'
import {
  applyScoreDelta,
  createId,
  formatThaiDate,
  type Account,
  type DemoState,
} from './domain'
import type { AdminAddPointsBulkResult, AppDataActions, UpdateTermScheduleInput } from './dataActions'
import { validateTermSchedule } from './termSchedule'
import { localDateTimeToIso, toLocalDateTimeInputValue, validatePositiveRulePoints } from './teacherWorkflows'
import { StudentTargetSelector } from './StudentTargetSelector'
import { createInitialStudentSelection, resolveStudentTargets } from './studentSelection'
import { AppShell, EmptyState, Icon, StatusBadge, type NavItem } from './ui'

type AdminTab = 'overview' | 'approvals' | 'cases' | 'manage'

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
  onSave: (input: UpdateTermScheduleInput) => Promise<void>
}

function TermScheduleForm({ term, busy, onSave }: TermScheduleFormProps) {
  const [startsOn, setStartsOn] = useState(term.startsOn ?? '')
  const [endsOn, setEndsOn] = useState(term.endsOn ?? '')
  const [error, setError] = useState('')
  const unchanged = startsOn === (term.startsOn ?? '') && endsOn === (term.endsOn ?? '')
  const hasSavedSchedule = Boolean(term.startsOn && term.endsOn)

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
    </form>
  )
}

export function AdminDashboard({ account, state, onChange, actions, onResetDemo, onLogout }: AdminDashboardProps) {
  const pending = state.additionRequests.filter((item) => item.status === 'pending')
  const openCases = state.seriousCases.filter((item) => item.status !== 'resolved')
  const openAppeals = state.appeals.filter((item) => item.status === 'submitted' || item.status === 'reviewing')
  const directAdditions = state.transactions.filter((item) => item.additionSource === 'admin_direct')
  const [tab, setTab] = useState<AdminTab>('overview')
  const [adminSelection, setAdminSelection] = useState(() => createInitialStudentSelection(state.students))
  const activePositiveRules = state.positiveRules.filter((rule) => rule.active)
  const initialPositiveRule = activePositiveRules[0]
  const [adminPositiveRuleId, setAdminPositiveRuleId] = useState(initialPositiveRule?.id ?? '')
  const [points, setPoints] = useState(initialPositiveRule?.defaultPoints ?? 1)
  const [activityOccurredAt, setActivityOccurredAt] = useState(() => toLocalDateTimeInputValue())
  const [reason, setReason] = useState('')
  const [adminEvidenceNote, setAdminEvidenceNote] = useState('')
  const [adminRequestId, setAdminRequestId] = useState(() => newRequestId())
  const [adminAdditionResult, setAdminAdditionResult] = useState<AdminAddPointsBulkResult | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const [selectedRequestId, setSelectedRequestId] = useState(pending[0]?.id ?? state.additionRequests[0]?.id ?? '')
  const [decisionNote, setDecisionNote] = useState('')
  const [decisionError, setDecisionError] = useState('')
  const adminTargets = resolveStudentTargets(state.students, adminSelection)
  const adminPositiveRule = activePositiveRules.find((item) => item.id === adminPositiveRuleId)
  const adminPointValidation = validatePositiveRulePoints(adminPositiveRule, points)
  const adminAdditionBeforeTotal = adminTargets.reduce((sum, student) => sum + student.score, 0)
  const adminAdditionAfterTotal = adminTargets.reduce((sum, student) => sum + applyScoreDelta(student.score, points).after, 0)
  const adminAdditionAppliedTotal = adminAdditionAfterTotal - adminAdditionBeforeTotal
  const mutationBusy = Boolean(busyAction)
  const adminAdditionBusy = mutationBusy
  const selectedRequest = (state.additionRequests.find((item) => item.id === selectedRequestId)
    ?? pending[0]
    ?? state.additionRequests[0]) as DetailedAdditionRequest | undefined
  const selectedRequestStudent = state.students.find((item) => item.id === selectedRequest?.studentId)
  const selectedRequestTeacher = state.teachers.find((item) => item.id === selectedRequest?.teacherId)
  const selectedRequestScore = selectedRequestStudent?.score ?? 0
  const selectedRequestScoreAfter = Math.min(100, selectedRequestScore + (selectedRequest?.requestedPoints ?? 0))
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
  }

  async function decideAdditionRequest(requestId: string, approve: boolean, note: string) {
    if (mutationBusy) return
    const request = state.additionRequests.find((item) => item.id === requestId)
    const student = state.students.find((item) => item.id === request?.studentId)
    if (!request || !student || request.status !== 'pending') return
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
        setAnnouncement(approve
          ? `อนุมัติคำขอเพิ่มคะแนนของ ${student.name} แล้ว`
          : `ปฏิเสธคำขอของ ${student.name} แล้ว คะแนนไม่เปลี่ยนแปลง`)
        setDecisionNote('')
      } catch (error) {
        setAnnouncement(error instanceof Error ? error.message : 'ไม่สามารถบันทึกผลการพิจารณาได้')
      } finally {
        setBusyAction('')
      }
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

  function changeAdminSelection(next: typeof adminSelection) {
    setAdminSelection(next)
    invalidateAdminRequest()
  }

  async function addPointsDirectly(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mutationBusy) return
    const activityIso = localDateTimeToIso(activityOccurredAt)
    if (!adminPositiveRule || !adminPointValidation.valid || !activityIso || reason.trim().length < 5 || adminEvidenceNote.trim().length < 5) {
      setAnnouncement(adminPointValidation.message ?? 'กรุณากรอกเกณฑ์ วันทำกิจกรรม เหตุผล และหลักฐานให้ครบถ้วน')
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
    if (actions) {
      setBusyAction('admin-add')
      try {
        const result = await actions.adminAddPointsBulk({
          clientRequestId: adminRequestId,
          scope: adminSelection.scope,
          studentIds: adminTargets.map((student) => student.id),
          classroomId: adminSelection.classroomId,
          positiveRuleId: adminPositiveRule.id,
          points,
          activityOccurredAt: activityIso,
          reason: reason.trim(),
          evidenceNote: adminEvidenceNote.trim(),
          termId: state.term.id,
        })
        setReason('')
        setAdminEvidenceNote('')
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
        evidenceNote: adminEvidenceNote.trim(),
        internalReason: reason.trim(),
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
    setAdminRequestId(newRequestId())
    setAdminAdditionResult(localResult)
    setAnnouncement(`เพิ่มคะแนนครบ ${localResult.targetCount} คน รวมเพิ่มจริง ${localResult.totalAppliedPoints} คะแนนเรียบร้อยแล้ว`)
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
                    return (
                      <tr key={request.id}>
                        <td>{formatThaiDate(request.createdAt)}</td>
                        <td><strong>{student?.name ?? 'ไม่พบข้อมูลนักเรียน'}</strong><small>{student?.studentCode} • ปัจจุบัน {student?.score ?? '—'}</small></td>
                        <td>{details.positiveRuleTitle ?? request.reason}<small>{details.positiveRuleTitle ? request.reason : 'ไม่ได้ระบุเกณฑ์กิจกรรม'}</small></td>
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
          {selectedRequest ? (
            <section className="panel stack-form" aria-labelledby="addition-review-title">
              <div className="section-heading">
                <div><p className="eyebrow">รายละเอียดคำขอ</p><h2 id="addition-review-title">ตรวจสอบหลักฐานก่อนตัดสินใจ</h2></div>
                <span className={`badge status-${selectedRequest.status}`}>{selectedRequest.status === 'pending' ? 'รอตรวจสอบ' : selectedRequest.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}</span>
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
                  <strong>เหตุผลที่ขอเพิ่มคะแนน</strong>
                  <span>{selectedRequest.reason || 'ไม่ได้ระบุเหตุผล'}</span>
                </div>
              </div>
              <div className="selected-record">
                <strong>รายละเอียดและหลักฐานจากคุณครู</strong>
                <span>{selectedRequest.evidenceNote?.trim() || 'ไม่ได้แนบรายละเอียดหลักฐาน'}</span>
              </div>
              <div className="rule-summary" aria-label={`คะแนนปัจจุบัน ${selectedRequestScore} คะแนน หากอนุมัติจะเป็น ${selectedRequestScoreAfter} คะแนน`}>
                <div><Icon name="score" />คะแนนปัจจุบัน → หลังอนุมัติ (สูงสุด 100)</div>
                <strong>{selectedRequestScore}<span>→</span>{selectedRequestScoreAfter}</strong>
              </div>
              {selectedRequest.status === 'pending' ? (
                <>
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
                    <button className="button reject" disabled={!decisionNoteReady || mutationBusy} onClick={() => decideAdditionRequest(selectedRequest.id, false, decisionNote)}>
                      {busyAction === `request-${selectedRequest.id}` ? 'กำลังบันทึก…' : 'ปฏิเสธคำขอ'}
                    </button>
                    <button className="button approve" disabled={!decisionNoteReady || mutationBusy} onClick={() => decideAdditionRequest(selectedRequest.id, true, decisionNote)}>
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
          ) : null}
          <section className="panel"><div className="section-heading"><div><p className="eyebrow">ไม่แก้รายการเดิม</p><h2>คำอุทธรณ์จากนักเรียน</h2></div><span className="counter">{openAppeals.length}</span></div>
            {state.appeals.length ? <div className="record-list">{state.appeals.map((appeal) => { const student = state.students.find((item) => item.id === appeal.studentId); const source = state.transactions.find((item) => item.id === appeal.transactionId); return <article className="appeal-review-row" key={appeal.id}><div><strong>{student?.name} • {Math.abs(source?.appliedDelta ?? 0)} คะแนน</strong><span>{appeal.statement}</span><small>ยื่นเมื่อ {formatThaiDate(appeal.createdAt)}</small></div>{appeal.status === 'submitted' || appeal.status === 'reviewing' ? <div className="inline-actions"><button className="button approve compact" disabled={mutationBusy} onClick={() => decideAppeal(appeal.id, true)}>คืนคะแนน</button><button className="button reject compact" disabled={mutationBusy} onClick={() => decideAppeal(appeal.id, false)}>ปฏิเสธ</button></div> : <span className={`badge status-${appeal.status === 'accepted' ? 'approved' : 'rejected'}`}>{appeal.status === 'accepted' ? 'คืนคะแนนแล้ว' : 'ไม่อนุมัติ'}</span>}</article> })}</div> : <EmptyState title="ยังไม่มีคำอุทธรณ์" detail="คำอุทธรณ์ที่นักเรียนยื่นภายใน 7 วันจะแสดงที่นี่" />}
          </section>
        </div>
      ) : null}

      {tab === 'cases' ? (
        <section className="panel"><div className="section-heading"><div><p className="eyebrow">แยกจากงานคะแนนทั่วไป</p><h2>กรณีร้ายแรงและการติดต่อผู้ปกครอง</h2></div><span className="counter danger">{openCases.length}</span></div>
          {openCases.length ? <div className="record-list">{openCases.map((item) => { const student = state.students.find((entry) => entry.id === item.studentId); return <article className="case-row" key={item.id}><div className="case-marker"><Icon name="alert" /></div><div><strong>{student?.name} • {student?.classroomName}</strong><span>{item.internalNote}</span><small>เปิดเมื่อ {formatThaiDate(item.createdAt)}</small></div><div><StatusBadge severity={item.severity} /><span className="badge status-pending">{item.guardianContactStatus === 'pending' ? 'รอติดต่อผู้ปกครอง' : 'กำลังติดตาม'}</span></div></article> })}</div> : <EmptyState title="ไม่มีกรณีร้ายแรงค้างอยู่" detail="เหตุการณ์ร้ายแรงจะสร้างเคสและงานติดต่อผู้ปกครองอัตโนมัติ" />}
        </section>
      ) : null}

      {tab === 'manage' ? (
        <div className="manage-grid">
          <StudentTargetSelector
            students={state.students}
            value={adminSelection}
            onChange={changeAdminSelection}
            disabled={adminAdditionBusy}
            actionLabel="เพิ่มคะแนน"
          />
          <form className="panel stack-form" onSubmit={addPointsDirectly}><div className="section-heading"><div><p className="eyebrow">สิทธิ์ผู้ดูแลระบบ</p><h2>เพิ่มคะแนนโดยตรงพร้อมหลักฐาน</h2></div></div>
            <div className="selected-student-bar batch-target-bar">
              <div><span className="student-avatar large">{adminTargets.length}</span><div><strong>{adminSelection.scope === 'single' ? adminTargets[0]?.name ?? 'ยังไม่เลือกนักเรียน' : adminSelection.scope === 'selected' ? 'กลุ่มนักเรียนที่เลือก' : adminTargets[0]?.classroomName ?? 'ยังไม่เลือกห้อง'}</strong><small>รายการทั้งหมดใช้เกณฑ์ เหตุผล และหลักฐานชุดเดียวกัน</small></div></div>
              <div><span>จำนวนเป้าหมาย</span><b>{adminTargets.length} คน</b></div>
            </div>
            <label>เกณฑ์การเพิ่มคะแนน<select disabled={adminAdditionBusy} value={adminPositiveRuleId} onChange={(event) => { const nextId = event.target.value; const nextRule = activePositiveRules.find((rule) => rule.id === nextId); setAdminPositiveRuleId(nextId); setPoints(nextRule?.defaultPoints ?? 1); invalidateAdminRequest() }} required><option value="" disabled>เลือกเกณฑ์</option>{activePositiveRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.code} • {rule.title}</option>)}</select></label>
            {adminPositiveRule ? <div className="positive-rule-summary"><div><span className="badge status-approved">{adminPositiveRule.code}</span><strong>{adminPositiveRule.title}</strong></div><p>{adminPositiveRule.description || adminPositiveRule.category}</p><small>{adminPositiveRule.discretionary ? `กำหนดได้ 1–${adminPositiveRule.maxPoints} คะแนน` : `คะแนนตามเกณฑ์ +${adminPositiveRule.defaultPoints ?? 0}`}</small></div> : <p className="form-error">ยังไม่มีเกณฑ์การเพิ่มคะแนนที่เปิดใช้งาน</p>}
            <div className="date-field-grid">
              <label>วันและเวลาที่ทำกิจกรรม<input type="datetime-local" disabled={adminAdditionBusy} max={toLocalDateTimeInputValue()} value={activityOccurredAt} onChange={(event) => { setActivityOccurredAt(event.target.value); invalidateAdminRequest() }} required /></label>
              <label>จำนวนคะแนน<input type="number" disabled={adminAdditionBusy} min="1" max={adminPositiveRule?.maxPoints ?? 100} readOnly={!adminPositiveRule?.discretionary} value={points} onChange={(event) => { setPoints(Number(event.target.value)); invalidateAdminRequest() }} /></label>
            </div>
            {!adminPointValidation.valid && adminPointValidation.message ? <p className="form-error">{adminPointValidation.message}</p> : null}
            {adminTargets.length ? <div className="addition-preview"><span>คะแนนรวมหลังบันทึก (รายคนสูงสุด 100)</span><strong>{adminAdditionBeforeTotal} <i>→</i> {adminAdditionAfterTotal}</strong><small>ระบบจะเพิ่มจริงรวม {adminAdditionAppliedTotal} คะแนน</small></div> : null}
            <label>เหตุผลภายใน<textarea disabled={adminAdditionBusy} value={reason} onChange={(event) => { setReason(event.target.value); invalidateAdminRequest() }} required minLength={5} placeholder="อธิบายกิจกรรมหรือพฤติกรรมที่ตรงกับเกณฑ์" /></label>
            <label>หลักฐานประกอบ<textarea disabled={adminAdditionBusy} value={adminEvidenceNote} onChange={(event) => { setAdminEvidenceNote(event.target.value); invalidateAdminRequest() }} required minLength={5} placeholder="ระบุเอกสาร ภาพถ่าย หรือผู้รับรองที่ตรวจสอบได้" /></label>
            <p className="scope-note"><Icon name="shield" size={18} /> นักเรียนเห็นเฉพาะชื่อเกณฑ์และคะแนน ไม่เห็นเหตุผลภายในหรือหลักฐาน</p>
            <button className="button primary" type="submit" disabled={adminAdditionBusy || !adminPositiveRule || !adminTargets.length}>{adminAdditionBusy ? 'กำลังบันทึกทั้งชุด…' : `เพิ่มคะแนน ${adminTargets.length} คนและบันทึกรายละเอียด`}</button>
            {adminAdditionResult ? <div className="batch-result compact-result"><strong>บันทึกสำเร็จ {adminAdditionResult.targetCount} คน</strong><span>เพิ่มจริงรวม {adminAdditionResult.totalAppliedPoints} คะแนน</span></div> : null}
          </form>
          <TermScheduleForm
            key={`${state.term.id}:${state.term.startsOn ?? ''}:${state.term.endsOn ?? ''}`}
            term={state.term}
            busy={mutationBusy}
            onSave={updateTermSchedule}
          />
          <section className="panel rules-panel"><div className="section-heading"><div><p className="eyebrow">ตรวจสอบย้อนหลัง</p><h2>ประวัติเพิ่มคะแนนโดยตรง</h2></div><span className="counter">{directAdditions.length}</span></div>
            {directAdditions.length ? <div className="record-list">{directAdditions.slice(0, 20).map((transaction) => { const student = state.students.find((item) => item.id === transaction.studentId); return <article className="record-row detailed-record" key={transaction.id}><div><strong>{student?.name ?? 'ไม่พบข้อมูลนักเรียน'} • +{transaction.appliedDelta} คะแนน</strong><span>{transaction.positiveRuleTitle ?? transaction.reason}</span>{transaction.internalReason ? <span>เหตุผล: {transaction.internalReason}</span> : null}{transaction.evidenceNote ? <small>หลักฐาน: {transaction.evidenceNote}</small> : null}<small>ทำกิจกรรม {formatThaiDate(transaction.activityOccurredAt ?? transaction.occurredAt)} • คะแนน {transaction.scoreBefore} → {transaction.scoreAfter}</small></div><span className="badge status-approved">บันทึกแล้ว</span></article> })}</div> : <EmptyState title="ยังไม่มีรายการเพิ่มโดยตรง" detail="รายการที่แอดมินเพิ่มพร้อมเกณฑ์และหลักฐานจะแสดงที่นี่" />}
          </section>
          <section className="panel"><div className="section-heading"><div><p className="eyebrow">ภาคเรียน</p><h2>เริ่มคะแนนที่ 100</h2></div></div><p>รายการคะแนนเดิมยังคงอยู่ เคสติดตามที่ไม่เสร็จจะยกไปต่อโดยไม่ยกคะแนนติดลบ</p><div className="reset-preview"><span>นักเรียนที่จะรีเซ็ต <strong>{state.students.length}</strong></span><span>เคสที่จะคงไว้ <strong>{openCases.length}</strong></span></div><button className="button warning full" disabled={Boolean(state.term.resetCompletedAt) || mutationBusy} onClick={resetTermScores}>{busyAction === 'initialize-term' ? 'กำลังเตรียมคะแนน…' : state.term.resetCompletedAt ? `รีเซ็ตแล้ว ${formatThaiDate(state.term.resetCompletedAt)}` : 'ตรวจสอบและรีเซ็ตคะแนน'}</button></section>
          <section className="panel rules-panel"><div className="section-heading"><div><p className="eyebrow">ระเบียบตัวอย่าง</p><h2>เกณฑ์การตัดคะแนน</h2></div><span className="counter">{state.rules.length}</span></div><div className="rule-list">{state.rules.map((rule) => <div key={rule.id}><span><strong>{rule.title}</strong><small>{rule.category}</small></span><StatusBadge severity={rule.severity} /><b>−{rule.points}</b></div>)}</div></section>
          {onResetDemo ? <section className="panel danger-zone"><div className="section-heading"><div><p className="eyebrow">สำหรับการทดสอบ</p><h2>คืนค่าข้อมูลสาธิต</h2></div></div><p>ล้างเฉพาะข้อมูลสมมติในเบราว์เซอร์นี้ ไม่มีผลต่อฐานข้อมูลจริง</p><button className="button reject" disabled={mutationBusy} onClick={onResetDemo}>คืนค่าข้อมูลตัวอย่าง</button></section> : null}
        </div>
      ) : null}
    </AppShell>
  )
}
