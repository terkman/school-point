import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AdminRuleCatalog } from './AdminRuleCatalog'
import { createDemoState } from './demoData'
import { StudentTargetSelector } from './StudentTargetSelector'
import { TeacherDashboard } from './TeacherDashboard'
import { createInitialStudentSelection } from './studentSelection'

describe('student profile projection', () => {
  it('shows nickname and uploaded avatar in staff student selection', () => {
    const demo = createDemoState()
    const students = demo.students.map((student, index) => index === 0
      ? { ...student, nickname: 'ดาว', avatarUrl: 'https://example.invalid/avatar.webp' }
      : student)
    const markup = renderToStaticMarkup(createElement(StudentTargetSelector, {
      students,
      value: createInitialStudentSelection(students),
      onChange: () => undefined,
      disabled: false,
      actionLabel: 'ตัดคะแนน',
    }))

    expect(markup).toContain('(ดาว)')
    expect(markup).toContain('avatar.webp')
  })
})

describe('teacher expanded capabilities', () => {
  it('shows all active students with the explicit schoolwide score grant', () => {
    const demo = createDemoState()
    const account = demo.accounts.find((item) => item.role === 'teacher')
    if (!account?.teacherId) throw new Error('Teacher demo account is missing')
    const teacher = demo.teachers.find((item) => item.id === account.teacherId)
    if (!teacher) throw new Error('Teacher record is missing')
    const otherStudent = demo.students.find((student) => !teacher.classroomIds.includes(student.classroomId))
    if (!otherStudent) throw new Error('Cross-class demo student is missing')
    const state = {
      ...demo,
      teachers: demo.teachers.map((item) => item.id === teacher.id ? { ...item, canScoreAllClassrooms: true } : item),
    }

    const markup = renderToStaticMarkup(createElement(TeacherDashboard, {
      account,
      state,
      initialTab: 'overview',
      onChange: () => undefined,
      onLogout: () => undefined,
    }))

    expect(markup).toContain(otherStudent.name)
    expect(markup).toContain('ทุกชั้นเรียน')
    expect(markup).toContain('ยังใช้ขั้นตอนอนุมัติเดิม')
  })

  it('renders the teacher rule proposal form and status history', () => {
    const demo = createDemoState()
    const account = demo.accounts.find((item) => item.role === 'teacher')
    if (!account) throw new Error('Teacher demo account is missing')
    const state = {
      ...demo,
      ruleProposals: [{
        id: 'proposal-1',
        proposedBy: account.id,
        kind: 'deduction' as const,
        title: 'ข้อเสนอทดสอบ',
        points: 5,
        discretionary: false,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      }],
    }
    const markup = renderToStaticMarkup(createElement(TeacherDashboard, {
      account,
      state,
      initialTab: 'rules',
      onChange: () => undefined,
      onLogout: () => undefined,
    }))

    expect(markup).toContain('สร้างข้อเสนอเกณฑ์คะแนน')
    expect(markup).toContain('ข้อเสนอทดสอบ')
    expect(markup).toContain('รอตรวจ')
  })
})

describe('administrator rule governance', () => {
  it('renders pending proposals and versioned edit controls', () => {
    const demo = createDemoState()
    const markup = renderToStaticMarkup(createElement(AdminRuleCatalog, {
      deductionRules: demo.rules,
      positiveRules: demo.positiveRules,
      proposals: [{
        id: 'proposal-1',
        proposedBy: 'teacher-1',
        kind: 'positive',
        title: 'ช่วยดูแลรุ่นน้อง',
        points: 5,
        discretionary: false,
        status: 'pending',
        createdAt: new Date().toISOString(),
      }],
      busy: false,
      onCreateBehavior: async () => undefined,
      onCreatePositive: async () => undefined,
      onUpdateBehavior: async () => undefined,
      onUpdatePositive: async () => undefined,
      onReviewProposal: async () => undefined,
      onRemoveBehavior: async () => undefined,
      onRemovePositive: async () => undefined,
    }))

    expect(markup).toContain('รอตรวจสอบเกณฑ์ใหม่')
    expect(markup).toContain('ช่วยดูแลรุ่นน้อง')
    expect(markup).toContain('แก้ไข')
  })
})
