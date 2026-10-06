# Pocket 0.6.0 signed update

1. Download `pocket-phone-0.6.0.zip` and extract it using Android Files.
2. Open `pocket-phone-0.6.0.apk`. If Android asks, allow this file-opening app to install apps.
3. Choose **Update**. Keep the existing Pocket installation; uninstalling deletes its local data.
4. Open Pocket. Choose it as your default Home app if Android asks.

Version 0.6.0, version code 28, package `org.textphone.launcher`, Android 7 or newer. Signed with Pocket's existing release key, matching 0.5.18. This updates the launcher and apps on the current Nothing OS.

The signed APK contains the unchanged contents of the published unsigned APK. The original signature, version, checksum, archive integrity and 16 KiB alignment checks passed. No Android permissions were added; Calendar now uses local records and no longer requests calendar-provider permissions.

The development agent skipped the final functional test suite and lint. Earlier test results predate the final UI. Physical phone behavior and live accounts have not been checked here. The signing report distinguishes the performed release checks from earlier development checks.
