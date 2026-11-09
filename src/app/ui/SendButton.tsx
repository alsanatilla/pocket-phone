import { ArrowUp, Square } from "lucide-react";
import { cn } from "@/lib/utils";

// The one way Pocket sends what was typed: a round arrow at the end of the field. It is quiet while the field is
// empty and turns amber when there is something to send; pressed, it gives a little. While a reply runs it is a stop.

const ROUND = "flex shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.94] disabled:bg-secondary disabled:text-dim";

export function SendButton({ label, disabled, small = false, className }: { label: string; disabled?: boolean; small?: boolean; className?: string }) {
  return (
    <button type="submit" disabled={disabled} aria-label={label} title={label} className={cn(ROUND, small ? "size-8" : "size-9", className)}>
      <ArrowUp className={small ? "size-3.5" : "size-4"} />
    </button>
  );
}

export function StopButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={cn(ROUND, "size-9")}>
      <Square className="size-3.5 fill-current" />
    </button>
  );
}

/** The field around it: one rounded line, the border warming while it has focus. */
export const FIELD = "flex items-center gap-1.5 rounded-xl border bg-card p-1.5 pl-3.5 transition-colors duration-150 focus-within:border-primary/50";
/** The input inside it: no frame of its own. */
export const BARE_INPUT = "h-9 min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent";
