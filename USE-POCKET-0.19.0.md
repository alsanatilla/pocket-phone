# Pocket 0.19.0 — Pip changes what you already have

Open Pip from its navigation sprite. **tools** grants access to Notes, Tasks, Thoughts, Calendar, Gym or the saved COROS cache. **web** enables search and page reading, including with OpenRouter. Provider and optional Firecrawl keys stay on the device.

Ask a concrete question that needs research. Pip can show a plan, search permitted sources, inspect tasks, read longer notes/pages and compare results over several rounds. Expand activity for actual status, parameters, sources and cached reads.

**review note**, **review task** or **review appointment** opens an editable proposal for a new record. Save creates it; cancel creates nothing.

Pip can also prepare a change to something you already have. Tell it "the ferry is booked", "push the dentist to Thursday" or "add this to my Lisbon note". **update task**, **complete task**, **add to note** or **move appointment** appears under the reply. **review change** shows the record as it is now, Pip's reason and the change, all editable. The button applies it; cancel changes nothing. Afterwards the card opens the changed record. Applying again, here or on another device, gives the same result. Changing tasks needs Tasks access, notes need Notes and appointments need Calendar.

Stop preserves completed research. **continue** resumes it; **restart** begins again. If the final answer fills its budget or the connection times out, partial work remains available for **continue**. Configure a provider key on each device before continuing there. Use the same Pocket account to sync conversations, observations, proposals, approval markers and saved records.

Research is bounded: eight continuations, 20 client calls, eight web calls, 48,000 characters of tool data and five minutes. The configured reply token limit covers the whole run. Tools never save, edit or complete Pocket content on their own; Thoughts remain undecided until you choose an action.

Downloads include the APK (version code 47), web and full source archives, build status and checksums. The APK is **unsigned** for the signing agent. Retaining local data when updating requires the existing signing certificate.

Android and Astro builds passed, along with browser change and agent checks, the review flow in Edge and the full Android unit suite: 558 cases, where the only failures are six cases that already failed on 0.16.0. Model traffic was simulated. No physical handset was attached.
