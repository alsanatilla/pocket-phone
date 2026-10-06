import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  output: 'server',
  adapter: vercel({ maxDuration: 300 }),
  trailingSlash: 'never',
  devToolbar: { enabled: false },
  vite: { build: { sourcemap: false }, server: { watch: { ignored: ['**/app/**', '**/build/**', '**/.gradle/**', '**/.vercel/**', '**/dist/**'] } } },
});
