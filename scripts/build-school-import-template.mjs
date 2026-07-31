import fs from 'node:fs/promises'
import path from 'node:path'
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool'

const outputDir = path.resolve(process.argv[2] ?? 'outputs/school-import-template')
const outputPath = path.join(outputDir, 'แบบฟอร์มนำเข้าข้อมูลโรงเรียน.xlsx')

const colors = {
  navy: '#123A86',
  blue: '#175BC4',
  paleBlue: '#EAF2FF',
  ink: '#17233B',
  muted: '#5F6F89',
  line: '#D9E2F1',
  required: '#FFF3D6',
  optional: '#F5F7FB',
  white: '#FFFFFF',
}

const grades = ['ป.1', 'ป.2', 'ป.3', 'ป.4', 'ป.5', 'ป.6', 'ม.1', 'ม.2', 'ม.3']
const activeStatuses = ['ใช้งาน', 'ไม่ใช้งาน']
const staffRoles = ['ครู', 'ผู้อำนวยการ', 'ผู้ดูแลระบบ']

const definitions = [
  {
    name: 'ห้องเรียน',
    title: '1. ห้องเรียนในภาคเรียนปัจจุบัน',
    note: 'เพิ่มหรืออัปเดตชั้นและห้อง ห้อง 0 หมายถึงชั้นนั้นมีห้องเดียว ช่องว่างจะไม่ลบค่าเดิม',
    columns: [
      ['ระดับชั้น*', 'เช่น ป.1 หรือ ม.3', 20, true],
      ['ห้อง*', 'เช่น 0, 1 หรือ 2', 16, true],
      ['ชื่อที่แสดง', 'เว้นว่างเพื่อใช้ชื่อมาตรฐาน เช่น ม.1/2', 38, false],
    ],
    validations: [
      ['A5:A2004', grades],
    ],
    textColumns: ['B5:C2004'],
  },
  {
    name: 'นักเรียน',
    title: '2. รายชื่อนักเรียน',
    note: 'รหัสเดิมจะอัปเดต รหัสใหม่จะสร้างเพิ่ม ช่องว่างจะคงค่าเดิม และไม่ต้องใส่รหัสผ่านในไฟล์นี้',
    columns: [
      ['รหัสนักเรียน*', 'ใช้เป็นชื่อผู้ใช้ เช่น 2134', 20, true],
      ['คำนำหน้า', 'เช่น ด.ช. หรือ ด.ญ.', 16, false],
      ['ชื่อ*', 'จำเป็นเมื่อเป็นรหัสใหม่', 24, true],
      ['นามสกุล*', 'จำเป็นเมื่อเป็นรหัสใหม่', 26, true],
      ['เลขที่', 'ตัวเลข 1–9999', 14, false],
      ['ระดับชั้น*', 'เช่น ป.1 หรือ ม.3', 20, true],
      ['ห้อง', 'เว้นว่างได้สำหรับรหัสเดิม; รหัสใหม่ใช้ 0 หากไม่ระบุ', 20, false],
      ['วันเกิด', 'รูปแบบ YYYY-MM-DD หรือ DD/MM/YYYY', 24, false],
      ['สถานะ', 'ใช้งาน หรือ ไม่ใช้งาน; เว้นว่างเพื่อคงค่าเดิม', 22, false],
    ],
    validations: [
      ['F5:F2004', grades],
      ['I5:I2004', activeStatuses],
    ],
    textColumns: ['A5:D2004', 'G5:G2004'],
    dateColumns: ['H5:H2004'],
    wholeColumns: ['E5:E2004'],
  },
  {
    name: 'บุคลากร',
    title: '3. รายชื่อบุคลากรและสิทธิ์',
    note: 'รองรับครู ผู้อำนวยการ และผู้ดูแลระบบ ชื่อผู้ใช้เว้นว่างได้และออกบัญชีภายหลังได้',
    columns: [
      ['รหัสบุคลากร*', 'รหัสอ้างอิงที่ไม่ซ้ำ', 22, true],
      ['ชื่อผู้ใช้', 'a-z, 0-9, จุด ขีดกลาง หรือขีดล่าง', 24, false],
      ['คำนำหน้า', 'เช่น นาย นาง นางสาว', 18, false],
      ['ชื่อ*', 'จำเป็นเมื่อเป็นรหัสใหม่', 24, true],
      ['นามสกุล*', 'จำเป็นเมื่อเป็นรหัสใหม่', 26, true],
      ['ตำแหน่งและสิทธิ์*', 'ครู / ผู้อำนวยการ / ผู้ดูแลระบบ', 28, true],
      ['สถานะ', 'ใช้งาน หรือ ไม่ใช้งาน; เว้นว่างเพื่อคงค่าเดิม', 22, false],
    ],
    validations: [
      ['F5:F2004', staffRoles],
      ['G5:G2004', activeStatuses],
    ],
    textColumns: ['A5:E2004'],
  },
  {
    name: 'ห้องที่ครูรับผิดชอบ',
    title: '4. ห้องที่ครูรับผิดชอบ',
    note: 'หนึ่งแถวต่อครูหนึ่งห้อง การนำเข้าเป็นแบบเพิ่มหรืออัปเดต จะไม่ถอนห้องเดิมที่ไม่ได้อยู่ในไฟล์',
    columns: [
      ['รหัสบุคลากร*', 'ต้องเป็นบุคลากรตำแหน่งครู', 22, true],
      ['ระดับชั้น*', 'เช่น ป.1 หรือ ม.3', 20, true],
      ['ห้อง*', 'เช่น 0, 1 หรือ 2', 16, true],
      ['หน้าที่', 'เว้นว่างจะใช้ “ประจำชั้น”', 30, false],
      ['สถานะ', 'ใช้งาน หรือ ไม่ใช้งาน; เว้นว่างเพื่อคงค่าเดิม', 22, false],
    ],
    validations: [
      ['B5:B2004', grades],
      ['E5:E2004', activeStatuses],
    ],
    textColumns: ['A5:E2004'],
  },
  {
    name: 'ผู้ปกครอง',
    title: '5. ข้อมูลผู้ปกครอง',
    note: 'รองรับสูงสุด 20 คนต่อนักเรียน ลำดับ 1 คือผู้ติดต่อหลัก ข้อมูลนี้เป็นความลับและเห็นเฉพาะผู้มีสิทธิ์ในงานติดตาม',
    columns: [
      ['รหัสนักเรียน*', 'ต้องตรงกับรหัสนักเรียนในระบบหรือแผ่นงานนักเรียน', 22, true],
      ['ลำดับผู้ปกครอง*', '1–20; ลำดับ 1 เป็นผู้ติดต่อหลัก', 22, true],
      ['ชื่อผู้ปกครอง', 'ชื่อและนามสกุล', 32, false],
      ['ความสัมพันธ์', 'เช่น บิดา มารดา หรือผู้ปกครอง', 26, false],
      ['เบอร์โทร', 'เก็บเป็นข้อความเพื่อรักษาเลข 0 นำหน้า', 24, false],
    ],
    validations: [],
    textColumns: ['A5:A2004', 'C5:E2004'],
    wholeColumns: ['B5:B2004'],
  },
]

function columnName(index) {
  let number = index + 1
  let label = ''
  while (number > 0) {
    const remainder = (number - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    number = Math.floor((number - 1) / 26)
  }
  return label
}

function buildSheet(workbook, definition) {
  const sheet = workbook.worksheets.add(definition.name)
  const lastColumn = columnName(definition.columns.length - 1)
  sheet.showGridLines = false
  sheet.mergeCells(`A1:${lastColumn}1`)
  sheet.mergeCells(`A2:${lastColumn}2`)
  sheet.getRange('A1').values = [[definition.title]]
  sheet.getRange('A2').values = [[definition.note]]
  sheet.getRange(`A3:${lastColumn}4`).values = [
    definition.columns.map((column) => column[1]),
    definition.columns.map((column) => column[0]),
  ]

  sheet.getRange(`A1:${lastColumn}1`).format = {
    fill: colors.navy,
    font: { bold: true, color: colors.white, size: 16 },
    verticalAlignment: 'center',
  }
  sheet.getRange(`A2:${lastColumn}2`).format = {
    fill: colors.paleBlue,
    font: { color: colors.blue, size: 10 },
    wrapText: true,
    verticalAlignment: 'center',
  }
  sheet.getRange(`A3:${lastColumn}3`).format = {
    fill: colors.optional,
    font: { color: colors.muted, size: 9 },
    wrapText: true,
    verticalAlignment: 'center',
    borders: { bottom: { style: 'thin', color: colors.line } },
  }
  sheet.getRange(`A4:${lastColumn}4`).format = {
    fill: colors.blue,
    font: { bold: true, color: colors.white, size: 10 },
    wrapText: true,
    verticalAlignment: 'center',
    borders: { bottom: { style: 'medium', color: colors.navy } },
  }

  definition.columns.forEach((column, index) => {
    const letter = columnName(index)
    sheet.getRange(`${letter}4`).format.fill = column[3] ? colors.blue : '#426FAF'
    sheet.getRange(`${letter}:${letter}`).format.columnWidth = column[2]
  })

  sheet.getRange('1:1').format.rowHeight = 30
  sheet.getRange('2:2').format.rowHeight = 34
  sheet.getRange('3:3').format.rowHeight = 42
  sheet.getRange('4:4').format.rowHeight = 30
  sheet.freezePanes.freezeRows(4)

  for (const [range, values] of definition.validations) {
    sheet.dataValidations.add({ range, rule: { type: 'list', values } })
  }
  for (const range of definition.textColumns ?? []) sheet.getRange(range).format.numberFormat = '@'
  for (const range of definition.dateColumns ?? []) sheet.getRange(range).format.numberFormat = 'yyyy-mm-dd'
  for (const range of definition.wholeColumns ?? []) sheet.getRange(range).format.numberFormat = '0'
  return sheet
}

await fs.mkdir(outputDir, { recursive: true })
const workbook = Workbook.create()
for (const definition of definitions) buildSheet(workbook, definition)

const overview = await workbook.inspect({
  kind: 'sheet',
  include: 'id,name',
  maxChars: 3000,
})
console.log(overview.ndjson)

const formulaErrors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 50 },
  summary: 'final formula error scan',
})
console.log(formulaErrors.ndjson)

for (const definition of definitions) {
  const lastColumn = columnName(definition.columns.length - 1)
  const preview = await workbook.render({
    sheetName: definition.name,
    range: `A1:${lastColumn}8`,
    scale: 1.5,
    format: 'png',
  })
  await fs.writeFile(
    path.join(outputDir, `preview-${definition.name}.png`),
    new Uint8Array(await preview.arrayBuffer()),
  )
}

const xlsx = await SpreadsheetFile.exportXlsx(workbook)
await xlsx.save(outputPath)
console.log(outputPath)
