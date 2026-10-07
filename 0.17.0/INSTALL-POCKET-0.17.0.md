# Pocket 0.17.0 signed update

1. Download `pocket-phone-0.17.0.zip` and extract it using Android Files.
2. Open `pocket-phone-0.17.0.apk`. If Android asks, allow this file-opening app to install apps.
3. Choose **Update**. Keep the existing Pocket installation; uninstalling deletes its local data.
4. Open Pocket. Choose it as your default Home app if Android asks.

Version 0.17.0, version code 44, package `org.textphone.launcher`, Android 7 or newer. Signed with Pocket's existing release key, matching 0.13.0. This updates the launcher and apps on the current Nothing OS.

The signed APK contains the unchanged contents of the published unsigned APK. The original signature, version, checksum, archive integrity and 16 KiB alignment checks passed. No Android permissions were added or removed compared with 0.13.0.

The development agent skipped the final functional test suite and lint. It reports successful Android/Astro builds and isolated sync/account checks. These are not final app test-suite results. Physical phone behavior and live accounts have not been checked in this signing step. The signing report records the checks performed for this download.

Optional account sync: use Settings → Storage & devices on the phone and the same Pocket account at https://pocket-phone.vercel.app/. Thoughts, Tasks, Notes, Paper, Activity, Dice lists and Gym sync. Pip chats and other device-local data keep their existing limits; see the upstream usage guide and build report.
