# Daily productivity audit — Pocket 0.5.13

Pocket is a launcher with native companion apps on Nothing OS. It is not a compiled system ROM. This audit reviews code and automated Android checks; no Nothing Phone (3a) is attached.

The useful productivity priorities are connected workflows: see what matters today, turn captured information into an action without losing its origin, plan time realistically, then find and resume work. Recovery supports those workflows; it is not the entire productivity plan.

## This companion-app increment

The existing apps have real implementations; the current increment closes everyday gaps in Clock, Agenda, Notes, Contacts, Calculator and Files. Existing alarms can be edited, timers have presets/labels, appointments have editable duration/end times, notes can be pinned, contact edits are recoverable, calculator results behave predictably, and Camera photos can be browsed without returning to the list. Messages prioritizes actual active conversations and keeps its transport shortcuts at the bottom. Phone entry is larger and preserves insertion position.

APP-STATUS.md distinguishes working local flows from Android consent/provider dependencies and real handset verification. There are no new permissions, accounts, automatic message archives or network APIs.

## Retained connected workflows

- **A useful Today:** a current/next appointment above tasks, capture and on-demand search. Home opens the exact next task and shows the next appointment. An explicitly chosen undated Next task remains visible in the Today filter. Calendar data comes from local records and the selected native phone calendar.
- **Capture to action:** Notes and Preview have Task; message/notification More has Make task; Android Share offers Pocket Task. Each capture keeps a selected source snapshot/reference and its own draft. Source opens its origin when available; Markdown export includes its text. Twenty unfinished captures remain until saved or explicitly discarded.
- **Connected reminders:** one-shot task alarms retain a task ID through reschedule and snooze. Completion/deletion cancels linked alarms without deleting appointments. Reopening needs an explicit new reminder. Save failures retain the task/draft and explain the retry path. Due dates by themselves still do not ring.
- **Space and setup:** 24 sp titles, 48 dp font-aware headers, less top padding, and individual app setup behind Settings. Camera setup moves off the viewfinder. Dashboard Settings remains available.

Notes wheel, Markdown editing/preview, route-aware Back, local appointments/drafts, active messaging/replies, task steps, priority, focus timers and editable app shortcuts are retained. No extra permissions or Internet access are added. Message transport still belongs to installed messaging apps; Make task stores only the selected source, not automatic message history.

## Swipe up briefly shows Nothing Home

The reported gesture is **swipe up to Home**, not opening the notification shade. Two different parts are involved:

1. Android must select Pocket as the default Home app. Open Pocket Settings → Use as home screen. The value should read **Active**. Otherwise select Pocket in Android's Home dialog and return; the value is read from Android, not saved as a local preference.
2. Nothing's system gesture/overview component runs the transition into a third-party Home app. Selecting Pocket as Home does not replace that component. AOSP's [FallbackSwipeHandler](https://android.googlesource.com/platform/packages/apps/Launcher3/+/refs/heads/main/quickstep/src/com/android/quickstep/FallbackSwipeHandler.java) explicitly handles gestures when a third-party launcher is default; its Home animation launches that app. [TouchInteractionService](https://android.googlesource.com/platform/packages/apps/Launcher3/+/refs/heads/main/quickstep/src/com/android/quickstep/TouchInteractionService.java) owns the gesture service. These sources establish the architecture; they do not prove a specific Nothing OS defect.

0.5.9 removes Pocket's extra Home animation and hardens its own surface. **The remaining Nothing-launcher flash is not confirmed fixed on the handset.** If Active is shown and the flash remains, it may occur in Nothing's gesture animation before Pocket is shown. A regular APK cannot take ownership of privileged system Recents. A complete replacement would require supported system integration and a tested ROM.

To identify the boundary on the phone, try returning Home from Pocket Notes, from Pocket Camera, and from an unrelated app such as the browser. Compare swipe up with Android's three-button navigation. If only gesture navigation shows the flash, that points to the system transition; if the final Home is Nothing, the default Home choice needs correction. These checks require no extra Pocket permissions or disabling the stock launcher.

## What is still missing

| Priority | Gap in the present workflow | Next useful increment | Acceptance check |
| --- | --- | --- | --- |
| 1 | **Recurring work and reminder recovery.** Task reminders are now connected but one-shot. Missed reminders have no unified inbox; task recurrence and notification-based completion are absent. | Recurring rules with explicit local-time/DST behavior, missed-reminder review and Complete/Snooze actions. | Completion cannot rearm an old occurrence; repeated delivery/reboot creates one next occurrence; missed work remains findable. |
| 2 | **Planning actual time.** Appointments now have editable 1–1440-minute durations. Tasks still have no estimates or protected time blocks. Native calendar changes display correctly but are not fully reconciled into local records. | Task estimates, then explicit time blocking with conflicts. Reconcile stable provider links without overwriting pending edits. | Day boundaries, ongoing/multi-day events, overlaps and external moves/deletes display once and preserve local unsaved work. |
| 3 | **Finding and resuming work.** Task/note search is local and separate from appointments, sources and draft captures. Notes now have pinning; tags and projects remain absent. | Unified search/resume view and light project links across notes, tasks and appointments. | A word from a captured source finds the task; unfinished notes/tasks are reachable without replacing another draft. |
| 4 | **User-controlled recovery.** Markdown exports readable tasks, notes and captured sources, but there is no full restore operation. Android backup is disabled. | Versioned local backup via Android’s document picker, validated before restore. Keep native contacts/SMS/calendars and Camera photos separate. | A corrupt/newer unsupported backup changes nothing; a clean restore retains record IDs, drafts and tile labels, and rearms only valid future alarms. |
| 5 | **Daily handset dependability.** Calls, carrier messaging, real notification replies, camera sessions, overnight alarms, battery management and Nothing’s gesture animation are not verified on the phone. | Install this signed update; test actual services and fix concrete handset failures in small releases. | Real incoming/outgoing calls/SMS, photos, a locked-screen alarm, reboot scheduling and notification replies work on the configured SIM/account. |

## Next release order

After handset feedback, add recurring/missed reminders, then unified search/resume and backup/restore. Projects and time estimates should follow when those basic workflows are dependable. Avoid expanding setup on the app’s first screen.

## Source evidence

`DayPlan`, `CalendarBridge`, `MainActivity`, `TaskCaptureActivity`, `CaptureDrafts`, `TaskSource`, `TaskReminderActivity`, `TaskReminders`, `ClockStore`, `AlarmService` and `RingingActivity` implement this increment. `TaskWorkflowTest`, `TaskReminderFlowTest`, `DayPlanTest`, `CompactWorkspaceTest`, `PlanningLayoutTest` and existing native-provider/permission/message/navigation tests cover the automated scope. Native rendering fixtures are documented separately from physical handset evidence in BUILD-STATUS.json.
