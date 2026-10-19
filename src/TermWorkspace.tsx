import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { formatThaiDate, type Account, type DemoState } from './domain'
import type { AppDataActions } from './dataActions'
import {
  createDemoTermActions,
  REMEDIATION_THRESHOLD,
  remediationStatusLabel,
  suggestNextTerm,
  termEntryTypeLabel,
  termStatusLabel,
  termTransitionBlockerLabel,
  validatePrepareNextTermInput,
  validateRemediationRequestInput,
  validateRemediationReview,
  type AcademicTermSummary,
  type PrepareNextTermInput,
  type RemediationCase,
  type RemediationRequestSummary,
  type TermHistory,
  type TermManagementActions,
  type TermStudentHistory,
  type TermTransitionPreview,
} from './termManagement'
import { localDateTimeToIso, toLocalDateTimeInputValue } from './teacherWorkflows'
import { EmptyState, Icon } from './ui'
import './term-workspace.css'

function newRequestId(): string {
  return globalThis.crypto.randomUUID()
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

const HISTORY_STUDENT_PAGE = 40

/**
 * Picks the term actions for the current data mode:
 * - server mode: `actions.termManagement`, or null when the backend lacks it;
 * - demo mode (no `actions`): a demo implementation over DemoState that writes
 *   through `onChange` (read-only when `onChange` is absent).
 */
export function useTermActions(
  state: DemoState,
  account: Account,
  actions: AppDataActions | undefined,
  onChange?: (next: DemoState) => void,
): TermManagementActions | null {
  const stateRef = useRef(state)
  stateRef.current = state
  const commitRef = useRef(onChange)
  commitRef.current = onChange
  const hasCommit = Boolean(onChange)
  const serverActions = actions?.termManagement ?? null
  const isServer = Boolean(actions)
  return useMemo(() => {
    if (isServer) return serverActions
    return createDemoTermActions(
      () => stateRef.current,
      hasCommit ? (next) => {
        stateRef.current = next
        commitRef.current?.(next)
      } : undefined,
      account,
    )
  }, [account, hasCommit, isServer, serverActions])
}

export interface TermWorkspaceProps {
  account: Account
  /** null means term management is not available for this backend. */
  termActions: TermManagementActions | null
  /** Changes whenever the app state is refreshed, so the workspace reloads. */
  reloadKey?: string
  /** Called after a successful term transition (the app's current term changed). */
  onTermChanged?: () => void
}

type LoadState = 'loading' | 'ready' | 'error'

export function TermWorkspace({ account, termActions, reloadKey = '', onTermChanged }: TermWorkspaceProps) {
  const [terms, setTerms] = useState<AcademicTermSummary[]>([])
  const [cases, setCases] = useState<RemediationCase[]>([])
  const [overviewState, setOverviewState] = useState<LoadState>('loading')
  const [overviewError, setOverviewError] = useState('')
  const [selectedTermId, setSelectedTermId] = useState('')
  const [history, setHistory] = useState<TermHistory | null>(null)
  const [historyState, setHistoryState] = useState<LoadState>('loading')
  const [historyError, setHistoryError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [busy, setBusy] = useState('')
  const [historyRefresh, setHistoryRefresh] = useState(0)
  const overviewSeq = useRef(0)
  const historySeq = useRef(0)
  const isAdmin = account.role === 'admin'
  const canRequest = account.role === 'admin' || account.role === 'teacher'

  const loadOverview = useCallback(async () => {
    if (!termActions) return
    const seq = ++overviewSeq.current
    setOverviewState((current) => current === 'ready' ? 'ready' : 'loading')
    try {
      const [nextTerms, nextCases] = await Promise.all([termActions.listAcademicTerms(), termActions.listTermRemediations()])
      if (seq !== overviewSeq.current) return
      setTerms(nextTerms)
      setCases(nextCases)
      setSelectedTermId((current) => nextTerms.some((term) => term.id === current)
        ? current
        : nextTerms.find((term) => term.status === 'active')?.id ?? nextTerms[0]?.id ?? '')
      setOverviewError('')
      setOverviewState('ready')
    } catch (error) {
      if (seq !== overviewSeq.current) return
      setOverviewError(errorMessage(error, 'ไม่สามารถโหลดข้อมูลภาคเรียนได้'))
      setOverviewState('error')
    }
  }, [termActions])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview, reloadKey])

  useEffect(() => {
    if (!termActions || !selectedTermId) {
      setHistory(null)
      return
    }
    const seq = ++historySeq.current
    setHistoryState('loading')
    termActions.getTermHistory(selectedTermId).then((next) => {
      if (seq !== historySeq.current) return
      setHistory(next)
      setHistoryError('')
      setHistoryState('ready')
    }, (error: unknown) => {
      if (seq !== historySeq.current) return
      setHistoryError(errorMessage(error, 'ไม่สามารถโหลดประวัติภาคเรียนได้'))
      setHistoryState('error')
    })
  }, [termActions, selectedTermId, reloadKey, historyRefresh])

  /** Runs one mutation at a time and reloads all term data afterwards. */
  const runMutation = useCallback(async <T,>(key: string, run: () => Promise<T>, success: (result: T) => string): Promise<T | undefined> => {
    if (busy) return undefined
    setBusy(key)
    setAnnouncement('')
    try {
      const result = await run()
      setAnnouncement(success(result))
      await loadOverview()
      setHistoryRefresh((value) => value + 1)
      return result
    } catch (error) {
      setAnnouncement('')
      throw error
    } finally {
      setBusy('')
    }
  }, [busy, loadOverview])

  if (!termActions) {
    return (
      <section className="panel term-workspace" aria-labelledby="term-unavailable-title">
        <div className="section-heading"><div><p className="eyebrow">ภาคเรียน</p><h2 id="term-unavailable-title">ประวัติภาคเรียน</h2></div></div>
        <EmptyState title="ระบบภาคเรียนยังไม่พร้อมใช้งาน" detail="เซิร์ฟเวอร์นี้ยังไม่รองรับการดูประวัติหลายภาคเรียนและการแก้ไขคะแนนภาคเรียนเดิม ข้อมูลเดิมยังอยู่ครบ" />
      </section>
    )
  }

  const activeTerm = terms.find((term) => term.status === 'active')
  const plannedTerm = terms.find((term) => term.status === 'planned')
  const sourceTermById = new Map(terms.map((term) => [term.id, term]))

  return (
    <div className="term-workspace">
      <div className="announcement" aria-live="polite">{announcement}</div>
      {overviewState === 'error' ? (
        <section className="panel" role="alert">
          <p className="form-error">{overviewError}</p>
          <div className="form-actions"><button type="button" className="button secondary" onClick={() => void loadOverview()}>ลองโหลดใหม่</button></div>
        </section>
      ) : null}

      <RemediationPanel
        account={account}
        cases={cases}
        loading={overviewState === 'loading'}
        canRequest={canRequest}
        isAdmin={isAdmin}
        busy={busy}
        sourceTermById={sourceTermById}
        onRequest={(item, input) => runMutation(`request:${item.caseId}`, () => termActions.requestTermRemediation({ ...input, caseId: item.caseId }), (result) => result.replayed
          ? `คำขอของ ${item.student.name} ถูกส่งไว้แล้ว`
          : `ส่งคำขอแก้ไขคะแนนของ ${item.student.name} แล้ว รอผู้ดูแลอนุมัติ`)}
        onReview={(item, request, approve, note, clientRequestId) => runMutation(`review:${request.id}`, () => termActions.reviewTermRemediation({ requestId: request.id, approve, note: note || undefined, clientRequestId }), (result) => result.status === 'approved'
          ? `อนุมัติแล้ว คะแนน${item.sourceTerm.name}ของ ${item.student.name} เป็น ${result.balanceAfter ?? '-'}${result.caseStatus === 'passed' ? ' • ผ่านเกณฑ์แล้ว' : ''}`
          : `ไม่อนุมัติคำขอของ ${item.student.name}`)}
      />

      <section className="panel term-history-panel" aria-labelledby="term-history-title">
        <div className="section-heading">
          <div><p className="eyebrow">ประวัติแยกตามภาคเรียน</p><h2 id="term-history-title">ภาคเรียนและคะแนน</h2></div>
          {terms.length ? (
            <label className="term-select">
              <span>เลือกภาคเรียน</span>
              <select value={selectedTermId} onChange={(event) => setSelectedTermId(event.target.value)} disabled={overviewState === 'loading'}>
                {terms.map((term) => <option key={term.id} value={term.id}>{term.name} • {termStatusLabel(term.status)}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        {overviewState === 'loading' && !terms.length ? <p className="muted" role="status">กำลังโหลดภาคเรียน…</p> : null}
        {overviewState === 'ready' && !terms.length ? <EmptyState title="ยังไม่มีภาคเรียนที่ดูได้" detail="เมื่อผู้ดูแลเปิดภาคเรียน ประวัติจะแสดงที่นี่" /> : null}
        {selectedTermId ? (
          <TermHistoryView
            account={account}
            history={history}
            state={historyState}
            error={historyError}
            onRetry={() => setHistoryRefresh((value) => value + 1)}
          />
        ) : null}
      </section>

      {isAdmin ? (
        <TermTransitionPanel
          termActions={termActions}
          activeTerm={activeTerm}
          plannedTerm={plannedTerm}
          busy={busy}
          reloadKey={`${reloadKey}:${terms.map((term) => `${term.id}:${term.status}`).join(',')}`}
          onPrepare={(input) => runMutation('prepare', () => termActions.prepareNextTerm(input), (result) => result.replayed
            ? 'ภาคเรียนถัดไปถูกเตรียมไว้แล้ว ไม่มีการสร้างซ้ำ'
            : `เตรียม${input.name}แล้ว คัดลอก ${result.classroomCount} ห้อง ${result.enrollmentCount} คน ${result.assignmentCount} การมอบหมายครู`)}
          onTransition={async (input) => {
            const result = await runMutation('transition', () => termActions.transitionTerm(input), (outcome) => outcome.replayed
              ? 'การเปลี่ยนภาคเรียนนี้สำเร็จไปแล้วก่อนหน้า'
              : `ปิดภาคเรียนเดิมและเปิดภาคเรียนใหม่แล้ว • บันทึกคะแนนปิดภาค ${outcome.snapshotCount} คน • ต้องแก้ไขคะแนน ${outcome.remediationCaseCount} คน • เริ่ม 100 คะแนน ${outcome.initializedAccounts} คน`)
            if (result) onTermChanged?.()
            return result
          }}
        />
      ) : null}
    </div>
  )
}

function TermHistoryView({ account, history, state, error, onRetry }: {
  account: Account
  history: TermHistory | null
  state: LoadState
  error: string
  onRetry: () => void
}) {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(HISTORY_STUDENT_PAGE)
  const isStudent = account.role === 'student'
  const normalizedQuery = query.trim().toLowerCase()
  const students = useMemo(() => (history?.students ?? []).filter((student) => !normalizedQuery
    || student.name.toLowerCase().includes(normalizedQuery)
    || student.studentCode.toLowerCase().includes(normalizedQuery)
    || (student.nickname ?? '').toLowerCase().includes(normalizedQuery)
    || (student.classroomName ?? '').toLowerCase().includes(normalizedQuery)), [history, normalizedQuery])

  if (state === 'error') {
    return <div role="alert"><p className="form-error">{error}</p><div className="form-actions"><button type="button" className="button secondary" onClick={onRetry}>ลองโหลดใหม่</button></div></div>
  }
  if (!history) return <p className="muted" role="status">กำลังโหลดประวัติ…</p>
  const { term } = history
  return (
    <div className="term-history" aria-busy={state === 'loading'}>
      <div className="term-summary">
        <span className={`badge ${term.status === 'active' ? 'status-approved' : term.status === 'planned' ? 'status-pending' : 'status-info'}`}>{termStatusLabel(term.status)}</span>
        <span>{term.startsOn && term.endsOn ? `${formatThaiDate(term.startsOn, false)} – ${formatThaiDate(term.endsOn, false)}` : 'ยังไม่กำหนดวันเปิด–ปิด'}</span>
        {history.closedAt ? <span>ปิดภาคเมื่อ {formatThaiDate(history.closedAt)}</span> : null}
        <span>เกณฑ์ผ่าน {history.threshold} คะแนน</span>
      </div>
      {term.status === 'closed' ? <p className="scope-note"><Icon name="shield" size={18} /> คะแนนปิดภาคถูกบันทึกครั้งเดียวและไม่เปลี่ยนแปลง คะแนนล่าสุดอาจเพิ่มขึ้นจากกิจกรรมแก้ไขหรือผลอุทธรณ์ของภาคเรียนนี้เท่านั้น</p> : null}
      {!isStudent && history.students.length > 8 ? (
        <label className="term-search">
          <span>ค้นหานักเรียน</span>
          <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(HISTORY_STUDENT_PAGE) }} placeholder="ชื่อ รหัส หรือห้อง" />
        </label>
      ) : null}
      {students.length ? (
        <div className="record-list">
          {students.slice(0, limit).map((student) => <TermStudentRow key={student.studentId} student={student} termStatus={term.status} openByDefault={isStudent} />)}
        </div>
      ) : <EmptyState title={history.students.length ? 'ไม่พบนักเรียนที่ค้นหา' : 'ไม่มีข้อมูลนักเรียนที่คุณดูได้ในภาคเรียนนี้'} detail={isStudent ? 'ภาคเรียนนี้ยังไม่มีบัญชีคะแนนของคุณ' : 'ระบบแสดงเฉพาะนักเรียนที่คุณมีสิทธิ์ดู'} />}
      {students.length > limit ? <div className="form-actions"><button type="button" className="button secondary" onClick={() => setLimit((value) => value + HISTORY_STUDENT_PAGE)}>แสดงนักเรียนเพิ่ม ({students.length - limit})</button></div> : null}
    </div>
  )
}

function TermStudentRow({ student, termStatus, openByDefault }: { student: TermStudentHistory; termStatus: AcademicTermSummary['status']; openByDefault: boolean }) {
  return (
    <article className="term-student-row">
      <div className="term-student-head">
        <div>
          <strong>{student.name}{student.nickname ? ` (${student.nickname})` : ''}</strong>
          <small>{student.studentCode}{student.classroomName ? ` • ${student.classroomName}` : ''}{student.studentStatus === 'graduated' ? ' • จบการศึกษา' : ''}</small>
        </div>
        <dl className="term-score-pair">
          {termStatus === 'closed' ? <div><dt>คะแนนปิดภาค</dt><dd>{student.closingScore ?? '—'}</dd></div> : null}
          <div><dt>{termStatus === 'closed' ? 'คะแนนล่าสุดของภาคนี้' : 'คะแนนปัจจุบัน'}</dt><dd>{student.latestScore ?? 'ยังไม่มีบัญชีคะแนน'}</dd></div>
        </dl>
        {student.remediation
          ? <span className={`badge ${student.remediation.status === 'passed' ? 'status-approved' : 'status-rejected'}`}>{remediationStatusLabel(student.remediation.status)}</span>
          : termStatus === 'closed' && student.closingScore !== null && student.closingScore >= student.threshold
            ? <span className="badge status-approved">ผ่านเกณฑ์</span>
            : null}
      </div>
      <details open={openByDefault}>
        <summary>ประวัติคะแนน {student.history.length} รายการ</summary>
        {student.history.length ? (
          <ol className="term-ledger">
            {student.history.map((entry) => (
              <li key={entry.id}>
                <span className="term-ledger-type">{termEntryTypeLabel(entry.entryType)}</span>
                <span>{entry.reason}</span>
                <span className={`delta ${entry.appliedDelta < 0 ? 'negative' : 'positive'}`}>{entry.appliedDelta > 0 ? '+' : ''}{entry.appliedDelta}</span>
                <span>{entry.balanceBefore} → <strong>{entry.balanceAfter}</strong></span>
                <small>{formatThaiDate(entry.activityOccurredAt ?? entry.createdAt)}{entry.activityOccurredAt && entry.entryType === 'remediation_credit' ? ` • บันทึก ${formatThaiDate(entry.createdAt)}` : ''}</small>
              </li>
            ))}
          </ol>
        ) : <p className="muted">ยังไม่มีรายการในภาคเรียนนี้</p>}
      </details>
    </article>
  )
}

interface RemediationRequestDraft {
  points: number
  activityOccurredAt: string
  reason: string
  clientRequestId: string
}

function RemediationPanel({ account, cases, loading, canRequest, isAdmin, busy, sourceTermById, onRequest, onReview }: {
  account: Account
  cases: RemediationCase[]
  loading: boolean
  canRequest: boolean
  isAdmin: boolean
  busy: string
  sourceTermById: Map<string, AcademicTermSummary>
  onRequest: (item: RemediationCase, input: RemediationRequestDraft) => Promise<unknown>
  onReview: (item: RemediationCase, request: RemediationRequestSummary, approve: boolean, note: string, clientRequestId: string) => Promise<unknown>
}) {
  const [showPassed, setShowPassed] = useState(false)
  const openCases = cases.filter((item) => item.status === 'open')
  const visible = showPassed ? cases : openCases
  const isStudent = account.role === 'student'
  return (
    <section className="panel remediation-panel" aria-labelledby="remediation-title">
      <div className="section-heading">
        <div><p className="eyebrow">ภาคเรียนเดิม</p><h2 id="remediation-title">{isStudent ? 'การแก้ไขคะแนนของฉัน' : 'นักเรียนที่ต้องแก้ไขคะแนนภาคเรียนเดิม'}</h2></div>
        <span className={`counter ${openCases.length ? 'danger' : ''}`}>{openCases.length}</span>
      </div>
      <p className="muted">คะแนนแก้ไขจะเพิ่มให้ภาคเรียนเดิมเท่านั้น ไม่กระทบคะแนนภาคเรียนปัจจุบัน และผ่านเกณฑ์อัตโนมัติเมื่อคะแนนภาคเรียนเดิมถึง {REMEDIATION_THRESHOLD} คะแนน</p>
      {cases.length > openCases.length ? (
        <label className="checkbox-row"><input type="checkbox" checked={showPassed} onChange={(event) => setShowPassed(event.target.checked)} /> แสดงเคสที่ผ่านเกณฑ์แล้ว ({cases.length - openCases.length})</label>
      ) : null}
      {loading && !cases.length ? <p className="muted" role="status">กำลังโหลดรายการ…</p> : null}
      {!loading && !visible.length ? <EmptyState title={isStudent ? 'ไม่มีคะแนนภาคเรียนเดิมที่ต้องแก้ไข' : 'ไม่มีนักเรียนที่ค้างแก้ไขคะแนน'} detail="นักเรียนที่คะแนนปิดภาคต่ำกว่าเกณฑ์จะแสดงที่นี่ แม้จะไม่ได้อยู่ในรายชื่อภาคเรียนปัจจุบัน" /> : null}
      <div className="record-list">
        {visible.map((item) => (
          <RemediationCaseRow
            key={item.caseId}
            item={item}
            sourceTerm={sourceTermById.get(item.sourceTerm.id) ?? item.sourceTerm}
            canRequest={canRequest}
            isAdmin={isAdmin}
            isStudent={isStudent}
            busy={busy}
            onRequest={onRequest}
            onReview={onReview}
          />
        ))}
      </div>
    </section>
  )
}

function RemediationCaseRow({ item, sourceTerm, canRequest, isAdmin, isStudent, busy, onRequest, onReview }: {
  item: RemediationCase
  sourceTerm: AcademicTermSummary
  canRequest: boolean
  isAdmin: boolean
  isStudent: boolean
  busy: string
  onRequest: (item: RemediationCase, input: RemediationRequestDraft) => Promise<unknown>
  onReview: (item: RemediationCase, request: RemediationRequestSummary, approve: boolean, note: string, clientRequestId: string) => Promise<unknown>
}) {
  const [formOpen, setFormOpen] = useState(false)
  const requestAllowed = canRequest && item.status === 'open' && item.pendingRequestCount === 0
  return (
    <article className="remediation-case" aria-label={`เคสแก้ไขคะแนน ${item.student.name}`}>
      <div className="remediation-case-head">
        <div>
          <strong>{item.student.name}{item.student.nickname ? ` (${item.student.nickname})` : ''}</strong>
          <small>{item.student.studentCode} • {item.sourceTerm.name} • {item.currentClassroomName ? `ปัจจุบัน ${item.currentClassroomName}` : 'ไม่อยู่ในรายชื่อภาคเรียนปัจจุบัน'}</small>
        </div>
        <dl className="term-score-pair">
          <div><dt>ปิดภาค</dt><dd>{item.closingScore}</dd></div>
          <div><dt>ล่าสุด</dt><dd>{item.currentScore} / {item.threshold}</dd></div>
          {item.status === 'open' ? <div><dt>ขาดอีก</dt><dd>{item.pointsNeeded}</dd></div> : null}
        </dl>
        <span className={`badge ${item.status === 'passed' ? 'status-approved' : 'status-rejected'}`}>{remediationStatusLabel(item.status)}{item.passedAt ? ` • ${formatThaiDate(item.passedAt, false)}` : ''}</span>
      </div>
      {item.requests.length ? (
        <ul className="remediation-requests">
          {item.requests.map((request) => (
            <li key={request.id}>
              <div>
                <strong>+{request.approvedPoints ?? request.requestedPoints} คะแนน • {request.status === 'pending' ? 'รออนุมัติ' : request.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}</strong>
                {request.reason ? <span>{request.reason}</span> : null}
                <small>ทำกิจกรรม {formatThaiDate(request.activityOccurredAt)}{request.requestedBySnapshot ? ` • โดย ${request.requestedBySnapshot}` : request.requestedByMe ? ' • คำขอของคุณ' : ''}</small>
                {request.reviewNote ? <small>หมายเหตุ: {request.reviewNote}</small> : null}
              </div>
              {isAdmin && request.status === 'pending' ? <ReviewControls item={item} request={request} busy={busy} onReview={onReview} /> : null}
            </li>
          ))}
        </ul>
      ) : isStudent ? null : <p className="muted">ยังไม่มีคำขอแก้ไขคะแนน</p>}
      {requestAllowed && !formOpen ? (
        <div className="form-actions"><button type="button" className="button primary compact" onClick={() => setFormOpen(true)} disabled={Boolean(busy)}><Icon name="plus" size={16} /> ขอเพิ่มคะแนนแก้ไข</button></div>
      ) : null}
      {canRequest && item.status === 'open' && item.pendingRequestCount > 0 ? <p className="muted">มีคำขอรอผู้ดูแลอนุมัติ ส่งคำขอใหม่ได้หลังพิจารณาแล้ว</p> : null}
      {requestAllowed && formOpen ? (
        <RemediationRequestForm
          item={item}
          sourceTerm={sourceTerm}
          busy={busy === `request:${item.caseId}`}
          disabled={Boolean(busy)}
          onCancel={() => setFormOpen(false)}
          onSubmit={async (draft) => {
            await onRequest(item, draft)
            setFormOpen(false)
          }}
        />
      ) : null}
    </article>
  )
}

function RemediationRequestForm({ item, sourceTerm, busy, disabled, onCancel, onSubmit }: {
  item: RemediationCase
  sourceTerm: AcademicTermSummary
  busy: boolean
  disabled: boolean
  onCancel: () => void
  onSubmit: (draft: RemediationRequestDraft) => Promise<void>
}) {
  const [points, setPoints] = useState(Math.max(1, Math.min(100, item.pointsNeeded || 1)))
  const [activityAt, setActivityAt] = useState(() => toLocalDateTimeInputValue())
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  // Reused for retries of the same submission; replaced whenever any field changes.
  const [clientRequestId, setClientRequestId] = useState(() => newRequestId())
  const invalidate = () => setClientRequestId(newRequestId())
  const capped = Math.min(points, 100 - item.currentScore)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled) return
    const activityOccurredAt = localDateTimeToIso(activityAt) ?? ''
    const validation = validateRemediationRequestInput({ points, activityOccurredAt, reason }, sourceTerm)
    if (validation) {
      setError(validation)
      return
    }
    setError('')
    try {
      await onSubmit({ points, activityOccurredAt, reason: reason.trim(), clientRequestId })
    } catch (submitError) {
      setError(errorMessage(submitError, 'ไม่สามารถส่งคำขอได้ กรุณาลองใหม่'))
    }
  }

  return (
    <form className="stack-form remediation-form" onSubmit={submit} noValidate>
      <div className="remediation-form-grid">
        <label>คะแนนที่ขอเพิ่ม
          <input type="number" min={1} max={100} step={1} value={points} onChange={(event) => { setPoints(Math.trunc(Number(event.target.value))); invalidate() }} />
        </label>
        <label>วันเวลาที่ทำกิจกรรม
          <input type="datetime-local" value={activityAt} onChange={(event) => { setActivityAt(event.target.value); invalidate() }} />
        </label>
      </div>
      <label>รายละเอียดกิจกรรมแก้ไขพฤติกรรม
        <textarea rows={3} value={reason} onChange={(event) => { setReason(event.target.value); invalidate() }} placeholder="เช่น ช่วยงานจิตอาสาของโรงเรียน 2 ชั่วโมง" />
      </label>
      <p className="muted">หากอนุมัติ คะแนน{item.sourceTerm.name}จะเป็น {item.currentScore + Math.max(0, capped)} {item.currentScore + Math.max(0, capped) >= item.threshold ? '(ผ่านเกณฑ์)' : `(ยังขาด ${Math.max(0, item.threshold - item.currentScore - Math.max(0, capped))})`} • คะแนนสูงสุด 100</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>ยกเลิก</button>
        <button type="submit" className="button primary" disabled={disabled}>{busy ? 'กำลังส่ง…' : 'ส่งคำขอให้ผู้ดูแลอนุมัติ'}</button>
      </div>
    </form>
  )
}

function ReviewControls({ item, request, busy, onReview }: {
  item: RemediationCase
  request: RemediationRequestSummary
  busy: string
  onReview: (item: RemediationCase, request: RemediationRequestSummary, approve: boolean, note: string, clientRequestId: string) => Promise<unknown>
}) {
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  // One stable id per (decision, note) so a retried click replays safely.
  const ids = useRef(new Map<string, string>())
  const pending = busy === `review:${request.id}`

  async function decide(approve: boolean) {
    if (busy) return
    const validation = validateRemediationReview(approve, note)
    if (validation) {
      setError(validation)
      return
    }
    const key = `${approve}:${note.trim()}`
    const clientRequestId = ids.current.get(key) ?? newRequestId()
    ids.current.set(key, clientRequestId)
    setError('')
    try {
      await onReview(item, request, approve, note.trim(), clientRequestId)
    } catch (reviewError) {
      setError(errorMessage(reviewError, 'ไม่สามารถบันทึกผลการพิจารณาได้'))
    }
  }

  return (
    <div className="remediation-review">
      <label>หมายเหตุ (จำเป็นเมื่อไม่อนุมัติ)
        <input type="text" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="form-actions">
        <button type="button" className="button reject compact" disabled={Boolean(busy)} onClick={() => void decide(false)}>ไม่อนุมัติ</button>
        <button type="button" className="button approve compact" disabled={Boolean(busy)} onClick={() => void decide(true)}>{pending ? 'กำลังบันทึก…' : 'อนุมัติ'}</button>
      </div>
    </div>
  )
}

function TermTransitionPanel({ termActions, activeTerm, plannedTerm, busy, reloadKey, onPrepare, onTransition }: {
  termActions: TermManagementActions
  activeTerm?: AcademicTermSummary
  plannedTerm?: AcademicTermSummary
  busy: string
  reloadKey: string
  onPrepare: (input: PrepareNextTermInput) => Promise<unknown>
  onTransition: (input: { currentTermId: string; nextTermId: string; clientRequestId: string }) => Promise<unknown>
}) {
  const [preview, setPreview] = useState<TermTransitionPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [transitionError, setTransitionError] = useState('')
  const transitionIds = useRef(new Map<string, string>())
  const previewSeq = useRef(0)
  const plannedTermId = plannedTerm?.id ?? ''

  const loadPreview = useCallback(async () => {
    if (!plannedTermId) {
      setPreview(null)
      return
    }
    const seq = ++previewSeq.current
    setPreviewLoading(true)
    try {
      const next = await termActions.previewTermTransition(plannedTermId)
      if (seq !== previewSeq.current) return
      setPreview(next)
      setPreviewError('')
    } catch (error) {
      if (seq !== previewSeq.current) return
      setPreviewError(errorMessage(error, 'ไม่สามารถตรวจความพร้อมก่อนเปลี่ยนภาคเรียนได้'))
    } finally {
      if (seq === previewSeq.current) setPreviewLoading(false)
    }
  }, [plannedTermId, termActions])

  useEffect(() => {
    setConfirmed(false)
    void loadPreview()
  }, [loadPreview, reloadKey])

  async function transition() {
    if (busy || !preview?.canTransition || !confirmed || !activeTerm || !plannedTerm) return
    const key = `${activeTerm.id}:${plannedTerm.id}`
    const clientRequestId = transitionIds.current.get(key) ?? newRequestId()
    transitionIds.current.set(key, clientRequestId)
    setTransitionError('')
    try {
      await onTransition({ currentTermId: activeTerm.id, nextTermId: plannedTerm.id, clientRequestId })
      transitionIds.current.delete(key)
      setConfirmed(false)
    } catch (error) {
      setTransitionError(errorMessage(error, 'ไม่สามารถเปลี่ยนภาคเรียนได้ ข้อมูลเดิมไม่ถูกเปลี่ยนแปลง'))
      void loadPreview()
    }
  }

  return (
    <section className="panel term-transition-panel" aria-labelledby="term-transition-title">
      <div className="section-heading"><div><p className="eyebrow">สำหรับผู้ดูแลระบบ</p><h2 id="term-transition-title">เตรียมและเปลี่ยนภาคเรียน</h2></div></div>
      {!activeTerm ? <EmptyState title="ยังไม่มีภาคเรียนที่กำลังใช้งาน" detail="เปิดใช้งานภาคเรียนจากหน้าสิทธิ์และภาคเรียนก่อน" /> : null}
      {activeTerm && !plannedTerm ? <PrepareNextTermForm activeTerm={activeTerm} busy={busy} onPrepare={onPrepare} /> : null}
      {activeTerm && plannedTerm ? (
        <div className="stack-form">
          <p>จาก <strong>{activeTerm.name}</strong> ไป <strong>{plannedTerm.name}</strong>{plannedTerm.startsOn && plannedTerm.endsOn ? ` (${formatThaiDate(plannedTerm.startsOn, false)} – ${formatThaiDate(plannedTerm.endsOn, false)})` : ''}</p>
          {previewLoading && !preview ? <p className="muted" role="status">กำลังตรวจความพร้อม…</p> : null}
          {previewError ? <div role="alert"><p className="form-error">{previewError}</p><div className="form-actions"><button type="button" className="button secondary" onClick={() => void loadPreview()}>ตรวจอีกครั้ง</button></div></div> : null}
          {preview ? (
            <>
              <div className="reset-preview term-preview-counts">
                <span>นักเรียนภาคเรียนปัจจุบัน <strong>{preview.counts.currentStudents}</strong></span>
                <span>ต่ำกว่า {preview.threshold} (ต้องแก้ไข) <strong>{preview.counts.belowThreshold}</strong></span>
                <span>ยกไปภาคเรียนใหม่ <strong>{preview.counts.nextEnrolled}</strong></span>
                <span>ไม่อยู่ในรายชื่อใหม่ <strong>{preview.counts.notCarriedOver}</strong></span>
                <span>อุทธรณ์ค้าง (ยังพิจารณาได้หลังปิดภาค) <strong>{preview.counts.pendingAppeals}</strong></span>
                <span>เคสแก้ไขเดิมที่ยังเปิด <strong>{preview.counts.openRemediationCases}</strong></span>
              </div>
              {preview.blockers.length ? (
                <div role="alert" className="term-blockers">
                  <strong>ต้องแก้ไขก่อนเปลี่ยนภาคเรียน</strong>
                  <ul>{preview.blockers.map((code) => <li key={code}>{termTransitionBlockerLabel(code)}</li>)}</ul>
                  <div className="form-actions"><button type="button" className="button secondary compact" onClick={() => void loadPreview()} disabled={previewLoading}>ตรวจอีกครั้ง</button></div>
                </div>
              ) : null}
              <label className="checkbox-row">
                <input type="checkbox" checked={confirmed} disabled={!preview.canTransition || Boolean(busy)} onChange={(event) => setConfirmed(event.target.checked)} />
                ตรวจรายชื่อแล้ว และยืนยันว่าจะปิด{activeTerm.name} บันทึกคะแนนปิดภาคแบบแก้ไขไม่ได้ และเริ่ม{plannedTerm.name}ที่ 100 คะแนน
              </label>
              {transitionError ? <p className="form-error" role="alert">{transitionError}</p> : null}
              <div className="form-actions">
                <button type="button" className="button warning" disabled={!preview.canTransition || !confirmed || Boolean(busy)} onClick={() => void transition()}>
                  {busy === 'transition' ? 'กำลังเปลี่ยนภาคเรียน…' : 'ปิดภาคเรียนเดิมและเปิดภาคเรียนใหม่'}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function PrepareNextTermForm({ activeTerm, busy, onPrepare }: {
  activeTerm: AcademicTermSummary
  busy: string
  onPrepare: (input: PrepareNextTermInput) => Promise<unknown>
}) {
  const suggestion = suggestNextTerm(activeTerm)
  const [name, setName] = useState(suggestion.name)
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const input: PrepareNextTermInput = { schoolYear: suggestion.schoolYear, semester: suggestion.semester, name: name.trim(), startsOn, endsOn }
    const validation = validatePrepareNextTermInput(input, activeTerm)
    if (validation) {
      setError(validation)
      return
    }
    setError('')
    try {
      await onPrepare(input)
    } catch (prepareError) {
      setError(errorMessage(prepareError, 'ไม่สามารถเตรียมภาคเรียนถัดไปได้'))
    }
  }

  return (
    <form className="stack-form" onSubmit={submit} noValidate aria-label="เตรียมภาคเรียนถัดไป">
      <p>สร้างภาคเรียนที่ {suggestion.semester}/{suggestion.schoolYear} และคัดลอกห้องเรียน รายชื่อนักเรียน และครูประจำห้องจาก{activeTerm.name} ตรวจสอบรายชื่อได้ก่อนเปลี่ยนภาคเรียนจริง</p>
      <label>ชื่อภาคเรียน<input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} /></label>
      <div className="remediation-form-grid">
        <label>วันเปิดภาคเรียน<input type="date" value={startsOn} min={activeTerm.endsOn} onChange={(event) => setStartsOn(event.target.value)} /></label>
        <label>วันปิดภาคเรียน<input type="date" value={endsOn} min={startsOn || activeTerm.endsOn} onChange={(event) => setEndsOn(event.target.value)} /></label>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="form-actions"><button type="submit" className="button primary" disabled={Boolean(busy)}>{busy === 'prepare' ? 'กำลังเตรียม…' : 'เตรียมภาคเรียนถัดไป'}</button></div>
    </form>
  )
}
