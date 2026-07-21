import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { createSupabaseActions, fetchAllPages } from './supabaseData'

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

describe('Supabase score mutations', () => {
  it('uses RPCs and refreshes only after the database accepts a change', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const actions = createSupabaseActions({ rpc } as unknown as SupabaseClient, refresh)

    await actions.recordDeduction({ studentId: '12', ruleId: '4', note: 'รายละเอียดภายใน' })
    await actions.requestPointAddition({ studentId: '12', points: 3, reason: 'ทำกิจกรรมครบ' })

    expect(rpc).toHaveBeenNthCalledWith(1, 'record_deduction', expect.objectContaining({
      p_student_id: '12',
      p_rule_id: '4',
      p_student_visible_note: null,
      p_internal_note: 'รายละเอียดภายใน',
    }))
    expect(rpc).toHaveBeenNthCalledWith(2, 'request_point_addition', expect.objectContaining({
      p_student_id: '12',
      p_points: 3,
    }))
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('does not refresh stale data when an RPC is rejected', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: 'permission denied' } })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const actions = createSupabaseActions({ rpc } as unknown as SupabaseClient, refresh)

    await expect(actions.adminAddPoints({ studentId: '12', points: 5, reason: 'ทดสอบ', termId: '9' }))
      .rejects.toThrow('permission denied')
    expect(refresh).not.toHaveBeenCalled()
  })
})
