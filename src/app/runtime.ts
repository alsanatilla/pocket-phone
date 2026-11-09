import { useSyncExternalStore } from "react";
import * as cloud from "../client/cloud.js";
import * as reader from "../client/reader.js";
import { settings } from "../client/pip-core.js";
import { status as credentialStatus } from "../client/pip-credentials.js";
import { describe, onStatus, status, syncNow } from "../client/sync.js";
import { initExtras } from "../client/extras.js";
import { startClockRuntime } from "../client/planner.js";
import { bumpAll } from "./data/bus.ts";
import { openPath } from "./lib/classic.ts";

// What Pocket does once per page, beside the views: read the account, sync with the server and the phone, apply
// synced preferences, run alarms and timers, and keep the service worker for offline use and notifications.
// sync.js uploads on every local change by itself once it is loaded; this adds the first sync, a sync whenever
// the app comes back (tab shown, connection restored) and a slow heartbeat while it is open.

const HEARTBEAT = 5 * 60_000;
let started = false;

export function startRuntime(): void {
  if (started) return;
  started = true;

  initExtras();
  startClockRuntime();

  cloud.init()
    .then(async () => {
      account.emit();
      await reader.loadKeyStatus().catch(() => {});
      await credentialStatus(settings()).catch(() => {});
      await syncNow();
    })
    .catch(error => console.warn("pocket account", error));

  // A merge that changed local data redraws whatever reads it.
  let last = status.state;
  onStatus(() => {
    if (last === "syncing" && status.state === "idle" && status.changed) bumpAll();
    last = status.state;
    account.emit();
  });

  const again = () => { if (document.visibilityState === "visible") void syncNow(); };
  document.addEventListener("visibilitychange", again);
  addEventListener("online", again);
  setInterval(again, HEARTBEAT);

  if ("serviceWorker" in navigator) {
    if (!import.meta.env.DEV) navigator.serviceWorker.register("/sw.js").catch(() => {});
    // A tapped notification brings Pocket forward and names where to go.
    navigator.serviceWorker.addEventListener("message", event => {
      const data = event.data as { type?: string; href?: unknown } | null;
      if (data?.type === "pocket-open" && typeof data.href === "string" && data.href.startsWith("/")) openPath(data.href);
    });
  }
}

/** Re-renders on account and sync changes. */
const account = (() => {
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    emit() { version++; listeners.forEach(listener => listener()); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    version: () => version,
  };
})();

export interface SyncState { label: string; state: typeof status.state; signedIn: boolean; local: boolean }

/** The sync line for the header: "SYNCED 09:12", "3 WAITING", "SIGN IN", "OFFLINE", "LOCAL". */
export function useSyncState(): SyncState {
  useSyncExternalStore(account.subscribe, account.version, account.version);
  return { label: describe(), state: status.state, signedIn: cloud.connected(), local: !cloud.configured() };
}
