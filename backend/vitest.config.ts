import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
    testTimeout: 15_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    },
  },
});
