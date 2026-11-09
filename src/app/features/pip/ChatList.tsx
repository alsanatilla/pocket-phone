import { useRef } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useCollection } from "../../data/bus.ts";
import { listChats, pinChat, removeChat, renameChat, type Chat } from "../../data/chats.ts";
import { confirm, prompt } from "../../ui/dialog/dialog.ts";
import { toastError } from "../../ui/toast/toast.ts";

// Every conversation, pinned first, then the most recent. Rename, pin and delete live in each row's menu.

const when = (at: number) => {
  const date = new Date(at), today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : date.toLocaleDateString([], { day: "numeric", month: "short" });
};

export function ChatList({ open, onOpenChange, current, onPick, onNew }: {
  open: boolean; onOpenChange: (open: boolean) => void; current: string | null; onPick: (uid: string) => void; onNew: () => void;
}) {
  // Read only while the sheet is open (listing parses every chat); while it slides shut it keeps what it showed.
  const shown = useRef<Chat[]>([]);
  const chats: Chat[] = useCollection(["chats"], () => (open ? listChats() : shown.current), [open]);
  shown.current = chats;
  const guard = (run: () => unknown) => async () => { try { await run(); } catch (error) { toastError(error); } };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[85vw] max-w-sm gap-0 p-0">
        <SheetHeader className="border-b">
          <SheetTitle className="font-pixel text-2xl font-normal">chats</SheetTitle>
          <SheetDescription>{chats.length} conversations</SheetDescription>
        </SheetHeader>
        <div className="p-2"><Button className="w-full" onClick={onNew}><Plus /> new chat</Button></div>
        <ul className="flex-1 overflow-y-auto px-2 pb-4">
          {chats.map(chat => (
            <li key={chat.uid} className={cn("group flex items-center rounded-md", chat.uid === current && "bg-accent")}>
              <button className="min-w-0 flex-1 px-2 py-2.5 text-left" onClick={() => onPick(chat.uid)} aria-current={chat.uid === current ? "page" : undefined}>
                <p className="truncate text-sm">{chat.pinned ? <span className="mr-1.5 text-[11px] text-primary">pinned</span> : null}{chat.title || "untitled"}</p>
                <p className="text-[11px] text-dim">{when(chat.updated)} · {chat.turns.length} {chat.turns.length === 1 ? "message" : "messages"}</p>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={"Options for " + chat.title}><MoreHorizontal /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={guard(async () => { const name = await prompt({ title: "Rename chat", value: chat.title, maxLength: 100 }); if (name?.trim()) renameChat(chat.uid, name); })}>rename</DropdownMenuItem>
                  <DropdownMenuItem onSelect={guard(() => pinChat(chat.uid, !chat.pinned))}>{chat.pinned ? "unpin" : "pin"}</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={guard(async () => {
                    if (await confirm({ title: "Delete this chat?", message: "It is removed on all your devices.", confirmLabel: "delete", danger: true })) removeChat(chat.uid);
                  })}>delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
