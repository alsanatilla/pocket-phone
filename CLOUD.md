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

Calendar appointments, alarms, task reminders, drafts, notification handles, calls, SMS, contacts and Camera album photos remain on the phone. Pip chats save locally first (native SQLite or browser storage), then sync to the signed-in account with their drafts, attached context and reply activity; per reply the later edit wins and deleted chats stay as markers. Photo zines sync between browsers with their photos. Provider keys never leave the device. Items explicitly kept from Pip use the shared Notes, Thoughts or Tasks collection.

## Connect devices

**Set up Pocket** is the one path through every connection, in order: the account, linking the phone, COROS, then Pip. Open it from the reminder on Today (browser) or Home (phone), from **Apps → Set up Pocket** in the browser, or from **Settings → set up pocket** on the phone. Each step shows whether it is connected; any step can be skipped and reopened later, and the page always starts at the first open step. COROS connects once for the account, so the phone and browser share it. Pip keys stay per device: the phone stores its key encrypted, the browser keeps it for the tab. The step offers OpenRouter’s free models or a Claude key; other providers remain in Pip’s own settings.

In the browser, open **Apps → Account & devices** for the full account screen. Email/password sign-in is shown first; **sign in with passkey** is an optional action. **Create account** opens a separate email/password form, with a password of at least 12 characters. **Create with a passkey** explicitly chooses passkey registration instead. A passkey is attached to your Pocket account, not a new account for its device. Once signed in, add another passkey from **Passkeys** if needed; a password account can add passkeys too.

**Bring this browser’s workspace** imports guest records and chats into the chosen account’s local copy and transfers an existing guest COROS connection to the account. It does not copy provider keys. Account copies stay separate. Switching or signing out reloads the workspace, and other open tabs reload when the selected account changes.

On the phone, open **Settings → set up pocket → link this phone** (or **storage & devices** on ROM builds). Open the supplied browser link or enter the short code at [Pocket’s link page](https://pocket-phone.vercel.app/link), sign in to the same Pocket account, and approve the displayed code. The phone receives its own session and starts sync; it does not create another account or need its own passkey. Password sign-in remains available. Codes expire after ten minutes.

The account screen lists device sessions and can sign out another session. Removing a passkey removes that sign-in key; the last key cannot be removed from an account without another sign-in method. The phone’s personal workspace is bound to its first Pocket account; signing in with another account is refused so existing phone records cannot be sent to another person. Turning sync off keeps the local copy and saved session. Signing out revokes the session and keeps local records.

The browser uploads after local changes, reconnecting and returning to the tab, and polls for remote changes every minute while visible. Android schedules edits for the next available network, polls periodically and refreshes on app entry. **Sync now** runs immediately. Failed requests leave local edits available. A browser edit made during a request remains queued until a later response acknowledges it.

Email is an account identifier. Pocket does not send verification or password-reset mail. A passkey created on one device may be available on another through its password manager or the browser’s nearby-device prompt; otherwise use an existing account password or an already-authorized browser to link the phone.

## Search and note recovery

Search covers Notes, Tasks and their steps/source text, parked Thoughts, Paper transcripts and Pip messages. Server results are scoped to the signed-in account; saved local records remain searchable offline. Phone appointments are local search results. Saves, deletions and the server search index change together in one transaction. Existing account records are indexed on their first search.

Signed-in Notes offer **history** in the editor and **recently deleted** in the notes list. History keeps up to 60 text checkpoints per note. Edits within a ten-minute editing session coalesce while preserving the initial text. Restoring a version preserves the text being replaced, including a local draft that has not synced yet; a conflicting newer edit requires reviewing history again. Notes deleted within the last 30 days can be restored as new notes, keeping the old deletion marker intact.

## Deploy on Vercel

The repository root is an Astro project. vercel.json selects Astro, npm ci and npm run build. The adapter creates static client assets and server functions for authentication, workspace/object sync, private photos, COROS, account search and note history.

Set these server environment variables in Vercel for Production, and for Preview if preview deployments should use that database:

~~~dotenv
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-private-token
~~~

Do not use PUBLIC_ prefixes. .env is ignored by Git. For local development, copy .env.example to .env, fill in the values, then run npm ci and npm run dev. npm run db:setup checks the connection and creates missing Pocket tables. The API also creates them on first use. Schema setup is additive and uses pocket_ table names.

Optional BETTER_AUTH_SECRET separates session signing from the database token. Without it, the application derives a signing secret from TURSO_AUTH_TOKEN, so the two supplied variables are sufficient. Changing that token without a separate signing secret expires existing sessions. Optional BETTER_AUTH_URL fixes the canonical origin; otherwise authentication uses the request origin. No additional key or environment variable is required for passkeys, device linking, search or history. Keep the production origin stable: passkeys registered for pocket-phone.vercel.app are tied to that hostname, and unrelated preview hostnames do not share them. Use the production URL when linking devices.

Queries are parameterized and always scoped to the authenticated user. Browser writes check the request origin and account ID. Native writes use a bearer session and account ID. The server merges records in one write transaction rather than replacing a document with a device’s old copy. Sign-in and account creation use database-backed rate limits. API responses and private photos are not cached by the offline worker.

## Move existing data

For an existing phone Drive workspace, sync it once with Drive, then sign in to Pocket. The next sync merges the current local records into the new account. Drive remains a selectable legacy phone transport.

In the browser, **import from Drive** reads the existing seven collections and Paper photos into the signed-in Pocket account. It never writes to Drive. The public OAuth client in src/client/config.js needs the Vercel origin in its Google authorized JavaScript origins. The Google sign-in script loads only when importing.

GitHub Pages and Vercel are different browser origins. Open the [old Pages URL](https://alsanatilla.github.io/pocket-phone/) in the browser that holds the old copy, choose **download this browser’s workspace**, then use **restore backup** in the Vercel app. That export contains the seven workspace JSON collections. Existing chats and zines stay in the old origin’s storage; this export does not transfer them.

**Download backup** exports the seven workspace collections, including deletion markers. Restoring merges records using the usual timestamps. Backups exclude photo bytes, chats, zines, passwords and provider keys. **Forget this browser’s copy** removes only the current account’s local storage; server records and other accounts remain. Signed-in chats and zines are restored from the account after clearing browser data; guest copies are not.

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

Signed in, the COROS connection belongs to the Pocket account: its authorization is encrypted on the server and the last readings are stored there, so phone and browser show the same data and keep it when a refresh fails. Readings refresh at most every 15 minutes while Pocket is open, hourly from the phone when it has a network, and once a day from a scheduled job (`.github/workflows/coros-refresh.yml`, which needs the `POCKET_COROS_CRON_SECRET` repository secret) even when both apps are closed. If COROS revokes or expires the authorization, the saved readings stay and Movement offers reconnect. Guests keep the previous per-device connection. Recovery, Strain and Conditioning are Pocket estimates implemented in Scores.java and src/client/scores.js. See Movement for their inputs.

Photo zines save automatically in account-scoped IndexedDB. Existing guest books retain their original database. A zine holds up to 40 photos with reversible print treatments, order, captions and crop options. Download a reading PDF or an A5 print booklet to retain or share a copy. Signed in, zines and their photos sync to the account; a zine waits until its photos have uploaded.
