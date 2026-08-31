import type { DemoState, ScoreTransaction, Student } from './domain'
import { formatGradeLabel } from './studentSelection'

export type AnalyticsKindFilter = 'all' | 'deduction' | 'addition'

export interface AnalyticsFilters {
  kind: AnalyticsKindFilter
  gradeLevel: string
  month: string
}

export interface AnalyticsTransaction {
  transaction: ScoreTransaction
  student: Student
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
  student: Student
  transactions: AnalyticsTransaction[]
  totalEvents: number
  deductionCount: number
  deductionPoints: number
  additionCount: number
  additionPoints: number
  netPoints: number
  latest?: AnalyticsTransaction
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
}

const BANGKOK_TIME_ZONE = 'Asia/Bangkok'
const GRADE_ORDER = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'M1', 'M2', 'M3']
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

export function compareStudentCodes(left: Student, right: Student): number {
  return left.studentCode.localeCompare(right.studentCode, 'th', {
    numeric: true,
    sensitivity: 'base',
  }) || left.name.localeCompare(right.name, 'th')
}

export function buildAdminAnalytics(state: DemoState, filters: AnalyticsFilters): AdminAnalyticsSummary {
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

  const monthValues = [...new Set(allTermRows.map((row) => row.month))].sort((left, right) => right.localeCompare(left))
  const monthOptions = monthValues.map((month) => ({ value: month, label: analyticsMonthLabel(month) }))
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
    ...totals,
  }
}
