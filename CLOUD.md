# Pocket storage and sync

Pocket saves edits locally first. Signing in to a Pocket account connects the phone and browser through the Astro API on [Vercel](https://pocket-phone.vercel.app/) and a libSQL/Turso database. The database token stays on the server. Browser sessions use cookies; the phone encrypts its session token with Android Keystore. Passwords are hashed by Better Auth and are never stored on the phone.

## Shared workspace

| Collection | Contents |
|---|---|
| parking.json | Undecided thoughts, optional review times, source-note links and handled records |
| tasks.json | Chosen actions, completion, dates, importance, checklist progress, selected source text and the next task |
| notes.json | Notes, pins and deletion markers |
| journal.json | Paper pages, positioned transcript lines and linked notes |
| receipt.json | Activity lines from the last 30 days |
| dice.json | The Dice pick list |
| gym.json | Workout times, exercises, sets and deletion markers |

Paper JPEGs are stored as private database files, limited to 2 MB per photo. Workspace requests are limited to 3 MB. Removing a Paper page removes its server photo in the same transaction. Stale uploads cannot restore a removed photo.

Calendar appointments, alarms, task reminders, drafts, notification handles, calls, SMS, contacts and Camera album photos remain on the phone. Pip chats remain in native SQLite or browser storage. Photo zines remain in browser IndexedDB. Provider keys, COROS tokens and COROS caches are excluded from sync. Items explicitly kept from Pip use the shared Notes, Thoughts or Tasks collection.

## Connect devices

In the browser, open **Apps → storage & devices** and create an account with an email and a password of at least 12 characters, or sign in. **Use this browser’s copy** imports guest records and chats into this account’s local copy; it does not copy provider keys or COROS authorization. Account copies stay separate. Switching or signing out reloads the workspace, and other open tabs reload when the selected account changes.

On the phone, open **Settings → Storage & devices → sign in to Pocket** with the same account. Signing in starts sync. The phone’s personal workspace is bound to its first Pocket account; signing in with another account is refused so existing phone records cannot be sent to another person. Turning sync off keeps the local copy and saved session. Signing out revokes the session and keeps local records.

The browser uploads after local changes, reconnecting and returning to the tab, and polls for remote changes every minute while visible. Android schedules edits for the next available network, polls periodically and refreshes on app entry. **Sync now** runs immediately. Failed requests leave local edits available. A browser edit made during a request remains queued until a later response acknowledges it.

Accounts currently use email/password without email verification or a password reset service. Email is an account identifier; Pocket does not send mail.

## Deploy on Vercel

The repository root is an Astro project. vercel.json selects Astro, npm ci and npm run build. The adapter creates static client assets and server functions for /api/auth/*, /api/sync and /api/files/*.

Set these server environment variables in Vercel for Production, and for Preview if preview deployments should use that database:

~~~dotenv
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-private-token
~~~

Do not use PUBLIC_ prefixes. .env is ignored by Git. For local development, copy .env.example to .env, fill in the values, then run npm ci and npm run dev. npm run db:setup checks the connection and creates missing Pocket tables. The API also creates them on first use. Schema setup is additive and uses pocket_ table names.

Optional BETTER_AUTH_SECRET separates session signing from the database token. Without it, the application derives a signing secret from TURSO_AUTH_TOKEN, so the two supplied variables are sufficient. Changing that token without a separate signing secret expires existing sessions. Optional BETTER_AUTH_URL fixes the canonical origin; otherwise authentication uses the request origin.

Queries are parameterized and always scoped to the authenticated user. Browser writes check the request origin and account ID. Native writes use a bearer session and account ID. The server merges records in one write transaction rather than replacing a document with a device’s old copy. Sign-in and account creation use database-backed rate limits. API responses and private photos are not cached by the offline worker.

## Move existing data

For an existing phone Drive workspace, sync it once with Drive, then sign in to Pocket. The next sync merges the current local records into the new account. Drive remains a selectable legacy phone transport.

In the browser, **import from Drive** reads the existing seven collections and Paper photos into the signed-in Pocket account. It never writes to Drive. The public OAuth client in src/client/config.js needs the Vercel origin in its Google authorized JavaScript origins. The Google sign-in script loads only when importing.

GitHub Pages and Vercel are different browser origins. Open the [old Pages URL](https://alsanatilla.github.io/pocket-phone/) in the browser that holds the old copy, choose **download this browser’s workspace**, then use **restore backup** in the Vercel app. That export contains the seven workspace JSON collections. Existing chats and zines stay in the old origin’s storage; this export does not transfer them.

**Download backup** exports the seven workspace collections, including deletion markers. Restoring merges records using the usual timestamps. Backups exclude photo bytes, chats, zines, passwords and provider keys. **Forget this browser’s copy** removes only the current account’s local storage; server records and other accounts remain. Clearing all browser site data also removes local chats and zines.

## Merge rules

Shared rules live in src/shared/workspace.js and mirror the Android stores.

- Thoughts, Notes, Tasks, Paper pages and workouts merge by portable ID. The later updated timestamp wins. Existing server records win exact timestamp ties.
- Handled thoughts and deleted items stay as markers so offline copies do not revive them.
- Activity is a union of immutable line IDs, capped at 300 per day and 30 days.
- Dice uses the later document timestamp. The chosen next task has its own timestamp.
- Source tokens keep a thought linked to the action you explicitly chose. Sync never turns a thought into a task on its own.
- Task updates retain local drafts and device handles. Completing or deleting remotely cancels existing local reminders; downloading or reopening a task does not create an alarm.

## Paper, Movement and zines

Paper photos upload through the authenticated API. Pages can wait for the phone to transcribe them, or **read with Claude** can use the browser tab’s Anthropic key. Provider requests remain direct; the database does not receive API keys. Network failures leave a page waiting. Source-linked note lines retain their positions on the original handwriting.

Movement keeps its separate COROS connection on each device. The phone’s authorization and cached readings use Android Keystore/private storage; browser records use the account’s local browser copy. Recovery, Strain and Conditioning are Pocket estimates implemented in Scores.java and src/client/scores.js. See Movement for their inputs.

Photo zines save automatically in account-scoped IndexedDB. Existing guest books retain their original database. A zine holds up to 40 photos with reversible print treatments, order, captions and crop options. Download a reading PDF or an A5 print booklet to retain or share a copy. Zines and their photo bytes are not uploaded to libSQL.
