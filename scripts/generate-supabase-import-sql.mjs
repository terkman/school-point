#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertPrivateJsonPath, validatePlan } from './apply-supabase-import.mjs'

const PRIVATE_ROOTS = new Set(['private-data', 'imports'])
const COUNT_KEYS = ['classrooms', 'students', 'guardians', 'staff', 'assignments']

function usage() {
  return `สร้าง SQL artifact ส่วนตัวสำหรับ Supabase CLI โดยไม่ต้องใช้ service-role key

สร้างไฟล์ dry-run (ค่าเริ่มต้น):
  node scripts/generate-supabase-import-sql.mjs --input private-data/import-plan.json --output private-data/import-dry-run.sql

สร้างไฟล์เขียนจริง (ต้องยืนยัน fingerprint):
  node scripts/generate-supabase-import-sql.mjs --input private-data/import-plan.json --output private-data/import-apply.sql --apply --confirm-fingerprint SHA256

จากนั้นเรียกไฟล์กับ project ที่ link แล้ว:
  npx supabase db query --linked --file private-data/import-dry-run.sql

ข้อควรระวัง:
  ไฟล์ SQL มีข้อมูลส่วนบุคคลจริงและต้องอยู่ใต้ private-data/ หรือ imports/ เท่านั้น
  โปรแกรมจะไม่เขียนทับไฟล์เดิม และจะไม่แสดง payload บน console`
}

export function parseArgs(argv) {
  const options = { apply: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--apply') {
      options.apply = true
    } else if (value === '--help' || value === '-h') {
      options.help = true
    } else if (value === '--input' || value === '--output' || value === '--confirm-fingerprint') {
      const next = argv[index + 1]
      if (!next || next.startsWith('--')) throw new Error(`${value} ต้องมีค่า`)
      if (value === '--input') options.input = next
      else if (value === '--output') options.output = next
      else options.confirmFingerprint = next
      index += 1
    } else {
      throw new Error(`ไม่รู้จักตัวเลือกลำดับที่ ${index + 1}`)
    }
  }
  return options
}

export function assertPrivateSqlPath(pathValue, label = '--output', cwd = process.cwd()) {
  if (!pathValue) throw new Error(`ต้องระบุ ${label}`)
  const absolute = resolve(cwd, pathValue)
  if (extname(absolute).toLowerCase() !== '.sql') throw new Error(`${label} ต้องเป็นไฟล์ .sql`)

  const fromCwd = relative(cwd, absolute)
  const isInside = fromCwd !== ''
    && !fromCwd.startsWith(`..${sep}`)
    && fromCwd !== '..'
    && !isAbsolute(fromCwd)
  const firstPart = isInside ? fromCwd.split(/[\\/]/)[0].toLowerCase() : ''
  if (!isInside || !PRIVATE_ROOTS.has(firstPart)) {
    throw new Error(`${label} ต้องอยู่ใต้ private-data/ หรือ imports/ ภายใน repository`)
  }
  return absolute
}

export function assertApplyConfirmation(apply, confirmFingerprint, fingerprint) {
  if (!apply) return
  if (!confirmFingerprint) throw new Error('การสร้างไฟล์เขียนจริงต้องระบุ --confirm-fingerprint')
  if (confirmFingerprint !== fingerprint) throw new Error('--confirm-fingerprint ไม่ตรงกับ import plan')
}

export function chooseDollarQuoteDelimiter(payload) {
  for (let counter = 0; counter <= 100_000; counter += 1) {
    const suffix = counter === 0 ? '' : `_${counter}`
    const delimiter = `$school_point_import${suffix}$`
    if (!payload.includes(delimiter)) return delimiter
  }
  throw new Error('ไม่สามารถสร้างขอบเขต SQL ที่ปลอดภัยสำหรับ payload นี้')
}

export function planCounts(plan) {
  return Object.fromEntries(COUNT_KEYS.map((key) => [key, plan[key].length]))
}

export function buildImportSql(plan, apply = false) {
  validatePlan(plan)
  const payload = JSON.stringify(plan)
  const delimiter = chooseDollarQuoteDelimiter(payload)
  const dryRun = apply ? 'false' : 'true'
  const transactionEnd = apply ? 'commit;' : 'rollback;'

  return [
    '-- PRIVATE GENERATED ARTIFACT: contains student, guardian, and staff data.',
    '-- Keep this file under private-data/ or imports/ and never commit or share it.',
    `-- Mode: ${apply ? 'apply' : 'dry-run'}; client fingerprint: ${plan.fingerprint}`,
    'begin;',
    'with import_call as (',
    '  select public.admin_import_school_data(',
    `    p_payload => ${delimiter}${payload}${delimiter}::jsonb,`,
    `    p_dry_run => ${dryRun}`,
    '  ) as result',
    ')',
    'select jsonb_build_object(',
    "  'ok', coalesce(import_call.result -> 'ok', 'false'::jsonb),",
    "  'dryRun', coalesce(import_call.result -> 'dryRun', 'false'::jsonb),",
    "  'alreadyApplied', coalesce(import_call.result -> 'alreadyApplied', 'false'::jsonb),",
    "  'counts', case when jsonb_typeof(import_call.result -> 'counts') = 'object' then import_call.result -> 'counts' else '{}'::jsonb end,",
    "  'errorCount', case when jsonb_typeof(import_call.result -> 'errors') = 'array' then jsonb_array_length(import_call.result -> 'errors') else 0 end,",
    "  'clientFingerprint', import_call.result -> 'clientFingerprint',",
    "  'serverFingerprint', import_call.result -> 'serverFingerprint'",
    ') as import_summary',
    'from import_call;',
    transactionEnd,
    '',
  ].join('\n')
}

function gitCheckIgnored(relativePath, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('git', ['check-ignore', '--quiet', '--', relativePath], {
      cwd,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', () => rejectPromise(new Error('ตรวจ .gitignore ไม่สำเร็จ จึงยังไม่สร้าง SQL artifact')))
    child.once('close', (code) => {
      if (code === 0) resolvePromise()
      else rejectPromise(new Error('ไฟล์ SQL ปลายทางไม่ได้ถูก .gitignore จึงปฏิเสธการเขียน'))
    })
  })
}

export async function generateSqlArtifact(options, cwd = process.cwd()) {
  if (!options.input) throw new Error('ต้องระบุ --input')
  if (!options.output) throw new Error('ต้องระบุ --output')

  const inputPath = assertPrivateJsonPath(options.input, '--input')
  const outputPath = assertPrivateSqlPath(options.output, '--output', cwd)
  const relativeOutput = relative(cwd, outputPath).split(sep).join('/')
  await gitCheckIgnored(relativeOutput, cwd)

  let plan
  try {
    plan = validatePlan(JSON.parse(await readFile(inputPath, 'utf8')))
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('อ่าน import plan JSON ไม่สำเร็จ')
    throw error
  }
  assertApplyConfirmation(options.apply, options.confirmFingerprint, plan.fingerprint)

  const sql = buildImportSql(plan, options.apply)
  await mkdir(dirname(outputPath), { recursive: true })
  try {
    await writeFile(outputPath, sql, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      throw new Error('ไฟล์ SQL ปลายทางมีอยู่แล้ว กรุณาเลือกชื่อใหม่เพื่อป้องกันการเขียนทับผิดโหมด')
    }
    throw new Error('เขียน SQL artifact ไม่สำเร็จ')
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    fingerprint: plan.fingerprint,
    counts: planCounts(plan),
    output: relativeOutput,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  const summary = await generateSqlArtifact(options)
  console.log(JSON.stringify(summary, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'คำสั่งไม่สำเร็จ')
    process.exitCode = 1
  })
}
