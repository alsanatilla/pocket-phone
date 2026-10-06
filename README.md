# Pocket Phone

Pocket 0.7.1 is a native launcher and personal workspace for the Nothing Phone (3a), running on its current Nothing OS. The workflow is **capture → decide → plan → act → review**. See [WORKFLOW.md](WORKFLOW.md) for every app’s purpose, connections and one complete journey.

Home shows what matters now and opens communication, capture, Today, pip and Apps. **Today, Thoughts, Tasks and Notes** share a workspace. Thoughts stay undecided until you explicitly make a task; Notes keep context; Tasks hold chosen actions. A task can reserve time in Pocket Calendar, start Focus for that exact action and record completion in Activity. Camera leads to Photos; Paper leads to source-linked Notes; selected messages can lead to Tasks. Supporting apps are grouped by purpose, and custom shortcuts remain reachable.

Data saves locally first. **Drive remains the optional sync transport**, with the same Thoughts, Tasks and Notes workflow on the [web](https://alsanatilla.github.io/pocket-phone/). Shared collections include Paper, Activity, Dice lists and Gym workouts. Pip works in both places with matching Pocket visuals, attached context and explicit keep actions; chats stay local to each device. Calendar, reminders/timers, calls, messages, contacts and Camera photos stay on the phone. Pocket Calendar uses its own local storage and does not read or write Google Calendar. See [CLOUD.md](CLOUD.md) for account setup and the exact sync scope.

All apps use shared headers, typography, rows, controls and Back conventions. See [DESIGN.md](DESIGN.md), [CAMERA.md](CAMERA.md), [PIP.md](PIP.md), [APP-STATUS.md](APP-STATUS.md) and the historical [release notes](RELEASES.md).

Home and Today have a static dithered sky that fades into Pocket black. Pip has a full-height pixel glow with rings rising behind the composer and a bloom in the top corner. The original artwork uses the same pixel pattern on phone and web; working lists and editors retain their plain backgrounds.

This is a launcher/app build, not a full ROM image. Android owns Recents and system Home gestures. The local 0.7.1 APK is unsigned for the release agent to sign. Handset behavior and live accounts/providers have not been verified here. Actual build results are in [BUILD-STATUS.json](BUILD-STATUS.json).

## Downloads

Builds are available in [GitHub Releases](https://github.com/alsanatilla/pocket-phone/releases). The 0.7.1 artifact is unsigned for signing by the release agent. Earlier signed APKs can be installed over Pocket to retain local data. See [USE-POCKET-0.7.1.md](USE-POCKET-0.7.1.md) for this build.

Each release labels its signing status and includes its APK, source archive, checksums and build status. Signing keys and local SDK settings are excluded from this repository.

## Build and verify

Use JDK 17 and Android SDK 35. Set the SDK path in an untracked `local.properties`, or open the project in Android Studio.

```sh
./gradlew :app:assembleRom :app:lintRom :app:testRomUnitTest :app:testDebugUnitTest
```

The unsigned ROM prebuilt is `app/build/outputs/apk/rom/app-rom-unsigned.apk`; the Android ROM build signs it. Published signed releases update earlier Pocket Phone previews while retaining local app data. It runs on the current OS; a full ROM image has not been compiled.

Automated tests exercise native provider operations, multipart SMS state, concurrent compose/navigation/permission/SIM flows, MMS storage/failure cleanup, contacts, local calendar isolation, exact timer scheduling, Camera-only album ownership and migration, real notification connection/dismissal, SMS role/access return handling, task metadata migration and draft persistence, Markdown selection/continuation/preview, touch target sizes, permission status, arithmetic, navigation intents and camera processing/storage. Native Android UI rendering tests write screenshots to `app/build/screenshots`; their sample data is not included in the APK. Live cellular calls, carrier SMS/MMS delivery, Google account synchronization, hardware controls, overnight alarms and gesture animations remain unverified on the Nothing Phone (3a). The download's `BUILD-STATUS.json` records the latest check counts and outstanding device work.

Original code and the Anthropic SDK are MIT licensed. Markwon, AndroidX, OkHttp, Okio, Kotlin and Jackson use Apache 2.0; commonmark-java uses BSD. Google Play services libraries use the Android SDK License. Dependency licenses/notices are in `third_party`, embedded in the APK and available in device settings → Open source licenses. VT323 is under the SIL Open Font License in `third_party/VT323-OFL.txt`. The Gradle wrapper carries its own Apache 2.0 license. PhoneIcon contains original drawings. The visual starting point was Dumb.co's public phone screen; its software and services are not included.

For the companion-app and Today/Agenda PNG fixtures, use `./gradlew -I tools/render-layouts.gradle :app:renderRomLayouts` after the full checks. This runs the native API 28 render fixtures in their own JVM and writes a separate test report, retaining the full-suite reports. Running many SDK sandboxes in the same Robolectric JVM can leave native text rendering caches incomplete; the isolated previews are the review artifacts. They are not physical handset recordings.

To render one fixture in a fresh JVM, add `-PrenderCase=org.textphone.launcher.DailyPolishPreviewTest.messageFeedComesFirstAndTransportCommandsStayAtTheBottom`. Select complete reviewed renderings for release previews; native font caches can omit repeated static text across unrelated fixture screens. This is a renderer limitation, not handset validation.
