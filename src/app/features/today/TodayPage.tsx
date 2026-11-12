import { Button } from "../../components/ui/button.tsx";
import { Surface } from "../../surface/Surface.tsx";
import { useSurface } from "../../surface/useSurface.ts";
import { PinnedCards } from "./PinnedCards.tsx";

// Today is a surface: Pocket draws the standard one at once and, with a model connected, has it arranged for
// the moment. The line at the bottom says which one you are looking at and lets you switch: keys, no rule.

export function TodayPage() {
  const { spec, store, status, error, arrange, standard } = useSurface();
  const arranged = status === "arranged";
  const failed = status === "failed";
  return (
    <main className="pt-3">
      <PinnedCards />
      <Surface spec={spec} store={store} loading={status === "arranging"} />

      <footer className="mt-6 flex min-h-11 flex-wrap items-center gap-2 text-xs text-dim sm:min-h-0">
        <span aria-live="polite">{status === "arranging" ? "Arranging…" : arranged ? "Arranged for now" : "Standard layout"}</span>
        <span className="flex-1" />
        {arranged || failed ? <Button type="button" size="xs" onClick={standard}>standard</Button> : null}
        {status !== "arranging" ? <Button type="button" size="xs" onClick={() => void arrange()}>{arranged ? "rearrange" : "arrange"}</Button> : null}
      </footer>

      {failed && error ? <p className="mt-2 text-xs text-dim">{error}</p> : null}
      {status === "standard" && error ? <p className="mt-2 text-xs text-dim">{error}</p> : null}
    </main>
  );
}
