import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

// The one way Pocket sends what was typed: a small square at the end of the field. It is quiet while the field is
// empty and turns amber when there is something to send; pressed, it gives a little. While a reply runs it is a stop.
// Every send is the same square: the `small` flag older callers pass no longer changes its size.

const SQUARE = "flex size-8 shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.94] disabled:bg-secondary disabled:text-dim";

export function SendButton({ label, disabled, className }: { label: string; disabled?: boolean; small?: boolean; className?: string }) {
  return (
    <button type="submit" disabled={disabled} aria-label={label} title={label} className={cn(SQUARE, className)}>
      <ArrowUp className="size-4" />
    </button>
  );
}

export function StopButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={SQUARE}>
      <span aria-hidden="true" className="text-sm leading-none">■</span>
    </button>
  );
}

/** The field around it: a prompt line separated from the page by a hairline, with no frame of its own. */
export const FIELD = "flex items-center gap-2 border-t";
/** The input inside it: no frame of its own, and 44px tall where a finger taps. */
export const BARE_INPUT = "min-h-11 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 shadow-none placeholder:text-dim focus-visible:ring-0 sm:min-h-0 dark:bg-transparent";
