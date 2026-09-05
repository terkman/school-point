import type { DemoState } from './domain'
import { formatThaiDate, studentDisplayName } from './domain'
import { EmptyState, Icon } from './ui'
import { StudentAvatar } from './ProfileAvatar'

interface AdminTodayProps {
  state: DemoState
  pendingDeductions: DemoState['deductionRequests']
  pendingAdditions: DemoState['additionRequests']
  openAppeals: DemoState['appeals']
  openCases: DemoState['seriousCases']
  onOpenScore: () => void
  onOpenReviews: () => void
  onOpenCases: () => void
}

function todayLabel(): string {
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'long' }).format(new Date())
}

export function isGuardianReminderDue(guardianNextReminderAt?: string, now = Date.now()): boolean {
  const dueAt = guardianNextReminderAt ? new Date(guardianNextReminderAt).getTime() : Number.NaN
  return Number.isFinite(dueAt) && dueAt <= now
}

export function guardianFollowUpLabel(guardianNextReminderAt?: string, now = Date.now()): { label: string; overdue: boolean } {
  const dueAt = guardianNextReminderAt ? new Date(guardianNextReminderAt).getTime() : Number.NaN
  if (!Number.isFinite(dueAt)) return { label: 'ยังไม่กำหนดเวลาติดตาม', overdue: false }
  const overdue = dueAt <= now
  if (overdue) return { label: 'ครบกำหนดติดตาม', overdue: true }
  const hoursLeft = Math.max(1, Math.ceil((dueAt - now) / (60 * 60 * 1000)))
  return { label: `เหลือ ${hoursLeft} ชม.`, overdue: false }
}

export function AdminToday({
  state,
  pendingDeductions,
  pendingAdditions,
  openAppeals,
  openCases,
  onOpenScore,
  onOpenReviews,
  onOpenCases,
}: AdminTodayProps) {
  const pendingGuardianCases = openCases.filter((item) => item.guardianContactStatus === 'pending')
  const dueGuardianCases = pendingGuardianCases.filter((item) => isGuardianReminderDue(item.guardianNextReminderAt))
  const reviewCount = pendingDeductions.length + pendingAdditions.length + openAppeals.length
  const recentTransactions = state.transactions.slice(0, 5)

  return (
    <div className="admin-today">
      <header className="today-hero">
        <div>
          <h1><span className="desktop-only">ภาพรวม</span>วันนี้</h1>
          <p>{todayLabel()}</p>
        </div>
        <button className="today-score-cta" type="button" onClick={onOpenScore}>
          <span className="today-score-icon" aria-hidden="true">−</span>
          <span><strong>ตัดคะแนน</strong><small>เลือกนักเรียนและเหตุการณ์</small></span>
          <span className="cta-chevron"><Icon name="chevronRight" size={20} /></span>
        </button>
      </header>

      <section className="today-status-strip" aria-label="สรุปงานวันนี้">
        <button type="button" className="urgent" onClick={onOpenCases}>
          <Icon name="calendar" />
          <span><small>ต้องติดตามวันนี้</small><strong>{dueGuardianCases.length}</strong></span>
          <Icon name="chevronRight" size={18} />
        </button>
        <button type="button" onClick={onOpenCases}>
          <Icon name="history" />
          <span><small>รอผู้ปกครองตอบกลับ</small><strong>{pendingGuardianCases.length}</strong></span>
          <Icon name="chevronRight" size={18} />
        </button>
        <button type="button" onClick={onOpenReviews}>
          <Icon name="shield" />
          <span><small>งานรอตรวจ</small><strong>{reviewCount}</strong></span>
          <Icon name="chevronRight" size={18} />
        </button>
      </section>

      <div className="today-primary-grid">
        <section className="today-section today-followups">
          <div className="today-section-heading">
            <h2>ต้องติดตามวันนี้</h2>
            <button type="button" onClick={onOpenCases}>ดูเคสทั้งหมด <Icon name="chevronRight" size={16} /></button>
          </div>
          {dueGuardianCases.length ? (
            <div className="today-followup-list">
              {dueGuardianCases.slice(0, 3).map((item) => {
                const student = state.students.find((entry) => entry.id === item.studentId)
                const due = guardianFollowUpLabel(item.guardianNextReminderAt)
                return (
                  <article key={item.id} className={due.overdue ? 'overdue' : ''}>
                    {student ? <StudentAvatar student={student} className="followup-clock" /> : <span className="followup-clock"><Icon name="history" /></span>}
                    <div>
                      <strong>{student ? studentDisplayName(student) : 'ไม่พบข้อมูลนักเรียน'}</strong>
                      <span>{student?.classroomName} • {item.guardianContactStatus === 'pending' ? 'รอติดต่อผู้ปกครอง' : 'กำลังติดตาม'}</span>
                      <small>{due.label}</small>
                    </div>
                    <button type="button" onClick={onOpenCases}>{due.overdue ? 'ติดตาม' : 'ดูเคส'} <Icon name="chevronRight" size={16} /></button>
                  </article>
                )
              })}
            </div>
          ) : <EmptyState title="ไม่มีเคสที่ต้องติดตามวันนี้" detail="เคสที่รอแจ้งผู้ปกครองจะแสดงเมื่อถึงเวลานัดเตือน" />}
        </section>

        <section className="today-section today-review-queue">
          <div className="today-section-heading"><h2>งานรอตรวจ</h2></div>
          <button type="button" onClick={onOpenReviews}>
            <span className="queue-icon"><Icon name="score" /></span>
            <span><strong>คำขอตัดคะแนน</strong><small>ตั้งแต่ 10 คะแนนขึ้นไป</small></span>
            <b>{pendingDeductions.length}</b><Icon name="chevronRight" size={18} />
          </button>
          <button type="button" onClick={onOpenReviews}>
            <span className="queue-icon"><Icon name="approval" /></span>
            <span><strong>คำขอเพิ่มคะแนน</strong><small>จากคุณครู</small></span>
            <b>{pendingAdditions.length}</b><Icon name="chevronRight" size={18} />
          </button>
          <button type="button" onClick={onOpenReviews}>
            <span className="queue-icon"><Icon name="shield" /></span>
            <span><strong>คำอุทธรณ์</strong><small>รอพิจารณา</small></span>
            <b>{openAppeals.length}</b><Icon name="chevronRight" size={18} />
          </button>
          <button className="review-center-link" type="button" onClick={onOpenReviews}>เปิดศูนย์ตรวจสอบ <Icon name="chevronRight" size={16} /></button>
        </section>
      </div>

      <section className="today-section today-transactions">
        <div className="today-section-heading"><h2>รายการคะแนนล่าสุด</h2></div>
        {recentTransactions.length ? (
          <div className="today-transaction-table" role="table" aria-label="รายการคะแนนล่าสุด">
            {recentTransactions.map((transaction) => {
              const student = state.students.find((item) => item.id === transaction.studentId)
              const positive = transaction.appliedDelta > 0
              return (
                <div role="row" key={transaction.id}>
                  <time>{formatThaiDate(transaction.occurredAt)}</time>
                  <strong>{student ? studentDisplayName(student) : 'ไม่พบข้อมูลนักเรียน'}</strong>
                  <span>{transaction.reason}</span>
                  <b className={positive ? 'positive' : 'negative'}>{positive ? '+' : ''}{transaction.appliedDelta}</b>
                  <small>{transaction.kind === 'addition' ? 'บันทึกแล้ว' : 'มีผลแล้ว'}</small>
                </div>
              )
            })}
          </div>
        ) : <EmptyState title="ยังไม่มีรายการคะแนน" detail="รายการเพิ่มและตัดคะแนนล่าสุดจะแสดงที่นี่" />}
      </section>
    </div>
  )
}
