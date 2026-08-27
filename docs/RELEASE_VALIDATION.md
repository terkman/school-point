# Release validation

The `Validate School Point` workflow is a non-deploying check for every pull request and push to `main`. It runs the frontend/import/recovery tests, Chromium acceptance tests, TypeScript typecheck, production build, release consistency checks, and Supabase validation.

The Chromium suite runs against isolated demo data. It covers the three acceptance viewports, blank/overlay/console checks, background-to-foreground tab recovery, mobile navigation, and the teacher deduction → addition request → admin approval → student history and appeal flow. It never signs in to or writes production Supabase data.

The validation workflow never runs `supabase db push` or deploys an Edge Function. When Docker is available, it starts an isolated local Supabase stack, resets it from the checked-out migrations, runs every file in `supabase/tests`, and stops the stack. When Docker is unavailable, the database runtime portion is reported as skipped; the static consistency check still runs.

Edge Function type-checking is required in CI through the pinned Deno setup action. Local runs may use `npm run validate:supabase` with the default `auto` mode, which skips Deno or Docker checks when those runtimes are not installed.

Useful commands:

```text
npm run validate:release
npm run validate:supabase
npm run test:e2e
npm run test:recovery
SUPABASE_DB_TEST_MODE=local npm run validate:supabase
SUPABASE_DB_URL=<percent-encoded-connection-string> npm run validate:supabase
```

`SUPABASE_DB_URL` is intended for a disposable/staging database whose migration state is already known. The validation script only invokes pgTAP assertions; it does not apply migrations to a remote database.
