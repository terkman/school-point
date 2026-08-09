import { useMemo, useState } from 'react'
import { applyScoreDelta, formatThaiDate, type DemoState } from './domain'
import { EvidenceSummary } from './EvidenceField'
import type { AppDataActions } from './dataActions'
import {
  additionDecisionNeedsReason,
  validateAdditionDecision,
  validateAppealDecision,
} from './adminWorkflows'
import { EmptyState, Icon } from './ui'

export interface AdditionDecisionInput {
  approve: boolean
  approvedPoints: number
  note: string
}

export interface DeductionDecisionInput {
  approve: boolean
  approvedPoints: number
  note: string
}

export interface AppealDecisionInput {
  accepted: boolean
  restoredPoints: number
  explanation: string
}

interface AdminReviewCenterProps {
  state: DemoState
  busyAction: string
  supportsAdditionAdjustment: boolean
  supportsDeductionAdjustment: boolean
  supportsPartialAppeal: boolean
  resolveFileUrl?: AppDataActions['createEvidenceUrl']
  onDecideAddition: (requestId: string, input: AdditionDecisionInput) => Promise<void>
  onDecideDeduction: (requestId: string, input: DeductionDecisionInput) => Promise<void>
  onDecideAppeal: (appealId: string, input: AppealDecisionInput) => Promise<void>
  onReopenAppeal: (appealId: string, reason: string) => Promise<void>
}

type ReviewTab = 'deduction' | 'addition' | 'appeal'
type SelectedReview = { type: ReviewTab; id: string } | null

function initials(name?: string): string {
  return name?.trim().slice(0, 2) || 'นร'
}

export function AdminReviewCenter({
  state,
  busyAction,
  supportsAdditionAdjustment,
  supportsDeductionAdjustment,
  supportsPartialAppeal,
  resolveFileUrl,
  onDecideAddition,
  onDecideDeduction,
  onDecideAppeal,
  onReopenAppeal,
}: AdminReviewCenterProps) {
  const pendingDeductions = useMemo(
    () => state.deductionRequests.filter((item) => item.status === 'pending'),
    [state.deductionRequests],
  )
  const pendingAdditions = useMemo(
    () => state.additionRequests.filter((item) => item.status === 'pending'),
    [state.additionRequests],
  )
  const openAppeals = useMemo(
    () => state.appeals.filter((item) => item.status === 'submitted' || item.status === 'reviewing'),
    [state.appeals],
  )
  const decidedAppeals = useMemo(
    () => state.appeals.filter((item) => item.status === 'accepted' || item.status === 'rejected'),
    [state.appeals],
  )
  const [tab, setTab] = useState<ReviewTab>('deduction')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'newest' | 'oldest'>('oldest')
  const [selected, setSelected] = useState<SelectedReview>(null)
  const [approvedPoints, setApprovedPoints] = useState(1)
  const [additionNote, setAdditionNote] = useState('')
  const [additionError, setAdditionError] = useState('')
  const [deductionPoints, setDeductionPoints] = useState(10)
  const [deductionNote, setDeductionNote] = useState('')
  const [deductionError, setDeductionError] = useState('')
  const [restorePoints, setRestorePoints] = useState(true)
  const [restoredPoints, setRestoredPoints] = useState(1)
  const [appealExplanation, setAppealExplanation] = useState('')
  const [appealError, setAppealError] = useState('')
  const [reopenAppealId, setReopenAppealId] = useState('')
  const [reopenReason, setReopenReason] = useState('')
  const [reopenError, setReopenError] = useState('')
  const studentById = useMemo(() => new Map(state.students.map((item) => [item.id, item])), [state.students])
  const teacherById = useMemo(() => new Map(state.teachers.map((item) => [item.id, item])), [state.teachers])
  const transactionById = useMemo(() => new Map(state.transactions.map((item) => [item.id, item])), [state.transactions])

  const selectedAddition = selected?.type === 'addition'
    ? state.additionRequests.find((item) => item.id === selected.id)
    : undefined
  const selectedDeduction = selected?.type === 'deduction'
    ? state.deductionRequests.find((item) => item.id === selected.id)
    : undefined
  const selectedAppeal = selected?.type === 'appeal'
    ? state.appeals.find((item) => item.id === selected.id)
    : undefined
  const selectedAppealSource = selectedAppeal ? transactionById.get(selectedAppeal.transactionId) : undefined
  const maximumRestorablePoints = Math.max(1, Math.abs(selectedAppealSource?.appliedDelta ?? 0))
  const busy = Boolean(busyAction)

  const visibleItems = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('th')
    const source = tab === 'deduction' ? pendingDeductions : tab === 'addition' ? pendingAdditions : openAppeals
    return source
      .filter((item) => {
        if (!normalizedSearch) return true
        const student = studentById.get(item.studentId)
        const requestText = 'ruleTitle' in item
          ? `${item.ruleTitle} ${item.internalNote}`
          : 'requestedPoints' in item
            ? `${item.positiveRuleTitle ?? ''} ${item.reason}`
            : item.statement
        return `${student?.name ?? ''} ${student?.studentCode ?? ''} ${requestText}`.toLocaleLowerCase('th').includes(normalizedSearch)
      })
      .sort((left, right) => sort === 'newest'
        ? new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        : new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
  }, [openAppeals, pendingAdditions, pendingDeductions, search, sort, studentById, tab])

  function openDeduction(requestId: string) {
    const request = state.deductionRequests.find((item) => item.id === requestId)
    if (!request) return
    setDeductionPoints(request.requestedPoints)
    setDeductionNote('')
    setDeductionError('')
    setSelected({ type: 'deduction', id: requestId })
  }

  function openAddition(requestId: string) {
    const request = state.additionRequests.find((item) => item.id === requestId)
    if (!request) return
    setApprovedPoints(request.requestedPoints)
    setAdditionNote('')
    setAdditionError('')
    setSelected({ type: 'addition', id: requestId })
  }

  function openAppeal(appealId: string) {
    const appeal = state.appeals.find((item) => item.id === appealId)
    const source = appeal ? transactionById.get(appeal.transactionId) : undefined
    if (!appeal || !source) return
    setRestorePoints(true)
    setRestoredPoints(Math.max(1, Math.abs(source.appliedDelta)))
    setAppealExplanation('')
    setAppealError('')
    setSelected({ type: 'appeal', id: appealId })
  }

  async function submitAddition(approve: boolean) {
    if (!selectedAddition || busy) return
    const error = validateAdditionDecision({
      approve,
      requestedPoints: selectedAddition.requestedPoints,
      approvedPoints,
      note: additionNote,
    })
    if (error) {
      setAdditionError(error)
      return
    }
    if (approve && approvedPoints !== selectedAddition.requestedPoints && !supportsAdditionAdjustment) {
      setAdditionError('การปรับคะแนนต้องอัปเดตระบบหลังบ้านก่อน ขณะนี้อนุมัติได้เฉพาะคะแนนเดิม')
      return
    }
    setAdditionError('')
    try {
      await onDecideAddition(selectedAddition.id, { approve, approvedPoints, note: additionNote.trim() })
      setSelected(null)
    } catch (error) {
      setAdditionError(error instanceof Error ? error.message : 'ไม่สามารถบันทึกผลการพิจารณาได้')
    }
  }

  async function submitDeduction(approve: boolean) {
    if (!selectedDeduction || busy) return
    const error = validateAdditionDecision({
      approve,
      requestedPoints: selectedDeduction.requestedPoints,
      approvedPoints: deductionPoints,
      note: deductionNote,
    })
    if (error) {
      setDeductionError(error)
      return
    }
    if (approve && deductionPoints !== selectedDeduction.requestedPoints && !supportsDeductionAdjustment) {
      setDeductionError('การปรับคะแนนต้องอัปเดตระบบหลังบ้านก่อน ขณะนี้อนุมัติได้เฉพาะคะแนนเดิม')
      return
    }
    setDeductionError('')
    try {
      await onDecideDeduction(selectedDeduction.id, { approve, approvedPoints: deductionPoints, note: deductionNote.trim() })
      setSelected(null)
    } catch (error) {
      setDeductionError(error instanceof Error ? error.message : 'ไม่สามารถบันทึกผลการพิจารณาได้')
    }
  }

  async function submitAppeal() {
    if (!selectedAppeal || busy) return
    const accepted = restorePoints
    const points = accepted ? restoredPoints : 0
    const error = validateAppealDecision({
      accepted,
      restoredPoints: points,
      maximumRestorablePoints,
      explanation: appealExplanation,
    })
    if (error) {
      setAppealError(error)
      return
    }
    if (accepted && points !== maximumRestorablePoints && !supportsPartialAppeal) {
      setAppealError('การคืนคะแนนบางส่วนต้องอัปเดตระบบหลังบ้านก่อน ขณะนี้คืนได้เต็มจำนวนเท่านั้น')
      return
    }
    setAppealError('')
    try {
      await onDecideAppeal(selectedAppeal.id, { accepted, restoredPoints: points, explanation: appealExplanation.trim() })
      setSelected(null)
    } catch (error) {
      setAppealError(error instanceof Error ? error.message : 'ไม่สามารถบันทึกผลอุทธรณ์ได้')
    }
  }

  async function submitReopenAppeal() {
    if (!reopenAppealId || busy) return
    if (reopenReason.trim().length < 5) {
      setReopenError('กรุณาระบุเหตุผลในการเปิดพิจารณาใหม่อย่างน้อย 5 ตัวอักษร')
      return
    }
    setReopenError('')
    try {
      await onReopenAppeal(reopenAppealId, reopenReason.trim())
      setReopenAppealId('')
      setReopenReason('')
    } catch (error) {
      setReopenError(error instanceof Error ? error.message : 'ไม่สามารถเปิดคำอุทธรณ์เพื่อพิจารณาใหม่ได้')
    }
  }

  return (
    <div className="admin-review-center">
      <section className="review-queue-shell" aria-labelledby="review-queue-title">
        <header className="review-queue-header">
          <div>
            <p className="eyebrow">รอการพิจารณา</p>
            <h2 id="review-queue-title">{pendingDeductions.length + pendingAdditions.length + openAppeals.length} งานที่ต้องตรวจ</h2>
          </div>
          <span className="review-total">{pendingDeductions.length + pendingAdditions.length + openAppeals.length}</span>
        </header>

        <div className="review-tabs" role="tablist" aria-label="ประเภทงานรอตรวจ">
          <button type="button" role="tab" aria-selected={tab === 'deduction'} className={tab === 'deduction' ? 'active' : ''} onClick={() => setTab('deduction')}>
            ขอตัดคะแนน <b>{pendingDeductions.length}</b>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'addition'} className={tab === 'addition' ? 'active' : ''} onClick={() => setTab('addition')}>
            ขอเพิ่มคะแนน <b>{pendingAdditions.length}</b>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'appeal'} className={tab === 'appeal' ? 'active appeal' : 'appeal'} onClick={() => setTab('appeal')}>
            คำอุทธรณ์ <b>{openAppeals.length}</b>
          </button>
        </div>

        <div className="review-toolbar">
          <label className="review-search">
            <span>ค้นหางาน</span>
            <input type="search" value={search} placeholder="ชื่อนักเรียน รหัส หรือหัวข้อ" onChange={(event) => setSearch(event.target.value)} />
          </label>
          <label className="review-sort">เรียงตาม
            <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
              <option value="oldest">เก่าสุดก่อน</option>
              <option value="newest">ใหม่สุดก่อน</option>
            </select>
          </label>
        </div>

        {visibleItems.length ? (
          <div className="review-queue-list" role="tabpanel">
            {tab === 'deduction' ? visibleItems.map((item) => {
              if (!('ruleTitle' in item)) return null
              const student = studentById.get(item.studentId)
              const teacher = teacherById.get(item.teacherId)
              return (
                <button type="button" key={item.id} onClick={() => openDeduction(item.id)}>
                  <span className="review-avatar appeal">{initials(student?.name)}</span>
                  <span className="review-row-copy">
                    <strong>{student?.name ?? 'ไม่พบข้อมูลนักเรียน'}</strong>
                    <small>{student?.classroomName ?? 'ไม่ระบุห้อง'} • {teacher?.name ?? 'ไม่พบชื่อครู'}</small>
                    <span>{item.ruleTitle}</span>
                  </span>
                  <span className="review-points negative">-{item.requestedPoints}</span>
                  <Icon name="chevronRight" size={18} />
                </button>
              )
            }) : tab === 'addition' ? visibleItems.map((item) => {
              if ('ruleTitle' in item) return null
              if (!('requestedPoints' in item)) return null
              const student = studentById.get(item.studentId)
              const teacher = teacherById.get(item.teacherId)
              return (
                <button type="button" key={item.id} onClick={() => openAddition(item.id)}>
                  <span className="review-avatar">{initials(student?.name)}</span>
                  <span className="review-row-copy">
                    <strong>{student?.name ?? 'ไม่พบข้อมูลนักเรียน'}</strong>
                    <small>{student?.classroomName ?? 'ไม่ระบุห้อง'} • {teacher?.name ?? 'ไม่พบชื่อครู'}</small>
                    <span>{item.positiveRuleTitle ?? (item.reason || 'ไม่ได้ระบุรายละเอียด')}</span>
                  </span>
                  <span className="review-points positive">+{item.requestedPoints}</span>
                  <Icon name="chevronRight" size={18} />
                </button>
              )
            }) : visibleItems.map((item) => {
              if ('ruleTitle' in item) return null
              if ('requestedPoints' in item) return null
              const student = studentById.get(item.studentId)
              const source = transactionById.get(item.transactionId)
              return (
                <button type="button" key={item.id} onClick={() => openAppeal(item.id)}>
                  <span className="review-avatar appeal">{initials(student?.name)}</span>
                  <span className="review-row-copy">
                    <strong>{student?.name ?? 'ไม่พบข้อมูลนักเรียน'}</strong>
                    <small>{student?.classroomName ?? 'ไม่ระบุห้อง'} • ยื่น {formatThaiDate(item.createdAt)}</small>
                    <span>{item.statement}</span>
                  </span>
                  <span className="review-points negative">-{Math.abs(source?.appliedDelta ?? 0)}</span>
                  <Icon name="chevronRight" size={18} />
                </button>
              )
            })}
          </div>
        ) : <EmptyState title={tab === 'deduction' ? 'ไม่มีคำขอตัดคะแนนค้างอยู่' : tab === 'addition' ? 'ไม่มีคำขอเพิ่มคะแนนค้างอยู่' : 'ไม่มีคำอุทธรณ์ค้างอยู่'} detail="งานใหม่จะปรากฏในคิวนี้โดยอัตโนมัติ" />}
      </section>

      {tab === 'appeal' && decidedAppeals.length ? (
        <section className="panel" aria-labelledby="decided-appeals-title">
          <div className="section-heading"><div><p className="eyebrow">ผลที่บันทึกแล้ว</p><h2 id="decided-appeals-title">ประวัติคำอุทธรณ์ล่าสุด</h2></div><span className="counter">{decidedAppeals.length}</span></div>
          <div className="record-list">{decidedAppeals.slice(0, 5).map((appeal) => {
            const student = studentById.get(appeal.studentId)
            return <article className="record-row detailed-record" key={appeal.id}><div><strong>{student?.name ?? 'ไม่พบข้อมูลนักเรียน'}</strong><span>{appeal.status === 'accepted' ? `คืน ${appeal.restoredPoints ?? 0} คะแนน` : 'ไม่คืนคะแนน'} • พิจารณาครั้งที่ {appeal.reviewVersion ?? 1}</span>{appeal.decisionNote ? <small>{appeal.decisionNote}</small> : null}</div><button type="button" className="button ghost compact" disabled={busy} onClick={() => { setReopenAppealId(appeal.id); setReopenReason(''); setReopenError('') }}>เปิดพิจารณาใหม่</button></article>
          })}</div>
        </section>
      ) : null}

      {reopenAppealId ? (
        <div className="phase2-dialog-backdrop">
          <section className="phase2-review-detail" role="dialog" aria-modal="true" aria-labelledby="reopen-appeal-title">
            <header className="phase2-detail-header"><button type="button" className="icon-back-button" aria-label="ยกเลิก" disabled={busy} onClick={() => setReopenAppealId('')}><Icon name="chevronRight" /></button><div><p>คำอุทธรณ์ที่ตัดสินแล้ว</p><h2 id="reopen-appeal-title">เปิดพิจารณาใหม่</h2></div></header>
            <div className="phase2-detail-body"><p className="form-help">ผลเดิมและรายการคะแนนเดิมจะไม่ถูกลบ ระบบจะเก็บเป็นประวัติอีกหนึ่งรุ่น</p><label className="phase2-note-field">เหตุผลที่เปิดใหม่ <b>จำเป็น</b><textarea value={reopenReason} minLength={5} maxLength={2000} disabled={busy} placeholder="เช่น ได้รับเอกสารหรือข้อเท็จจริงเพิ่มเติม" onChange={(event) => { setReopenReason(event.target.value); setReopenError('') }} /></label>{reopenError ? <p className="form-error" role="alert">{reopenError}</p> : null}</div>
            <footer className="phase2-decision-footer single-action"><button type="button" className="button primary" disabled={busy} onClick={() => void submitReopenAppeal()}>{busyAction === `appeal-reopen-${reopenAppealId}` ? 'กำลังเปิดใหม่…' : 'ยืนยันเปิดพิจารณาใหม่'}</button></footer>
          </section>
        </div>
      ) : null}

      {selectedDeduction ? (() => {
        const student = studentById.get(selectedDeduction.studentId)
        const teacher = teacherById.get(selectedDeduction.teacherId)
        const adjusted = deductionPoints !== selectedDeduction.requestedPoints
        const nextScore = applyScoreDelta(student?.score ?? 0, -deductionPoints).after
        const reasonRequired = additionDecisionNeedsReason(true, selectedDeduction.requestedPoints, deductionPoints)
        return (
          <div className="phase2-dialog-backdrop">
            <section className="phase2-review-detail" role="dialog" aria-modal="true" aria-labelledby="deduction-review-title">
              <header className="phase2-detail-header">
                <button type="button" className="icon-back-button" aria-label="กลับไปคิวงาน" disabled={busy} onClick={() => setSelected(null)}><Icon name="chevronRight" /></button>
                <div><p>คำขอตัดคะแนนตั้งแต่ 10 คะแนน</p><h2 id="deduction-review-title">ตรวจสอบก่อนให้มีผล</h2></div>
                <span className="badge status-pending">รอตรวจ</span>
              </header>
              <div className="phase2-detail-body">
                <section className="review-student-summary appeal">
                  <span className="review-avatar large appeal">{initials(student?.name)}</span>
                  <div><strong>{student?.name ?? 'ไม่พบข้อมูลนักเรียน'}</strong><span>{student?.studentCode} • {student?.classroomName}</span></div>
                  <b>{student?.score ?? 0}<small>คะแนนปัจจุบัน</small></b>
                </section>
                <dl className="review-meta-grid">
                  <div><dt>ผู้ส่งคำขอ</dt><dd>{teacher?.name ?? 'ไม่พบข้อมูลคุณครู'}</dd></div>
                  <div><dt>วันเกิดเหตุ</dt><dd>{formatThaiDate(selectedDeduction.occurredAt)}</dd></div>
                  <div><dt>เหตุการณ์</dt><dd>{selectedDeduction.ruleTitle}</dd></div>
                  <div><dt>รายละเอียด</dt><dd>{selectedDeduction.internalNote.trim() || 'ไม่ได้เขียนคำบรรยาย'}</dd></div>
                </dl>
                <section className="point-adjustment-card">
                  <div><span>คะแนนที่ครูขอตัด</span><strong>-{selectedDeduction.requestedPoints}</strong></div>
                  <div className="approved-point-control">
                    <label htmlFor="deduction-approved-points">คะแนนที่จะอนุมัติตัด</label>
                    <div>
                      <button type="button" aria-label="ลดคะแนนที่จะตัด" disabled={busy || deductionPoints <= 1} onClick={() => { setDeductionPoints((value) => Math.max(1, value - 1)); setDeductionError('') }}>−</button>
                      <input id="deduction-approved-points" type="number" min="1" max="100" value={deductionPoints} disabled={busy} onChange={(event) => { setDeductionPoints(Number(event.target.value)); setDeductionError('') }} />
                      <button type="button" aria-label="เพิ่มคะแนนที่จะตัด" disabled={busy || deductionPoints >= 100} onClick={() => { setDeductionPoints((value) => Math.min(100, value + 1)); setDeductionError('') }}>+</button>
                    </div>
                    <small>{adjusted ? `ปรับจากที่ขอ ${selectedDeduction.requestedPoints} คะแนน` : 'เท่ากับคะแนนที่ครูขอ'}</small>
                  </div>
                  <div className="score-result-preview"><span>คะแนนหลังอนุมัติ</span><strong>{student?.score ?? 0} <i>→</i> {nextScore}</strong></div>
                </section>
                {!supportsDeductionAdjustment ? <p className="capability-note"><Icon name="alert" size={18} /> ระบบจริงเวอร์ชันนี้ยังบันทึกคะแนนที่ปรับไม่ได้</p> : null}
                <label className="phase2-note-field">เหตุผลประกอบ {reasonRequired ? <b>จำเป็นเมื่อปรับคะแนน</b> : <small>ไม่บังคับเมื่ออนุมัติเท่าเดิม</small>}
                  <textarea value={deductionNote} disabled={busy} minLength={reasonRequired ? 5 : undefined} placeholder={reasonRequired ? 'อธิบายเหตุผลที่ปรับคะแนนให้ครูผู้ส่งคำขอเห็น' : 'เพิ่มบันทึกได้ หากต้องการ'} onChange={(event) => { setDeductionNote(event.target.value); setDeductionError('') }} />
                </label>
                {deductionError ? <p className="form-error" role="alert">{deductionError}</p> : null}
              </div>
              <footer className="phase2-decision-footer">
                <button type="button" className="button reject" disabled={busy} onClick={() => void submitDeduction(false)}>ปฏิเสธคำขอ</button>
                <button type="button" className="button approve" disabled={busy} onClick={() => void submitDeduction(true)}>{busyAction === `deduction-request-${selectedDeduction.id}` ? 'กำลังบันทึก…' : `อนุมัติตัด ${deductionPoints} คะแนน`}</button>
              </footer>
            </section>
          </div>
        )
      })() : null}

      {selectedAddition ? (() => {
        const student = studentById.get(selectedAddition.studentId)
        const teacher = teacherById.get(selectedAddition.teacherId)
        const adjusted = approvedPoints !== selectedAddition.requestedPoints
        const nextScore = applyScoreDelta(student?.score ?? 0, approvedPoints).after
        const reasonRequired = additionDecisionNeedsReason(true, selectedAddition.requestedPoints, approvedPoints)
        return (
          <div className="phase2-dialog-backdrop">
            <section className="phase2-review-detail" role="dialog" aria-modal="true" aria-labelledby="addition-review-title">
              <header className="phase2-detail-header">
                <button type="button" className="icon-back-button" aria-label="กลับไปคิวงาน" disabled={busy} onClick={() => setSelected(null)}><Icon name="chevronRight" /></button>
                <div><p>คำขอเพิ่มคะแนน</p><h2 id="addition-review-title">ตรวจสอบก่อนอนุมัติ</h2></div>
                <span className="badge status-pending">รอตรวจ</span>
              </header>
              <div className="phase2-detail-body">
                <section className="review-student-summary">
                  <span className="review-avatar large">{initials(student?.name)}</span>
                  <div><strong>{student?.name ?? 'ไม่พบข้อมูลนักเรียน'}</strong><span>{student?.studentCode} • {student?.classroomName}</span></div>
                  <b>{student?.score ?? 0}<small>คะแนนปัจจุบัน</small></b>
                </section>
                <dl className="review-meta-grid">
                  <div><dt>ผู้ส่งคำขอ</dt><dd>{teacher?.name ?? 'ไม่พบข้อมูลคุณครู'}</dd></div>
                  <div><dt>ส่งเมื่อ</dt><dd>{formatThaiDate(selectedAddition.createdAt)}</dd></div>
                  <div><dt>กิจกรรม/เหตุการณ์</dt><dd>{selectedAddition.positiveRuleTitle ?? 'พิมพ์เหตุการณ์ใหม่'}</dd></div>
                  <div><dt>รายละเอียด</dt><dd>{selectedAddition.reason.trim() || 'ไม่ได้เขียนคำบรรยาย'}</dd></div>
                </dl>
                <section className="review-evidence-block">
                  <h3>หลักฐานจากครู</h3>
                  <EvidenceSummary value={selectedAddition.evidenceNote} resolveFileUrl={resolveFileUrl} />
                  {!selectedAddition.evidenceNote?.trim() ? <p>ครูส่งคำขอนี้โดยไม่ได้แนบรูปหรือข้อความ ซึ่งระบบอนุญาตไว้</p> : null}
                </section>
                <section className="point-adjustment-card">
                  <div><span>คะแนนที่ครูขอ</span><strong>+{selectedAddition.requestedPoints}</strong></div>
                  <div className="approved-point-control">
                    <label htmlFor="approved-points">คะแนนที่จะอนุมัติ</label>
                    <div>
                      <button type="button" aria-label="ลดคะแนนที่อนุมัติ" disabled={busy || approvedPoints <= 1} onClick={() => { setApprovedPoints((value) => Math.max(1, value - 1)); setAdditionError('') }}>−</button>
                      <input id="approved-points" type="number" min="1" max="100" value={approvedPoints} disabled={busy} onChange={(event) => { setApprovedPoints(Number(event.target.value)); setAdditionError('') }} />
                      <button type="button" aria-label="เพิ่มคะแนนที่อนุมัติ" disabled={busy || approvedPoints >= 100} onClick={() => { setApprovedPoints((value) => Math.min(100, value + 1)); setAdditionError('') }}>+</button>
                    </div>
                    <small>{adjusted ? `ปรับจากที่ขอ ${selectedAddition.requestedPoints} คะแนน` : 'เท่ากับคะแนนที่ครูขอ'}</small>
                  </div>
                  <div className="score-result-preview"><span>คะแนนหลังอนุมัติ</span><strong>{student?.score ?? 0} <i>→</i> {nextScore}</strong></div>
                </section>
                {!supportsAdditionAdjustment ? <p className="capability-note"><Icon name="alert" size={18} /> ระบบจริงเวอร์ชันนี้ยังบันทึกคะแนนที่ปรับไม่ได้ แต่ทดลองโฟลว์เต็มได้ในโหมดสาธิต</p> : null}
                <label className="phase2-note-field">เหตุผลประกอบ {reasonRequired ? <b>จำเป็นเมื่อปรับคะแนน</b> : <small>ไม่บังคับเมื่ออนุมัติเท่าเดิม</small>}
                  <textarea value={additionNote} disabled={busy} minLength={reasonRequired ? 5 : undefined} placeholder={reasonRequired ? 'อธิบายเหตุผลที่ปรับคะแนนให้ครูผู้ส่งคำขอเห็น' : 'เพิ่มบันทึกได้ หากต้องการ'} onChange={(event) => { setAdditionNote(event.target.value); setAdditionError('') }} />
                </label>
                {additionError ? <p className="form-error" role="alert">{additionError}</p> : null}
              </div>
              <footer className="phase2-decision-footer">
                <button type="button" className="button reject" disabled={busy} onClick={() => void submitAddition(false)}>ปฏิเสธคำขอ</button>
                <button type="button" className="button approve" disabled={busy} onClick={() => void submitAddition(true)}>{busyAction === `request-${selectedAddition.id}` ? 'กำลังบันทึก…' : `อนุมัติ +${approvedPoints} คะแนน`}</button>
              </footer>
            </section>
          </div>
        )
      })() : null}

      {selectedAppeal ? (() => {
        const student = studentById.get(selectedAppeal.studentId)
        const nextScore = applyScoreDelta(student?.score ?? 0, restorePoints ? restoredPoints : 0).after
        return (
          <div className="phase2-dialog-backdrop">
            <section className="phase2-review-detail appeal-detail" role="dialog" aria-modal="true" aria-labelledby="appeal-review-title">
              <header className="phase2-detail-header">
                <button type="button" className="icon-back-button" aria-label="กลับไปคิวงาน" disabled={busy} onClick={() => setSelected(null)}><Icon name="chevronRight" /></button>
                <div><p>คำอุทธรณ์จากนักเรียน</p><h2 id="appeal-review-title">พิจารณาคืนคะแนน</h2></div>
                <span className="badge status-pending">รอตรวจ</span>
              </header>
              <div className="phase2-detail-body">
                <section className="review-student-summary appeal">
                  <span className="review-avatar large appeal">{initials(student?.name)}</span>
                  <div><strong>{student?.name ?? 'ไม่พบข้อมูลนักเรียน'}</strong><span>{student?.studentCode} • {student?.classroomName}</span></div>
                  <b>{student?.score ?? 0}<small>คะแนนปัจจุบัน</small></b>
                </section>
                <section className="appeal-source-card">
                  <div><span>รายการที่อุทธรณ์</span><strong>{selectedAppealSource?.reason ?? 'ไม่พบรายการต้นทาง'}</strong><small>{selectedAppealSource ? formatThaiDate(selectedAppealSource.occurredAt) : ''}</small></div>
                  <b>-{maximumRestorablePoints}</b>
                </section>
                <blockquote className="student-statement"><span>คำชี้แจงของนักเรียน</span>{selectedAppeal.statement}</blockquote>
                <fieldset className="appeal-choice">
                  <legend>ผลการพิจารณา</legend>
                  <label className={restorePoints ? 'selected' : ''}><input type="radio" name="appeal-result" checked={restorePoints} disabled={busy} onChange={() => { setRestorePoints(true); setAppealError('') }} /><span><strong>คืนคะแนน</strong><small>คืนเต็มจำนวนหรือกำหนดบางส่วน</small></span></label>
                  <label className={!restorePoints ? 'selected reject-choice' : 'reject-choice'}><input type="radio" name="appeal-result" checked={!restorePoints} disabled={busy} onChange={() => { setRestorePoints(false); setAppealError('') }} /><span><strong>ไม่คืนคะแนน</strong><small>คงรายการตัดคะแนนเดิมไว้</small></span></label>
                </fieldset>
                {restorePoints ? (
                  <section className="appeal-point-control">
                    <label htmlFor="restored-points">จำนวนคะแนนที่จะคืน</label>
                    <div><button type="button" aria-label="ลดคะแนนที่จะคืน" disabled={busy || restoredPoints <= 1} onClick={() => setRestoredPoints((value) => Math.max(1, value - 1))}>−</button><input id="restored-points" type="number" min="1" max={maximumRestorablePoints} value={restoredPoints} disabled={busy} onChange={(event) => { setRestoredPoints(Number(event.target.value)); setAppealError('') }} /><button type="button" aria-label="เพิ่มคะแนนที่จะคืน" disabled={busy || restoredPoints >= maximumRestorablePoints} onClick={() => setRestoredPoints((value) => Math.min(maximumRestorablePoints, value + 1))}>+</button></div>
                    <small>คืนได้สูงสุด {maximumRestorablePoints} คะแนน</small>
                  </section>
                ) : null}
                {!supportsPartialAppeal ? <p className="capability-note"><Icon name="alert" size={18} /> ระบบจริงเวอร์ชันนี้ยังบันทึกการคืนบางส่วนไม่ได้ แต่ทดลองโฟลว์เต็มได้ในโหมดสาธิต</p> : null}
                <label className="phase2-note-field">คำชี้แจงให้นักเรียนเห็น <b>จำเป็น</b>
                  <textarea value={appealExplanation} minLength={5} required disabled={busy} placeholder="อธิบายผลการพิจารณาด้วยภาษาที่นักเรียนเข้าใจได้" onChange={(event) => { setAppealExplanation(event.target.value); setAppealError('') }} />
                </label>
                <p className="privacy-note"><Icon name="shield" size={18} /> นักเรียนจะเห็นผู้ตอบว่า “ฝ่ายปกครอง” และจะไม่เห็นชื่อแอดมินผู้พิจารณา</p>
                <div className="score-result-preview"><span>คะแนนหลังบันทึกผล</span><strong>{student?.score ?? 0} <i>→</i> {nextScore}</strong></div>
                {appealError ? <p className="form-error" role="alert">{appealError}</p> : null}
              </div>
              <footer className="phase2-decision-footer single-action">
                <button type="button" className={restorePoints ? 'button approve' : 'button reject'} disabled={busy} onClick={() => void submitAppeal()}>{busyAction === `appeal-${selectedAppeal.id}` ? 'กำลังบันทึก…' : restorePoints ? `ยืนยันคืน ${restoredPoints} คะแนน` : 'ยืนยันไม่คืนคะแนน'}</button>
              </footer>
            </section>
          </div>
        )
      })() : null}
    </div>
  )
}
