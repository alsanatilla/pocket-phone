# Movement: Android and browser

Android 0.19.1 uses the browser's COROS cockpit and activity-detail formats. No new service, API key or database migration is required.

| Capability | Android implementation |
| --- | --- |
| Recovery, Strain, Conditioning | Centered rings, values/status, expandable panels, calculation dialogs and 28-day score histories. Home links open the selected panel and return Home with Back. |
| Recovery inputs | HRV, normal band and baseline; resting HR, average/range; last sleep, stages, score, window and sleep HR. Sleep, HRV, resting HR and stress trends; separate COROS training-recovery. |
| Strain inputs | Workout count, active/everyday TRIMP, target and steps history. |
| Conditioning inputs | Acute/chronic TRIMP, balance, history, short/long COROS load, VO2max, running level, threshold pace and race predictions. |
| Overview | COROS device/update time, reconnect/retry, seven-day distance/time/count/calorie totals and daily distance bars. All archived activities open their own page. |
| Activity instruments | GPS route/start, distance, moving time, pace/speed, climb, average HR and calories. Linked touch/keyboard charts for pace/speed, HR, elevation, cadence, power, contact, oscillation, ratio and step length when recorded. |
| Activity details | Expandable automatic splits, fastest accents and relative-speed bars, HR distribution and every recorded label/value pair. Additional split columns appear only when recorded. |
| Offline and cross-device | Complete opened activities persist locally; browser-produced details load directly. Native-decoded details upload in the same format for browser reuse. Failed uploads remain queued; partial downloads remain retryable. |
| Refresh | Foreground and explicit refresh, existing scheduled job, account/COROS update broadcasts, and pull-to-refresh for workspace sync plus forced COROS refresh. |
| Disconnected preview | Explicit SAMPLE DATA, never written to preferences, uploaded or used on Home. Existing saved readings take priority over previews. |

## Data flow

With a Pocket account, Android reads `/api/coros/state` and refreshes through `/api/coros/refresh`. The existing Vercel service owns COROS authorization and Turso persistence. Its rich `cockpit` and `activities.list` augment the compact `native` snapshot; older snapshots still work.

Standalone connections still use the phone's sealed COROS authorization. They now request optional recovery, fitness, training-load, sleep and device readings as well as score inputs. A failed optional read keeps its previous value; failed mandatory reads preserve the previous complete snapshot.

Activity details use `/api/coros/details/:id`. A shared decoded cache needs no FIT download. Otherwise, the phone downloads the signed COROS file without Pocket authorization headers and decodes route, ascent and sampled channels locally. Signed download URLs are never saved or uploaded. The decoder bounds file/record sizes, handles byte order, developer fields and compressed timestamps, and preserves absent readings as gaps.

The offline cache retains up to 20 complete activities and 2 million JSON characters; an evicted activity remains in the archive and can be reopened online. Each payload is limited to 1 million characters. Account ownership fences cache reads and asynchronous writes. Completed downloads can persist after leaving a page but cannot reopen that page.

## Verification

Focused Robolectric checks cover the browser's text/unit fixtures, canonical cloud and legacy snapshots, scores/history, FIT formats and missing channels, route bounds, detail caching/upload retries/account isolation, offline UI, late completions, score links, rotation, incoming sync, forced pull-refresh and responsive layouts. Native views are rendered at 320/360 dp, landscape and large text. Lifecycle checks run on API 24 and 35. Current Warm Console workspace checks cover the Home score integration.

The older `HomeDashboardTest` still references the removed `home_footer` and previous “all” control; its three cases fail on those obsolete selectors. Focused checks use the current workspace UI. The full suite and lint are skipped as requested.

No handset is attached. COROS/API responses and FIT files in verification are fixtures, not live personal records. Real-device rendering, credentials, background scheduling and installs require handset verification. The published APK is unsigned, as in the existing release workflow.
