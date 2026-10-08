import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { bearer, deviceAuthorization } from 'better-auth/plugins';
import { createAuthEndpoint, formCsrfMiddleware, sessionMiddleware, APIError } from 'better-auth/api';
import { passkey } from '@better-auth/passkey';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { drizzle } from 'drizzle-orm/libsql';
import { database, ensureSchema, execute } from './database.js';
import * as schema from './schema.js';
import { chosenName, NAME_LIMIT } from '../shared/profile-name.js';

export const PHONE_CLIENT = 'pocket-android';
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const accountName = value => {
  try { return chosenName(value); }
  catch (error) { throw new APIError('BAD_REQUEST', { message: error.message }); }
};

// Registration is signed and short-lived. No user or session exists until WebAuthn succeeds.
function registrationContext(secret, origin, value) {
  try {
    if (typeof value !== 'string' || value.length > 1500) throw new Error();
    const [payload, signature] = value.split('.');
    const expected = createHmac('sha256', secret).update('pocket-registration:' + payload).digest();
    const supplied = Buffer.from(signature || '', 'base64url');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error();
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (claims.origin !== origin || !EMAIL.test(claims.email) || !claims.id || claims.expires < Date.now()) throw new Error();
    if (claims.name !== undefined) accountName(claims.name);
    return claims;
  } catch { throw new APIError('BAD_REQUEST', { message: 'Start creating your passkey again.' }); }
}
const pocketAccounts = (secret, origin) => ({
  id: 'pocket-accounts',
  endpoints: {
    startAccount: createAuthEndpoint('/pocket/start-account', { method: 'POST', use: [formCsrfMiddleware] }, async ctx => {
      const email = String(ctx.body?.email || '').trim().toLowerCase();
      if (!EMAIL.test(email)) throw new APIError('BAD_REQUEST', { message: 'Enter a valid email address.' });
      if (await ctx.context.internalAdapter.findUserByEmail(email)) throw new APIError('BAD_REQUEST', { message: 'This email already has a Pocket account. Sign in instead.' });
      const name = accountName(ctx.body?.name ?? email.split('@')[0].slice(0, NAME_LIMIT));
      const payload = Buffer.from(JSON.stringify({ id: randomUUID(), email, name, origin, expires: Date.now() + 5 * 60_000 })).toString('base64url');
      const signature = createHmac('sha256', secret).update('pocket-registration:' + payload).digest('base64url');
      return ctx.json({ context: payload + '.' + signature });
    }),
  },
  rateLimit: [{ pathMatcher: path => path === '/pocket/start-account', window: 60, max: 5 }],
});

function pocketPasskeys(secret, origin) {
  const plugin = passkey({
    rpID: new URL(origin).hostname, rpName: 'Pocket', origin,
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    authentication: {
      afterVerification: async ({ verification }) => {
        if (!verification.authenticationInfo?.userVerified) throw new APIError('UNAUTHORIZED', { message: 'Unlock your passkey with your screen lock or PIN.' });
      },
    },
    registration: {
      requireSession: false,
      resolveUser: async ({ ctx, context }) => {
        const value = registrationContext(secret, origin, context);
        if (await ctx.context.internalAdapter.findUserByEmail(value.email)) throw new APIError('BAD_REQUEST', { message: 'Sign in to your existing Pocket account.' });
        return { id: value.id, name: value.email, displayName: value.name || value.email };
      },
      afterVerification: async ({ ctx, user, context, verification }) => {
        if (!verification.registrationInfo?.userVerified) throw new APIError('BAD_REQUEST', { message: 'Use a passkey protected by your screen lock or PIN.' });
        if (!context) return; // Adding a key to a signed-in account.
        const value = registrationContext(secret, origin, context);
        if (value.id !== user.id || !ctx.body.createSession) throw new APIError('BAD_REQUEST', { message: 'Start creating your passkey again.' });
        if (await ctx.context.internalAdapter.findUserByEmail(value.email)) throw new APIError('BAD_REQUEST', { message: 'Sign in to your existing Pocket account.' });
        const created = await ctx.context.internalAdapter.createUser({ id: value.id, email: value.email, name: accountName(value.name ?? value.email.split('@')[0].slice(0, NAME_LIMIT)), emailVerified: false });
        return { userId: created.id };
      },
    },
  });
  // A single conditional delete also protects against two keys being removed at once.
  plugin.endpoints.deletePasskey = createAuthEndpoint('/passkey/delete-passkey', { method: 'POST', use: [sessionMiddleware] }, async ctx => {
    const id = String(ctx.body?.id || ''), owner = ctx.context.session.user.id;
    const removed = await execute({ sql: `DELETE FROM pocket_passkey WHERE id = ? AND userId = ? AND (
      EXISTS (SELECT 1 FROM pocket_passkey other WHERE other.userId = ? AND other.id <> ?)
      OR EXISTS (SELECT 1 FROM pocket_account WHERE userId = ? AND providerId = 'credential' AND length(password) > 0)) RETURNING id`, args: [id, owner, owner, id, owner] });
    if (!removed.rows.length) {
      const exists = await execute({ sql: 'SELECT 1 FROM pocket_passkey WHERE id = ? AND userId = ?', args: [id, owner] });
      throw new APIError(exists.rows.length ? 'BAD_REQUEST' : 'NOT_FOUND', { message: exists.rows.length ? 'Add another passkey before removing your last one.' : 'Passkey not found.' });
    }
    return ctx.json({ success: true });
  });
  return plugin;
}

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
      database: drizzleAdapter(drizzle(database(), { schema }), { provider: 'sqlite', schema, transaction: true }),
      emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128, requireEmailVerification: false },
      session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
      databaseHooks: { user: {
        create: { before: async user => ({ data: { ...user, name: accountName(user.name) } }) },
        update: { before: async user => user.name === undefined ? undefined : ({ data: { ...user, name: accountName(user.name) } }) },
      } },
      plugins: [
        bearer(),
        pocketPasskeys(secret, origin),
        // The phone shows a short code; a signed-in browser approves it and the phone receives its own session.
        deviceAuthorization({ verificationUri: origin + '/link', expiresIn: '10m', interval: '5s', userCodeLength: 8, validateClient: id => id === PHONE_CLIENT }),
        pocketAccounts(secret, origin),
      ],
      rateLimit: { enabled: true, storage: 'database', window: 60, max: 30, customRules: {
        '/sign-in/email': { window: 60, max: 8 }, '/sign-up/email': { window: 60, max: 5 },
        '/device/code': { window: 60, max: 6 }, '/device/approve': { window: 60, max: 10 },
        '/passkey/verify-authentication': { window: 60, max: 12 },
        '/passkey/verify-registration': { window: 60, max: 12 },
        '/device/token': { window: 60, max: 20 },
      } },
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
export async function currentSession(request) {
  const auth = await authFor(request);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw Object.assign(new Error('Sign in to Pocket.'), { status: 401 });
  return session;
}
