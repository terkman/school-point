import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AdminAnalyticsDashboard } from './AdminAnalyticsDashboard'
import { analyticsMonthKey, buildAdminAnalytics } from './adminAnalytics'
import { createDemoState } from './demoData'
import type { DemoState, ScoreTransaction } from './domain'

function transaction(input: Partial<ScoreTransaction> & Pick<ScoreTransaction, 'id' | 'studentId' | 'kind' | 'appliedDelta' | 'occurredAt'>): ScoreTransaction {
  return {
    termId: 'term-current',
    requestedDelta: input.appliedDelta,
    scoreBefore: 100,
    scoreAfter: 100 + input.appliedDelta,
    reason: 'ทดสอบรายการคะแนน',
    actorId: 'admin-1',
    ...input,
  }
}

function analyticsState(): DemoState {
  const state = createDemoState()
  state.term = { ...state.term, id: 'term-current', label: 'ปีการศึกษา 2569 ภาคเรียนที่ 1' }
  state.students = [
    { id: 'p1-a', studentCode: '1001', name: 'นักเรียน ป.1', classroomId: 'p1', classroomName: 'ป.1', gradeLevel: 'P1', score: 95, status: 'active' },
    { id: 'p2-a', studentCode: '2001', name: 'นักเรียน ป.2', classroomId: 'p2', classroomName: 'ป.2', gradeLevel: 'P2', score: 96, status: 'active' },
    { id: 'p2-b', studentCode: '2002', name: 'นักเรียน ป.2 คนที่สอง', classroomId: 'p2', classroomName: 'ป.2', gradeLevel: 'P2', score: 100, status: 'active' },
  ]
  state.transactions = [
    transaction({ id: 'deduct-p1-jul', studentId: 'p1-a', kind: 'deduction', appliedDelta: -5, occurredAt: '2026-07-07T12:00:00+07:00' }),
    transaction({ id: 'add-p1-jul', studentId: 'p1-a', kind: 'addition', appliedDelta: 3, occurredAt: '2026-08-31T08:00:00Z', activityOccurredAt: '2026-06-30T18:30:00Z' }),
    transaction({ id: 'deduct-p2-aug', studentId: 'p2-a', kind: 'deduction', appliedDelta: -4, occurredAt: '2026-08-03T12:00:00+07:00' }),
    transaction({ id: 'opening', studentId: 'p2-b', kind: 'reset', appliedDelta: 100, occurredAt: '2026-05-01T12:00:00+07:00' }),
    transaction({ id: 'old-term', studentId: 'p2-b', kind: 'deduction', appliedDelta: -20, occurredAt: '2026-07-01T12:00:00+07:00', termId: 'term-old' }),
  ]
  return state
}

describe('admin score analytics', () => {
  it('groups additions and deductions by grade and actual occurrence month', () => {
    const summary = buildAdminAnalytics(analyticsState(), { kind: 'all', gradeLevel: 'all', month: 'all' })

    expect(summary.totalEvents).toBe(3)
    expect(summary.deductionPoints).toBe(9)
    expect(summary.additionPoints).toBe(3)
    expect(summary.netPoints).toBe(-6)
    expect(summary.monthRows.map((row) => [row.month, row.deductionPoints, row.additionPoints])).toEqual([
      ['2026-07', 5, 3],
      ['2026-08', 4, 0],
    ])
    expect(summary.gradeRows.map((row) => [row.gradeLevel, row.deductionPoints, row.additionPoints, row.studentsAffected])).toEqual([
      ['P1', 5, 3, 1],
      ['P2', 4, 0, 1],
    ])
  })

  it('filters to one kind, grade, and month without counting opening or other-term rows', () => {
    const summary = buildAdminAnalytics(analyticsState(), { kind: 'deduction', gradeLevel: 'P1', month: '2026-07' })

    expect(summary.totalEvents).toBe(1)
    expect(summary.deductionPoints).toBe(5)
    expect(summary.additionPoints).toBe(0)
    expect(summary.gradeRows).toHaveLength(1)
    expect(summary.gradeRows[0].gradeLabel).toBe('ป.1')
    expect(summary.transactions[0].transaction.id).toBe('deduct-p1-jul')
  })

  it('uses Bangkok time when assigning an event to a month', () => {
    expect(analyticsMonthKey('2026-06-30T18:30:00Z')).toBe('2026-07')
  })

  it('renders accessible filter controls, grade summaries, and an auditable detail table', () => {
    const markup = renderToStaticMarkup(createElement(AdminAnalyticsDashboard, { state: analyticsState() }))

    expect(markup).toContain('สถิติคะแนนเพิ่ม–ตัด')
    expect(markup).toContain('ประเภทคะแนน')
    expect(markup).toContain('ทุกระดับชั้น')
    expect(markup).toContain('เดือนเกิดเหตุ')
    expect(markup).toContain('สรุปตามวันเกิดเหตุจริง')
    expect(markup).toContain('คะแนนเพิ่มและตัดทุกระดับชั้น')
    expect(markup).toContain('รายละเอียดคะแนน')
    expect(markup).toContain('นักเรียน ป.1')
  })
})
