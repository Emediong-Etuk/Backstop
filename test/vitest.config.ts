import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // CashScript's matchers (toFailRequireWith, toLog) register on the global `expect`.
    globals: true,
    setupFiles: ['./setup.ts'],
    testTimeout: 30_000,
  },
});
