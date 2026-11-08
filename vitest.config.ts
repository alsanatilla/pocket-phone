import { defineConfig } from 'vitest/config';

// Unit and component tests for the React client. The repo's older checks under tools/ run with node --test.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/app/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['src/app/test/setup.ts'],
    restoreMocks: true,
  },
});
