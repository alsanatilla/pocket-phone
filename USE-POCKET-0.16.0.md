# Pocket 0.16.0

Setting up Pocket is now one page instead of four separate places. **Set up Pocket** goes through the connections in order: your account, linking the phone, COROS, then Pip. Each step shows whether it is connected, skipped or next. The page always opens at the first open step.

**In the browser:** open the reminder on Today, or **Apps → Set up Pocket**. Sign in or create the account directly on the page. For the phone step, open setup on the phone, tap **link this phone**, and type the code it shows. **Connect COROS** opens COROS sign-in and brings you back to setup. For Pip, choose **free models** (OpenRouter) or **Claude**, paste the key and save.

**On the phone:** tap **set up** next to the pocket wordmark on Home, or open **Settings → set up pocket**. **Link this phone** shows a code to type in the browser where you are signed in; **sign in or create with email** works without a browser. Setup returns once the phone is signed in and synced. COROS connects once for the whole account, so a connection made in the browser already counts on the phone.

Any step can be skipped (**no phone right now**, **no COROS watch**, **later**) and reopened with **ask again**. Once every step is connected or skipped, the reminder disappears. You can also hide it early: **hide** on browser Today, or hold the reminder on the phone.

Pip keys still stay on each device. The phone stores its key encrypted; the browser keeps it for the open tab and asks again in a new tab. Other providers remain under Pip’s own settings (**another provider**).

This release includes `pocket-phone-0.16.0-unsigned.apk` (version code 43), full and web source archives, this guide, `BUILD-STATUS.json` and `SHA256SUMS.txt`.

The APK needs signing by the release agent. Updating an installed Pocket app while retaining local data requires the existing signing certificate.

Android and Astro production builds passed. Browser setup was checked end to end against an isolated local database with a fictional account; the phone screen was checked with a new Robolectric preview test. The full test suite and lint were skipped. No physical handset was attached, so on-device behaviour remains unverified.
