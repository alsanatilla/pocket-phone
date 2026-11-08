import { lazy } from "react";

// One line per route. Each view is its own chunk; `nav: false` keeps a route reachable but out of the tab bar.
// Moving a classic view over means adding a line here and a folder under features/.

export const routes = [
  { name: "today", title: "today", View: lazy(() => import("./features/today/TodayView.jsx")) },
  { name: "pip", title: "pip", View: lazy(() => import("./features/pip/PipView.jsx")) },
];

export const DEFAULT_ROUTE = "today";
export const byName = new Map(routes.map(route => [route.name, route]));
