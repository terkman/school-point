import { useState } from 'react'
import type { AppDataActions } from './dataActions'
import { formatThaiDate, type Account, type DemoState } from './domain'
import { SchoolDirectoryPanel } from './SchoolDirectoryPanel'
import { AppShell, EmptyState, Icon, StatusBadge, type NavItem } from './ui'

type DirectorTab = 'overview' | 'directory' | 'activity'

export function DirectorDashboard({
  account,
  state,
  actions,
  onLogout,
}: {
  account: Account
  state: DemoState
  actions?: AppDataActions
  onLogout: () => void
}) {
  const [tab, setTab] = useState<DirectorTab>('overview')
  const pendingAdditions = state.additionRequests.filter((item) => item.status === 'pending')
  const pendingAppeals = state.appeals.filter((item) => item.status === 'submitted' || item.status === 'reviewing')
  const openCases = state.seriousCases.filter((item) => item.status !== 'resolved')
  const items: NavItem<DirectorTab>[] = [
    { id: 'overview', label: 'ภาพรวมโรงเรียน', icon: 'home' },
    { id: 'directory', label: 'รายชื่อทั้งหมด', icon: 'users' },
    { id: 'activity', label: 'ประวัติคะแนน', icon: 'history' },
  ]

  return (
    <AppShell account={account} state={state} items={items} active={tab} onNavigate={setTab} onLogout={onLogout}>
      {tab === 'overview' ? (
        <>
          <section className="page-heading">
            <div><p className="eyebrow">มุมมองผู้อำนวยการ</p><h1>ภาพรวมระบบโรงเรียน</h1><p>ดูข้อมูลทั้งหมดได้โดยไม่มีสิทธิ์แก้ไขรายชื่อ สิทธิ์ผู้ใช้ หรือการตั้งค่าระบบ</p></div>
            <span className="badge status-approved"><Icon name="eye" size={15} /> อ่านอย่างเดียว</span>
          </section>
          <section className="metric-grid">
            <div><span><Icon name="users" /></span><div><strong>{state.students.length}</strong><small>นักเรียนในภาคเรียนปัจจุบัน</small></div></div>
            <div><span><Icon name="approval" /></span><div><strong>{pendingAdditions.length}</strong><small>คำขอเพิ่มคะแนนรอพิจารณา</small></div></div>
            <div><span><Icon name="history" /></span><div><strong>{pendingAppeals.length}</strong><small>คำอุทธรณ์รอพิจารณา</small></div></div>
            <div><span className="danger"><Icon name="alert" /></span><div><strong>{openCases.length}</strong><small>กรณีร้ายแรงที่กำลังติดตาม</small></div></div>
          </section>
          <div className="two-column wide-left">
            <section className="panel">
              <div className="section-heading"><div><p className="eyebrow">ล่าสุด</p><h2>รายการคะแนนที่บันทึก</h2></div><button className="text-button" type="button" onClick={() => setTab('activity')}>ดูทั้งหมด</button></div>
              {state.transactions.length ? <div className="record-list">{state.transactions.slice(0, 8).map((transaction) => {
                const student = state.students.find((item) => item.id === transaction.studentId)
                return <article className="record-row" key={transaction.id}><div><strong>{student?.name ?? 'ไม่พบข้อมูลนักเรียน'}</strong><span>{transaction.reason}</span><small>{formatThaiDate(transaction.occurredAt)} • {transaction.scoreBefore} → {transaction.scoreAfter}</small></div><span className={`badge ${transaction.appliedDelta < 0 ? 'status-rejected' : 'status-approved'}`}>{transaction.appliedDelta > 0 ? '+' : ''}{transaction.appliedDelta}</span></article>
              })}</div> : <EmptyState title="ยังไม่มีรายการคะแนน" detail="รายการเพิ่มและตัดคะแนนจะปรากฏที่นี่" />}
            </section>
            <section className="panel">
              <div className="section-heading"><div><p className="eyebrow">ต้องติดตาม</p><h2>กรณีร้ายแรง</h2></div><span className="counter danger">{openCases.length}</span></div>
              {openCases.length ? <div className="mini-case-list">{openCases.slice(0, 6).map((item) => {
                const student = state.students.find((entry) => entry.id === item.studentId)
                return <article key={item.id}><StatusBadge severity={item.severity} /><strong>{student?.name ?? 'ไม่พบข้อมูลนักเรียน'}</strong><span>{item.guardianContactStatus === 'pending' ? 'รอติดต่อผู้ปกครอง' : 'กำลังติดตาม'}</span></article>
              })}</div> : <EmptyState title="ไม่มีเคสค้าง" detail="ยังไม่มีกรณีร้ายแรงที่ต้องติดตาม" />}
            </section>
          </div>
        </>
      ) : null}

      {tab === 'directory' ? <SchoolDirectoryPanel actions={actions} readOnly /> : null}

      {tab === 'activity' ? (
        <section className="panel">
          <div className="section-heading"><div><p className="eyebrow">อ่านอย่างเดียว</p><h2>ประวัติคะแนนทั้งหมด</h2></div><span className="counter">{state.transactions.length}</span></div>
          {state.transactions.length ? <div className="record-list">{state.transactions.map((transaction) => {
            const student = state.students.find((item) => item.id === transaction.studentId)
            return <article className="record-row detailed-record" key={transaction.id}><div><strong>{student?.name ?? 'ไม่พบข้อมูลนักเรียน'} • {transaction.appliedDelta > 0 ? '+' : ''}{transaction.appliedDelta} คะแนน</strong><span>{transaction.reason}</span><small>{formatThaiDate(transaction.occurredAt)} • คะแนน {transaction.scoreBefore} → {transaction.scoreAfter}</small></div><span className={`badge ${transaction.appliedDelta < 0 ? 'status-rejected' : 'status-approved'}`}>{transaction.kind === 'deduction' ? 'ตัดคะแนน' : transaction.kind === 'addition' ? 'เพิ่มคะแนน' : 'เปิดภาคเรียน'}</span></article>
          })}</div> : <EmptyState title="ยังไม่มีประวัติ" detail="ข้อมูลคะแนนจะปรากฏเมื่อมีการบันทึก" />}
        </section>
      ) : null}
    </AppShell>
  )
}
