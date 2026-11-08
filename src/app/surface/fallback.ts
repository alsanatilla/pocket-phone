import type { Spec } from "@json-render/core";
import type { Moment } from "./context.ts";

// The surface Pocket draws without a model: instant, offline, and the floor a generated one has to beat.
//
// The rule is that every fact appears once:
// 1. the Hero is the one thing the moment is about (an event soon, what is due, or how the day went);
// 2. tiles carry readings that have no block of their own, in pairs, never a zero;
// 3. lists and the timeline follow, only when they say more than the Hero already did.
// Values bind to state, so they stay live while the screen is open.

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
type Lead = "event" | "due" | "review" | "clear";

export function leadOf(moment: Moment): Lead {
  const next = moment.agenda.next;
  if (next && next.inMinutes >= 0 && next.inMinutes <= 45) return "event";
  if (moment.now.phase === "evening" || moment.now.phase === "night") return "review";
  return moment.tasks.due ? "due" : "clear";
}

export function fallbackSurface(moment: Moment): Spec {
  const b = new Builder();
  const lead = leadOf(moment);
  const eyebrow = { $template: "${/now/date} · ${/now/time}" };
  const blocks: string[] = [];

  // 1. The lead.
  if (lead === "event") {
    blocks.push(b.add("Hero", { eyebrow, value: { $state: "/agenda/next/time" }, unit: null, caption: { $template: "${/agenda/next/title} · in ${/agenda/next/inMinutes} min" }, tone: "calendar" }));
  } else if (lead === "review") {
    blocks.push(b.add("Hero", { eyebrow, value: { $state: "/tasks/doneToday" }, unit: "done", caption: moment.tasks.due ? "The rest can wait for tomorrow." : "Nothing left for today.", tone: "movement" }));
  } else if (lead === "due") {
    blocks.push(b.add("Hero", { eyebrow, value: { $state: "/tasks/due" }, unit: "due today", caption: moment.tasks.overdue ? { $template: "${/tasks/overdue} overdue" } : null, tone: moment.tasks.overdue ? "warning" : "accent" }));
  } else {
    blocks.push(b.add("Hero", { eyebrow, value: "clear", unit: null, caption: "Nothing due today.", tone: "accent" }));
  }

  // What gets its own block decides what the tiles may not repeat.
  const showTimeline = moment.agenda.today.length >= 2 || (moment.agenda.today.length === 1 && lead !== "event");
  const showDue = moment.tasks.due > 0;
  const showThoughts = moment.thoughts.ready > 0;

  // 2. Tiles: readings without a block of their own.
  const tiles: string[] = [];
  if (moment.agenda.next && lead !== "event" && !showTimeline) {
    tiles.push(b.add("Metric", { label: "next", value: { $state: "/agenda/next/time" }, unit: null, hint: { $state: "/agenda/next/title" }, tone: "calendar" }, [], open("/calendar")));
  }
  if (moment.movement.recovery != null) {
    tiles.push(b.add("Metric", { label: "recovery", value: { $state: "/movement/recovery" }, unit: "%", hint: { $state: "/movement/zone" }, tone: "movement" }, [], open("/movement")));
  }
  if (moment.tasks.doneToday > 0 && lead !== "review") {
    tiles.push(b.add("Metric", { label: "done today", value: { $state: "/tasks/doneToday" }, unit: null, hint: null, tone: "movement" }));
  }
  if (!showDue && moment.tasks.open > 0) {
    tiles.push(b.add("Metric", { label: "open tasks", value: { $state: "/tasks/open" }, unit: null, hint: "none due today", tone: "accent" }, [], open("/tasks")));
  }
  if (!showThoughts && moment.thoughts.open > 0) {
    tiles.push(b.add("Metric", { label: "parked", value: { $state: "/thoughts/open" }, unit: null, hint: "thoughts", tone: "thought" }, [], open("/thoughts")));
  }
  // Pairs only: an odd tile out would leave a hole in the two-column grid.
  const paired = tiles.slice(0, tiles.length >= 4 ? 4 : tiles.length >= 2 ? 2 : 0);
  if (paired.length) blocks.push(b.add("Grid", { columns: 2, gap: "md" }, paired));

  // 3. Detail.
  if (showDue) blocks.push(b.add("TaskList", { title: lead === "review" ? "still open" : null, source: "due", limit: 6 }));
  if (showTimeline) blocks.push(b.add("Timeline", { title: "today", items: { $state: "/agenda/today" } }));
  if (showThoughts) blocks.push(b.add("ThoughtList", { title: null, source: "ready", limit: 4 }));
  if (moment.movement.recoveryTrend.length >= 2 && (moment.now.phase === "morning" || lead === "review")) {
    blocks.push(b.add("Chart", { kind: "area", title: "recovery · 14 days", data: { $state: "/movement/recoveryTrend" }, unit: "%", tone: "movement" }));
  }
  blocks.push(b.add("Capture", { mode: "thought", placeholder: lead === "review" ? "for tomorrow…" : null }));

  const root = b.add("Stack", { direction: "vertical", gap: "lg" }, blocks);
  return { root, elements: b.elements };
}
