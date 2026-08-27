import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { verifyRecoveryEvidence } from './verify-recovery-evidence.mjs'

const restoreChecks = [
  'migration_catalog_matches_backup',
  'row_counts_match_backup',
  'ledger_reconciliation',
  'sample_data_readback',
]
const uatChecks = [
  'import_preview_apply_retry',
  'score_ledger_flow',
  'appeal_deadline_boundary',
  'term_opening_idempotency',
  'recovery_readback',
]

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

async function writeEvidence(directory, overrides = {}) {
  const artifact = 'synthetic backup artifact only'
  await writeFile(join(directory, 'backup.dump'), artifact)
  const evidence = {
    schemaVersion: 'school-point-recovery-evidence/v1',
    backup: {
      id: 'backup-uat-001',
      sourceEnvironment: 'staging',
      capturedAt: '2026-08-27T00:00:00Z',
      migrationHead: '202608270001',
      artifacts: [{ kind: 'database_dump', path: 'backup.dump', sha256: sha256(artifact), bytes: Buffer.byteLength(artifact) }],
    },
    restoreDrill: {
      id: 'restore-drill-001',
      targetEnvironment: 'isolated-uat',
      performedAt: '2026-08-27T01:00:00Z',
      outcome: 'passed',
      checks: restoreChecks,
    },
    uat: {
      environment: 'isolated-uat',
      completedAt: '2026-08-27T02:00:00Z',
      dataClass: 'synthetic-only',
      noRealPasswords: true,
      checks: uatChecks,
    },
    ...overrides,
  }
  const path = join(directory, 'recovery-evidence.json')
  await writeFile(path, JSON.stringify(evidence))
  return path
}

test('verifies a complete synthetic backup, restore drill, and UAT evidence set', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'school-point-recovery-'))
  const evidence = await writeEvidence(directory)
  const report = await verifyRecoveryEvidence(evidence)
  assert.equal(report.ok, true)
  assert.equal(report.backup.artifacts[0].bytes, 30)
})

test('rejects production UAT evidence and mismatched backup artifacts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'school-point-recovery-'))
  const evidence = await writeEvidence(directory, {
    uat: {
      environment: 'production',
      completedAt: '2026-08-27T02:00:00Z',
      dataClass: 'synthetic-only',
      noRealPasswords: true,
      checks: uatChecks,
    },
  })
  await assert.rejects(verifyRecoveryEvidence(evidence), /ไม่ใช่ production/)

  const mismatched = await writeEvidence(directory, {
    backup: {
      id: 'backup-uat-002',
      sourceEnvironment: 'staging',
      capturedAt: '2026-08-27T00:00:00Z',
      migrationHead: '202608270001',
      artifacts: [{ kind: 'database_dump', path: 'backup.dump', sha256: '0'.repeat(64), bytes: 30 }],
    },
  })
  await assert.rejects(verifyRecoveryEvidence(mismatched), /artifact ไม่ตรง/)
})
