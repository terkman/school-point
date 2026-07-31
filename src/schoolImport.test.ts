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
    })

    expect(result.provisioning).toEqual({ total: 4, created: 2, existing: 2, linked: 4, failed: 0, failures: [] })
    expect(result.provisioning).not.toHaveProperty('password')
  })
})
