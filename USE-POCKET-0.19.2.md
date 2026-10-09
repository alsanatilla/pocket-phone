# Pocket Android 0.19.2

This update fixes fullscreen in the native launcher, Today, Pocket apps, Pip, and Camera. Previously the launcher reset system UI flags and other screens hid only the status bar, leaving the navigation bar visible.

The APK is **unsigned**. The signing agent must use Pocket's existing release certificate before it can update an installed app and retain its data. Package remains `org.textphone.launcher`; version code is 49; Android 7/API 24 or later is required.

After installing the signed update:

- Open Home or Today, then another Pocket screen and return. Both system bars should stay hidden.
- Swipe from a screen edge to temporarily reveal Android navigation.
- Open a note or Pip, show the keyboard, then dismiss it. Controls should stay above the keyboard and reclaim the bottom space afterward.
- Open and dismiss a dialog or permission prompt, and return from another app. Pocket should restore fullscreen.
- Check Camera and landscape. The background should reach the screen edges while controls remain clear of the camera cutout.

No account migration or permission changes are needed. Verification and APK checksums are recorded in `BUILD-STATUS.json`; no physical handset was connected.
