import type { Spec } from "@json-render/core";
import type { Moment } from "./context.ts";

// The surface Pocket draws without a model: instant, offline, and the floor a generated one has to beat.
// Its structure follows the moment (morning plans, evening reviews, a meeting soon comes first); its values bind
// to state, so they stay live while the screen is open.

type Element = Spec["elements"][string];

class Builder {
  readonly elements: Record<string, Element> = {};
  private serial = 0;
  add(type: string, props: Record<string, unknown>, children: string[] = [], extra: Partial<Element> = {}): string {
    const key = type.toLowerCase() + "-" + ++this.serial;
    this.elements[key] = { type, props, children, ...extra } as Element;
    return key;
  }
}

const open = (to: string) => ({ on: { press: { action: "open", params: { to } } } });

export function fallbackSurface(moment: Moment): Spec {
  const b = new Builder();
  const { phase } = moment.now;
  const children: string[] = [];
  const soon = moment.agenda.next && moment.agenda.next.inMinutes >= 0 && moment.agenda.next.inMinutes <= 45;

  // Headline: what the moment is about.
  if (soon && moment.agenda.next) {
    children.push(b.add("Hero", { eyebrow: { $template: "${/now/date} · ${/now/time}" }, value: { $state: "/agenda/next/time" }, unit: null,
      caption: { $template: "${/agenda/next/title} — in ${/agenda/next/inMinutes} min" }, tone: "calendar" }));
  } else if (phase === "evening" || phase === "night") {
    children.push(b.add("Hero", { eyebrow: { $template: "${/now/date} · ${/now/time}" }, value: { $state: "/tasks/doneToday" }, unit: "done today",
      caption: moment.tasks.due ? "What is left can wait for tomorrow, or go now." : "Nothing left for today.", tone: "movement" }));
  } else {
    children.push(b.add("Hero", { eyebrow: { $template: "${/now/date} · ${/now/time}" }, value: moment.tasks.due ? { $state: "/tasks/due" } : "clear",
      unit: moment.tasks.due ? "due today" : null, caption: moment.tasks.overdue ? { $template: "${/tasks/overdue} of them overdue." } : null,
      tone: moment.tasks.overdue ? "warning" : "accent" }));
  }

  // Readings at a glance.
  const tiles = [
    b.add("Metric", { label: "due", value: { $state: "/tasks/due" }, unit: null, hint: { $template: "${/tasks/open} open" }, tone: moment.tasks.overdue ? "warning" : "accent" }, [], open("/tasks")),
    b.add("Metric", { label: "next", value: moment.agenda.next ? { $state: "/agenda/next/time" } : "free", unit: null,
      hint: moment.agenda.next ? { $state: "/agenda/next/title" } : "no events", tone: "calendar" }, [], open("/calendar")),
    moment.movement.recovery != null
      ? b.add("Metric", { label: "recovery", value: { $state: "/movement/recovery" }, unit: "%", hint: { $state: "/movement/zone" }, tone: "movement" }, [], open("/movement"))
      : b.add("Metric", { label: "thoughts", value: { $state: "/thoughts/open" }, unit: null, hint: { $template: "${/thoughts/ready} to revisit" }, tone: "thought" }, [], open("/thoughts")),
  ];
  children.push(b.add("Grid", { columns: 3, gap: "md" }, tiles));

  if (moment.agenda.today.length && (phase === "morning" || phase === "midday" || soon)) {
    children.push(b.add("Timeline", { title: "today", items: { $state: "/agenda/today" } }));
  }

  children.push(b.add("TaskList", { title: phase === "evening" ? "still open today" : null, source: moment.tasks.due ? "due" : moment.tasks.chosen ? "chosen" : "open", limit: 6 }));

  if (moment.movement.recovery != null && (phase === "morning" || phase === "evening")) {
    children.push(b.add("Chart", { kind: "area", title: "recovery · 14 days", data: { $state: "/movement/recoveryTrend" }, unit: "%", tone: "movement" }));
  }
  if (moment.thoughts.ready) children.push(b.add("ThoughtList", { title: null, source: "ready", limit: 4 }));

  children.push(b.add("Capture", { mode: "thought", placeholder: phase === "evening" ? "what is on your mind for tomorrow?" : null }));

  const root = b.add("Stack", { direction: "vertical", gap: "lg" }, children);
  return { root, elements: b.elements };
}
