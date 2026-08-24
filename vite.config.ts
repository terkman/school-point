import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { sites } from './build/sites-vite-plugin'

export default defineConfig(async ({ mode }) => {
  process.env.WRANGLER_WRITE_LOGS ??= 'false'
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs'
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry'

  const githubPagesBuild = process.env.GITHUB_PAGES === 'true'

  const workerPlugins =
    mode === 'test' || githubPagesBuild
      ? []
      : (await import('@cloudflare/vite-plugin')).cloudflare({
          viteEnvironment: { name: 'server' },
          config: {
            name: 'school-point',
            main: './worker/index.ts',
            compatibility_date: '2026-07-22',
            assets: {
              binding: 'ASSETS',
              not_found_handling: 'single-page-application',
            },
          },
        })

  return {
    base: githubPagesBuild ? '/school-point/' : '/',
    plugins: [
      react(),
      sites(),
      ...workerPlugins,
    ],
    server: {
      port: 4173,
    },
    preview: {
      port: 4173,
    },
  }
})
