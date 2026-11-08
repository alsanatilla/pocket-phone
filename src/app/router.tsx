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
  validateSearch: (search: Record<string, unknown>): { chat?: string } =>
    typeof search.chat === "string" && search.chat ? { chat: search.chat } : {},
  component: lazyRouteComponent(() => import("./features/pip/PipPage.tsx"), "PipPage"),
});

const routeTree = root.addChildren([index, today, notes, note, pip]);

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: "intent",
  defaultPendingComponent: Loading,
  defaultErrorComponent: RouteError,
});

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
