# Pip worker (detached runs)

Pip's replies can run inside the web request (the default) or on a separate worker process. The worker removes the
request timeout, keeps running when the tab closes, and lets a free-tier or home server do the model work while the
web app stays on Vercel.

There is no external queue service. **Turso is the queue**: `pocket_pip_jobs` holds one row per queued stretch,
`pocket_pip_runs` remains the authority on the reply, and a lease decides which process may write.

## How it works

1. `PIP_RUNS_DETACHED=1` makes `/api/pip/runs` insert the run as `queued` and enqueue a job instead of calling the
   model. The submit answers immediately; the existing SSE endpoint (`/api/pip/runs/stream`) follows the run.
2. A worker calls `workerStep()`: it claims one job (`state = 'leased'`, `lease_until`), adopts the run
   (`queued → running`), and runs exactly one stretch — until the reply settles, pauses for an approval, is stopped,
   or reaches the 150-second research deadline.
3. An approval, a stop and a continuation are still ordinary API calls. A decision makes the run `queued` again, so
   any worker may pick it up. Cross-device behaviour is unchanged.
4. A worker that dies leaves an expired lease. The next worker requeues it (up to `PIP_WORKER_MAX_ATTEMPTS`, default
   3) or fails it. A run left `queued` with no worker at all is failed by the existing sweep after
   `PIP_QUEUE_TTL_MS` (default 30 minutes), so nothing hangs forever.

Idempotency is unchanged: approved writes still derive their record id from the conversation, turn and tool row, so a
retried stretch cannot create a second record.

## Run it

```sh
# .env needs TURSO_DATABASE_URL and TURSO_AUTH_TOKEN; POCKET_ENCRYPTION_SECRET is used when set
npm run worker            # long-lived, with /healthz on :8787
npm run worker:once       # drain the queue and exit (cron / free CI)
```

With Docker:

```sh
docker build -f services/pip/Dockerfile -t pocket-pip-worker .
docker run --env-file .env -p 8787:8787 pocket-pip-worker
```

## Free hosting options

| Option | Shape | Notes |
| --- | --- | --- |
| **GitHub Actions cron** | `npm run worker:once` every 5 minutes | No server. Uses the existing `PIP_*` secrets; a 5-minute job drains the queue. Latency is up to the cron interval. |
| **Home server / Raspberry Pi** | `npm run worker` under systemd or Docker | No cost. Needs outbound HTTPS to Turso and the provider. |
| **Fly.io / Railway / Render free tier** | Docker image, one process | Free allowances can sleep; set `PIP_WORKER_CONCURRENCY=1` and a short `PIP_WORKER_POLL_MS`. |
| **Oracle Cloud / Hetzner** | Docker image | Cheapest always-on option if a free tier is not available. |

Do not expose the worker's port publicly beyond `/healthz`; it makes no authenticated inbound calls and needs no
ingress at all.

## Environment

| Name | Default | Purpose |
| --- | --- | --- |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | — | The same database the web app uses |
| `POCKET_ENCRYPTION_SECRET` (or `BETTER_AUTH_SECRET`) | `TURSO_AUTH_TOKEN` | Opens each account's sealed provider key. Without either, the database token is used, exactly as the web app does. |
| `PIP_WORKER_CONCURRENCY` | `2` | Parallel stretches per process |
| `PIP_WORKER_POLL_MS` | `1000` | Idle poll interval |
| `PIP_WORKER_JOB_LEASE_MS` | `210000` | Claim length; must exceed one stretch |
| `PIP_WORKER_MAX_ATTEMPTS` | `3` | Retries before a job fails |
| `PIP_ROUTINES_EVERY_MS` | `0` (off) | Run scheduled routines from this worker too, instead of a cron calling `/api/jobs/pip`. `60000` checks once a minute. Routine claims already prevent a double run, so the cron can stay |
| `PIP_WORKER_PORT` | `8787` | `/healthz`; `0` disables it |
| `PIP_QUEUE_TTL_MS` | `1800000` | How long a queued run may wait with no usable job before the sweep fails it |

## Rolling back

Unset `PIP_RUNS_DETACHED` in the web app. Runs go back to executing inside the request; the job table is ignored and
can be emptied at leisure.
