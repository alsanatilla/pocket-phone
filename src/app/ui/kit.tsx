import type { ReactNode } from "react";
import { Check as CheckIcon, ChevronRight, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// Pocket's building blocks. Every screen is made of these, so a button, a row or a section looks and behaves the
// same everywhere (docs/agents/design.md). What can be pressed has a shape of its own: a key (Button), a switch
// (Switch), a tick box (Tick), a segmented choice (Segmented), or a row that ends in ›. Nothing else is pressable,
// and nothing that is not pressable has those shapes.

/** From how many rows a section says its count: fewer are counted at a glance (docs/DESIGN.md 9). */
const COUNTED_FROM = 7;

/**
 * A section: its small name, with a note at the right, then its content. Sections sit 24px apart. `count` is how many
 * rows it holds, shown as the note only from seven rows on.
 */
export function Section({ label, note, count, tone, children, className }: { label?: ReactNode; note?: ReactNode; count?: number; tone?: "late"; children: ReactNode; className?: string }) {
  const shown = note ?? (count !== undefined && count >= COUNTED_FROM ? count : undefined);
  return (
    <section className={cn("mb-6", className)}>
      {label ? <SectionLabel note={shown} tone={tone}>{label}</SectionLabel> : null}
      {children}
    </section>
  );
}

/** The small upper-case name over a section or a group of figures. */
export function SectionLabel({ children, note, tone }: { children: ReactNode; note?: ReactNode; tone?: "late" }) {
  return (
    <p className={cn("mb-1 flex items-baseline gap-2 text-[10.5px] uppercase leading-5 tracking-[0.06em]", tone === "late" ? "text-destructive" : "text-dim")}>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {note != null ? <span className="shrink-0 normal-case tracking-normal">{note}</span> : null}
    </p>
  );
}

interface RowProps {
  /** What stands before the text: a Tick, a time. */
  lead?: ReactNode;
  /** The row's main line. */
  children: ReactNode;
  /** A second, quieter line. */
  sub?: ReactNode;
  /** What stands at the right: a note, a key, a switch. */
  end?: ReactNode;
  /** Pressing the row goes somewhere: it ends in › and the whole row is the target. */
  onOpen?: () => void;
  href?: string;
  /** False leaves out the › of a pressable row: in a list where every row opens its thing, it says nothing. */
  arrow?: boolean;
  /** "error": the second line is a failure, in the error colour, and wraps instead of being cut. */
  subTone?: "error";
  dim?: boolean;
  className?: string;
}

/** One line of a list. No rule between rows: space separates them. 44px to the touch. */
export function Row({ lead, children, sub, end, onOpen, href, arrow = true, subTone, dim, className }: RowProps) {
  const goes = Boolean(onOpen || href);
  const body = (
    <>
      {lead != null ? <span className="flex h-[1.6em] shrink-0 items-center text-dim">{lead}</span> : null}
      <span className="min-w-0 flex-1">
        <span className={cn("block break-words", dim ? "text-dim line-through" : "text-hi")}>{children}</span>
        {sub != null ? <span className={cn("block text-xs", subTone === "error" ? "break-words text-destructive" : "truncate text-dim")}>{sub}</span> : null}
      </span>
      {end != null ? <span className="flex min-h-[1.6em] shrink-0 items-center gap-2 text-xs text-dim">{end}</span> : null}
      {goes && arrow ? <ChevronRight aria-hidden="true" className="mt-[3px] size-3.5 shrink-0 text-dim" /> : null}
    </>
  );
  const shape = cn("flex min-h-11 w-full items-start gap-2.5 py-2 text-left sm:min-h-0 sm:py-1.5", goes && "rounded-[5px] no-underline transition-colors hover:bg-secondary/60", className);
  if (href) return <a href={href} className={shape}>{body}</a>;
  if (onOpen) return <button type="button" onClick={onOpen} className={shape}>{body}</button>;
  return <div className={shape}>{body}</div>;
}

/** A tick box: empty, or filled with a tick. The one way a thing is marked done. */
export function Tick({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className="relative grid size-[15px] place-items-center rounded-[3px] border-[1.5px] border-[#6b655a] transition-colors before:absolute before:-inset-3.5 before:content-[''] aria-checked:bg-[#6b655a] disabled:opacity-45">
      {checked ? <CheckIcon aria-hidden="true" strokeWidth={3} className="size-2.5 text-background" /> : null}
    </button>
  );
}

/** A choice between a few views: one strip, the chosen one lifted. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: string }[]; onChange: (next: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-md bg-secondary p-[3px]">
      {options.map(option => (
        <button key={option.value} type="button" role="tab" aria-selected={option.value === value} onClick={() => onChange(option.value)}
          className="relative shrink-0 rounded-[4px] px-2.5 py-[3px] text-xs text-dim transition-colors before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-[''] hover:text-foreground aria-selected:bg-[#2c2922] aria-selected:font-medium aria-selected:text-hi sm:before:hidden">
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Keys side by side, wrapping when they must. */
export function Keys({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

/** A group of figures: columns with room between them, no rules. All figures of a group are one size. */
export function Figures({ children, columns = 3 }: { children: ReactNode; columns?: 2 | 3 }) {
  return <div className={cn("grid gap-x-3.5 gap-y-3", columns === 2 ? "grid-cols-2" : "grid-cols-3")}>{children}</div>;
}
export function Figure({ label, value, unit, note }: { label: ReactNode; value: ReactNode; unit?: ReactNode; note?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10.5px] uppercase leading-5 tracking-[0.06em] text-dim">{label}</p>
      <p className="text-[22px] font-medium leading-[1.3] text-hi">{value}{unit ? <span className="ml-1 text-[11px] font-normal text-dim">{unit}</span> : null}</p>
      {note ? <p className="truncate text-xs text-dim">{note}</p> : null}
    </div>
  );
}

/**
 * What can be done with one row of a list: three quiet dots at its end that open a menu of `DropdownMenuItem`s.
 * A list never repeats keys on every row (that makes a wall of buttons): the row itself is pressed for its main
 * action, and everything else is here. This is the one place an icon without a fill is pressable.
 */
export function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={label} className="-my-3 -mr-2.5 grid size-11 shrink-0 place-items-center rounded-[5px] text-dim outline-none transition-colors hover:text-hi focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:text-hi sm:size-8">
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}
