import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const backendRoot = path.resolve(__dirname, '..');
const frontendUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3002';
const backendUrl = process.env.BACKEND_API_URL ?? 'http://127.0.0.1:3003';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: frontendUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run start:dev',
      cwd: backendRoot,
      url: `${backendUrl}/health`,
      env: { ...process.env, PORT: new URL(backendUrl).port, TRUST_PROXY_HOPS: '1' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev -- --hostname 127.0.0.1 --port 3002',
      cwd: __dirname,
      url: frontendUrl,
      env: { ...process.env, BACKEND_API_URL: backendUrl, BACKEND_TRUST_PROXY_HEADERS: 'true' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
