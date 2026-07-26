import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  appealDeadline,
  canAppeal,
  canAppealUntil,
  createId,
  formatThaiDate,
  type Account,
  type DemoState,
  type ScoreTransaction,
} from './domain'
import type { AppDataActions } from './dataActions'
import { ProfileAvatar } from './ProfileAvatar'
import {
  prepareProfileAvatar,
  PROFILE_AVATARS,
  validateProfileAvatarFile,
} from './profileAvatars'
import { AppShell, EmptyState, Icon, type NavItem } from './ui'

type StudentTab = 'overview' | 'history' | 'appeals' | 'profile'

const navItems: NavItem<StudentTab>[] = [
  { id: 'overview', label: 'ภาพรวม', icon: 'home' },
  { id: 'history', label: 'ประวัติคะแนน', icon: 'history' },
  { id: 'appeals', label: 'การอุทธรณ์', icon: 'approval' },
  { id: 'profile', label: 'รูปโปรไฟล์', icon: 'users' },
]

interface StudentDashboardProps {
  account: Account
  state: DemoState
  onChange: (next: DemoState) => void
  actions?: AppDataActions
  onLogout: () => void
  initialTab?: StudentTab
}

function TransactionRow({
  transaction,
  state,
  onAppeal,
}: {
  transaction: ScoreTransaction
  state: DemoState
  onAppeal: (transaction: ScoreTransaction) => void
}) {
  const rule = state.rules.find((item) => item.id === transaction.ruleId)
  const existingAppeal = state.appeals.find((item) => item.transactionId === transaction.id)
  const eligible = transaction.kind === 'deduction'
    && (transaction.appealDeadline ? canAppealUntil(transaction.appealDeadline) : canAppeal(transaction.occurredAt))
    && !existingAppeal
  return (
    <tr>
      <td><strong>{rule?.title ?? transaction.reason}</strong><small>{formatThaiDate(transaction.occurredAt)}</small></td>
      <td><span className={`delta ${transaction.appliedDelta < 0 ? 'negative' : 'positive'}`}>{transaction.appliedDelta > 0 ? '+' : ''}{transaction.appliedDelta}</span></td>
      <td>{transaction.scoreBefore} → <strong>{transaction.scoreAfter}</strong></td>
      <td>
        {existingAppeal ? <span className="badge status-pending">ยื่นอุทธรณ์แล้ว</span> : null}
        {eligible ? <button className="button ghost compact" onClick={() => onAppeal(transaction)}>ยื่นอุทธรณ์</button> : null}
        {!eligible && !existingAppeal ? <span className="muted">—</span> : null}
      </td>
    </tr>
  )
}

export function StudentDashboard({ account, state, onChange, actions, onLogout, initialTab = 'overview' }: StudentDashboardProps) {
  const [tab, setTab] = useState<StudentTab>(initialTab)
  const [appealTarget, setAppealTarget] = useState<ScoreTransaction | null>(null)
  const [statement, setStatement] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [busy, setBusy] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const student = state.students.find((item) => item.id === account.studentId)
  const transactions = useMemo(
    () => state.transactions
      .filter((item) => item.studentId === student?.id)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    [state.transactions, student?.id],
  )
  const appeals = state.appeals.filter((item) => item.studentId === student?.id)

  if (!student) return <p>ไม่พบข้อมูลนักเรียน</p>
  const currentStudent = student

  function openAppeal(transaction: ScoreTransaction) {
    setAppealTarget(transaction)
    setStatement('')
    setTab('appeals')
  }

  async function submitAppeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!appealTarget || !statement.trim()) return
    const appealOpen = appealTarget.appealDeadline
      ? canAppealUntil(appealTarget.appealDeadline)
      : canAppeal(appealTarget.occurredAt)
    if (!appealOpen) return
    if (actions) {
      if (!appealTarget.incidentId) {
        setAnnouncement('ไม่พบรหัสเหตุการณ์สำหรับยื่นอุทธรณ์ กรุณาติดต่อผู้ดูแลระบบ')
        return
      }
      setBusy(true)
      try {
        await actions.submitAppeal({ incidentId: appealTarget.incidentId, reason: statement.trim() })
        setAnnouncement('ส่งคำอุทธรณ์เรียบร้อยแล้ว')
        setAppealTarget(null)
        setStatement('')
      } catch (error) {
        setAnnouncement(error instanceof Error ? error.message : 'ไม่สามารถส่งคำอุทธรณ์ได้')
      } finally {
        setBusy(false)
      }
      return
    }
    onChange({
      ...state,
      appeals: [
        {
          id: createId('appeal'),
          transactionId: appealTarget.id,
          studentId: currentStudent.id,
          statement: statement.trim(),
          status: 'submitted',
          createdAt: new Date().toISOString(),
        },
        ...state.appeals,
      ],
    })
    setAnnouncement('ส่งคำอุทธรณ์เรียบร้อยแล้ว')
    setAppealTarget(null)
    setStatement('')
  }

  function updateDemoAvatar(next: Pick<Account, 'avatarPreset' | 'avatarUrl' | 'avatarPath'>) {
    onChange({
      ...state,
      accounts: state.accounts.map((item) => item.id === account.id
        ? {
            ...item,
            avatarPreset: next.avatarPreset,
            avatarUrl: next.avatarUrl,
            avatarPath: next.avatarPath,
          }
        : item),
    })
  }

  async function chooseAvatar(preset: string) {
    setAvatarBusy(true)
    setAnnouncement('')
    try {
      if (actions) {
        await actions.setMyAvatarPreset(preset)
      } else {
        updateDemoAvatar({ avatarPreset: preset, avatarUrl: undefined, avatarPath: undefined })
      }
      setAnnouncement('เปลี่ยนรูปโปรไฟล์เรียบร้อยแล้ว')
    } catch (error) {
      setAnnouncement(error instanceof Error ? error.message : 'ไม่สามารถเปลี่ยนรูปโปรไฟล์ได้')
    } finally {
      setAvatarBusy(false)
    }
  }

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const validationError = validateProfileAvatarFile(file)
    if (validationError) {
      setAnnouncement(validationError)
      return
    }
    setAvatarBusy(true)
    setAnnouncement('กำลังเตรียมรูปโปรไฟล์…')
    try {
      const preparedFile = await prepareProfileAvatar(file)
      if (actions) {
        await actions.uploadMyAvatar(preparedFile)
      } else {
        updateDemoAvatar({
          avatarPreset: undefined,
          avatarPath: 'demo/profile.webp',
          avatarUrl: URL.createObjectURL(preparedFile),
        })
      }
      setAnnouncement('อัปโหลดรูปโปรไฟล์เรียบร้อยแล้ว')
    } catch (error) {
      setAnnouncement(error instanceof Error ? error.message : 'ไม่สามารถอัปโหลดรูปโปรไฟล์ได้')
    } finally {
      setAvatarBusy(false)
    }
  }

  return (
    <AppShell account={account} state={state} items={navItems} active={tab} onNavigate={setTab} onLogout={onLogout}>
      <div className="page-heading">
        <div><p className="eyebrow">พื้นที่ของนักเรียน</p><h1>{tab === 'overview' ? 'คะแนนของฉัน' : tab === 'history' ? 'ประวัติคะแนน' : tab === 'appeals' ? 'การอุทธรณ์' : 'รูปโปรไฟล์ของฉัน'}</h1></div>
        <span className="class-chip">{currentStudent.classroomName} • {currentStudent.studentCode}</span>
      </div>
      <div className="sr-only" aria-live="polite">{announcement}</div>

      {tab === 'overview' ? (
        <>
          <section className="score-hero">
            <div className="score-ring" style={{ '--score': `${currentStudent.score * 3.6}deg` } as React.CSSProperties}>
              <div><strong>{currentStudent.score}</strong><span>/ 100</span></div>
            </div>
            <div className="score-message">
              <span className="success-icon"><Icon name="shield" size={26} /></span>
              <div><p className="eyebrow">คะแนนความประพฤติปัจจุบัน</p><h2>{currentStudent.score >= 90 ? 'รักษามาตรฐานที่ดีไว้' : 'ยังพัฒนาให้ดีขึ้นได้เสมอ'}</h2><p>คะแนนเริ่มต้นภาคเรียนละ 100 และทุกการเปลี่ยนแปลงมีรายการตรวจสอบย้อนหลัง</p></div>
            </div>
          </section>
          <section className="panel">
            <div className="section-heading"><div><p className="eyebrow">ล่าสุด</p><h2>การเปลี่ยนแปลงคะแนน</h2></div><button className="text-button" onClick={() => setTab('history')}>ดูทั้งหมด</button></div>
            <div className="table-wrap">
              <table><thead><tr><th>รายการ</th><th>คะแนน</th><th>คะแนนรวม</th><th>ดำเนินการ</th></tr></thead>
                <tbody>{transactions.slice(0, 4).map((item) => <TransactionRow key={item.id} transaction={item} state={state} onAppeal={openAppeal} />)}</tbody>
              </table>
            </div>
          </section>
          <section className="guidance-strip"><Icon name="book" size={28} /><div><h2>แนวทางพัฒนาและการไกล่เกลี่ย</h2><p>หากมีข้อสงสัย สามารถพูดคุยกับครูที่ปรึกษาเพื่อวางแผนปรับพฤติกรรมร่วมกันได้</p></div></section>
        </>
      ) : null}

      {tab === 'history' ? (
        <section className="panel">
          <div className="privacy-note"><Icon name="shield" /><span>เพื่อความเป็นส่วนตัว หน้านี้ไม่แสดงชื่อหรือข้อมูลของผู้บันทึกรายการ</span></div>
          <div className="table-wrap">
            <table><caption className="sr-only">ประวัติการเปลี่ยนแปลงคะแนนของนักเรียน</caption><thead><tr><th>รายการ</th><th>คะแนน</th><th>คะแนนรวม</th><th>ดำเนินการ</th></tr></thead>
              <tbody>{transactions.map((item) => <TransactionRow key={item.id} transaction={item} state={state} onAppeal={openAppeal} />)}</tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === 'appeals' ? (
        <div className="two-column">
          <section className="panel">
            <div className="section-heading"><div><p className="eyebrow">ภายใน 7 วัน</p><h2>ยื่นคำอุทธรณ์</h2></div></div>
            {appealTarget ? (
              <form className="stack-form" onSubmit={submitAppeal}>
                <div className="selected-record"><strong>{state.rules.find((item) => item.id === appealTarget.ruleId)?.title ?? appealTarget.reason}</strong><span>ตัด {Math.abs(appealTarget.appliedDelta)} คะแนน • หมดเขต {formatThaiDate(appealTarget.appealDeadline ?? appealDeadline(appealTarget.occurredAt))}</span></div>
                <label>เหตุผลการอุทธรณ์<textarea value={statement} onChange={(event) => setStatement(event.target.value)} required minLength={10} placeholder="อธิบายข้อเท็จจริงหรือข้อมูลที่ต้องการให้โรงเรียนพิจารณา" /></label>
                <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setAppealTarget(null)}>ยกเลิก</button><button className="button primary" type="submit" disabled={busy}>{busy ? 'กำลังส่ง…' : 'ส่งคำอุทธรณ์'}</button></div>
              </form>
            ) : <EmptyState title="เลือกรายการจากประวัติคะแนน" detail="ปุ่มอุทธรณ์จะแสดงเฉพาะรายการตัดคะแนนที่ยังไม่เกิน 7 วัน" />}
          </section>
          <section className="panel">
            <div className="section-heading"><div><p className="eyebrow">ติดตามผล</p><h2>คำอุทธรณ์ของฉัน</h2></div><span className="counter">{appeals.length}</span></div>
            {appeals.length ? <div className="record-list">{appeals.map((appeal) => {
              const transaction = transactions.find((item) => item.id === appeal.transactionId)
              const rule = state.rules.find((item) => item.id === transaction?.ruleId)
              const label = appeal.status === 'accepted' ? 'คืนคะแนนแล้ว' : appeal.status === 'rejected' ? 'ไม่อนุมัติ' : 'อยู่ระหว่างพิจารณา'
              const statusClass = appeal.status === 'accepted' ? 'approved' : appeal.status === 'rejected' ? 'rejected' : 'pending'
              return <article className="record-row" key={appeal.id}><div><strong>{rule?.title ?? transaction?.reason ?? 'รายการคะแนน'}</strong><span>ยื่นเมื่อ {formatThaiDate(appeal.createdAt)}</span></div><span className={`badge status-${statusClass}`}>{label}</span></article>
            })}</div> : <EmptyState title="ยังไม่มีคำอุทธรณ์" detail="เมื่อยื่นคำอุทธรณ์แล้ว สถานะจะแสดงที่นี่" />}
          </section>
        </div>
      ) : null}

      {tab === 'profile' ? (
        <div className="profile-settings">
          <section className="panel profile-preview-panel">
            <p className="eyebrow">รูปปัจจุบัน</p>
            <ProfileAvatar account={account} className="profile-avatar-preview" decorative={false} />
            <h2>{account.displayName}</h2>
            <p>{currentStudent.classroomName} • รหัสนักเรียน {currentStudent.studentCode}</p>
            {announcement ? <div className="profile-avatar-status" role="status">{announcement}</div> : null}
          </section>

          <section className="panel profile-avatar-options">
            <div className="section-heading">
              <div><p className="eyebrow">เลือกได้ทันที</p><h2>ตัวการ์ตูน</h2></div>
              <span className="counter">10 แบบ</span>
            </div>
            {(['boy', 'girl'] as const).map((group) => (
              <div className="avatar-option-group" key={group}>
                <h3>{group === 'boy' ? 'ตัวละครชาย' : 'ตัวละครหญิง'}</h3>
                <div className="avatar-option-grid">
                  {PROFILE_AVATARS.filter((avatar) => avatar.group === group).map((avatar) => (
                    <button
                      type="button"
                      className={account.avatarPreset === avatar.id ? 'avatar-option selected' : 'avatar-option'}
                      key={avatar.id}
                      aria-label={avatar.label}
                      aria-pressed={account.avatarPreset === avatar.id}
                      disabled={avatarBusy}
                      onClick={() => void chooseAvatar(avatar.id)}
                    >
                      <img src={avatar.src} alt="" />
                      <span>{avatar.label.replace(`ตัวละคร${group === 'boy' ? 'ชาย' : 'หญิง'}`, '')}</span>
                      {account.avatarPreset === avatar.id ? <b><Icon name="check" size={15} /> เลือกอยู่</b> : null}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>

          <section className="panel profile-upload-panel">
            <span className="profile-upload-icon"><Icon name="upload" size={28} /></span>
            <div>
              <h2>ใช้รูปของตัวเอง</h2>
              <p>รองรับ JPG, PNG และ WEBP ขนาดไม่เกิน 10 MB ระบบจะตัดภาพตรงกลางเป็นสี่เหลี่ยมและย่อขนาดให้อัตโนมัติ</p>
            </div>
            <label className={`button secondary ${avatarBusy ? 'disabled' : ''}`}>
              <Icon name="upload" size={18} />
              {avatarBusy ? 'กำลังบันทึก…' : 'เลือกรูปจากเครื่อง'}
              <input
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={avatarBusy}
                onChange={(event) => void uploadAvatar(event)}
              />
            </label>
            <p className="privacy-note profile-upload-privacy"><Icon name="shield" /><span>รูปที่อัปโหลดเก็บแบบส่วนตัว นักเรียนเข้าถึงได้เฉพาะรูปของตนเอง</span></p>
          </section>
        </div>
      ) : null}
    </AppShell>
  )
}
