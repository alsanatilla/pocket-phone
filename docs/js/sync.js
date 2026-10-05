// Edits save locally first and are marked waiting; they upload when the browser is online and connected.
import * as drive from "./drive.js";
import { FILES, load, save, merge, clean, dirty, onChange } from "./store.js";

export const status = { state: "idle", last: Number(localStorage.getItem("pocket:last-sync") || 0), error: "" };
const listeners = new Set();
export const onStatus = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn(status));
let running = null, timer = 0;

export function describe() {
  const waiting = dirty().size;
  if (!drive.configured()) return "WEB ONLY · NOT SET UP";
  if (!navigator.onLine) return waiting ? `OFFLINE · ${waiting} WAITING` : "OFFLINE";
  if (!drive.connected()) return waiting ? `NOT CONNECTED · ${waiting} WAITING` : "NOT CONNECTED";
  if (status.state === "syncing") return "SYNCING…";
  if (status.state === "error") return "SYNC FAILED · " + status.error.toUpperCase();
  if (waiting) return `${waiting} WAITING`;
  return status.last ? "SYNCED " + new Date(status.last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "CONNECTED";
}

/** Download, merge into the local copy, upload the merged copy. One run at a time. */
export function syncNow() {
  if (running) return running;
  if (!navigator.onLine || !drive.connected()) { emit(); return Promise.resolve(false); }
  running = (async () => {
    status.state = "syncing"; status.error = ""; emit();
    try {
      for (const name of FILES) {
        const remote = await drive.read(name), merged = merge[name](load(name), remote, Date.now());
        save(name, merged); await drive.write(name, merged); clean(name);
      }
      status.state = "idle"; status.last = Date.now(); localStorage.setItem("pocket:last-sync", String(status.last));
      return true;
    } catch (error) {
      status.state = error instanceof drive.Expired ? "idle" : "error"; status.error = error instanceof drive.Expired ? "" : (error.message || "error");
      return false;
    } finally { running = null; emit(); }
  })();
  return running;
}
export function soon(delay = 1500) { clearTimeout(timer); timer = setTimeout(syncNow, delay); }

onChange(() => { emit(); soon(); });
addEventListener("online", () => soon(0));
addEventListener("offline", emit);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") soon(0); });
// Pick up phone edits while the page stays open.
setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 60_000);
