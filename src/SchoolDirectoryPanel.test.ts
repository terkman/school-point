import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SchoolDirectoryPanel } from './SchoolDirectoryPanel'
import { classroomDisplayName, normalizeDirectorySnapshot } from './schoolDirectory'

const snapshot = normalizeDirectorySnapshot({
  termId: '9',
  termLabel: 'ภาคเรียนที่ 1/2569',
  classrooms: [{ id: '12', name: 'ม.1/0', gradeLevel: 'M1', roomNumber: '0' }],
  students: [{
    id: '31',
    studentCode: '2134',
    username: '2134',
    title: 'ด.ช.',
    givenName: 'ทดสอบ',
    familyName: 'นักเรียน',
    status: 'active',
    classroomId: '12',
    classroomName: 'ม.1/0',
    accountActive: true,
    activationRequired: true,
  }],
  staff: [{
    id: '8',
    employeeCode: '220258_01',
    username: '220258_01',
    title: 'นาย',
    givenName: 'ตัวอย่าง',
    familyName: 'ครูประจำชั้น',
    status: 'active',
    role: 'teacher',
    classroomIds: ['12'],
    accountActive: true,
    activationRequired: false,
  }],
})

describe('school directory administration', () => {
  it('normalizes the web directory snapshot without exposing passwords', () => {
    expect(snapshot.students[0]).toMatchObject({
      studentCode: '2134',
      classroomName: 'ม.1/0',
      activationRequired: true,
    })
    expect(snapshot.staff[0]).toMatchObject({
      role: 'teacher',
      classroomIds: ['12'],
    })
    expect(snapshot.students[0]).not.toHaveProperty('password')
  })

  it('formats a single-room grade without a slash and numbered rooms with a slash', () => {
    expect(classroomDisplayName('P1', '0')).toBe('ป.1')
    expect(classroomDisplayName('M3', '2')).toBe('ม.3/2')
  })

  it('renders the director directory as read-only', () => {
    const markup = renderToStaticMarkup(createElement(SchoolDirectoryPanel, {
      initialSnapshot: snapshot,
      readOnly: true,
    }))

    expect(markup).toContain('ศูนย์บริหารบุคคลและบัญชี')
    expect(markup).toContain('ผู้อำนวยการดูข้อมูลได้ทั้งหมด')
    expect(markup).toContain('2134')
    expect(markup).toContain('ชั้นและห้อง')
    expect(markup).not.toContain('เพิ่มนักเรียน')
    expect(markup).not.toContain('>แก้ไข<')
    expect(markup).not.toMatch(/<button[^>]*>ออกรหัสครั้งแรก/)
  })
})
