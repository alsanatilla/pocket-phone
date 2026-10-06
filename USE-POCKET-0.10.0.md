# Pocket 0.10.0

Open the [web workspace](https://pocket-phone.vercel.app/). The app now runs on Astro with a private libSQL/Turso API while retaining Pocket’s existing design, tabs, Pip glow and tool activity.

In **Apps → storage & devices**, create a Pocket account or sign in. Use the same email/password on the phone in **Settings → Storage & devices**. Thoughts, Tasks, Notes, Paper, Activity, Dice lists, Gym, Pip chats and zines sync between them. Edits stay available locally when offline. Provider keys and native communication/calendar data stay on their device.

Connect COROS in **Movement** while signed in. The connection then belongs to your account: readings refresh while Pocket is open, hourly from the phone and once a day in the background, and they stay visible if COROS asks you to reconnect.

For Vercel, set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the project’s Production environment, then redeploy. Neither value belongs in the browser or Git. [CLOUD.md](CLOUD.md) covers setup, existing Drive import, old GitHub Pages export and backup limits.

The release includes pocket-phone-0.10.0-unsigned.apk (version code 36), Astro web source, full source, build status and checksums. Another agent must sign the APK before installation. The existing signing certificate is needed to update an installed Pocket app without clearing its data.

The test suite is skipped as requested. Astro and Android builds and isolated account/sync checks are recorded in BUILD-STATUS.json. The supplied real database connection was checked with additive schema setup; fixture accounts and photos used a temporary local database. Live browser rendering and handset behavior remain unverified.

Offline startup also resumes sync without a page reload when the network returns. Failed reconnects keep edits queued for retry.
