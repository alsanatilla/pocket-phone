import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  output: 'server',
  adapter: vercel(),
  trailingSlash: 'never',
  devToolbar: { enabled: false },
  vite: { build: { sourcemap: false } },
});
