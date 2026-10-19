import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseTermActions, normalizeTermHistory, normalizeTermRemediations } from './supabaseTermManagement'

const term = { id: 1, schoolYear: 2569, semester: 1, name: 'ภาคเรียนที่ 1/2569', status: 'closed', startsOn: '2026-05-01', endsOn: '2026-10-01' }
const safeLedger = { id: 99, termId: 1, entryType: 'remediation_credit', requestedDelta: 10, appliedDelta: 10, balanceBefore: 70, balanceAfter: 80, reason: 'แก้คะแนนภาคเรียนเดิม', activityOccurredAt: '2026-11-01T03:00:00Z', createdAt: '2026-11-02T03:00:00Z' }
const rawStudent = { id: 7, studentId: 7, studentCode: '69007', title: 'ด.ช.', givenName: 'ตัวอย่าง', familyName: 'ทดสอบ', nickname: null, status: 'active' }

describe('Supabase semester contract', () => {
  it('keeps closing and adjusted balances distinct and normalizes student-safe history', () => {
    const value = normalizeTermHistory({ term, threshold: 80, closedAt: '2026-10-02T00:00:00Z', students: [{ ...rawStudent,
      classroom: { name: 'ป.1/1', gradeLevel: 'P1', roomNumber: '1' }, enrolled: true,
      latestScore: 80, closingScore: 70, threshold: 80, remediation: { caseId: 8, status: 'passed' },
      history: [{ ...safeLedger, actor_user_id: 'private-actor', actor_snapshot: 'private-name' }],
    }] })
    expect(value.term.id).toBe('1')
    expect(value.students[0]).toMatchObject({ studentId: '7', name: 'ด.ช.ตัวอย่าง ทดสอบ', closingScore: 70, latestScore: 80, remediation: { caseId: '8', status: 'passed' } })
    expect(value.students[0]!.history[0]).toMatchObject({ termId: '1', activityOccurredAt: '2026-11-01T03:00:00Z' })
    expect(JSON.stringify(value)).not.toMatch(/private-actor|private-name|actor_user_id|actor_snapshot/)
  })

  it('does not invent a 100-point balance for a missing score account', () => {
    const value = normalizeTermHistory({ term, threshold: 80, students: [{ ...rawStudent, enrolled: true,
      latestScore: null, closingScore: null, threshold: 80, remediation: null, history: [],
    }] })
    expect(value.students[0]!.latestScore).toBeNull()
    expect(value.students[0]!.closingScore).toBeNull()
  })

  it('retains outstanding pupils absent from the current roster', () => {
    const value = normalizeTermRemediations([{ caseId: 8, sourceTerm: term, student: { ...rawStudent, status: 'graduated' },
      currentClassroom: null, closingScore: 70, currentScore: 70, threshold: 80, pointsNeeded: 10,
      status: 'open', openedAt: '2026-10-02T00:00:00Z', responsibleTeacherId: null, pendingRequestCount: 0, requests: [], changesSinceClose: [],
    }])
    expect(value).toHaveLength(1)
    expect(value[0]).toMatchObject({ caseId: '8', student: { id: '7', status: 'graduated' }, pointsNeeded: 10 })
    expect(value[0]!.currentClassroomName).toBeUndefined()
  })

  it('sends source-case credit data and preserves a completed approval if screen refresh fails', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, replayed: false, requestId: 10, caseId: 8, status: 'approved',
      appliedPoints: 10, balanceBefore: 70, balanceAfter: 80, caseStatus: 'passed', ledgerId: 99 }, error: null })
    const refresh = vi.fn().mockRejectedValue(new Error('connection interrupted'))
    const warning = vi.fn()
    const actions = createSupabaseTermActions({ rpc } as unknown as SupabaseClient, refresh, warning)
    const requestId = '0b1930f3-b323-46ed-8040-7ba01176c98c'
    const result = await actions.reviewTermRemediation({ requestId: '10', approve: true, note: 'ตรวจหลักฐานแล้ว', clientRequestId: requestId })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('review_term_remediation_v1', { p_request_id: '10', p_approve: true, p_review_note: 'ตรวจหลักฐานแล้ว', p_client_request_id: requestId })
    expect(result).toMatchObject({ requestId: '10', balanceAfter: 80, caseStatus: 'passed', ledgerId: '99', syncWarning: { code: 'refresh_failed' } })
    expect(warning).toHaveBeenCalledOnce()
  })

  it('does not refresh or claim success when the database refuses a mutation', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Permission denied' } })
    const refresh = vi.fn()
    const actions = createSupabaseTermActions({ rpc } as unknown as SupabaseClient, refresh)
    await expect(actions.requestTermRemediation({ caseId: '8', points: 10, reason: 'กิจกรรมแก้คะแนน', activityOccurredAt: '2026-11-01T03:00:00Z', clientRequestId: '0b1930f3-b323-46ed-8040-7ba01176c98c' })).rejects.toThrow('Permission denied')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('maps the SQL transition counts without confusing old and new terms', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, replayed: true, transitionId: 30, closedTermId: 1, activeTermId: 2,
      snapshotCount: 20, remediationCaseCount: 4, initializedAccountCount: 20, threshold: 80 }, error: null })
    const actions = createSupabaseTermActions({ rpc } as unknown as SupabaseClient, vi.fn())
    const result = await actions.transitionTerm({ currentTermId: '1', nextTermId: '2', clientRequestId: '0b1930f3-b323-46ed-8040-7ba01176c98c' })
    expect(result).toMatchObject({ transitionId: '30', closedTermId: '1', activeTermId: '2', initializedAccounts: 20, remediationCaseCount: 4, replayed: true })
  })
})
