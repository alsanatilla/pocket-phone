# Pocket 0.20.0 signed update

1. Download `pocket-phone-0.20.0.zip` and extract it using Android Files.
2. Open `pocket-phone-0.20.0.apk`. If Android asks, allow this file-opening app to install apps.
3. Choose **Update**. Keep the existing Pocket installation; uninstalling deletes its local data.
4. Open Pocket. Choose it as your default Home app if Android asks.

Version 0.20.0, version code 50, package `org.textphone.launcher`, Android 7 or newer. Signed with Pocket's existing release key, matching 0.19.2. This updates the launcher and apps on the current Nothing OS.

The signed APK contains the unchanged contents of the published unsigned APK. The original signature, version, checksum, archive integrity and 16 KiB alignment checks passed. No Android permissions were added or removed compared with 0.19.2.

The merged live-tile code passed 65 focused checks across debug and ROM variants; lint found no errors and 130 warnings. Two existing search-test names failed on the previous main as well. The initial debug run included three failing variants of those names and three ignored legacy layout cases. The full suite was not run. Physical phone behavior and live accounts have not been checked in this signing step. The signing report records the checks performed for this download.

Optional account sync: use Settings → Storage & devices on the phone and the same Pocket account at https://pocket-phone.vercel.app/. Thoughts, Tasks, Notes, Paper, Activity, Dice lists and Gym sync. Pip chats and other device-local data keep their existing limits; see the upstream usage guide and build report.
