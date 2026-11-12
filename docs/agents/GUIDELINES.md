# Working in Pocket: rules for a delegated agent

You are given one task from `docs/agents/durable-chat.md` or a task brief. Read this file first, then your task, then
the files your task names. Do exactly that task.

## What Pocket is

A personal app (notes, tasks, today, and Pip, an assistant that chats and runs jobs). Astro 7 + React 19, Turso/libSQL,
one Node server on Fly.io that runs the web process (`services/server/web.mjs`) and a worker (`services/pip/worker.mjs`).
How a message to Pip travels is described in `docs/pip-message-flow.md`. Read the sections your task touches.

Layout you need:

| Folder | Holds | Rule |
|---|---|---|
| `src/shared/` | pure logic used by browser and server | no Node APIs, no DOM, no database |
| `src/server/` | database, runs, jobs, events | never imported by browser code |
| `src/client/` | Pip's engine in plain JS (`.js` with a `.d.ts` beside it when TypeScript imports it) | runs in the browser and on the server |
| `src/app/` | React UI (TypeScript) | no business logic that the server also needs |
| `tools/*.test.mjs` | Node tests (`node --test`) against a real libSQL file and a fake provider | |
| `src/**/*.test.ts(x)` | vitest tests for the React app | |

## Hard rules

1. **Stay inside your task.** Change only the files the task lists. If the task cannot be done without touching
   another file, stop and say so in your report. Do not "improve" nearby code, rename things, or reformat.
2. **Open source first, chosen by the lead.** Pocket uses an existing open-source library before building a piece
   by hand; your brief names the library and its version when one is to be used. You do not add a dependency on your
   own: if you see a library that would do your task better than writing it, stop and say so in your report. No
   framework swaps (no Preact and the like), no state library, no ORM.
3. **No fallbacks and no second way.** If something exists already (a merge function, an event hub, a block format),
   use it. Search before you write: `grep -rn "name" src tools`. Do not add a compatibility branch "just in case".
4. **Never weaken a check to get green.** Do not delete, skip or loosen an existing test, do not catch-and-ignore an
   error, do not add `// @ts-ignore` or `any`. If an existing test fails because of your change, your change is wrong
   or the task is; report it.
5. **Tests come with the code.** Every behaviour the task lists has a test that fails without your change. Tests use
   the real database file and real modules; fake only the model provider (see `tools/pip-provider-fixtures.mjs`).
6. **Secrets.** Never print, log or commit a key, a token or anything from `.env`. Never read `.env` unless the task
   says so.
7. **Nothing leaves the machine.** Do not push, do not deploy (`flyctl`), do not open pull requests, do not touch the
   production database. Commit only if your task says so, and only your own files.
8. **Anything a person sees follows `docs/DESIGN.md`.** Read it before a UI task. Fonts, colours, spacing and
   wording stay as they are unless the task names the change; what you build passes the guide's review (section 21)
   on a phone-size picture, and your report says which screens you looked at and which you did not.

## How code is written here

- Plain ES modules. Server and shared code is JavaScript with JSDoc where a type helps; the app is TypeScript.
- Each module starts with a comment that says what it is for and why it exists. Each exported function has one line
  that says what it does. Comments explain why, not what the next line does. Match the density of the file you edit.
- Names are plain words for what the thing is (`appendEvents`, `chatAt`), not patterns (`EventManager`, `handleData`).
- SQL goes through `execute` / `database().transaction('write')` from `src/server/database.js`, always with
  `args`, never string-built values. Tables are created in the list in `src/server/database.js`
  (`CREATE TABLE IF NOT EXISTS`); a new column on an existing table needs the migration pattern used in that file.
- Every query that reads or writes a person's data filters by `user_id`. A function that takes a `userId` never
  trusts an id from the request body instead.
- Writes that must agree happen in one transaction. Anything that can be retried (a request sent twice, a job that
  ran twice) must give the same result the second time: use a unique key, not a check-then-insert.
- Errors a person will see are sentences that say what happened and what to do. Internal errors carry a `code`.
- Text shown to the person is plain and short, in the voice of the existing UI. No exclamation marks, no emoji.

## Before you report

Run all four and read the output. The only failure allowed is the one that exists already:
`relay validates situations before sending and preserves typed provider replies and rate limits`.

```
npm run typecheck
npx vitest run
npm run test:tools
npm run build
```

If a command fails for a reason you cannot fix inside your task, stop and report the output. Do not retry the same
thing more than twice.

## Your report (last message)

1. What you changed, file by file, one line each.
2. The exact result line of each of the four commands.
3. Every place where you deviated from the task or made a decision the task did not make, and why.
4. What you did not do or could not verify.

Say plainly when something is unfinished. A report that claims more than was done is worse than an unfinished task.
