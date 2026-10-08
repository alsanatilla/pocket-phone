import { storage as localStorage } from './workspace-storage.js';
// Edits save locally first and are marked waiting; they upload when the browser is online and connected.
import * as cloud from "./cloud.js";
import { FILES, load, save, merge, clean, dirty, onChange } from "./store.js";
import { waiting } from './persistence-events.js';
import { syncObjects } from './object-sync.js';
import * as coros from './coros.js';
import { applyDocument } from './extras.js';
import { syncPaperPhotos } from './paper-store.js';
import * as travel from './travel-store.js';

export const status = { state: "idle", last: Number(localStorage.getItem("pocket:last-sync") || 0), error: "" };
const listeners = new Set();
export const onStatus = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn(status));
let running = null, timer = 0;

export function describe() {
  const pending = dirty().size + waiting() + travel.pendingCount();
  if (!cloud.configured()) return "LOCAL";
  if (!navigator.onLine) return pending ? `OFFLINE · ${pending} WAITING` : "OFFLINE";
  if (!cloud.connected()) return pending ? `SIGN IN · ${pending} WAITING` : "SIGN IN";
  if (status.state === "syncing") return "SYNCING…";
  if (status.state === "error") return "SYNC FAILED · " + status.error.toUpperCase();
  if (pending) return `${pending} WAITING`;
  return status.last ? "SYNCED " + new Date(status.last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "CONNECTED";
}

/** Download, merge into the local copy, upload the merged copy. One run at a time. */
export function syncNow() {
  if (running) return running;
  if (!navigator.onLine) { emit(); return Promise.resolve(false); }
  running = (async () => {
    status.state = "syncing"; status.error = ""; status.changed = false; emit();
    try {
      // A cached shell can open offline before the session has been read.
      // Re-read it on reconnect, and retry after a temporary startup failure.
      if (!cloud.connected()) await cloud.init();
      if (!cloud.connected()) { status.state = "idle"; return false; }
      const failures=[];
      for (const name of FILES) {
        try {
        const sent = load(name), received = await cloud.exchange({[name]:sent},true);
        const local = load(name), remote = received[name]?.value;
        if (!remote) throw new Error('Pocket returned an incomplete workspace.');
        const unchanged = JSON.stringify(local) === JSON.stringify(sent);
        const merged = unchanged ? remote : merge[name](local, remote, Date.now());
        // Only a merge that changed the local copy needs a redraw; otherwise focus and scroll stay put.
        if (JSON.stringify(merged) !== JSON.stringify(local)) status.changed = true;
        save(name, merged);
        if(name==='drafts.json'||name==='preferences.json')applyDocument(name);
        // An edit made during the request stays queued. Only acknowledged contents are clean.
        if (unchanged || JSON.stringify(merged) === JSON.stringify(remote)) clean(name);
        }catch(error){if(error instanceof cloud.Expired)throw error;failures.push(error.message);}
      }
      for(const operation of [syncPaperPhotos,syncObjects,()=>coros.syncAccount(),async () => { const changed = await travel.syncTravel(); const state = travel.readStatus(); if (state.state === 'signed-out') { await cloud.init(); throw new cloud.Expired(); } if (state.state === 'error') throw new Error(state.error || 'Travel sync failed.'); return changed; }])try{status.changed=Boolean(await operation())||status.changed;}catch(error){if(error instanceof cloud.Expired)throw error;failures.push(error.message);}
      if(failures.length)throw new Error([...new Set(failures)].join(' · '));
      status.state = "idle"; status.last = Date.now(); localStorage.setItem("pocket:last-sync", String(status.last));
      return true;
    } catch (error) {
      status.state = error instanceof cloud.Expired ? "idle" : "error"; status.error = error instanceof cloud.Expired ? "" : (error.message || "error");
      return false;
    } finally { running = null; emit(); if ((dirty().size || waiting()) && cloud.connected() && status.state !== 'error') soon(); }
  })();
  return running;
}
export function soon(delay = 1500) { clearTimeout(timer); timer = setTimeout(syncNow, delay); }

onChange(() => { emit(); soon(); });
travel.subscribe(emit);
addEventListener('pocket-persistence-change', () => { emit(); soon(); });
addEventListener("online", () => soon(0));
addEventListener("offline", emit);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") soon(0); });
// Pick up phone edits while the page stays open.
setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 60_000);
