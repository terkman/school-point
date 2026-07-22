import { describe, expect, it } from 'vitest'
import type { PositiveBehaviorRule, Student } from './domain'
import { localDateTimeToIso, resolveDeductionTargets, validatePositiveRulePoints } from './teacherWorkflows'

const students: Student[] = [
  { id: '1', studentCode: '001', name: 'หนึ่ง', classroomId: 'a', classroomName: 'ม.1/1', score: 100, status: 'active' },
  { id: '2', studentCode: '002', name: 'สอง', classroomId: 'a', classroomName: 'ม.1/1', score: 90, status: 'active' },
  { id: '3', studentCode: '003', name: 'สาม', classroomId: 'b', classroomName: 'ม.1/2', score: 80, status: 'active' },
  { id: '4', studentCode: '004', name: 'จบแล้ว', classroomId: 'a', classroomName: 'ม.1/1', score: 100, status: 'graduated' },
]

const fixedRule: PositiveBehaviorRule = {
  id: '10',
  code: 'P-010',
  category: 'ความดี',
  title: 'ช่วยงานโรงเรียน',
  description: 'มีหลักฐานประกอบ',
  defaultPoints: 10,
  maxPoints: 10,
  discretionary: false,
  active: true,
}

describe('teacher deduction target selection', () => {
  it('resolves individual, selected, and classroom targets without inactive students', () => {
    expect(resolveDeductionTargets({ scope: 'single', students, singleStudentId: '2' }).map((item) => item.id))
      .toEqual(['2'])
    expect(resolveDeductionTargets({ scope: 'selected', students, selectedStudentIds: ['3', '1', '4'] }).map((item) => item.id))
      .toEqual(['1', '3'])
    expect(resolveDeductionTargets({ scope: 'classroom', students, classroomId: 'a' }).map((item) => item.id))
      .toEqual(['1', '2'])
  })
})

describe('teacher point-addition details', () => {
  it('enforces the fixed score defined by a positive behavior rule', () => {
    expect(validatePositiveRulePoints(fixedRule, 10)).toEqual({ valid: true, points: 10 })
    expect(validatePositiveRulePoints(fixedRule, 7)).toMatchObject({ valid: false, points: 10 })
  })

  it('bounds discretionary scores by the rule maximum', () => {
    const discretionaryRule = { ...fixedRule, defaultPoints: null, maxPoints: 25, discretionary: true }
    expect(validatePositiveRulePoints(discretionaryRule, 18)).toEqual({ valid: true, points: 18 })
    expect(validatePositiveRulePoints(discretionaryRule, 26)).toMatchObject({ valid: false, points: null })
    expect(validatePositiveRulePoints(discretionaryRule, 1.5)).toMatchObject({ valid: false, points: null })
  })

  it('converts a valid local activity time to an ISO timestamp and rejects invalid input', () => {
    expect(localDateTimeToIso('2026-07-22T09:30')).toMatch(/^2026-07-22T/)
    expect(localDateTimeToIso('not-a-date')).toBeNull()
  })
})
