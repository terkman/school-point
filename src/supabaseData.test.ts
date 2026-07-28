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

describe('Supabase private score evidence', () => {
  it('uploads evidence under the signed-in user folder and returns a short-lived URL', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'stored' }, error: null })
    const remove = vi.fn().mockResolvedValue({ data: [], error: null })
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://example.test/private-link' },
      error: null,
    })
    const from = vi.fn().mockReturnValue({ upload, remove, createSignedUrl })
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { user: { id: '9ba2f967-4192-45fc-aa31-30bf91862aef' } } },
          error: null,
        }),
      },
      storage: { from },
      rpc: vi.fn(),
    }
    const actions = createSupabaseActions(client as unknown as SupabaseClient, vi.fn())
    const file = {
      name: 'หลักฐาน.pdf',
      type: 'application/pdf',
      size: 2048,
    } as File

    const [attachment] = await actions.uploadEvidenceFiles([file])
    const url = await actions.createEvidenceUrl(attachment)

    expect(from).toHaveBeenCalledWith('score-evidence')
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^9ba2f967-4192-45fc-aa31-30bf91862aef\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.pdf$/),
      file,
      { cacheControl: '3600', contentType: 'application/pdf', upsert: false },
    )
    expect(createSignedUrl).toHaveBeenCalledWith(
      attachment.path,
      300,
      { download: 'หลักฐาน.pdf' },
    )
    expect(url).toBe('https://example.test/private-link')
  })
})

describe('Supabase student profile avatars', () => {
  it('stores the selected preset, removes the previous private upload, and refreshes once', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ok: true, preset: 'student-girl-2', path: null, previousPath: 'user-1/profile.webp' },
      error: null,
    })
    const remove = vi.fn().mockResolvedValue({ data: [], error: null })
    const from = vi.fn().mockReturnValue({ remove })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const actions = createSupabaseActions({
      rpc,
      storage: { from },
    } as unknown as SupabaseClient, refresh)

    await actions.setMyAvatarPreset('student-girl-2')

    expect(rpc).toHaveBeenCalledWith('update_my_profile_avatar', {
      p_preset: 'student-girl-2',
      p_avatar_path: null,
    })
    expect(from).toHaveBeenCalledWith('student-profile-images')
    expect(remove).toHaveBeenCalledWith(['user-1/profile.webp'])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('uploads one prepared WEBP under the signed-in student folder and records its path', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ok: true, preset: null, path: '9ba2f967-4192-45fc-aa31-30bf91862aef/profile.webp' },
      error: null,
    })
    const upload = vi.fn().mockResolvedValue({ data: { path: 'stored' }, error: null })
    const from = vi.fn().mockReturnValue({ upload })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { user: { id: '9ba2f967-4192-45fc-aa31-30bf91862aef' } } },
          error: null,
        }),
      },
      storage: { from },
      rpc,
    }
    const actions = createSupabaseActions(client as unknown as SupabaseClient, refresh)
    const file = { name: 'profile.webp', type: 'image/webp', size: 120_000 } as File

    await actions.uploadMyAvatar(file)

    expect(from).toHaveBeenCalledWith('student-profile-images')
    expect(upload).toHaveBeenCalledWith(
      '9ba2f967-4192-45fc-aa31-30bf91862aef/profile.webp',
      file,
      { cacheControl: '0', contentType: 'image/webp', upsert: true },
    )
    expect(rpc).toHaveBeenCalledWith('update_my_profile_avatar', {
      p_preset: null,
      p_avatar_path: '9ba2f967-4192-45fc-aa31-30bf91862aef/profile.webp',
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe('Supabase score mutations', () => {
  it('loads guardian contacts only for the selected task without refreshing school state', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        contact_id: 31,
        contact_name: 'ผู้ปกครอง ก',
        relationship: 'มารดา',
        phone_number: '0800000000',
        is_primary: true,
      }],
      error: null,
    })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const actions = createSupabaseActions({ rpc } as unknown as SupabaseClient, refresh)

    await expect(actions.getGuardianContacts('18')).resolves.toEqual([{
      id: '31',
      name: 'ผู้ปกครอง ก',
      relationship: 'มารดา',
      phoneNumber: '0800000000',
      isPrimary: true,
    }])
    expect(rpc).toHaveBeenCalledWith('get_guardian_contacts_for_task', { p_task_id: '18' })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('records guardian contact and case progress through audited RPCs', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 18, error: null })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const actions = createSupabaseActions({ rpc } as unknown as SupabaseClient, refresh)

    await actions.completeGuardianContact({
      taskId: '18',
      note: '  ติดต่อมารดาแล้วและนัดพบครู  ',
    })
    await actions.updateFollowUpCase({
      caseId: '22',
      status: 'resolved',
      note: '  ดำเนินมาตรการช่วยเหลือครบแล้ว  ',
    })

    expect(rpc.mock.calls).toEqual([
      ['complete_guardian_contact_task', {
        p_task_id: '18',
        p_note: 'ติดต่อมารดาแล้วและนัดพบครู',
      }],
      ['admin_update_follow_up_case', {
        p_case_id: '22',
        p_status: 'resolved',
        p_note: 'ดำเนินมาตรการช่วยเหลือครบแล้ว',
      }],
    ])
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('replaces a teacher classroom access set with one admin RPC and refreshes once', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, updated: true }, error: null })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const actions = createSupabaseActions({ rpc } as unknown as SupabaseClient, refresh)

    await actions.updateTeacherClassrooms({
      termId: '9',
      teacherId: '21',
      classroomIds: ['7', '8', '7'],
    })

    expect(rpc).toHaveBeenCalledWith('admin_set_teacher_classrooms', {
      p_term_id: '9',
      p_teacher_id: '21',
      p_classroom_ids: ['7', '8'],
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

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

  it('creates one atomic teacher request batch for a selected classroom group', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        replayed: false,
        batchId: 44,
        scope: 'selected',
        classroomId: 8,
        targetCount: 2,
        requestedPointsEach: 5,
        requests: [
          { studentId: 12, requestId: 71, status: 'pending' },
          { studentId: 13, requestId: 72, status: 'pending' },
        ],
      },
      error: null,
    })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const actions = createSupabaseActions({ rpc } as unknown as SupabaseClient, refresh)

    const result = await actions.requestPointAdditions({
      clientRequestId: '98d2826b-861c-4273-90fd-c7a357cb87ea',
      scope: 'selected',
      studentIds: ['12', '13'],
      classroomId: '8',
      positiveRuleId: '17',
      points: 5,
      activityOccurredAt: '2026-07-21T03:30:00.000Z',
      reason: '  ช่วยจัดกิจกรรมร่วมกันจนเสร็จ  ',
      evidenceNote: '  ครูประจำกิจกรรมตรวจรายชื่อแล้ว  ',
    })

    expect(result).toMatchObject({
      batchId: '44',
      classroomId: '8',
      targetCount: 2,
      requests: [
        expect.objectContaining({ studentId: '12', requestId: '71' }),
        expect.objectContaining({ studentId: '13', requestId: '72' }),
      ],
    })
    expect(rpc).toHaveBeenCalledWith('request_point_additions_bulk', {
      p_client_request_id: '98d2826b-861c-4273-90fd-c7a357cb87ea',
      p_scope: 'selected',
      p_student_ids: ['12', '13'],
      p_classroom_id: '8',
      p_positive_rule_id: '17',
      p_points: 5,
      p_activity_occurred_at: '2026-07-21T03:30:00.000Z',
      p_reason: 'ช่วยจัดกิจกรรมร่วมกันจนเสร็จ',
      p_evidence_note: 'ครูประจำกิจกรรมตรวจรายชื่อแล้ว',
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

  it('adds points to a full classroom with one atomic administrator RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        replayed: false,
        batchId: 55,
        scope: 'classroom',
        classroomId: 8,
        targetCount: 2,
        requestedPointsEach: 10,
        totalAppliedPoints: 14,
        results: [
          { ledgerId: 301, studentId: 12, requestedPoints: 10, appliedPoints: 4, balanceBefore: 96, balanceAfter: 100 },
          { ledgerId: 302, studentId: 13, requestedPoints: 10, appliedPoints: 10, balanceBefore: 80, balanceAfter: 90 },
        ],
      },
      error: null,
    })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const actions = createSupabaseActions({ rpc } as unknown as SupabaseClient, refresh)

    const result = await actions.adminAddPointsBulk({
      clientRequestId: '11cf704e-f534-4da7-85b5-32356afdd230',
      scope: 'classroom',
      studentIds: ['12', '13'],
      classroomId: '8',
      positiveRuleId: '7',
      points: 10,
      activityOccurredAt: '2026-07-21T04:00:00.000Z',
      reason: '  ร่วมกิจกรรมจิตอาสาทั้งห้อง  ',
      evidenceNote: '  ครูที่ปรึกษาตรวจรายชื่อแล้ว  ',
      termId: '9',
    })

    expect(result).toMatchObject({
      batchId: '55',
      targetCount: 2,
      totalAppliedPoints: 14,
      results: [
        expect.objectContaining({ ledgerId: '301', studentId: '12', appliedPoints: 4 }),
        expect.objectContaining({ ledgerId: '302', studentId: '13', appliedPoints: 10 }),
      ],
    })
    expect(rpc).toHaveBeenCalledWith('admin_add_points_bulk', {
      p_client_request_id: '11cf704e-f534-4da7-85b5-32356afdd230',
      p_scope: 'classroom',
      p_student_ids: ['12', '13'],
      p_classroom_id: '8',
      p_positive_rule_id: '7',
      p_points: 10,
      p_activity_occurred_at: '2026-07-21T04:00:00.000Z',
      p_reason: 'ร่วมกิจกรรมจิตอาสาทั้งห้อง',
      p_evidence_note: 'ครูที่ปรึกษาตรวจรายชื่อแล้ว',
      p_term_id: '9',
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('activates a planned term through the admin-only RPC and refreshes once', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ok: true, updated: true, term_id: 9, status: 'active' },
      error: null,
    })
    const refresh = vi.fn().mockResolvedValue(undefined)
    const actions = createSupabaseActions({ rpc } as unknown as SupabaseClient, refresh)

    await actions.activateTerm('9')

    expect(rpc).toHaveBeenCalledWith('admin_activate_term', { p_term_id: '9' })
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
