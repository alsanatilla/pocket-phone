# Pocket 0.15.0

Pip’s daily brief appears on the phone’s Home and Today pages and on browser Today. Tap its heading to see every fact; tap a fact to open the saved task, appointment, thought or workout behind it. Recovery readings link to Movement and show their date or cache age, with stale readings labelled.

**Think with Pip** in the browser, or **ask Pip** on the phone, starts a new unsent draft with the current brief. Your other conversations and drafts stay intact. Press Send when you want a reply using your configured provider and key. Reading the brief needs neither a key nor an internet connection.

To hide it, open the brief and choose **disable brief** in the browser, or **Settings → turn off** on the phone. That choice syncs with your Pocket account. The existing Today tile layout remains yours; **+ add tile → daily brief** adds a shortcut to the full brief.

This release includes `pocket-phone-0.15.0-unsigned.apk` (version code 42), full and web source archives, this guide, `BUILD-STATUS.json` and `SHA256SUMS.txt`.

The APK needs signing by the release agent. Updating an installed Pocket app while retaining local data requires the existing signing certificate.

Android and Astro production builds passed. Focused verification used synthetic local data and an isolated local database; the full test suite and lint were skipped as requested. No physical handset was attached, so hardware behavior remains unverified.
