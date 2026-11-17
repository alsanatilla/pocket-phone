import { chatRows, documentRows, localSearch, SEARCH_KINDS, searchWords } from "../../../shared/search.js";
import { load } from "../../../client/store.js";
import { listChats, type Chat } from "../../data/chats.ts";
import { isHome } from "../../data/home.ts";

// What the sidebar finds: chats first, then the rest of what the person keeps, then the pages themselves. The rows
// and the ranking are the classic app's (src/shared/search.js), so one query finds the same things in both.

export type HitKind = "chat" | "note" | "task" | "page";
export interface Hit { kind: HitKind; uid: string; title: string; snippet: string }
export interface Found { chats: Hit[]; notes: Hit[]; tasks: Hit[]; pages: Hit[] }

/** Places a person can go by name from the search field. */
export type PagePath = "/today" | "/notes" | "/tasks" | "/pip" | "/jobs" | "/memory" | "/settings";
const PAGES: readonly { uid: PagePath; title: string }[] = [
  { uid: "/today", title: "today" },
  { uid: "/notes", title: "notes" },
  { uid: "/tasks", title: "tasks" },
  { uid: "/pip", title: "pip" },
  { uid: "/jobs", title: "jobs" },
  { uid: "/memory", title: "memory" },
  { uid: "/settings", title: "settings" },
];

/** The excerpt marks its matches with control characters; the sheet shows plain text. */
const plain = (text: string): string => text.replace(/[\u0001\u0002]/g, "");

/** The words around the match, without the name the row already says. */
function snippetOf(title: string, snippet: string): string {
  const text = plain(snippet).trim(), head = plain(title).trim();
  if (!text || text === head) return "";
  if (text.startsWith(head)) return text.slice(head.length).replace(/^[\s·—–,;:-]+/, "").trim();
  return text;
}

const hitsOf = (kind: HitKind) => (rows: { uid: string; title: string; snippet?: string }[]): Hit[] =>
  rows.map(row => ({ kind, uid: row.uid, title: plain(row.title), snippet: snippetOf(row.title, row.snippet ?? "") }));

/** The document rows of one kind (notes, tasks), read the way the classic app reads them. */
const rowsOf = (kind: "note" | "task") => Object.keys(SEARCH_KINDS)
  .filter(name => (SEARCH_KINDS[name] ?? []).includes(kind))
  .flatMap(name => documentRows(name, load(name)));

/**
 * The big chat is one result however many segments it has, so "pip" does not fill the list with itself; its
 * segments' text is searched together.
 */
function chatHits(chats: Chat[], query: string): Hit[] {
  const home = chats.filter(isHome);
  const rows = [
    ...(home.length ? [{
      kind: "chat", uid: "home", title: "pip",
      body: home.flatMap(chatRows).map(row => row.body).join("\n\n"),
      updated: Math.max(...home.map(chat => chat.updated)),
    }] : []),
    ...chats.filter(chat => !isHome(chat)).flatMap(chatRows),
  ];
  return hitsOf("chat")(localSearch(rows, query));
}

/** Everything that matches, grouped; null when the query is empty. */
export function findAnything(query: string, chats: Chat[] = listChats()): Found | null {
  const words = searchWords(query);
  if (!words.length) return null;
  return {
    chats: chatHits(chats, query),
    notes: hitsOf("note")(localSearch(rowsOf("note"), query)),
    tasks: hitsOf("task")(localSearch(rowsOf("task"), query)),
    pages: PAGES.filter(page => words.every(word => page.title.includes(word))).map(page => ({ kind: "page", uid: page.uid, title: page.title, snippet: "" })),
  };
}

/** How many things a search found, for the empty answer. */
export const foundCount = (found: Found): number => found.chats.length + found.notes.length + found.tasks.length + found.pages.length;
