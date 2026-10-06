# Pocket Phone

Pocket 0.9.0 is a native launcher and personal workspace for the Nothing Phone (3a), with an Astro browser app hosted on [Vercel](https://pocket-phone.vercel.app/). The workflow is **capture → decide → plan → act → review**. See [WORKFLOW.md](WORKFLOW.md) for each app’s purpose and connections.

**Today, Thoughts, Tasks and Notes** share a workspace. Thoughts stay undecided until you choose an action. Notes hold context; Tasks hold chosen actions. On the phone a task can reserve time in Pocket Calendar, start Focus and record completion in Activity. Movement and Gym stay separate. Camera leads to Photos; Paper leads to source-linked Notes; selected messages can lead to Tasks.

Edits save locally first. A Pocket account syncs Thoughts, Tasks, Notes, Paper, Activity, Dice lists and Gym through the Astro API and libSQL/Turso. Phone and browser use the same account. Existing phone Drive connections remain available, and the browser can import a Drive workspace. Calendar, reminders, calls, messages, contacts and Camera photos stay on the phone. Pip chats and photo zines remain device-local. See [CLOUD.md](CLOUD.md) for setup, migration, merge rules and backup scope.

Pip uses matching Pocket visuals on phone and web, with an upper-corner pixel glow and a small console-inspired mascot. Actual tool/search activity has queries, status, results and citations. Read-only Pocket access and Anthropic search start off and can be enabled from the composer. Keeping a reply as a Note, Thought or Task remains an explicit action. See [PIP.md](PIP.md).

Shared headers, typography, rows, controls and Back conventions connect the apps. See [DESIGN.md](DESIGN.md), [CAMERA.md](CAMERA.md), [APP-STATUS.md](APP-STATUS.md) and [release notes](RELEASES.md).

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

[GitHub Releases](https://github.com/alsanatilla/pocket-phone/releases) includes the unsigned APK, web source, complete source, checksums and build status. Another release agent handles signing. The existing certificate is needed to update an installed Pocket app while retaining its local data. See [USE-POCKET-0.9.0.md](USE-POCKET-0.9.0.md).

The test suite is skipped at the user’s request. Android and Astro compilation, isolated storage/API checks and the real libSQL connection are recorded in [BUILD-STATUS.json](BUILD-STATUS.json). Browser preview requires authentication, and handset behavior remains unverified.

Original code is MIT licensed. Dependency notices are in [THIRD_PARTY.md](THIRD_PARTY.md), third_party and the native Settings license screen. The visual starting point was Dumb.co’s public phone screen; its software and services are not included.
