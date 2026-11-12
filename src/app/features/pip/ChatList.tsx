import { useRef } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Row, Section, SectionLabel } from "../../ui/kit.tsx";
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
        <SheetHeader className="flex-row items-center gap-3 px-4 pt-3 pb-2 pr-12">
          <SheetTitle className="contents"><SectionLabel>chats</SectionLabel></SheetTitle>
          <SheetDescription className="text-xs text-dim">{separate.length} {separate.length === 1 ? "conversation" : "conversations"}</SheetDescription>
          <Button type="button" onClick={onNew} className="ml-auto">+ new chat</Button>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          <Section className="mb-2 px-4">
            <ul>
              <li className={cn(homeCurrent && "bg-secondary")} aria-current={homeCurrent ? "page" : undefined}>
                <Row onOpen={onHome} sub={<>one ongoing conversation · {messages} {messages === 1 ? "message" : "messages"}</>}>
                  <span className="block truncate text-sm text-hi">pip</span>
                </Row>
              </li>
            </ul>
          </Section>
          {groups.length ? groups.map(([title, list]) => <Section key={title} label={<span role="heading" aria-level={3}>{title}</span>} note={list.length} className="mb-6 px-4">
            <ul>
              {list.map(chat => {
                const active = chat.uid === current;
                return <li key={chat.uid} className={cn("flex items-center", active && "bg-secondary")} aria-current={active ? "page" : undefined}>
                  <Row onOpen={() => onPick(chat.uid)} className="min-w-0 flex-1" sub={<>{when(chat.updated)} · {chat.turns.length} {chat.turns.length === 1 ? "message" : "messages"}</>}>
                    {chat.title || "untitled"}
                  </Row>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" aria-label={"Options for " + (chat.title || "untitled")}>more</Button>
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
          </Section>) : <p className="px-4 pt-6 text-sm text-muted-foreground">No chats yet. <Button type="button" variant="link" onClick={onNew}>start one</Button>.</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
