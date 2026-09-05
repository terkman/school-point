import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { AppDataActions } from './dataActions'
import { SchoolImportPanel } from './SchoolImportPanel'
import {
  classroomDisplayName,
  gradeLevelOptions,
  personStatusLabels,
  staffRoleLabels,
  type ActivationCodeResult,
  type CreateSchoolPersonResult,
  type DirectoryStaff,
  type DirectoryStudent,
  type GradeLevel,
  type PasswordResetCodeResult,
  type PersonStatus,
  type SchoolDirectorySnapshot,
  type StaffRole,
} from './schoolDirectory'
import { EmptyState, Icon } from './ui'
import { useDialogAccessibility } from './useDialogAccessibility'
import { studentDisplayName, type Student } from './domain'
import { StudentAvatar } from './ProfileAvatar'

type DirectorySection = 'students' | 'staff' | 'classrooms' | 'import'
type EditorTarget =
  | { kind: 'new-student' }
  | { kind: 'new-staff' }
  | { kind: 'student'; person: DirectoryStudent }
  | { kind: 'staff'; person: DirectoryStaff }
type PasswordResetTarget = { username: string; displayName: string }
type OneTimeCodeResult = ActivationCodeResult | PasswordResetCodeResult

interface SchoolDirectoryPanelProps {
  actions?: AppDataActions
  readOnly?: boolean
  initialSnapshot?: SchoolDirectorySnapshot
  studentProfiles?: Student[]
}

const emptySnapshot: SchoolDirectorySnapshot = {
  termId: '',
  termLabel: '',
  classrooms: [],
  students: [],
  staff: [],
}

function fullName(person: { title: string; givenName: string; familyName: string }) {
  return [person.title, person.givenName, person.familyName].filter(Boolean).join(' ')
}

function statusClass(status: PersonStatus) {
  if (status === 'active') return 'status-approved'
  if (status === 'suspended') return 'status-pending'
  return 'status-rejected'
}

function Dialog({
  title,
  eyebrow,
  onClose,
  busy = false,
  children,
}: {
  title: string
  eyebrow: string
  onClose: () => void
  busy?: boolean
  children: ReactNode
}) {
  const dialogRef = useDialogAccessibility({ onClose, busy })
  return (
    <div className="directory-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (!busy && event.target === event.currentTarget) onClose()
    }}>
      <section ref={dialogRef} tabIndex={-1} className="panel directory-dialog" role="dialog" aria-modal="true" aria-labelledby="directory-dialog-title">
        <div className="section-heading">
          <div><p className="eyebrow">{eyebrow}</p><h2 id="directory-dialog-title">{title}</h2></div>
          <button className="score-rules-dialog-close" type="button" disabled={busy} onClick={onClose} aria-label="ปิดหน้าต่าง" data-dialog-initial-focus>×</button>
        </div>
        {children}
      </section>
    </div>
  )
}

function ActivationDialog({
  result,
  onClose,
}: {
  result: OneTimeCodeResult
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const isPasswordReset = 'purpose' in result && result.purpose === 'password-reset'
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(result.activationCode)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <Dialog title={isPasswordReset ? 'รหัสกู้บัญชีใช้ครั้งเดียว' : 'รหัสเปิดใช้ครั้งเดียว'} eyebrow="แสดงเพียงครั้งนี้" onClose={onClose}>
      <div className="activation-code-card">
        <span>ชื่อผู้ใช้</span>
        <strong>{result.username}</strong>
        <span>{isPasswordReset ? 'รหัสกู้บัญชี' : 'รหัสเปิดใช้'}</span>
        <b>{result.activationCode}</b>
      </div>
      <p className="form-help">
        ส่งรหัสนี้ให้เจ้าของบัญชีโดยตรง รหัสมีอายุ {isPasswordReset ? '1 ชั่วโมง' : '24 ชั่วโมง'} และใช้ได้ครั้งเดียว
        {result.expiresAt ? ` (หมดอายุ ${new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(result.expiresAt))})` : ''}
        {isPasswordReset ? ' รหัสผ่านเดิมใช้ไม่ได้แล้ว เจ้าของบัญชีต้องเลือก “เปิดใช้บัญชี / กู้รหัสผ่าน” เพื่อตั้งรหัสใหม่' : ' หลังจากนั้นผู้ใช้ต้องตั้งรหัสผ่านส่วนตัว'}
      </p>
      <div className="form-actions">
        <button className="button secondary" type="button" onClick={() => void copyCode()}>
          {copied ? 'คัดลอกแล้ว' : 'คัดลอกรหัส'}
        </button>
        <button className="button primary" type="button" onClick={onClose}>ปิด</button>
      </div>
    </Dialog>
  )
}

function PasswordResetDialog({
  target,
  actions,
  onIssued,
  onClose,
}: {
  target: PasswordResetTarget
  actions: AppDataActions
  onIssued: (result: PasswordResetCodeResult) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await actions.resetSchoolAccountPassword({
        username: target.username,
        reason,
      })
      onIssued(result)
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'ไม่สามารถกู้บัญชีได้')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={`กู้บัญชี ${target.displayName}`} eyebrow="การดำเนินการด้านความปลอดภัย" onClose={onClose} busy={busy}>
      <form className="stack-form password-reset-form" onSubmit={submit}>
        <div className="account-recovery-summary">
          <Icon name="shield" size={20} />
          <div><span>ชื่อผู้ใช้</span><strong>{target.username}</strong></div>
        </div>
        <div className="warning-note">
          <Icon name="alert" />
          <span>เมื่อยืนยัน รหัสผ่านเดิมจะใช้ไม่ได้และบัญชีจะเข้าถึงข้อมูลไม่ได้จนกว่าจะตั้งรหัสผ่านใหม่</span>
        </div>
        <label>เหตุผลที่กู้บัญชี
          <textarea
            value={reason}
            minLength={5}
            maxLength={500}
            required
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
            placeholder="เช่น ผู้ใช้แจ้งว่าลืมรหัสผ่านและยืนยันตัวตนกับฝ่ายปกครองแล้ว"
          />
          <small>บังคับกรอก 5–500 ตัวอักษร และจะถูกเก็บในประวัติการตรวจสอบ</small>
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <button className="button secondary" type="button" disabled={busy} onClick={onClose}>ยกเลิก</button>
          <button className="button primary" type="submit" disabled={busy || reason.trim().length < 5}>
            {busy ? 'กำลังยกเลิกรหัสเดิม…' : 'ยืนยันและออกรหัสกู้บัญชี'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function DirectoryEditor({
  target,
  snapshot,
  actions,
  onSaved,
  onClose,
}: {
  target: EditorTarget
  snapshot: SchoolDirectorySnapshot
  actions: AppDataActions
  onSaved: (result?: CreateSchoolPersonResult) => Promise<void>
  onClose: () => void
}) {
  const person = target.kind === 'student' || target.kind === 'staff' ? target.person : undefined
  const isStudent = target.kind === 'student' || target.kind === 'new-student'
  const isNew = target.kind === 'new-student' || target.kind === 'new-staff'
  const [code, setCode] = useState(
    target.kind === 'student' ? target.person.studentCode
      : target.kind === 'staff' ? target.person.employeeCode : '',
  )
  const [username, setUsername] = useState(person?.username ?? '')
  const [title, setTitle] = useState(person?.title ?? '')
  const [givenName, setGivenName] = useState(person?.givenName ?? '')
  const [familyName, setFamilyName] = useState(person?.familyName ?? '')
  const [status, setStatus] = useState<PersonStatus>(person?.status ?? 'active')
  const [role, setRole] = useState<StaffRole>(target.kind === 'staff' ? target.person.role : 'teacher')
  const [classroomId, setClassroomId] = useState(target.kind === 'student' ? target.person.classroomId : snapshot.classrooms[0]?.id ?? '')
  const [classroomIds, setClassroomIds] = useState(() => new Set(target.kind === 'staff' ? target.person.classroomIds : []))
  const [birthDate, setBirthDate] = useState(target.kind === 'student' ? target.person.birthDate : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function toggleClassroom(id: string) {
    setClassroomIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (isNew) {
        const result = await actions.createSchoolPerson({
          kind: isStudent ? 'student' : 'staff',
          username,
          code,
          title,
          givenName,
          familyName,
          ...(isStudent ? { classroomId, birthDate } : {
            role,
            classroomIds: role === 'teacher' ? [...classroomIds] : [],
          }),
        })
        await onSaved(result)
        return
      }
      if (target.kind === 'student') {
        await actions.updateSchoolStudent({
          studentId: target.person.id,
          title,
          givenName,
          familyName,
          status,
          classroomId,
          birthDate,
        })
      } else if (target.kind === 'staff') {
        await actions.updateSchoolStaff({
          teacherId: target.person.id,
          title,
          givenName,
          familyName,
          status: status === 'graduated' ? 'archived' : status,
          role,
          classroomIds: role === 'teacher' ? [...classroomIds] : [],
        })
      }
      await onSaved()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'ไม่สามารถบันทึกข้อมูลได้')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      eyebrow={isNew ? 'เพิ่มเข้าสู่ระบบ' : 'แก้ไขและเก็บประวัติ'}
      title={isNew ? `เพิ่ม${isStudent ? 'นักเรียน' : 'บุคลากร'}ใหม่` : fullName(person!)}
      onClose={onClose}
      busy={busy}
    >
      <form className="stack-form directory-editor-form" onSubmit={submit}>
        {isNew ? (
          <div className="date-field-grid">
            <label>{isStudent ? 'รหัสนักเรียน' : 'รหัสบุคลากร'}
              <input value={code} maxLength={80} required disabled={busy} onChange={(event) => {
                const next = event.target.value
                setCode(next)
                if (!username || username === code) setUsername(next.toLowerCase())
              }} />
            </label>
            <label>ชื่อผู้ใช้
              <input value={username} maxLength={80} pattern="[a-z0-9._-]+" required disabled={busy} onChange={(event) => setUsername(event.target.value.toLowerCase())} />
            </label>
          </div>
        ) : null}
        <div className="directory-name-grid">
          <label>คำนำหน้า<input value={title} maxLength={80} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>ชื่อ<input value={givenName} maxLength={160} required disabled={busy} onChange={(event) => setGivenName(event.target.value)} /></label>
          <label>นามสกุล<input value={familyName} maxLength={160} required disabled={busy} onChange={(event) => setFamilyName(event.target.value)} /></label>
        </div>
        {isStudent ? (
          <div className="date-field-grid">
            <label>ห้องเรียน
              <select value={classroomId} required={status === 'active'} disabled={busy || status !== 'active'} onChange={(event) => setClassroomId(event.target.value)}>
                <option value="">เลือกห้องเรียน</option>
                {snapshot.classrooms.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name}</option>)}
              </select>
            </label>
            <label>วันเกิด (ไม่บังคับ)<input type="date" value={birthDate} disabled={busy} onChange={(event) => setBirthDate(event.target.value)} /></label>
          </div>
        ) : (
          <>
            <label>ตำแหน่งและสิทธิ์
              <select value={role} disabled={busy} onChange={(event) => setRole(event.target.value as StaffRole)}>
                <option value="teacher">ครู</option>
                <option value="director">ผู้อำนวยการ — ดูข้อมูลทั้งหมดอย่างเดียว</option>
                <option value="admin">ผู้ดูแลระบบ — จัดการระบบทั้งหมด</option>
              </select>
            </label>
            {role === 'teacher' ? (
              <fieldset className="directory-classroom-fieldset" disabled={busy}>
                <legend>ห้องที่รับผิดชอบ</legend>
                <div className="classroom-access-grid">
                  {snapshot.classrooms.map((classroom) => (
                    <label className={classroomIds.has(classroom.id) ? 'classroom-access-option selected' : 'classroom-access-option'} key={classroom.id}>
                      <input type="checkbox" checked={classroomIds.has(classroom.id)} onChange={() => toggleClassroom(classroom.id)} />
                      <span><strong>{classroom.name}</strong><small>{classroom.gradeLevel}</small></span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : <p className="scope-note"><Icon name="shield" size={18} /> ตำแหน่งนี้ไม่ใช้สิทธิ์รายห้อง</p>}
          </>
        )}
        {!isNew ? (
          <label>สถานะ
            <select value={status} disabled={busy} onChange={(event) => setStatus(event.target.value as PersonStatus)}>
              <option value="active">กำลังใช้งาน</option>
              <option value="suspended">ระงับชั่วคราว</option>
              {isStudent ? <option value="graduated">จบการศึกษา</option> : null}
              <option value="archived">ย้ายออก/ปิดใช้งาน</option>
            </select>
          </label>
        ) : null}
        {!isNew && status !== 'active' ? <div className="warning-note"><Icon name="alert" /><span>บัญชีจะเข้าสู่ระบบไม่ได้ แต่ข้อมูลและประวัติทั้งหมดจะยังคงอยู่และสามารถคืนสถานะภายหลัง</span></div> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <button className="button secondary" type="button" disabled={busy} onClick={onClose}>ยกเลิก</button>
          <button className="button primary" type="submit" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึกข้อมูล'}</button>
        </div>
      </form>
    </Dialog>
  )
}

function ClassroomEditor({
  snapshot,
  actions,
  onSaved,
  onClose,
}: {
  snapshot: SchoolDirectorySnapshot
  actions: AppDataActions
  onSaved: () => Promise<void>
  onClose: () => void
}) {
  const [gradeLevel, setGradeLevel] = useState<GradeLevel>('P1')
  const [roomNumber, setRoomNumber] = useState('0')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const previewName = classroomDisplayName(gradeLevel, roomNumber || '0')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !snapshot.termId) return
    setBusy(true)
    setError('')
    try {
      await actions.createSchoolClassroom({
        termId: snapshot.termId,
        gradeLevel,
        roomNumber,
      })
      await onSaved()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'ไม่สามารถเพิ่มชั้นและห้องเรียนได้')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="เพิ่มชั้นและห้องเรียน" eyebrow={snapshot.termLabel || 'ภาคเรียนปัจจุบัน'} onClose={onClose} busy={busy}>
      <form className="stack-form directory-editor-form" onSubmit={submit}>
        <div className="date-field-grid">
          <label>ระดับชั้น
            <select value={gradeLevel} disabled={busy} onChange={(event) => setGradeLevel(event.target.value as GradeLevel)}>
              {gradeLevelOptions.map((grade) => <option key={grade.value} value={grade.value}>{grade.label}</option>)}
            </select>
          </label>
          <label>หมายเลขห้อง
            <input
              value={roomNumber}
              maxLength={20}
              pattern="[0-9A-Za-zก-๙._-]+"
              required
              disabled={busy}
              onChange={(event) => setRoomNumber(event.target.value)}
              placeholder="เช่น 0, 1 หรือ 2"
            />
          </label>
        </div>
        <div className="classroom-name-preview">
          <span>ชื่อที่จะแสดงในระบบ</span>
          <strong>{previewName}</strong>
          <small>ถ้าระดับชั้นนี้มีห้องเดียว ให้ใช้หมายเลขห้อง 0 ระบบจะแสดงเฉพาะชื่อชั้น</small>
        </div>
        {!snapshot.termId ? <p className="form-error" role="alert">กรุณาสร้างหรือเลือกภาคเรียนก่อนเพิ่มห้องเรียน</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <button className="button secondary" type="button" disabled={busy} onClick={onClose}>ยกเลิก</button>
          <button className="button primary" type="submit" disabled={busy || !snapshot.termId}>{busy ? 'กำลังเพิ่ม…' : 'เพิ่มชั้นและห้อง'}</button>
        </div>
      </form>
    </Dialog>
  )
}

export function SchoolDirectoryPanel({
  actions,
  readOnly = false,
  initialSnapshot,
  studentProfiles = [],
}: SchoolDirectoryPanelProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot ?? emptySnapshot)
  const [section, setSection] = useState<DirectorySection>('students')
  const [query, setQuery] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [classroomEditorOpen, setClassroomEditorOpen] = useState(false)
  const [activation, setActivation] = useState<OneTimeCodeResult | null>(null)
  const [passwordResetTarget, setPasswordResetTarget] = useState<PasswordResetTarget | null>(null)
  const [loading, setLoading] = useState(!initialSnapshot && Boolean(actions))
  const [busyUsername, setBusyUsername] = useState('')
  const [error, setError] = useState('')

  async function load() {
    if (!actions) return
    setLoading(true)
    setError('')
    try {
      setSnapshot(await actions.getSchoolDirectory())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'ไม่สามารถโหลดรายชื่อได้')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!initialSnapshot) void load()
    // Loading once on entry avoids replacing a form while an administrator is editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const normalizedQuery = query.trim().toLocaleLowerCase('th')
  const studentProfileById = useMemo(() => new Map(studentProfiles.map((student) => [student.id, student])), [studentProfiles])
  const students = useMemo(() => snapshot.students.filter((student) => {
    if (!showInactive && student.status !== 'active') return false
    if (!normalizedQuery) return true
    return `${fullName(student)} ${studentProfileById.get(student.id)?.nickname ?? ''} ${student.studentCode} ${student.username} ${student.classroomName}`
      .toLocaleLowerCase('th').includes(normalizedQuery)
  }), [normalizedQuery, showInactive, snapshot.students, studentProfileById])
  const staff = useMemo(() => snapshot.staff.filter((person) => {
    if (!showInactive && person.status !== 'active') return false
    if (!normalizedQuery) return true
    return `${fullName(person)} ${person.employeeCode} ${person.username} ${staffRoleLabels[person.role]}`
      .toLocaleLowerCase('th').includes(normalizedQuery)
  }), [normalizedQuery, showInactive, snapshot.staff])
  const classroomGroups = useMemo(() => gradeLevelOptions.map((grade) => ({
    ...grade,
    classrooms: snapshot.classrooms.filter((classroom) => classroom.gradeLevel === grade.value),
  })), [snapshot.classrooms])

  async function afterSaved(result?: CreateSchoolPersonResult) {
    setEditor(null)
    await load()
    if (result?.activationCode && result.issuedAt) {
      setActivation({
        username: result.username,
        activationCode: result.activationCode,
        issuedAt: result.issuedAt,
        expiresAt: result.expiresAt,
      })
    }
  }

  async function issueCode(username: string) {
    if (!actions || busyUsername) return
    setBusyUsername(username)
    setError('')
    try {
      setActivation(await actions.issueActivationCode(username))
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : 'ไม่สามารถออกรหัสเปิดใช้ได้')
    } finally {
      setBusyUsername('')
    }
  }

  async function afterClassroomSaved() {
    setClassroomEditorOpen(false)
    await load()
  }

  if (!actions && !initialSnapshot) {
    return <section className="panel"><EmptyState title="ศูนย์บริหารใช้กับฐานข้อมูลจริง" detail="เข้าสู่ระบบจริงด้วยบัญชีแอดมินเพื่อจัดการรายชื่อและบัญชี" /></section>
  }

  return (
    <div className="directory-page">
      <section className="directory-hero">
        <div><p className="eyebrow">ข้อมูลกลางของโรงเรียน</p><h1>ศูนย์บริหารบุคคลและบัญชี</h1><p>{section === 'import' ? 'นำเข้าข้อมูลจำนวนมากผ่าน Excel พร้อมตรวจสอบก่อนบันทึกและเก็บประวัติทุกครั้ง' : 'เพิ่ม แก้ไข ย้ายห้อง ปิดใช้งาน และคืนสถานะ โดยเก็บประวัติเดิมไว้ครบถ้วน'}</p></div>
        {!readOnly && section !== 'import' ? (
          <button className="button primary" type="button" onClick={() => {
            if (section === 'classrooms') setClassroomEditorOpen(true)
            else setEditor(section === 'students' ? { kind: 'new-student' } : { kind: 'new-staff' })
          }}>
            <Icon name="plus" /> เพิ่ม{section === 'students' ? 'นักเรียน' : section === 'staff' ? 'บุคลากร' : 'ชั้นและห้อง'}
          </button>
        ) : null}
      </section>

      {readOnly ? <div className="scope-note director-readonly-note"><Icon name="eye" size={18} /> ผู้อำนวยการดูข้อมูลได้ทั้งหมด แต่ไม่สามารถแก้ไขรายชื่อ สิทธิ์ หรือการตั้งค่าระบบ</div> : null}

      <section className="directory-summary-grid">
        <div><span>นักเรียนทั้งหมด</span><strong>{snapshot.students.length}</strong><small>กำลังใช้งาน {snapshot.students.filter((item) => item.status === 'active').length}</small></div>
        <div><span>บุคลากรทั้งหมด</span><strong>{snapshot.staff.length}</strong><small>ครู {snapshot.staff.filter((item) => item.role === 'teacher' && item.status === 'active').length}</small></div>
        <div><span>ห้องเรียนปัจจุบัน</span><strong>{snapshot.classrooms.length}</strong><small>{snapshot.termLabel || 'ยังไม่มีภาคเรียน'}</small></div>
        <div><span>รอเปิดใช้บัญชี</span><strong>{[...snapshot.students, ...snapshot.staff].filter((item) => item.activationRequired && item.accountActive).length}</strong><small>ต้องออกรหัสครั้งแรก</small></div>
      </section>

      <section className="panel directory-list-panel">
        <div className="directory-tabs" role="tablist" aria-label="ประเภทรายชื่อ">
          <button className={section === 'students' ? 'active' : ''} type="button" onClick={() => setSection('students')}>นักเรียน <b>{snapshot.students.length}</b></button>
          <button className={section === 'staff' ? 'active' : ''} type="button" onClick={() => setSection('staff')}>บุคลากร <b>{snapshot.staff.length}</b></button>
          <button className={section === 'classrooms' ? 'active' : ''} type="button" onClick={() => setSection('classrooms')}>ชั้นและห้อง <b>{snapshot.classrooms.length}</b></button>
          {!readOnly ? <button className={section === 'import' ? 'active' : ''} type="button" onClick={() => setSection('import')}><Icon name="upload" size={17} /> นำเข้า Excel</button> : null}
        </div>
        {section === 'import' ? (
          actions && !readOnly ? <SchoolImportPanel actions={actions} onApplied={load} /> : null
        ) : <>
          <div className={section === 'classrooms' ? 'directory-toolbar classroom-directory-toolbar' : 'directory-toolbar'}>
          {section === 'classrooms' ? (
            <p>ห้องเรียนของ {snapshot.termLabel || 'ภาคเรียนปัจจุบัน'} — ห้องหมายเลข 0 หมายถึงระดับชั้นนั้นมีห้องเดียว</p>
          ) : (
            <>
              <label className="directory-search"><span className="sr-only">ค้นหารายชื่อ</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อ รหัส ห้อง หรือตำแหน่ง" /></label>
              <label className="directory-inactive-toggle"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /> แสดงผู้ที่ปิดใช้งาน</label>
            </>
          )}
          <button className="button ghost compact" type="button" disabled={loading} onClick={() => void load()}>{loading ? 'กำลังโหลด…' : 'โหลดข้อมูลใหม่'}</button>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}

          {section === 'classrooms' ? (
          <div className="classroom-directory-list">
            {classroomGroups.map((group) => (
              <article className={group.classrooms.length ? 'classroom-directory-row' : 'classroom-directory-row empty'} key={group.value}>
                <div className="classroom-grade-name">
                  <span>{classroomDisplayName(group.value, '0')}</span>
                  <div><strong>{group.label}</strong><small>{group.classrooms.length ? `${group.classrooms.length} ห้อง` : 'ยังไม่ได้เปิดชั้นนี้'}</small></div>
                </div>
                <div className="classroom-room-list">
                  {group.classrooms.length ? group.classrooms.map((classroom) => (
                    <div className="classroom-room-item" key={classroom.id}>
                      <strong>{classroom.name}</strong>
                      <small>หมายเลขห้อง {classroom.roomNumber}</small>
                    </div>
                  )) : <small>กด “เพิ่มชั้นและห้อง” เพื่อเปิดระดับชั้นนี้</small>}
                </div>
              </article>
            ))}
          </div>
        ) : section === 'students' ? (
          students.length ? <div className="directory-record-list">{students.map((student) => (
            <article className="directory-record" key={student.id}>
              <div className="directory-record-main">{studentProfileById.get(student.id) ? <StudentAvatar student={studentProfileById.get(student.id)!} className="student-avatar" /> : <span className="student-avatar">{student.givenName.slice(0, 1)}</span>}<div><strong>{studentProfileById.get(student.id) ? studentDisplayName(studentProfileById.get(student.id)!) : fullName(student)}</strong><span>{student.studentCode} • {student.classroomName || 'ยังไม่ระบุห้อง'}</span><small>ชื่อผู้ใช้ {student.username || 'ยังไม่มีบัญชี'}</small></div></div>
              <div className="directory-record-status"><span className={`badge ${statusClass(student.status)}`}>{personStatusLabels[student.status]}</span>{student.activationRequired && student.accountActive ? <small>รอเปิดใช้บัญชี</small> : null}</div>
              <div className="inline-actions">
                {!readOnly && student.activationRequired && student.accountActive ? <button className="button ghost compact" type="button" disabled={Boolean(busyUsername)} onClick={() => void issueCode(student.username)}>{busyUsername === student.username ? 'กำลังออก…' : 'ออกรหัสครั้งแรก'}</button> : null}
                {!readOnly && student.accountActive && !student.activationRequired ? <button className="button ghost compact" type="button" onClick={() => setPasswordResetTarget({ username: student.username, displayName: fullName(student) })}><Icon name="shield" size={16} /> กู้บัญชี</button> : null}
                {!readOnly ? <button className="button secondary compact" type="button" onClick={() => setEditor({ kind: 'student', person: student })}>แก้ไข</button> : null}
              </div>
            </article>
          ))}</div> : <EmptyState title="ไม่พบนักเรียน" detail="ลองเปลี่ยนคำค้นหรือเปิดการแสดงผู้ที่ปิดใช้งาน" />
        ) : (
          staff.length ? <div className="directory-record-list">{staff.map((person) => (
            <article className="directory-record" key={person.id}>
              <div className="directory-record-main"><span className="student-avatar">{person.givenName.slice(0, 1)}</span><div><strong>{fullName(person)}</strong><span>{person.employeeCode} • {staffRoleLabels[person.role]}</span><small>{person.role === 'teacher' ? `รับผิดชอบ ${person.classroomIds.length} ห้อง` : person.username}</small></div></div>
              <div className="directory-record-status"><span className={`badge ${statusClass(person.status)}`}>{personStatusLabels[person.status]}</span>{person.activationRequired && person.accountActive ? <small>รอเปิดใช้บัญชี</small> : null}</div>
              <div className="inline-actions">
                {!readOnly && person.activationRequired && person.accountActive ? <button className="button ghost compact" type="button" disabled={Boolean(busyUsername)} onClick={() => void issueCode(person.username)}>{busyUsername === person.username ? 'กำลังออก…' : 'ออกรหัสครั้งแรก'}</button> : null}
                {!readOnly && person.accountActive && !person.activationRequired ? <button className="button ghost compact" type="button" onClick={() => setPasswordResetTarget({ username: person.username, displayName: fullName(person) })}><Icon name="shield" size={16} /> กู้บัญชี</button> : null}
                {!readOnly ? <button className="button secondary compact" type="button" onClick={() => setEditor({ kind: 'staff', person })}>แก้ไข</button> : null}
              </div>
            </article>
          ))}</div> : <EmptyState title="ไม่พบบุคลากร" detail="ลองเปลี่ยนคำค้นหรือเปิดการแสดงผู้ที่ปิดใช้งาน" />
          )}
        </>}
      </section>

      {editor && actions ? <DirectoryEditor key={`${editor.kind}:${'person' in editor ? editor.person.id : 'new'}`} target={editor} snapshot={snapshot} actions={actions} onSaved={afterSaved} onClose={() => setEditor(null)} /> : null}
      {classroomEditorOpen && actions ? <ClassroomEditor snapshot={snapshot} actions={actions} onSaved={afterClassroomSaved} onClose={() => setClassroomEditorOpen(false)} /> : null}
      {passwordResetTarget && actions ? <PasswordResetDialog
        target={passwordResetTarget}
        actions={actions}
        onIssued={(result) => {
          setPasswordResetTarget(null)
          setActivation(result)
          void load()
        }}
        onClose={() => setPasswordResetTarget(null)}
      /> : null}
      {activation ? <ActivationDialog result={activation} onClose={() => setActivation(null)} /> : null}
    </div>
  )
}
