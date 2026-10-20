import type { DemoState, ScoreTransaction, Student } from './domain'
import { formatGradeLabel } from './studentSelection'
import type { TermHistory } from './termManagement'

export type AnalyticsKindFilter = 'all' | 'deduction' | 'addition'

export interface AnalyticsFilters {
  kind: AnalyticsKindFilter
  gradeLevel: string
  month: string
  fromDate?: string
  toDate?: string
}

export type AnalyticsStudent = Omit<Student, 'score'> & { score: number | null; closingScore?: number | null }
export type AnalyticsState = Pick<DemoState, 'term' | 'transactions'> & {
  students: AnalyticsStudent[]
  dateFallbackCount?: number
}

/** Historical grades and scores belong to that term, even after promotion or graduation. */
export function historicalAnalyticsState(state: DemoState, history: TermHistory): AnalyticsState {
  const rawById = new Map(state.transactions.map((entry) => [entry.id, entry]))
  let dateFallbackCount = 0
  const transactions: ScoreTransaction[] = history.students.flatMap((student) => student.history.map((entry) => {
    const raw = rawById.get(entry.id)
    const matchingRaw = raw?.termId === history.term.id && raw.studentId === student.studentId ? raw : undefined
    if (entry.entryType === 'deduction' && !matchingRaw) dateFallbackCount += 1
    return {
      ...matchingRaw,
      id: entry.id, studentId: student.studentId, termId: history.term.id,
      kind: entry.entryType === 'semester_opening' ? 'reset'
        : entry.entryType === 'admin_adjustment' ? 'adjustment'
          : entry.entryType === 'deduction' || entry.appliedDelta < 0 ? 'deduction' : 'addition',
      ledgerEntryType: entry.entryType,
      requestedDelta: entry.requestedDelta, appliedDelta: entry.appliedDelta,
      scoreBefore: entry.balanceBefore, scoreAfter: entry.balanceAfter,
      reason: entry.reason, actorId: matchingRaw?.actorId ?? '',
      occurredAt: matchingRaw?.occurredAt ?? entry.activityOccurredAt ?? entry.createdAt,
      activityOccurredAt: entry.activityOccurredAt,
      remediationRequestId: entry.remediationRequestId,
      additionSource: entry.entryType === 'appeal_reversal' || entry.entryType === 'appeal_adjustment' ? 'appeal' : matchingRaw?.additionSource,
    }
  }))
  return {
    term: { ...state.term, id: history.term.id, label: history.term.name, startsOn: history.term.startsOn, endsOn: history.term.endsOn, isActive: false },
    students: history.students.filter((student) => student.enrolled || student.latestScore !== null || student.closingScore !== null).map((student) => ({
      id: student.studentId, studentCode: student.studentCode, name: student.name, nickname: student.nickname,
      classroomId: '', classroomName: student.classroomName ?? 'ไม่ระบุห้องเรียน', gradeLevel: student.gradeLevel ?? 'ไม่ระบุชั้น',
      roomNumber: student.roomNumber, status: 'active', score: student.latestScore, closingScore: student.closingScore,
    })), transactions, dateFallbackCount,
  }
}

export interface AnalyticsTransaction {
  transaction: ScoreTransaction
  student: AnalyticsStudent
  occurredAt: string
  month: string
  points: number
}

export interface AnalyticsGradeRow {
  gradeLevel: string
  gradeLabel: string
  studentCount: number
  studentsAffected: number
  deductionCount: number
  deductionPoints: number
  additionCount: number
  additionPoints: number
  netPoints: number
}

export interface AnalyticsMonthRow {
  month: string
  label: string
  deductionCount: number
  deductionPoints: number
  additionCount: number
  additionPoints: number
  netPoints: number
}

export interface AnalyticsStudentRow {
  student: AnalyticsStudent
  transactions: AnalyticsTransaction[]
  totalEvents: number
  deductionCount: number
  deductionPoints: number
  additionCount: number
  additionPoints: number
  netPoints: number
  latest?: AnalyticsTransaction
}

export interface AnalyticsCurrentScoreRiskStudent {
  student: AnalyticsStudent & { score: number }
  differenceFromThreshold: number
  transactions: AnalyticsTransaction[]
  latestDeduction?: AnalyticsTransaction
}

export interface AnalyticsCurrentScoreRiskBand {
  id: string
  minScore: number
  maxScore: number
  scoreLabel: string
  riskLabel: string
  studentCount: number
  percentage: number
  students: AnalyticsCurrentScoreRiskStudent[]
}

export interface AnalyticsCurrentScoreRisk {
  threshold: number
  studentCount: number
  belowThresholdCount: number
  nearThresholdCount: number
  bands: AnalyticsCurrentScoreRiskBand[]
}

export interface AdminAnalyticsSummary {
  transactions: AnalyticsTransaction[]
  studentRows: AnalyticsStudentRow[]
  gradeRows: AnalyticsGradeRow[]
  monthRows: AnalyticsMonthRow[]
  gradeOptions: Array<{ value: string; label: string }>
  monthOptions: Array<{ value: string; label: string }>
  totalEvents: number
  deductionCount: number
  deductionPoints: number
  additionCount: number
  additionPoints: number
  netPoints: number
  scopeStudentCount: number
  remediationPoints: number
  appealPoints: number
  missingScoreCount: number
  currentScoreRisk: AnalyticsCurrentScoreRisk
}

const BANGKOK_TIME_ZONE = 'Asia/Bangkok'
const GRADE_ORDER = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'M1', 'M2', 'M3']
export const CURRENT_SCORE_THRESHOLD = 80
export const CURRENT_SCORE_RISK_BANDS = [
  { id: '0-9', minScore: 0, maxScore: 9, scoreLabel: '0–9', riskLabel: 'เร่งด่วนที่สุด' },
  { id: '10-19', minScore: 10, maxScore: 19, scoreLabel: '10–19', riskLabel: 'วิกฤตมาก' },
  { id: '20-29', minScore: 20, maxScore: 29, scoreLabel: '20–29', riskLabel: 'วิกฤต' },
  { id: '30-39', minScore: 30, maxScore: 39, scoreLabel: '30–39', riskLabel: 'รุนแรง' },
  { id: '40-49', minScore: 40, maxScore: 49, scoreLabel: '40–49', riskLabel: 'เสี่ยงสูงมาก' },
  { id: '50-59', minScore: 50, maxScore: 59, scoreLabel: '50–59', riskLabel: 'เสี่ยงสูง' },
  { id: '60-69', minScore: 60, maxScore: 69, scoreLabel: '60–69', riskLabel: 'เสี่ยงปานกลาง' },
  { id: '70-79', minScore: 70, maxScore: 79, scoreLabel: '70–79', riskLabel: 'เสี่ยงเล็กน้อย' },
  { id: '80-89', minScore: 80, maxScore: 89, scoreLabel: '80–89', riskLabel: 'ผ่านเกณฑ์ ควรติดตาม' },
  { id: '90-100', minScore: 90, maxScore: 100, scoreLabel: '90–100', riskLabel: 'ปลอดภัย' },
] as const
const monthPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BANGKOK_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
})
const thaiMonthFormatter = new Intl.DateTimeFormat('th-TH', {
  timeZone: BANGKOK_TIME_ZONE,
  year: 'numeric',
  month: 'long',
})
const thaiDayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: BANGKOK_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

function gradeRank(gradeLevel: string): number {
  const index = GRADE_ORDER.indexOf(gradeLevel)
  return index === -1 ? GRADE_ORDER.length : index
}

export function analyticsOccurredAt(transaction: ScoreTransaction): string {
  if (transaction.kind === 'addition' && transaction.activityOccurredAt) {
    return transaction.activityOccurredAt
  }
  return transaction.occurredAt
}

export function analyticsMonthKey(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const parts = monthPartsFormatter.formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return year && month ? `${year}-${month}` : ''
}

export function analyticsMonthLabel(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return month
  const date = new Date(`${month}-15T12:00:00+07:00`)
  return Number.isFinite(date.getTime()) ? thaiMonthFormatter.format(date) : month
}

function summarizeRows(rows: AnalyticsTransaction[]) {
  let deductionCount = 0
  let deductionPoints = 0
  let additionCount = 0
  let additionPoints = 0

  for (const row of rows) {
    if (row.transaction.kind === 'deduction') {
      deductionCount += 1
      deductionPoints += row.points
    } else {
      additionCount += 1
      additionPoints += row.points
    }
  }

  return {
    deductionCount,
    deductionPoints,
    additionCount,
    additionPoints,
    netPoints: additionPoints - deductionPoints,
  }
}

export function compareStudentCodes(left: Pick<Student, 'studentCode' | 'name'>, right: Pick<Student, 'studentCode' | 'name'>): number {
  return left.studentCode.localeCompare(right.studentCode, 'th', {
    numeric: true,
    sensitivity: 'base',
  }) || left.name.localeCompare(right.name, 'th')
}

export function buildAdminAnalytics(state: AnalyticsState, filters: AnalyticsFilters): AdminAnalyticsSummary {
  const studentById = new Map(state.students.map((student) => [student.id, student]))
  const gradeLevels = [...new Set(state.students
    .filter((student) => student.status === 'active' && student.gradeLevel)
    .map((student) => student.gradeLevel as string))]
    .sort((left, right) => gradeRank(left) - gradeRank(right) || left.localeCompare(right))
  const gradeOptions = gradeLevels.map((gradeLevel) => ({
    value: gradeLevel,
    label: formatGradeLabel(gradeLevel),
  }))

  const allTermRows: AnalyticsTransaction[] = []
  for (const transaction of state.transactions) {
    if (transaction.termId !== state.term.id || transaction.kind === 'reset' || transaction.kind === 'adjustment') continue
    const student = studentById.get(transaction.studentId)
    if (!student || !student.gradeLevel) continue
    const occurredAt = analyticsOccurredAt(transaction)
    const month = analyticsMonthKey(occurredAt)
    if (!month) continue
    allTermRows.push({
      transaction,
      student,
      occurredAt,
      month,
      points: Math.abs(transaction.appliedDelta),
    })
  }

  const months = new Set(allTermRows.map((row) => row.month))
  const firstMonth = state.term.startsOn?.slice(0, 7)
  const lastMonth = state.term.endsOn?.slice(0, 7)
  if (firstMonth && lastMonth && /^\d{4}-\d{2}$/.test(firstMonth) && /^\d{4}-\d{2}$/.test(lastMonth)) {
    const cursor = new Date(`${firstMonth}-01T00:00:00Z`)
    for (let count = 0; count < 240 && cursor.toISOString().slice(0, 7) <= lastMonth; count += 1) {
      months.add(cursor.toISOString().slice(0, 7))
      cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    }
  }
  const monthValues = [...months].sort((left, right) => right.localeCompare(left))
  const monthOptions = monthValues.map((month) => {
    const count = allTermRows.filter((row) => row.month === month).length
    return { value: month, label: `${analyticsMonthLabel(month)} • ${count ? `${count} รายการ` : 'ไม่มีรายการ'}` }
  })
  const allRowsByStudentId = new Map<string, AnalyticsTransaction[]>()
  for (const row of allTermRows) {
    const studentRows = allRowsByStudentId.get(row.student.id)
    if (studentRows) studentRows.push(row)
    else allRowsByStudentId.set(row.student.id, [row])
  }
  for (const rows of allRowsByStudentId.values()) {
    rows.sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()
      || right.transaction.id.localeCompare(left.transaction.id))
  }
  const currentScoreStudents = state.students
    .filter((student): student is AnalyticsStudent & { score: number } => student.status === 'active' && student.score !== null && Number.isFinite(student.score))
    .sort((left, right) => left.score - right.score || compareStudentCodes(left, right))
  const currentScoreRiskStudents = currentScoreStudents.map((student): AnalyticsCurrentScoreRiskStudent => {
    const rows = allRowsByStudentId.get(student.id) ?? []
    return {
      student,
      differenceFromThreshold: student.score - CURRENT_SCORE_THRESHOLD,
      transactions: rows,
      latestDeduction: rows.find((row) => row.transaction.kind === 'deduction'),
    }
  })
  const currentScoreRisk: AnalyticsCurrentScoreRisk = {
    threshold: CURRENT_SCORE_THRESHOLD,
    studentCount: currentScoreRiskStudents.length,
    belowThresholdCount: currentScoreRiskStudents.filter((row) => row.student.score < CURRENT_SCORE_THRESHOLD).length,
    nearThresholdCount: currentScoreRiskStudents.filter((row) => (
      row.student.score >= CURRENT_SCORE_THRESHOLD && row.student.score < CURRENT_SCORE_THRESHOLD + 10
    )).length,
    bands: CURRENT_SCORE_RISK_BANDS.map((band) => {
      const students = currentScoreRiskStudents.filter((row) => (
        row.student.score >= band.minScore && row.student.score <= band.maxScore
      ))
      return {
        ...band,
        studentCount: students.length,
        percentage: currentScoreRiskStudents.length
          ? Math.round((students.length / currentScoreRiskStudents.length) * 100)
          : 0,
        students,
      }
    }),
  }
  const safeGrade = filters.gradeLevel === 'all' || gradeLevels.includes(filters.gradeLevel)
    ? filters.gradeLevel
    : 'all'
  const safeMonth = filters.month === 'all' || monthValues.includes(filters.month)
    ? filters.month
    : 'all'

  const transactions = allTermRows
    .filter((row) => filters.kind === 'all' || row.transaction.kind === filters.kind)
    .filter((row) => safeGrade === 'all' || row.student.gradeLevel === safeGrade)
    .filter((row) => safeMonth === 'all' || row.month === safeMonth)
    .filter((row) => !filters.fromDate || analyticsDateKey(row.occurredAt) >= filters.fromDate)
    .filter((row) => !filters.toDate || analyticsDateKey(row.occurredAt) <= filters.toDate)
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()
      || right.transaction.id.localeCompare(left.transaction.id))

  const scopeStudents = state.students
    .filter((student) => student.status === 'active')
    .filter((student) => safeGrade === 'all' || student.gradeLevel === safeGrade)
    .sort(compareStudentCodes)
  const rowsByStudentId = new Map<string, AnalyticsTransaction[]>()
  for (const row of transactions) {
    const studentRows = rowsByStudentId.get(row.student.id)
    if (studentRows) studentRows.push(row)
    else rowsByStudentId.set(row.student.id, [row])
  }
  const studentRows = safeGrade === 'all' ? [] : scopeStudents.map((student) => {
    const rows = rowsByStudentId.get(student.id) ?? []
    return {
      student,
      transactions: rows,
      totalEvents: rows.length,
      ...summarizeRows(rows),
      latest: rows[0],
    }
  })

  const displayedGrades = safeGrade === 'all' ? gradeLevels : [safeGrade]
  const gradeRows = displayedGrades.map((gradeLevel) => {
    const rows = transactions.filter((row) => row.student.gradeLevel === gradeLevel)
    const counts = summarizeRows(rows)
    return {
      gradeLevel,
      gradeLabel: formatGradeLabel(gradeLevel),
      studentCount: state.students.filter((student) => student.status === 'active' && student.gradeLevel === gradeLevel).length,
      studentsAffected: new Set(rows.map((row) => row.student.id)).size,
      ...counts,
    }
  })

  const displayedMonths = safeMonth === 'all' ? [...monthValues].reverse() : [safeMonth]
  const monthRows = displayedMonths.map((month) => ({
    month,
    label: analyticsMonthLabel(month),
    ...summarizeRows(transactions.filter((row) => row.month === month)),
  }))
  const totals = summarizeRows(transactions)

  return {
    transactions,
    studentRows,
    gradeRows,
    monthRows,
    gradeOptions,
    monthOptions,
    totalEvents: transactions.length,
    scopeStudentCount: scopeStudents.length,
    remediationPoints: transactions.filter((row) => row.transaction.ledgerEntryType === 'remediation_credit' || row.transaction.remediationRequestId).reduce((sum, row) => sum + row.transaction.appliedDelta, 0),
    appealPoints: transactions.filter((row) => row.transaction.additionSource === 'appeal').reduce((sum, row) => sum + row.transaction.appliedDelta, 0),
    missingScoreCount: state.students.filter((student) => student.score === null).length,
    currentScoreRisk,
    ...totals,
  }
}

function analyticsDateKey(value: string): string {
  return thaiDayFormatter.format(new Date(value))
}
