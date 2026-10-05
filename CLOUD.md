# Cloud sync and Pocket on the web

Cloud sync is **off by default**. When you turn it on in Settings → Cloud sync, Pocket copies three things to a hidden app folder (`appDataFolder`) in your own Google Drive:

| File | Contents |
|---|---|
| `parking.json` | Parking Lot items, open and closed in the last 7 days |
| `receipt.json` | Receipt lines of the last 30 days |
| `dice.json` | The Dice pick list |

Tasks, notes, messages, contacts, calls and photos stay on the phone. The hidden folder is only visible to Pocket's own Google Cloud project; it does not show up in Drive.

Every local change asks Android for a sync job that waits for any network, so edits made offline upload once the phone is online again. A periodic job also picks up web edits every hour, and opening a Pocket app syncs at most every two minutes. This is why the APK now declares the `INTERNET` permission. With sync off, Pocket makes no network requests.

The web page in [`docs/`](docs/) shows Parking Lot, Receipt and Dice in the same terminal style. It keeps its own copy in the browser, works offline, and uploads waiting edits when it is online and connected.

## Merge rule

Both sides use the same rule (`SyncMerge.java` and `docs/js/store.js`):

- Parking items: per `id`, the copy with the later `updated` wins. Closed items older than 7 days are dropped on every copy.
- Receipt lines never change, so a day is the union of both copies by line id `i`. Days older than 30 days are dropped.
- Dice list: the later `updated` wins.
- If a file exists twice, both sides use the one created first.

Change both implementations together.

## One-time setup

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and enable the **Google Drive API**.
2. Configure the **OAuth consent screen**: type *External*, add the scope `https://www.googleapis.com/auth/drive.appdata` and add your own Google account as a test user. In *Testing* status Google may ask you to approve access again after a while; publishing the app for personal use avoids that but shows an "unverified app" notice.
3. Create an **Android** OAuth client: package `org.textphone.launcher` and the SHA-1 of the key that signs your APK:
   ```sh
   keytool -list -v -keystore your-release.keystore -alias your-alias
   ```
   Debug and release keys have different fingerprints; add a client for each key you install.
4. Create a **Web application** OAuth client in the same project. Add these authorized JavaScript origins:
   - `https://alsanatilla.github.io`
   - `http://localhost:8777` (optional, for local testing)
5. Put the web client id into [`docs/js/config.js`](docs/js/config.js). A client id is not a secret.
6. Publish `docs/` with GitHub Pages: repository **Settings → Pages → Deploy from a branch → `main` / `/docs`**. GitHub Pages for a **private** repository needs a paid GitHub plan; otherwise publish `docs/` from a separate public repository and update `CloudSync.WEB` and the origin in step 4.

The Android app needs no client id in code: Google matches the package name and signing key.

## Local preview

Serve `docs/` with any static server, for example `npx serve docs -l 8777`, and open `http://localhost:8777/`.
