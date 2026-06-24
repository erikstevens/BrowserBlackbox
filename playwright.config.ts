import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  passWithNoTests: true,
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
});
