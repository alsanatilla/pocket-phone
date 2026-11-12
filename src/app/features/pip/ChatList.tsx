import { useRef } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useCollection } from "../../data/bus.ts";
import { listChats, pinChat, removeChat, renameChat, type Chat } from "../../data/chats.ts";
import { isHome } from "../../data/home.ts";
import { confirm, prompt } from "../../ui/dialog/dialog.ts";
import { toastError } from "../../ui/toast/toast.ts";

// Every conversation, pinned first, then the most recent day by day, with the one big chat above them all. Rename,
// pin and delete live in each row's menu; the chat you are in is the lighter row, with no other mark.

const when = (at: number) => {
  const date = new Date(at), today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : date.toLocaleDateString([], { day: "numeric", month: "short" });
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
  const groups = groupsOf(separate);
  const guard = (run: () => unknown) => async () => { try { await run(); } catch (error) { toastError(error); } };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[85vw] max-w-sm gap-0 p-0">
        <SheetHeader className="flex-row items-baseline gap-3 border-b px-4 pt-3 pb-2 pr-12">
          <SheetTitle className="text-[10.5px] font-normal uppercase tracking-[0.06em] text-dim">chats</SheetTitle>
          <SheetDescription className="text-xs text-dim">{separate.length} {separate.length === 1 ? "conversation" : "conversations"}</SheetDescription>
          <button type="button" onClick={onNew} className="ml-auto flex min-h-11 items-center text-xs text-dim transition-colors hover:text-foreground sm:min-h-0">+ new chat</button>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          <ul>
            <li className={cn("flex items-center border-b", homeCurrent && "bg-secondary")}>
              <button type="button" className="min-h-11 min-w-0 flex-1 px-4 py-2 text-left sm:min-h-0" onClick={onHome} aria-current={homeCurrent ? "page" : undefined}>
                <span className="block truncate text-sm text-hi">pip</span>
                <span className="mt-0.5 block truncate text-xs text-dim">one ongoing conversation · {messages} {messages === 1 ? "message" : "messages"}</span>
              </button>
            </li>
          </ul>
          {groups.length ? groups.map(([title, list]) => <section key={title} className="pt-[18px] first:pt-0">
            <div className="flex items-baseline justify-between px-4 pb-1">
              <h3 className="text-[10.5px] uppercase tracking-[0.06em] text-dim">{title}</h3>
              <span className="text-xs text-dim">{list.length}</span>
            </div>
            <ul>
              {list.map(chat => {
                const active = chat.uid === current;
                return <li key={chat.uid} className={cn("flex items-center border-t last:border-b", active && "bg-secondary")}>
                  <button type="button" className="min-h-11 min-w-0 flex-1 px-4 py-2 text-left sm:min-h-0" onClick={() => onPick(chat.uid)} aria-current={active ? "page" : undefined}>
                    <span className="block truncate text-sm text-hi">{chat.title || "untitled"}</span>
                    <span className="mt-0.5 block truncate text-xs text-dim">{when(chat.updated)} · {chat.turns.length} {chat.turns.length === 1 ? "message" : "messages"}</span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" aria-label={"Options for " + (chat.title || "untitled")}
                        className="flex min-h-11 shrink-0 items-center px-4 text-xs text-dim transition-colors hover:text-foreground data-[state=open]:text-foreground sm:min-h-0">more</button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={guard(async () => { const name = await prompt({ title: "Rename chat", value: chat.title, maxLength: 100 }); if (name?.trim()) renameChat(chat.uid, name); })}>rename</DropdownMenuItem>
                      <DropdownMenuItem onSelect={guard(() => pinChat(chat.uid, !chat.pinned))}>{chat.pinned ? "unpin" : "pin"}</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={guard(async () => {
                        if (await confirm({ title: "Delete this chat?", message: "It is removed on all your devices.", confirmLabel: "delete", danger: true })) removeChat(chat.uid);
                      })}>delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>;
              })}
            </ul>
          </section>) : <p className="px-4 pt-6 text-sm text-muted-foreground">No chats yet. <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={onNew}>start one</button>.</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
