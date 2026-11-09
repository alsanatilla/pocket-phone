import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { DialogHost } from "../ui/dialog/DialogHost.tsx";

// The frame around every page: brand, sections, a way back to the classic app for what has not moved yet.

const SECTIONS = [
  { to: "/today", label: "today" },
  { to: "/notes", label: "notes" },
  { to: "/pip", label: "pip" },
] as const;

export function Shell() {
  const path = useRouterState({ select: state => state.location.pathname });
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
        <a href={"/#" + path} className="ml-auto border-b text-[11px] text-dim no-underline">classic</a>
        <Link to="/settings" aria-label="Settings" className="grid size-11 place-items-center text-muted-foreground hover:text-foreground"
          activeProps={{ className: "text-primary", "aria-current": "page" }}><Settings className="size-5" /></Link>
      </header>
      <Outlet />
      <Toaster position="bottom-center" />
      <DialogHost />
    </div>
  );
}

export function NotFound() {
  return <p className="text-sm text-muted-foreground">Nothing here. <Link to="/today" className="text-primary">Back to today</Link></p>;
}

export function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  return (
    <div role="alert" className="space-y-2 text-sm text-destructive">
      <p>This view failed: {error instanceof Error ? error.message : String(error)}</p>
      <Button variant="outline" onClick={reset}>try again</Button>
    </div>
  );
}

export function Loading() {
  return <p className="text-sm text-muted-foreground">loading…</p>;
}
