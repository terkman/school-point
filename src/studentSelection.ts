import type { DeductionScope } from './dataActions'
import type { Student } from './domain'

export interface ClassroomGroup {
  id: string
  name: string
  gradeLevel: string
  gradeLabel: string
  roomNumber: string
  students: Student[]
}

export interface StudentTargetSelection {
  scope: DeductionScope
  gradeLevel: string
  classroomId: string
  singleStudentId: string
  selectedStudentIds: Set<string>
}

const gradeOrder = new Map([
  ['P1', 1],
  ['P2', 2],
  ['P3', 3],
  ['P4', 4],
  ['P5', 5],
  ['P6', 6],
  ['M1', 7],
  ['M2', 8],
  ['M3', 9],
])

export function inferGradeLevel(student: Student): string {
  const explicit = student.gradeLevel?.trim().toUpperCase()
  if (explicit) return explicit

  const thaiMatch = student.classroomName.match(/([ปม])\s*\.?\s*([1-6])/)
  if (thaiMatch) return `${thaiMatch[1] === 'ป' ? 'P' : 'M'}${thaiMatch[2]}`

  const codeMatch = student.classroomName.match(/\b([PM])\s*([1-6])\b/i)
  if (codeMatch) return `${codeMatch[1].toUpperCase()}${codeMatch[2]}`

  return `OTHER:${student.classroomName.trim() || 'ไม่ระบุ'}`
}

export function formatGradeLabel(gradeLevel: string): string {
  const match = gradeLevel.match(/^([PM])([1-6])$/)
  if (!match) return gradeLevel.startsWith('OTHER:') ? 'อื่น ๆ' : gradeLevel
  return `${match[1] === 'P' ? 'ป' : 'ม'}.${match[2]}`
}

export function buildClassroomGroups(students: Student[]): ClassroomGroup[] {
  const byId = new Map<string, ClassroomGroup>()
  for (const student of students) {
    if (student.status !== 'active') continue
    const gradeLevel = inferGradeLevel(student)
    const existing = byId.get(student.classroomId)
    if (existing) {
      existing.students.push(student)
      continue
    }
    byId.set(student.classroomId, {
      id: student.classroomId,
      name: student.classroomName,
      gradeLevel,
      gradeLabel: formatGradeLabel(gradeLevel),
      roomNumber: student.roomNumber?.trim() || student.classroomName,
      students: [student],
    })
  }

  return [...byId.values()].sort((left, right) => {
    const gradeDifference = (gradeOrder.get(left.gradeLevel) ?? 999) - (gradeOrder.get(right.gradeLevel) ?? 999)
    if (gradeDifference) return gradeDifference
    return left.name.localeCompare(right.name, 'th', { numeric: true })
  })
}

export function createInitialStudentSelection(
  students: Student[],
  scope: DeductionScope = 'single',
): StudentTargetSelection {
  const firstClassroom = buildClassroomGroups(students)[0]
  return {
    scope,
    gradeLevel: firstClassroom?.gradeLevel ?? '',
    classroomId: firstClassroom?.id ?? '',
    singleStudentId: firstClassroom?.students[0]?.id ?? '',
    selectedStudentIds: new Set(),
  }
}

export function selectionForStudent(
  students: Student[],
  studentId: string,
  scope: DeductionScope = 'single',
): StudentTargetSelection {
  const student = students.find((item) => item.id === studentId)
  if (!student) return createInitialStudentSelection(students, scope)
  return {
    scope,
    gradeLevel: inferGradeLevel(student),
    classroomId: student.classroomId,
    singleStudentId: student.id,
    selectedStudentIds: new Set(scope === 'selected' ? [student.id] : []),
  }
}

export function resolveStudentTargets(
  students: Student[],
  selection: StudentTargetSelection,
): Student[] {
  const classroomStudents = students.filter((student) => (
    student.status === 'active'
    && student.classroomId === selection.classroomId
    && inferGradeLevel(student) === selection.gradeLevel
  ))

  if (selection.scope === 'classroom') return classroomStudents
  if (selection.scope === 'single') {
    return classroomStudents.filter((student) => student.id === selection.singleStudentId)
  }

  return classroomStudents.filter((student) => selection.selectedStudentIds.has(student.id))
}
