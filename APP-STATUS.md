# App status — Pocket 0.11.0

Pocket is a launcher and native apps on Nothing OS, plus an Astro browser workspace on [Vercel](https://pocket-phone.vercel.app/). Android owns system gestures and Recents. The connections between apps are described in [WORKFLOW.md](WORKFLOW.md).

| App | Available behavior | Current limit |
| --- | --- | --- |
| Home / Today | App access, capture, appointments, next actions and Movement readings. | Launcher gestures and everyday handset behavior need physical verification. |
| Thoughts | Keep undecided ideas, revisit them or explicitly make a source-linked task. | A revisit time does not create an action or deadline. |
| Tasks | Dates, importance, steps, source context and chosen next action; native reminders, planned time and Focus. | Calendar and reminder handles remain local to the phone. |
| Notes | Markdown, pins, drafts, Paper links and chosen actions; signed-in history and deleted-note recovery on phone and web. | 8,000 characters per note. History retains up to 60 checkpoints; deleted recovery covers 30 days. |
| Search | Notes, Tasks, Thoughts, Paper and Pip across local records and the signed-in account; phone appointments and installed apps are local results. | Account search needs a network; offline search uses saved local records. |
| Account | Separate sign-in/create-account flows, passkeys, password fallback, browser-approved phone codes and revocable device sessions. | Email verification and password-reset mail are not configured. Physical passkey and phone-link prompts need device verification. |
| Calendar / Agenda | Local appointments, editing, durations, reminders and links back to their chosen tasks. | No shared account calendar or recurring appointment rules. |
| Focus / Clock | Explicit focus sessions, alarms, named timers, stopwatch and snooze. | Exact alarms and notifications need Android permission; overnight and restart behavior need handset checks. |
| Contacts | Android address-book search/editing and call/SMS handoff. | Contact permission is required; account-backed contacts follow Android's own sync. |
| Phone / Messages | Dialer, call controls, SMS inbox, messenger notifications and selected-message task capture. | Native roles/permissions required. No complete messenger history or RCS; actual calls and delivery need handset checks. |
| Camera / Photos | Native capture, six compact-camera treatments, output size/aspect/quality and Pocket's camera album. | Physical camera/flash/orientation and image quality remain unverified; profiles are approximations. |
| Paper | Original handwritten pages, positioned transcripts and linked Notes; private account photo sync. | Reading sends the selected page to Anthropic with the user's key; it incurs provider cost. |
| Pip | Phone/browser conversations, drafts, selected context, tool/search activity and explicit Note/Thought/Task actions. Chats sync to the account. | Provider keys stay on each device. Live provider and handset animation checks remain outstanding. |
| Movement | Account-persisted COROS readings, reconnect and scheduled background refresh. | COROS authorization may require reconnecting; Pocket scores are estimates. |
| Gym | Multiple exercises per workout, set logging, rest timer, volume, history and account sync. | Estimated strength statistics depend on the entered sets. |
| Activity | Deliberate Pocket actions, completed tasks and personal lines. | Not a device-wide activity monitor; retention is 30 days. |
| Zines | Browser photo books with captions, order, print treatments, crop options, PDF export and account photo sync. | Browser only, up to 40 photos per book. |
| Calculator / Dice | Arithmetic and reusable history; dice, coin and a synced pick list. | Dice roll history stays local; Calculator is not scientific. |
| Settings / app groups | Home selection, shortcuts/groups, Android permission handoff and storage connections. | Protected Android settings remain under Android's control. |

Edits save locally first. A Pocket account shares Thoughts, Tasks, Notes, Paper, Activity, Dice lists, Gym, Pip chats, browser zines and COROS readings. Legacy phone Drive sync remains available. Calls, SMS, contacts, appointments, alarms, Camera album photos and provider keys are outside Pocket account sync. [CLOUD.md](CLOUD.md) describes migration and the seven-collection JSON backup; that backup excludes chats, zines and photo bytes.

The test suite is skipped as requested. Astro production and Android APK builds passed. Browser previews with fictional data verified account creation/sign-in, history restore, deleted-note recovery and search, including opening a newer server-only note. Isolated API checks verified authentication, owner isolation, origin checks, phone linking, session revocation and invalid restore requests. No physical Nothing Phone or authenticator verification has been performed. [BUILD-STATUS.json](BUILD-STATUS.json) records actual results. The 0.11.0 APK has version code 37 and is unsigned for the signing agent; updating an installed app while retaining data requires its existing certificate.
