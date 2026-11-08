import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { DialogHost } from "../ui/dialog/DialogHost.tsx";
import { Toaster } from "../ui/toast/Toaster.tsx";
import styles from "./Shell.module.css";

// The frame around every page: brand, sections, a way back to the classic app for what has not moved yet.

const SECTIONS = [
  { to: "/today", label: "today" },
  { to: "/notes", label: "notes" },
  { to: "/pip", label: "pip" },
] as const;

export function Shell() {
  const path = useRouterState({ select: state => state.location.pathname });
  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link to="/today" className={styles.brand}>pocket</Link>
        <nav className={styles.tabs} aria-label="Sections">
          {SECTIONS.map(section => (
            <Link key={section.to} to={section.to} className={styles.tab} activeProps={{ className: styles.active, "aria-current": "page" }}>{section.label}</Link>
          ))}
        </nav>
        <a className={styles.classic} href={"/#" + path}>classic</a>
      </header>
      <Outlet />
      <Toaster />
      <DialogHost />
    </div>
  );
}

export function NotFound() {
  return <p className={styles.notice}>Nothing here. <Link to="/today">Back to today</Link></p>;
}

export function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  return (
    <div className={styles.error} role="alert">
      <p>This view failed: {error instanceof Error ? error.message : String(error)}</p>
      <button onClick={reset}>try again</button>
    </div>
  );
}

export function Loading() {
  return <p className={styles.notice}>loading…</p>;
}
