export interface SchoolImportCounts {
  classrooms: number
  students: number
  staff: number
  assignments: number
  guardians: number
}

export interface SchoolImportIssue {
  severity: 'error' | 'warning'
  code: string
  sheet: string
  row?: number
  column?: string
  message: string
}

export interface SchoolImportAccountPreview {
  total: number
  willCreate: number
  alreadyExists: number
  skipped: number
}

export interface SchoolImportPreview {
  fileName: string
  termLabel: string
  fingerprint: string
  canApply: boolean
  counts: SchoolImportCounts
  accounts: SchoolImportAccountPreview
  issues: SchoolImportIssue[]
  issueCount: number
}

export interface SchoolImportProvisioningResult {
  total: number
  created: number
  existing: number
  linked: number
  failed: number
  failures: Array<{ username: string; message: string }>
}

export interface SchoolImportResult {
  alreadyApplied: boolean
  batchId: string
  fingerprint: string
  counts: SchoolImportCounts
  provisioning: SchoolImportProvisioningResult
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('ผลลัพธ์นำเข้าข้อมูลไม่ถูกต้อง')
  return value as Record<string, unknown>
}

function count(value: unknown): number {
  const result = Number(value)
  return Number.isSafeInteger(result) && result >= 0 ? result : 0
}

function normalizeCounts(value: unknown): SchoolImportCounts {
  const row = record(value)
  return {
    classrooms: count(row.classrooms),
    students: count(row.students),
    staff: count(row.staff),
    assignments: count(row.assignments),
    guardians: count(row.guardians),
  }
}

export function normalizeSchoolImportPreview(value: unknown): SchoolImportPreview {
  const row = record(value)
  const accounts = record(row.accounts)
  const issues = Array.isArray(row.issues) ? row.issues : []
  return {
    fileName: String(row.fileName ?? ''),
    termLabel: String(row.termLabel ?? ''),
    fingerprint: String(row.fingerprint ?? ''),
    canApply: row.canApply === true,
    counts: normalizeCounts(row.counts),
    accounts: {
      total: count(accounts.total),
      willCreate: count(accounts.willCreate),
      alreadyExists: count(accounts.alreadyExists),
      skipped: count(accounts.skipped),
    },
    issues: issues.map((item): SchoolImportIssue => {
      const issue = record(item)
      return {
        severity: issue.severity === 'warning' ? 'warning' : 'error',
        code: String(issue.code ?? ''),
        sheet: String(issue.sheet ?? ''),
        ...(Number.isSafeInteger(Number(issue.row)) ? { row: Number(issue.row) } : {}),
        ...(issue.column ? { column: String(issue.column) } : {}),
        message: String(issue.message ?? 'ข้อมูลไม่ถูกต้อง'),
      }
    }),
    issueCount: count(row.issueCount),
  }
}

export function normalizeSchoolImportResult(value: unknown): SchoolImportResult {
  const row = record(value)
  const provisioning = record(row.provisioning)
  const failures = Array.isArray(provisioning.failures) ? provisioning.failures : []
  return {
    alreadyApplied: row.alreadyApplied === true,
    batchId: String(row.batchId ?? ''),
    fingerprint: String(row.fingerprint ?? ''),
    counts: normalizeCounts(row.counts),
    provisioning: {
      total: count(provisioning.total),
      created: count(provisioning.created),
      existing: count(provisioning.existing),
      linked: count(provisioning.linked),
      failed: count(provisioning.failed),
      failures: failures.map((item) => {
        const failure = record(item)
        return {
          username: String(failure.username ?? ''),
          message: String(failure.message ?? 'สร้างบัญชีไม่สำเร็จ'),
        }
      }),
    },
  }
}
