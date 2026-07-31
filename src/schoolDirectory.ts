import type { Role } from './domain'

export type PersonStatus = 'active' | 'suspended' | 'graduated' | 'archived'
export type StaffRole = Extract<Role, 'teacher' | 'director' | 'admin'>

export interface DirectoryClassroom {
  id: string
  name: string
  gradeLevel: string
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
}

export interface CreateSchoolPersonResult {
  id: string
  username: string
  activationCode?: string
  issuedAt?: string
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
        gradeLevel: String(entry.gradeLevel ?? ''),
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
