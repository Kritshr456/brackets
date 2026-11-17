import { defineConfig } from '@playwright/test';
const port = Number(process.env.BROWSER_TEST_PORT || 4179);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 30000,
  use: {
    baseURL, headless: true, viewport: { width: 1280, height: 900 },
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?
      { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: {
    command: 'node scripts/browser-server.js', url: `${baseURL}/health`,
    reuseExistingServer: false, timeout: 15000,
  },
});
