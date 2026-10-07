# Pocket 0.18.0 — Pip agent

Open Pip from its navigation sprite. **tools** grants access to Notes, Tasks, Thoughts, Calendar, Gym or the saved COROS cache. **web** enables search and page reading, including with OpenRouter. Provider and optional Firecrawl keys stay on the device.

Ask a concrete question that needs research. Pip can show a plan, search permitted sources, inspect tasks, read longer notes/pages and compare results over several rounds. Expand activity for actual status, parameters, sources and cached reads.

**review note**, **review task** or **review appointment** opens an editable proposal. Save creates it; cancel creates nothing. Tasks accept due dates and steps. Calendar accepts date/time and duration. **open saved …** returns to the record. Repeating approval on another device uses the same record.

Stop preserves completed research. **continue** resumes it; **restart** begins again. Configure a provider key on each device before continuing there. Use the same Pocket account to sync conversations, observations, proposals, approval markers and saved records.

Research is bounded: eight continuations, 20 client calls, eight web calls, 48,000 characters of tool data and five minutes. The configured reply token limit covers the whole run. Tools never automatically save, edit or complete Pocket content; Thoughts remain undecided until you choose an action.

Downloads include the APK (version code 45), web and full source archives, build status and checksums. The APK is **unsigned** for the signing agent. Retaining local data when updating requires the existing signing certificate.

Android and Astro builds and focused native/browser checks passed. Model/search traffic was simulated; the sync check used a throwaway local database. No physical handset was attached. The full test suite and lint were skipped as requested.
