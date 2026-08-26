import { useEffect, useMemo, useRef, useState } from 'react'
import {
  formatThaiDate,
  type DemoState,
  type GuardianContact,
  type GuardianContactChannel,
  type GuardianContactOutcome,
} from './domain'
import {
  guardianOutcomeClosesNotification,
  guardianOutcomeLabel,
  guardianReminderDueAt,
  isCurrentGuardianContactsRequest,
  resolveOpenCaseSelection,
} from './adminWorkflows'
import { EmptyState, Icon, StatusBadge } from './ui'

export interface GuardianAttemptInput {
  clientRequestId?: string
  channel: GuardianContactChannel
  outcome: GuardianContactOutcome
  note: string
  evidenceNote: string
}

interface AdminCaseCenterProps {
  state: DemoState
  busyAction: string
  onLoadGuardianContacts: (taskId: string) => Promise<GuardianContact[]>
  onRecordGuardianAttempt: (caseId: string, input: GuardianAttemptInput) => Promise<void>
  onUpdateCase: (caseId: string, status: 'following_up' | 'resolved', note: string) => Promise<void>
}

const channelLabels: Record<GuardianContactChannel, string> = {
  phone: 'โทรศัพท์',
  line: 'LINE',
  messenger: 'Messenger',
  sms: 'SMS',
}

function initialOutcome(channel: GuardianContactChannel): GuardianContactOutcome {
  if (channel === 'phone') return 'unanswered'
  return 'sent_waiting'
}

function outcomeOptions(channel: GuardianContactChannel): Array<{ value: GuardianContactOutcome; label: string; detail: string }> {
  if (channel === 'phone') return [
    { value: 'answered', label: 'รับสายแล้ว', detail: 'ถือว่าแจ้งสำเร็จและปิดงานแจ้งผู้ปกครอง' },
    { value: 'unanswered', label: 'ไม่มีผู้รับ', detail: 'ยังอยู่ในคิวและเตือนอีกครั้งใน 1 วัน' },
  ]
  if (channel === 'line' || channel === 'messenger' || channel === 'sms') return [
    { value: 'sent_waiting', label: 'ส่งแล้ว ยังไม่อ่าน/ตอบ', detail: 'ยังอยู่ในคิวและเตือนอีกครั้งใน 1 วัน' },
    { value: 'read_or_replied', label: 'อ่านหรือตอบกลับแล้ว', detail: 'ถือว่าแจ้งสำเร็จ' },
  ]
  return []
}

export function AdminCaseCenter({ state, busyAction, onLoadGuardianContacts, onRecordGuardianAttempt, onUpdateCase }: AdminCaseCenterProps) {
  const openCases = useMemo(
    () => state.seriousCases.filter((item) => item.status !== 'resolved'),
    [state.seriousCases],
  )
  const [selectedId, setSelectedId] = useState(openCases[0]?.id ?? '')
  const [contacts, setContacts] = useState<GuardianContact[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [channel, setChannel] = useState<GuardianContactChannel>('phone')
  const [outcome, setOutcome] = useState<GuardianContactOutcome>('unanswered')
  const [contactNote, setContactNote] = useState('')
  const [evidenceNote, setEvidenceNote] = useState('')
  const [caseNote, setCaseNote] = useState('')
  const [error, setError] = useState('')
  const contactsRequestRef = useRef(0)
  const guardianAttemptRequestRef = useRef('')
  const studentById = useMemo(() => new Map(state.students.map((item) => [item.id, item])), [state.students])
  const transactionById = useMemo(() => new Map(state.transactions.map((item) => [item.id, item])), [state.transactions])
  const selectedCase = openCases.find((item) => item.id === selectedId) ?? openCases[0]
  const student = selectedCase ? studentById.get(selectedCase.studentId) : undefined
  const transaction = selectedCase ? transactionById.get(selectedCase.transactionId) : undefined
  const busy = Boolean(busyAction)
  const attempts = selectedCase?.guardianContactAttempts ?? []
  const nextReminderBase = attempts[0]?.createdAt ?? selectedCase?.createdAt ?? new Date().toISOString()
  const nextReminder = selectedCase?.guardianNextReminderAt
    ? new Date(selectedCase.guardianNextReminderAt)
    : guardianReminderDueAt(nextReminderBase)
  const reminderOverdue = nextReminder.getTime() <= Date.now()
  const closesNotification = guardianOutcomeClosesNotification(channel, outcome)

  const caseCountLabel = `${openCases.length} เคสที่ต้องติดตาม`

  useEffect(() => {
    const nextId = resolveOpenCaseSelection(openCases, selectedId)
    if (nextId !== selectedId) setSelectedId(nextId)
    contactsRequestRef.current += 1
    guardianAttemptRequestRef.current = ''
    setContacts([])
    setContactsLoading(false)
    setChannel('phone')
    setOutcome('unanswered')
    setContactNote('')
    setEvidenceNote('')
    setCaseNote(selectedCase?.followUpNote ?? '')
    setError('')
  }, [selectedCase?.id, selectedId])

  function selectCase(caseId: string) {
    const next = openCases.find((item) => item.id === caseId)
    contactsRequestRef.current += 1
    guardianAttemptRequestRef.current = ''
    setSelectedId(caseId)
    setContacts([])
    setChannel('phone')
    setOutcome('unanswered')
    setContactNote('')
    setEvidenceNote('')
    setCaseNote(next?.followUpNote ?? '')
    setError('')
  }

  function chooseChannel(next: GuardianContactChannel) {
    guardianAttemptRequestRef.current = ''
    setChannel(next)
    setOutcome(initialOutcome(next))
    setError('')
  }

  async function loadContacts() {
    if (!selectedCase?.guardianTaskId || contactsLoading) return
    const taskId = selectedCase.guardianTaskId
    const requestId = contactsRequestRef.current + 1
    contactsRequestRef.current = requestId
    setContactsLoading(true)
    setError('')
    try {
      const nextContacts = await onLoadGuardianContacts(taskId)
      if (isCurrentGuardianContactsRequest(contactsRequestRef.current, requestId)) setContacts(nextContacts)
    } catch (loadError) {
      if (isCurrentGuardianContactsRequest(contactsRequestRef.current, requestId)) {
        setError(loadError instanceof Error ? loadError.message : 'ไม่สามารถโหลดข้อมูลติดต่อผู้ปกครองได้')
      }
    } finally {
      if (isCurrentGuardianContactsRequest(contactsRequestRef.current, requestId)) setContactsLoading(false)
    }
  }

  async function saveAttempt() {
    if (!selectedCase || busy) return
    setError('')
    const clientRequestId = guardianAttemptRequestRef.current || globalThis.crypto.randomUUID()
    guardianAttemptRequestRef.current = clientRequestId
    try {
      await onRecordGuardianAttempt(selectedCase.id, {
        clientRequestId,
        channel,
        outcome,
        note: contactNote.trim(),
        evidenceNote: evidenceNote.trim(),
      })
      guardianAttemptRequestRef.current = ''
      setContactNote('')
      setEvidenceNote('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'ไม่สามารถบันทึกผลการติดต่อได้')
    }
  }

  async function saveCase(status: 'following_up' | 'resolved') {
    if (!selectedCase || busy) return
    if (caseNote.trim().length < 5) {
      setError('กรุณาระบุบันทึกการติดตามอย่างน้อย 5 ตัวอักษร')
      return
    }
    setError('')
    try {
      await onUpdateCase(selectedCase.id, status, caseNote.trim())
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'ไม่สามารถบันทึกความคืบหน้าได้')
    }
  }

  return (
    <div className="admin-case-center">
      <section className="case-queue-shell" aria-labelledby="case-queue-title">
        <header className="case-queue-header">
          <div><p className="eyebrow">ติดตามกรณีร้ายแรง</p><h2 id="case-queue-title">{caseCountLabel}</h2></div>
          <span className="case-total">{openCases.length}</span>
        </header>
        {openCases.length ? (
          <div className="case-queue-list">
            {openCases.map((item) => {
              const caseStudent = studentById.get(item.studentId)
              const caseTransaction = transactionById.get(item.transactionId)
              const lastAttempt = item.guardianContactAttempts?.[0]
              const due = item.guardianNextReminderAt
                ? new Date(item.guardianNextReminderAt)
                : guardianReminderDueAt(lastAttempt?.createdAt ?? item.createdAt)
              const isOverdue = item.guardianContactStatus === 'pending' && due.getTime() <= Date.now()
              return (
                <button type="button" className={selectedCase?.id === item.id ? 'selected' : ''} key={item.id} onClick={() => selectCase(item.id)}>
                  <span className="case-queue-alert"><Icon name="alert" size={20} /></span>
                  <span><strong>{caseStudent?.name ?? 'ไม่พบข้อมูลนักเรียน'}</strong><small>{caseStudent?.classroomName} • {Math.abs(caseTransaction?.appliedDelta ?? 0)} คะแนน</small><em className={item.guardianContactStatus === 'completed' ? 'complete' : ''}>{isOverdue ? 'ครบกำหนดติดตามแล้ว' : item.guardianContactStatus === 'completed' ? 'แจ้งผู้ปกครองแล้ว' : 'รอแจ้งผู้ปกครอง'}</em></span>
                  <Icon name="chevronRight" size={18} />
                </button>
              )
            })}
          </div>
        ) : <EmptyState title="ไม่มีเคสร้ายแรงค้างอยู่" detail="เคสที่ต้องติดต่อผู้ปกครองจะปรากฏในคิวนี้" />}
      </section>

      {selectedCase ? (
        <section className="case-detail-shell" aria-labelledby="case-detail-title">
          <header className="case-detail-header">
            <div><p className="eyebrow">รายละเอียดและการติดตาม</p><h2 id="case-detail-title">{student?.name ?? 'ไม่พบข้อมูลนักเรียน'}</h2><span>{student?.studentCode} • {student?.classroomName}</span></div>
            <StatusBadge severity={selectedCase.severity} />
          </header>

          {selectedCase.guardianContactStatus === 'pending' ? (
            <div className={reminderOverdue ? 'case-due-banner overdue' : 'case-due-banner'}>
              <Icon name="calendar" size={20} />
              <span><strong>{reminderOverdue ? 'ถึงเวลาติดตามอีกครั้ง' : 'นัดเตือนครั้งถัดไป'}</strong><small>{formatThaiDate(nextReminder)}</small></span>
            </div>
          ) : <div className="case-due-banner completed"><Icon name="check" size={20} /><span><strong>แจ้งผู้ปกครองสำเร็จแล้ว</strong><small>{selectedCase.guardianContactCompletedAt ? formatThaiDate(selectedCase.guardianContactCompletedAt) : 'พร้อมดำเนินการปิดเคส'}</small></span></div>}

          <div className="case-incident-summary">
            <div><span>เหตุการณ์</span><strong>{transaction?.reason ?? selectedCase.internalNote}</strong><small>{transaction ? formatThaiDate(transaction.occurredAt) : formatThaiDate(selectedCase.createdAt)}</small></div>
            <b>-{Math.abs(transaction?.appliedDelta ?? 0)}<small>คะแนน</small></b>
          </div>

          {selectedCase.guardianContactRequired && selectedCase.guardianContactStatus === 'pending' ? (
            <section className="guardian-action-section" aria-labelledby="guardian-action-title">
              <div className="subsection-heading"><div><p>ขั้นตอนถัดไป</p><h3 id="guardian-action-title">แจ้งผู้ปกครอง</h3></div><button type="button" className="text-button" disabled={contactsLoading || !selectedCase.guardianTaskId} onClick={() => void loadContacts()}>{contactsLoading ? 'กำลังโหลด…' : contacts.length ? 'โหลดใหม่' : 'ดูข้อมูลติดต่อ'}</button></div>
              {contacts.length ? <div className="guardian-contact-list phase2">{contacts.map((contact) => <div key={contact.id}><span><strong>{contact.name}</strong><small>{contact.relationship}{contact.isPrimary ? ' • ผู้ติดต่อหลัก' : ''}</small></span><a href={`tel:${contact.phoneNumber}`}>{contact.phoneNumber}</a></div>)}</div> : null}
              <div className="contact-channel-grid" role="radiogroup" aria-label="ช่องทางแจ้งผู้ปกครอง">
                {(Object.keys(channelLabels) as GuardianContactChannel[]).map((item) => <button type="button" role="radio" aria-checked={channel === item} className={`${channel === item ? 'selected ' : ''}${item === 'sms' ? 'last-resort' : ''}`} key={item} onClick={() => chooseChannel(item)}><span>{item === 'phone' ? '☎' : item === 'line' ? 'L' : item === 'messenger' ? 'M' : 'SMS'}</span><strong>{channelLabels[item]}</strong>{item === 'sms' ? <small>ตัวเลือกสุดท้าย</small> : null}</button>)}
              </div>
              <fieldset className="contact-outcome-grid">
                <legend>ผลการติดต่อ</legend>
                {outcomeOptions(channel).map((option) => <label className={outcome === option.value ? 'selected' : ''} key={option.value}><input type="radio" name="guardian-outcome" checked={outcome === option.value} onChange={() => { guardianAttemptRequestRef.current = ''; setOutcome(option.value); setError('') }} /><span><strong>{option.label}</strong><small>{option.detail}</small></span></label>)}
              </fieldset>
              <label className="phase2-note-field">บันทึกเพิ่มเติม <small>ไม่บังคับ</small><textarea value={contactNote} maxLength={2000} placeholder="เช่น โทรหามารดาเวลา 10:20 น." onChange={(event) => { guardianAttemptRequestRef.current = ''; setContactNote(event.target.value); setError('') }} /></label>
              <label className="phase2-note-field compact">หลักฐานการแจ้ง <small>ไม่บังคับ</small><input value={evidenceNote} maxLength={500} placeholder="เลขอ้างอิง รูปหลักฐาน หรือรายละเอียดอื่น" onChange={(event) => { guardianAttemptRequestRef.current = ''; setEvidenceNote(event.target.value); setError('') }} /></label>
              <div className={closesNotification ? 'contact-result-hint closes' : 'contact-result-hint waiting'}><Icon name={closesNotification ? 'check' : 'calendar'} size={18} /><span>{closesNotification ? 'เมื่อบันทึก จะถือว่าแจ้งผู้ปกครองสำเร็จ' : 'เมื่อบันทึก เคสยังอยู่ในคิวและจะแจ้งเตือนอีกครั้งใน 1 วัน'}</span></div>
              <button className="button primary full" type="button" disabled={busy} onClick={() => void saveAttempt()}>{busyAction === 'case-guardian' ? 'กำลังบันทึก…' : 'บันทึกผลการติดต่อ'}</button>
            </section>
          ) : null}

          <section className="contact-timeline" aria-labelledby="contact-history-title">
            <div className="subsection-heading"><div><p>ประวัติการดำเนินการ</p><h3 id="contact-history-title">การติดต่อผู้ปกครอง</h3></div><span>{attempts.length} ครั้ง</span></div>
            {attempts.length ? attempts.map((attempt) => (
              <article key={attempt.id}>
                <span className={guardianOutcomeClosesNotification(attempt.channel, attempt.outcome) ? 'timeline-dot complete' : 'timeline-dot'} />
                <div><strong>{channelLabels[attempt.channel]} • {guardianOutcomeLabel(attempt.channel, attempt.outcome)}</strong><small>{formatThaiDate(attempt.createdAt)}</small>{attempt.note ? <p>{attempt.note}</p> : null}{attempt.evidenceNote ? <em>หลักฐาน: {attempt.evidenceNote}</em> : null}</div>
              </article>
            )) : <p className="timeline-empty">ยังไม่มีประวัติการติดต่อ</p>}
          </section>

          <section className="case-progress-section">
            <label className="phase2-note-field">บันทึกการติดตามเคส<textarea value={caseNote} maxLength={2000} placeholder="ระบุสิ่งที่ดำเนินการ ผลการพูดคุย หรือมาตรการช่วยเหลือนักเรียน" onChange={(event) => { setCaseNote(event.target.value); setError('') }} /></label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <div className="case-workflow-actions">
              <button className="button secondary" type="button" disabled={busy} onClick={() => void saveCase('following_up')}>{busyAction === 'case-follow' ? 'กำลังบันทึก…' : selectedCase.status === 'open' ? 'เริ่มติดตามเคส' : 'บันทึกความคืบหน้า'}</button>
              <button className="button approve" type="button" disabled={busy || selectedCase.status !== 'following_up' || selectedCase.guardianContactStatus === 'pending'} onClick={() => void saveCase('resolved')}>{busyAction === 'case-resolve' ? 'กำลังปิดเคส…' : selectedCase.guardianContactStatus === 'pending' ? 'แจ้งผู้ปกครองก่อนปิดเคส' : 'ปิดเคสเรียบร้อย'}</button>
            </div>
          </section>
        </section>
      ) : null}
    </div>
  )
}
