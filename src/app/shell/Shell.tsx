import { useEffect } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { DialogHost } from "../ui/dialog/DialogHost.tsx";
import { classicHref, isClassicArea } from "../lib/classic.ts";
import { cn } from "@/lib/utils";
import { useSyncState } from "../runtime.ts";

// The frame around every page: brand, sections, a way back to the classic app for what has not moved yet.

const SECTIONS = [
  { to: "/today", label: "today" },
  { to: "/notes", label: "notes" },
  { to: "/tasks", label: "tasks" },
  { to: "/pip", label: "pip" },
] as const;

/** Where sync stands, one short line; it opens the account, where signing in and syncing are handled. */
function SyncLine() {
  const sync = useSyncState();
  const tone = sync.state === "error" ? "text-destructive" : !sync.signedIn && !sync.local ? "text-primary" : "text-dim";
  return (
    <a href={classicHref("/account")} title={"Account and sync: " + sync.label.toLowerCase()} aria-label={"Account and sync: " + sync.label.toLowerCase()}
      className={cn("ml-auto flex min-h-11 min-w-11 items-center justify-end no-underline", tone, sync.state === "syncing" && "animate-pulse")}>
      {/* A phone has no room for the words beside the sections: the state is a dot there, the line from sm up. */}
      <span aria-hidden="true" className="size-2 rounded-full bg-current sm:hidden" />
      <span className="hidden max-w-[9rem] truncate text-right text-[10px] uppercase leading-tight tracking-wider sm:block">{sync.label}</span>
    </a>
  );
}

export function Shell() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-[env(safe-area-inset-bottom)]">
      <header className="sticky top-0 z-10 flex items-center gap-3.5 border-b bg-background">
        <Link to="/today" className="font-pixel text-[22px] leading-none text-primary no-underline">pocket</Link>
        <nav aria-label="Sections" className="flex gap-3 text-xs text-dim">
          {SECTIONS.map(section => (
            <Link key={section.to} to={section.to} className="flex min-h-11 items-center no-underline hover:text-foreground"
              activeProps={{ className: "font-medium text-hi", "aria-current": "page" }}>{section.label}</Link>
          ))}
        </nav>
        <SyncLine />
        <Link to="/settings" aria-label="Settings" className="-mr-3 grid size-11 place-items-center text-dim hover:text-foreground"
          activeProps={{ className: "text-hi", "aria-current": "page" }}><Settings className="size-4" /></Link>
      </header>
      <Outlet />
      <Toaster position="bottom-center" />
      <DialogHost />
    </div>
  );
}

/** An area this client does not draw yet opens in the classic app; anything else is simply not here. */
export function NotFound() {
  const path = useRouterState({ select: state => state.location.href });
  const classic = isClassicArea(path);
  useEffect(() => { if (classic) location.replace(classicHref(path)); }, [classic, path]);
  if (classic) return <Loading />;
  return <p className="pt-4 text-sm text-muted-foreground">Nothing here. <Link to="/today" className="text-primary">Back to today</Link></p>;
}

export function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  return (
    <div role="alert" className="space-y-2 text-sm text-destructive">
      <p>This view failed: {error instanceof Error ? error.message : String(error)}</p>
      <Button variant="outline" onClick={reset}>try again</Button>
    </div>
  );
}

/** A page on its way: the shape of a page, softly lit. Shown only if loading takes long enough to notice. */
export function Loading() {
  return (
    <div className="arrive space-y-4 pt-4" role="status" aria-label="Loading">
      <div className="shimmer h-9 w-2/5 rounded-md" />
      <div className="shimmer h-4 w-3/5 rounded-sm" />
      <div className="grid grid-cols-2 gap-3"><div className="shimmer h-24 rounded-lg" /><div className="shimmer h-24 rounded-lg" /></div>
      <div className="shimmer h-40 rounded-lg" />
    </div>
  );
}
