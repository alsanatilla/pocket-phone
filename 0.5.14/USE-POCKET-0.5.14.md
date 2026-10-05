# Use Pocket Phone 0.5.14

Download `pocket-phone-0.5.14.apk` and open it on your Nothing Phone (3a). Install it as an update over the existing Pocket app. The package and signing certificate are unchanged; version code 19 allows the update while retaining local data. Do not uninstall first.

Pocket remains a launcher and native app suite running on Nothing OS. Select it under Pocket Settings → Use as home screen if needed. Android handles Home/Recents gestures and sensitive permission approvals.

## New apps and groups

- Hold a Home tile → **Make a group**. The current app becomes its first member. Open the group → **+ add** to add a Pocket or installed app. Hold a member to move/remove it; **rename** changes the group name. Groups hold nine apps. Incomplete rows stay compact.
- Hold a tile → **Pocket app** to choose **dice**, **parking**, **receipt** or **journal** without creating a group.
- **Dice:** roll d6/d20, flip a coin or pick from a newline-separated list. Settings controls shake-to-roll and history.
- **Parking:** capture a thought and choose when it returns. Returned thoughts can be cleared, moved to Today or parked again. A note line such as `>> Call Sam @tomorrow` or `>> Send invoice @16:30` creates a linked Parking item when saved.
- **Receipt:** view Pocket actions by day, add a memo and explicitly share the text receipt.
- **Journal:** photograph or import a paper page. The photo is retained locally. Reading requires your own Anthropic API key in Journal → Settings, sends the page to Anthropic and is billed to your account. Without a key, pages wait locally. Reading creates a linked Markdown note with handwriting strips and any detected time-tagged thoughts.

## Optional online features

Drive sync starts **off**. Settings → Cloud sync requests explicit Google authorization. It syncs notes, Parking, Receipt, Dice lists and Journal pages/photos to Pocket's hidden folder in your own Drive. Tasks, calls, SMS, contacts and the Pocket Camera album are excluded. The APK adds Internet permission for Drive and optional Journal reading; network-state access was already present in the previous APK.

Google authorization needs an Android OAuth client for `org.textphone.launcher` and the release certificate SHA-1 `57651e7742d17aa12af0e1c823bd5f73759e9dbf`. See [CLOUD.md](CLOUD.md) for configuration and the web workstation. This build does not prove that the Google Cloud project is configured for the release key or that GitHub Pages is deployed.

## Android access and validation

Notification access, ordinary notifications, exact alarms, contacts/calendar permissions and default Phone/SMS roles are separate Android approvals. For a sideloaded APK blocked by **Restricted setting**, Android may offer App info → ⋮ → **Allow restricted settings**; approve it there, then return to notification access. Pocket cannot bypass this restriction.

Automated tests cover the merge, local data flows and layouts. Real calls/SMS, journal transcription, Drive authorization, camera capture, overnight alarms and Nothing's Home transition still need checking on the handset. The accompanying build-status and checksum files describe this exact APK.
