import { describe, expect, it } from 'vitest'
import type { Student } from './domain'
import {
  buildClassroomGroups,
  createInitialStudentSelection,
  formatGradeLabel,
  inferGradeLevel,
  resolveStudentTargets,
  selectionForStudent,
} from './studentSelection'

const students: Student[] = [
  { id: '1', studentCode: '001', name: 'หนึ่ง', classroomId: 'm1-1', classroomName: 'ม.1/1', gradeLevel: 'M1', roomNumber: '1', score: 100, status: 'active' },
  { id: '2', studentCode: '002', name: 'สอง', classroomId: 'm1-1', classroomName: 'ม.1/1', gradeLevel: 'M1', roomNumber: '1', score: 90, status: 'active' },
  { id: '3', studentCode: '003', name: 'สาม', classroomId: 'm1-2', classroomName: 'ม.1/2', gradeLevel: 'M1', roomNumber: '2', score: 80, status: 'active' },
  { id: '4', studentCode: '004', name: 'สี่', classroomId: 'm2-1', classroomName: 'ม.2/1', gradeLevel: 'M2', roomNumber: '1', score: 70, status: 'active' },
  { id: '5', studentCode: '005', name: 'จบแล้ว', classroomId: 'm1-1', classroomName: 'ม.1/1', gradeLevel: 'M1', roomNumber: '1', score: 100, status: 'graduated' },
]

describe('grade and classroom grouping', () => {
  it('uses database grade levels and excludes inactive students', () => {
    const classrooms = buildClassroomGroups(students)
    expect(classrooms.map((item) => `${item.gradeLabel}:${item.name}:${item.students.length}`)).toEqual([
      'ม.1:ม.1/1:2',
      'ม.1:ม.1/2:1',
      'ม.2:ม.2/1:1',
    ])
  })

  it('can infer Thai classroom names when older data has no grade field', () => {
    expect(inferGradeLevel({ ...students[0], gradeLevel: undefined })).toBe('M1')
    expect(formatGradeLabel('P6')).toBe('ป.6')
  })
})

describe('classroom-scoped target selection', () => {
  it('initializes from the first grade and classroom', () => {
    expect(createInitialStudentSelection(students)).toMatchObject({
      scope: 'single',
      gradeLevel: 'M1',
      classroomId: 'm1-1',
      singleStudentId: '1',
    })
  })

  it('starts the unified checkbox picker empty to prevent accidental bulk scoring', () => {
    const selection = createInitialStudentSelection(students, 'selected')
    expect([...selection.selectedStudentIds]).toEqual([])
    expect(resolveStudentTargets(students, selection)).toEqual([])
  })

  it('never includes selected ids from another classroom', () => {
    const selection = {
      ...createInitialStudentSelection(students, 'selected'),
      selectedStudentIds: new Set(['1', '2', '3', '4']),
    }
    expect(resolveStudentTargets(students, selection).map((item) => item.id)).toEqual(['1', '2'])
  })

  it('resolves the exact active classroom roster', () => {
    const selection = {
      ...createInitialStudentSelection(students, 'classroom'),
      scope: 'classroom' as const,
    }
    expect(resolveStudentTargets(students, selection).map((item) => item.id)).toEqual(['1', '2'])
  })

  it('opens the correct grade, classroom, and student from a roster shortcut', () => {
    expect(selectionForStudent(students, '4')).toMatchObject({
      gradeLevel: 'M2',
      classroomId: 'm2-1',
      singleStudentId: '4',
    })
  })
})
