// A one-time sign-in link for an account at an address, for moving to a new address (a passkey only works on
// the address it was made on). Valid for 15 minutes, works once. Needs the server's .env (or its secrets).
//   node --env-file=.env scripts/sign-in-link.mjs you@example.com https://pocket-phone.fly.dev
import { execute } from '../src/server/database.js';
import { signInLink } from '../src/server/auth.js';

const [email, origin] = process.argv.slice(2);
if (!email || !/^https:\/\/[^/]+$/.test(origin || '')) { console.error('Usage: sign-in-link.mjs <email> <https://address>'); process.exit(2); }
const user = (await execute({ sql: 'SELECT id FROM pocket_user WHERE lower(email) = lower(?)', args: [email] })).rows[0];
if (!user) { console.error('No Pocket account with that email.'); process.exit(1); }
console.log(signInLink(String(user.id), origin));
