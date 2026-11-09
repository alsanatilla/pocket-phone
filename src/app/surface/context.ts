import { focusSession, focusRemaining } from "../data/today.ts";
import { agenda } from "../../client/planner.js";
import * as coros from "../../client/coros.js";
import { scores } from "../../client/scores.js";
import { gym, weekStart } from "../../client/store.js";
import { listTasks, today } from "../data/tasks.ts";
import { openThoughts } from "../data/thoughts.ts";
import { listNotes, noteTitle } from "../data/notes.ts";
import { chosenTask } from "../data/tasks.ts";

// The moment, as plain data: what time of day it is, what is due, what is next, how the body is doing.
// It is the state a generated surface binds to ($state paths) and the only data the model sees when it
// arranges one, so it holds summaries, never whole notes.

export type Phase = "night" | "morning" | "midday" | "afternoon" | "evening";

export interface Moment {
  now: { phase: Phase; time: string; weekday: string; date: string; greeting: string };
  focus?: { uid: string; taskUid: string; title: string; state: "running" | "paused" | "done" } | null;
  tasks: {
    open: number; due: number; overdue: number; doneToday: number;
    chosen: { uid: string; text: string } | null;
    list: { uid: string; text: string; due: string; important: boolean; overdue: boolean }[];
  };
  thoughts: { open: number; ready: number; list: { id: number; text: string; ready: boolean }[] };
  agenda: {
    next: { uid?: string; taskUid?: string; title: string; time: string; inMinutes: number; minutes: number } | null;
    today: { time: string; title: string; minutes: number; past: boolean; now: boolean }[];
  };
  movement: {
    connected: boolean;
    recovery: number | null; zone: string; strain: number | null; condition: number | null;
    recoveryTrend: { label: string; value: number }[];
    strainTrend: { label: string; value: number }[];
    gymThisWeek: number;
    gymWeeks: { label: string; value: number }[];
  };
  notes: { count: number; recent: { uid: string; title: string }[] };
}

const MINUTE = 60_000, WEEK = 7 * 24 * 60 * MINUTE;
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

export function phaseOf(hour: number): Phase {
  if (hour < 5) return "night";
  if (hour < 11) return "morning";
  if (hour < 14) return "midday";
  if (hour < 18) return "afternoon";
  if (hour < 23) return "evening";
  return "night";
}
const GREETING: Record<Phase, string> = { night: "late", morning: "good morning", midday: "midday", afternoon: "this afternoon", evening: "this evening" };

// scores() walks 90 days of activities; its inputs only change when COROS data does, so its result is kept until then.
let scored: { deck: unknown; cache: unknown; day: string; result: ReturnType<typeof scores> } | null = null;
function cachedScores(deck: ReturnType<typeof coros.cachedCockpit>, cache: ReturnType<typeof coros.cached>) {
  const day = today();
  if (scored && scored.day === day && JSON.stringify(scored.deck) === JSON.stringify(deck) && (scored.cache as { at?: number } | null)?.at === cache?.at) return scored.result;
  const result = scores({ activities: cache?.list ?? [], deck: deck ?? {}, profile: { ...deck?.profile, observedMax: coros.observedMaxHr() } });
  scored = { deck, cache, day, result };
  return result;
}

function movement(now: number): Moment["movement"] {
  const deck = coros.cachedCockpit(), cache = coros.cached();
  const start = weekStart(now), workouts = gym.all();
  const gymWeeks = Array.from({ length: 8 }, (_, i) => {
    const from = start - (7 - i) * WEEK;
    return { label: new Date(from).toLocaleDateString([], { day: "numeric", month: "short" }), value: workouts.filter(w => w.started >= from && w.started < from + WEEK).length };
  });
  const base = { connected: coros.connected(), recovery: null, zone: "", strain: null, condition: null, recoveryTrend: [], strainTrend: [], gymThisWeek: gymWeeks.at(-1)?.value ?? 0, gymWeeks };
  if (!deck && !cache) return base;
  try {
    const result = cachedScores(deck, cache);
    const fresh = Array.isArray(cache?.list) && today(cache?.at ?? 0) === today(now);
    return {
      ...base,
      recovery: result.recovery?.score ?? null,
      zone: result.recovery?.zone ?? "",
      strain: fresh ? result.strain?.strain ?? null : null,
      condition: Array.isArray(cache?.list) ? result.conditioning?.score ?? null : null,
      recoveryTrend: result.recoveries.slice(-14).map((item, i, all) => ({ label: String(i - all.length + 1), value: item?.score ?? 0 })),
      strainTrend: result.strains.slice(-14).map(item => ({ label: item.date.slice(5), value: item.strain })),
    };
  } catch { return base; }
}

export function readMoment(now: number = Date.now()): Moment {
  const date = new Date(now), day = today(now), phase = phaseOf(date.getHours());
  const start = new Date(day + "T00:00:00").getTime();

  const all = listTasks(), open = all.filter(task => !task.done);
  const due = open.filter(task => task.due && task.due <= day);
  const chosen = chosenTask();
  const ordered = [...due.filter(task => task.uid === chosen?.uid), ...due.filter(task => task.uid !== chosen?.uid)];

  const thoughts = openThoughts();
  const ready = thoughts.filter(item => item.due > 0 && item.due <= now);

  const events = agenda.all();
  const next = events.find(event => event.when + event.minutes * MINUTE >= now) ?? null;
  const todays = events.filter(event => today(event.when) === day);

  const notes = listNotes();

  const session = focusSession(now);
  return {
    focus: session ? { uid: session.uid, taskUid: session.task_uid, title: session.title, state: focusRemaining(session, now) <= 0 ? "done" : session.enabled ? "running" : "paused" } : null,
    now: { phase, time: clock(now), weekday: date.toLocaleDateString([], { weekday: "long" }), date: date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }), greeting: GREETING[phase] },
    tasks: {
      open: open.length, due: due.length, overdue: due.filter(task => task.due < day).length,
      doneToday: all.filter(task => task.done && task.updated >= start).length,
      chosen: chosen && !chosen.done ? { uid: chosen.uid, text: chosen.text } : null,
      list: ordered.slice(0, 8).map(task => ({ uid: task.uid, text: task.text, due: task.due, important: task.important, overdue: task.due < day })),
    },
    thoughts: {
      open: thoughts.length, ready: ready.length,
      list: [...ready, ...thoughts.filter(item => !ready.includes(item))].slice(0, 5).map(item => ({ id: item.id, text: item.text, ready: ready.includes(item) })),
    },
    agenda: {
      next: next ? { uid: next.uid, taskUid: next.task_uid, title: next.title, time: clock(next.when), inMinutes: Math.round((next.when - now) / MINUTE), minutes: next.minutes } : null,
      today: todays.map(event => ({
        time: clock(event.when), title: event.title, minutes: event.minutes,
        past: event.when + event.minutes * MINUTE < now, now: event.when <= now && now < event.when + event.minutes * MINUTE,
      })),
    },
    movement: movement(now),
    notes: { count: notes.length, recent: notes.slice(0, 3).map(note => ({ uid: note.uid, title: noteTitle(note) })) },
  };
}

/**
 * What makes a moment different enough to arrange the surface again: the phase of the day, and the shape of
 * what is due and next. Ticking a task off changes the data the surface shows, not this key.
 */
export function momentKey(moment: Moment, day: string = today()): string {
  return ["today-actions-v1", day, moment.now.phase, Boolean(moment.focus), moment.tasks.due > 0, moment.tasks.overdue > 0, moment.agenda.next?.title ?? "", moment.thoughts.ready > 0, moment.movement.recovery != null].join("|");
}
