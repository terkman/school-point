import { access, cp, mkdtemp } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const supabaseEntrypoint = join(repositoryRoot, 'node_modules', 'supabase', 'dist', 'supabase.js')
const mode = (process.env.SUPABASE_DB_TEST_MODE ?? 'auto').toLowerCase()
const functionMode = (process.env.SUPABASE_FUNCTIONS_CHECK ?? 'auto').toLowerCase()

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
  })
}

function available(command, args = ['--version'], env) {
  const result = run(command, args, { env })
  return result.status === 0
}

function runSupabase(args, options = {}) {
  return run(process.execPath, [supabaseEntrypoint, ...args], options)
}

function supabaseAvailable(env) {
  return runSupabase(['--version'], { env }).status === 0
}

function fail(message) {
  console.error(`Supabase runtime validation failed: ${message}`)
  process.exitCode = 1
}

let supabaseHome = process.env.SUPABASE_HOME
if (!supabaseHome) {
  supabaseHome = await mkdtemp(join(tmpdir(), 'school-point-supabase-'))
}
const runtimeEnv = { SUPABASE_HOME: supabaseHome, SUPABASE_TELEMETRY_DISABLED: 'true' }

if (mode !== 'off' && mode !== 'skip') {
  const databaseUrl = process.env.SUPABASE_DB_URL
  let shouldRun = Boolean(databaseUrl)
  let local = false

  if (!shouldRun && (mode === 'local' || mode === 'auto')) {
    const dockerReady = available('docker', ['info'])
    if (dockerReady) {
      shouldRun = true
      local = true
    } else if (mode === 'local') {
      fail('SUPABASE_DB_TEST_MODE=local requires a working Docker runtime')
    }
  }

  if (shouldRun) {
    if (!supabaseAvailable(runtimeEnv)) {
      fail('Supabase CLI is unavailable')
    } else {
      if (local) {
        const start = runSupabase(['start'], { env: runtimeEnv, inherit: true })
        if (start.status !== 0) {
          fail('supabase start failed')
        } else {
          const reset = runSupabase(['db', 'reset', '--local', '--yes'], { env: runtimeEnv, inherit: true })
          if (reset.status !== 0) fail('supabase db reset --local failed')
        }
      }
      if (process.exitCode === undefined) {
        const testArgs = ['db', 'test']
        if (databaseUrl) testArgs.push('--db-url', databaseUrl)
        else testArgs.push('--local')
        testArgs.push('supabase/tests')
        const tests = runSupabase(testArgs, { env: runtimeEnv, inherit: true })
        if (tests.status !== 0) fail('Supabase pgTAP assertions failed')
      }
      if (local) {
        runSupabase(['stop'], { env: runtimeEnv, inherit: true })
      }
    }
  } else {
    console.log('Supabase DB runtime unavailable; migration/pgTAP execution skipped (static release checks still run).')
  }
} else {
  console.log('Supabase DB runtime validation disabled by SUPABASE_DB_TEST_MODE.')
}

if (functionMode !== 'off' && functionMode !== 'skip') {
  const denoAvailable = available('deno', ['--version'])
  if (!denoAvailable) {
    if (functionMode === 'required') fail('Deno is required but unavailable')
    else console.log('Deno runtime unavailable; Edge Function type-check skipped.')
  } else {
    // Check a focused copy outside the repository so Deno cannot discover the
    // frontend package.json and download unrelated Vite/Playwright/Cloudflare
    // dependencies. Relative imports within the Functions tree are preserved.
    const edgeValidationRoot = await mkdtemp(join(tmpdir(), 'school-point-edge-'))
    const edgeFunctionsRoot = join(edgeValidationRoot, 'functions')
    const edgeImportMap = join(edgeValidationRoot, 'deno-edge-validation-import-map.json')
    await cp(join(repositoryRoot, 'supabase', 'functions'), edgeFunctionsRoot, { recursive: true })
    await cp(
      join(repositoryRoot, 'scripts', 'deno-edge-validation-import-map.json'),
      edgeImportMap,
    )
    await cp(
      join(repositoryRoot, 'scripts', 'deno-exceljs-validation-shim.ts'),
      join(edgeValidationRoot, 'deno-exceljs-validation-shim.ts'),
    )
    const functionEntrypoints = [
      join(edgeFunctionsRoot, 'admin-directory', 'index.ts'),
      join(edgeFunctionsRoot, 'admin-school-import', 'index.ts'),
    ]
    for (const entrypoint of functionEntrypoints) {
      // Keep Edge Function validation isolated from the frontend package tree.
      // `auto` installs every package.json dependency into Deno's managed
      // node_modules directory, which can exhaust GitHub runner resources even
      // though these functions only need their explicit npm: imports.
      const check = run(
        'deno',
        ['check', '--node-modules-dir=none', `--import-map=${edgeImportMap}`, entrypoint],
        { inherit: true, cwd: edgeValidationRoot },
      )
      if (check.status !== 0) fail(`Deno type-check failed for ${entrypoint}`)
    }
  }
} else {
  console.log('Edge Function type-check disabled by SUPABASE_FUNCTIONS_CHECK.')
}

await access(repositoryRoot, constants.R_OK)
