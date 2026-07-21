#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const USERNAME_PATTERN = /^[a-z0-9._-]+$/

function usage() {
  return `ออกรหัสเปิดใช้ครั้งเดียวสำหรับบัญชีที่ provision แล้ว

  node scripts/issue-supabase-activation.mjs --username USERNAME --output private-data/activation-codes.json

Environment ที่ต้องมี (ห้ามใช้ VITE_*):
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

ตัวเลือก:
  --auth-domain DOMAIN   ค่าเริ่มต้น accounts.school-point.invalid
  --help                 แสดงวิธีใช้

ควรออกรหัสเมื่อพร้อมส่งให้ผู้ใช้ เพราะ OTP มีอายุตามค่า Auth ของ Supabase และใช้ได้ครั้งเดียว`
}

function parseArgs(argv) {
  const options = { authDomain: 'accounts.school-point.invalid' }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--help' || value === '-h') options.help = true
    else if (value === '--username') options.username = argv[++index]
    else if (value === '--output') options.output = argv[++index]
    else if (value === '--auth-domain') options.authDomain = argv[++index]
    else throw new Error(`ไม่รู้จักตัวเลือก: ${value}`)
  }
  return options
}

function normalizeUsername(value) {
  const username = String(value ?? '').trim().toLowerCase()
  if (!username || !USERNAME_PATTERN.test(username) || username.startsWith('.') || username.endsWith('.') || username.includes('..')) {
    throw new Error('username ไม่ถูกต้อง')
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

function assertPrivateJsonPath(pathValue) {
  if (!pathValue) throw new Error('ต้องระบุ --output')
  const absolute = resolve(pathValue)
  if (extname(absolute).toLowerCase() !== '.json') throw new Error('--output ต้องเป็นไฟล์ .json')
  const fromCwd = relative(process.cwd(), absolute)
  const isInside = fromCwd === '' || (!fromCwd.startsWith(`..${sep}`) && fromCwd !== '..' && !isAbsolute(fromCwd))
  if (isInside && !['private-data', 'imports'].includes(fromCwd.split(/[\\/]/)[0].toLowerCase())) {
    throw new Error('--output ภายใน repository ต้องอยู่ใต้ private-data/ หรือ imports/')
  }
  return absolute
}

async function fileExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export function normalizeProjectUrl(value) {
  let parsed
  try {
    parsed = new URL(String(value ?? '').trim())
  } catch {
    throw new Error('SUPABASE_URL ไม่ถูกต้อง')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('SUPABASE_URL ไม่ถูกต้อง')
  }
  return parsed.origin
}

export async function loadArtifact(path, projectUrl) {
  const normalizedProjectUrl = normalizeProjectUrl(projectUrl)
  if (!(await fileExists(path))) {
    return { schemaVersion: 'school-point-activation-codes/v1', projectUrl: normalizedProjectUrl, updatedAt: new Date().toISOString(), accounts: [] }
  }
  const parsed = JSON.parse(await readFile(path, 'utf8'))
  if (parsed?.schemaVersion !== 'school-point-activation-codes/v1' || !Array.isArray(parsed.accounts)) {
    throw new Error('ไฟล์ activation เดิมมีรูปแบบไม่ถูกต้อง จึงไม่เขียนทับ')
  }
  if (normalizeProjectUrl(parsed.projectUrl) !== normalizedProjectUrl) {
    throw new Error('ไฟล์ activation เดิมเป็นของ Supabase project อื่น จึงไม่เขียนปะปนกัน')
  }
  parsed.projectUrl = normalizedProjectUrl
  return parsed
}

async function listUserByEmail(client, email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`อ่าน Auth users ไม่สำเร็จ (${error.status ?? 'unknown'})`)
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email)
    if (user) return user
    if (data.users.length < 1000) return null
  }
}

export async function assertAccountRequiresActivation(client, userId) {
  const { data, error } = await client
    .from('profiles')
    .select('is_active,activation_required')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw new Error(`ตรวจสถานะเปิดใช้บัญชีไม่สำเร็จ (${error.status ?? error.code ?? 'unknown'})`)
  }
  if (!data) throw new Error('บัญชี Auth นี้ยังไม่ได้ผูกกับข้อมูลโรงเรียน')
  if (data.is_active !== true) throw new Error('บัญชีโรงเรียนนี้ถูกระงับการใช้งาน')
  if (data.activation_required !== true) throw new Error('บัญชีนี้เปิดใช้งานแล้ว จึงไม่ออกรหัสเปิดใช้ซ้ำ')
  return data
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  const username = normalizeUsername(options.username)
  const domain = normalizeDomain(options.authDomain)
  const output = assertPrivateJsonPath(options.output)
  const rawUrl = String(process.env.SUPABASE_URL ?? '').trim()
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!rawUrl || !serviceRoleKey) throw new Error('ต้องตั้ง SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ใน trusted environment')
  const url = normalizeProjectUrl(rawUrl)
  const artifact = await loadArtifact(output, url)

  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const email = `${username}@${domain}`
  const user = await listUserByEmail(client, email)
  if (!user) throw new Error('ไม่พบบัญชีที่ provision แล้ว')
  await assertAccountRequiresActivation(client, user.id)
  const { data, error } = await client.auth.admin.generateLink({ type: 'magiclink', email })
  const activationCode = data?.properties?.email_otp
  if (error || !activationCode) throw new Error(`ออกรหัสเปิดใช้ไม่สำเร็จ (${error?.status ?? 'unknown'})`)

  artifact.updatedAt = new Date().toISOString()
  artifact.accounts = artifact.accounts.filter((account) => normalizeUsername(account.username) !== username)
  artifact.accounts.push({ username, activationCode, issuedAt: new Date().toISOString() })
  artifact.accounts.sort((left, right) => left.username.localeCompare(right.username, 'en'))
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  console.log(JSON.stringify({ ok: true, issued: 1, output }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'คำสั่งไม่สำเร็จ')
    process.exitCode = 1
  })
}
