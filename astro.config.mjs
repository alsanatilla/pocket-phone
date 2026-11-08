import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  output: 'server',
  adapter: vercel({ maxDuration: 300 }),
  trailingSlash: 'never',
  // Astro refuses a POST whose Origin does not match the request URL, which a TLS terminator breaks: the server
  // sees http, the browser sends https. Pocket's own routes check the origin per request, so the dev server may
  // opt out when it is published through a proxy (POCKET_ALLOW_PROXY=1); production keeps the check.
  security: { checkOrigin: process.env.POCKET_ALLOW_PROXY !== '1' },
  devToolbar: { enabled: false },
  vite: { build: { sourcemap: false }, server: { watch: { ignored: ['**/app/**', '**/build/**', '**/.gradle/**', '**/.vercel/**', '**/dist/**'] } } },
});
