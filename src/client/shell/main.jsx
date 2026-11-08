import { createRoot } from "react-dom/client";
import { useSyncExternalStore, useEffect, useState } from "react";

// The next Pocket shell: one router, route-level chunks, and no dependency on the legacy bundle.
// Only Today and Pip are ported so far; everything else stays on the current app until its route moves over.

const routes = {
  today: () => import("./Today.jsx"),
  pip: () => import("./Pip.jsx")
};

const listeners = new Set();
let current = "today";
const emit = () => listeners.forEach(fn => fn());

function useRoute() {
  return useSyncExternalStore(
    fn => (listeners.add(fn), () => listeners.delete(fn)),
    () => current,
    () => current
  );
}

function readHash() {
  const name = (location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] || "today").toLowerCase();
  return routes[name] ? name : "today";
}

function go(name) {
  location.hash = "#/" + name;
}

function App() {
  const route = useRoute();
  const [View, setView] = useState(null);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    let live = true;
    setView(null);
    routes[route]()
      .then(module => { if (live) setView(() => module.default); })
      .catch(error => { if (live) setFailed(String(error?.message || error).slice(0, 160)); });
    return () => { live = false; };
  }, [route]);

  return (
    <div className="shell">
      <header className="shell-bar">
        <button className="shell-brand" onClick={() => go("today")}>pocket</button>
        <nav className="shell-nav">
          {["today", "pip"].map(name => (
            <button key={name} className={"shell-tab" + (route === name ? " on" : "")} onClick={() => go(name)}>{name}</button>
          ))}
        </nav>
        <a className="shell-legacy" href="/#/today">classic</a>
      </header>
      {failed ? <p className="shell-error">This view failed to load: {failed}</p> : null}
      {view ? <View /> : <p className="shell-loading">loading…</p>}
    </div>
  );
}

addEventListener("hashchange", () => { current = readHash(); emit(); });
current = readHash();
createRoot(document.getElementById("app")).render(<App />);
