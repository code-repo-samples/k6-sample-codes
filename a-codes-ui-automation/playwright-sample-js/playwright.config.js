// @ts-check
require('dotenv').config(); // loads BASE_URL, LOGIN_USERNAME, LOGIN_PASSWORD, etc. from .env
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,          // the journey spec shares one page/state - keep serial
  retries: 1,
  timeout: 60_000,

  use: {
    baseURL: process.env.BASE_URL || 'https://ui-gcp.alpha.codes.coke.com',
    trace: 'on',                 // full step-by-step trace, screenshots per action
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
  },

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
