# Pocket Android 0.19.1

The APK in this release is **unsigned**. The signing agent must sign it with Pocket's existing release certificate before it can update an installed app and retain its local data. Version code is 48; package remains `org.textphone.launcher`; Android 7/API 24 or later is required.

After installing the signed update, open **Movement**. Existing local COROS readings and the linked Pocket account are retained. With a Pocket account, COROS authorization and the saved cockpit come from the existing Vercel/Turso service. No new environment variables or setup are needed.

- Tap a score ring for its history, health inputs or training/fitness trends.
- Open any activity for its route, recorded charts and expandable splits/metrics. Charts share one cursor; tap the reading below them to return to averages.
- Pull down to refresh the workspace and COROS readings. Previously opened complete activities work offline; the local detail cache retains 20 activities. Evicted activities remain in the archive.
- Without a connection or existing readings, Movement shows explicitly marked sample data. Samples are never synced or stored as your own readings.

Complete decoded details use the same private account cache as the browser. Signed FIT download URLs and COROS credentials are not included in that cache.

The release includes the full source snapshot, APK, checksums and `BUILD-STATUS.json`. Android build and 35 focused checks passed, including API 24/35 and responsive native layouts. No physical handset or live COROS account was used for verification; the full suite and lint were skipped.
