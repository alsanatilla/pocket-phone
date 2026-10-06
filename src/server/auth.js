import { createHash } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { bearer } from 'better-auth/plugins';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { drizzle } from 'drizzle-orm/libsql';
import { database, ensureSchema } from './database.js';
import * as schema from './schema.js';

const instances = new Map();
export async function authFor(request) {
  await ensureSchema();
  const origin = process.env.BETTER_AUTH_URL || new URL(request.url).origin;
  if (!instances.has(origin)) {
    const token = process.env.TURSO_AUTH_TOKEN;
    const secret = process.env.BETTER_AUTH_SECRET || (token && createHash('sha256').update('pocket-auth-v1:' + token).digest('hex'));
    if (!secret) throw new Error('Pocket authentication is not configured.');
    instances.set(origin, betterAuth({
      appName: 'Pocket', baseURL: origin, secret,
      database: drizzleAdapter(drizzle(database(), { schema }), { provider: 'sqlite', schema }),
      emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128, requireEmailVerification: false },
      session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
      plugins: [bearer()],
      rateLimit: { enabled: true, storage: 'database', window: 60, max: 30, customRules: { '/sign-in/email': { window: 60, max: 8 }, '/sign-up/email': { window: 60, max: 5 } } },
    }));
  }
  return instances.get(origin);
}
export async function signedIn(request) {
  const auth = await authFor(request);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw Object.assign(new Error('Sign in to Pocket.'), { status: 401 });
  return session.user;
}
