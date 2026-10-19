import { activeAccount, tabStorage as sessionStorage } from './workspace-storage.js';
import { cached, status as credentialStatus, save as saveCredential, forget as forgetCredential } from './pip-credentials.js';
// Reads one journal page with Claude and turns the answer into a note, like JournalReader.java.
// A signed-in key is encrypted on the account and added by Pocket's relay; guests keep the tab key.
import { journal, notes, parkThought, thought, receipt, KIND, NOTE_LIMIT } from "./store.js";

export const MODEL = "claude-sonnet-5-5";
const INPUT_PRICE = 2.0, OUTPUT_PRICE = 10.0, MAX_TOKENS = 8000;
const API = "https://api.anthropic.com/v1/messages", KEY = "pocket:claude-key";
const PROVIDER = { provider: "anthropic", baseUrl: "https://api.anthropic.com/v1" };
const TIME = /(\d{1,2})[:.](\d{2})/, TODO_TITLE = /\b(todos?|to-?dos?|aufgaben|tasks?|erledigen)\b/i;
export const PROMPT = "Transcribe this photo of a handwritten journal page. Write exactly what is on the paper; do not correct, translate or complete anything.\n\n"
  + "Rules:\n"
  + "- Transcribe only the page(s) actually written on. Ignore text showing through from the back of the paper (faint, mirrored) and small scraps of a neighbouring page at the photo edge. A neighbouring page counts only if a real part of it is legible; then make it its own page and end cut words with […].\n"
  + "- Keep every handwritten line as its own line, even if it continues a sentence.\n"
  + "- Braces, brackets or arrows that tie several lines to a note: record them as a group with the indexes of the lines they cover and the note's text. Do not repeat the note as a normal line.\n"
  + "- Put a written date and the printed page number in \"date\" and \"page_number\", not in the lines.\n"
  + "- Mark words you are unsure of in \"uncertain\".\n\n"
  + "Return only JSON, no prose:\n"
  + "{\"pages\":[{\"title\":\"\",\"date\":\"\",\"page_number\":\"\",\"cut_off\":false,\n"
  + "  \"lines\":[{\"text\":\"\",\"sign\":\"dash|arrow|box|bullet|none\",\"ink\":\"black|blue|other\",\"uncertain\":[],\"top\":0.0,\"bottom\":0.0}],\n"
  + "  \"groups\":[{\"lines\":[0,1],\"mark\":\"brace|bracket|arrow\",\"note\":\"\"}]}]}\n"
  + "\"sign\" is the mark at the start of the line, written separately from \"text\". \"top\"/\"bottom\" are the line's vertical position as a fraction of the photo height. Line indexes in \"groups\" count from 0 within the page.";

/** Retry later: offline, Claude busy, or a server hiccup. The page keeps waiting, so the phone can still read it. */
export class Later extends Error { }

const key = () => sessionStorage.getItem(KEY) || "";
const stored = () => activeAccount() ? cached(PROVIDER) : null;
export const hasKey = () => Boolean(key()) || Boolean(stored()?.saved);
/** The last characters of the key, for showing that one is set without showing the key itself. */
export const hint = () => stored()?.saved ? stored().hint || "" : key() ? "…" + key().slice(-4) : "";
/** Loads the account's key state before the first rendered route. */
export async function loadKeyStatus() { if (activeAccount()) await credentialStatus(PROVIDER); }
export async function setKey(value) {
  const text = String(value || "").trim();
  if (!text.startsWith("sk-ant-") || text.length < 30) throw new Error("That doesn't look like a Claude API key (sk-ant-…).");
  if (activeAccount()) await saveCredential(PROVIDER, text);
  else sessionStorage.setItem(KEY, text);
}
export async function clearKey() {
  if (activeAccount()) await forgetCredential(PROVIDER);
  else sessionStorage.removeItem(KEY);
}

/** The page photo as the JPEG Claude reads: long edge 1568 px, the same as JournalStore.forReading. */
async function forReading(blob) {
  let bitmap;
  try { bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" }); }
  catch { throw new Error("The photo could not be opened."); }
  const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const photo = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!photo) throw new Error("The photo could not be converted.");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("The photo could not be read."));
    reader.readAsDataURL(photo);
  });
}

/** Sends the photo and the prompt, and returns Claude's parsed answer with what it cost in cents. */
export async function read(blob) {
  const relay = activeAccount() && (await credentialStatus(PROVIDER)).saved;
  const apiKey = key();
  if (!relay && !apiKey) throw new Error("Add your Claude API key first.");
  const data = await forReading(blob);
  let response;
  try {
    response = await fetch(relay ? "/api/pip/relay" : API, {
      method: "POST",
      headers: relay ? {
        "content-type": "application/json", "x-pocket-provider": "anthropic",
        "x-pocket-endpoint": encodeURIComponent(PROVIDER.baseUrl),
        // If a safety check declines the page, the server retries on a fallback model instead of failing.
        "anthropic-beta": "server-side-fallback-2026-07-01",
      } : {
        "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json",
        // Browsers may call Anthropic directly; the key goes only there. See CLOUD.md.
        "anthropic-dangerous-direct-browser-access": "true",
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      credentials: relay ? "same-origin" : "omit",
      body: JSON.stringify({
        model: MODEL, max_tokens: MAX_TOKENS, output_config: { effort: "low" }, fallbacks: "default",
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
          { type: "text", text: PROMPT },
        ] }],
      }),
    });
  } catch { throw new Later("Offline; try again once the connection is back."); }
  if (response.status === 401) {
    const detail = relay ? await response.text().catch(() => "") : "";
    if (relay && /sign in/i.test(detail)) throw new Error("Sign in to Pocket to read pages.");
    throw new Error("Claude rejected the API key. Check it and try again.");
  }
  if (response.status === 429) throw new Later("Claude is busy; try again in a moment.");
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 400 && /credit/i.test(detail)) throw new Error("Your Claude account has no credit left.");
    if (response.status >= 500) throw new Later("Claude had a problem; try again later.");
    throw new Error("Claude could not read this page (" + response.status + ").");
  }
  const answer = await response.json();
  if (answer.stop_reason === "refusal") throw new Error("Claude declined to read this page.");
  if (answer.stop_reason === "max_tokens") throw new Error("The page was too long to read in one go.");
  const text = (answer.content || []).filter(block => block.type === "text").map(block => block.text).join("");
  let result;
  try { result = parse(text); } catch { throw new Error("Claude's answer could not be understood. Try reading the page again."); }
  const usage = answer.usage || {}, cents = ((usage.input_tokens || 0) * INPUT_PRICE + (usage.output_tokens || 0) * OUTPUT_PRICE) / 1e6 * 100;
  return { result, cents };
}

/** The JSON object in Claude's answer, ignoring any prose around it. */
export function parse(answer) {
  const start = answer.indexOf("{"), end = answer.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No JSON in the answer.");
  return JSON.parse(answer.slice(start, end + 1));
}

/** The written page, not a scrap of its neighbour: the first page that isn't cut off, else the first page. */
function mainPage(result) {
  const pages = result.pages || [];
  if (!pages.length) throw new Error("No page in the answer.");
  return pages.find(page => !page.cut_off) || pages[0];
}

/** The note text for a page, the same as JournalReader.apply: one line per handwritten line, plus its groups. */
export function noteFor(page) {
  const lines = page.lines || [], groups = page.groups || [], title = String(page.title || "").trim();
  const todos = TODO_TITLE.test(title), note = ["# " + (title || "Journal page")];
  const meta = [page.date, page.page_number ? "p. " + page.page_number : ""].map(s => String(s || "").trim()).filter(Boolean).join(" · ");
  if (meta) note.push("_" + meta + "_");
  const kept = []; let inItem = false;
  lines.forEach((line, i) => {
    const text = String(line.text || "").trim(), sign = line.sign == null ? "none" : String(line.sign);
    // One note line per handwritten line, so each line can show its strip of the photo. Continuations indent under their item.
    const noteLine = !text ? "" : i === 0 && text === title ? note[0]
      : sign !== "none" ? (todos ? "- [ ] " : "- ") + text : inItem ? "  " + text : text;
    if (noteLine === note[0]) { kept.push({ text, note_line: noteLine, sign, top: +line.top || 0, bottom: +line.bottom || 0 }); return; }
    if (noteLine) { note.push(noteLine); inItem = sign !== "none" || inItem; }
    kept.push({ text, note_line: noteLine, sign, ink: line.ink || "black", uncertain: line.uncertain || [], top: +line.top || 0, bottom: +line.bottom || 0 });
  });
  // A brace like "ab 16:30" becomes a thought that comes back at that time; any other note is kept as text.
  for (const group of groups) {
    const items = (group.lines || []).map(i => lines[i]).filter(Boolean).map(line => shortItem(line.text));
    if (!items.length) continue;
    const label = String(group.note || "").trim(), time = TIME.exec(label);
    if (time) note.push(">> " + items.join(", ") + " @" + String(Number(time[1])).padStart(2, "0") + ":" + time[2]);
    else if (label) note.push("_" + label + ": " + items.join(", ") + "_");
  }
  return { text: note.join("\n"), lines: kept, groups, title: title || "Journal page", date: String(page.date || ""), page_number: String(page.page_number || "") };
}
/** "Kartone entsorgen" → "Kartone entsorgen"; long items are cut so the thought stays one readable line. */
const shortItem = text => { const value = String(text || "").trim(); return value.length > 40 ? value.slice(0, 39) + "…" : value; };

/** Turns Claude's answer into a note and marks the page done, like JournalReader.apply. */
export function apply(page, result, cents) {
  const read = mainPage(result), note = noteFor(read);
  const existing = page.note ? notes.get(page.note) : null;
  const saved = existing ? notes.edit(page.note, current => { current.text = note.text.slice(0, NOTE_LIMIT); }) : notes.create(note.text);
  for (const line of saved.text.split("\n")) { const item = thought(line); if (item) parkThought(saved.uid, item); }
  journal.edit(page.uid, p => Object.assign(p, {
    state: "done", error: "", title: note.title, date: note.date, page_number: note.page_number,
    lines: note.lines, groups: note.groups, note: saved.uid, model: MODEL, cents: Math.round(cents * 100) / 100,
  }));
  receipt.log(KIND.PHOTO, note.title);
  return saved;
}
