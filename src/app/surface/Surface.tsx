import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { JSONUIProvider, Renderer } from "@json-render/react";
import type { Spec, StateStore } from "@json-render/core";
import { completeTask, today } from "../data/tasks.ts";
import { parkThoughtText } from "../data/thoughts.ts";
import { withContext } from "../data/chats.ts";
import { toast, toastError } from "../ui/toast/toast.ts";
import { registry } from "./registry.tsx";

// Draws a surface spec with Pocket's registry, bound to the live moment, with the catalog's actions wired to
// the router and the stores. Areas that have not moved to this client yet open in the classic app.

const HERE = new Set(["/today", "/notes", "/pip"]);

export function Surface({ spec, store, loading = false }: { spec: Spec; store: StateStore; loading?: boolean }) {
  const navigate = useNavigate();
  const handlers = useMemo(() => {
    const guard = (run: (params: Record<string, unknown>) => void) => (params: Record<string, unknown>) => {
      try { run(params ?? {}); } catch (error) { toastError(error); }
    };
    return {
      open: guard(({ to }) => {
        const path = String(to || "/today");
        if (HERE.has(path)) void navigate({ to: path });
        else location.assign("/#" + path);
      }),
      askPip: guard(({ prompt }) => {
        const text = String(prompt || "").slice(0, 2000);
        const chat = withContext({ kind: "today", uid: today(), title: "Today", text: JSON.stringify(store.getSnapshot()).slice(0, 6000), href: "/today" });
        void navigate({ to: "/pip", search: { chat, ask: text } });
      }),
      completeTask: guard(({ uid }) => { completeTask(String(uid)); toast("Done."); }),
      parkThought: guard(({ text }) => { parkThoughtText(String(text)); toast("Kept."); }),
    };
  }, [navigate, store]);

  return (
    <JSONUIProvider registry={registry} store={store} handlers={handlers}>
      <Renderer spec={spec} registry={registry} loading={loading} />
    </JSONUIProvider>
  );
}
