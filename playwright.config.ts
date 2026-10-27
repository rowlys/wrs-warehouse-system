import { defineConfig, devices } from '@playwright/test'

// Demo passwords and WEB_PORT come from the same .env as the stack; variables already set win.
try {
  process.loadEnvFile('.env')
} catch {
  // No .env: rely on the environment.
}

// Runs against the stack started with `docker compose up --build -d` (spec §9).
export default defineConfig({
  testDir: './e2e',
  // The flow is one ordered story against shared data.
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${process.env.WEB_PORT || 8080}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
