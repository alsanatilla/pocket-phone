# Pocket Phone

Pocket 0.19.0 is a native launcher and personal workspace for the Nothing Phone (3a), with an Astro browser app hosted on [Vercel](https://pocket-phone.vercel.app/). Warm Console connects both with cream monospace text, quiet color, pixel artwork and Pip's console sprite. Pip can research across permitted Pocket content and the web, show a plan, and prepare editable proposals for new records or changes to existing ones, applied only after your approval. The workflow is **capture → decide → plan → act → review**. See [WORKFLOW.md](WORKFLOW.md) for each app’s purpose and connections.

**Today, Thoughts, Tasks and Notes** share a workspace. Thoughts stay undecided until you choose an action. Notes hold context; Tasks hold chosen actions. On the phone a task can reserve time in Pocket Calendar, start Focus and record completion in Activity. Movement and Gym stay separate. Camera leads to Photos; Paper leads to source-linked Notes; selected messages can lead to Tasks.

Edits save locally first. A Pocket account syncs Thoughts, Tasks, Notes, Paper, Activity, Dice lists, Gym, Calendar, Clock, drafts and shared settings through the Astro API and libSQL/Turso. Phone and browser use the same account. Existing phone Drive connections remain available, and the browser can import a Drive workspace. Calls, messages, contacts and Camera photos stay on the phone. Pip chats and browser photo zines sync to the same account, and COROS readings are kept on the server with a daily background refresh. See [CLOUD.md](CLOUD.md) for setup, migration, merge rules and backup scope.

Use **sign in** on another device; **create account** is a separate choice. Passkeys are sign-in keys attached to one Pocket account, and that account can have several keys. Password sign-in remains available. The phone can show a short code for approval in a signed-in browser, and the account screen can sign out other device sessions. Search finds Notes, Tasks, Thoughts, Paper and Pip on phone and web; phone appointments are searched locally. Signed-in Notes also offer version history and 30-day deleted-note recovery.

Pip uses matching Pocket visuals on phone and web, with an upper-corner pixel glow and a small console-inspired mascot. Actual tool/search activity has queries, status, results and citations. Read-only Pocket access and Anthropic search start off and can be enabled from the composer. Keeping a reply as a Note, Thought or Task remains an explicit action. See [PIP.md](PIP.md).

Shared headers, typography, rows, controls and Back conventions connect the apps. See [DESIGN.md](DESIGN.md), [CAMERA.md](CAMERA.md), [APP-STATUS.md](APP-STATUS.md) and [release notes](RELEASES.md).

**Today** starts with three COROS-derived stat bars, then the next appointment, chosen/due actions, ready thoughts and customizable tiles. Add, remove and reorder tiles directly; their layout syncs. Thoughts only become tasks when you choose that action. **Pip’s daily brief** stays available from Apps and as an optional tile. It works offline without an AI key and links back to its sources; **think with Pip** prepares a fresh unsent conversation.

## Web development and deployment

Use Node 22.12 or newer:

~~~sh
npm ci
cp .env.example .env
npm run dev
~~~

Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the ignored .env file. The same two names must exist in the Vercel project’s Production environment. They are read only by server code; never prefix them with PUBLIC_. Optional BETTER_AUTH_SECRET gives session signing its own stable secret. See [CLOUD.md](CLOUD.md).

~~~sh
npm run db:setup
npm run build
~~~

Vercel builds from the repository root using vercel.json and the Astro adapter. Source lives in src/client, src/styles, src/pages, src/shared and src/server; static fonts and the offline worker live in public. GitHub Pages now provides a migration page for exporting the old origin’s workspace.

## Android build and downloads

Use JDK 17 and Android SDK 35. Set the SDK path in an untracked local.properties, or open the project in Android Studio.

~~~sh
./gradlew :app:assembleRom
~~~

The normal output is app/build/outputs/apk/rom/app-rom-unsigned.apk. This is a launcher/app build, not a full ROM image; Android owns Recents and system Home gestures.

[GitHub Releases](https://github.com/alsanatilla/pocket-phone/releases) includes the unsigned APK, web source, complete source, checksums and build status. Another release agent handles signing. The existing certificate is needed to update an installed Pocket app while retaining its local data. See [USE-POCKET-0.19.0.md](USE-POCKET-0.19.0.md).

The Astro production build and Android APK build passed. Focused checks cover agent budgets, parallel reads, permission-aware resume, proposal approval and persistence, native chat UI and phone/browser codecs. Browser flows exercise streamed research, editable proposals, Continue/Restart and two-way account sync on a throwaway local database, with layouts at 320–1280 px. Model/search traffic was simulated. The full suite and lint were skipped as requested; actual checks and limits are recorded in [BUILD-STATUS.json](BUILD-STATUS.json). Handset behavior remains unverified.

Original code is MIT licensed. Dependency notices are in [THIRD_PARTY.md](THIRD_PARTY.md), third_party and the native Settings license screen. The visual starting point was Dumb.co’s public phone screen; its software and services are not included.
