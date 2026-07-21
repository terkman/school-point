import { createHash } from 'node:crypto'

export const IMPORT_SCHEMA_VERSION = 'school-point-import/v1'

const GRADE_CODES = new Set(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'M1', 'M2', 'M3'])

const HEADER_ALIASES = {
  studentCode: ['studentcode', 'studentid', 'รหัสนักเรียน', 'รหัสประจำตัวนักเรียน'],
  employeeCode: ['employeecode', 'staffcode', 'teachercode', 'รหัสครู', 'รหัสบุคลากร', 'รหัสพนักงาน'],
  username: ['username', 'ชื่อผู้ใช้', 'ชื่อเข้าสู่ระบบ'],
  role: ['role', 'บทบาท', 'บทบาทหลัก', 'สิทธิ์', 'ประเภทผู้ใช้'],
  title: ['title', 'prefix', 'คำนำหน้า'],
  givenName: ['givenname', 'firstname', 'ชื่อ', 'ชื่อจริง'],
  familyName: ['familyname', 'lastname', 'surname', 'นามสกุล'],
  birthDate: ['birthdate', 'dateofbirth', 'dob', 'วันเกิด', 'วันเกิด (ค.ศ.)', 'วันเกิด (พ.ศ.)', 'วันเดือนปีเกิด'],
  studentNumber: ['studentnumber', 'classnumber', 'เลขที่', 'เลขที่ในห้อง'],
  gradeLevel: ['gradelevel', 'grade', 'classlevel', 'ชั้น', 'ระดับชั้น'],
  roomNumber: ['roomnumber', 'room', 'ห้อง', 'เลขห้อง'],
  guardianName: ['guardianname', 'parentname', 'ชื่อผู้ปกครอง', 'ชื่อ-นามสกุลผู้ปกครอง'],
  guardianRelationship: ['guardianrelationship', 'relationship', 'ความสัมพันธ์', 'ความสัมพันธ์ผู้ปกครอง'],
  guardianPhone: ['guardianphone', 'parentphone', 'phone', 'โทรศัพท์', 'เบอร์ผู้ปกครอง', 'เบอร์โทรผู้ปกครอง', 'เบอร์โทรศัพท์ผู้ปกครอง'],
  schoolYear: ['schoolyear', 'academicyear', 'ปีการศึกษา'],
  semester: ['semester', 'term', 'ภาคเรียน'],
  subjectName: ['subjectname', 'assignment', 'responsibility', 'วิชา', 'หน้าที่', 'บทบาทประจำห้อง', 'ประเภทการมอบหมาย', 'ประเภทความรับผิดชอบ', 'ประเภทครู', 'ตำแหน่ง'],
  isActive: ['isactive', 'active', 'status', 'สถานะ'],
}

const EMPTY_MARKERS = new Set(['', '-', '–', '—', 'n/a', 'na', 'null', 'ไม่มี', 'ไม่ระบุ', 'ยังไม่มี'])
const TRUE_MARKERS = new Set(['1', 'true', 'yes', 'y', 'active', 'ใช้งาน', 'เปิดใช้งาน', 'ทำงาน', 'กำลังศึกษา', 'ปฏิบัติงาน'])
const FALSE_MARKERS = new Set(['0', 'false', 'no', 'n', 'inactive', 'ไม่ใช้งาน', 'ปิดใช้งาน', 'ยกเลิก'])

function normalizeThaiDigits(value) {
  return String(value).replace(/[๐-๙]/g, (digit) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit)))
}

function cleanText(value) {
  if (value === null || value === undefined) return ''
  const text = normalizeThaiDigits(value).replace(/\u00a0/g, ' ').trim()
  return EMPTY_MARKERS.has(text.toLocaleLowerCase('en-US')) ? '' : text
}

function normalizeHeader(value) {
  return cleanText(value)
    .toLocaleLowerCase('en-US')
    .replace(/[\s_.\-/\\()[\]{}:*#]+/g, '')
}

function headerKeys(field) {
  return new Set([field, ...(HEADER_ALIASES[field] ?? [])].map(normalizeHeader))
}

const RESOLVED_ALIASES = Object.fromEntries(Object.keys(HEADER_ALIASES).map((field) => [field, headerKeys(field)]))

function fieldValue(record, field) {
  const accepted = RESOLVED_ALIASES[field] ?? headerKeys(field)
  for (const [key, value] of Object.entries(record)) {
    if (accepted.has(normalizeHeader(key))) return value
  }
  return undefined
}

function compareKey(left, right) {
  const a = String(left).toLocaleLowerCase('en-US')
  const b = String(right).toLocaleLowerCase('en-US')
  return a < b ? -1 : a > b ? 1 : 0
}

function issue(severity, code, entity, source, row, field, message) {
  return { severity, code, entity, source, row, field, message }
}

function rowContext(row, fallbackSource, fallbackRow) {
  const meta = row && typeof row === 'object' ? row.__importMeta : undefined
  return {
    source: meta?.source ?? fallbackSource,
    row: meta?.row ?? fallbackRow,
  }
}

function withMeta(record, source, row) {
  const value = Object.assign(Object.create(null), record)
  Object.defineProperty(value, '__importMeta', {
    value: { source, row },
    enumerable: false,
  })
  return value
}

export function parseDelimited(text, options = {}) {
  const source = options.source ?? 'input.csv'
  const normalized = String(text).replace(/^\uFEFF/, '')
  const delimiter = options.delimiter ?? detectDelimiter(normalized)
  const rows = []
  let cells = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    if (quoted) {
      if (char === '"' && normalized[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      cells.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && normalized[index + 1] === '\n') index += 1
      cells.push(cell)
      rows.push(cells)
      cells = []
      cell = ''
    } else {
      cell += char
    }
  }

  if (quoted) throw new Error(`${source}: พบเครื่องหมายคำพูดใน CSV ที่ปิดไม่ครบ`)
  if (cell.length > 0 || cells.length > 0) {
    cells.push(cell)
    rows.push(cells)
  }

  const nonEmptyRows = rows.filter((row) => row.some((value) => cleanText(value) !== ''))
  if (nonEmptyRows.length === 0) return []

  const headers = nonEmptyRows[0].map((header) => cleanText(header))
  const normalizedHeaders = headers.map(normalizeHeader)
  if (headers.some((header) => header === '')) throw new Error(`${source}: หัวตารางต้องไม่เว้นว่าง`)
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) throw new Error(`${source}: พบหัวตารางซ้ำ`)

  return nonEmptyRows.slice(1).map((values, index) => {
    const record = Object.create(null)
    headers.forEach((header, column) => {
      record[header] = values[column] ?? ''
    })
    return withMeta(record, source, index + 2)
  })
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const counts = [',', '\t', ';'].map((delimiter) => ({
    delimiter,
    count: firstLine.split(delimiter).length - 1,
  }))
  counts.sort((a, b) => b.count - a.count)
  return counts[0].count > 0 ? counts[0].delimiter : ','
}

export function normalizeGrade(value) {
  const raw = cleanText(value)
  if (!raw) return null
  const compact = raw.toLocaleUpperCase('en-US').replace(/[\s._\-/]/g, '')
  if (GRADE_CODES.has(compact)) return compact

  const thaiCompact = raw.replace(/[\s._\-/]/g, '')
  let match = thaiCompact.match(/^(?:ป|ประถม|ประถมศึกษา|ประถมศึกษาปีที่)([1-6])$/)
  if (match) return `P${match[1]}`
  match = thaiCompact.match(/^(?:ม|มัธยม|มัธยมศึกษา|มัธยมศึกษาปีที่)([1-3])$/)
  if (match) return `M${match[1]}`
  return null
}

function gradeDisplayName(gradeLevel) {
  return gradeLevel.startsWith('P') ? `ป.${gradeLevel.slice(1)}` : `ม.${gradeLevel.slice(1)}`
}

function normalizeRoom(value) {
  const raw = cleanText(value)
  if (!raw || ['ห้องเดียว', 'โรงเรียน', 'school'].includes(raw.toLocaleLowerCase('en-US'))) return '0'
  const withoutPrefix = raw.replace(/^ห้อง\s*/u, '').trim()
  if (/^\d+\.0+$/.test(withoutPrefix)) return String(Number.parseInt(withoutPrefix, 10))
  if (/^\d+$/.test(withoutPrefix)) return String(Number.parseInt(withoutPrefix, 10))
  return withoutPrefix
}

function parseBoolean(value) {
  const raw = cleanText(value).toLocaleLowerCase('en-US')
  if (!raw) return { value: true, recognized: true }
  if (TRUE_MARKERS.has(raw)) return { value: true, recognized: true }
  if (FALSE_MARKERS.has(raw)) return { value: false, recognized: true }
  return { value: true, recognized: false }
}

function parseRole(value) {
  const raw = cleanText(value).toLocaleLowerCase('en-US')
  if (['teacher', 'ครู', 'คุณครู', 'อาจารย์'].includes(raw)) return 'teacher'
  if (['admin', 'administrator', 'ผู้ดูแลระบบ', 'แอดมิน'].includes(raw)) return 'admin'
  return null
}

function normalizeLoginUsername(value) {
  return cleanText(value).toLocaleLowerCase('en-US')
}

function isValidLoginUsername(value) {
  return value.length <= 64
    && /^[a-z0-9._-]+$/.test(value)
    && !value.startsWith('.')
    && !value.endsWith('.')
    && !value.includes('..')
}

function parsePositiveInteger(value) {
  const raw = cleanText(value)
  if (!raw) return null
  if (!/^\d+$/.test(raw)) return null
  const number = Number(raw)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function parseSchoolYear(value) {
  const number = parsePositiveInteger(value)
  return number !== null && number >= 2500 && number <= 3000 ? number : null
}

function parseSemester(value) {
  const number = parsePositiveInteger(value)
  return number !== null && number >= 1 && number <= 3 ? number : null
}

function parseDate(value) {
  const raw = cleanText(value)
  if (!raw) return { value: null, valid: true }
  const match = raw.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/)
  if (!match) return { value: null, valid: false }

  let year
  let month
  let day
  if (match[1].length === 4) {
    year = Number(match[1])
    month = Number(match[2])
    day = Number(match[3])
  } else {
    day = Number(match[1])
    month = Number(match[2])
    year = Number(match[3])
  }
  if (year > 2400) year -= 543
  const date = new Date(Date.UTC(year, month - 1, day))
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  if (!valid || year < 1900 || year > new Date().getUTCFullYear()) return { value: null, valid: false }
  return {
    value: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    valid: true,
  }
}

function normalizePhone(value) {
  const raw = cleanText(value)
  if (!raw) return { value: null, valid: true }
  const hasPlus = raw.startsWith('+')
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 9 || digits.length > 15) return { value: null, valid: false }
  return { value: `${hasPlus ? '+' : ''}${digits}`, valid: true }
}

function requiredText(record, field, entity, context, issues, maxLength = 200) {
  const value = cleanText(fieldValue(record, field))
  if (!value) {
    issues.push(issue('error', 'REQUIRED_FIELD', entity, context.source, context.row, field, 'จำเป็นต้องระบุข้อมูลช่องนี้'))
    return null
  }
  if (value.length > maxLength) {
    issues.push(issue('error', 'VALUE_TOO_LONG', entity, context.source, context.row, field, `ข้อมูลยาวเกิน ${maxLength} ตัวอักษร`))
    return null
  }
  return value
}

function optionalText(record, field, maxLength = 200) {
  const value = cleanText(fieldValue(record, field))
  return value ? value.slice(0, maxLength) : null
}

function normalizeStudent(record, fallbackRow, issues) {
  const context = rowContext(record, 'students', fallbackRow)
  const before = issues.length
  const studentCode = requiredText(record, 'studentCode', 'students', context, issues, 50)
  if (studentCode && !isValidLoginUsername(normalizeLoginUsername(studentCode))) {
    issues.push(issue('error', 'INVALID_LOGIN_USERNAME', 'students', context.source, context.row, 'studentCode', 'รหัสนักเรียนใช้เข้าสู่ระบบได้เฉพาะ a-z, 0-9, จุด, ขีดกลาง และขีดล่าง โดยห้ามจุดนำหน้า ท้าย หรือซ้ำกัน'))
  }
  const givenName = requiredText(record, 'givenName', 'students', context, issues, 200)
  const familyName = requiredText(record, 'familyName', 'students', context, issues, 200)
  const rawGrade = fieldValue(record, 'gradeLevel')
  const gradeLevel = normalizeGrade(rawGrade)
  if (!gradeLevel) issues.push(issue('error', 'INVALID_GRADE', 'students', context.source, context.row, 'gradeLevel', 'ระดับชั้นต้องอยู่ระหว่าง ป.1–ป.6 หรือ ม.1–ม.3'))

  const roomWasBlank = cleanText(fieldValue(record, 'roomNumber')) === ''
  const roomNumber = normalizeRoom(fieldValue(record, 'roomNumber'))
  if (roomWasBlank) issues.push(issue('warning', 'ROOM_DEFAULTED_TO_ZERO', 'students', context.source, context.row, 'roomNumber', 'ไม่ได้ระบุห้อง จึงใช้ห้อง 0'))

  const birthDate = parseDate(fieldValue(record, 'birthDate'))
  if (!birthDate.valid) issues.push(issue('error', 'INVALID_BIRTH_DATE', 'students', context.source, context.row, 'birthDate', 'วันเกิดต้องเป็น YYYY-MM-DD หรือ DD/MM/YYYY และใช้ปี พ.ศ. หรือ ค.ศ. ได้'))

  const status = parseBoolean(fieldValue(record, 'isActive'))
  if (!status.recognized) issues.push(issue('error', 'INVALID_STATUS', 'students', context.source, context.row, 'isActive', 'สถานะต้องเป็น ใช้งาน หรือ ไม่ใช้งาน'))

  const studentNumberRaw = cleanText(fieldValue(record, 'studentNumber'))
  const parsedStudentNumber = parsePositiveInteger(studentNumberRaw)
  const studentNumber = parsedStudentNumber !== null && parsedStudentNumber <= 9999 ? parsedStudentNumber : null
  if (studentNumberRaw && studentNumber === null) issues.push(issue('warning', 'INVALID_STUDENT_NUMBER_IGNORED', 'students', context.source, context.row, 'studentNumber', 'เลขที่ต้องเป็นจำนวนเต็มระหว่าง 1–9999 จึงไม่นำเข้าค่านี้'))

  const guardianPhone = normalizePhone(fieldValue(record, 'guardianPhone'))
  if (!guardianPhone.valid) issues.push(issue('warning', 'INVALID_GUARDIAN_PHONE_IGNORED', 'students', context.source, context.row, 'guardianPhone', 'รูปแบบเบอร์ผู้ปกครองไม่ถูกต้อง จึงไม่นำเข้าค่านี้'))

  if (issues.slice(before).some((item) => item.severity === 'error')) return null
  return {
    student: {
      studentCode,
      title: optionalText(record, 'title', 50),
      givenName,
      familyName,
      birthDate: birthDate.value,
      studentNumber,
      gradeLevel,
      roomNumber,
      isActive: status.value,
    },
    guardian: {
      studentCode,
      name: optionalText(record, 'guardianName', 300),
      relationship: optionalText(record, 'guardianRelationship', 100),
      phone: guardianPhone.value,
    },
    context,
  }
}

function normalizeGuardian(record, fallbackRow, issues) {
  const context = rowContext(record, 'guardians', fallbackRow)
  const before = issues.length
  const studentCode = requiredText(record, 'studentCode', 'guardians', context, issues, 50)
  const phone = normalizePhone(fieldValue(record, 'guardianPhone'))
  if (!phone.valid) issues.push(issue('warning', 'INVALID_GUARDIAN_PHONE_IGNORED', 'guardians', context.source, context.row, 'guardianPhone', 'รูปแบบเบอร์ผู้ปกครองไม่ถูกต้อง จึงไม่นำเข้าค่านี้'))
  if (issues.slice(before).some((item) => item.severity === 'error')) return null
  return {
    value: {
      studentCode,
      name: optionalText(record, 'guardianName', 300),
      relationship: optionalText(record, 'guardianRelationship', 100),
      phone: phone.value,
    },
    context,
  }
}

function normalizeStaff(record, fallbackRow, issues) {
  const context = rowContext(record, 'staff', fallbackRow)
  const before = issues.length
  const employeeCode = requiredText(record, 'employeeCode', 'staff', context, issues, 50)
  const givenName = requiredText(record, 'givenName', 'staff', context, issues, 200)
  const familyName = requiredText(record, 'familyName', 'staff', context, issues, 200)
  const role = parseRole(fieldValue(record, 'role'))
  if (!role) issues.push(issue('error', 'INVALID_ROLE', 'staff', context.source, context.row, 'role', 'บทบาทต้องเป็น ครู หรือ แอดมิน'))
  const status = parseBoolean(fieldValue(record, 'isActive'))
  if (!status.recognized) issues.push(issue('error', 'INVALID_STATUS', 'staff', context.source, context.row, 'isActive', 'สถานะต้องเป็น ใช้งาน หรือ ไม่ใช้งาน'))
  const username = normalizeLoginUsername(fieldValue(record, 'username')) || null
  if (username && !isValidLoginUsername(username)) {
    issues.push(issue('error', 'INVALID_LOGIN_USERNAME', 'staff', context.source, context.row, 'username', 'username ใช้ได้เฉพาะ a-z, 0-9, จุด, ขีดกลาง และขีดล่าง โดยห้ามจุดนำหน้า ท้าย หรือซ้ำกัน'))
  }
  if (issues.slice(before).some((item) => item.severity === 'error')) return null
  return {
    value: {
      employeeCode,
      username,
      role,
      title: optionalText(record, 'title', 50),
      givenName,
      familyName,
      isActive: status.value,
    },
    context,
  }
}

function normalizeAssignment(record, fallbackRow, defaults, issues) {
  const context = rowContext(record, 'assignments', fallbackRow)
  const gradeRaw = cleanText(fieldValue(record, 'gradeLevel'))
  const roomRaw = cleanText(fieldValue(record, 'roomNumber'))
  const subjectRaw = cleanText(fieldValue(record, 'subjectName'))
  const statusRaw = cleanText(fieldValue(record, 'isActive'))
  if (!gradeRaw && !roomRaw && !subjectRaw && !statusRaw) {
    issues.push(issue('warning', 'EMPTY_ASSIGNMENT_SKIPPED', 'assignments', context.source, context.row, null, 'แถวนี้ยังไม่มีข้อมูลมอบหมายห้อง จึงข้ามและสามารถเติมภายหลังได้'))
    return null
  }
  const before = issues.length
  const employeeCode = requiredText(record, 'employeeCode', 'assignments', context, issues, 50)
  const gradeLevel = normalizeGrade(gradeRaw)
  if (!gradeLevel) issues.push(issue('error', 'INVALID_GRADE', 'assignments', context.source, context.row, 'gradeLevel', 'ระดับชั้นต้องอยู่ระหว่าง ป.1–ป.6 หรือ ม.1–ม.3'))
  const roomWasBlank = cleanText(fieldValue(record, 'roomNumber')) === ''
  const roomNumber = normalizeRoom(fieldValue(record, 'roomNumber'))
  if (roomWasBlank) issues.push(issue('warning', 'ROOM_DEFAULTED_TO_ZERO', 'assignments', context.source, context.row, 'roomNumber', 'ไม่ได้ระบุห้อง จึงใช้ห้อง 0'))
  const schoolYearRaw = cleanText(fieldValue(record, 'schoolYear'))
  const semesterRaw = cleanText(fieldValue(record, 'semester'))
  const schoolYear = schoolYearRaw ? parseSchoolYear(schoolYearRaw) : defaults.schoolYear
  const semester = semesterRaw ? parseSemester(semesterRaw) : defaults.semester
  if (!schoolYear) issues.push(issue('error', 'INVALID_SCHOOL_YEAR', 'assignments', context.source, context.row, 'schoolYear', 'ปีการศึกษาต้องเป็น พ.ศ. 4 หลัก ระหว่าง 2500–3000'))
  if (!semester) issues.push(issue('error', 'INVALID_SEMESTER', 'assignments', context.source, context.row, 'semester', 'ภาคเรียนต้องเป็น 1–3'))
  const status = parseBoolean(fieldValue(record, 'isActive'))
  if (!status.recognized) issues.push(issue('error', 'INVALID_STATUS', 'assignments', context.source, context.row, 'isActive', 'สถานะต้องเป็น ใช้งาน หรือ ไม่ใช้งาน'))
  if (issues.slice(before).some((item) => item.severity === 'error')) return null
  return {
    value: {
      employeeCode,
      schoolYear,
      semester,
      gradeLevel,
      roomNumber,
      subjectName: optionalText(record, 'subjectName', 200) ?? 'ประจำชั้น',
      isActive: status.value,
    },
    context,
  }
}

function rowsOf(raw, keys) {
  for (const key of keys) {
    if (Array.isArray(raw?.[key])) return raw[key]
  }
  return []
}

function addDuplicateIssues(items, keyOf, entity, issues) {
  const seen = new Map()
  const accepted = []
  for (const item of items) {
    const key = keyOf(item.value).toLocaleLowerCase('en-US')
    if (!seen.has(key)) {
      seen.set(key, item)
      accepted.push(item)
      continue
    }
    issues.push(issue('error', 'DUPLICATE_NATURAL_KEY', entity, item.context.source, item.context.row, null, 'พบข้อมูลซ้ำด้วยรหัสอ้างอิงเดียวกัน'))
  }
  return accepted
}

function compactGuardian(guardian) {
  return guardian && (guardian.name || guardian.relationship || guardian.phone) ? guardian : null
}

function mergeGuardians(inlineGuardians, explicitGuardians, validStudentCodes, issues) {
  const guardians = new Map()
  for (const item of [...inlineGuardians, ...explicitGuardians]) {
    const value = compactGuardian(item.value)
    if (!value) continue
    const key = value.studentCode.toLocaleLowerCase('en-US')
    if (!validStudentCodes.has(key)) {
      issues.push(issue('error', 'UNKNOWN_STUDENT', 'guardians', item.context.source, item.context.row, 'studentCode', 'ไม่พบรหัสนักเรียนนี้ในชุดข้อมูลนักเรียน'))
      continue
    }
    const existing = guardians.get(key)
    if (!existing) {
      guardians.set(key, item)
      continue
    }
    if (JSON.stringify(existing.value) === JSON.stringify(value)) {
      issues.push(issue('warning', 'DUPLICATE_GUARDIAN_IGNORED', 'guardians', item.context.source, item.context.row, null, 'ข้อมูลผู้ปกครองซ้ำกัน จึงใช้รายการแรก'))
    } else {
      issues.push(issue('error', 'CONFLICTING_GUARDIAN', 'guardians', item.context.source, item.context.row, null, 'นักเรียนหนึ่งคนมีข้อมูลผู้ปกครองหลักขัดแย้งกัน'))
    }
  }
  return [...guardians.values()].map((item) => item.value)
}

function stableFingerprint(plan) {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex')
}

export function buildImportPlan(raw = {}, options = {}) {
  const issues = []
  const rawTerm = raw.term && typeof raw.term === 'object' ? raw.term : {}
  const schoolYear = parseSchoolYear(options.schoolYear ?? rawTerm.schoolYear ?? rawTerm.school_year)
  const semester = parseSemester(options.semester ?? rawTerm.semester)
  if (!schoolYear) issues.push(issue('error', 'INVALID_SCHOOL_YEAR', 'term', 'options', null, 'schoolYear', 'ต้องระบุปีการศึกษา พ.ศ. ระหว่าง 2500–3000'))
  if (!semester) issues.push(issue('error', 'INVALID_SEMESTER', 'term', 'options', null, 'semester', 'ต้องระบุภาคเรียน 1–3'))

  const studentRows = rowsOf(raw, ['students'])
  const guardianRows = rowsOf(raw, ['guardians', 'parents'])
  const staffRows = rowsOf(raw, ['staff', 'teachers'])
  const assignmentRows = rowsOf(raw, ['assignments', 'teacherAssignments', 'teacher_assignments'])

  const normalizedStudents = studentRows
    .map((row, index) => normalizeStudent(row, index + 2, issues))
    .filter(Boolean)
    .map((item) => ({ value: item.student, guardian: item.guardian, context: item.context }))
  const uniqueStudents = addDuplicateIssues(normalizedStudents, (value) => value.studentCode, 'students', issues)

  const normalizedStaff = staffRows
    .map((row, index) => normalizeStaff(row, index + 2, issues))
    .filter(Boolean)
  const uniqueStaff = addDuplicateIssues(normalizedStaff, (value) => value.employeeCode, 'staff', issues)
  const usernameItems = uniqueStaff.filter((item) => item.value.username)
  addDuplicateIssues(usernameItems, (value) => value.username, 'staff', issues)

  const loginNames = new Map()
  for (const item of uniqueStudents) {
    loginNames.set(item.value.studentCode.toLocaleLowerCase('en-US'), { entity: 'students', context: item.context, field: 'studentCode' })
  }
  for (const item of usernameItems) {
    const key = item.value.username.toLocaleLowerCase('en-US')
    if (loginNames.has(key)) {
      issues.push(issue('error', 'DUPLICATE_LOGIN_USERNAME', 'staff', item.context.source, item.context.row, 'username', 'username บุคลากรซ้ำกับรหัสนักเรียนหรือ username อื่นในชุดนำเข้า'))
    } else {
      loginNames.set(key, { entity: 'staff', context: item.context, field: 'username' })
    }
  }

  const staffByCode = new Map(uniqueStaff.map((item) => [item.value.employeeCode.toLocaleLowerCase('en-US'), item.value]))

  const normalizedAssignments = assignmentRows
    .map((row, index) => {
      const context = rowContext(row, 'assignments', index + 2)
      const employeeCode = cleanText(fieldValue(row, 'employeeCode')).toLocaleLowerCase('en-US')
      if (staffByCode.get(employeeCode)?.role === 'admin') {
        issues.push(issue('warning', 'ADMIN_ASSIGNMENT_IGNORED', 'assignments', context.source, context.row, 'employeeCode', 'แอดมินเห็นทุกห้องอยู่แล้ว จึงข้ามรายการมอบหมายห้องนี้'))
        return null
      }
      return normalizeAssignment(row, index + 2, { schoolYear, semester }, issues)
    })
    .filter(Boolean)
  const uniqueAssignments = addDuplicateIssues(
    normalizedAssignments,
    (value) => `${value.schoolYear}|${value.semester}|${value.gradeLevel}|${value.roomNumber}|${value.employeeCode}|${value.subjectName}`,
    'assignments',
    issues,
  )

  const studentCodes = new Set(uniqueStudents.map((item) => item.value.studentCode.toLocaleLowerCase('en-US')))
  const explicitGuardians = guardianRows
    .map((row, index) => normalizeGuardian(row, index + 2, issues))
    .filter(Boolean)
  const inlineGuardians = uniqueStudents.map((item) => ({ value: item.guardian, context: item.context }))
  const guardians = mergeGuardians(inlineGuardians, explicitGuardians, studentCodes, issues)

  const validAssignments = []
  for (const item of uniqueAssignments) {
    let isValid = true
    const staff = staffByCode.get(item.value.employeeCode.toLocaleLowerCase('en-US'))
    if (!staff) {
      issues.push(issue('error', 'UNKNOWN_TEACHER', 'assignments', item.context.source, item.context.row, 'employeeCode', 'ไม่พบรหัสครูนี้ในชุดข้อมูลครู'))
      isValid = false
    } else if (staff.role !== 'teacher') {
      issues.push(issue('error', 'ASSIGNMENT_REQUIRES_TEACHER', 'assignments', item.context.source, item.context.row, 'employeeCode', 'มอบหมายห้องได้เฉพาะบัญชีบทบาทครู'))
      isValid = false
    }
    if (schoolYear && item.value.schoolYear !== schoolYear) {
      issues.push(issue('error', 'TERM_MISMATCH', 'assignments', item.context.source, item.context.row, 'schoolYear', 'ปีการศึกษาของรายการไม่ตรงกับชุดนำเข้า'))
      isValid = false
    }
    if (semester && item.value.semester !== semester) {
      issues.push(issue('error', 'TERM_MISMATCH', 'assignments', item.context.source, item.context.row, 'semester', 'ภาคเรียนของรายการไม่ตรงกับชุดนำเข้า'))
      isValid = false
    }
    if (isValid) validAssignments.push(item)
  }

  const students = uniqueStudents.map((item) => item.value).sort((a, b) => compareKey(a.studentCode, b.studentCode))
  const staff = uniqueStaff.map((item) => item.value).sort((a, b) => compareKey(a.employeeCode, b.employeeCode))
  guardians.sort((a, b) => compareKey(a.studentCode, b.studentCode))
  const assignments = validAssignments.map((item) => item.value).sort((a, b) => compareKey(
    `${a.gradeLevel}|${a.roomNumber}|${a.employeeCode}|${a.subjectName}`,
    `${b.gradeLevel}|${b.roomNumber}|${b.employeeCode}|${b.subjectName}`,
  ))

  const classroomMap = new Map()
  for (const row of [...students, ...assignments]) {
    if (!row.gradeLevel || !row.roomNumber) continue
    const key = `${row.gradeLevel}|${row.roomNumber}`
    classroomMap.set(key, {
      gradeLevel: row.gradeLevel,
      roomNumber: row.roomNumber,
      displayName: row.roomNumber === '0' ? gradeDisplayName(row.gradeLevel) : `${gradeDisplayName(row.gradeLevel)}/${row.roomNumber}`,
    })
  }
  const classrooms = [...classroomMap.values()].sort((a, b) => compareKey(`${a.gradeLevel}|${a.roomNumber}`, `${b.gradeLevel}|${b.roomNumber}`))

  const planCore = {
    schemaVersion: IMPORT_SCHEMA_VERSION,
    term: { schoolYear, semester },
    classrooms,
    students,
    guardians,
    staff,
    assignments,
  }
  const fingerprint = stableFingerprint(planCore)
  const plan = { ...planCore, fingerprint }
  const errors = issues.filter((item) => item.severity === 'error')
  const warnings = issues.filter((item) => item.severity === 'warning')
  const rejected = {
    students: studentRows.length - normalizedStudents.length + (normalizedStudents.length - uniqueStudents.length),
    guardians: Math.max(0, guardianRows.length - explicitGuardians.length),
    staff: staffRows.length - normalizedStaff.length + (normalizedStaff.length - uniqueStaff.length),
    assignments: assignmentRows.length - assignments.length,
  }
  const guardiansByStudent = new Map(guardians.map((guardian) => [guardian.studentCode.toLocaleLowerCase('en-US'), guardian]))
  const issueCounts = Object.fromEntries(
    [...new Set(issues.map((item) => item.code))]
      .sort(compareKey)
      .map((code) => [code, issues.filter((item) => item.code === code).length]),
  )

  return {
    ok: errors.length === 0,
    plan,
    issues,
    summary: {
      ok: errors.length === 0,
      fingerprint,
      input: {
        students: studentRows.length,
        guardians: guardianRows.length,
        staff: staffRows.length,
        assignments: assignmentRows.length,
      },
      normalized: {
        classrooms: classrooms.length,
        students: students.length,
        guardians: guardians.length,
        staff: staff.length,
        assignments: assignments.length,
      },
      rejected,
      completeness: {
        studentsWithoutBirthDate: students.filter((student) => !student.birthDate).length,
        studentsWithoutStudentNumber: students.filter((student) => !student.studentNumber).length,
        studentsWithoutGuardian: students.filter((student) => !guardiansByStudent.has(student.studentCode.toLocaleLowerCase('en-US'))).length,
        studentsWithoutGuardianPhone: students.filter((student) => !guardiansByStudent.get(student.studentCode.toLocaleLowerCase('en-US'))?.phone).length,
        staffWithoutUsername: staff.filter((member) => !member.username).length,
      },
      issueCounts,
      errors: errors.length,
      warnings: warnings.length,
    },
  }
}

export function attachJsonSource(value, source = 'input.json') {
  if (Array.isArray(value)) return value.map((record, index) => withMeta(record, source, index + 1))
  if (!value || typeof value !== 'object') throw new Error(`${source}: JSON ต้องเป็น object หรือ array`)
  const result = { ...value }
  for (const key of ['students', 'guardians', 'parents', 'staff', 'teachers', 'assignments', 'teacherAssignments', 'teacher_assignments']) {
    if (Array.isArray(result[key])) result[key] = result[key].map((record, index) => withMeta(record, `${source}#${key}`, index + 1))
  }
  return result
}

export function formatValidationSummary(result) {
  const { summary } = result
  const lines = [
    `ผลตรวจสอบ: ${summary.ok ? 'ผ่าน' : 'ไม่ผ่าน'}`,
    `Fingerprint: ${summary.fingerprint}`,
    `รับเข้า: นักเรียน ${summary.normalized.students}, ผู้ปกครอง ${summary.normalized.guardians}, บุคลากร ${summary.normalized.staff}, มอบหมายห้อง ${summary.normalized.assignments}, ห้องเรียน ${summary.normalized.classrooms}`,
    `ข้อมูลเติมภายหลังได้: วันเกิด ${summary.completeness.studentsWithoutBirthDate}, เลขที่ ${summary.completeness.studentsWithoutStudentNumber}, ผู้ปกครอง ${summary.completeness.studentsWithoutGuardian}, เบอร์ผู้ปกครอง ${summary.completeness.studentsWithoutGuardianPhone}, username บุคลากร ${summary.completeness.staffWithoutUsername}`,
    `ปัญหา: error ${summary.errors}, warning ${summary.warnings}`,
  ]
  const issueCountText = Object.entries(summary.issueCounts).map(([code, count]) => `${code}=${count}`).join(', ')
  if (issueCountText) lines.push(`สรุปประเภทปัญหา: ${issueCountText}`)
  const displayedIssues = result.issues.slice(0, 30)
  for (const item of displayedIssues) {
    const location = [item.source, item.row ? `แถว ${item.row}` : null, item.field].filter(Boolean).join(' · ')
    lines.push(`[${item.severity.toUpperCase()}] ${item.code} (${location}): ${item.message}`)
  }
  if (result.issues.length > displayedIssues.length) lines.push(`...มีอีก ${result.issues.length - displayedIssues.length} รายการ ใช้ --summary-json เพื่อดูทั้งหมด`)
  return lines.join('\n')
}
