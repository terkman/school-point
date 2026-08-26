import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = dirname(scriptDirectory)
const migrationsDirectory = join(repositoryRoot, 'supabase', 'migrations')
const testsDirectory = join(repositoryRoot, 'supabase', 'tests')

const failures = []

function fail(message) {
  failures.push(message)
}

const migrationFiles = (await readdir(migrationsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
  .map((entry) => entry.name)
  .sort()

const migrations = migrationFiles.map((name) => {
  // Supabase accepts timestamp prefixes; this project currently uses YYYYMMDDNNNN (12 digits).
  const match = /^(\d{12,14})_(.+)\.sql$/.exec(name)
  if (!match) {
    fail(`Invalid migration filename: ${name}`)
    return null
  }
  return { name, version: match[1] }
}).filter(Boolean)

const migrationVersions = new Set()
for (const migration of migrations) {
  if (migrationVersions.has(migration.version)) {
    fail(`Duplicate migration version: ${migration.version}`)
  }
  migrationVersions.add(migration.version)
}

for (let index = 1; index < migrations.length; index += 1) {
  if (migrations[index - 1].name >= migrations[index].name) {
    fail(`Migrations are not strictly ordered: ${migrations[index - 1].name} -> ${migrations[index].name}`)
  }
}

const testFiles = (await readdir(testsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
  .map((entry) => entry.name)
  .sort()

const tests = testFiles.map((name) => {
  const match = /^(\d{3})_(.+)\.sql$/.exec(name)
  if (!match) {
    fail(`Invalid SQL assertion filename: ${name}`)
    return null
  }
  return { name, number: Number(match[1]) }
}).filter(Boolean)

tests.forEach((test, index) => {
  const expectedNumber = index + 1
  if (test.number !== expectedNumber) {
    fail(`SQL assertion numbering has a gap or duplicate near ${test.name}; expected ${String(expectedNumber).padStart(3, '0')}`)
  }
})

for (const test of tests) {
  const source = await readFile(join(testsDirectory, test.name), 'utf8')
  if (!/select\s+plan\s*\(/i.test(source)) {
    fail(`SQL assertion has no pgTAP plan(): ${test.name}`)
  }
  if (!/select\s+\*\s+from\s+finish\s*\(\s*\)/i.test(source)) {
    fail(`SQL assertion has no pgTAP finish(): ${test.name}`)
  }
}

const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
const packageLock = JSON.parse(await readFile(join(repositoryRoot, 'package-lock.json'), 'utf8'))
const lockRoot = packageLock.packages?.['']

if (!lockRoot || lockRoot.name !== packageJson.name || lockRoot.version !== packageJson.version) {
  fail(`package.json and package-lock.json root metadata differ (${packageJson.name}@${packageJson.version})`)
}

for (const requiredScript of ['test', 'typecheck', 'build', 'validate:release', 'validate:supabase']) {
  if (typeof packageJson.scripts?.[requiredScript] !== 'string') {
    fail(`Missing required npm script: ${requiredScript}`)
  }
}

const config = await readFile(join(repositoryRoot, 'supabase', 'config.toml'), 'utf8')
const projectId = /^project_id\s*=\s*["']([^"']+)["']/m.exec(config)?.[1]
if (projectId && projectId !== packageJson.name) {
  fail(`supabase/config.toml project_id '${projectId}' does not match package name '${packageJson.name}'`)
}

if (failures.length > 0) {
  console.error('Release consistency validation failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Release consistency validated: ${migrations.length} migrations, ${tests.length} SQL assertion files, package metadata aligned.`)
}
