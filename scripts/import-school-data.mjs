#!/usr/bin/env node

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import {
  attachJsonSource,
  buildImportPlan,
  formatValidationSummary,
  parseDelimited,
} from './lib/school-data-import.mjs'

const MAX_FILE_BYTES = 10 * 1024 * 1024

function usage() {
  return `ตรวจสอบและแปลงข้อมูลโรงเรียน (dry-run; ไม่เขียนฐานข้อมูล)

วิธีใช้:
  node scripts/import-school-data.mjs --input private-data/import.json
  node scripts/import-school-data.mjs --students private-data/students.csv --staff private-data/staff.csv --assignments private-data/assignments.csv --school-year 2569 --semester 1

ตัวเลือก:
  --input PATH         JSON object ที่มี students/guardians/staff/assignments
  --students PATH      CSV, TSV หรือ JSON array ของนักเรียน
  --guardians PATH     CSV, TSV หรือ JSON array ของผู้ปกครอง (ไม่บังคับ)
  --staff PATH         CSV, TSV หรือ JSON array ของครูและแอดมิน
  --teachers PATH      ชื่อแทนของ --staff
  --assignments PATH   CSV, TSV หรือ JSON array ของการมอบหมายห้อง
  --school-year YEAR   ปีการศึกษา พ.ศ. เช่น 2569
  --semester NUMBER    ภาคเรียน 1–3
  --output PATH        บันทึก import plan เมื่อ validation ผ่าน
  --summary-json       แสดง validation summary เป็น JSON
  --help               แสดงข้อความนี้

หาก --output อยู่ใน repository ต้องอยู่ใต้ private-data/ หรือ imports/ ซึ่งถูก gitignore`
}

function parseArgs(argv) {
  const options = Object.create(null)
  const booleanFlags = new Set(['help', 'summary-json'])
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) throw new Error(`ไม่รู้จัก argument: ${arg}`)
    const key = arg.slice(2)
    if (booleanFlags.has(key)) {
      options[key] = true
      continue
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`ต้องระบุค่าสำหรับ --${key}`)
    options[key] = value
    index += 1
  }
  return options
}

async function readSafe(path) {
  const absolute = resolve(path)
  const info = await stat(absolute)
  if (!info.isFile()) throw new Error(`${path}: ต้องเป็นไฟล์`)
  if (info.size > MAX_FILE_BYTES) throw new Error(`${path}: ไฟล์ใหญ่เกิน 10 MB`)
  return { absolute, text: await readFile(absolute, 'utf8') }
}

async function loadFile(path, entity) {
  const { absolute, text } = await readSafe(path)
  const extension = extname(absolute).toLocaleLowerCase('en-US')
  if (extension === '.json') {
    const parsed = attachJsonSource(JSON.parse(text), absolute)
    if (Array.isArray(parsed)) return parsed
    if (Array.isArray(parsed[entity])) return parsed[entity]
    if (entity === 'staff' && Array.isArray(parsed.teachers)) return parsed.teachers
    throw new Error(`${path}: ไม่พบ JSON array สำหรับ ${entity}`)
  }
  if (extension === '.csv' || extension === '.tsv' || extension === '.txt') {
    return parseDelimited(text, { source: absolute, delimiter: extension === '.tsv' ? '\t' : undefined })
  }
  throw new Error(`${path}: รองรับเฉพาะ .json, .csv, .tsv และ .txt`)
}

function assertOutputLocation(path) {
  const output = resolve(path)
  if (extname(output).toLocaleLowerCase('en-US') !== '.json') throw new Error('--output ต้องเป็นไฟล์ .json')
  const fromCwd = relative(process.cwd(), output)
  const isInsideCwd = fromCwd !== '..' && !fromCwd.startsWith(`..${sep}`) && !isAbsolute(fromCwd)
  if (!isInsideCwd) return output
  const topDirectory = fromCwd.split(/[\\/]/, 1)[0].toLocaleLowerCase('en-US')
  if (!['private-data', 'imports'].includes(topDirectory)) {
    throw new Error('--output ภายใน repository ต้องอยู่ใต้ private-data/ หรือ imports/ เพื่อป้องกันข้อมูลจริงถูก commit')
  }
  return output
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    console.error(usage())
    process.exitCode = 2
    return
  }

  if (options.help) {
    console.log(usage())
    return
  }

  try {
    let raw
    if (options.input) {
      if (options.students || options.guardians || options.staff || options.teachers || options.assignments) {
        throw new Error('ใช้ --input หรือไฟล์แยกรายประเภทอย่างใดอย่างหนึ่ง')
      }
      const { absolute, text } = await readSafe(options.input)
      if (extname(absolute).toLocaleLowerCase('en-US') !== '.json') throw new Error('--input รองรับ JSON เท่านั้น')
      raw = attachJsonSource(JSON.parse(text), absolute)
      if (Array.isArray(raw)) throw new Error('--input ต้องเป็น JSON object ที่มีรายการแต่ละประเภท')
    } else {
      raw = {
        students: options.students ? await loadFile(options.students, 'students') : [],
        guardians: options.guardians ? await loadFile(options.guardians, 'guardians') : [],
        staff: options.staff || options.teachers ? await loadFile(options.staff ?? options.teachers, 'staff') : [],
        assignments: options.assignments ? await loadFile(options.assignments, 'assignments') : [],
      }
    }

    const result = buildImportPlan(raw, {
      schoolYear: options['school-year'],
      semester: options.semester,
    })
    console.log(options['summary-json'] ? JSON.stringify({ summary: result.summary, issues: result.issues }, null, 2) : formatValidationSummary(result))

    if (!result.ok) {
      process.exitCode = 1
      return
    }
    if (options.output) {
      const output = assertOutputLocation(options.output)
      await mkdir(dirname(output), { recursive: true })
      await writeFile(output, `${JSON.stringify(result.plan, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
      console.log(`บันทึก import plan แล้ว: ${output}`)
    }
  } catch (error) {
    console.error(`นำเข้าข้อมูลไม่ได้: ${error.message}`)
    process.exitCode = 2
  }
}

await main()
