import { Button } from "@/components/ui/button";
import { Surface } from "../../surface/Surface.tsx";
import { useSurface } from "../../surface/useSurface.ts";

// Today is a surface: Pocket draws the standard one at once and, with a model connected, has it arranged for
// the moment. The line at the bottom says which one you are looking at and lets you switch.

export function TodayPage() {
  const { spec, store, status, error, arrange, standard } = useSurface();
  return (
    <main className="space-y-4 pt-2">
      <Surface spec={spec} store={store} loading={status === "arranging"} />
      <footer className="flex flex-wrap items-center gap-2 pt-2 text-xs text-dim">
        <span className={status === "arranging" ? "animate-pulse text-primary" : ""}>
          {status === "arranging" ? "pip is arranging this screen…" : status === "arranged" ? "arranged by pip for this moment" : status === "failed" ? error : "standard layout"}
        </span>
        <span className="flex-1" />
        {status === "arranged" || status === "failed" ? <Button size="sm" variant="ghost" onClick={standard}>standard</Button> : null}
        {status !== "arranging" ? <Button size="sm" variant="ghost" onClick={() => void arrange()}>{status === "arranged" ? "rearrange" : "arrange with pip"}</Button> : null}
      </footer>
      {status === "standard" && error ? <p className="text-xs text-dim">{error}</p> : null}
    </main>
  );
}
