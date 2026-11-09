import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Surface } from "../../surface/Surface.tsx";
import { useSurface } from "../../surface/useSurface.ts";

// Today is a surface: Pocket draws the standard one at once and, with a model connected, has it arranged for
// the moment. The line at the bottom says which one you are looking at and lets you switch.

export function TodayPage() {
  const { spec, store, status, error, arrange, standard } = useSurface();
  const arranged = status === "arranged";
  const failed = status === "failed";
  return (
    <main className="pt-3">
      <Surface spec={spec} store={store} loading={status === "arranging"} />

      <footer className="mt-8 flex items-center gap-3 border-t border-dashed pt-3">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] text-dim" aria-live="polite">
          <span aria-hidden="true" className={cn("size-1.5 rounded-full",
            status === "arranging" ? "animate-pulse bg-primary" : failed ? "bg-destructive" : arranged ? "bg-primary" : "bg-muted-foreground")} />
          {status === "arranging" ? "arranging…" : arranged ? "arranged for now" : failed ? "standard layout" : "standard layout"}
        </span>
        <span className="flex-1" />
        {arranged || failed ? <Button size="sm" variant="ghost" className="h-9 text-dim" onClick={standard}>standard</Button> : null}
        {status !== "arranging" ? <Button size="sm" variant="outline" className="h-9" onClick={() => void arrange()}>{arranged ? "rearrange" : "arrange"}</Button> : null}
      </footer>

      {failed && error ? <p className="mt-2 text-[11px] text-dim">{error}</p> : null}
      {status === "standard" && error ? <p className="mt-2 text-[11px] text-dim">{error}</p> : null}
    </main>
  );
}
