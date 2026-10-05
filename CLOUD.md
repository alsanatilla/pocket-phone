# Cloud sync and Pocket on the web

Cloud sync is **off by default**. When you turn it on in Settings → Cloud sync, Pocket copies these to a hidden app folder (`appDataFolder`) in your own Google Drive:

| File | Contents |
|---|---|
| `parking.json` | Parking Lot items, open and closed in the last 7 days |
| `receipt.json` | Receipt lines of the last 30 days |
| `dice.json` | The Dice pick list |
| `notes.json` | Notes from Today, with pins; deleted notes stay as markers for 30 days |
| `tasks.json` | Task titles, completion, due dates, importance, checklist progress, chosen next task and selected source text; deletion markers last 30 days |
| `journal.json` + `page-<uid>.jpg` | Journal pages: the photo, its transcript lines with their position on the photo, and the linked note |

Task reminders, editor drafts, notification handles, messages, contacts, calls and Pocket Camera album photos stay on the phone. Only the source text explicitly selected when creating a task is included with it. Journal page photos are included when cloud sync is enabled. The hidden folder is only visible to Pocket's own Google Cloud project; it does not show up in Drive.

Every local change asks Android for a sync job that waits for any network, so edits made offline upload once the phone is online again. A periodic job also picks up web edits every hour, and opening a Pocket app syncs at most every two minutes. This is why the APK now declares `INTERNET` and `ACCESS_NETWORK_STATE`. With cloud sync off, no Drive sync is scheduled. Journal transcription is a separate optional network feature, enabled by entering an Anthropic key in Journal settings.

In 0.5.15, **Sync now** runs directly while Cloud sync is open, without waiting for Android's background scheduler. It shows **Syncing…**, then a last-sync time or a persistent error. Google sign-in also starts the first sync immediately. Code 10 identifies a Google OAuth setup mismatch and shows the installed build's signing fingerprint; code 7 identifies a network failure. Background failures update the open Cloud sync page as well.

## Movement on the phone

Open **Settings → Movement · COROS** or tap the movement line on Home, then **Connect COROS**. Sign in on the COROS page in your browser and return to Pocket. Pending sign-in survives closing and recreating the activity; **Check sign-in** resumes it.

The phone uses COROS's public-client PKCE and browser login-session flow, as shipped by its `coros-mcp` CLI. Tokens and pending login are encrypted with an Android Keystore key. The phone reads 90 days of activities and recent resting heart rate, nightly HRV and daily health data. Home uses a private cached snapshot and refreshes it in the background on return, at most every 15 minutes. Older snapshots keep their date. No movement data or tokens are sent to Google Drive or placed in the public repository. Phone and browser have separate connections.

Recovery, Strain and Conditioning are Pocket estimates, based on the formulas in `Scores.java` and `docs/js/scores.js`. They are not Bevel or COROS scores. Tap a score to see its inputs and calculation note. Disconnect removes the phone's tokens, pending login and cached readings.

The web page in [`docs/`](docs/) is a workstation for Parking Lot, notes, Receipt and Dice in Pocket's terminal style: numbered tool tabs, two-column layouts on wide windows and one column on phones. It keeps its own copy in the browser, works offline, and uploads waiting edits when it is online and connected.

## Photo zines on the web

The **zines** tab makes black-and-white pocket photobooks from selected photos. On your phone, select images from the Pocket Camera album using **+ photos**; on desktop, use the file picker or drop images into an open zine. Each book holds up to 40 photos. The first photo also becomes the cover. Use the arrows beside photos to arrange them, add captions, and choose a full-photo black frame or a cropped page. The default **deep dark · smooth** treatment preserves photographic midtones and gently darkens them; **soft silver** keeps a natural grayscale. **photocopy grain** and **hard ink** are optional graphic print treatments. All treatments are reversible.

Read the book in the browser with page buttons, swipes or arrow keys. **reading PDF** downloads individual A6 pages. **print booklet** arranges A6 pages on A5 landscape sheets, adds any needed blank pages inside the covers, and downloads a PDF ready to print at 100%, double-sided with a short-edge flip. Fold the stack in half and staple.

Books and their photo copies save automatically in this browser's IndexedDB, without an account or API key. They are separate from Drive sync and the Android app. Download a PDF to keep or share a copy; clearing site data removes the editable books. Photos are normalized to JPEG at up to 2000 pixels on the long edge, while print treatments are applied only when rendering the book. Deleting a photo or zine also deletes its stored image data.

## Merge rule

Both sides use the same rule (`SyncMerge.java` and `docs/js/store.js`):

- Parking items: per `id`, the copy with the later `updated` wins. Closed items older than 7 days are dropped on every copy.
- Receipt lines never change, so a day is the union of both copies by line id `i`. Days older than 30 days are dropped.
- Dice list: the later `updated` wins.
- Notes: per `uid`, the later `updated` wins; a deletion is a note with `deleted: true` and also wins if it is newer. The phone keeps its own small note ids and maps them to the random `uid`.
- Tasks: the same `uid`/`updated` rule, including completion and checklist steps. Titles, due dates, importance and source snapshots travel together. The chosen next task has a separate timestamp and portable task `uid`. Local drafts and live source handles are retained. Downloading a completed/deleted task cancels its local reminders; importing or reopening a task never creates an alarm. The browser preserves the task document; the task interface is native on the phone.
- Thoughts in notes: a note line starting with `>>` (optionally ending in `@1h`, `@tonight`, `@tomorrow` or `@nextweek`) parks a Parking item that keeps the note's `uid` in `note`. Its id is `9000000000000000 + FNV-1a("uid
line")` on both sides, so the phone and the web create the same item. A new line parks when the note is saved on the phone, or once the cursor leaves the line on the web. The note text is never rewritten; the previews show each thought's state.
- If a file exists twice, both sides use the one created first.

Change both implementations together.

## One-time setup

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and enable the **Google Drive API**.
2. Configure the **OAuth consent screen**: type *External*, add the scope `https://www.googleapis.com/auth/drive.appdata` and add your own Google account as a test user. In *Testing* status Google may ask you to approve access again after a while; publishing the app for personal use avoids that but shows an "unverified app" notice.
3. Create an **Android** OAuth client: package `org.textphone.launcher` and the SHA-1 of the key that signs your APK:
   ```sh
   keytool -list -v -keystore your-release.keystore -alias your-alias
   ```
   Debug and release keys have different fingerprints; add a client for each key you install. The signed 0.5.14 APK retains the existing release certificate, SHA-1 `57651e7742d17aa12af0e1c823bd5f73759e9dbf`.
4. Create a **Web application** OAuth client in the same project. Add these authorized JavaScript origins:
   - `https://alsanatilla.github.io`
   - `http://localhost:8777` (optional, for local testing)
5. Put the web client id into [`docs/js/config.js`](docs/js/config.js). A client id is not a secret.
6. Publish `docs/` with GitHub Pages: repository **Settings → Pages → Deploy from a branch → `main` / `/docs`**. GitHub Pages for a **private** repository needs a paid GitHub plan; otherwise publish `docs/` from a separate public repository and update `CloudSync.WEB` and the origin in step 4.

The Android app needs no client id in code: Google matches the package name and signing key.

### Account selection returns to Pocket without connecting

A **Web application** OAuth client is sufficient for the browser, but the phone also needs an **Android** OAuth client in the same project. Keep the web client and add the Android client with package `org.textphone.launcher` and the installed APK's signing SHA-1. For the signed 0.5.14 and 0.5.17 releases, it is `57:65:1E:77:42:D1:7A:A1:2A:F0:E1:C8:23:BD:5F:73:75:9E:9D:BF`. A build signed with a different key needs its own matching client. See [Google's Android authorization setup](https://developer.android.com/identity/authorization).

Version 0.5.19 reads Google's returned authorization status even when Android reports a cancelled activity. Code 10 shows the installed certificate fingerprint and identifies an OAuth registration mismatch; code 16 or a missing result means authorization did not finish and does not establish that the user cancelled. Pocket enables sync only after Google returns an access token and grants its Drive app-data scope.

## Local preview

Serve `docs/` with any static server, for example `npx serve docs -l 8777`, and open `http://localhost:8777/`.

When publishing web changes, bump the shared `?v=` asset version in `docs/index.html` and the imports in `docs/js/` together so browsers fetch the complete new version.

## Journal pages

Journal (a Pocket app you can put on a tile) keeps photos of paper journal pages. Each page is read once by **Claude Sonnet 5.5** with the user's own Anthropic API key, entered in Journal → Settings and stored only on the phone, encrypted with the Android Keystore. Reading costs about 1–2¢ per page; pages photographed offline wait and are read once the phone is online. A waiting page can also be read from the web page, where the key is typed for that tab alone.

Sonnet 5.5 was chosen in a comparison on real handwriting (German cursive, two inks, bleed-through, a brace): it read about 98–100% of the words and placed every line on the photo, where Claude Haiku 4.5 got about three quarters of the words right. The instructions are in `JournalReader.PROMPT`.

Pages can also be added on the web: "+ page" in the notes tab (or dropping photos onto it) uploads the photo to Drive as a waiting page. Opening the page offers **read with Claude**: the browser calls Anthropic directly (the `anthropic-dangerous-direct-browser-access` header) with the key typed for that tab and kept in `sessionStorage`, so it disappears when the tab closes and is never committed or sent anywhere else. If you don't read the page there, the phone fetches the photo and reads it on its next sync as usual. A read that fails only because the network or Claude is busy leaves the page waiting, so the phone can still pick it up.

Each page becomes a note. One note line per handwritten line, so each line keeps its position on the photo (`note_line`, `top`, `bottom`); a page titled "Todos" becomes `- [ ]` items, and a brace with a time such as "ab 16:30" becomes a thought line `>> … @16:30` that parks itself until then. The photo stays the original: on the phone, tap a line of the page to unfold its strip of handwriting, or switch to "paper"; on the web, notes read from a page get "paper" and a ▸ per line in preview.

Thought lines also accept a clock time: `@16:30` comes back at the next 16:30.
