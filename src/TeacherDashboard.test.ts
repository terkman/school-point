import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDemoState } from './demoData'
import { TeacherDashboard } from './TeacherDashboard'

function renderTeacherTab(initialTab: 'deduct' | 'request'): string {
  const state = createDemoState()
  const account = state.accounts.find((item) => item.role === 'teacher')
  if (!account) throw new Error('Teacher demo account is missing')
  return renderToStaticMarkup(createElement(TeacherDashboard, {
    account,
    state,
    initialTab,
    onChange: () => undefined,
    onLogout: () => undefined,
  }))
}

describe('teacher score pages', () => {
  it('renders deduction as its own page without the score-action switcher', () => {
    const markup = renderTeacherTab('deduct')

    expect(markup).toContain('ตัดคะแนนนักเรียน')
    expect(markup).toContain('ตัดคะแนนพร้อมตรวจสอบรายชื่อ')
    expect(markup).toContain('<b>1</b> เลือกชั้น')
    expect(markup).not.toContain('เลือกงานที่ต้องการทำ')
    expect(markup).not.toContain('กิจกรรมหรือพฤติกรรมเชิงบวก')
  })

  it('renders addition as its own page without the score-action switcher', () => {
    const markup = renderTeacherTab('request')

    expect(markup).toContain('เพิ่มคะแนนนักเรียน')
    expect(markup).toContain('สร้างคำขอเพิ่มคะแนนพร้อมหลักฐาน')
    expect(markup).toContain('<b>1</b> เลือกชั้น')
    expect(markup).not.toContain('เลือกงานที่ต้องการทำ')
    expect(markup).not.toContain('บันทึกการกระทำผิดระเบียบ')
  })

  it('explains why class, room, and scope controls are unavailable without an assignment', () => {
    const state = createDemoState()
    const account = state.accounts.find((item) => item.role === 'teacher')
    if (!account?.teacherId) throw new Error('Teacher demo account is missing')
    const unassignedState = {
      ...state,
      teachers: state.teachers.map((teacher) => teacher.id === account.teacherId
        ? { ...teacher, classroomIds: [] }
        : teacher),
    }

    const markup = renderToStaticMarkup(createElement(TeacherDashboard, {
      account,
      state: unassignedState,
      initialTab: 'deduct',
      onChange: () => undefined,
      onLogout: () => undefined,
    }))

    expect(markup).toContain('ยังไม่มีชั้นในสิทธิ์')
    expect(markup).toContain('ยังไม่มีห้องในสิทธิ์')
    expect(markup).toContain('ยังเลือกชั้น ห้อง และขอบเขตไม่ได้')
    expect(markup).toContain('ผู้ดูแลระบบกำหนดห้องที่รับผิดชอบก่อน')
  })
})
