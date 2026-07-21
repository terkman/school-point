import { useState, type FormEvent } from 'react'
import {
  applyScoreDelta,
  createId,
  formatThaiDate,
  type Account,
  type DemoState,
} from './domain'
import type { AppDataActions } from './dataActions'
import { AppShell, EmptyState, Icon, StatusBadge, type NavItem } from './ui'

type AdminTab = 'overview' | 'approvals' | 'cases' | 'manage'

interface AdminDashboardProps {
  account: Account
  state: DemoState
  onChange: (next: DemoState) => void
  actions?: AppDataActions
  onResetDemo?: () => void
  onLogout: () => void
}

export function AdminDashboard({ account, state, onChange, actions, onResetDemo, onLogout }: AdminDashboardProps) {
  const pending = state.additionRequests.filter((item) => item.status === 'pending')
  const openCases = state.seriousCases.filter((item) => item.status !== 'resolved')
  const openAppeals = state.appeals.filter((item) => item.status === 'submitted' || item.status === 'reviewing')
  const [tab, setTab] = useState<AdminTab>('overview')
  const [studentId, setStudentId] = useState(state.students[0]?.id ?? '')
  const [points, setPoints] = useState(3)
  const [reason, setReason] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const navItems: NavItem<AdminTab>[] = [
    { id: 'overview', label: 'แดชบอร์ด', icon: 'home' },
    { id: 'approvals', label: 'ศูนย์อนุมัติ', icon: 'approval', count: pending.length },
    { id: 'cases', label: 'คิวกรณีร้ายแรง', icon: 'alert', count: openCases.length },
    { id: 'manage', label: 'จัดการระบบ', icon: 'settings' },
  ]

  async function approveRequest(requestId: string) {
    const request = state.additionRequests.find((item) => item.id === requestId)
    const student = state.students.find((item) => item.id === request?.studentId)
    if (!request || !student || request.status !== 'pending') return
    if (actions) {
      setBusyAction(`request-${requestId}`)
      try {
        await actions.reviewPointAddition({ requestId, approve: true, note: 'อนุมัติโดยผู้ดูแลระบบ' })
        setAnnouncement(`อนุมัติคำขอเพิ่มคะแนนของ ${student.name} แล้ว`)
      } catch (error) {
        setAnnouncement(error instanceof Error ? error.message : 'ไม่สามารถอนุมัติคำขอได้')
      } finally {
        setBusyAction('')
      }
      return
    }
    const change = applyScoreDelta(student.score, request.requestedPoints)
    onChange({
      ...state,
      students: state.students.map((item) => item.id === student.id ? { ...item, score: change.after } : item),
      additionRequests: state.additionRequests.map((item) => item.id === requestId ? { ...item, status: 'approved', decidedAt: new Date().toISOString(), decisionNote: 'อนุมัติโดยผู้ดูแลระบบ' } : item),
      transactions: [{
        id: createId('tx'),
        studentId: student.id,
        termId: state.term.id,
        kind: 'addition',
        requestedDelta: change.requestedDelta,
        appliedDelta: change.appliedDelta,
        scoreBefore: change.before,
        scoreAfter: change.after,
        reason: request.reason,
        occurredAt: new Date().toISOString(),
        actorId: account.id,
        sourceRequestId: request.id,
      }, ...state.transactions],
    })
    setAnnouncement(`อนุมัติคำขอแล้ว คะแนนของ ${student.name} เปลี่ยนจาก ${change.before} เป็น ${change.after}`)
  }

  async function rejectRequest(requestId: string) {
    const request = state.additionRequests.find((item) => item.id === requestId)
    if (!request || request.status !== 'pending') return
    if (actions) {
      setBusyAction(`request-${requestId}`)
      try {
        await actions.reviewPointAddition({ requestId, approve: false, note: 'ข้อมูลประกอบยังไม่ครบถ้วน' })
        setAnnouncement('ปฏิเสธคำขอแล้ว คะแนนนักเรียนไม่เปลี่ยนแปลง')
      } catch (error) {
        setAnnouncement(error instanceof Error ? error.message : 'ไม่สามารถปฏิเสธคำขอได้')
      } finally {
        setBusyAction('')
      }
      return
    }
    onChange({
      ...state,
      additionRequests: state.additionRequests.map((item) => item.id === requestId ? { ...item, status: 'rejected', decidedAt: new Date().toISOString(), decisionNote: 'ข้อมูลประกอบยังไม่ครบถ้วน (โหมดสาธิต)' } : item),
    })
    setAnnouncement('ปฏิเสธคำขอแล้ว คะแนนนักเรียนไม่เปลี่ยนแปลง')
  }

  async function decideAppeal(appealId: string, accepted: boolean) {
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

  async function addPointsDirectly(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const student = state.students.find((item) => item.id === studentId)
    if (!student || points < 1 || !reason.trim()) return
    if (actions) {
      setBusyAction('admin-add')
      try {
        await actions.adminAddPoints({ studentId: student.id, points, reason: reason.trim(), termId: state.term.id })
        setReason('')
        setAnnouncement(`เพิ่มคะแนนให้ ${student.name} และบันทึกประวัติเรียบร้อยแล้ว`)
      } catch (error) {
        setAnnouncement(error instanceof Error ? error.message : 'ไม่สามารถเพิ่มคะแนนได้')
      } finally {
        setBusyAction('')
      }
      return
    }
    const change = applyScoreDelta(student.score, points)
    onChange({
      ...state,
      students: state.students.map((item) => item.id === student.id ? { ...item, score: change.after } : item),
      transactions: [{
        id: createId('tx'),
        studentId: student.id,
        termId: state.term.id,
        kind: 'addition',
        requestedDelta: change.requestedDelta,
        appliedDelta: change.appliedDelta,
        scoreBefore: change.before,
        scoreAfter: change.after,
        reason: reason.trim(),
        occurredAt: new Date().toISOString(),
        actorId: account.id,
      }, ...state.transactions],
    })
    setReason('')
    setAnnouncement(`เพิ่มคะแนน ${student.name} จาก ${change.before} เป็น ${change.after} เรียบร้อยแล้ว`)
  }

  async function resetTermScores() {
    if (state.term.resetCompletedAt) return
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
              {pending.length ? <div className="record-list">{pending.slice(0, 4).map((request) => { const student = state.students.find((item) => item.id === request.studentId); const requestBusy = busyAction === `request-${request.id}`; return <article className="approval-row" key={request.id}><div><strong>{student?.name}</strong><span>{request.reason}</span><small>{formatThaiDate(request.createdAt)} • ขอเพิ่ม {request.requestedPoints} คะแนน</small></div><div className="inline-actions"><button className="icon-button approve" disabled={requestBusy} aria-label={`อนุมัติ ${student?.name}`} onClick={() => approveRequest(request.id)}><Icon name="check" /></button><button className="icon-button reject" disabled={requestBusy} aria-label={`ปฏิเสธ ${student?.name}`} onClick={() => rejectRequest(request.id)}>×</button></div></article> })}</div> : <EmptyState title="ไม่มีคำขอรออนุมัติ" detail="คำขอใหม่จากคุณครูจะแสดงที่นี่" />}
            </section>
            <section className="panel"><div className="section-heading"><div><p className="eyebrow">ความปลอดภัย</p><h2>คิวติดตาม</h2></div><span className="counter danger">{openCases.length}</span></div>
              {openCases.length ? <div className="mini-case-list">{openCases.slice(0, 3).map((item) => { const student = state.students.find((entry) => entry.id === item.studentId); return <article key={item.id}><StatusBadge severity={item.severity} /><strong>{student?.name}</strong><span>{item.guardianContactStatus === 'pending' ? 'รอติดต่อผู้ปกครอง' : 'กำลังติดตาม'}</span></article> })}</div> : <EmptyState title="ไม่มีเคสค้าง" detail="กรณีร้ายแรงจะปรากฏที่นี่" />}
            </section>
          </div>
        </>
      ) : null}

      {tab === 'approvals' ? (
        <div className="approval-stack">
          <section className="panel"><div className="section-heading"><div><p className="eyebrow">ตรวจสอบก่อนดำเนินการ</p><h2>คำขอเพิ่มคะแนนจากคุณครู</h2></div><span className="counter">{pending.length}</span></div>
            {state.additionRequests.length ? <div className="table-wrap"><table><thead><tr><th>วันที่</th><th>นักเรียน</th><th>เหตุผล</th><th>คะแนน</th><th>สถานะ / จัดการ</th></tr></thead><tbody>{state.additionRequests.map((request) => { const student = state.students.find((item) => item.id === request.studentId); const requestBusy = busyAction === `request-${request.id}`; return <tr key={request.id}><td>{formatThaiDate(request.createdAt)}</td><td><strong>{student?.name}</strong><small>{student?.studentCode} • ปัจจุบัน {student?.score}</small></td><td>{request.reason}</td><td><span className="delta positive">+{request.requestedPoints}</span></td><td>{request.status === 'pending' ? <div className="inline-actions"><button className="button approve compact" disabled={requestBusy} onClick={() => approveRequest(request.id)}>อนุมัติ</button><button className="button reject compact" disabled={requestBusy} onClick={() => rejectRequest(request.id)}>ปฏิเสธ</button></div> : <span className={`badge status-${request.status}`}>{request.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}</span>}</td></tr> })}</tbody></table></div> : <EmptyState title="ยังไม่มีคำขอ" detail="เมื่อครูขอเพิ่มคะแนน รายการจะปรากฏที่นี่" />}
          </section>
          <section className="panel"><div className="section-heading"><div><p className="eyebrow">ไม่แก้รายการเดิม</p><h2>คำอุทธรณ์จากนักเรียน</h2></div><span className="counter">{openAppeals.length}</span></div>
            {state.appeals.length ? <div className="record-list">{state.appeals.map((appeal) => { const student = state.students.find((item) => item.id === appeal.studentId); const source = state.transactions.find((item) => item.id === appeal.transactionId); const appealBusy = busyAction === `appeal-${appeal.id}`; return <article className="appeal-review-row" key={appeal.id}><div><strong>{student?.name} • {Math.abs(source?.appliedDelta ?? 0)} คะแนน</strong><span>{appeal.statement}</span><small>ยื่นเมื่อ {formatThaiDate(appeal.createdAt)}</small></div>{appeal.status === 'submitted' || appeal.status === 'reviewing' ? <div className="inline-actions"><button className="button approve compact" disabled={appealBusy} onClick={() => decideAppeal(appeal.id, true)}>คืนคะแนน</button><button className="button reject compact" disabled={appealBusy} onClick={() => decideAppeal(appeal.id, false)}>ปฏิเสธ</button></div> : <span className={`badge status-${appeal.status === 'accepted' ? 'approved' : 'rejected'}`}>{appeal.status === 'accepted' ? 'คืนคะแนนแล้ว' : 'ไม่อนุมัติ'}</span>}</article> })}</div> : <EmptyState title="ยังไม่มีคำอุทธรณ์" detail="คำอุทธรณ์ที่นักเรียนยื่นภายใน 7 วันจะแสดงที่นี่" />}
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
          <form className="panel stack-form" onSubmit={addPointsDirectly}><div className="section-heading"><div><p className="eyebrow">สิทธิ์ผู้ดูแลระบบ</p><h2>เพิ่มคะแนนโดยตรง</h2></div></div>
            <label>นักเรียน<select value={studentId} onChange={(event) => setStudentId(event.target.value)}>{state.students.map((student) => <option key={student.id} value={student.id}>{student.studentCode} • {student.name} ({student.score}/100)</option>)}</select></label>
            <label>จำนวนคะแนน<input type="number" min="1" max="100" value={points} onChange={(event) => setPoints(Number(event.target.value))} /></label>
            <label>เหตุผล<textarea value={reason} onChange={(event) => setReason(event.target.value)} required minLength={5} placeholder="เหตุผลจะถูกเก็บในประวัติตรวจสอบ" /></label>
            <button className="button primary" type="submit" disabled={busyAction === 'admin-add'}>{busyAction === 'admin-add' ? 'กำลังบันทึก…' : 'เพิ่มคะแนนและบันทึกประวัติ'}</button>
          </form>
          <section className="panel"><div className="section-heading"><div><p className="eyebrow">ภาคเรียน</p><h2>เริ่มคะแนนที่ 100</h2></div></div><p>รายการคะแนนเดิมยังคงอยู่ เคสติดตามที่ไม่เสร็จจะยกไปต่อโดยไม่ยกคะแนนติดลบ</p><div className="reset-preview"><span>นักเรียนที่จะรีเซ็ต <strong>{state.students.length}</strong></span><span>เคสที่จะคงไว้ <strong>{openCases.length}</strong></span></div><button className="button warning full" disabled={Boolean(state.term.resetCompletedAt) || busyAction === 'initialize-term'} onClick={resetTermScores}>{busyAction === 'initialize-term' ? 'กำลังเตรียมคะแนน…' : state.term.resetCompletedAt ? `รีเซ็ตแล้ว ${formatThaiDate(state.term.resetCompletedAt)}` : 'ตรวจสอบและรีเซ็ตคะแนน'}</button></section>
          <section className="panel rules-panel"><div className="section-heading"><div><p className="eyebrow">ระเบียบตัวอย่าง</p><h2>เกณฑ์การตัดคะแนน</h2></div><span className="counter">{state.rules.length}</span></div><div className="rule-list">{state.rules.map((rule) => <div key={rule.id}><span><strong>{rule.title}</strong><small>{rule.category}</small></span><StatusBadge severity={rule.severity} /><b>−{rule.points}</b></div>)}</div></section>
          {onResetDemo ? <section className="panel danger-zone"><div className="section-heading"><div><p className="eyebrow">สำหรับการทดสอบ</p><h2>คืนค่าข้อมูลสาธิต</h2></div></div><p>ล้างเฉพาะข้อมูลสมมติในเบราว์เซอร์นี้ ไม่มีผลต่อฐานข้อมูลจริง</p><button className="button reject" onClick={onResetDemo}>คืนค่าข้อมูลตัวอย่าง</button></section> : null}
        </div>
      ) : null}
    </AppShell>
  )
}
