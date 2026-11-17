import { useCallback, useEffect, useRef, useState } from "react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Row, RowMenu } from "../../ui/kit.tsx";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BARE_INPUT } from "../../ui/SendButton.tsx";
import { cn, dateAt } from "@/lib/utils";
import { useCollection } from "../../data/bus.ts";
import { listChats, pinChat, removeChat, renameChat, type Chat } from "../../data/chats.ts";
import { isHome } from "../../data/home.ts";
import { confirm, prompt } from "../../ui/dialog/dialog.ts";
import { toastError } from "../../ui/toast/toast.ts";
import { findAnything, foundCount, type Found, type Hit } from "./chat-search.ts";

// Every conversation: the one big chat first, then the others, pinned and then day by day. The field at the top
// finds a chat by name or anything it says, and carries on to the notes, tasks and pages that match, so the sheet is
// where you go to find something as well as to switch. A row is its name and one quiet note (when it was last used,
// or that it is writing, failed, or holds a draft); pressing it opens it. Rename, pin and delete are behind the
// three dots at its end, the one place a quiet icon stands for a menu, because a filled key on every row made the
// list a wall of buttons.

const when = (at: number) => {
  const date = new Date(at), today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : dateAt(at);
};

/** The one note a chat's row carries, and whether it is bad news. */
function stateOf(chat: Chat): { text: string; failed?: boolean } | null {
  const last = chat.turns.at(-1);
  if (last?.status === "streaming") return { text: "writing" };
  if (last?.status === "failed") return { text: "failed", failed: true };
  if ((chat.draft || "").trim()) return { text: "draft" };
  return null;
}

/** The headings a list of conversations falls into: pinned, then today, yesterday, this week, and older. */
function groupsOf(chats: Chat[]): [string, Chat[]][] {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const today = start.getTime(), yesterday = today - 86_400_000, week = today - 6 * 86_400_000;
  const buckets = new Map<string, Chat[]>([
    ["pinned", chats.filter(chat => chat.pinned)],
    ["today", chats.filter(chat => !chat.pinned && chat.updated >= today)],
    ["yesterday", chats.filter(chat => !chat.pinned && chat.updated >= yesterday && chat.updated < today)],
    ["this week", chats.filter(chat => !chat.pinned && chat.updated >= week && chat.updated < yesterday)],
    ["earlier", chats.filter(chat => !chat.pinned && chat.updated < week)],
  ]);
  return [...buckets.entries()].filter(([, list]) => list.length);
}

/** From how many rows a group says its count (the rule `Section` follows in ui/kit.tsx). */
const COUNTED_FROM = 7;

/**
 * One group of search hits. The chat sheet is a list of destinations, so each result is a `Row`: its name, and the
 * words around the match under it when they tell more than the name does.
 */
function Hits({ title, hits, onOpen }: { title: string; hits: Hit[]; onOpen: (hit: Hit) => void }) {
  if (!hits.length) return null;
  return <section className="mb-5">
    <p role="heading" aria-level={3} className="mb-1 px-2.5 text-[10.5px] uppercase leading-5 tracking-[0.06em] text-dim">{title}</p>
    <ul>
      {hits.map(hit => <li key={hit.kind + hit.uid}>
        <Row onOpen={() => onOpen(hit)} arrow={false} sub={hit.snippet || undefined}>{hit.title}</Row>
      </li>)}
    </ul>
  </section>;
}

export function ChatList({ open, onOpenChange, current, homeCurrent, onPick, onHome, onNew, focusSearch = false, onResult }: {
  open: boolean; onOpenChange: (open: boolean) => void; current: string | null; homeCurrent: boolean;
  onPick: (uid: string) => void; onHome: () => void; onNew: () => void;
  /** Put the cursor in the search field when the sheet opens (⌘K). */
  focusSearch?: boolean;
  /** Opens a search hit; without it the field finds chats only. */
  onResult?: (hit: Hit) => void;
}) {
  // Read only while the sheet is open (listing parses every chat); while it slides shut it keeps what it showed.
  const shown = useRef<Chat[]>([]);
  const chats: Chat[] = useCollection(["chats"], () => (open ? listChats() : shown.current), [open]);
  shown.current = chats;
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);
  // The sheet's content mounts inside its portal a moment after it opens, so the row itself is what says where the
  // person is: it scrolls into view when it arrives (and when a search is cleared), not on every render.
  const scrollToCurrent = useCallback((node: HTMLLIElement | null) => {
    if (node) node.scrollIntoView?.({ block: "center" });
  }, []);
  const home = chats.filter(isHome);
  const separate = chats.filter(chat => !isHome(chat));
  const messages = home.reduce((count, chat) => count + chat.turns.length, 0);
  const guard = (run: () => unknown) => async () => { try { await run(); } catch (error) { toastError(error); } };
  // A chat nobody wrote in is not worth a row (starting one is a key away); the one you are in always shows.
  const listed = separate.filter(chat => chat.turns.length || chat.uid === current);
  const groups = groupsOf(listed);
  const found: Found | null = query.trim() ? findAnything(query, chats) : null;
  const foundMany = found ? foundCount(found) : 0;
  const clear = () => { setQuery(""); field.current?.focus(); };
  // Without a caller to open notes and tasks, the field is the chat list's own filter and nothing more.
  const openHit = onResult ?? ((hit: Hit) => { if (hit.kind !== "chat") return; if (hit.uid === "home") onHome(); else onPick(hit.uid); });
  const row = "flex min-h-11 w-full items-center gap-3 rounded-[5px] px-2.5 text-left transition-colors hover:bg-secondary/60";

  // A new search starts at the top; closing the sheet leaves no query behind for the next opening.
  useEffect(() => { if (!open) setQuery(""); }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" showCloseButton={false} className="w-[85vw] max-w-sm gap-0 p-0"
        // ⌘K opens the sheet to search; a tap opens it on its first key, so the phone's keyboard stays down.
        onOpenAutoFocus={event => { if (!focusSearch) return; event.preventDefault(); field.current?.focus(); }}>
        <SheetHeader className="flex-row items-center gap-3 px-5 pt-4 pr-5 pb-3">
          <SheetTitle className="font-pixel text-[26px] font-normal leading-none text-hi">chats</SheetTitle>
          <SheetDescription className="sr-only">{listed.length} {listed.length === 1 ? "conversation" : "conversations"}</SheetDescription>
          <Button type="button" variant="go" onClick={onNew} className="ml-auto">new chat</Button>
        </SheetHeader>

        {/* A prompt line for the filter: a field inside a sheet has no line of its own (docs/DESIGN.md 11). */}
        <div className="flex min-h-11 items-center gap-2 px-5 pb-2 sm:min-h-0">
          <span aria-hidden="true" className="text-dim">/</span>
          <Input ref={field} type="search" value={query} onChange={event => setQuery(event.target.value)}
            placeholder="find anything…" aria-label="Find a chat or anything" className={BARE_INPUT} />
          {query ? <Button type="button" onClick={clear}>clear</Button> : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-6">
          {found ? foundMany ? <>
            <Hits title="chats" hits={found.chats} onOpen={openHit} />
            {onResult ? <Hits title="notes" hits={found.notes} onOpen={onResult} /> : null}
            {onResult ? <Hits title="tasks" hits={found.tasks} onOpen={onResult} /> : null}
            {onResult ? <Hits title="go to" hits={found.pages} onOpen={onResult} /> : null}
          </> : <p className="px-2.5 pt-2 text-sm text-muted-foreground">Nothing matches “{query.trim()}”. <Button type="button" variant="link" onClick={clear}>clear the search</Button></p>
            : <>
              {/* The one big chat first, on its own: it is where Pip opens. */}
              <button type="button" onClick={onHome} aria-current={homeCurrent ? "page" : undefined} className={cn(row, "mb-5", homeCurrent && "bg-secondary")}>
                <span className="min-w-0 flex-1 truncate text-hi">pip</span>
                <span className="shrink-0 text-xs text-dim">ongoing · {messages} {messages === 1 ? "message" : "messages"}</span>
              </button>

              {groups.length ? groups.map(([title, list]) => <section key={title} className="mb-5">
                <p role="heading" aria-level={3} className="mb-1 flex items-baseline gap-2 px-2.5 text-[10.5px] uppercase leading-5 tracking-[0.06em] text-dim">
                  <span className="min-w-0 flex-1 truncate">{title}</span>
                  {list.length >= COUNTED_FROM ? <span className="shrink-0 normal-case tracking-normal">{list.length}</span> : null}
                </p>
                <ul>
                  {list.map(chat => {
                    const isCurrent = chat.uid === current, name = chat.title || "untitled", state = stateOf(chat);
                    return <li key={chat.uid} ref={isCurrent ? scrollToCurrent : undefined} className={cn("flex items-center rounded-[5px] pr-2.5", isCurrent && "bg-secondary")} aria-current={isCurrent ? "page" : undefined}>
                      <button type="button" onClick={() => onPick(chat.uid)} className={cn(row, "min-w-0 flex-1 pr-1")}>
                        <span className="min-w-0 flex-1 truncate text-hi">{name}</span>
                        <span className={cn("shrink-0 text-xs", state?.failed ? "text-destructive" : "text-dim")}>{state?.text ?? when(chat.updated)}</span>
                      </button>
                      <RowMenu label={"Options for " + name}>
                          <DropdownMenuItem onSelect={guard(async () => { const next = await prompt({ title: "Rename chat", value: chat.title, maxLength: 100 }); if (next?.trim()) renameChat(chat.uid, next); })}>rename</DropdownMenuItem>
                          <DropdownMenuItem onSelect={guard(() => pinChat(chat.uid, !chat.pinned))}>{chat.pinned ? "unpin" : "pin"}</DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onSelect={guard(async () => {
                            if (await confirm({ title: "Delete this chat?", message: "It is removed on all your devices.", confirmLabel: "delete", danger: true })) removeChat(chat.uid);
                          })}>delete</DropdownMenuItem>
                      </RowMenu>
                    </li>;
                  })}
                </ul>
              </section>) : <p className="px-2.5 pt-2 text-sm text-muted-foreground">No other chats yet.</p>}
            </>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
