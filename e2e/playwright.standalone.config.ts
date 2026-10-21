import { defineConfig } from '@playwright/test';
import path from 'node:path';

// Browser-only checks, without downloading or launching the VS Code test host.
export default defineConfig({
  testDir: path.join(__dirname, 'tests/standalone'),
  testIgnore: '**/multi-server-hooks.spec.ts',
  timeout: 45_000,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: '../playwright-report/standalone', open: 'never' }],
  ],
  outputDir: '../test-results/standalone',
  use: {
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
    screenshot: 'only-on-failure',
  },
});
