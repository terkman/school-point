import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type {
  AppDataActions,
  PaperDocumentRecord,
  PaperDocumentSnapshot,
} from './dataActions'
import { formatThaiDate, type Appeal, type DemoState, type ScoreTransaction, type Student } from './domain'
import type { PaperDocumentStatus, PaperDocumentType } from './adminDomain'
import { EmptyState, Icon } from './ui'

interface AdminPaperCenterProps {
  state: DemoState
  actions?: AppDataActions
}

const documentTypeLabels: Record<PaperDocumentType, string> = {
  behavior_score_summary: 'ใบสรุปคะแนนความประพฤติ',
  score_appeal_form: 'แบบฟอร์มอุทธรณ์รายการคะแนน',
  appeal_decision_notice: 'ใบแจ้งผลการอุทธรณ์',
}

const documentStatusLabels: Record<PaperDocumentStatus, string> = {
  generated: 'เตรียมแล้ว',
  printed: 'พิมพ์แล้ว',
  received: 'รับกลับแล้ว',
  delivered: 'ส่งมอบแล้ว',
  delivery_failed: 'ส่งมอบไม่สำเร็จ',
  voided: 'ยกเลิกแล้ว',
}

function termNumbers(label: string): { schoolYear: number; semester: number } {
  return {
    schoolYear: Number(label.match(/25\d{2}/)?.[0] ?? 0),
    semester: Number(label.match(/ภาคเรียน(?:ที่)?\s*(\d)/)?.[1] ?? 0),
  }
}

function localDateTimeValue(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function buildLocalPaperDocument(
  state: DemoState,
  student: Student,
  documentType: PaperDocumentType,
  incident?: ScoreTransaction,
  appeal?: Appeal,
): PaperDocumentRecord {
  const issuedAt = new Date().toISOString()
  const term = termNumbers(state.term.label)
  const transactions = state.transactions
    .filter((item) => item.studentId === student.id && item.termId === state.term.id)
    .map((item) => ({
      id: item.id,
      occurredAt: item.occurredAt,
      reason: item.reason,
      appliedDelta: item.appliedDelta,
      scoreBefore: item.scoreBefore,
      scoreAfter: item.scoreAfter,
    }))
  const snapshot: PaperDocumentSnapshot = {
    student: {
      id: student.id,
      code: student.studentCode,
      name: student.name,
      classroomName: student.classroomName,
      gradeLevel: student.gradeLevel,
      roomNumber: student.roomNumber,
    },
    term: {
      id: state.term.id,
      schoolYear: term.schoolYear,
      semester: term.semester,
      name: state.term.label,
    },
    score: student.score,
    transactions,
    ...(incident ? {
      incident: {
        id: incident.incidentId ?? incident.id,
        occurredAt: incident.occurredAt,
        reason: incident.reason,
        appliedPoints: Math.abs(incident.appliedDelta),
        appealDeadline: incident.appealDeadline ?? issuedAt,
      },
    } : {}),
    ...(appeal && incident ? {
      appeal: {
        id: appeal.id,
        incidentId: incident.incidentId ?? incident.id,
        status: appeal.status,
        statement: appeal.statement,
        restoredPoints: appeal.restoredPoints ?? 0,
        publicExplanation: appeal.decisionNote,
        createdAt: appeal.createdAt,
        decidedAt: appeal.decidedAt,
      },
    } : {}),
  }
  return {
    id: `local-paper-${Date.now()}`,
    documentNumber: `SP-DEMO-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`,
    documentType,
    status: 'generated',
    studentId: student.id,
    termId: state.term.id,
    incidentId: incident?.incidentId,
    appealId: appeal?.id,
    issuedAt,
    snapshot,
  }
}

function PaperDocumentHeader({ document }: { document: PaperDocumentRecord }) {
  const { term } = document.snapshot
  return (
    <header className="paper-document-header">
      <div className="paper-school-mark" aria-hidden="true">SP</div>
      <div>
        <strong>School Point</strong>
        <span>ระบบคะแนนความประพฤติ</span>
      </div>
      <dl>
        <div><dt>เลขที่เอกสาร</dt><dd>{document.documentNumber}</dd></div>
        <div><dt>ภาคเรียน</dt><dd>{term.semester}/{term.schoolYear}</dd></div>
      </dl>
    </header>
  )
}

function PaperStudentIdentity({ document }: { document: PaperDocumentRecord }) {
  const { student } = document.snapshot
  return (
    <dl className="paper-student-identity">
      <div><dt>ชื่อ - สกุล</dt><dd>{student.name}</dd></div>
      <div><dt>รหัสนักเรียน</dt><dd>{student.code}</dd></div>
      <div><dt>ชั้น / ห้อง</dt><dd>{student.classroomName}</dd></div>
    </dl>
  )
}

function PaperFooter({ document }: { document: PaperDocumentRecord }) {
  return (
    <footer className="paper-document-footer">
      <p>ออกเอกสารเมื่อ {formatThaiDate(document.issuedAt)}</p>
      <strong>ข้อมูล ณ เวลาที่พิมพ์</strong>
      <div className="paper-signature">ลงชื่อ .......................................................... ผู้รับรอง</div>
    </footer>
  )
}

function ScoreSummaryPaper({ document }: { document: PaperDocumentRecord }) {
  const transactions = document.snapshot.transactions.slice(0, 12)
  return (
    <article className="paper-sheet" aria-label="ใบสรุปคะแนนความประพฤติ">
      <PaperDocumentHeader document={document} />
      <h2>ใบสรุปคะแนนความประพฤติ</h2>
      <p className="paper-term-line">{document.snapshot.term.name}</p>
      <PaperStudentIdentity document={document} />
      <section className="paper-score-total">
        <span>คะแนนความประพฤติปัจจุบัน</span>
        <strong>{document.snapshot.score}</strong>
        <small>คะแนน</small>
      </section>
      <h3>รายการคะแนนล่าสุด</h3>
      <table className="paper-score-table">
        <thead><tr><th>วันที่</th><th>รายการ</th><th>คะแนน</th><th>คะแนนรวม</th></tr></thead>
        <tbody>
          {transactions.map((transaction) => (
            <tr key={transaction.id}>
              <td>{formatThaiDate(transaction.occurredAt)}</td>
              <td>{transaction.reason}</td>
              <td className={transaction.appliedDelta < 0 ? 'paper-negative' : 'paper-positive'}>
                {transaction.appliedDelta > 0 ? '+' : ''}{transaction.appliedDelta}
              </td>
              <td>{transaction.scoreBefore} → {transaction.scoreAfter}</td>
            </tr>
          ))}
          {!transactions.length ? <tr><td colSpan={4}>ยังไม่มีรายการคะแนนในภาคเรียนนี้</td></tr> : null}
        </tbody>
      </table>
      <PaperFooter document={document} />
    </article>
  )
}

function AppealFormPaper({ document }: { document: PaperDocumentRecord }) {
  const incident = document.snapshot.incident
  return (
    <article className="paper-sheet" aria-label="แบบฟอร์มอุทธรณ์รายการคะแนน">
      <PaperDocumentHeader document={document} />
      <h2>แบบฟอร์มอุทธรณ์รายการคะแนน</h2>
      <p className="paper-term-line">ใช้สำหรับยื่นต่อฝ่ายปกครองภายในกำหนดเวลา</p>
      <PaperStudentIdentity document={document} />
      <section className="paper-incident-summary">
        <h3>รายการที่ขออุทธรณ์</h3>
        <dl>
          <div><dt>เหตุการณ์</dt><dd>{incident?.reason ?? 'ไม่พบรายการที่เชื่อมโยง'}</dd></div>
          <div><dt>วันที่เกิดเหตุ</dt><dd>{incident ? formatThaiDate(incident.occurredAt) : '—'}</dd></div>
          <div><dt>คะแนนที่ตัด</dt><dd>{incident?.appliedPoints ?? 0} คะแนน</dd></div>
          <div><dt>รับคำอุทธรณ์ถึง</dt><dd>{incident ? formatThaiDate(incident.appealDeadline) : '—'}</dd></div>
        </dl>
      </section>
      <section className="paper-writing-area">
        <h3>คำชี้แจงของนักเรียน</h3>
        {Array.from({ length: 8 }, (_, index) => <div className="paper-writing-line" key={index} />)}
      </section>
      <div className="paper-signature-grid">
        <span>ลงชื่อนักเรียน ................................................</span>
        <span>วันที่ ........../........../..........</span>
        <span>ลงชื่อผู้ปกครอง ..............................................</span>
        <span>วันที่ ........../........../..........</span>
      </div>
      <PaperFooter document={document} />
    </article>
  )
}

function AppealDecisionPaper({ document }: { document: PaperDocumentRecord }) {
  const appeal = document.snapshot.appeal
  const accepted = appeal?.status === 'accepted'
  return (
    <article className="paper-sheet" aria-label="ใบแจ้งผลการอุทธรณ์">
      <PaperDocumentHeader document={document} />
      <h2>ใบแจ้งผลการอุทธรณ์</h2>
      <p className="paper-term-line">ผลการพิจารณาจากฝ่ายปกครอง</p>
      <PaperStudentIdentity document={document} />
      <section className={`paper-decision ${accepted ? 'accepted' : 'rejected'}`}>
        <span>ผลการพิจารณา</span>
        <strong>{accepted ? 'คืนคะแนน' : 'ไม่คืนคะแนน'}</strong>
        <p>{accepted ? `คืนคะแนน ${appeal?.restoredPoints ?? 0} คะแนน` : 'คงรายการตัดคะแนนเดิมไว้'}</p>
      </section>
      <section className="paper-decision-detail">
        <h3>คำชี้แจงให้นักเรียนทราบ</h3>
        <p>{appeal?.publicExplanation ?? 'ไม่มีคำชี้แจงเพิ่มเติม'}</p>
      </section>
      <dl className="paper-decision-meta">
        <div><dt>ยื่นอุทธรณ์เมื่อ</dt><dd>{appeal ? formatThaiDate(appeal.createdAt) : '—'}</dd></div>
        <div><dt>พิจารณาเมื่อ</dt><dd>{appeal?.decidedAt ? formatThaiDate(appeal.decidedAt) : '—'}</dd></div>
        <div><dt>ผู้ตอบ</dt><dd>ฝ่ายปกครอง</dd></div>
      </dl>
      <PaperFooter document={document} />
    </article>
  )
}

function PaperPreview({ document }: { document: PaperDocumentRecord }) {
  if (document.documentType === 'score_appeal_form') return <AppealFormPaper document={document} />
  if (document.documentType === 'appeal_decision_notice') return <AppealDecisionPaper document={document} />
  return <ScoreSummaryPaper document={document} />
}

export function AdminPaperCenter({ state, actions }: AdminPaperCenterProps) {
  const [search, setSearch] = useState('')
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [documentType, setDocumentType] = useState<PaperDocumentType>('behavior_score_summary')
  const [selectedTransactionId, setSelectedTransactionId] = useState('')
  const [selectedAppealId, setSelectedAppealId] = useState('')
  const [preview, setPreview] = useState<PaperDocumentRecord | null>(null)
  const [documents, setDocuments] = useState<PaperDocumentRecord[]>([])
  const [loadingHistory, setLoadingHistory] = useState(Boolean(actions?.getPaperDocuments))
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [paperAppealReason, setPaperAppealReason] = useState('')
  const [paperReceivedAt, setPaperReceivedAt] = useState(localDateTimeValue)

  useEffect(() => {
    let cancelled = false
    if (!actions?.getPaperDocuments) {
      setLoadingHistory(false)
      return () => { cancelled = true }
    }
    setLoadingHistory(true)
    actions.getPaperDocuments(state.term.id)
      .then((rows) => { if (!cancelled) setDocuments(rows) })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : 'โหลดประวัติเอกสารไม่สำเร็จ') })
      .finally(() => { if (!cancelled) setLoadingHistory(false) })
    return () => { cancelled = true }
  }, [actions, state.term.id])

  const students = useMemo(() => state.students
    .filter((student) => student.status === 'active')
    .sort((left, right) => left.classroomName.localeCompare(right.classroomName, 'th') || left.name.localeCompare(right.name, 'th')),
  [state.students])
  const normalizedSearch = search.trim().toLocaleLowerCase('th')
  const filteredStudents = normalizedSearch
    ? students.filter((student) => `${student.studentCode} ${student.name} ${student.classroomName}`.toLocaleLowerCase('th').includes(normalizedSearch)).slice(0, 20)
    : students.slice(0, 20)
  const selectedStudent = students.find((student) => student.id === selectedStudentId)
  const studentTransactions = state.transactions.filter((transaction) => transaction.studentId === selectedStudentId)
  const appealByTransaction = new Map(state.appeals.map((appeal) => [appeal.transactionId, appeal]))
  const appealableTransactions = studentTransactions.filter((transaction) => (
    transaction.kind === 'deduction'
    && transaction.incidentId
    && !appealByTransaction.has(transaction.id)
    && (!transaction.appealDeadline || new Date(transaction.appealDeadline).getTime() >= Date.now())
  ))
  const decidedAppeals = state.appeals.filter((appeal) => (
    appeal.studentId === selectedStudentId && ['accepted', 'rejected'].includes(appeal.status)
  ))
  const selectedTransaction = studentTransactions.find((item) => item.id === selectedTransactionId)
    ?? (documentType === 'appeal_decision_notice'
      ? studentTransactions.find((item) => item.id === state.appeals.find((appeal) => appeal.id === selectedAppealId)?.transactionId)
      : undefined)
  const selectedAppeal = decidedAppeals.find((item) => item.id === selectedAppealId)
  const canPrepare = Boolean(selectedStudent)
    && (documentType !== 'score_appeal_form' || Boolean(selectedTransactionId))
    && (documentType !== 'appeal_decision_notice' || Boolean(selectedAppealId))

  function chooseStudent(studentId: string) {
    setSelectedStudentId(studentId)
    setSelectedTransactionId('')
    setSelectedAppealId('')
    setPreview(null)
    setMessage('')
  }

  function changeDocumentType(next: PaperDocumentType) {
    setDocumentType(next)
    setSelectedTransactionId('')
    setSelectedAppealId('')
    setPreview(null)
    setMessage('')
  }

  async function prepareDocument() {
    if (!selectedStudent || !canPrepare || busy) return
    setBusy('prepare')
    setMessage('')
    try {
      const document = actions?.issuePaperDocument
        ? await actions.issuePaperDocument({
          documentType,
          studentId: selectedStudent.id,
          termId: state.term.id,
          incidentId: selectedTransaction?.incidentId,
          appealId: selectedAppeal?.id,
        })
        : buildLocalPaperDocument(state, selectedStudent, documentType, selectedTransaction, selectedAppeal)
      setPreview(document)
      setDocuments((current) => [document, ...current.filter((item) => item.id !== document.id)])
      setMessage(`เตรียมเอกสาร ${document.documentNumber} เรียบร้อยแล้ว`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ไม่สามารถเตรียมเอกสารได้')
    } finally {
      setBusy('')
    }
  }

  async function recordEvent(eventType: 'printed' | 'received' | 'delivered' | 'delivery_failed', note?: string) {
    if (!preview || busy) return preview
    setBusy(eventType)
    setMessage('')
    try {
      const updated = actions?.recordPaperDocumentEvent
        ? await actions.recordPaperDocumentEvent({ documentId: preview.id, eventType, note })
        : { ...preview, status: eventType as PaperDocumentStatus }
      setPreview(updated)
      setDocuments((current) => current.map((item) => item.id === updated.id ? updated : item))
      setMessage(`อัปเดตสถานะเป็น “${documentStatusLabels[updated.status]}” แล้ว`)
      return updated
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ไม่สามารถอัปเดตสถานะเอกสารได้')
      return null
    } finally {
      setBusy('')
    }
  }

  async function printDocument() {
    const updated = await recordEvent('printed')
    if (updated) window.print()
  }

  async function submitPaperAppeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!preview || !actions?.submitPaperAppeal || paperAppealReason.trim().length < 5 || busy) return
    setBusy('paper-appeal')
    setMessage('')
    try {
      await actions.submitPaperAppeal({
        documentId: preview.id,
        reason: paperAppealReason,
        receivedAt: new Date(paperReceivedAt).toISOString(),
      })
      const updated = { ...preview, status: 'received' as const }
      setPreview(updated)
      setDocuments((current) => current.map((item) => item.id === updated.id ? updated : item))
      setPaperAppealReason('')
      setMessage('รับแบบฟอร์มและสร้างคำอุทธรณ์ในคิวงานแล้ว')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ไม่สามารถรับคำอุทธรณ์จากกระดาษได้')
    } finally {
      setBusy('')
    }
  }

  function openHistory(document: PaperDocumentRecord) {
    setSelectedStudentId(document.studentId)
    setDocumentType(document.documentType)
    setSelectedTransactionId(document.snapshot.incident
      ? state.transactions.find((item) => item.incidentId === document.snapshot.incident?.id)?.id ?? ''
      : '')
    setSelectedAppealId(document.appealId ?? '')
    setPreview(document)
    setMessage('')
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
  }

  return (
    <div className="paper-center">
      <section className="paper-center-controls no-print" aria-label="เตรียมเอกสารกระดาษ">
        <div className="paper-step">
          <div className="paper-step-heading"><span>1</span><div><strong>เลือกนักเรียน</strong><small>เอกสารหนึ่งหน้าต่อหนึ่งคน</small></div></div>
          <label className="paper-search">ค้นหาชื่อหรือรหัสนักเรียน
            <input type="search" value={search} placeholder="เช่น teststudent01 หรือชื่อ" onChange={(event) => setSearch(event.target.value)} />
          </label>
          <div className="paper-student-list" role="listbox" aria-label="รายชื่อนักเรียน">
            {filteredStudents.map((student) => (
              <button
                type="button"
                role="option"
                aria-selected={selectedStudentId === student.id}
                className={selectedStudentId === student.id ? 'selected' : ''}
                key={student.id}
                onClick={() => chooseStudent(student.id)}
              >
                <span className="student-avatar">{student.name.slice(0, 1)}</span>
                <span><strong>{student.name}</strong><small>{student.studentCode} • {student.classroomName}</small></span>
                {selectedStudentId === student.id ? <Icon name="check" size={17} /> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="paper-step">
          <div className="paper-step-heading"><span>2</span><div><strong>เลือกประเภทเอกสาร</strong><small>ข้อมูลภายในและชื่อผู้บันทึกจะไม่ถูกพิมพ์</small></div></div>
          <div className="paper-type-options" role="radiogroup" aria-label="ประเภทเอกสาร">
            {(Object.keys(documentTypeLabels) as PaperDocumentType[]).map((type) => (
              <label className={documentType === type ? 'selected' : ''} key={type}>
                <input type="radio" checked={documentType === type} onChange={() => changeDocumentType(type)} />
                <span><strong>{documentTypeLabels[type]}</strong><small>{type === 'behavior_score_summary' ? 'คะแนนปัจจุบันและประวัติล่าสุด' : type === 'score_appeal_form' ? 'แบบฟอร์มผูกกับรายการตัดคะแนน' : 'แจ้งผลโดยใช้ชื่อฝ่ายปกครอง'}</small></span>
              </label>
            ))}
          </div>

          {documentType === 'score_appeal_form' && selectedStudent ? (
            <label>รายการตัดคะแนนที่ต้องการอุทธรณ์
              <select value={selectedTransactionId} onChange={(event) => { setSelectedTransactionId(event.target.value); setPreview(null) }}>
                <option value="">เลือกรายการ</option>
                {appealableTransactions.map((transaction) => <option key={transaction.id} value={transaction.id}>{formatThaiDate(transaction.occurredAt)} • {transaction.reason} • {transaction.appliedDelta}</option>)}
              </select>
              {!appealableTransactions.length ? <small className="field-caption">ไม่มีรายการที่ยังอยู่ในช่วงอุทธรณ์ หรือรายการนั้นยื่นอุทธรณ์แล้ว</small> : null}
            </label>
          ) : null}

          {documentType === 'appeal_decision_notice' && selectedStudent ? (
            <label>ผลอุทธรณ์ที่ต้องการแจ้ง
              <select value={selectedAppealId} onChange={(event) => { setSelectedAppealId(event.target.value); setPreview(null) }}>
                <option value="">เลือกผลอุทธรณ์</option>
                {decidedAppeals.map((appeal) => <option key={appeal.id} value={appeal.id}>{formatThaiDate(appeal.decidedAt ?? appeal.createdAt)} • {appeal.status === 'accepted' ? `คืน ${appeal.restoredPoints ?? 0} คะแนน` : 'ไม่คืนคะแนน'}</option>)}
              </select>
              {!decidedAppeals.length ? <small className="field-caption">ยังไม่มีผลอุทธรณ์ที่พิจารณาแล้วสำหรับนักเรียนคนนี้</small> : null}
            </label>
          ) : null}

          <button className="button primary full" type="button" disabled={!canPrepare || Boolean(busy)} onClick={() => void prepareDocument()}>
            <Icon name="document" size={18} /> {busy === 'prepare' ? 'กำลังเตรียมเอกสาร…' : 'เตรียมเอกสาร'}
          </button>
        </div>
      </section>

      <section className="paper-preview-workspace">
        <div className="paper-preview-toolbar no-print">
          <div><p className="eyebrow">ตัวอย่างก่อนพิมพ์</p><h2>{preview ? documentTypeLabels[preview.documentType] : 'ยังไม่ได้เตรียมเอกสาร'}</h2></div>
          {preview ? <div className="paper-preview-actions">
            <span className={`badge ${preview.status === 'delivered' ? 'status-approved' : preview.status === 'delivery_failed' ? 'status-rejected' : 'status-pending'}`}>{documentStatusLabels[preview.status]}</span>
            <button className="button primary" type="button" disabled={Boolean(busy) || preview.status === 'voided'} onClick={() => void printDocument()}>
              <Icon name="document" size={18} /> {busy === 'printed' ? 'กำลังบันทึก…' : 'พิมพ์เอกสาร'}
            </button>
          </div> : null}
        </div>
        {message ? <div className="paper-message no-print" role="status">{message}</div> : null}
        {preview ? <PaperPreview document={preview} /> : (
          <div className="paper-empty-preview no-print">
            <Icon name="document" size={32} />
            <strong>เลือกนักเรียนและประเภทเอกสาร</strong>
            <span>ระบบจะสร้างเลขเอกสารและตัวอย่าง A4 โดยไม่แสดงชื่อครู บันทึกภายใน หลักฐาน หรือข้อมูลผู้ปกครอง</span>
          </div>
        )}

        {preview?.documentType === 'score_appeal_form' && preview.status === 'printed' ? (
          <div className="paper-followup-panel no-print">
            <div><strong>ได้รับแบบฟอร์มกลับแล้ว?</strong><span>บันทึกการรับเอกสารก่อนคัดลอกคำชี้แจงเข้าคิวอุทธรณ์</span></div>
            <button className="button secondary" type="button" disabled={Boolean(busy)} onClick={() => void recordEvent('received', 'รับแบบฟอร์มอุทธรณ์กลับ')}>
              รับแบบฟอร์มกลับ
            </button>
          </div>
        ) : null}

        {preview?.documentType === 'score_appeal_form' && preview.status === 'received' ? (
          <form className="paper-intake-form no-print" onSubmit={submitPaperAppeal}>
            <div><strong>บันทึกคำอุทธรณ์จากกระดาษ</strong><span>คัดลอกข้อความตามต้นฉบับ ระบบจะบันทึก source=paper และผู้รับเรื่อง</span></div>
            <label>วัน–เวลาที่รับเอกสาร<input type="datetime-local" max={localDateTimeValue()} value={paperReceivedAt} onChange={(event) => setPaperReceivedAt(event.target.value)} required /></label>
            <label>คำชี้แจงตามต้นฉบับ<textarea rows={4} minLength={5} maxLength={2000} value={paperAppealReason} onChange={(event) => setPaperAppealReason(event.target.value)} required /></label>
            <button className="button primary" type="submit" disabled={!actions?.submitPaperAppeal || paperAppealReason.trim().length < 5 || Boolean(busy)}>
              {busy === 'paper-appeal' ? 'กำลังบันทึก…' : 'สร้างคำอุทธรณ์ในคิวงาน'}
            </button>
          </form>
        ) : null}

        {preview?.documentType === 'appeal_decision_notice' && preview.status === 'printed' ? (
          <div className="paper-delivery-actions no-print">
            <button className="button secondary" type="button" disabled={Boolean(busy)} onClick={() => void recordEvent('delivery_failed', 'ยังส่งมอบผลให้นักเรียนไม่ได้')}>ยังส่งมอบไม่ได้</button>
            <button className="button primary" type="button" disabled={Boolean(busy)} onClick={() => void recordEvent('delivered', 'ส่งมอบใบแจ้งผลให้นักเรียนแล้ว')}>ยืนยันส่งมอบแล้ว</button>
          </div>
        ) : null}
      </section>

      <section className="panel paper-history no-print">
        <div className="section-heading"><div><p className="eyebrow">ค้นย้อนหลังได้</p><h2>ประวัติเอกสารล่าสุด</h2></div><span className="counter">{documents.length}</span></div>
        {loadingHistory ? <p className="form-help">กำลังโหลดประวัติเอกสาร…</p> : documents.length ? (
          <div className="table-scroll">
            <table>
              <thead><tr><th>เลขที่เอกสาร</th><th>นักเรียน</th><th>ประเภท</th><th>ออกเมื่อ</th><th>สถานะ</th><th>ดู</th></tr></thead>
              <tbody>{documents.map((document) => <tr key={document.id}>
                <td><strong>{document.documentNumber}</strong></td>
                <td>{document.snapshot.student.name}<small>{document.snapshot.student.classroomName}</small></td>
                <td>{documentTypeLabels[document.documentType]}</td>
                <td>{formatThaiDate(document.issuedAt)}</td>
                <td>{documentStatusLabels[document.status]}</td>
                <td><button className="text-button" type="button" onClick={() => openHistory(document)}>เปิดดู</button></td>
              </tr>)}</tbody>
            </table>
          </div>
        ) : <EmptyState title="ยังไม่มีประวัติเอกสาร" detail="เมื่อเตรียมเอกสาร เลขเอกสารและสถานะจะปรากฏที่นี่" />}
      </section>
    </div>
  )
}
