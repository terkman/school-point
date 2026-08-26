import { describe, expect, it } from 'vitest'
import { normalizeSchoolImportPreview, normalizeSchoolImportResult } from './schoolImport'

describe('school Excel import results', () => {
  it('normalizes a five-sheet preview without accepting negative counts', () => {
    const preview = normalizeSchoolImportPreview({
      fileName: 'school.xlsx',
      termLabel: 'ภาคเรียนที่ 1/2569',
      fingerprint: 'a'.repeat(64),
      canApply: true,
      counts: { classrooms: 4, students: 120, staff: 12, assignments: 8, guardians: 115 },
      accounts: { total: 132, willCreate: 30, alreadyExists: 102, skipped: -1 },
      issues: [{ severity: 'warning', code: 'MISSING_USERNAME', sheet: 'บุคลากร', row: 9, message: 'ออกบัญชีภายหลัง' }],
      issueCount: 1,
    })

    expect(preview.counts).toEqual({ classrooms: 4, students: 120, staff: 12, assignments: 8, guardians: 115 })
    expect(preview.accounts.skipped).toBe(0)
    expect(preview.issues[0]).toMatchObject({ severity: 'warning', sheet: 'บุคลากร', row: 9 })
  })

  it('normalizes apply and provisioning summaries without exposing passwords', () => {
    const result = normalizeSchoolImportResult({
      alreadyApplied: false,
      batchId: '18',
      fingerprint: 'b'.repeat(64),
      counts: { classrooms: 2, students: 3, staff: 1, assignments: 1, guardians: 3 },
      provisioning: {
        total: 4,
        created: 2,
        existing: 2,
        linked: 4,
        failed: 0,
        failures: [],
        password: 'must-not-pass-through',
      },
      completion: 'complete',
      incomplete: false,
      retry: { supported: false, batchId: '18', action: 'none' },
    })

    expect(result.provisioning).toEqual({ total: 4, created: 2, existing: 2, linked: 4, failed: 0, failures: [] })
    expect(result.provisioning).not.toHaveProperty('password')
    expect(result).toMatchObject({ completion: 'complete', incomplete: false, retry: { supported: false } })
  })

  it('keeps a partial provisioning result explicit and retryable', () => {
    const result = normalizeSchoolImportResult({
      alreadyApplied: false,
      batchId: '19',
      fingerprint: 'c'.repeat(64),
      counts: { classrooms: 1, students: 2, staff: 0, assignments: 0, guardians: 2 },
      provisioning: {
        total: 2,
        created: 1,
        existing: 0,
        linked: 1,
        failed: 1,
        failures: [{ username: 'student-2', message: 'สร้างบัญชีไม่สำเร็จ' }],
      },
      completion: 'partial',
      incomplete: true,
      retry: { supported: true, batchId: '19', action: 'preview-and-apply-the-same-file' },
    })

    expect(result.completion).toBe('partial')
    expect(result.incomplete).toBe(true)
    expect(result.retry).toEqual({
      supported: true,
      batchId: '19',
      action: 'preview-and-apply-the-same-file',
    })
    expect(result.provisioning.failed).toBe(1)
  })
})
