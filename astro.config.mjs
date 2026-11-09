import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import node from '@astrojs/node';
import react from '@astrojs/react';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';

const root = dir => fileURLToPath(new URL('./' + dir + '/**', import.meta.url));

// Two deploy targets: Vercel (the default) and one long-running Node server (POCKET_TARGET=node, used on Fly.io),
// where the web app and Pip's worker run side by side from the same build.
const target = process.env.POCKET_TARGET === 'node' ? node({ mode: 'standalone' }) : vercel({ maxDuration: 300 });

export default defineConfig({
  output: 'server',
  adapter: target,
  integrations: [react()],
  trailingSlash: 'never',
  // Astro refuses a POST whose Origin does not match the request URL, which a TLS terminator breaks: the server
  // sees http, the browser sends https. Pocket's own routes check the origin per request, so the dev server may
  // opt out when it is published through a proxy (POCKET_ALLOW_PROXY=1); production keeps the check.
  security: { checkOrigin: process.env.POCKET_ALLOW_PROXY !== '1' },
  devToolbar: { enabled: false },
  // Tailwind styles the React client (src/app, imported as "@/"). The Android project's app/ and build/ sit at the root; anchor them there so src/app (the React client) is watched.
  vite: { plugins: [tailwindcss()], resolve: { alias: { '@': fileURLToPath(new URL('./src/app', import.meta.url)) } }, build: { sourcemap: false }, server: { watch: { ignored: [root('app'), root('build'), '**/.gradle/**', '**/.vercel/**', '**/dist/**'] } } },
});
