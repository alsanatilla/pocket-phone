import { Suspense } from "react";
import { useRoute, href } from "./router.js";
import { routes, byName, DEFAULT_ROUTE } from "./routes.js";
import { ErrorBoundary } from "./ui/ErrorBoundary.jsx";

export function App() {
  const route = useRoute(byName, DEFAULT_ROUTE);
  const { View } = byName.get(route.name);

  return (
    <div className="shell">
      <header className="bar">
        <a className="brand" href={href(DEFAULT_ROUTE)}>pocket</a>
        <nav className="tabs" aria-label="Sections">
          {routes.filter(item => item.nav !== false).map(item => (
            <a key={item.name} href={href(item.name)} className={"tab" + (item.name === route.name ? " on" : "")}
              aria-current={item.name === route.name ? "page" : undefined}>{item.title}</a>
          ))}
        </nav>
        <a className="classic" href={"/#/" + route.name}>classic</a>
      </header>
      {/* Keyed by route: a failed view resets when you leave it, and its chunk loads behind one fallback. */}
      <ErrorBoundary key={route.name}>
        <Suspense fallback={<p className="notice">loading…</p>}>
          <View route={route} />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
