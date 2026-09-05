import type { Role } from './domain'

export type PersonStatus = 'active' | 'suspended' | 'graduated' | 'archived'
export type StaffRole = Extract<Role, 'teacher' | 'director' | 'admin'>
export type GradeLevel = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'M1' | 'M2' | 'M3'

export interface DirectoryClassroom {
  id: string
  name: string
  gradeLevel: GradeLevel
  roomNumber: string
}

export interface DirectoryStudent {
  id: string
  studentCode: string
  username: string
  title: string
  givenName: string
  familyName: string
  status: PersonStatus
  classroomId: string
  classroomName: string
  birthDate: string
  accountActive: boolean
  activationRequired: boolean
}

export interface DirectoryStaff {
  id: string
  employeeCode: string
  username: string
  title: string
  givenName: string
  familyName: string
  status: Exclude<PersonStatus, 'graduated'>
  role: StaffRole
  classroomIds: string[]
  accountActive: boolean
  activationRequired: boolean
}

export interface SchoolDirectorySnapshot {
  termId: string
  termLabel: string
  classrooms: DirectoryClassroom[]
  students: DirectoryStudent[]
  staff: DirectoryStaff[]
}

export interface CreateSchoolPersonInput {
  kind: 'student' | 'staff'
  username: string
  code: string
  title: string
  givenName: string
  familyName: string
  role?: StaffRole
  classroomIds?: string[]
  classroomId?: string
  birthDate?: string
}

export interface UpdateSchoolStudentInput {
  studentId: string
  title: string
  givenName: string
  familyName: string
  status: PersonStatus
  classroomId?: string
  birthDate?: string
}

export interface UpdateSchoolStaffInput {
  teacherId: string
  title: string
  givenName: string
  familyName: string
  status: Exclude<PersonStatus, 'graduated'>
  role: StaffRole
  classroomIds: string[]
}

export interface ActivationCodeResult {
  username: string
  activationCode: string
  issuedAt: string
  expiresAt?: string
  purpose: 'activation' | 'password-reset'
}

export interface PasswordResetInput {
  username: string
  reason: string
}

export interface PasswordResetCodeResult extends ActivationCodeResult {
  purpose: 'password-reset'
}

export interface CreateSchoolPersonResult {
  id: string
  username: string
  activationCode?: string
  issuedAt?: string
  expiresAt?: string
  purpose?: 'activation' | 'password-reset'
}

export interface CreateSchoolClassroomInput {
  termId: string
  gradeLevel: GradeLevel
  roomNumber: string
}

export type CreateSchoolClassroomResult = DirectoryClassroom

export const gradeLevelOptions: ReadonlyArray<{ value: GradeLevel; label: string }> = [
  { value: 'P1', label: 'ประถมศึกษาปีที่ 1' },
  { value: 'P2', label: 'ประถมศึกษาปีที่ 2' },
  { value: 'P3', label: 'ประถมศึกษาปีที่ 3' },
  { value: 'P4', label: 'ประถมศึกษาปีที่ 4' },
  { value: 'P5', label: 'ประถมศึกษาปีที่ 5' },
  { value: 'P6', label: 'ประถมศึกษาปีที่ 6' },
  { value: 'M1', label: 'มัธยมศึกษาปีที่ 1' },
  { value: 'M2', label: 'มัธยมศึกษาปีที่ 2' },
  { value: 'M3', label: 'มัธยมศึกษาปีที่ 3' },
]

const shortGradeLabels: Record<GradeLevel, string> = {
  P1: 'ป.1',
  P2: 'ป.2',
  P3: 'ป.3',
  P4: 'ป.4',
  P5: 'ป.5',
  P6: 'ป.6',
  M1: 'ม.1',
  M2: 'ม.2',
  M3: 'ม.3',
}

export function classroomDisplayName(gradeLevel: GradeLevel, roomNumber: string): string {
  const grade = shortGradeLabels[gradeLevel]
  const room = roomNumber.trim()
  return room === '0' ? grade : `${grade}/${room}`
}

export const staffRoleLabels: Record<StaffRole, string> = {
  teacher: 'ครู',
  director: 'ผู้อำนวยการ',
  admin: 'ผู้ดูแลระบบ',
}

export const personStatusLabels: Record<PersonStatus, string> = {
  active: 'กำลังใช้งาน',
  suspended: 'ระงับชั่วคราว',
  graduated: 'จบการศึกษา',
  archived: 'ย้ายออก/ปิดใช้งาน',
}

export function normalizeDirectorySnapshot(value: unknown): SchoolDirectorySnapshot {
  if (!value || typeof value !== 'object') throw new Error('ข้อมูลศูนย์บริหารโรงเรียนไม่ถูกต้อง')
  const row = value as Record<string, unknown>
  const classrooms = Array.isArray(row.classrooms) ? row.classrooms : []
  const students = Array.isArray(row.students) ? row.students : []
  const staff = Array.isArray(row.staff) ? row.staff : []
  return {
    termId: String(row.termId ?? ''),
    termLabel: String(row.termLabel ?? ''),
    classrooms: classrooms.map((item) => {
      const entry = item as Record<string, unknown>
      return {
        id: String(entry.id ?? ''),
        name: String(entry.name ?? ''),
        gradeLevel: String(entry.gradeLevel ?? '') as GradeLevel,
        roomNumber: String(entry.roomNumber ?? ''),
      }
    }),
    students: students.map((item) => {
      const entry = item as Record<string, unknown>
      return {
        id: String(entry.id ?? ''),
        studentCode: String(entry.studentCode ?? ''),
        username: String(entry.username ?? ''),
        title: String(entry.title ?? ''),
        givenName: String(entry.givenName ?? ''),
        familyName: String(entry.familyName ?? ''),
        status: String(entry.status ?? 'archived') as PersonStatus,
        classroomId: String(entry.classroomId ?? ''),
        classroomName: String(entry.classroomName ?? ''),
        birthDate: String(entry.birthDate ?? ''),
        accountActive: entry.accountActive === true,
        activationRequired: entry.activationRequired === true,
      }
    }),
    staff: staff.map((item) => {
      const entry = item as Record<string, unknown>
      return {
        id: String(entry.id ?? ''),
        employeeCode: String(entry.employeeCode ?? ''),
        username: String(entry.username ?? ''),
        title: String(entry.title ?? ''),
        givenName: String(entry.givenName ?? ''),
        familyName: String(entry.familyName ?? ''),
        status: String(entry.status ?? 'archived') as DirectoryStaff['status'],
        role: String(entry.role ?? 'teacher') as StaffRole,
        classroomIds: Array.isArray(entry.classroomIds) ? entry.classroomIds.map(String) : [],
        accountActive: entry.accountActive === true,
        activationRequired: entry.activationRequired === true,
      }
    }),
  }
}
