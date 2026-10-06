# Pocket 0.8.0

Open the [web workspace](https://alsanatilla.github.io/pocket-phone/).

In Pip, choose **□ tools** to enable the Pocket sources it may read. Notes, undecided Thoughts, chosen Tasks, Gym and cached COROS readings have separate switches. Access starts off and applies to the selected API provider/endpoint. These tools only read saved records; keep note, park thought and make task remain your own choices. Browser reads use its local/synced records. COROS reads use the existing Movement cache, never a refresh or its authentication details.

For Anthropic, **△ web** enables provider web search. Searches and reads appear above the reply with their actual status; expand the activity to inspect queries, result summaries and source links. Clickable citations accompany sourced answers. Completed activity folds into a compact line, separate from provider reasoning. Compatible endpoints can use Pocket function tools; their generic chat adapter does not offer web search. An unsupported model, account or endpoint shows an error.

Pip retains the upper-only pixel glow, with geometric console signals and a new tiny-gamepad routine shared by phone and web. Animations pause when hidden or reduced motion is enabled.

The release includes `pocket-phone-0.8.0-unsigned.apk` (version code 33), a web archive, source archive, build status and checksums. The APK must be signed by the release agent before installation. Use the existing signing certificate to update an installed Pocket app while retaining local data.

The test suite is skipped as requested. Isolated stream/SDK fixtures made no paid API requests or user-data changes. Live browser preview requires authentication and the phone interface was not rendered. Compilation, verification limits and the APK checksum are in `BUILD-STATUS.json`.
