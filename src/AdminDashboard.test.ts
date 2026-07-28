import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AdminDashboard, TeacherClassroomAssignmentEditor, TermScheduleForm } from './AdminDashboard'
import { createDemoState } from './demoData'
import { buildClassroomGroups } from './studentSelection'

describe('admin academic-term activation', () => {
  it('requires an explicit confirmation before enabling a planned term', () => {
    const demo = createDemoState()
    const term = {
      ...demo.term,
      isActive: false,
      startsOn: '2026-05-18',
      endsOn: '2026-10-09',
    }

    const markup = renderToStaticMarkup(createElement(TermScheduleForm, {
      term,
      busy: false,
      activating: false,
      onSave: async () => undefined,
      onActivate: async () => undefined,
    }))

    expect(markup).toContain('เตรียมเปิดใช้')
    expect(markup).toContain('เปิดใช้งานภาคเรียน')
    expect(markup).toContain('ยืนยันว่าตรวจสอบวันเปิด–ปิด')
    expect(markup).toContain('type="checkbox"')
  })
})

describe('admin teacher classroom assignments', () => {
  it('shows every classroom and the current access count for the selected teacher', () => {
    const demo = createDemoState()
    const teacher = demo.teachers[0]
    const classrooms = buildClassroomGroups(demo.students)

    const markup = renderToStaticMarkup(createElement(TeacherClassroomAssignmentEditor, {
      teacher,
      classrooms,
      busy: false,
      onSave: async () => undefined,
      termId: demo.term.id,
    }))

    expect(markup).toContain(teacher.name)
    expect(markup).toContain(`${teacher.classroomIds.length} ห้อง`)
    expect(markup).toContain('เลือกทุกห้อง')
    for (const classroom of classrooms) expect(markup).toContain(classroom.name)
  })
})

describe('admin serious-case workflow', () => {
  it('renders actionable guardian contact, progress, and close controls', () => {
    const demo = createDemoState()
    const account = demo.accounts.find((item) => item.role === 'admin')
    if (!account) throw new Error('Admin demo account is missing')

    const markup = renderToStaticMarkup(createElement(AdminDashboard, {
      account,
      state: demo,
      initialTab: 'cases',
      onChange: () => undefined,
      onLogout: () => undefined,
    }))

    expect(markup).toContain('คิวกรณีร้ายแรง')
    expect(markup).toContain('ดูข้อมูลติดต่อผู้ปกครอง')
    expect(markup).toContain('บันทึกว่าแจ้งผู้ปกครองแล้ว')
    expect(markup).toContain('บันทึกความคืบหน้า')
    expect(markup).toContain('แจ้งผู้ปกครองก่อนปิดเคส')
  })
})

describe('admin point-addition approvals', () => {
  it('opens an actionable review dialog with evidence and both decisions', () => {
    const demo = createDemoState()
    const account = demo.accounts.find((item) => item.role === 'admin')
    if (!account) throw new Error('Admin demo account is missing')

    const markup = renderToStaticMarkup(createElement(AdminDashboard, {
      account,
      state: demo,
      initialTab: 'approvals',
      onChange: () => undefined,
      onLogout: () => undefined,
    }))

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('ตรวจสอบหลักฐานก่อนตัดสินใจ')
    expect(markup).toContain('ปฏิเสธคำขอ')
    expect(markup).toContain('อนุมัติ +5 คะแนน')
    expect(markup).toContain('ระบุเหตุผลอย่างน้อย 5 ตัวอักษร')
    expect(markup).toContain('ปิดรายละเอียดคำขอเพิ่มคะแนน')
  })
})
