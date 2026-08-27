#!/usr/bin/env node

// Offline-only verification for backup, restore-drill, and controlled-UAT
// evidence. It never opens a database connection or invokes Supabase CLI.

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const schemaVersion = 'school-point-recovery-evidence/v1'
const requiredRestoreChecks = new Set([
  'migration_catalog_matches_backup',
  'row_counts_match_backup',
  'ledger_reconciliation',
  'sample_data_readback',
])
const requiredUatChecks = new Set([
  'import_preview_apply_retry',
  'score_ledger_flow',
  'appeal_deadline_boundary',
  'term_opening_idempotency',
  'recovery_readback',
])

function usage() {
  return `ตรวจหลักฐาน backup / restore drill / controlled UAT แบบ read-only

  node scripts/verify-recovery-evidence.mjs --evidence private-data/recovery-evidence.json

ตัวตรวจนี้อ่านเฉพาะไฟล์หลักฐานและ artifact ที่อ้างถึง, ตรวจ SHA-256 และ
เงื่อนไข UAT โดยไม่เชื่อมต่อ Supabase, ไม่ใช้รหัสผ่าน และไม่เขียนฐานข้อมูล`
}

function parseArgs(argv) {
  const options = { json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--help' || value === '-h') options.help = true
    else if (value === '--evidence') options.evidence = argv[++index]
    else if (value === '--json') options.json = true
    else throw new Error(`ไม่รู้จักตัวเลือก: ${value}`)
  }
  return options
}

function requiredText(value, label) {
  const text = String(value ?? '').trim()
  if (!text) throw new Error(`ต้องระบุ ${label}`)
  return text
}

function assertSafeEvidencePath(pathValue) {
  const absolute = resolve(requiredText(pathValue, '--evidence'))
  const fromRepository = relative(repositoryRoot, absolute)
  const insideRepository = fromRepository === '' || (!fromRepository.startsWith(`..${sep}`) && fromRepository !== '..' && !isAbsolute(fromRepository))
  if (insideRepository && !['private-data', 'imports'].includes(fromRepository.split(/[\\/]/)[0].toLowerCase())) {
    throw new Error('ไฟล์หลักฐานภายใน repository ต้องอยู่ใต้ private-data/ หรือ imports/')
  }
  return absolute
}

function assertNoSecrets(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value)) {
    if (key !== 'noRealPasswords' && /(password|secret|token|authorization|service.?role.?key|api.?key)/i.test(key)) {
      throw new Error(`ไฟล์หลักฐานต้องไม่มี secret หรือรหัสผ่าน (${path}.${key})`)
    }
    assertNoSecrets(nested, `${path}.${key}`)
  }
}

function isIsolatedEnvironment(value) {
  const name = requiredText(value, 'environment').toLowerCase()
  return !/(^|[-_ ])(prod|production|live)([-_ ]|$)/.test(name)
}

function assertTimestamp(value, label) {
  const text = requiredText(value, label)
  if (Number.isNaN(Date.parse(text))) throw new Error(`${label} ต้องเป็นเวลา ISO ที่อ่านได้`)
  return text
}

function assertRequiredChecks(actual, expected, label) {
  if (!Array.isArray(actual)) throw new Error(`${label}.checks ต้องเป็นรายการ`)
  const values = new Set(actual.map((item) => String(item).trim()))
  for (const check of expected) {
    if (!values.has(check)) throw new Error(`${label} ขาดผลตรวจ ${check}`)
  }
}

async function sha256File(path) {
  const hash = createHash('sha256')
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolvePromise)
  })
  return hash.digest('hex')
}

async function fileSize(path) {
  const { size } = await stat(path)
  return size
}

export async function verifyRecoveryEvidence(evidencePath) {
  const absoluteEvidencePath = assertSafeEvidencePath(evidencePath)
  await access(absoluteEvidencePath)
  const evidence = JSON.parse(await readFile(absoluteEvidencePath, 'utf8'))
  assertNoSecrets(evidence)
  if (evidence?.schemaVersion !== schemaVersion) throw new Error('schemaVersion ของไฟล์หลักฐานไม่ถูกต้อง')

  const backup = evidence.backup ?? {}
  requiredText(backup.id, 'backup.id')
  requiredText(backup.sourceEnvironment, 'backup.sourceEnvironment')
  assertTimestamp(backup.capturedAt, 'backup.capturedAt')
  requiredText(backup.migrationHead, 'backup.migrationHead')
  if (!Array.isArray(backup.artifacts) || backup.artifacts.length === 0) {
    throw new Error('backup.artifacts ต้องมีอย่างน้อยหนึ่ง artifact')
  }

  const evidenceDirectory = dirname(absoluteEvidencePath)
  const artifacts = []
  for (const artifact of backup.artifacts) {
    const relativePath = requiredText(artifact?.path, 'backup.artifacts[].path')
    if (isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
      throw new Error('artifact path ต้องเป็น relative path ใต้โฟลเดอร์หลักฐาน')
    }
    const absoluteArtifactPath = resolve(evidenceDirectory, relativePath)
    const expectedHash = requiredText(artifact.sha256, 'backup.artifacts[].sha256').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(expectedHash)) throw new Error('backup.artifacts[].sha256 ไม่ถูกต้อง')
    const expectedBytes = Number(artifact.bytes)
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) throw new Error('backup.artifacts[].bytes ไม่ถูกต้อง')
    const [actualHash, actualBytes] = await Promise.all([sha256File(absoluteArtifactPath), fileSize(absoluteArtifactPath)])
    if (actualHash !== expectedHash || actualBytes !== expectedBytes) {
      throw new Error(`backup artifact ไม่ตรงกับหลักฐาน: ${relativePath}`)
    }
    artifacts.push({ path: relativePath, sha256: actualHash, bytes: actualBytes, kind: requiredText(artifact.kind, 'backup.artifacts[].kind') })
  }

  const restoreDrill = evidence.restoreDrill ?? {}
  requiredText(restoreDrill.id, 'restoreDrill.id')
  if (!isIsolatedEnvironment(restoreDrill.targetEnvironment)) throw new Error('restore drill ต้องเกิดใน isolated environment ที่ไม่ใช่ production')
  assertTimestamp(restoreDrill.performedAt, 'restoreDrill.performedAt')
  if (restoreDrill.outcome !== 'passed') throw new Error('restore drill ต้องมี outcome เป็น passed')
  assertRequiredChecks(restoreDrill.checks, requiredRestoreChecks, 'restoreDrill')

  const uat = evidence.uat ?? {}
  if (!isIsolatedEnvironment(uat.environment)) throw new Error('controlled UAT ต้องใช้ environment ที่ไม่ใช่ production')
  assertTimestamp(uat.completedAt, 'uat.completedAt')
  if (uat.dataClass !== 'synthetic-only' || uat.noRealPasswords !== true) {
    throw new Error('controlled UAT ต้องใช้ข้อมูลสังเคราะห์เท่านั้นและห้ามบันทึกรหัสผ่านจริง')
  }
  assertRequiredChecks(uat.checks, requiredUatChecks, 'uat')

  return {
    ok: true,
    schemaVersion,
    backup: { id: String(backup.id), migrationHead: String(backup.migrationHead), artifacts },
    restoreDrill: { id: String(restoreDrill.id), targetEnvironment: String(restoreDrill.targetEnvironment) },
    uat: { environment: String(uat.environment), completedAt: String(uat.completedAt), checks: uat.checks.length },
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  const report = await verifyRecoveryEvidence(options.evidence)
  if (options.json) console.log(JSON.stringify(report, null, 2))
  else console.log(`Recovery evidence verified: backup ${report.backup.id}, ${report.backup.artifacts.length} artifact(s), restore drill ${report.restoreDrill.id}, controlled UAT ${report.uat.environment}.`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'ตรวจหลักฐานไม่สำเร็จ')
    process.exitCode = 1
  })
}
