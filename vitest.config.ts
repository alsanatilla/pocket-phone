import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit and component tests for the React client. The repo's older checks under tools/ run with node --test.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': fileURLToPath(new URL('./src/app', import.meta.url)) } },
  test: {
    include: ['src/app/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['src/app/test/setup.ts'],
    restoreMocks: true,
  },
});
