import { createHashHistory, createRootRoute, createRoute, createRouter, lazyRouteComponent, redirect } from "@tanstack/react-router";
import { Loading, NotFound, RouteError, Shell } from "./shell/Shell.tsx";

// Routes live in the hash (#/notes/<uid>), the URL shape the classic app and the phone's links already use.
// Each page is its own chunk, loaded when its route opens.

const root = createRootRoute({ component: Shell, notFoundComponent: NotFound });

const index = createRoute({ getParentRoute: () => root, path: "/", beforeLoad: () => { throw redirect({ to: "/today" }); } });

const today = createRoute({
  getParentRoute: () => root, path: "today",
  component: lazyRouteComponent(() => import("./features/today/TodayPage.tsx"), "TodayPage"),
});

const notes = createRoute({
  getParentRoute: () => root, path: "notes",
  component: lazyRouteComponent(() => import("./features/notes/NotesPage.tsx"), "NotesPage"),
});

/**
 * A note's uid. A new note gets its uid before it exists (?fresh), so the URL never changes under the editor;
 * the classic "#/notes/new" link redirects to one.
 */
const note = createRoute({
  getParentRoute: () => root, path: "notes/$noteId",
  validateSearch: (search: Record<string, unknown>): { fresh?: boolean } => search.fresh === true || search.fresh === "true" ? { fresh: true } : {},
  beforeLoad: ({ params }) => {
    if (params.noteId === "new") throw redirect({ to: "/notes/$noteId", params: { noteId: crypto.randomUUID() }, search: { fresh: true }, replace: true });
  },
  component: lazyRouteComponent(() => import("./features/notes/NotePage.tsx"), "NotePage"),
});

const pip = createRoute({
  getParentRoute: () => root, path: "pip",
  validateSearch: (search: Record<string, unknown>): { chat?: string; ask?: string } => ({
    ...(typeof search.chat === "string" && search.chat ? { chat: search.chat } : {}),
    ...(typeof search.ask === "string" && search.ask ? { ask: search.ask.slice(0, 2000) } : {}),
  }),
  component: lazyRouteComponent(() => import("./features/pip/PipPage.tsx"), "PipPage"),
});

const settings = createRoute({
  getParentRoute: () => root, path: "settings",
  component: lazyRouteComponent(() => import("./features/settings/SettingsPage.tsx"), "SettingsPage"),
});

const routeTree = root.addChildren([index, today, notes, note, pip, settings]);

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: "intent",
  // A quick change shows nothing; a slow one shows the skeleton for long enough not to flicker.
  defaultPendingMs: 200,
  defaultPendingMinMs: 300,
  defaultPendingComponent: Loading,
  defaultErrorComponent: RouteError,
});

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}

/** After the first page is up and the browser is idle, fetch the other pages' code so the first switch is instant. */
export function preloadPages(): void {
  const run = () => { for (const to of ["/pip", "/notes", "/settings"] as const) void router.preloadRoute({ to }).catch(() => {}); };
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 4000 }); else setTimeout(run, 1500);
}
