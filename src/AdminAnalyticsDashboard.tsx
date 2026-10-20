import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  buildAdminAnalytics,
  historicalAnalyticsState,
  type AnalyticsState,
  CURRENT_SCORE_RISK_BANDS,
  type AnalyticsFilters,
  type AnalyticsKindFilter,
} from './adminAnalytics'
import { currentLogicalBrowserRoute, replaceLogicalBrowserRoute } from './browserRoute'
import { formatThaiDate, studentDisplayName, type DemoState } from './domain'
import { EmptyState, Icon } from './ui'
import { StudentAvatar } from './ProfileAvatar'
import type { AcademicTermSummary, TermHistory, TermManagementActions } from './termManagement'
import { termStatusLabel } from './termManagement'

const DEFAULT_FILTERS: AnalyticsFilters = {
  kind: 'all',
  gradeLevel: 'all',
  month: 'all',
}
const DETAIL_LIMIT = 100

function filtersFromLocation(): AnalyticsFilters {
  if (typeof window === 'undefined') return DEFAULT_FILTERS
  const search = new URLSearchParams(currentLogicalBrowserRoute().search)
  const kind = search.get('kind')
  return {
    kind: kind === 'deduction' || kind === 'addition' ? kind : 'all',
    gradeLevel: search.get('grade') || 'all',
    month: search.get('month') || 'all',
    fromDate: search.get('from') || '',
    toDate: search.get('to') || '',
  }
}

function riskBandFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  const riskBandId = new URLSearchParams(currentLogicalBrowserRoute().search).get('risk')
  return CURRENT_SCORE_RISK_BANDS.some((band) => band.id === riskBandId) ? riskBandId : null
}

function replaceFilterLocation(filters: AnalyticsFilters, riskBandId: string | null) {
  if (typeof window === 'undefined') return
  const search = new URLSearchParams({ tab: 'overview' })
  const term = new URLSearchParams(currentLogicalBrowserRoute().search).get('term')
  if (term) search.set('term', term)
  if (filters.kind !== 'all') search.set('kind', filters.kind)
  if (filters.gradeLevel !== 'all') search.set('grade', filters.gradeLevel)
  if (filters.month !== 'all') search.set('month', filters.month)
  if (filters.fromDate) search.set('from', filters.fromDate)
  if (filters.toDate) search.set('to', filters.toDate)
  if (riskBandId) search.set('risk', riskBandId)
  replaceLogicalBrowserRoute(`/admin/reports?${search.toString()}`)
}

function signedPoints(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

function deductedPoints(value: number): string {
  return value > 0 ? `−${value}` : '0'
}

function barStyle(value: number, maximum: number): CSSProperties {
  return { width: `${value ? Math.max(3, Math.round((value / maximum) * 100)) : 0}%` }
}

function thresholdDifferenceLabel(value: number): string {
  if (value < 0) return `ต่ำกว่าเกณฑ์ ${Math.abs(value)} คะแนน`
  if (value === 0) return 'ถึงเกณฑ์พอดี'
  return `สูงกว่าเกณฑ์ ${value} คะแนน`
}

export function AdminAnalyticsDashboard({ state, termActions }: { state: DemoState; termActions?: TermManagementActions | null }) {
  const [terms, setTerms] = useState<AcademicTermSummary[]>([])
  const [selectedTermId, setSelectedTermId] = useState(() => new URLSearchParams(currentLogicalBrowserRoute().search).get('term') || state.term.id)
  const [loaded, setLoaded] = useState<{ history: TermHistory; source: DemoState } | null>(null)
  const [termError, setTermError] = useState('')
  const [historyError, setHistoryError] = useState<{ termId: string; message: string } | null>(null)
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  const cache = useRef(new Map<string, { history: TermHistory; source: DemoState }>())
  const historical = selectedTermId !== state.term.id

  useEffect(() => {
    function readTerm() { setSelectedTermId(new URLSearchParams(currentLogicalBrowserRoute().search).get('term') || state.term.id) }
    window.addEventListener('popstate', readTerm)
    window.addEventListener('hashchange', readTerm)
    return () => { window.removeEventListener('popstate', readTerm); window.removeEventListener('hashchange', readTerm) }
  }, [state.term.id])

  useEffect(() => {
    if (!termActions) {
      if (historical) {
        setNotice('ระบบนี้ยังไม่รองรับสถิติย้อนหลัง แสดงภาคเรียนปัจจุบันแทน')
        setSelectedTermId(state.term.id)
        setHistoryError(null)
        const search = new URLSearchParams(currentLogicalBrowserRoute().search)
        search.delete('term')
        replaceLogicalBrowserRoute(`/admin/reports?${search}`)
      }
      return
    }
    let cancelled = false
    termActions.listAcademicTerms().then((next) => {
      if (cancelled) return
      const available = next.filter((term) => term.status !== 'planned' || term.id === state.term.id)
      setTerms(available)
      setTermError('')
      if (!available.some((term) => term.id === selectedTermId)) {
        setNotice('ไม่พบภาคเรียนที่เลือก แสดงภาคเรียนปัจจุบันแทน')
        setSelectedTermId(state.term.id)
        setHistoryError(null)
        const search = new URLSearchParams(currentLogicalBrowserRoute().search)
        search.delete('term')
        replaceLogicalBrowserRoute(`/admin/reports?${search}`)
      }
    }, (error: unknown) => { if (!cancelled) setTermError(error instanceof Error ? error.message : 'โหลดรายชื่อภาคเรียนไม่สำเร็จ') })
    return () => { cancelled = true }
  }, [termActions, state.term.id, selectedTermId, historical, retry])

  useEffect(() => {
    if (!historical || !termActions) return
    let cancelled = false
    setHistoryError(null)
    const cached = cache.current.get(selectedTermId)
    if (cached?.source === state) { setLoaded(cached); return }
    termActions.getTermHistory(selectedTermId).then((history) => {
      if (cancelled) return
      const value = { history, source: state }
      cache.current.set(selectedTermId, value)
      setLoaded(value)
    }, (error: unknown) => { if (!cancelled) setHistoryError({ termId: selectedTermId, message: error instanceof Error ? error.message : 'โหลดสถิติภาคเรียนนี้ไม่สำเร็จ' }) })
    return () => { cancelled = true }
  }, [historical, selectedTermId, termActions, state, retry])

  function selectTerm(value: string) {
    setSelectedTermId(value)
    setNotice('')
    setHistoryError(null)
    const search = new URLSearchParams({ tab: 'overview' })
    if (value !== state.term.id) search.set('term', value)
    replaceLogicalBrowserRoute(`/admin/reports?${search}`)
  }
  const termControl = <label>ภาคเรียน<select aria-label="ภาคเรียนสำหรับสถิติ" value={selectedTermId} onChange={(event) => selectTerm(event.target.value)} disabled={!termActions}>
    {!terms.some((term) => term.id === state.term.id) ? <option value={state.term.id}>{state.term.label} • ปัจจุบัน</option> : null}
    {terms.map((term) => <option key={term.id} value={term.id}>{term.name} • {termStatusLabel(term.status)}</option>)}
    {historical && !terms.some((term) => term.id === selectedTermId) ? <option value={selectedTermId}>กำลังค้นหาภาคเรียน…</option> : null}
  </select></label>
  const historicalReady = loaded?.history.term.id === selectedTermId && loaded.source === state
  const selectedHistory = historical && historicalReady ? loaded.history : null
  const reportState = useMemo(() => selectedHistory ? historicalAnalyticsState(state, selectedHistory) : state, [state, selectedHistory])
  const error = termError || (historyError?.termId === selectedTermId ? historyError.message : '') || (historical && !termActions ? 'ระบบนี้ยังไม่รองรับสถิติย้อนหลัง กรุณาเลือกภาคเรียนปัจจุบัน' : '')
  return <>
    {notice ? <p className="form-help" role="status">{notice}</p> : null}
    {error ? <section className="panel" role="alert"><p className="form-error">{error}</p><button type="button" className="button secondary" onClick={() => { cache.current.delete(selectedTermId); setRetry((value) => value + 1) }}>ลองโหลดใหม่</button></section> : null}
    {historical && !historicalReady ? <div className="analytics-dashboard"><h1>สถิติคะแนนเพิ่ม–ตัด</h1><fieldset className="analytics-filters"><legend>เลือกภาคเรียน</legend>{termControl}</fieldset>{!error ? <p role="status">กำลังโหลดสถิติของภาคเรียนที่เลือก…</p> : null}</div>
      : <AnalyticsReport key={selectedTermId} state={reportState} historical={historical} termControl={termControl} />}
  </>
}

function AnalyticsReport({ state, historical, termControl }: { state: AnalyticsState; historical: boolean; termControl: ReactNode }) {
  const [filters, setFilters] = useState<AnalyticsFilters>(filtersFromLocation)
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null)
  const [selectedRiskBandId, setSelectedRiskBandId] = useState<string | null>(riskBandFromLocation)
  const [expandedRiskStudentId, setExpandedRiskStudentId] = useState<string | null>(null)
  const summary = useMemo(() => buildAdminAnalytics(state, filters), [filters, state])
  const selectedGradeLabel = summary.gradeOptions.find((option) => option.value === filters.gradeLevel)?.label
  const gradeMaximum = Math.max(1, ...summary.gradeRows.flatMap((row) => [row.deductionPoints, row.additionPoints]))
  const monthMaximum = Math.max(1, ...summary.monthRows.flatMap((row) => [row.deductionPoints, row.additionPoints]))
  const visibleTransactions = summary.transactions.slice(0, DETAIL_LIMIT)
  const selectedRiskBand = summary.currentScoreRisk.bands.find((band) => band.id === selectedRiskBandId)
  const selectedRiskTone = selectedRiskBand
    ? summary.currentScoreRisk.bands.findIndex((band) => band.id === selectedRiskBand.id) + 1
    : 0
  const invalidRange = Boolean(filters.fromDate && filters.toDate && filters.fromDate > filters.toDate)

  useEffect(() => {
    function readFilters() {
      setFilters(filtersFromLocation())
      setSelectedRiskBandId(riskBandFromLocation())
      setExpandedRiskStudentId(null)
    }
    window.addEventListener('popstate', readFilters)
    window.addEventListener('hashchange', readFilters)
    return () => {
      window.removeEventListener('popstate', readFilters)
      window.removeEventListener('hashchange', readFilters)
    }
  }, [])

  function updateFilter<Key extends keyof AnalyticsFilters>(key: Key, value: AnalyticsFilters[Key]) {
    const next = { ...filters, [key]: value }
    setExpandedStudentId(null)
    setFilters(next)
    replaceFilterLocation(next, selectedRiskBandId)
  }

  function resetFilters() {
    setExpandedStudentId(null)
    setExpandedRiskStudentId(null)
    setSelectedRiskBandId(null)
    setFilters(DEFAULT_FILTERS)
    replaceFilterLocation(DEFAULT_FILTERS, null)
  }

  function selectRiskBand(riskBandId: string) {
    const nextRiskBandId = selectedRiskBandId === riskBandId ? null : riskBandId
    setExpandedRiskStudentId(null)
    setSelectedRiskBandId(nextRiskBandId)
    replaceFilterLocation(filters, nextRiskBandId)
  }

  return (
    <div className="analytics-dashboard">
      <header className="analytics-hero">
        <div>
          <p className="eyebrow">ข้อมูลทั้งโรงเรียน</p>
          <h1>สถิติคะแนนเพิ่ม–ตัด</h1>
          <p>เปรียบเทียบทุกระดับชั้นและเลือกดูตามเดือนที่เกิดเหตุ</p>
        </div>
        <span className="class-chip"><Icon name="calendar" size={17} /> {state.term.label}</span>
      </header>

      <fieldset className="analytics-filters">
        <legend>ตัวกรองสถิติ</legend>
        {termControl}
        <label>เดือนเกิดเหตุ<select aria-label="เดือนเกิดเหตุ" value={summary.monthOptions.some((option) => option.value === filters.month) ? filters.month : 'all'} onChange={(event) => updateFilter('month', event.target.value)}>
          <option value="all">ทุกเดือนของภาคเรียน</option>
          {summary.monthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        <label>
          ประเภทคะแนน
          <select
            aria-label="ประเภทคะแนน"
            value={filters.kind}
            onChange={(event) => updateFilter('kind', event.target.value as AnalyticsKindFilter)}
          >
            <option value="all">เพิ่มและตัดคะแนน</option>
            <option value="deduction">ตัดคะแนนเท่านั้น</option>
            <option value="addition">เพิ่มคะแนนเท่านั้น</option>
          </select>
        </label>
        <label>
          ระดับชั้น
          <select
            aria-label="ระดับชั้นสำหรับสถิติ"
            value={summary.gradeOptions.some((option) => option.value === filters.gradeLevel) ? filters.gradeLevel : 'all'}
            onChange={(event) => updateFilter('gradeLevel', event.target.value)}
          >
            <option value="all">ทุกระดับชั้น</option>
            {summary.gradeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>ตั้งแต่วันที่<input type="date" aria-label="สถิติตั้งแต่วันที่" value={filters.fromDate || ''} max={filters.toDate || undefined} onChange={(event) => updateFilter('fromDate', event.target.value)} /></label>
        <label>ถึงวันที่<input type="date" aria-label="สถิติถึงวันที่" value={filters.toDate || ''} min={filters.fromDate || undefined} onChange={(event) => updateFilter('toDate', event.target.value)} /></label>
        <button className="button secondary analytics-reset" type="button" onClick={resetFilters}>ล้างตัวกรอง</button>
      </fieldset>
      {invalidRange ? <p className="form-error" role="alert">วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น กรุณาแก้ช่วงวันที่</p> : null}

      <p className="analytics-caveat">
        <Icon name="history" size={17} /> สรุปตามวันเกิดเหตุจริง ไม่ใช่วันที่นำเข้าหรือวันที่บันทึกข้อมูล
      </p>
      <p className="form-help">เลือกเดือนได้ครบตามวันเปิด–ปิดภาคเรียน รวมเดือนที่ไม่มีรายการ และเดือนหลังปิดภาคที่มีกิจกรรมแก้คะแนน ช่วงวันที่ใช้ร่วมกับตัวกรองเดือนตามเวลาไทย</p>
      {state.dateFallbackCount ? <p className="form-help" role="status">มี {state.dateFallbackCount} รายการที่ไม่พบวันเกิดเหตุเดิม จึงใช้วันที่บันทึกแทน</p> : null}
      {historical ? <p className="form-help">ใช้รายชื่อและชั้นเรียนของภาคเรียนที่เลือก คะแนนปิดภาคเก็บไว้เป็นหลักฐาน ส่วนคะแนนล่าสุดรวมผลแก้ไขและอุทธรณ์แล้ว</p> : null}
      {summary.missingScoreCount ? <p className="form-help">นักเรียน {summary.missingScoreCount} คนไม่มีบัญชีคะแนน จึงไม่รวมในการกระจายคะแนน และแสดงคะแนนเป็น —</p> : null}
      <p className="form-help">สถิติรวมผลอุทธรณ์สุทธิ {signedPoints(summary.appealPoints)} คะแนน และกิจกรรมแก้คะแนนภาคเรียนเดิม {summary.remediationPoints} คะแนน ไม่รวมการเปิดบัญชีหรือปรับยอดโดยผู้ดูแล</p>

      <section className="analytics-metrics" aria-label="ตัวเลขสรุปคะแนน">
        <article>
          <span className="analytics-metric-icon neutral"><Icon name="users" /></span>
          <div><strong>{summary.scopeStudentCount.toLocaleString('th-TH')}</strong><small>นักเรียนในขอบเขต • {summary.totalEvents} รายการ</small></div>
        </article>
        <article>
          <span className="analytics-metric-icon deduction">−</span>
          <div><strong>{summary.deductionPoints.toLocaleString('th-TH')}</strong><small>คะแนนที่ถูกตัด • {summary.deductionCount} รายการ</small></div>
        </article>
        <article>
          <span className="analytics-metric-icon addition">+</span>
          <div><strong>{summary.additionPoints.toLocaleString('th-TH')}</strong><small>คะแนนที่เพิ่ม • {summary.additionCount} รายการ</small></div>
        </article>
        <article>
          <span className={`analytics-metric-icon ${summary.netPoints < 0 ? 'deduction' : 'addition'}`}><Icon name="history" /></span>
          <div><strong>{signedPoints(summary.netPoints)}</strong><small>ผลต่างสุทธิ</small></div>
        </article>
      </section>

      <section className="analytics-panel analytics-risk-panel" aria-labelledby="current-risk-title">
        <div className="analytics-risk-heading">
          <div>
            <p className="eyebrow">{historical ? 'คะแนนล่าสุดหลังแก้ของภาคเรียนที่เลือก' : 'คะแนนปัจจุบันทุกระดับชั้น'}</p>
            <h2 id="current-risk-title">
              {summary.currentScoreRisk.belowThresholdCount
                ? `${summary.currentScoreRisk.belowThresholdCount} คนต่ำกว่าเกณฑ์ 80 คะแนน`
                : 'ไม่มีนักเรียนต่ำกว่าเกณฑ์ 80 คะแนน'}
            </h2>
            <p>เลือกช่วงคะแนนเพื่อดูรายชื่อ เรียงจากคะแนนต่ำที่สุดก่อน</p>
          </div>
          <div className="analytics-risk-summary" aria-label={historical ? 'สรุปความเสี่ยงจากคะแนนล่าสุดของภาคเรียนที่เลือก' : 'สรุปความเสี่ยงจากคะแนนปัจจุบัน'}>
            <span><strong>{summary.currentScoreRisk.studentCount}</strong> นักเรียนทั้งหมด</span>
            <span className="is-danger"><strong>{summary.currentScoreRisk.belowThresholdCount}</strong> ต่ำกว่าเกณฑ์</span>
            <span className="is-watch"><strong>{summary.currentScoreRisk.nearThresholdCount}</strong> ช่วง 80–89</span>
          </div>
        </div>

        <p className="analytics-risk-note">
          <Icon name="alert" size={17} /> แสดงคะแนน{historical ? 'ล่าสุดของภาคเรียนที่เลือก' : 'ปัจจุบัน'}ทุกระดับชั้น ไม่เปลี่ยนตามตัวกรองประเภท ระดับชั้น เดือน หรือช่วงวันที่ด้านบน
        </p>

        <div className="analytics-risk-bands" role="group" aria-label={historical ? 'การกระจายคะแนนล่าสุดของภาคเรียนที่เลือกช่วงละ 10 คะแนน' : 'การกระจายคะแนนปัจจุบันช่วงละ 10 คะแนน'}>
          {summary.currentScoreRisk.bands.map((band, index) => {
            const selected = band.id === selectedRiskBandId
            return (
              <button
                aria-controls={selected ? 'analytics-risk-results' : undefined}
                aria-label={`ช่วงคะแนน ${band.minScore} ถึง ${band.maxScore} ${band.riskLabel} ${band.studentCount} คน`}
                aria-pressed={selected}
                className={`analytics-risk-band risk-tone-${index + 1}`}
                key={band.id}
                type="button"
                onClick={() => selectRiskBand(band.id)}
              >
                <span className="analytics-risk-band-label"><strong>{band.scoreLabel}</strong><small>{band.riskLabel}</small></span>
                <span className="analytics-risk-band-count"><strong>{band.studentCount}</strong><small>คน • {band.percentage}%</small></span>
                <span className="analytics-risk-band-meter" aria-hidden="true"><i style={{ width: `${band.percentage}%` }} /></span>
              </button>
            )
          })}
        </div>

        {selectedRiskBand ? (
          <div className={`analytics-risk-results risk-tone-${selectedRiskTone}`} id="analytics-risk-results">
            <div className="analytics-risk-results-heading">
              <div><p className="eyebrow">รายชื่อนักเรียนทุกระดับชั้น</p><h3>ช่วง {selectedRiskBand.scoreLabel} คะแนน • {selectedRiskBand.studentCount} คน</h3></div>
              <button className="button ghost compact" type="button" onClick={() => selectRiskBand(selectedRiskBand.id)}>ซ่อนรายชื่อ</button>
            </div>
            {selectedRiskBand.students.length ? (
              <div className="analytics-risk-roster" role="table" aria-label={`นักเรียนช่วงคะแนน ${selectedRiskBand.minScore} ถึง ${selectedRiskBand.maxScore}`}>
                <div className="analytics-risk-columns" role="row">
                  <span role="columnheader">นักเรียน</span>
                  <span role="columnheader">ชั้น / ห้อง</span>
                  <span role="columnheader">{historical ? 'ปิดภาค / ล่าสุด' : 'คะแนนปัจจุบัน'}</span>
                  <span role="columnheader">เทียบเกณฑ์ 80</span>
                  <span role="columnheader">การตัดคะแนนล่าสุด</span>
                  <span className="sr-only" role="columnheader">เปิดประวัติ</span>
                </div>
                <div role="rowgroup">
                  {selectedRiskBand.students.map((row) => {
                    const expanded = expandedRiskStudentId === row.student.id
                    const historyId = `analytics-risk-history-${row.student.id}`
                    return (
                      <article className={`analytics-risk-student${expanded ? ' is-expanded' : ''}`} key={row.student.id}>
                        <div className="analytics-risk-row" role="row">
                          <div className="student-name-cell" role="cell"><StudentAvatar student={row.student} /><span><strong>{studentDisplayName(row.student)}</strong><small>รหัส {row.student.studentCode}</small></span></div>
                          <span className="analytics-risk-class" data-label="ชั้น / ห้อง" role="cell">{row.student.classroomName || 'ยังไม่ระบุห้อง'}</span>
                          <strong className="analytics-risk-score" data-label={historical ? 'ปิดภาค / ล่าสุด' : 'คะแนนปัจจุบัน'} role="cell">{historical ? `${row.student.closingScore ?? '—'} / ` : ''}{row.student.score}</strong>
                          <span className={row.differenceFromThreshold < 0 ? 'analytics-risk-gap is-negative' : 'analytics-risk-gap is-positive'} data-label="เทียบเกณฑ์" role="cell">{thresholdDifferenceLabel(row.differenceFromThreshold)}</span>
                          <div className="analytics-risk-latest" role="cell">
                            {row.latestDeduction
                              ? <><strong>{row.latestDeduction.transaction.reason}</strong><small>{formatThaiDate(row.latestDeduction.occurredAt, false)}</small></>
                              : <span>ยังไม่มีรายการตัดคะแนน</span>}
                          </div>
                          <button
                            aria-controls={historyId}
                            aria-expanded={expanded}
                            aria-label={`${expanded ? 'ซ่อน' : 'ดู'}ประวัติคะแนนของ ${studentDisplayName(row.student)}`}
                            className="analytics-expand-button"
                            type="button"
                            onClick={() => setExpandedRiskStudentId(expanded ? null : row.student.id)}
                          >
                            <Icon name="chevronRight" size={19} />
                          </button>
                        </div>
                        {expanded ? (
                          <div className="analytics-student-history" id={historyId}>
                            <div className="analytics-history-heading"><strong>ประวัติคะแนนภาคเรียนที่เลือก</strong><small>{row.transactions.length} รายการ</small></div>
                            {row.transactions.length ? row.transactions.map((item) => (
                              <div className="analytics-history-row" key={item.transaction.id}>
                                <time dateTime={item.occurredAt}>{formatThaiDate(item.occurredAt, false)}</time>
                                <span>{item.transaction.reason}</span>
                                <strong className={item.transaction.kind === 'deduction' ? 'analytics-negative' : 'analytics-positive'}>{item.transaction.kind === 'deduction' ? '−' : '+'}{item.points}</strong>
                              </div>
                            )) : <p className="analytics-history-empty">นักเรียนคนนี้ยังไม่มีรายการคะแนนในภาคเรียนที่เลือก</p>}
                          </div>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              </div>
            ) : <EmptyState title="ไม่มีนักเรียนในช่วงคะแนนนี้" detail="เลือกช่วงคะแนนอื่นเพื่อดูรายชื่อ" />}
          </div>
        ) : null}
      </section>

      {selectedGradeLabel ? (
        <section className="analytics-panel analytics-roster-panel" aria-labelledby="student-roster-title">
          <div className="analytics-roster-heading">
            <div>
              <p className="eyebrow">ข้อมูลรายบุคคล</p>
              <h2 id="student-roster-title">รายชื่อนักเรียน {selectedGradeLabel} • {summary.studentRows.length} คน</h2>
              <p>แสดงนักเรียนครบทุกคนตามรหัสนักเรียน แม้ไม่มีรายการคะแนนในช่วงที่เลือก</p>
            </div>
            <div className="analytics-roster-heading-side">
              <span className="analytics-all-chip"><Icon name="check" size={15} /> ทุกคน</span>
              <dl className="analytics-roster-summary" aria-label={`สรุป ${selectedGradeLabel}`}>
                <div><dt>นักเรียน</dt><dd>{summary.studentRows.length} คน</dd></div>
                <div><dt>ตัด</dt><dd className="analytics-negative">{summary.deductionPoints}</dd></div>
                <div><dt>เพิ่ม</dt><dd className="analytics-positive">{summary.additionPoints}</dd></div>
                <div><dt>สุทธิ</dt><dd className={summary.netPoints < 0 ? 'analytics-negative' : 'analytics-positive'}>{signedPoints(summary.netPoints)}</dd></div>
              </dl>
            </div>
          </div>

          <div className="analytics-roster" role="table" aria-label={`รายชื่อนักเรียน ${selectedGradeLabel} เรียงตามรหัสนักเรียน`}>
            <div className="analytics-roster-columns" role="row">
              <span role="columnheader">นักเรียน / รหัส</span>
              <span role="columnheader">เพิ่ม</span>
              <span role="columnheader">ตัด</span>
              <span role="columnheader">สุทธิ</span>
              <span role="columnheader">{historical ? 'ปิดภาค / ล่าสุด' : 'คะแนนปัจจุบัน'}</span>
              <span role="columnheader">รายการล่าสุด</span>
              <span role="columnheader" className="sr-only">เปิดประวัติ</span>
            </div>
            <div role="rowgroup">
              {summary.studentRows.map((row) => {
                const expanded = expandedStudentId === row.student.id
                const historyId = `analytics-history-${row.student.id}`
                return (
                  <article className={`analytics-student-entry${expanded ? ' is-expanded' : ''}`} key={row.student.id}>
                    <div className="analytics-student-row" role="row">
                      <div className="analytics-student-name" role="cell">
                        <StudentAvatar student={row.student} />
                        <span><strong>{studentDisplayName(row.student)}</strong><small>รหัส {row.student.studentCode}{row.student.roomNumber ? ` • ห้อง ${row.student.roomNumber}` : ''}</small></span>
                      </div>
                      <span className={`analytics-roster-number is-addition ${row.additionPoints ? 'analytics-positive' : 'is-zero'}`} role="cell" data-label="เพิ่ม">+{row.additionPoints}</span>
                      <span className={`analytics-roster-number is-deduction ${row.deductionPoints ? 'analytics-negative' : 'is-zero'}`} role="cell" data-label="ตัด">{deductedPoints(row.deductionPoints)}</span>
                      <span className={`analytics-roster-number is-net ${row.netPoints < 0 ? 'analytics-negative' : row.netPoints > 0 ? 'analytics-positive' : 'is-zero'}`} role="cell" data-label="สุทธิ">{signedPoints(row.netPoints)}</span>
                      <span className={`analytics-current-score${row.student.score !== null && row.student.score < 50 ? ' is-low' : ''}`} role="cell" data-label={historical ? 'ปิดภาค / ล่าสุด' : 'คะแนนปัจจุบัน'}>{historical ? `${row.student.closingScore ?? '—'} / ` : ''}{row.student.score ?? '—'}</span>
                      <div className="analytics-latest" role="cell">
                        {row.latest ? (
                          <><strong>{row.latest.transaction.reason}</strong><small>{formatThaiDate(row.latest.occurredAt, false)} • {row.totalEvents} รายการ</small></>
                        ) : <span>ไม่มีรายการในช่วงนี้</span>}
                      </div>
                      <button
                        aria-controls={historyId}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'ซ่อน' : 'ดู'}ประวัติของ ${studentDisplayName(row.student)}`}
                        className="analytics-expand-button"
                        type="button"
                        onClick={() => setExpandedStudentId(expanded ? null : row.student.id)}
                      >
                        <Icon name="chevronRight" size={19} />
                      </button>
                    </div>
                    {expanded ? (
                      <div className="analytics-student-history" id={historyId}>
                        <div className="analytics-history-heading">
                          <strong>ประวัติที่ตรงกับตัวกรอง</strong>
                          <small>{row.totalEvents} รายการ</small>
                        </div>
                        {row.transactions.length ? row.transactions.map((item) => (
                          <div className="analytics-history-row" key={item.transaction.id}>
                            <time dateTime={item.occurredAt}>{formatThaiDate(item.occurredAt, false)}</time>
                            <span>{item.transaction.reason}</span>
                            <strong className={item.transaction.kind === 'deduction' ? 'analytics-negative' : 'analytics-positive'}>
                              {item.transaction.kind === 'deduction' ? '−' : '+'}{item.points}
                            </strong>
                          </div>
                        )) : <p className="analytics-history-empty">นักเรียนคนนี้ไม่มีรายการคะแนนในช่วงที่เลือก</p>}
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
          </div>
        </section>
      ) : (
        <section className="analytics-roster-prompt" aria-label="คำแนะนำการดูรายชื่อนักเรียน">
          <span><Icon name="users" size={22} /></span>
          <div><strong>เลือกระดับชั้นเพื่อดูรายชื่อนักเรียนครบทุกคน</strong><p>ระบบจะเรียงตามรหัสนักเรียน และแสดงทั้งผู้ที่มีและไม่มีรายการคะแนน</p></div>
        </section>
      )}

      <div className="analytics-primary-grid">
        <section className="analytics-panel" aria-labelledby="grade-chart-title">
          <div className="analytics-section-heading">
            <div><p className="eyebrow">เปรียบเทียบรายชั้น</p><h2 id="grade-chart-title">คะแนนเพิ่มและตัดทุกระดับชั้น</h2></div>
          </div>
          <div className="analytics-legend" aria-label="คำอธิบายสี">
            <span><i className="deduction" /> ตัดคะแนน</span>
            <span><i className="addition" /> เพิ่มคะแนน</span>
          </div>
          <div className="analytics-bar-list">
            {summary.gradeRows.map((row) => (
              <article key={row.gradeLevel}>
                <div className="analytics-bar-label"><strong>{row.gradeLabel}</strong><small>{row.studentsAffected}/{row.studentCount} คนมีรายการ</small></div>
                <div className="analytics-bars">
                  <div aria-label={`${row.gradeLabel} ตัด ${row.deductionPoints} คะแนน`}>
                    <span className="deduction" style={barStyle(row.deductionPoints, gradeMaximum)} />
                    <b>{deductedPoints(row.deductionPoints)}</b>
                  </div>
                  <div aria-label={`${row.gradeLabel} เพิ่ม ${row.additionPoints} คะแนน`}>
                    <span className="addition" style={barStyle(row.additionPoints, gradeMaximum)} />
                    <b>+{row.additionPoints}</b>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="analytics-panel" aria-labelledby="month-chart-title">
          <div className="analytics-section-heading">
            <div><p className="eyebrow">แนวโน้มรายเดือน</p><h2 id="month-chart-title">คะแนนตามเดือนเกิดเหตุ</h2></div>
          </div>
          {summary.monthRows.length ? (
            <div className="analytics-month-list">
              {summary.monthRows.map((row) => (
                <article key={row.month}>
                  <strong>{row.label}</strong>
                  <div className="analytics-month-track" aria-label={`${row.label} ตัด ${row.deductionPoints} คะแนน`}>
                    <span className="deduction" style={barStyle(row.deductionPoints, monthMaximum)} />
                    <b>ตัด {row.deductionPoints}</b>
                  </div>
                  <div className="analytics-month-track" aria-label={`${row.label} เพิ่ม ${row.additionPoints} คะแนน`}>
                    <span className="addition" style={barStyle(row.additionPoints, monthMaximum)} />
                    <b>เพิ่ม {row.additionPoints}</b>
                  </div>
                </article>
              ))}
            </div>
          ) : <EmptyState title="ยังไม่มีข้อมูลรายเดือน" detail="เมื่อมีการเพิ่มหรือตัดคะแนน ระบบจะแสดงข้อมูลตามเดือนที่เกิดเหตุ" />}
        </section>
      </div>

      <section className="analytics-panel analytics-grade-table-panel" aria-labelledby="grade-table-title">
        <div className="analytics-section-heading">
          <div><p className="eyebrow">ตัวเลขตรวจสอบ</p><h2 id="grade-table-title">สรุปคะแนนรายระดับชั้น</h2></div>
        </div>
        <div className="analytics-table-scroll">
          <table className="analytics-table">
            <thead><tr><th>ระดับชั้น</th><th>นักเรียนที่มีรายการ</th><th>ตัดคะแนน</th><th>เพิ่มคะแนน</th><th>สุทธิ</th></tr></thead>
            <tbody>
              {summary.gradeRows.map((row) => (
                <tr key={row.gradeLevel}>
                  <th scope="row">{row.gradeLabel}</th>
                  <td>{row.studentsAffected} จาก {row.studentCount} คน</td>
                  <td className="analytics-negative">{deductedPoints(row.deductionPoints)} <small>({row.deductionCount} รายการ)</small></td>
                  <td className="analytics-positive">+{row.additionPoints} <small>({row.additionCount} รายการ)</small></td>
                  <td className={row.netPoints < 0 ? 'analytics-negative' : 'analytics-positive'}>{signedPoints(row.netPoints)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="analytics-panel analytics-detail-panel" aria-labelledby="detail-title">
        <div className="analytics-section-heading">
          <div><p className="eyebrow">รายการตามตัวกรอง</p><h2 id="detail-title">รายละเอียดคะแนน</h2></div>
          <span className="counter">{summary.transactions.length}</span>
        </div>
        {visibleTransactions.length ? (
          <>
            <div className="analytics-table-scroll">
              <table className="analytics-table analytics-detail-table">
                <thead><tr><th>วันที่เกิดเหตุ</th><th>นักเรียน</th><th>ชั้น</th><th>รายการ</th><th>คะแนน</th></tr></thead>
                <tbody>
                  {visibleTransactions.map((row) => (
                    <tr key={row.transaction.id}>
                      <td>{formatThaiDate(row.occurredAt, false)}</td>
                      <td><div className="student-name-cell"><StudentAvatar student={row.student} /><span><strong>{studentDisplayName(row.student)}</strong><small>{row.student.studentCode}</small></span></div></td>
                      <td>{row.student.gradeLevel ? row.student.classroomName : '—'}</td>
                      <td>{row.transaction.reason}{row.transaction.ledgerEntryType === 'remediation_credit' ? <small> • กิจกรรมแก้คะแนนภาคเรียนเดิม</small> : row.transaction.additionSource === 'appeal' ? <small> • ผลอุทธรณ์</small> : null}</td>
                      <td className={row.transaction.kind === 'deduction' ? 'analytics-negative' : 'analytics-positive'}>
                        {row.transaction.kind === 'deduction' ? '−' : '+'}{row.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {summary.transactions.length > DETAIL_LIMIT ? <p className="analytics-limit-note">แสดง {DETAIL_LIMIT} รายการล่าสุดจากทั้งหมด {summary.transactions.length} รายการ กรุณาเลือกเดือนหรือระดับชั้นเพื่อดูรายละเอียดที่แคบลง</p> : null}
          </>
        ) : <EmptyState title="ไม่พบรายการตามตัวกรอง" detail="ลองเลือกทุกเดือน ทุกระดับชั้น หรือเปลี่ยนประเภทคะแนน" />}
      </section>
    </div>
  )
}
