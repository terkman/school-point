import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { createSupabaseActions, fetchAllPages, loadMyStudentHistory, selectAccessibleTerm } from './supabaseData'

describe('Supabase term selection', () => {
  const plannedTerm = {
    id: '9',
    name: 'ภาคเรียนที่ 1/2569',
    starts_on: null,
    ends_on: null,
    status: 'planned' as const,
  }

  it('lets an admin open the latest planned term to fill missing dates', () => {
    expect(selectAccessibleTerm('admin', null, plannedTerm)).toBe(plannedTerm)
  })

  it('keeps planned terms unavailable to students and teachers', () => {
    expect(selectAccessibleTerm('student', null, plannedTerm)).toBeNull()
    expect(selectAccessibleTerm('teacher', null, plannedTerm)).toBeNull()
  })
})

describe('Supabase pagination', () => {
  it('fetches every row beyond the 1,000-row API cap and stops after the final partial page', async () => {
    const source = Array.from({ length: 2505 }, (_, index) => ({ id: index + 1 }))
    const loadPage = vi.fn(async (from: number, to: number) => ({
      data: source.slice(from, to + 1),
      error: null,
    }))

    const rows = await fetchAllPages('โหลดคิว', loadPage)

    expect(rows).toEqual(source)
    expect(loadPage.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('checks one empty page and stops when the row count is an exact multiple of 1,000', async () => {
    const source = Array.from({ length: 2000 }, (_, index) => index)
    const loadPage = vi.fn(async (from: number, to: number) => ({
      data: source.slice(from, to + 1),
      error: null,
    }))

    await expect(fetchAllPages('โหลดประวัติ', loadPage)).resolves.toEqual(source)
    expect(loadPage).toHaveBeenCalledTimes(3)
    expect(loadPage).toHaveBeenLastCalledWith(2000, 2999)
  })
})

describe('Supabase redacted student history', () => {
  it('loads score and incident history through the student-only RPCs', async () => {
    const scoreRows = [{
      id: '31',
      term_id: '9',
      entry_type: 'deduction',
      requested_delta: -5,
      applied_delta: -5,
      balance_before: 100,
      balance_after: 95,
      reason: 'ผิดระเบียบการแต่งกาย',
      incident_id: '81',
      created_at: '2026-07-22T03:00:00.000Z',
    }]
    const incidentRows = [{
      id: '81',
      occurred_at: '2026-07-22T02:55:00.000Z',
      recorded_at: '2026-07-22T03:00:00.000Z',
      appeal_deadline: '2026-07-29T03:00:00.000Z',
      appeal_id: null,
      appeal_status: null,
      appeal_created_at: null,
    }]
    const scoreBuilder = { order: vi.fn(), range: vi.fn() }
    scoreBuilder.order.mockReturnValue(scoreBuilder)
    scoreBuilder.range.mockResolvedValue({ data: scoreRows, error: null })
    const incidentBuilder = { order: vi.fn(), range: vi.fn() }
    incidentBuilder.order.mockReturnValue(incidentBuilder)
    incidentBuilder.range.mockResolvedValue({ data: incidentRows, error: null })
    const rpc = vi.fn((name: string) => name === 'get_my_score_history' ? scoreBuilder : incidentBuilder)

    const result = await loadMyStudentHistory({ rpc } as unknown as SupabaseClient)

    expect(result).toEqual({ ledgerRows: scoreRows, incidentRows })
    expect(rpc.mock.calls).toEqual([
      ['get_my_score_history'],
      ['get_my_incident_history'],
    ])
    expect(scoreBuilder.order.mock.calls).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ])
    expect(incidentBuilder.order.mock.calls).toEqual([
      ['occurred_at', { ascending: false }],
      ['id', { ascending: false }],
    ])
    expect(scoreBuilder.range).toHaveBeenCalledWith(0, 999)
    expect(incidentBuilder.range).toHaveBeenCalledWith(0, 999)
  })
})

describe('Supabase score mutations', () => {
  it('records a reviewed group with one retry-safe RPC and refreshes once', async () => {
    const summary = {
      ok: true,
      replayed: false,
      batchId: 91,
      scope: 'selected' as const,
      targetCount: 2,
      requestedPointsEach: 5,
      totalAppliedPoints: 8,
      alreadyAtZeroCount: 0,
      guardianTaskCount: 0,
      results: [
        { studentId: 12, incidentId: 101, requestedPoints: 5, appliedPoints: 5, balanceBefore: 100, balanceAfter: 95 },
        { studentId: 13, incidentId: 102, requestedPoints: 5, appliedPoints: 3, balanceBefore: 3, balanceAfter: 0 },
      ],
    }
    const rpc = vi.fn().mockResolvedValue({ data: summary, error: null })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const actions = createSupabaseActions({ rpc } as unknown as SupabaseClient, refresh)

    const result = await actions.recordDeductions({
      clientRequestId: 'd7d385f2-77ca-4e94-a571-2c2e32dad247',
      scope: 'selected',
      studentIds: ['12', '13'],
      ruleId: '4',
      occurredAt: '2026-07-22T02:00:00.000Z',
      studentVisibleNote: 'ตรวจเครื่องแต่งกายช่วงเช้า',
      internalNote: 'ครูเวรตรวจและยืนยันรายชื่อแล้ว',
      confirmSeriousBulk: false,
    })

    expect(result).toMatchObject({
      batchId: '91',
      totalAppliedPoints: 8,
      results: [
        expect.objectContaining({ studentId: '12', incidentId: '101' }),
        expect.objectContaining({ studentId: '13', incidentId: '102' }),
      ],
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('record_deductions_bulk', {
      p_client_request_id: 'd7d385f2-77ca-4e94-a571-2c2e32dad247',
      p_scope: 'selected',
      p_student_ids: ['12', '13'],
      p_classroom_id: null,
      p_rule_id: '4',
      p_occurred_at: '2026-07-22T02:00:00.000Z',
      p_student_visible_note: 'ตรวจเครื่องแต่งกายช่วงเช้า',
      p_internal_note: 'ครูเวรตรวจและยืนยันรายชื่อแล้ว',
      p_confirm_serious_bulk: false,
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('submits the positive rule, activity time, reason, and evidence for approval', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, requestId: '72' }, error: null })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const actions = createSupabaseActions({ rpc } as unknown as SupabaseClient, refresh)

    await actions.requestPointAddition({
      clientRequestId: '7f4ee0c0-9032-465e-a6b7-05d211232621',
      studentId: '12',
      positiveRuleId: '17',
      points: 10,
      activityOccurredAt: '2026-07-21T03:30:00.000Z',
      reason: '  ช่วยจัดกิจกรรมโรงเรียนจนเสร็จ  ',
      evidenceNote: '  มีภาพถ่ายและครูผู้รับผิดชอบยืนยัน  ',
    })

    expect(rpc).toHaveBeenCalledWith('request_point_addition_detailed', {
      p_client_request_id: '7f4ee0c0-9032-465e-a6b7-05d211232621',
      p_student_id: '12',
      p_positive_rule_id: '17',
      p_points: 10,
      p_activity_occurred_at: '2026-07-21T03:30:00.000Z',
      p_reason: 'ช่วยจัดกิจกรรมโรงเรียนจนเสร็จ',
      p_evidence_note: 'มีภาพถ่ายและครูผู้รับผิดชอบยืนยัน',
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('records a detailed retry-safe direct admin addition', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        replayed: false,
        ledgerId: 301,
        studentId: 12,
        requestedPoints: 10,
        appliedPoints: 4,
        balanceBefore: 96,
        balanceAfter: 100,
      },
      error: null,
    })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const actions = createSupabaseActions({ rpc } as unknown as SupabaseClient, refresh)

    const result = await actions.adminAddPoints({
      clientRequestId: 'b5017c68-ad9b-4ee7-aa92-b0503bd1f50c',
      studentId: '12',
      positiveRuleId: '7',
      points: 10,
      activityOccurredAt: '2026-07-21T04:00:00.000Z',
      reason: '  ช่วยเตรียมสถานที่จัดกิจกรรม  ',
      evidenceNote: '  มีภาพถ่ายและครูงานกิจกรรมรับรอง  ',
      termId: '9',
    })

    expect(result).toMatchObject({ ledgerId: '301', studentId: '12', appliedPoints: 4, balanceAfter: 100 })
    expect(rpc).toHaveBeenCalledWith('admin_add_points_detailed', {
      p_client_request_id: 'b5017c68-ad9b-4ee7-aa92-b0503bd1f50c',
      p_student_id: '12',
      p_positive_rule_id: '7',
      p_points: 10,
      p_activity_occurred_at: '2026-07-21T04:00:00.000Z',
      p_reason: 'ช่วยเตรียมสถานที่จัดกิจกรรม',
      p_evidence_note: 'มีภาพถ่ายและครูงานกิจกรรมรับรอง',
      p_term_id: '9',
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not refresh stale data when an RPC is rejected', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: 'permission denied' } })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const actions = createSupabaseActions({ rpc } as unknown as SupabaseClient, refresh)

    await expect(actions.adminAddPoints({
      clientRequestId: '8503ea1e-62d0-4681-851e-891c368467a3',
      studentId: '12',
      positiveRuleId: '7',
      points: 5,
      activityOccurredAt: '2026-07-21T04:00:00.000Z',
      reason: 'ทดสอบเหตุผล',
      evidenceNote: 'ทดสอบหลักฐาน',
      termId: '9',
    }))
      .rejects.toThrow('permission denied')
    expect(refresh).not.toHaveBeenCalled()
  })
})
