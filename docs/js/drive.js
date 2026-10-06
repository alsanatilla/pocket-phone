// Google Drive appDataFolder over fetch. Same files and lookup rule as CloudSync.java:
// always use the oldest file with a name, so the phone and the web agree if both ever created one.
import { CLIENT_ID } from "./config.js?v=20261006-080";

const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const DRIVE = "https://www.googleapis.com/drive/v3/files", UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
let token = sessionStorage.getItem("pocket:token"), expires = Number(sessionStorage.getItem("pocket:expires") || 0);

export class Expired extends Error { constructor() { super("Drive access expired. Connect again."); } }
export const configured = () => Boolean(CLIENT_ID);
export const connected = () => Boolean(token) && Date.now() < expires - 60_000;
export const remembered = () => localStorage.getItem("pocket:connected") === "1";

function gis() {
  return new Promise((resolve, reject) => {
    let tries = 0;
    (function wait() { if (window.google?.accounts?.oauth2) resolve(window.google.accounts.oauth2); else if (++tries > 100) reject(new Error("Google sign-in did not load.")); else setTimeout(wait, 100); })();
  });
}
/** Must run from a click or key press: browsers block the Google window otherwise. */
export async function connect(quiet = false) {
  if (!configured()) throw new Error("Add the web client id to docs/js/config.js first (see CLOUD.md).");
  const oauth = await gis();
  return new Promise((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE,
      callback: answer => {
        if (answer.error) { reject(new Error("Drive access was not granted.")); return; }
        token = answer.access_token; expires = Date.now() + Number(answer.expires_in || 3600) * 1000;
        sessionStorage.setItem("pocket:token", token); sessionStorage.setItem("pocket:expires", String(expires)); localStorage.setItem("pocket:connected", "1");
        resolve();
      },
      error_callback: () => reject(new Error("The Google window was closed.")),
    });
    client.requestAccessToken({ prompt: quiet ? "" : "consent" });
  });
}
export async function disconnect() {
  const old = token; token = null; expires = 0;
  sessionStorage.removeItem("pocket:token"); sessionStorage.removeItem("pocket:expires"); localStorage.removeItem("pocket:connected");
  if (old) { try { (await gis()).revoke(old, () => {}); } catch { /* local sign-out still applies */ } }
}

async function http(method, url, body, type) {
  if (!connected()) throw new Expired();
  const response = await fetch(url, { method, body, headers: { Authorization: "Bearer " + token, ...(type ? { "Content-Type": type } : {}) } });
  if (response.status === 401 || response.status === 403) { token = null; sessionStorage.removeItem("pocket:token"); throw new Expired(); }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Drive answered " + response.status + ".");
  return response.text();
}
async function fileId(name) {
  const q = encodeURIComponent(`name='${name}'`);
  const list = JSON.parse(await http("GET", `${DRIVE}?spaces=appDataFolder&orderBy=createdTime&fields=files(id)&q=${q}`) || "{}");
  return list.files?.[0]?.id || null;
}
export async function read(name) {
  const id = await fileId(name); if (!id) return null;
  const body = await http("GET", `${DRIVE}/${id}?alt=media`);
  return body && body.trim() ? JSON.parse(body) : null;
}
/** A binary file from the app folder, such as a journal photo; null if it isn't there (yet). */
export async function readBlob(name) {
  const id = await fileId(name); if (!id) return null;
  if (!connected()) throw new Expired();
  const response = await fetch(`${DRIVE}/${id}?alt=media`, { headers: { Authorization: "Bearer " + token } });
  if (response.status === 401 || response.status === 403) { token = null; sessionStorage.removeItem("pocket:token"); throw new Expired(); }
  if (!response.ok) return null;
  return response.blob();
}
/** Uploads a new image into the app folder, for example a journal page photo. Images are never overwritten. */
export async function writeImage(name, blob) {
  if (!connected()) throw new Expired();
  const boundary = "pocket" + Date.now();
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: ["appDataFolder"] })}\r\n`
    + `--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`, blob, `\r\n--${boundary}--\r\n`]);
  const response = await fetch(`${UPLOAD}?uploadType=multipart&fields=id`, { method: "POST", body,
    headers: { Authorization: "Bearer " + token, "Content-Type": `multipart/related; boundary=${boundary}` } });
  if (response.status === 401 || response.status === 403) { token = null; sessionStorage.removeItem("pocket:token"); throw new Expired(); }
  if (!response.ok) throw new Error("Drive answered " + response.status + ".");
}
export async function write(name, doc) {
  const json = JSON.stringify(doc), id = await fileId(name);
  if (id && (await http("PATCH", `${UPLOAD}/${id}?uploadType=media`, json, "application/json; charset=UTF-8")) !== null) return;
  const boundary = "pocket" + Date.now();
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: ["appDataFolder"] })}\r\n`
    + `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${json}\r\n--${boundary}--\r\n`;
  await http("POST", `${UPLOAD}?uploadType=multipart&fields=id`, body, `multipart/related; boundary=${boundary}`);
}
