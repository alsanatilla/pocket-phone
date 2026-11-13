import { useRef } from "react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { RowMenu } from "../../ui/kit.tsx";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn, dateAt } from "@/lib/utils";
import { useCollection } from "../../data/bus.ts";
import { listChats, pinChat, removeChat, renameChat, type Chat } from "../../data/chats.ts";
import { isHome } from "../../data/home.ts";
import { confirm, prompt } from "../../ui/dialog/dialog.ts";
import { toastError } from "../../ui/toast/toast.ts";

// Every conversation: the one big chat first, then the others, pinned and then day by day. A row is its name and
// when it was last used; pressing it opens it. Rename, pin and delete are behind the three dots at its end, the one
// place a quiet icon stands for a menu, because a filled key on every row made the list a wall of buttons.

const when = (at: number) => {
  const date = new Date(at), today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : dateAt(at);
};

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

export function ChatList({ open, onOpenChange, current, homeCurrent, onPick, onHome, onNew }: {
  open: boolean; onOpenChange: (open: boolean) => void; current: string | null; homeCurrent: boolean;
  onPick: (uid: string) => void; onHome: () => void; onNew: () => void;
}) {
  // Read only while the sheet is open (listing parses every chat); while it slides shut it keeps what it showed.
  const shown = useRef<Chat[]>([]);
  const chats: Chat[] = useCollection(["chats"], () => (open ? listChats() : shown.current), [open]);
  shown.current = chats;
  const home = chats.filter(isHome);
  const separate = chats.filter(chat => !isHome(chat));
  const messages = home.reduce((count, chat) => count + chat.turns.length, 0);
  const guard = (run: () => unknown) => async () => { try { await run(); } catch (error) { toastError(error); } };
  // A chat nobody wrote in is not worth a row (starting one is a key away); the one you are in always shows.
  const listed = separate.filter(chat => chat.turns.length || chat.uid === current);
  const groups = groupsOf(listed);
  const row = "flex min-h-11 w-full items-center gap-3 rounded-[5px] px-2.5 text-left transition-colors hover:bg-secondary/60";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" showCloseButton={false} className="w-[85vw] max-w-sm gap-0 p-0">
        <SheetHeader className="flex-row items-center gap-3 px-5 pt-4 pr-5 pb-3">
          <SheetTitle className="font-pixel text-[26px] font-normal leading-none text-hi">chats</SheetTitle>
          <SheetDescription className="sr-only">{listed.length} {listed.length === 1 ? "conversation" : "conversations"}</SheetDescription>
          <Button type="button" variant="go" onClick={onNew} className="ml-auto">new chat</Button>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-6">
          {/* The one big chat first, on its own: it is where Pip opens. */}
          <button type="button" onClick={onHome} aria-current={homeCurrent ? "page" : undefined} className={cn(row, "mb-5", homeCurrent && "bg-secondary")}>
            <span className="min-w-0 flex-1 truncate text-hi">pip</span>
            <span className="shrink-0 text-xs text-dim">ongoing · {messages} {messages === 1 ? "message" : "messages"}</span>
          </button>

          {groups.length ? groups.map(([title, list]) => <section key={title} className="mb-5">
            <p role="heading" aria-level={3} className="mb-1 px-2.5 text-[10.5px] uppercase leading-5 tracking-[0.06em] text-dim">{title}</p>
            <ul>
              {list.map(chat => {
                const active = chat.uid === current, name = chat.title || "untitled";
                return <li key={chat.uid} className={cn("flex items-center rounded-[5px] pr-2.5", active && "bg-secondary")} aria-current={active ? "page" : undefined}>
                  <button type="button" onClick={() => onPick(chat.uid)} className={cn(row, "min-w-0 flex-1 pr-1")}>
                    <span className="min-w-0 flex-1 truncate text-hi">{name}</span>
                    <span className="shrink-0 text-xs text-dim">{when(chat.updated)}</span>
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
