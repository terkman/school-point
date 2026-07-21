import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { tmpdir } from 'node:os'
import {
  buildImportPlan,
  normalizeGrade,
  parseDelimited,
} from './lib/school-data-import.mjs'
import { assertPrivateJsonPath, validatePlan } from './apply-supabase-import.mjs'
import {
  assertAccountRequiresActivation,
  loadArtifact,
  normalizeProjectUrl,
} from './issue-supabase-activation.mjs'

test('parses Google Sheets-style CSV including BOM, commas and newlines in quotes', () => {
  const rows = parseDelimited('\uFEFFรหัสนักเรียน,ชื่อ,นามสกุล,หมายเหตุ\r\n69001,"ใจดี,มาก",ทดสอบ,"บรรทัด 1\nบรรทัด 2"\r\n', { source: 'students.csv' })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].ชื่อ, 'ใจดี,มาก')
  assert.equal(rows[0].หมายเหตุ, 'บรรทัด 1\nบรรทัด 2')
})

test('normalizes Thai and canonical grade labels', () => {
  assert.equal(normalizeGrade('ป.1'), 'P1')
  assert.equal(normalizeGrade('ประถมศึกษาปีที่ 6'), 'P6')
  assert.equal(normalizeGrade('ม 2'), 'M2')
  assert.equal(normalizeGrade('M3'), 'M3')
  assert.equal(normalizeGrade('อนุบาล 3'), null)
})

function validInput() {
  return {
    term: { schoolYear: 2569, semester: 1 },
    students: [
      {
        รหัสนักเรียน: '69001',
        คำนำหน้า: 'เด็กชาย',
        ชื่อ: 'ทดสอบ',
        นามสกุล: 'ระบบ',
        วันเกิด: '01/05/2556',
        ระดับชั้น: 'ป.6',
        ห้อง: '',
        ชื่อผู้ปกครอง: 'ผู้ปกครองตัวอย่าง',
        ความสัมพันธ์: 'มารดา',
        เบอร์โทรผู้ปกครอง: '081-234-5678',
        สถานะ: 'ใช้งาน',
      },
    ],
    teachers: [
      {
        รหัสครู: 'T01',
        username: 'teacher.demo',
        บทบาท: 'ครู',
        คำนำหน้า: 'นางสาว',
        ชื่อ: 'ครู',
        นามสกุล: 'ตัวอย่าง',
        สถานะ: 'ใช้งาน',
      },
    ],
    assignments: [
      {
        รหัสครู: 'T01',
        ชั้น: 'ป.6',
        ห้อง: '',
        หน้าที่: 'ครูประจำชั้น',
        สถานะ: 'ใช้งาน',
      },
    ],
  }
}

test('defaults a blank room to 0 and creates an idempotent plan', () => {
  const first = buildImportPlan(validInput())
  const second = buildImportPlan(validInput())

  assert.equal(first.ok, true)
  assert.equal(first.plan.fingerprint, second.plan.fingerprint)
  assert.equal(first.plan.students[0].roomNumber, '0')
  assert.equal(first.plan.classrooms[0].displayName, 'ป.6')
  assert.equal(first.plan.students[0].birthDate, '2013-05-01')
  assert.equal(first.plan.guardians[0].phone, '0812345678')
  assert.equal(first.summary.warnings, 2)
})

test('reports duplicate keys and invalid references without leaking row values', () => {
  const raw = validInput()
  raw.students.push({ ...raw.students[0] })
  raw.assignments.push({
    รหัสครู: 'UNKNOWN',
    ชั้น: 'ม.1',
    ห้อง: '0',
    หน้าที่: 'ครูประจำชั้น',
  })

  const result = buildImportPlan(raw)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((item) => item.code === 'DUPLICATE_NATURAL_KEY' && item.entity === 'students'))
  assert.ok(result.issues.some((item) => item.code === 'UNKNOWN_TEACHER'))
  assert.equal(result.plan.students.length, 1)
  assert.equal(result.summary.rejected.students, 1)
})

test('allows missing optional guardian data but rejects malformed birth dates', () => {
  const missing = validInput()
  missing.students[0]['ชื่อผู้ปกครอง'] = '-'
  missing.students[0]['ความสัมพันธ์'] = ''
  missing.students[0]['เบอร์โทรผู้ปกครอง'] = 'ยังไม่มี'
  const missingResult = buildImportPlan(missing)
  assert.equal(missingResult.ok, true)
  assert.equal(missingResult.plan.guardians.length, 0)

  const invalid = validInput()
  invalid.students[0].วันเกิด = '31/02/2556'
  const invalidResult = buildImportPlan(invalid)
  assert.equal(invalidResult.ok, false)
  assert.ok(invalidResult.issues.some((item) => item.code === 'INVALID_BIRTH_DATE'))
})

test('accepts actual starred Sheet headers and active student status', () => {
  const result = buildImportPlan({
    term: { schoolYear: 2569, semester: 1 },
    students: [{
      'รหัสนักเรียน*': '69002',
      'ชื่อ*': 'นักเรียน',
      'นามสกุล*': 'ตัวอย่าง',
      'วันเกิด (ค.ศ.)*': '2014-06-20',
      'ชั้น*': 'ป.5',
      'ห้อง*': '0',
      'ชื่อ-นามสกุลผู้ปกครอง': 'ผู้ปกครอง ตัวอย่าง',
      โทรศัพท์: '0899999999',
      'สถานะ*': 'กำลังศึกษา',
    }],
    staff: [{
      'รหัสครู*': 'T02',
      'ชื่อ*': 'ครู',
      'นามสกุล*': 'ทดสอบ',
      'บทบาทหลัก*': 'ครู',
      'สถานะ*': 'ปฏิบัติงาน',
    }],
    assignments: [{
      'รหัสครู*': 'T02',
      'ปีการศึกษา*': '2569',
      'ภาคเรียน*': '1',
      'ชั้น*': 'ป.5',
      'ห้อง*': '0',
      'ประเภทความรับผิดชอบ*': 'ครูประจำชั้น',
      'สถานะ*': 'ใช้งาน',
    }],
  })

  assert.equal(result.ok, true)
  assert.equal(result.plan.students[0].birthDate, '2014-06-20')
  assert.equal(result.plan.guardians[0].name, 'ผู้ปกครอง ตัวอย่าง')
  assert.equal(result.plan.guardians[0].phone, '0899999999')
  assert.equal(result.plan.assignments.length, 1)
})

test('skips incomplete kindergarten and redundant admin assignments as warnings', () => {
  const raw = validInput()
  raw.teachers.push({
    รหัสครู: 'A01',
    บทบาท: 'แอดมิน',
    ชื่อ: 'ผู้ดูแล',
    นามสกุล: 'ระบบ',
  })
  raw.assignments.push({
    รหัสครู: 'K01',
    ปีการศึกษา: '2569',
    ภาคเรียน: '1',
    หมายเหตุ: 'ครูอนุบาล',
  })
  raw.assignments.push({
    รหัสครู: 'A01',
    ชั้น: 'ป.1',
    ห้อง: '0',
    หน้าที่: 'ฝ่ายปกครอง',
    สถานะ: 'ใช้งาน',
  })

  const result = buildImportPlan(raw)
  assert.equal(result.ok, true)
  assert.equal(result.plan.assignments.length, 1)
  assert.ok(result.issues.some((item) => item.code === 'EMPTY_ASSIGNMENT_SKIPPED'))
  assert.ok(result.issues.some((item) => item.code === 'ADMIN_ASSIGNMENT_IGNORED'))
})

test('rejects a staff username that collides with a student login code', () => {
  const raw = validInput()
  raw.teachers[0].username = '69001'
  const result = buildImportPlan(raw)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((item) => item.code === 'DUPLICATE_LOGIN_USERNAME'))
})

test('normalizes and validates usernames with the same login contract', () => {
  const normalized = validInput()
  normalized.teachers[0].username = 'Teacher.Demo'
  const normalizedResult = buildImportPlan(normalized)
  assert.equal(normalizedResult.ok, true)
  assert.equal(normalizedResult.plan.staff[0].username, 'teacher.demo')

  const invalidStaff = validInput()
  invalidStaff.teachers[0].username = '.teacher..demo.'
  const invalidStaffResult = buildImportPlan(invalidStaff)
  assert.equal(invalidStaffResult.ok, false)
  assert.ok(invalidStaffResult.issues.some((item) => item.code === 'INVALID_LOGIN_USERNAME' && item.entity === 'staff'))

  const invalidStudent = validInput()
  invalidStudent.students[0]['รหัสนักเรียน'] = 'นักเรียน01'
  const invalidStudentResult = buildImportPlan(invalidStudent)
  assert.equal(invalidStudentResult.ok, false)
  assert.ok(invalidStudentResult.issues.some((item) => item.code === 'INVALID_LOGIN_USERNAME' && item.entity === 'students'))

  const overlongStaff = validInput()
  overlongStaff.teachers[0].username = 'a'.repeat(65)
  const overlongStaffResult = buildImportPlan(overlongStaff)
  assert.equal(overlongStaffResult.ok, false)
  assert.ok(overlongStaffResult.issues.some((item) => item.code === 'INVALID_LOGIN_USERNAME' && item.entity === 'staff'))
})

test('skips an admin assignment before validating a missing grade', () => {
  const raw = validInput()
  raw.teachers.push({ รหัสครู: 'A02', บทบาท: 'แอดมิน', ชื่อ: 'ผู้ดูแล', นามสกุล: 'ส่วนกลาง' })
  raw.assignments.push({ รหัสครู: 'A02', หน้าที่: 'ฝ่ายปกครอง', สถานะ: 'ใช้งาน' })
  const result = buildImportPlan(raw)
  assert.equal(result.ok, true)
  assert.ok(result.issues.some((item) => item.code === 'ADMIN_ASSIGNMENT_IGNORED'))
  assert.ok(!result.issues.some((item) => item.code === 'INVALID_GRADE' && item.row === 3))
})

test('ignores a student number outside the database range', () => {
  const raw = validInput()
  raw.students[0].เลขที่ = '10000'
  const result = buildImportPlan(raw)
  assert.equal(result.ok, true)
  assert.equal(result.plan.students[0].studentNumber, null)
  assert.ok(result.issues.some((item) => item.code === 'INVALID_STUDENT_NUMBER_IGNORED'))
})

test('recomputes the import fingerprint before any remote write', () => {
  const result = buildImportPlan(validInput())
  assert.equal(validatePlan(result.plan), result.plan)
  const edited = structuredClone(result.plan)
  edited.students[0].givenName = 'ข้อมูลถูกแก้หลังตรวจ'
  assert.throws(() => validatePlan(edited), /fingerprint/)
})

test('refuses tracked credential and import paths inside the repository', () => {
  assert.throws(() => assertPrivateJsonPath('activation-codes.json', '--output'), /private-data/)
  assert.match(assertPrivateJsonPath('private-data/activation-codes.json', '--output'), /private-data[\\/]activation-codes\.json$/)
})

test('keeps activation artifacts scoped to one Supabase project', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'school-point-activation-'))
  const fixture = join(directory, 'activation-codes.json')
  try {
    await writeFile(fixture, JSON.stringify({
      schemaVersion: 'school-point-activation-codes/v1',
      projectUrl: 'https://first-project.supabase.co',
      accounts: [],
    }))
    await assert.rejects(
      loadArtifact(fixture, 'https://second-project.supabase.co'),
      /project อื่น/,
    )
    assert.equal(normalizeProjectUrl('https://first-project.supabase.co/'), 'https://first-project.supabase.co')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

function profileClient(result) {
  const calls = []
  const query = {
    select(columns) {
      calls.push(['select', columns])
      return this
    },
    eq(column, value) {
      calls.push(['eq', column, value])
      return this
    },
    async maybeSingle() {
      calls.push(['maybeSingle'])
      return result
    },
  }
  return {
    calls,
    client: {
      from(table) {
        calls.push(['from', table])
        return query
      },
    },
  }
}

test('issues activation only for a linked active profile that still requires activation', async () => {
  const allowed = profileClient({ data: { is_active: true, activation_required: true }, error: null })
  await assert.doesNotReject(assertAccountRequiresActivation(allowed.client, 'user-allowed'))
  assert.deepEqual(allowed.calls, [
    ['from', 'profiles'],
    ['select', 'is_active,activation_required'],
    ['eq', 'user_id', 'user-allowed'],
    ['maybeSingle'],
  ])

  const alreadyActivated = profileClient({ data: { is_active: true, activation_required: false }, error: null })
  await assert.rejects(
    assertAccountRequiresActivation(alreadyActivated.client, 'user-active'),
    /เปิดใช้งานแล้ว/,
  )

  const inactive = profileClient({ data: { is_active: false, activation_required: true }, error: null })
  await assert.rejects(
    assertAccountRequiresActivation(inactive.client, 'user-inactive'),
    /ระงับการใช้งาน/,
  )

  const missing = profileClient({ data: null, error: null })
  await assert.rejects(
    assertAccountRequiresActivation(missing.client, 'user-missing'),
    /ยังไม่ได้ผูก/,
  )
})
