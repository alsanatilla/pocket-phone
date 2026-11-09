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
  { to: "/pip", label: "pip" },
] as const;

/** Where sync stands, one short line; it opens the account, where signing in and syncing are handled. */
function SyncLine() {
  const sync = useSyncState();
  const tone = sync.state === "error" ? "text-destructive" : !sync.signedIn && !sync.local ? "text-primary" : "text-dim";
  return (
    <a href={classicHref("/account")} title="Account and sync"
      className={cn("ml-auto max-w-[9rem] truncate text-right text-[10px] uppercase leading-tight tracking-wider no-underline", tone, sync.state === "syncing" && "animate-pulse")}>
      {sync.label}
    </a>
  );
}

export function Shell() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-24">
      <header className="sticky top-0 z-10 flex items-center gap-4 bg-background py-3.5">
        <Link to="/today" className="font-pixel text-3xl leading-none text-primary no-underline">pocket</Link>
        <nav aria-label="Sections" className="flex gap-3.5 font-pixel text-xl leading-none text-muted-foreground">
          {SECTIONS.map(section => (
            <Link key={section.to} to={section.to} className="py-1.5 no-underline hover:text-foreground"
              activeProps={{ className: "text-foreground shadow-[inset_0_-2px_0_var(--primary)]", "aria-current": "page" }}>{section.label}</Link>
          ))}
        </nav>
        <SyncLine />
        <Link to="/settings" aria-label="Settings" className="grid size-11 place-items-center text-muted-foreground hover:text-foreground"
          activeProps={{ className: "text-primary", "aria-current": "page" }}><Settings className="size-5" /></Link>
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
