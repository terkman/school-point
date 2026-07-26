import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TeacherClassroomAssignmentEditor, TermScheduleForm } from './AdminDashboard'
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
