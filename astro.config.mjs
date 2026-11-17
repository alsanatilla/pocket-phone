import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';

const root = dir => fileURLToPath(new URL('./' + dir + '/**', import.meta.url));

// One deploy target: a long-running Node server (Fly.io), where the web app and Pip's worker run side by side from
// the same build (see Dockerfile, fly.toml and services/server/start.mjs).
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  trailingSlash: 'never',
  // Behind a TLS terminator the server sees http while the browser sends https, so Astro's own origin check would
  // reject every POST. Pocket's routes check the origin per request themselves, so the deployed server stands down
  // (POCKET_ALLOW_PROXY=1, set by the Dockerfile); a local run without a proxy keeps the check.
  security: { checkOrigin: process.env.POCKET_ALLOW_PROXY !== '1' },
  devToolbar: { enabled: false },
  // Tailwind styles the React client (src/app, imported as "@/"). The Android project's app/ and build/ sit at the root; anchor them there so src/app (the React client) is watched.
  vite: { plugins: [tailwindcss()], resolve: { alias: { '@': fileURLToPath(new URL('./src/app', import.meta.url)) } }, build: { sourcemap: false }, server: { watch: { ignored: [root('app'), root('build'), '**/.gradle/**', '**/dist/**'] } } },
});
