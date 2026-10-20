import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE || 'http://localhost:8081',
  },
  projects: [
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
});
