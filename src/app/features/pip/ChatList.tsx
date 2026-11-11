import { useRef } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useCollection } from "../../data/bus.ts";
import { listChats, pinChat, removeChat, renameChat, type Chat } from "../../data/chats.ts";
import { isHome } from "../../data/home.ts";
import { confirm, prompt } from "../../ui/dialog/dialog.ts";
import { toastError } from "../../ui/toast/toast.ts";

// Every conversation, pinned first, then the most recent day by day, with the one big chat above them all. Rename,
// pin and delete live in each row's menu; the chat you are in is marked with an amber edge and its title, not only
// a lighter row.

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
        <SheetHeader className="border-b px-4 pt-3 pb-2.5 pr-12">
          <SheetTitle className="font-pixel text-2xl leading-none font-normal">chats</SheetTitle>
          <SheetDescription className="text-[11px] uppercase tracking-[0.08em] text-dim">{separate.length} {separate.length === 1 ? "conversation" : "conversations"}</SheetDescription>
        </SheetHeader>

        <div className="px-3 pt-3 pb-1">
          <Button className="h-10 w-full" onClick={onNew}><Plus className="size-4" /> new chat</Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <ul className="pt-1">
            <li className={cn("group flex items-center rounded-md border-l-2", homeCurrent ? "border-primary bg-accent" : "border-transparent hover:bg-accent/50")}>
              <button type="button" className="min-w-0 flex-1 px-2 py-2.5 text-left" onClick={onHome} aria-current={homeCurrent ? "page" : undefined}>
                <p className={cn("truncate text-sm", homeCurrent && "text-primary")}>pip</p>
                <p className="mt-0.5 text-[11px] leading-tight text-dim">everything, in one conversation · {messages} {messages === 1 ? "message" : "messages"}</p>
              </button>
            </li>
          </ul>
          {groups.length ? groups.map(([title, list]) => <section key={title} className="pt-3 first:pt-1">
            <h3 className="flex items-baseline justify-between px-2 pb-1 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              {title}<span className="text-dim">{list.length}</span>
            </h3>
            <ul>
              {list.map(chat => {
                const active = chat.uid === current;
                return <li key={chat.uid} className={cn("group flex items-center rounded-md border-l-2", active ? "border-primary bg-accent" : "border-transparent hover:bg-accent/50")}>
                  <button type="button" className="min-w-0 flex-1 px-2 py-2.5 text-left" onClick={() => onPick(chat.uid)} aria-current={active ? "page" : undefined}>
                    <p className={cn("truncate text-sm", active && "text-primary")}>{chat.title || "untitled"}</p>
                    <p className="mt-0.5 text-[11px] leading-tight text-dim">{when(chat.updated)} · {chat.turns.length} {chat.turns.length === 1 ? "message" : "messages"}</p>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="mr-1 size-9 text-dim" aria-label={"Options for " + (chat.title || "untitled")}><MoreHorizontal /></Button></DropdownMenuTrigger>
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
          </section>) : <p className="px-2 pt-6 text-sm text-muted-foreground">No chats yet. <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={onNew}>start one</button>.</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
