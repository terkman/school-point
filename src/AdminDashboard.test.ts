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
  it('renders the case queue, channel choices, reminder semantics, and close guard', () => {
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

    expect(markup).toContain('เคสที่ต้องติดตาม')
    expect(markup).toContain('ดูข้อมูลติดต่อ')
    expect(markup).toContain('โทรศัพท์')
    expect(markup).toContain('LINE')
    expect(markup).toContain('Messenger')
    expect(markup).toContain('ตัวเลือกสุดท้าย')
    expect(markup).toContain('เตือนอีกครั้งใน 1 วัน')
    expect(markup).toContain('บันทึกผลการติดต่อ')
    expect(markup).toContain('บันทึกความคืบหน้า')
    expect(markup).toContain('แจ้งผู้ปกครองก่อนปิดเคส')
  })
})

describe('admin score approvals', () => {
  it('renders separate deduction, addition, and appeal queues', () => {
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

    expect(markup).toContain('รอการพิจารณา')
    expect(markup).toContain('3 งานที่ต้องตรวจ')
    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('ขอตัดคะแนน')
    expect(markup).toContain('ขอเพิ่มคะแนน')
    expect(markup).toContain('คำอุทธรณ์')
    expect(markup).toContain('กลั่นแกล้งผู้อื่น')
    expect(markup).toContain('-15')
  })
})

describe('admin appeal dashboard', () => {
  it('summarizes pending appeals in the Today review queue', () => {
    const demo = createDemoState()
    const account = demo.accounts.find((item) => item.role === 'admin')
    const source = demo.transactions.find((item) => item.kind === 'deduction')
    if (!account || !source) throw new Error('Admin appeal demo fixtures are missing')
    demo.appeals = [{
      id: 'appeal-dashboard-test',
      transactionId: source.id,
      studentId: source.studentId,
      statement: 'ขอให้ตรวจสอบหลักฐานการเข้าเรียนอีกครั้ง',
      status: 'submitted',
      createdAt: new Date().toISOString(),
    }]

    const markup = renderToStaticMarkup(createElement(AdminDashboard, {
      account,
      state: demo,
      initialTab: 'overview',
      onChange: () => undefined,
      onLogout: () => undefined,
    }))

    expect(markup).toContain('ภาพรวม</span>วันนี้')
    expect(markup).toContain('งานรอตรวจ')
    expect(markup).toContain('คำอุทธรณ์')
    expect(markup).toContain('รอพิจารณา')
    expect(markup).toContain('เปิดศูนย์ตรวจสอบ')
  })
})
