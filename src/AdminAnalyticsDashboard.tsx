import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  buildAdminAnalytics,
  type AnalyticsFilters,
  type AnalyticsKindFilter,
} from './adminAnalytics'
import { currentLogicalBrowserRoute, replaceLogicalBrowserRoute } from './browserRoute'
import { formatThaiDate, type DemoState } from './domain'
import { EmptyState, Icon } from './ui'

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
  }
}

function replaceFilterLocation(filters: AnalyticsFilters) {
  if (typeof window === 'undefined') return
  const search = new URLSearchParams({ tab: 'overview' })
  if (filters.kind !== 'all') search.set('kind', filters.kind)
  if (filters.gradeLevel !== 'all') search.set('grade', filters.gradeLevel)
  if (filters.month !== 'all') search.set('month', filters.month)
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

export function AdminAnalyticsDashboard({ state }: { state: DemoState }) {
  const [filters, setFilters] = useState<AnalyticsFilters>(filtersFromLocation)
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null)
  const summary = useMemo(() => buildAdminAnalytics(state, filters), [filters, state])
  const selectedGradeLabel = summary.gradeOptions.find((option) => option.value === filters.gradeLevel)?.label
  const gradeMaximum = Math.max(1, ...summary.gradeRows.flatMap((row) => [row.deductionPoints, row.additionPoints]))
  const monthMaximum = Math.max(1, ...summary.monthRows.flatMap((row) => [row.deductionPoints, row.additionPoints]))
  const visibleTransactions = summary.transactions.slice(0, DETAIL_LIMIT)

  useEffect(() => {
    function readFilters() {
      setFilters(filtersFromLocation())
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
    replaceFilterLocation(next)
  }

  function resetFilters() {
    setExpandedStudentId(null)
    setFilters(DEFAULT_FILTERS)
    replaceFilterLocation(DEFAULT_FILTERS)
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
        <label>
          เดือนเกิดเหตุ
          <select
            aria-label="เดือนเกิดเหตุ"
            value={summary.monthOptions.some((option) => option.value === filters.month) ? filters.month : 'all'}
            onChange={(event) => updateFilter('month', event.target.value)}
          >
            <option value="all">ทุกเดือน</option>
            {summary.monthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <button className="button secondary analytics-reset" type="button" onClick={resetFilters}>ล้างตัวกรอง</button>
      </fieldset>

      <p className="analytics-caveat">
        <Icon name="history" size={17} /> สรุปตามวันเกิดเหตุจริง ไม่ใช่วันที่นำเข้าหรือวันที่บันทึกข้อมูล
      </p>

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
              <span role="columnheader">คะแนนปัจจุบัน</span>
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
                        <strong>{row.student.name}</strong>
                        <small>รหัส {row.student.studentCode}{row.student.roomNumber ? ` • ห้อง ${row.student.roomNumber}` : ''}</small>
                      </div>
                      <span className={`analytics-roster-number is-addition ${row.additionPoints ? 'analytics-positive' : 'is-zero'}`} role="cell" data-label="เพิ่ม">+{row.additionPoints}</span>
                      <span className={`analytics-roster-number is-deduction ${row.deductionPoints ? 'analytics-negative' : 'is-zero'}`} role="cell" data-label="ตัด">{deductedPoints(row.deductionPoints)}</span>
                      <span className={`analytics-roster-number is-net ${row.netPoints < 0 ? 'analytics-negative' : row.netPoints > 0 ? 'analytics-positive' : 'is-zero'}`} role="cell" data-label="สุทธิ">{signedPoints(row.netPoints)}</span>
                      <span className={`analytics-current-score${row.student.score < 50 ? ' is-low' : ''}`} role="cell" data-label="คะแนนปัจจุบัน">{row.student.score}</span>
                      <div className="analytics-latest" role="cell">
                        {row.latest ? (
                          <><strong>{row.latest.transaction.reason}</strong><small>{formatThaiDate(row.latest.occurredAt, false)} • {row.totalEvents} รายการ</small></>
                        ) : <span>ไม่มีรายการในช่วงนี้</span>}
                      </div>
                      <button
                        aria-controls={historyId}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'ซ่อน' : 'ดู'}ประวัติของ ${row.student.name}`}
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
                      <td><strong>{row.student.name}</strong><small>{row.student.studentCode}</small></td>
                      <td>{row.student.gradeLevel ? row.student.classroomName : '—'}</td>
                      <td>{row.transaction.reason}</td>
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
