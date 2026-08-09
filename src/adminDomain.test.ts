import { describe, expect, it } from 'vitest'
import {
  normalizePermissionScope,
  requiresDeductionApproval,
  severityFromDeductionPoints,
} from './adminDomain'

describe('admin deduction policy', () => {
  it('uses the approved score bands and approval threshold', () => {
    expect(severityFromDeductionPoints(1)).toBe('low')
    expect(severityFromDeductionPoints(9)).toBe('low')
    expect(severityFromDeductionPoints(10)).toBe('medium')
    expect(severityFromDeductionPoints(25)).toBe('serious')
    expect(severityFromDeductionPoints(55)).toBe('critical')
    expect(severityFromDeductionPoints(100)).toBe('critical')
    expect(requiresDeductionApproval(9)).toBe(false)
    expect(requiresDeductionApproval(10)).toBe(true)
  })

  it('rejects deductions outside 1–100', () => {
    expect(() => severityFromDeductionPoints(0)).toThrow('1 ถึง 100')
    expect(() => requiresDeductionApproval(101)).toThrow('1 ถึง 100')
    expect(() => severityFromDeductionPoints(1.5)).toThrow('จำนวนเต็ม')
  })
})

describe('permission scope', () => {
  it('normalizes classroom scope and removes duplicates', () => {
    expect(normalizePermissionScope({
      type: 'classrooms',
      termId: ' term-1 ',
      classroomIds: ['room-1', 'room-1', ' room-2 '],
    })).toEqual({ type: 'classrooms', termId: 'term-1', classroomIds: ['room-1', 'room-2'] })
  })

  it('requires a term and at least one classroom for classroom scope', () => {
    expect(() => normalizePermissionScope({ type: 'classrooms', termId: '', classroomIds: [] }))
      .toThrow('อย่างน้อยหนึ่งห้อง')
  })
})
