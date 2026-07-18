import { useMemo, useState, type FormEvent } from 'react'
import {
  applyScoreDelta,
  createId,
  formatThaiDate,
  type Account,
  type BehaviorRule,
  type DemoState,
  type Student,
} from './domain'
import { AppShell, EmptyState, Icon, StatusBadge, type NavItem } from './ui'

type TeacherTab = 'overview' | 'deduct' | 'request' | 'cases'

interface TeacherDashboardProps {
  account: Account
  state: DemoState
  onChange: (next: DemoState) => void
  onLogout: () => void
}

function StudentPicker({
  students,
  selectedId,
  onSelect,
}: {
  students: Student[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const visible = students.filter((student) => `${student.studentCode} ${student.name}`.toLowerCase().includes(query.toLowerCase()))
  return (
    <div className="picker-panel">
      <label className="search-label"><span className="sr-only">ค้นหานักเรียน</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อหรือรหัสนักเรียน" /></label>
      <div className="picker-list" role="listbox" aria-label="รายชื่อนักเรียน">
        {visible.map((student) => (
          <button
            type="button"
            key={student.id}
            className={student.id === selectedId ? 'picker-row selected' : 'picker-row'}
            onClick={() => onSelect(student.id)}
            role="option"
            aria-selected={student.id === selectedId}
          >
            <span className="student-avatar">{student.name.slice(-2)}</span>
            <span><strong>{student.name}</strong><small>{student.studentCode} • {student.classroomName}</small></span>
            <b>{student.score}</b>
          </button>
        ))}
      </div>
    </div>
  )
}

function RuleOption({ rule, selected, onSelect }: { rule: BehaviorRule; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={selected ? 'rule-option selected' : 'rule-option'} onClick={onSelect}>
      <span><strong>{rule.title}</strong><small>{rule.category}</small></span>
      <span className="rule-points">−{rule.points}</span>
    </button>
  )
}

export function TeacherDashboard({ account, state, onChange, onLogout }: TeacherDashboardProps) {
  const [tab, setTab] = useState<TeacherTab>('overview')
  const teacher = state.teachers.find((item) => item.id === account.teacherId)
  const assignedStudents = useMemo(
    () => state.students.filter((student) => teacher?.classroomIds.includes(student.classroomId)),
    [state.students, teacher?.classroomIds],
  )
  const [studentId, setStudentId] = useState(assignedStudents[0]?.id ?? '')
  const [ruleId, setRuleId] = useState(state.rules.find((rule) => rule.active)?.id ?? '')
  const [reason, setReason] = useState('')
  const [requestPoints, setRequestPoints] = useState(3)
  const [requestReason, setRequestReason] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const selectedStudent = assignedStudents.find((item) => item.id === studentId)
  const selectedRule = state.rules.find((item) => item.id === ruleId)
  const preview = selectedStudent && selectedRule ? applyScoreDelta(selectedStudent.score, -selectedRule.points) : null
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

  function recordDeduction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedStudent || !selectedRule || !reason.trim()) return
    if (!currentTeacher.classroomIds.includes(selectedStudent.classroomId)) {
      setAnnouncement('ไม่สามารถบันทึกนักเรียนที่อยู่นอกห้องรับผิดชอบ')
      return
    }
    const change = applyScoreDelta(selectedStudent.score, -selectedRule.points)
    const transactionId = createId('tx')
    const occurredAt = new Date().toISOString()
    const next: DemoState = {
      ...state,
      students: state.students.map((student) => student.id === selectedStudent.id ? { ...student, score: change.after } : student),
      transactions: [
        {
          id: transactionId,
          studentId: selectedStudent.id,
          termId: state.term.id,
          kind: 'deduction',
          requestedDelta: change.requestedDelta,
          appliedDelta: change.appliedDelta,
          scoreBefore: change.before,
          scoreAfter: change.after,
          ruleId: selectedRule.id,
          reason: reason.trim(),
          occurredAt,
          actorId: account.id,
        },
        ...state.transactions,
      ],
      seriousCases: selectedRule.severity === 'serious' || selectedRule.severity === 'critical'
        ? [{
          id: createId('case'),
          transactionId,
          studentId: selectedStudent.id,
          severity: selectedRule.severity,
          status: 'open',
          guardianContactRequired: selectedRule.guardianContactRequired,
          guardianContactStatus: selectedRule.guardianContactRequired ? 'pending' : 'not_required',
          createdAt: occurredAt,
          internalNote: `ติดตามเหตุการณ์: ${reason.trim()}`,
        }, ...state.seriousCases]
        : state.seriousCases,
    }
    onChange(next)
    setReason('')
    setAnnouncement(`บันทึกตัดคะแนน ${selectedStudent.name} จาก ${change.before} เหลือ ${change.after} เรียบร้อยแล้ว`)
  }

  function submitAdditionRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedStudent || requestPoints < 1 || !requestReason.trim()) return
    onChange({
      ...state,
      additionRequests: [{
        id: createId('request'),
        studentId: selectedStudent.id,
        teacherId: currentTeacher.id,
        requestedPoints: requestPoints,
        reason: requestReason.trim(),
        status: 'pending',
        createdAt: new Date().toISOString(),
      }, ...state.additionRequests],
    })
    setRequestReason('')
    setAnnouncement('ส่งคำขอเพิ่มคะแนนแล้ว คะแนนยังไม่เปลี่ยนจนกว่าผู้ดูแลระบบจะอนุมัติ')
  }

  return (
    <AppShell account={account} state={state} items={navItems} active={tab} onNavigate={setTab} onLogout={onLogout}>
      <div className="page-heading">
        <div><p className="eyebrow">พื้นที่ของคุณครู</p><h1>{tab === 'overview' ? 'ห้องที่รับผิดชอบ' : tab === 'deduct' ? 'บันทึกการตัดคะแนน' : tab === 'request' ? 'ขอเพิ่มคะแนน' : 'กรณีติดตาม'}</h1></div>
        <span className="class-chip">{assignedStudents[0]?.classroomName ?? 'ยังไม่มอบหมายห้อง'} • {assignedStudents.length} คน</span>
      </div>
      <div className="announcement" aria-live="polite">{announcement}</div>

      {tab === 'overview' ? (
        <section className="panel">
          <div className="section-heading"><div><p className="eyebrow">ภาคเรียนปัจจุบัน</p><h2>รายชื่อนักเรียนที่ดูแล</h2></div><button className="button primary compact" onClick={() => setTab('deduct')}><Icon name="plus" size={17} /> บันทึกตัดคะแนน</button></div>
          <div className="table-wrap"><table><thead><tr><th>รหัส</th><th>นักเรียน</th><th>ห้อง</th><th>คะแนนปัจจุบัน</th><th>ดำเนินการ</th></tr></thead><tbody>
            {assignedStudents.map((student) => <tr key={student.id}><td>{student.studentCode}</td><td><strong>{student.name}</strong></td><td>{student.classroomName}</td><td><span className={`score-text ${student.score < 60 ? 'danger' : ''}`}>{student.score}</span> / 100</td><td><button className="text-button" onClick={() => { setStudentId(student.id); setTab('deduct') }}>เลือกบันทึก</button></td></tr>)}
          </tbody></table></div>
          <p className="scope-note"><Icon name="shield" size={18} /> ระบบแสดงและอนุญาตให้ดำเนินการเฉพาะห้องที่ได้รับมอบหมายเท่านั้น</p>
        </section>
      ) : null}

      {tab === 'deduct' ? (
        <div className="workspace-grid">
          <StudentPicker students={assignedStudents} selectedId={studentId} onSelect={setStudentId} />
          <form className="panel action-form" onSubmit={recordDeduction}>
            <div className="selected-student-bar"><div><span className="student-avatar large">{selectedStudent?.name.slice(-2)}</span><div><strong>{selectedStudent?.name}</strong><small>{selectedStudent?.studentCode} • {selectedStudent?.classroomName}</small></div></div><div><span>คะแนนปัจจุบัน</span><b>{selectedStudent?.score}</b></div></div>
            <fieldset><legend>เลือกระเบียบ / ประเภทการกระทำ</legend><div className="rule-grid">{state.rules.filter((rule) => rule.active).map((rule) => <RuleOption key={rule.id} rule={rule} selected={rule.id === ruleId} onSelect={() => setRuleId(rule.id)} />)}</div></fieldset>
            {selectedRule ? <div className="rule-summary"><div><StatusBadge severity={selectedRule.severity} /> <span>{selectedRule.category}</span></div><strong>{preview?.before} <span>→</span> {preview?.after}</strong></div> : null}
            <label>รายละเอียดเหตุการณ์<textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="ระบุข้อเท็จจริง วันเวลา หรือบริบทที่จำเป็น" minLength={5} required /></label>
            {selectedRule?.guardianContactRequired ? <div className="warning-note"><Icon name="alert" /><span>ระเบียบนี้เป็นกรณีร้ายแรง ระบบจะเปิดเคสติดตามและงานติดต่อผู้ปกครองโดยอัตโนมัติ</span></div> : null}
            <div className="form-actions"><button type="button" className="button secondary" onClick={() => setReason('')}>ล้างข้อมูล</button><button type="submit" className="button primary">ยืนยันตัด {selectedRule?.points ?? 0} คะแนน</button></div>
          </form>
        </div>
      ) : null}

      {tab === 'request' ? (
        <div className="two-column wide-left">
          <form className="panel stack-form" onSubmit={submitAdditionRequest}>
            <div className="section-heading"><div><p className="eyebrow">ต้องรออนุมัติ</p><h2>สร้างคำขอเพิ่มคะแนน</h2></div></div>
            <label>นักเรียน<select value={studentId} onChange={(event) => setStudentId(event.target.value)}>{assignedStudents.map((student) => <option key={student.id} value={student.id}>{student.studentCode} • {student.name} ({student.score}/100)</option>)}</select></label>
            <label>จำนวนคะแนนที่ขอ<input type="number" min="1" max={Math.max(1, 100 - (selectedStudent?.score ?? 100))} value={requestPoints} onChange={(event) => setRequestPoints(Number(event.target.value))} /></label>
            <label>เหตุผลและงานที่นักเรียนทำ<textarea value={requestReason} onChange={(event) => setRequestReason(event.target.value)} required minLength={10} placeholder="ระบุงานปรับพฤติกรรมหรือหลักฐานประกอบ" /></label>
            <button className="button primary" type="submit">ส่งให้ผู้ดูแลระบบอนุมัติ</button>
          </form>
          <section className="panel"><div className="section-heading"><div><p className="eyebrow">ประวัติคำขอ</p><h2>สถานะการอนุมัติ</h2></div><span className="counter">{teacherRequests.length}</span></div>
            {teacherRequests.length ? <div className="record-list">{teacherRequests.map((request) => { const student = state.students.find((item) => item.id === request.studentId); return <article className="record-row" key={request.id}><div><strong>{student?.name} • +{request.requestedPoints}</strong><span>{request.reason}</span><small>{formatThaiDate(request.createdAt)}</small></div><span className={`badge status-${request.status}`}>{request.status === 'pending' ? 'รออนุมัติ' : request.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}</span></article> })}</div> : <EmptyState title="ยังไม่มีคำขอ" detail="คำขอเพิ่มคะแนนที่ส่งแล้วจะแสดงที่นี่" />}
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
