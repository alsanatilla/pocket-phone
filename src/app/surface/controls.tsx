import { useState } from "react";
import { useBoundProp, type BaseComponentProps } from "@json-render/react";
import { Accordion as AccordionPrimitive, Collapsible as CollapsiblePrimitive, Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

// The layout and control components of the surface catalog, drawn as plain Terminal elements: a section is a
// label and hairlines, an action is a word, a field is a prompt line. The catalog keeps json-render's shadcn
// *definitions* (their props and descriptions, which the model sees); these are the implementations, so no library
// frame (a filled tabs strip, a rounded alert, a progress pill) can reach a card.

type Props<P> = BaseComponentProps<P>;

const GAP: Record<string, string> = { none: "gap-0", sm: "gap-2", md: "gap-3", lg: "gap-4", xl: "gap-6" };
const ALIGN: Record<string, string> = { start: "items-start", center: "items-center", end: "items-end", stretch: "items-stretch" };
const JUSTIFY: Record<string, string> = { start: "", center: "justify-center", end: "justify-end", between: "justify-between", around: "justify-around" };

/** Rule 4: the small line that names a block. */
const LABEL = "text-[10.5px] uppercase tracking-[0.06em] text-dim";

export function Stack({ props, children }: Props<{ direction?: string | null; gap?: string | null; align?: string | null; justify?: string | null }>) {
  const horizontal = props.direction === "horizontal";
  // Pocket's default: a vertical stack fills the width.
  const align = props.align ?? (horizontal ? "start" : "stretch");
  return <div className={cn("flex", horizontal ? "flex-row flex-wrap" : "flex-col", GAP[props.gap ?? "md"], ALIGN[align], JUSTIFY[props.justify ?? "start"])}>{children}</div>;
}

export function Card({ props, children }: Props<{ title?: string | null; description?: string | null; centered?: boolean | null }>) {
  return (
    <section className={cn("arrive w-full", props.centered && "mx-auto")}>
      {props.title || props.description ? (
        <div className="mb-2">
          {props.title ? <p className={LABEL}>{props.title}</p> : null}
          {props.description ? <p className="mt-1 text-xs text-muted-foreground">{props.description}</p> : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function Badge({ props }: Props<{ text: string; variant?: "default" | "secondary" | "destructive" | "outline" | null }>) {
  return <span className="w-fit text-xs text-dim">[{props.text}]</span>;
}

export function Alert({ props }: Props<{ title: string; message?: string | null; type?: string | null }>) {
  return (
    <div role="alert" className="arrive">
      <p className={cn("text-sm font-medium", props.type === "error" ? "text-destructive" : "text-hi")}>{props.title}</p>
      {props.message ? <p className="mt-1 text-sm text-muted-foreground">{props.message}</p> : null}
    </div>
  );
}

export function Progress({ props }: Props<{ value: number; max?: number | null; label?: string | null }>) {
  const max = props.max && props.max > 0 ? props.max : 100;
  const value = Math.min(100, Math.max(0, ((props.value || 0) / max) * 100));
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className={LABEL}>{props.label}</p>
        <span className="shrink-0 text-xs text-dim">{Math.round(value)}%</span>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={props.value} className="h-px w-full bg-border">
        <div className="h-px bg-hi" style={{ width: value + "%" }} />
      </div>
    </div>
  );
}

export function Separator({ props }: Props<{ orientation?: "horizontal" | "vertical" | null }>) {
  return <div role="separator" aria-orientation={props.orientation === "vertical" ? "vertical" : "horizontal"}
    className={props.orientation === "vertical" ? "mx-2 self-stretch border-l" : "my-1 border-t"} />;
}

export function Tabs({ props, children, bindings, emit }: Props<{ tabs?: { value: string; label: string }[] | null; defaultValue?: string | null; value?: string | null }>) {
  const tabs = props.tabs ?? [];
  const [bound, setBound] = useBoundProp(props.value, bindings?.value);
  const [local, setLocal] = useState(props.defaultValue ?? tabs[0]?.value ?? "");
  const isBound = Boolean(bindings?.value);
  const value = isBound ? (bound as string | undefined) ?? tabs[0]?.value ?? "" : local;
  return (
    <TabsPrimitive.Root value={value} onValueChange={next => { if (isBound) setBound(next); else setLocal(next); emit("change"); }}>
      <TabsPrimitive.List className="flex flex-wrap gap-4 border-b pb-2">
        {tabs.map(tab => (
          <TabsPrimitive.Trigger key={tab.value} value={tab.value}
            className="min-h-11 text-sm text-dim hover:text-foreground data-[state=active]:text-hi sm:min-h-0">{tab.label}</TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  );
}

export function Accordion({ props }: Props<{ items?: { title: string; content: string }[] | null; type?: "single" | "multiple" | null }>) {
  const items = (props.items ?? []).map((item, index) => (
    <AccordionPrimitive.Item key={index} value={"item-" + index} className="border-t last:border-b">
      <AccordionPrimitive.Header>
        <AccordionPrimitive.Trigger className="group flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left text-sm text-hi sm:min-h-0">
          <span>{item.title}</span>
          <span aria-hidden="true" className="text-dim group-data-[state=open]:hidden">+</span>
          <span aria-hidden="true" className="hidden text-dim group-data-[state=open]:inline">−</span>
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Content className="pb-3 text-sm text-muted-foreground">{item.content}</AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  ));
  return props.type === "multiple"
    ? <AccordionPrimitive.Root type="multiple" className="w-full">{items}</AccordionPrimitive.Root>
    : <AccordionPrimitive.Root type="single" collapsible className="w-full">{items}</AccordionPrimitive.Root>;
}

export function Collapsible({ props, children }: Props<{ title: string; defaultOpen?: boolean | null }>) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  return (
    <CollapsiblePrimitive.Root open={open} onOpenChange={setOpen} className="w-full">
      <CollapsiblePrimitive.Trigger className="group flex min-h-11 w-full items-center justify-between gap-3 border-t py-2 text-left text-sm text-hi sm:min-h-0">
        {props.title}
        <span aria-hidden="true" className="text-dim group-data-[state=open]:hidden">+</span>
        <span aria-hidden="true" className="hidden text-dim group-data-[state=open]:inline">−</span>
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content className="pb-3">{children}</CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}

export function Button({ props, emit }: Props<{ label: string; variant?: "primary" | "secondary" | "danger" | null; disabled?: boolean | null }>) {
  // A card's choices are words for the next step, read from the left, never filled buttons; the `›` is the prompt
  // marker, so it stays out of the name a screen reader reads.
  return (
    <button type="button" disabled={props.disabled ?? false} onClick={() => emit("press")}
      className={cn("flex min-h-11 items-center gap-2 text-left text-sm sm:min-h-0",
        props.variant === "danger" ? "text-destructive" : "text-primary",
        "hover:text-foreground disabled:text-dim")}>
      <span aria-hidden="true">›</span>
      <span>{props.label}</span>
    </button>
  );
}
