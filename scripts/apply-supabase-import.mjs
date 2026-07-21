#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const USERNAME_PATTERN = /^[a-z0-9._-]+$/

function usage() {
  return `นำ import plan เข้า Supabase จาก trusted local process

ตรวจอย่างเดียว (ค่าเริ่มต้น):
  node scripts/apply-supabase-import.mjs --input private-data/import-plan.json

เขียนข้อมูลจริง:
  node scripts/apply-supabase-import.mjs --input private-data/import-plan.json --apply --confirm-fingerprint SHA256

เขียนข้อมูลและสร้างบัญชีที่ยังไม่มีรหัสผ่าน:
  node scripts/apply-supabase-import.mjs --input private-data/import-plan.json --apply --confirm-fingerprint SHA256 --provision

Environment ที่ต้องมี (ห้ามใช้ VITE_*):
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

ตัวเลือก:
  --auth-domain DOMAIN   ค่าเริ่มต้น accounts.school-point.invalid
  --help                 แสดงวิธีใช้`
}

function parseArgs(argv) {
  const options = { apply: false, provision: false, authDomain: 'accounts.school-point.invalid' }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--apply') options.apply = true
    else if (value === '--provision') options.provision = true
    else if (value === '--help' || value === '-h') options.help = true
    else if (value === '--input') options.input = argv[++index]
    else if (value === '--confirm-fingerprint') options.confirmFingerprint = argv[++index]
    else if (value === '--auth-domain') options.authDomain = argv[++index]
    else throw new Error(`ไม่รู้จักตัวเลือก: ${value}`)
  }
  return options
}

function normalizeUsername(value) {
  const username = String(value ?? '').trim().toLowerCase()
  if (!username || !USERNAME_PATTERN.test(username) || username.startsWith('.') || username.endsWith('.') || username.includes('..')) {
    throw new Error('พบ username ที่ไม่เป็นไปตามสัญญา login')
  }
  return username
}

function normalizeDomain(value) {
  const domain = String(value ?? '').trim().toLowerCase()
  if (!/^[a-z0-9.-]+$/.test(domain) || domain.startsWith('.') || domain.endsWith('.') || !domain.includes('.')) {
    throw new Error('--auth-domain ไม่ถูกต้อง')
  }
  return domain
}

export function assertPrivateJsonPath(pathValue, label) {
  if (!pathValue) throw new Error(`ต้องระบุ ${label}`)
  const absolute = resolve(pathValue)
  if (extname(absolute).toLowerCase() !== '.json') throw new Error(`${label} ต้องเป็นไฟล์ .json`)
  const fromCwd = relative(process.cwd(), absolute)
  const isInside = fromCwd === '' || (!fromCwd.startsWith(`..${sep}`) && fromCwd !== '..' && !isAbsolute(fromCwd))
  if (isInside) {
    const firstPart = fromCwd.split(/[\\/]/)[0].toLowerCase()
    if (!['private-data', 'imports'].includes(firstPart)) {
      throw new Error(`${label} ภายใน repository ต้องอยู่ใต้ private-data/ หรือ imports/`)
    }
  }
  return absolute
}

export function validatePlan(plan) {
  if (!plan || plan.schemaVersion !== 'school-point-import/v1') throw new Error('import plan ไม่ใช่ school-point-import/v1')
  if (!/^[a-f0-9]{64}$/.test(String(plan.fingerprint ?? ''))) throw new Error('import plan ไม่มี SHA-256 fingerprint ที่ถูกต้อง')
  for (const key of ['students', 'guardians', 'staff', 'assignments', 'classrooms']) {
    if (!Array.isArray(plan[key])) throw new Error(`import plan ไม่มี ${key} array`)
  }
  const planCore = {
    schemaVersion: plan.schemaVersion,
    term: plan.term,
    classrooms: plan.classrooms,
    students: plan.students,
    guardians: plan.guardians,
    staff: plan.staff,
    assignments: plan.assignments,
  }
  const actualFingerprint = createHash('sha256').update(JSON.stringify(planCore)).digest('hex')
  if (actualFingerprint !== plan.fingerprint) throw new Error('เนื้อหา import plan ไม่ตรงกับ fingerprint; ให้สร้าง plan ใหม่จากตัวตรวจนำเข้า')
  return plan
}

function collectAccounts(plan) {
  const accounts = [
    ...plan.students.map((student) => ({ username: normalizeUsername(student.studentCode), role: 'student' })),
    ...plan.staff
      .filter((member) => member.username)
      .map((member) => ({ username: normalizeUsername(member.username), role: member.role })),
  ].sort((left, right) => left.username.localeCompare(right.username, 'en'))
  const seen = new Set()
  for (const account of accounts) {
    if (seen.has(account.username)) throw new Error('พบ username ซ้ำใน import plan')
    seen.add(account.username)
  }
  return accounts
}

function safeResultSummary(result) {
  if (!result || typeof result !== 'object') return { ok: false }
  return {
    ok: result.ok === true,
    alreadyApplied: result.alreadyApplied === true,
    counts: result.counts && typeof result.counts === 'object' ? result.counts : undefined,
    errorCount: Array.isArray(result.errors) ? result.errors.length : 0,
    clientPlanFingerprint: typeof result.clientFingerprint === 'string' ? result.clientFingerprint : undefined,
    databasePayloadFingerprint: typeof result.serverFingerprint === 'string' ? result.serverFingerprint : undefined,
  }
}

async function importSchoolData(client, plan, apply) {
  const { data, error } = await client.rpc('admin_import_school_data', {
    p_payload: plan,
    p_dry_run: !apply,
  })
  if (error) throw new Error(`Supabase import RPC ไม่สำเร็จ: ${error.message}`)
  const summary = safeResultSummary(data)
  if (!summary.ok || summary.errorCount > 0) throw new Error('Supabase ปฏิเสธ import plan; ให้ตรวจผล dry-run ในฐานข้อมูล')
  if (summary.clientPlanFingerprint !== plan.fingerprint) throw new Error('Supabase ตอบ client fingerprint ไม่ตรงกับ import plan')
  return summary
}

async function listAllUsers(client) {
  const users = []
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`อ่านรายชื่อ Auth users ไม่สำเร็จ: ${error.message}`)
    users.push(...data.users)
    if (data.users.length < 1000) break
  }
  return users
}

async function provisionAccounts(client, accounts, authDomain) {
  const existingUsers = await listAllUsers(client)
  const userByEmail = new Map(existingUsers.flatMap((user) => user.email ? [[user.email.toLowerCase(), user]] : []))
  let created = 0
  let linked = 0
  let existing = 0
  let activatedExisting = 0

  for (const account of accounts) {
    const email = `${account.username}@${authDomain}`
    let user = userByEmail.get(email)
    const wasExisting = Boolean(user)
    if (!user) {
      const { data, error } = await client.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { username: account.username, must_change_password: true },
      })
      if (error || !data.user) throw new Error(`สร้าง Auth user ลำดับที่ ${created + existing + 1} ไม่สำเร็จ: ${error?.message ?? 'ไม่พบ user'}`)
      user = data.user
      userByEmail.set(email, user)
      created += 1
    } else {
      existing += 1
    }

    const { data, error } = await client.rpc('admin_link_provisioned_account', {
      p_username: account.username,
      p_user_id: user.id,
    })
    if (error || data?.ok !== true) throw new Error(`ผูกบัญชีลำดับที่ ${linked + 1} ไม่สำเร็จ: ${error?.message ?? 'RPC response ไม่ถูกต้อง'}`)
    linked += 1
    if (wasExisting) {
      const { data: activation, error: activationError } = await client.rpc('admin_mark_account_activated', {
        p_user_id: user.id,
      })
      if (activationError || activation?.ok !== true) {
        throw new Error(`ยืนยันบัญชีเดิมลำดับที่ ${linked} ไม่สำเร็จ: ${activationError?.message ?? 'RPC response ไม่ถูกต้อง'}`)
      }
      if (activation.activated === true) activatedExisting += 1
    }
  }

  return { total: accounts.length, created, existing, linked, activatedExisting }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  if (!options.input) throw new Error('ต้องระบุ --input')
  if (options.provision && !options.apply) throw new Error('--provision ใช้ได้เมื่อระบุ --apply เท่านั้น')
  if (options.apply && options.confirmFingerprint === undefined) throw new Error('การเขียนจริงต้องระบุ --confirm-fingerprint')

  const url = String(process.env.SUPABASE_URL ?? '').trim()
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!url || !serviceRoleKey) throw new Error('ต้องตั้ง SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ใน environment ของ trusted process')

  const inputPath = assertPrivateJsonPath(options.input, '--input')
  const plan = validatePlan(JSON.parse(await readFile(inputPath, 'utf8')))
  if (options.apply && options.confirmFingerprint !== plan.fingerprint) throw new Error('--confirm-fingerprint ไม่ตรงกับ import plan')
  const authDomain = normalizeDomain(options.authDomain)
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const importSummary = await importSchoolData(client, plan, options.apply)
  const result = { mode: options.apply ? 'apply' : 'dry-run', import: importSummary }
  if (options.provision) {
    result.provisioning = await provisionAccounts(client, collectAccounts(plan), authDomain)
  }
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'คำสั่งไม่สำเร็จ')
    process.exitCode = 1
  })
}
