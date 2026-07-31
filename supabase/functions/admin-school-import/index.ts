import ExcelJS from 'npm:exceljs@4.4.0'
import { createClient } from 'npm:@supabase/supabase-js@2.110.2'
import { isActiveDirectoryAdmin } from '../_shared/directoryAuthorization.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}

const authDomain = 'accounts.school-point.invalid'
const maxFileBytes = 10 * 1024 * 1024
const maxRows = 5_000
const headerRowNumber = 4
const firstDataRowNumber = 5
const usernamePattern = /^[a-z0-9][a-z0-9._-]*[a-z0-9]$|^[a-z0-9]$/
const gradeLevels = new Set(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'M1', 'M2', 'M3'])
const requiredSheets = ['ห้องเรียน', 'นักเรียน', 'บุคลากร', 'ห้องที่ครูรับผิดชอบ', 'ผู้ปกครอง'] as const

type JsonRecord = Record<string, unknown>
type Severity = 'error' | 'warning'

interface ImportIssue {
  severity: Severity
  code: string
  sheet: string
  row?: number
  column?: string
  message: string
}

interface ParsedRow extends JsonRecord {
  __row: number
}

interface SheetColumn {
  key: string
  header: string
}

interface DirectoryClassroom {
  id: string
  name: string
  gradeLevel: string
  roomNumber: string
}

interface DirectoryStudent {
  id: string
  studentCode: string
  username: string
  title: string
  givenName: string
  familyName: string
  status: string
  classroomId: string
  birthDate: string
}

interface DirectoryStaff {
  id: string
  employeeCode: string
  username: string
  title: string
  givenName: string
  familyName: string
  status: string
  role: string
  classroomIds: string[]
}

interface DirectorySnapshot {
  termId: string
  termLabel: string
  classrooms: DirectoryClassroom[]
  students: DirectoryStudent[]
  staff: DirectoryStaff[]
}

interface ImportContext {
  snapshot: DirectorySnapshot
  term: {
    id: number
    school_year: number
    semester: number
    name: string
    starts_on: string | null
    ends_on: string | null
  }
  assignmentRows: Array<{
    teacher_id: number
    classroom_id: number
    subject_name: string | null
    is_active: boolean
  }>
}

const sheetColumns: Record<(typeof requiredSheets)[number], SheetColumn[]> = {
  ห้องเรียน: [
    { key: 'gradeLevel', header: 'ระดับชั้น' },
    { key: 'roomNumber', header: 'ห้อง' },
    { key: 'displayName', header: 'ชื่อที่แสดง' },
  ],
  นักเรียน: [
    { key: 'studentCode', header: 'รหัสนักเรียน' },
    { key: 'title', header: 'คำนำหน้า' },
    { key: 'givenName', header: 'ชื่อ' },
    { key: 'familyName', header: 'นามสกุล' },
    { key: 'studentNumber', header: 'เลขที่' },
    { key: 'gradeLevel', header: 'ระดับชั้น' },
    { key: 'roomNumber', header: 'ห้อง' },
    { key: 'birthDate', header: 'วันเกิด' },
    { key: 'isActive', header: 'สถานะ' },
  ],
  บุคลากร: [
    { key: 'employeeCode', header: 'รหัสบุคลากร' },
    { key: 'username', header: 'ชื่อผู้ใช้' },
    { key: 'title', header: 'คำนำหน้า' },
    { key: 'givenName', header: 'ชื่อ' },
    { key: 'familyName', header: 'นามสกุล' },
    { key: 'role', header: 'ตำแหน่งและสิทธิ์' },
    { key: 'isActive', header: 'สถานะ' },
  ],
  'ห้องที่ครูรับผิดชอบ': [
    { key: 'employeeCode', header: 'รหัสบุคลากร' },
    { key: 'gradeLevel', header: 'ระดับชั้น' },
    { key: 'roomNumber', header: 'ห้อง' },
    { key: 'subjectName', header: 'หน้าที่' },
    { key: 'isActive', header: 'สถานะ' },
  ],
  ผู้ปกครอง: [
    { key: 'studentCode', header: 'รหัสนักเรียน' },
    { key: 'contactOrder', header: 'ลำดับผู้ปกครอง' },
    { key: 'name', header: 'ชื่อผู้ปกครอง' },
    { key: 'relationship', header: 'ความสัมพันธ์' },
    { key: 'phone', header: 'เบอร์โทร' },
  ],
}

function response(status: number, body: JsonRecord) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

function environmentKey(mapName: string, legacyName: string): string {
  const rawMap = Deno.env.get(mapName)
  if (rawMap) {
    try {
      const values = JSON.parse(rawMap) as Record<string, unknown>
      const value = values.default
      if (typeof value === 'string' && value.trim()) return value
    } catch {
      throw new Error(`การตั้งค่า ${mapName} ไม่ถูกต้อง`)
    }
  }
  return Deno.env.get(legacyName) ?? ''
}

function issue(
  issues: ImportIssue[],
  severity: Severity,
  code: string,
  sheet: string,
  message: string,
  row?: number,
  column?: string,
) {
  issues.push({ severity, code, sheet, row, column, message })
}

function normalizedHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/\*/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLocaleLowerCase('th')
}

function cellValue(cell: ExcelJS.Cell, issues: ImportIssue[], sheet: string, row: number, column: string): unknown {
  const value = cell.value
  if (value && typeof value === 'object' && 'formula' in value) {
    issue(issues, 'error', 'FORMULA_NOT_ALLOWED', sheet, 'ไม่รองรับสูตรในช่องข้อมูล กรุณาวางเป็นค่าเท่านั้น', row, column)
    return null
  }
  if (value && typeof value === 'object' && 'richText' in value) return cell.text
  if (value && typeof value === 'object' && 'text' in value) return cell.text
  return value
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (value instanceof Date) return true
  return String(value).trim() !== ''
}

function readSheet(
  workbook: ExcelJS.Workbook,
  sheetName: (typeof requiredSheets)[number],
  issues: ImportIssue[],
): ParsedRow[] {
  const worksheet = workbook.getWorksheet(sheetName)
  if (!worksheet) {
    issue(issues, 'error', 'MISSING_SHEET', sheetName, `ไม่พบแผ่นงาน “${sheetName}”`)
    return []
  }
  const columns = sheetColumns[sheetName]
  const headerRow = worksheet.getRow(headerRowNumber)
  const indexes = new Map<string, number>()
  headerRow.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    indexes.set(normalizedHeader(cell.text), columnNumber)
  })
  for (const column of columns) {
    if (!indexes.has(normalizedHeader(column.header))) {
      issue(issues, 'error', 'MISSING_COLUMN', sheetName, `ไม่พบคอลัมน์ “${column.header}” ในแถวที่ ${headerRowNumber}`, headerRowNumber, column.header)
    }
  }
  if (issues.some((item) => item.severity === 'error' && item.sheet === sheetName && item.code === 'MISSING_COLUMN')) return []

  const rows: ParsedRow[] = []
  const lastRow = Math.min(Math.max(worksheet.actualRowCount, firstDataRowNumber - 1), firstDataRowNumber + maxRows)
  for (let rowNumber = firstDataRowNumber; rowNumber <= lastRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    const parsed: ParsedRow = { __row: rowNumber }
    let nonEmpty = false
    for (const column of columns) {
      const columnNumber = indexes.get(normalizedHeader(column.header))!
      const value = cellValue(row.getCell(columnNumber), issues, sheetName, rowNumber, column.header)
      parsed[column.key] = value
      if (hasValue(value)) nonEmpty = true
    }
    if (nonEmpty) rows.push(parsed)
  }
  return rows
}

function text(value: unknown, maxLength = 300): string {
  const result = String(value ?? '').trim()
  return result.slice(0, maxLength)
}

function username(value: unknown): string | null {
  const result = text(value, 80).toLowerCase()
  if (!result) return null
  if (!usernamePattern.test(result) || result.includes('..')) return null
  return result
}

function gradeLevel(value: unknown): string | null {
  const raw = text(value, 30).replace(/\s+/g, '').toUpperCase()
  const aliases: Record<string, string> = {
    'ป.1': 'P1', ป1: 'P1', P1: 'P1',
    'ป.2': 'P2', ป2: 'P2', P2: 'P2',
    'ป.3': 'P3', ป3: 'P3', P3: 'P3',
    'ป.4': 'P4', ป4: 'P4', P4: 'P4',
    'ป.5': 'P5', ป5: 'P5', P5: 'P5',
    'ป.6': 'P6', ป6: 'P6', P6: 'P6',
    'ม.1': 'M1', ม1: 'M1', M1: 'M1',
    'ม.2': 'M2', ม2: 'M2', M2: 'M2',
    'ม.3': 'M3', ม3: 'M3', M3: 'M3',
  }
  return aliases[raw] ?? null
}

function roomNumber(value: unknown): string {
  const raw = text(value, 20)
  if (!raw || ['โรงเรียน', 'ห้องเดียว', 'SCHOOL'].includes(raw.toUpperCase())) return '0'
  return raw
}

function activeValue(value: unknown): boolean | undefined {
  const raw = text(value, 30).replace(/\s+/g, '').toLowerCase()
  if (!raw) return undefined
  if (['ใช้งาน', 'active', 'true', '1', 'ใช่'].includes(raw)) return true
  if (['ไม่ใช้งาน', 'inactive', 'false', '0', 'ไม่'].includes(raw)) return false
  return undefined
}

function roleValue(value: unknown): 'teacher' | 'director' | 'admin' | null {
  const raw = text(value, 60).replace(/\s+/g, '').toLowerCase()
  if (['ครู', 'teacher'].includes(raw)) return 'teacher'
  if (['ผู้อำนวยการ', 'ผอ.', 'ผอ', 'director'].includes(raw)) return 'director'
  if (['ผู้ดูแลระบบ', 'แอดมิน', 'admin', 'administrator'].includes(raw)) return 'admin'
  return null
}

function integerValue(value: unknown): number | null {
  if (!hasValue(value)) return null
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : null
}

function pad(number: number): string {
  return String(number).padStart(2, '0')
}

function isoDate(value: unknown): string | null {
  if (!hasValue(value)) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Math.round((value - 25569) * 86_400_000))
    if (!Number.isNaN(date.getTime())) return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  }
  const raw = text(value, 30)
  let year: number
  let month: number
  let day: number
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (match) {
    year = Number(match[1]); month = Number(match[2]); day = Number(match[3])
  } else {
    match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (!match) return null
    day = Number(match[1]); month = Number(match[2]); year = Number(match[3])
  }
  if (year > 2400) year -= 543
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

function classroomName(grade: string, room: string): string {
  const labels: Record<string, string> = {
    P1: 'ป.1', P2: 'ป.2', P3: 'ป.3', P4: 'ป.4', P5: 'ป.5', P6: 'ป.6',
    M1: 'ม.1', M2: 'ม.2', M3: 'ม.3',
  }
  return room === '0' ? labels[grade] : `${labels[grade]}/${room}`
}

function lowerKey(value: string): string {
  return value.trim().toLowerCase()
}

function statusIsActive(status: string): boolean {
  return status === 'active'
}

function normalizeWorkbook(
  raw: Record<(typeof requiredSheets)[number], ParsedRow[]>,
  context: ImportContext,
  issues: ImportIssue[],
) {
  const classroomById = new Map(context.snapshot.classrooms.map((item) => [item.id, item]))
  const classroomByKey = new Map(context.snapshot.classrooms.map((item) => [
    `${item.gradeLevel}|${lowerKey(item.roomNumber)}`,
    item,
  ]))
  const studentByCode = new Map(context.snapshot.students.map((item) => [lowerKey(item.studentCode), item]))
  const staffByCode = new Map(context.snapshot.staff.map((item) => [lowerKey(item.employeeCode), item]))
  const existingUsernameOwners = new Map<string, string>()
  for (const student of context.snapshot.students) {
    existingUsernameOwners.set(lowerKey(student.studentCode), `student:${lowerKey(student.studentCode)}`)
    if (student.username) existingUsernameOwners.set(lowerKey(student.username), `student:${lowerKey(student.studentCode)}`)
  }
  for (const person of context.snapshot.staff) {
    if (person.username) existingUsernameOwners.set(lowerKey(person.username), `staff:${lowerKey(person.employeeCode)}`)
  }

  const classrooms: JsonRecord[] = []
  const classroomKeys = new Set<string>()
  for (const row of raw.ห้องเรียน) {
    const grade = gradeLevel(row.gradeLevel)
    const room = roomNumber(row.roomNumber)
    if (!grade) {
      issue(issues, 'error', 'INVALID_GRADE', 'ห้องเรียน', 'ระดับชั้นไม่ถูกต้อง', row.__row, 'ระดับชั้น')
      continue
    }
    if (!/^[0-9A-Za-zก-๙._-]+$/.test(room)) {
      issue(issues, 'error', 'INVALID_ROOM', 'ห้องเรียน', 'ห้องใช้ได้เฉพาะตัวอักษร ตัวเลข จุด ขีดกลาง และขีดล่าง', row.__row, 'ห้อง')
      continue
    }
    const key = `${grade}|${lowerKey(room)}`
    if (classroomKeys.has(key)) {
      issue(issues, 'error', 'DUPLICATE_CLASSROOM', 'ห้องเรียน', 'ชั้นและห้องซ้ำกันในไฟล์', row.__row)
      continue
    }
    classroomKeys.add(key)
    const existing = classroomByKey.get(key)
    classrooms.push({
      gradeLevel: grade,
      roomNumber: room,
      displayName: text(row.displayName, 160) || existing?.name || classroomName(grade, room),
    })
  }

  const students: JsonRecord[] = []
  const studentCodes = new Set<string>()
  for (const row of raw.นักเรียน) {
    const code = text(row.studentCode, 80)
    const codeKey = lowerKey(code)
    if (!code || !username(code)) {
      issue(issues, 'error', 'INVALID_STUDENT_CODE', 'นักเรียน', 'กรุณาระบุรหัสนักเรียนที่ใช้เป็นชื่อผู้ใช้ได้', row.__row, 'รหัสนักเรียน')
      continue
    }
    if (studentCodes.has(codeKey)) {
      issue(issues, 'error', 'DUPLICATE_STUDENT', 'นักเรียน', 'รหัสนักเรียนซ้ำกันในไฟล์', row.__row, 'รหัสนักเรียน')
      continue
    }
    const existingUsernameOwner = existingUsernameOwners.get(codeKey)
    if (existingUsernameOwner && existingUsernameOwner !== `student:${codeKey}`) {
      issue(issues, 'error', 'USERNAME_IN_USE', 'นักเรียน', 'รหัสนักเรียนนี้ถูกใช้เป็นชื่อผู้ใช้ของบุคลากรแล้ว', row.__row, 'รหัสนักเรียน')
      continue
    }
    studentCodes.add(codeKey)
    const existing = studentByCode.get(codeKey)
    const existingClassroom = existing ? classroomById.get(existing.classroomId) : undefined
    const givenName = text(row.givenName, 160) || existing?.givenName || ''
    const familyName = text(row.familyName, 160) || existing?.familyName || ''
    const grade = hasValue(row.gradeLevel) ? gradeLevel(row.gradeLevel) : existingClassroom?.gradeLevel ?? null
    const room = hasValue(row.roomNumber) ? roomNumber(row.roomNumber) : existingClassroom?.roomNumber ?? '0'
    if (!givenName || !familyName) {
      issue(issues, 'error', 'STUDENT_NAME_REQUIRED', 'นักเรียน', 'รหัสใหม่ต้องมีชื่อและนามสกุล', row.__row)
      continue
    }
    if (!grade || !gradeLevels.has(grade)) {
      issue(issues, 'error', 'STUDENT_GRADE_REQUIRED', 'นักเรียน', 'กรุณาระบุระดับชั้นสำหรับรหัสใหม่', row.__row, 'ระดับชั้น')
      continue
    }
    const number = integerValue(row.studentNumber)
    if (hasValue(row.studentNumber) && (number === null || number < 1 || number > 9999)) {
      issue(issues, 'error', 'INVALID_STUDENT_NUMBER', 'นักเรียน', 'เลขที่ต้องเป็นตัวเลข 1–9999', row.__row, 'เลขที่')
      continue
    }
    const birthDate = isoDate(row.birthDate)
    if (hasValue(row.birthDate) && !birthDate) {
      issue(issues, 'error', 'INVALID_BIRTH_DATE', 'นักเรียน', 'วันเกิดต้องเป็น YYYY-MM-DD หรือ DD/MM/YYYY', row.__row, 'วันเกิด')
      continue
    }
    const active = activeValue(row.isActive)
    if (hasValue(row.isActive) && active === undefined) {
      issue(issues, 'error', 'INVALID_STATUS', 'นักเรียน', 'สถานะต้องเป็น ใช้งาน หรือ ไม่ใช้งาน', row.__row, 'สถานะ')
      continue
    }
    students.push({
      studentCode: code,
      title: text(row.title, 80) || existing?.title || null,
      givenName,
      familyName,
      gradeLevel: grade,
      roomNumber: room,
      ...(number === null ? {} : { studentNumber: number }),
      ...(birthDate ? { birthDate } : {}),
      ...(active === undefined ? {} : { isActive: active }),
    })
  }

  const staff: JsonRecord[] = []
  const staffCodes = new Set<string>()
  const usernames = new Set<string>(students.map((item) => lowerKey(String(item.studentCode))))
  for (const row of raw.บุคลากร) {
    const code = text(row.employeeCode, 80)
    const codeKey = lowerKey(code)
    if (!code) {
      issue(issues, 'error', 'STAFF_CODE_REQUIRED', 'บุคลากร', 'กรุณาระบุรหัสบุคลากร', row.__row, 'รหัสบุคลากร')
      continue
    }
    if (staffCodes.has(codeKey)) {
      issue(issues, 'error', 'DUPLICATE_STAFF', 'บุคลากร', 'รหัสบุคลากรซ้ำกันในไฟล์', row.__row, 'รหัสบุคลากร')
      continue
    }
    staffCodes.add(codeKey)
    const existing = staffByCode.get(codeKey)
    const givenName = text(row.givenName, 160) || existing?.givenName || ''
    const familyName = text(row.familyName, 160) || existing?.familyName || ''
    const role = hasValue(row.role) ? roleValue(row.role) : existing?.role as 'teacher' | 'director' | 'admin' | undefined
    const login = hasValue(row.username) ? username(row.username) : username(existing?.username)
    if (!givenName || !familyName) {
      issue(issues, 'error', 'STAFF_NAME_REQUIRED', 'บุคลากร', 'รหัสใหม่ต้องมีชื่อและนามสกุล', row.__row)
      continue
    }
    if (!role || !['teacher', 'director', 'admin'].includes(role)) {
      issue(issues, 'error', 'INVALID_STAFF_ROLE', 'บุคลากร', 'ตำแหน่งต้องเป็น ครู ผู้อำนวยการ หรือผู้ดูแลระบบ', row.__row, 'ตำแหน่งและสิทธิ์')
      continue
    }
    if (hasValue(row.username) && !login) {
      issue(issues, 'error', 'INVALID_USERNAME', 'บุคลากร', 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z, 0-9, จุด ขีดกลาง และขีดล่าง', row.__row, 'ชื่อผู้ใช้')
      continue
    }
    if (login && usernames.has(login)) {
      issue(issues, 'error', 'DUPLICATE_USERNAME', 'บุคลากร', 'ชื่อผู้ใช้ซ้ำกับนักเรียนหรือบุคลากรคนอื่นในไฟล์', row.__row, 'ชื่อผู้ใช้')
      continue
    }
    const existingUsernameOwner = login ? existingUsernameOwners.get(login) : undefined
    if (existingUsernameOwner && existingUsernameOwner !== `staff:${codeKey}`) {
      issue(issues, 'error', 'USERNAME_IN_USE', 'บุคลากร', 'ชื่อผู้ใช้นี้ถูกใช้โดยนักเรียนหรือบุคลากรคนอื่นแล้ว', row.__row, 'ชื่อผู้ใช้')
      continue
    }
    if (login) usernames.add(login)
    const active = activeValue(row.isActive)
    if (hasValue(row.isActive) && active === undefined) {
      issue(issues, 'error', 'INVALID_STATUS', 'บุคลากร', 'สถานะต้องเป็น ใช้งาน หรือ ไม่ใช้งาน', row.__row, 'สถานะ')
      continue
    }
    if (!login) {
      issue(issues, 'warning', 'STAFF_ACCOUNT_DEFERRED', 'บุคลากร', 'ยังไม่มีชื่อผู้ใช้ จึงนำเข้ารายชื่อก่อนและออกบัญชีภายหลังได้', row.__row, 'ชื่อผู้ใช้')
    }
    staff.push({
      employeeCode: code,
      ...(login ? { username: login } : {}),
      title: text(row.title, 80) || existing?.title || null,
      givenName,
      familyName,
      role,
      ...(active === undefined ? {} : { isActive: active }),
    })
  }

  const combinedStudentCodes = new Set([...studentByCode.keys(), ...studentCodes])
  const combinedStaff = new Map(staffByCode)
  for (const item of staff) {
    combinedStaff.set(lowerKey(String(item.employeeCode)), {
      id: staffByCode.get(lowerKey(String(item.employeeCode)))?.id ?? '',
      employeeCode: String(item.employeeCode),
      username: String(item.username ?? ''),
      title: String(item.title ?? ''),
      givenName: String(item.givenName),
      familyName: String(item.familyName),
      status: item.isActive === false ? 'archived' : 'active',
      role: String(item.role),
      classroomIds: [],
    })
  }

  const assignments: JsonRecord[] = []
  const assignmentKeys = new Set<string>()
  const existingAssignments = new Map<string, boolean>()
  const staffIdByCode = new Map(context.snapshot.staff.map((item) => [lowerKey(item.employeeCode), Number(item.id)]))
  const classroomIdByKey = new Map(context.snapshot.classrooms.map((item) => [`${item.gradeLevel}|${lowerKey(item.roomNumber)}`, Number(item.id)]))
  for (const assignment of context.assignmentRows) {
    const staffEntry = context.snapshot.staff.find((item) => Number(item.id) === assignment.teacher_id)
    const classroomEntry = context.snapshot.classrooms.find((item) => Number(item.id) === assignment.classroom_id)
    if (!staffEntry || !classroomEntry) continue
    const subject = text(assignment.subject_name, 160) || 'ประจำชั้น'
    existingAssignments.set(`${lowerKey(staffEntry.employeeCode)}|${classroomEntry.gradeLevel}|${lowerKey(classroomEntry.roomNumber)}|${lowerKey(subject)}`, assignment.is_active)
  }
  for (const row of raw['ห้องที่ครูรับผิดชอบ']) {
    const code = text(row.employeeCode, 80)
    const codeKey = lowerKey(code)
    const person = combinedStaff.get(codeKey)
    const grade = gradeLevel(row.gradeLevel)
    const room = roomNumber(row.roomNumber)
    const subject = text(row.subjectName, 160) || 'ประจำชั้น'
    if (!code || !person) {
      issue(issues, 'error', 'UNKNOWN_STAFF', 'ห้องที่ครูรับผิดชอบ', 'ไม่พบรหัสบุคลากรนี้', row.__row, 'รหัสบุคลากร')
      continue
    }
    if (person.role !== 'teacher') {
      issue(issues, 'error', 'ASSIGNMENT_REQUIRES_TEACHER', 'ห้องที่ครูรับผิดชอบ', 'มอบหมายห้องได้เฉพาะบุคลากรตำแหน่งครู', row.__row, 'รหัสบุคลากร')
      continue
    }
    if (!grade) {
      issue(issues, 'error', 'INVALID_GRADE', 'ห้องที่ครูรับผิดชอบ', 'ระดับชั้นไม่ถูกต้อง', row.__row, 'ระดับชั้น')
      continue
    }
    const key = `${codeKey}|${grade}|${lowerKey(room)}|${lowerKey(subject)}`
    if (assignmentKeys.has(key)) {
      issue(issues, 'error', 'DUPLICATE_ASSIGNMENT', 'ห้องที่ครูรับผิดชอบ', 'ครู ห้อง และหน้าที่ซ้ำกันในไฟล์', row.__row)
      continue
    }
    assignmentKeys.add(key)
    let active = activeValue(row.isActive)
    if (hasValue(row.isActive) && active === undefined) {
      issue(issues, 'error', 'INVALID_STATUS', 'ห้องที่ครูรับผิดชอบ', 'สถานะต้องเป็น ใช้งาน หรือ ไม่ใช้งาน', row.__row, 'สถานะ')
      continue
    }
    if (active === undefined) active = existingAssignments.get(key)
    assignments.push({
      employeeCode: code,
      schoolYear: context.term.school_year,
      semester: context.term.semester,
      gradeLevel: grade,
      roomNumber: room,
      subjectName: subject,
      ...(active === undefined ? {} : { isActive: active }),
    })
    // Retain these lookups as an integrity assertion for existing records. New
    // teachers/classrooms are valid because the atomic RPC creates them first.
    void staffIdByCode.get(codeKey)
    void classroomIdByKey.get(`${grade}|${lowerKey(room)}`)
  }

  const guardians: JsonRecord[] = []
  const guardianKeys = new Set<string>()
  for (const row of raw.ผู้ปกครอง) {
    const code = text(row.studentCode, 80)
    const order = integerValue(row.contactOrder) ?? 1
    if (!code || !combinedStudentCodes.has(lowerKey(code))) {
      issue(issues, 'error', 'UNKNOWN_STUDENT', 'ผู้ปกครอง', 'ไม่พบรหัสนักเรียนนี้ในระบบหรือแผ่นงานนักเรียน', row.__row, 'รหัสนักเรียน')
      continue
    }
    if (order < 1 || order > 20) {
      issue(issues, 'error', 'INVALID_GUARDIAN_ORDER', 'ผู้ปกครอง', 'ลำดับผู้ปกครองต้องเป็น 1–20', row.__row, 'ลำดับผู้ปกครอง')
      continue
    }
    const key = `${lowerKey(code)}|${order}`
    if (guardianKeys.has(key)) {
      issue(issues, 'error', 'DUPLICATE_GUARDIAN', 'ผู้ปกครอง', 'รหัสนักเรียนและลำดับผู้ปกครองซ้ำกันในไฟล์', row.__row)
      continue
    }
    guardianKeys.add(key)
    const name = text(row.name, 300)
    const relationship = text(row.relationship, 100)
    const phone = text(row.phone, 50)
    if (!name && !relationship && !phone) {
      issue(issues, 'warning', 'EMPTY_GUARDIAN_SKIPPED', 'ผู้ปกครอง', 'แถวนี้ไม่มีข้อมูลติดต่อ จึงข้ามและไม่แก้ข้อมูลเดิม', row.__row)
      continue
    }
    const phoneDigits = phone.replace(/\D/g, '')
    if (phone && (phoneDigits.length < 6 || phoneDigits.length > 15)) {
      issue(issues, 'error', 'INVALID_PHONE', 'ผู้ปกครอง', 'เบอร์โทรควรมีตัวเลข 6–15 หลัก', row.__row, 'เบอร์โทร')
      continue
    }
    guardians.push({
      studentCode: code,
      contactOrder: order,
      ...(name ? { name } : {}),
      ...(relationship ? { relationship } : {}),
      ...(phone ? { phone } : {}),
    })
  }

  const plan = {
    schemaVersion: 'school-point-import/v1',
    term: {
      schoolYear: context.term.school_year,
      semester: context.term.semester,
      name: context.term.name,
      ...(context.term.starts_on && context.term.ends_on ? {
        startsOn: context.term.starts_on,
        endsOn: context.term.ends_on,
      } : {}),
    },
    classrooms,
    students,
    guardians,
    staff,
    assignments,
  }
  return {
    plan,
    counts: {
      classrooms: classrooms.length,
      students: students.length,
      staff: staff.length,
      assignments: assignments.length,
      guardians: guardians.length,
    },
    accounts: [
      ...students.map((item) => ({ username: String(item.studentCode), role: 'student' })),
      ...staff.flatMap((item) => item.username ? [{ username: String(item.username), role: String(item.role) }] : []),
    ],
  }
}

async function listAllUsers(client: ReturnType<typeof createClient>) {
  const users: Array<{ id: string; email?: string }> = []
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error('ตรวจสอบบัญชีผู้ใช้เดิมไม่สำเร็จ')
    users.push(...data.users)
    if (data.users.length < 1000) break
  }
  return users
}

async function listProfileIds(client: ReturnType<typeof createClient>) {
  const ids = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from('profiles').select('user_id').range(from, from + 999)
    if (error) throw new Error('ตรวจสอบบัญชีที่ผูกกับโรงเรียนไม่สำเร็จ')
    for (const row of data ?? []) ids.add(String(row.user_id))
    if ((data?.length ?? 0) < 1000) break
  }
  return ids
}

async function inspectAccounts(
  serviceClient: ReturnType<typeof createClient>,
  accounts: Array<{ username: string; role: string }>,
  issues: ImportIssue[],
) {
  const users = await listAllUsers(serviceClient)
  const profileIds = await listProfileIds(serviceClient)
  const byEmail = new Map(users.flatMap((user) => user.email ? [[user.email.toLowerCase(), user]] : []))
  let willCreate = 0
  let alreadyExists = 0
  for (const account of accounts) {
    const email = `${account.username.toLowerCase()}@${authDomain}`
    const existing = byEmail.get(email)
    if (!existing) willCreate += 1
    else if (profileIds.has(existing.id)) alreadyExists += 1
    else issue(issues, 'error', 'AUTH_ACCOUNT_COLLISION', 'บุคลากร', `ชื่อผู้ใช้ ${account.username} มีบัญชีที่ยังไม่ผูกกับโรงเรียน กรุณาตรวจสอบบัญชีก่อนนำเข้า`)
  }
  return { total: accounts.length, willCreate, alreadyExists, skipped: 0 }
}

async function assertPublicSignupDisabled(projectUrl: string, apiKey: string) {
  try {
    const url = new URL('/auth/v1/settings', projectUrl)
    const result = await fetch(url, { headers: { apikey: apiKey }, signal: AbortSignal.timeout(10_000) })
    const settings = await result.json()
    if (!result.ok || settings?.disable_signup !== true) throw new Error('signup enabled')
  } catch {
    throw new Error('ยังยืนยันไม่ได้ว่าปิดการสมัครบัญชีสาธารณะ จึงหยุดสร้างบัญชีใหม่เพื่อความปลอดภัย')
  }
}

async function provisionAccounts(
  serviceClient: ReturnType<typeof createClient>,
  accounts: Array<{ username: string; role: string }>,
) {
  const users = await listAllUsers(serviceClient)
  const profileIds = await listProfileIds(serviceClient)
  const byEmail = new Map(users.flatMap((user) => user.email ? [[user.email.toLowerCase(), user]] : []))
  const results = { total: accounts.length, created: 0, existing: 0, linked: 0, failed: 0 }
  const failures: Array<{ username: string; message: string }> = []

  let cursor = 0
  async function worker() {
    while (cursor < accounts.length) {
      const account = accounts[cursor++]
      const email = `${account.username.toLowerCase()}@${authDomain}`
      let user = byEmail.get(email)
      let created = false
      try {
        if (user && !profileIds.has(user.id)) throw new Error('มีบัญชีชื่อนี้อยู่แล้วแต่ยังไม่ผูกกับโรงเรียน')
        if (!user) {
          const { data, error } = await serviceClient.auth.admin.createUser({
            email,
            email_confirm: true,
            user_metadata: { username: account.username.toLowerCase(), must_change_password: true },
          })
          if (error || !data.user) throw new Error(error?.message ?? 'สร้าง Auth user ไม่สำเร็จ')
          user = data.user
          byEmail.set(email, user)
          created = true
          results.created += 1
        } else {
          results.existing += 1
        }
        const { data, error } = await serviceClient.rpc('admin_link_provisioned_account', {
          p_username: account.username,
          p_user_id: user.id,
        })
        if (error || data?.ok !== true) throw new Error(error?.message ?? 'ผูกบัญชีไม่สำเร็จ')
        results.linked += 1
        profileIds.add(user.id)
      } catch (error) {
        if (created && user) await serviceClient.auth.admin.deleteUser(user.id)
        results.failed += 1
        failures.push({ username: account.username, message: error instanceof Error ? error.message : 'สร้างบัญชีไม่สำเร็จ' })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, Math.max(accounts.length, 1)) }, () => worker()))
  return { ...results, failures }
}

async function loadContext(
  userClient: ReturnType<typeof createClient>,
  serviceClient: ReturnType<typeof createClient>,
): Promise<ImportContext> {
  const { data: snapshotData, error: snapshotError } = await userClient.rpc('school_directory_snapshot')
  if (snapshotError || !snapshotData) throw new Error('โหลดข้อมูลปัจจุบันสำหรับเปรียบเทียบไม่สำเร็จ')
  const snapshot = snapshotData as DirectorySnapshot
  if (!snapshot.termId) throw new Error('กรุณาสร้างหรือเลือกภาคเรียนปัจจุบันก่อนนำเข้า')
  const termId = Number(snapshot.termId)
  const [termResult, assignmentsResult] = await Promise.all([
    serviceClient.from('academic_terms').select('id,school_year,semester,name,starts_on,ends_on').eq('id', termId).single(),
    serviceClient.from('teacher_classroom_assignments').select('teacher_id,classroom_id,subject_name,is_active').eq('term_id', termId),
  ])
  if (termResult.error || !termResult.data) throw new Error('ไม่พบภาคเรียนปัจจุบัน')
  if (assignmentsResult.error) throw new Error('โหลดห้องที่ครูรับผิดชอบไม่สำเร็จ')
  return {
    snapshot,
    term: termResult.data,
    assignmentRows: assignmentsResult.data ?? [],
  }
}

async function parseAndValidate(
  file: File,
  context: ImportContext,
  serviceClient: ReturnType<typeof createClient>,
) {
  const issues: ImportIssue[] = []
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(new Uint8Array(await file.arrayBuffer()))
  } catch {
    throw new Error('เปิดไฟล์ Excel ไม่สำเร็จ กรุณาใช้แบบฟอร์ม .xlsx ที่ดาวน์โหลดจากระบบ')
  }
  const raw = Object.fromEntries(requiredSheets.map((sheet) => [sheet, readSheet(workbook, sheet, issues)])) as Record<(typeof requiredSheets)[number], ParsedRow[]>
  const totalRows = Object.values(raw).reduce((total, rows) => total + rows.length, 0)
  if (totalRows === 0) issue(issues, 'error', 'NO_DATA_ROWS', 'ไฟล์', 'ไม่พบข้อมูลสำหรับนำเข้า กรุณากรอกข้อมูลอย่างน้อย 1 แถวใต้หัวตาราง')
  if (totalRows > maxRows) issue(issues, 'error', 'TOO_MANY_ROWS', 'ไฟล์', `ไฟล์มีข้อมูลเกิน ${maxRows.toLocaleString('th-TH')} แถว กรุณาแบ่งไฟล์`)
  const normalized = normalizeWorkbook(raw, context, issues)

  let rpcResult: JsonRecord = { ok: false, errors: [] }
  if (!issues.some((item) => item.severity === 'error')) {
    const { data, error } = await serviceClient.rpc('admin_import_school_data', {
      p_payload: normalized.plan,
      p_dry_run: true,
    })
    if (error) throw new Error(`ตรวจข้อมูลกับฐานข้อมูลไม่สำเร็จ: ${error.message}`)
    rpcResult = data as JsonRecord
    if (rpcResult.ok !== true) {
      const errors = Array.isArray(rpcResult.errors) ? rpcResult.errors : []
      for (const entry of errors) {
        const error = entry as JsonRecord
        issue(issues, 'error', String(error.code ?? 'DATABASE_VALIDATION'), 'ฐานข้อมูล', 'ข้อมูลบางรายการไม่ผ่านกฎของระบบ กรุณาตรวจหัวตาราง รหัส และข้อมูลบังคับ')
      }
    }
  }
  const accountSummary = issues.some((item) => item.severity === 'error')
    ? { total: normalized.accounts.length, willCreate: 0, alreadyExists: 0, skipped: 0 }
    : await inspectAccounts(serviceClient, normalized.accounts, issues)
  return {
    ...normalized,
    issues,
    fingerprint: typeof rpcResult.serverFingerprint === 'string' ? rpcResult.serverFingerprint : '',
    accountSummary,
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return response(405, { ok: false, error: 'Method not allowed' })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const publishableKey = environmentKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
    const secretKey = environmentKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !publishableKey || !secretKey) throw new Error('บริการนำเข้ายังตั้งค่าไม่ครบ')

    const authorization = request.headers.get('Authorization') ?? ''
    const accessToken = authorization.replace(/^Bearer\s+/i, '').trim()
    if (!accessToken) return response(401, { ok: false, error: 'กรุณาเข้าสู่ระบบใหม่' })
    const userClient = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    })
    const serviceClient = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userError } = await userClient.auth.getUser(accessToken)
    if (userError || !userData.user) return response(401, { ok: false, error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' })
    const { data: profile, error: profileError } = await userClient
      .from('profiles')
      .select('role,is_active,activation_required')
      .eq('user_id', userData.user.id)
      .maybeSingle()
    if (profileError) return response(500, { ok: false, error: 'ตรวจสอบสิทธิ์ผู้ดูแลระบบไม่สำเร็จ' })
    if (!isActiveDirectoryAdmin(profile)) return response(403, { ok: false, error: 'เฉพาะผู้ดูแลระบบเท่านั้นที่นำเข้าข้อมูลได้' })

    const form = await request.formData()
    const mode = String(form.get('mode') ?? 'preview')
    const expectedFingerprint = String(form.get('fingerprint') ?? '').trim().toLowerCase()
    const file = form.get('file')
    if (!(file instanceof File)) throw new Error('กรุณาเลือกไฟล์ Excel')
    if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('รองรับเฉพาะไฟล์ .xlsx เท่านั้น')
    if (file.size <= 0 || file.size > maxFileBytes) throw new Error('ไฟล์ต้องมีขนาดไม่เกิน 10 MB')
    if (!['preview', 'apply'].includes(mode)) throw new Error('โหมดนำเข้าไม่ถูกต้อง')

    const context = await loadContext(userClient, serviceClient)
    const result = await parseAndValidate(file, context, serviceClient)
    const hasErrors = result.issues.some((item) => item.severity === 'error')
    if (mode === 'preview') {
      return response(200, {
        ok: true,
        data: {
          fileName: file.name,
          termLabel: context.snapshot.termLabel,
          fingerprint: result.fingerprint,
          canApply: !hasErrors && Boolean(result.fingerprint),
          counts: result.counts,
          accounts: result.accountSummary,
          issues: result.issues.slice(0, 200),
          issueCount: result.issues.length,
        },
      })
    }

    if (hasErrors || !result.fingerprint) throw new Error('ไฟล์ยังมีข้อผิดพลาด กรุณาตรวจสอบใหม่ก่อนนำเข้า')
    if (!/^[0-9a-f]{64}$/.test(expectedFingerprint) || expectedFingerprint !== result.fingerprint) {
      throw new Error('ข้อมูลหรือฐานข้อมูลเปลี่ยนหลังรอบตรวจสอบ กรุณากดตรวจสอบไฟล์อีกครั้ง')
    }
    await assertPublicSignupDisabled(supabaseUrl, secretKey)
    const { data: applyData, error: applyError } = await serviceClient.rpc('admin_import_school_data', {
      p_payload: result.plan,
      p_dry_run: false,
    })
    if (applyError || applyData?.ok !== true) throw new Error(applyError?.message ?? 'ฐานข้อมูลปฏิเสธการนำเข้า')
    if (applyData.serverFingerprint !== expectedFingerprint) throw new Error('ผลยืนยันจากฐานข้อมูลไม่ตรงกับไฟล์ที่ตรวจสอบ')
    const provisioning = await provisionAccounts(serviceClient, result.accounts)
    return response(200, {
      ok: true,
      data: {
        alreadyApplied: applyData.alreadyApplied === true,
        batchId: applyData.batchId ? String(applyData.batchId) : '',
        fingerprint: applyData.serverFingerprint,
        counts: result.counts,
        provisioning,
      },
    })
  } catch (error) {
    console.error('admin school import failed', error)
    return response(400, { ok: false, error: error instanceof Error ? error.message : 'นำเข้าข้อมูลไม่สำเร็จ' })
  }
})
