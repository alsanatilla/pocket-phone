import { useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useBoundProp, type BaseComponentProps } from "@json-render/react";
import { Accordion as AccordionRoot, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert as AlertBox, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge as BadgeChip } from "@/components/ui/badge";
import { Button as ButtonBase } from "@/components/ui/button";
import { Card as CardBox, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible as CollapsibleRoot, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress as ProgressBar } from "@/components/ui/progress";
import { Separator as Rule } from "@/components/ui/separator";
import { Tabs as TabsRoot, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// The layout and control components of the surface catalog, drawn with Pocket's own shadcn components.
// The catalog keeps json-render's shadcn *definitions* (their props and descriptions, which the model sees);
// these are the implementations. Importing the package's implementation object would bring all 36 components
// (a carousel, a drawer, …) into the first screen's code; these are the ones the catalog offers, in Pocket's
// dark palette (the package's success/warning alerts are light boxes).

type Props<P> = BaseComponentProps<P>;

const GAP: Record<string, string> = { none: "gap-0", sm: "gap-2", md: "gap-3", lg: "gap-4", xl: "gap-6" };
const ALIGN: Record<string, string> = { start: "items-start", center: "items-center", end: "items-end", stretch: "items-stretch" };
const JUSTIFY: Record<string, string> = { start: "", center: "justify-center", end: "justify-end", between: "justify-between", around: "justify-around" };

export function Stack({ props, children }: Props<{ direction?: string | null; gap?: string | null; align?: string | null; justify?: string | null }>) {
  const horizontal = props.direction === "horizontal";
  // Pocket's default: a vertical stack fills the width.
  const align = props.align ?? (horizontal ? "start" : "stretch");
  return <div className={cn("flex", horizontal ? "flex-row flex-wrap" : "flex-col", GAP[props.gap ?? "md"], ALIGN[align], JUSTIFY[props.justify ?? "start"])}>{children}</div>;
}

export function Card({ props, children }: Props<{ title?: string | null; description?: string | null; centered?: boolean | null }>) {
  return (
    <CardBox className={cn("arrive w-full gap-3 py-4", props.centered && "mx-auto")}>
      {props.title || props.description ? (
        <CardHeader className="px-4">
          {props.title ? <CardTitle className="font-pixel text-2xl font-normal leading-none text-primary">{props.title}</CardTitle> : null}
          {props.description ? <CardDescription className="text-xs">{props.description}</CardDescription> : null}
        </CardHeader>
      ) : null}
      <CardContent className="flex flex-col gap-3 px-4">{children}</CardContent>
    </CardBox>
  );
}

export function Badge({ props }: Props<{ text: string; variant?: "default" | "secondary" | "destructive" | "outline" | null }>) {
  return <BadgeChip variant={props.variant ?? "outline"} className="w-fit font-normal">{props.text}</BadgeChip>;
}

const ALERT_TONE: Record<string, string> = {
  info: "border-calendar/50 text-calendar", success: "border-movement/50 text-movement",
  warning: "border-primary/60 text-primary", error: "border-destructive/60 text-destructive",
};
export function Alert({ props }: Props<{ title: string; message?: string | null; type?: string | null }>) {
  return (
    <AlertBox className={cn("arrive bg-card", ALERT_TONE[props.type ?? "info"])}>
      <AlertTitle>{props.title}</AlertTitle>
      {props.message ? <AlertDescription className="text-foreground/85">{props.message}</AlertDescription> : null}
    </AlertBox>
  );
}

export function Progress({ props }: Props<{ value: number; max?: number | null; label?: string | null }>) {
  const max = props.max && props.max > 0 ? props.max : 100;
  const value = Math.min(100, Math.max(0, ((props.value || 0) / max) * 100));
  return (
    <div className="space-y-1.5">
      {props.label ? <p className="text-xs text-muted-foreground">{props.label}</p> : null}
      <ProgressBar value={value} className="h-1.5" />
    </div>
  );
}

export function Separator({ props }: Props<{ orientation?: "horizontal" | "vertical" | null }>) {
  return <Rule orientation={props.orientation ?? "horizontal"} className={props.orientation === "vertical" ? "mx-2 h-full" : "my-1"} />;
}

export function Tabs({ props, children, bindings, emit }: Props<{ tabs?: { value: string; label: string }[] | null; defaultValue?: string | null; value?: string | null }>) {
  const tabs = props.tabs ?? [];
  const [bound, setBound] = useBoundProp(props.value, bindings?.value);
  const [local, setLocal] = useState(props.defaultValue ?? tabs[0]?.value ?? "");
  const isBound = Boolean(bindings?.value);
  const value = isBound ? (bound as string | undefined) ?? tabs[0]?.value ?? "" : local;
  return (
    <TabsRoot value={value} onValueChange={next => { if (isBound) setBound(next); else setLocal(next); emit("change"); }}>
      <TabsList>{tabs.map(tab => <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>)}</TabsList>
      {children}
    </TabsRoot>
  );
}

export function Accordion({ props }: Props<{ items?: { title: string; content: string }[] | null; type?: "single" | "multiple" | null }>) {
  const items = (props.items ?? []).map((item, index) => (
    <AccordionItem key={index} value={"item-" + index}>
      <AccordionTrigger>{item.title}</AccordionTrigger>
      <AccordionContent className="text-muted-foreground">{item.content}</AccordionContent>
    </AccordionItem>
  ));
  return props.type === "multiple"
    ? <AccordionRoot type="multiple" className="w-full">{items}</AccordionRoot>
    : <AccordionRoot type="single" collapsible className="w-full">{items}</AccordionRoot>;
}

export function Collapsible({ props, children }: Props<{ title: string; defaultOpen?: boolean | null }>) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  return (
    <CollapsibleRoot open={open} onOpenChange={setOpen} className="w-full">
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md py-2 text-left text-sm hover:text-primary">
        {props.title}<ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </CollapsibleRoot>
  );
}

export function Button({ props, emit }: Props<{ label: string; variant?: "primary" | "secondary" | "danger" | null; disabled?: boolean | null }>) {
  // A reply's buttons are choices for the next step: equal rows, read from the left, an arrow where they lead. A
  // filled button would read as the recommended one, which a model does not mean by "primary"; it gets amber text.
  if (props.variant === "danger") return <ButtonBase variant="destructive" disabled={props.disabled ?? false} onClick={() => emit("press")} className="w-full sm:w-auto">{props.label}</ButtonBase>;
  return (
    <ButtonBase variant="outline" disabled={props.disabled ?? false} onClick={() => emit("press")}
      className={cn("group/choice h-auto min-h-11 w-full justify-between gap-3 whitespace-normal px-3.5 py-2.5 text-left font-normal", props.variant === "primary" && "border-primary/50 text-primary")}>
      <span>{props.label}</span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-hover/choice:translate-x-0.5" />
    </ButtonBase>
  );
}
