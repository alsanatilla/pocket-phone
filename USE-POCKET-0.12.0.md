# Pocket 0.12.0

Open the [web workspace](https://pocket-phone.vercel.app/). In **Apps → Account & devices**, enter your email and password for your existing account. **Sign in with passkey** is optional. **Create account** is a separate action. A passkey is a sign-in key attached to the account; adding another key does not create another workspace.

On the phone, open **Settings → storage & devices → link this phone**. Open the supplied browser link, or enter its code at [Pocket’s link page](https://pocket-phone.vercel.app/link). Sign in to the same account and approve the code. The phone receives its own session. Password sign-in remains available, and **Devices** can sign out another session.

Search finds Notes, Tasks, parked Thoughts, Paper and Pip on phone and web. Saved local records remain searchable offline; phone appointments stay local. Signed-in Notes expose **history** in the editor and **recently deleted** in the notes list. History keeps up to 60 checkpoints and preserves the text replaced during a restore. Deleted-note recovery covers 30 days and creates a new note.

Thoughts, Tasks, Notes, Paper, Activity, Dice lists, Gym and Pip chats sync between phone and browser. Zines and their photos sync between browsers. COROS readings persist in the account, refresh while Pocket is open, hourly from the phone and daily in the background. Provider keys, appointments and native communication data stay on their device.

Vercel uses the existing TURSO_DATABASE_URL and TURSO_AUTH_TOKEN production settings. No new key or environment variable is required. Keep the production URL stable for passkeys. [CLOUD.md](CLOUD.md) covers setup, account access, migration and backup limits.

The release has six artifact types:

- **pocket-phone-0.12.0-unsigned.apk** — Android app, version code 38.
- Astro web source archive — browser app and server source.
- Full source archive — Android and web project.
- **BUILD-STATUS.json** — compilation and verification results.
- **USE-POCKET-0.12.0.md** — this guide.
- **SHA256SUMS.txt** — artifact checksums.

Another agent handles APK signing. Installing over an existing Pocket app while retaining its local data requires the existing signing certificate.

The test suite is skipped as requested. Astro production and Android APK builds passed. Browser previews with fictional data verified account creation/sign-in, history restore, deleted-note recovery and global search. Isolated API checks verified private-route authentication, account isolation, phone linking, revocation, origin checks and invalid restore requests. Physical passkey prompts and handset behavior remain unverified; [BUILD-STATUS.json](BUILD-STATUS.json) records actual results.

Pull down at the top of any page to sync now. On Today, choose "edit tiles" (phone) or "tiles" (browser) to add, remove and reorder the tiles; the layout syncs between devices.
