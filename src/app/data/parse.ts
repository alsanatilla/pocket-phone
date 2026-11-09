import { addDays, dayOffset } from "./lists.ts";
import { today } from "./tasks.ts";
import type { TaskList } from "./types.ts";

// Task properties written where the task is written: "call the bank tomorrow !", "pack for lisbon in 3 days
// #travel". The token is taken out of the text and becomes the property; anything not recognised stays prose.

export interface ParsedTask {
  /** The text with the recognised tokens removed. */
  text: string;
  due?: string;
  important?: boolean;
  list?: string;
  /** What was recognised, for the line under the input. */
  labels: string[];
}

const WEEKDAYS: [string, number][] = [
  ["sunday", 0], ["sun", 0], ["sonntag", 0],
  ["monday", 1], ["mon", 1], ["montag", 1],
  ["tuesday", 2], ["tue", 2], ["tues", 2], ["dienstag", 2],
  ["wednesday", 3], ["wed", 3], ["mittwoch", 3],
  ["thursday", 4], ["thu", 4], ["thurs", 4], ["donnerstag", 4],
  ["friday", 5], ["fri", 5], ["freitag", 5],
  ["saturday", 6], ["sat", 6], ["samstag", 6],
];

const shortDay = (day: string) => new Date(day + "T12:00:00").toLocaleDateString([], { day: "numeric", month: "short" });
const inDays = (day: string, current: string): string => {
  const distance = dayOffset(current, day);
  if (distance === 0) return "today";
  if (distance === 1) return "tomorrow";
  return shortDay(day);
};

/** The next time that weekday comes round (today counts). */
function nextWeekday(weekday: number, current: string): string {
  const at = new Date(current + "T12:00:00");
  const distance = (weekday - at.getDay() + 7) % 7;
  return addDays(current, distance);
}

const isoDay = (year: number, month: number, day: number): string | null => {
  const value = new Date(year, month - 1, day, 12);
  if (value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

export function parseTask(input: string, options: { lists?: TaskList[]; now?: number } = {}): ParsedTask {
  const current = today(options.now);
  let text = String(input ?? "");
  const labels: string[] = [];
  let due: string | undefined;
  let important = false;
  let list: string | undefined;

  // #list — only when it names a list that exists, so a stray hashtag stays part of the task.
  text = text.replace(/(^|\s)#([\p{L}\d_-]+)(?=\s|$)/gu, (whole, space: string, name: string) => {
    const found = (options.lists ?? []).find(candidate => {
      const plain = candidate.name.toLowerCase().replace(/[^\p{L}\d]+/gu, "");
      return plain === name.toLowerCase().replace(/[^\p{L}\d]+/gu, "");
    });
    if (!found) return whole;
    list = found.uid;
    labels.push("# " + found.name);
    return space;
  });

  const take = (pattern: RegExp, resolve: (match: RegExpMatchArray) => string | null): void => {
    if (due) return;
    const match = text.match(pattern);
    if (!match) return;
    const day = resolve(match);
    if (!day) return;
    due = day;
    labels.push(inDays(day, current));
    text = text.slice(0, match.index) + " " + text.slice((match.index ?? 0) + match[0].length);
  };

  take(/\b(today|heute)\b/i, () => current);
  take(/\b(tomorrow|tmr|tmrw|morgen)\b/i, () => addDays(current, 1));
  take(/\b(übermorgen|ubermorgen)\b/i, () => addDays(current, 2));
  take(/\bin\s+(\d{1,3})\s+(?:days?|tagen?)\b/i, match => addDays(current, Number(match[1])));
  take(/\bnext\s+week\b/i, () => addDays(current, 7));
  take(/\bnächste\s+woche\b/i, () => addDays(current, 7));
  take(/\b(\d{4})-(\d{2})-(\d{2})\b/, match => isoDay(Number(match[1]), Number(match[2]), Number(match[3])));
  const germanDay = (day: string, month: string, year?: string): string | null => {
    const now = new Date(current + "T12:00:00").getFullYear();
    const found = isoDay(year ? Number(year) : now, Number(month), Number(day));
    if (!found) return null;
    // "9.11." in December means next year, not eleven months ago.
    return !year && found < current ? isoDay(now + 1, Number(month), Number(day)) : found;
  };
  take(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/, match => germanDay(match[1]!, match[2]!, match[3]));
  // A trailing dot is what makes "12.11." a date; without one, only an unambiguous day (13–31) counts, so
  // "run 3.5 km" stays a distance.
  take(/\b(\d{1,2})\.(\d{1,2})\.(?=\s|$)/, match => germanDay(match[1]!, match[2]!));
  take(/\b(1[3-9]|2\d|3[01])\.(\d{1,2})(?=\s|$)/, match => germanDay(match[1]!, match[2]!));
  take(new RegExp("\\b(" + WEEKDAYS.map(([name]) => name).join("|") + ")\\b", "i"), match => {
    const weekday = WEEKDAYS.find(([name]) => name === match[1]!.toLowerCase())![1];
    return nextWeekday(weekday, current);
  });

  if (/(^|\s)!(?=\s|$)/.test(text)) {
    important = true;
    labels.push("! important");
    text = text.replace(/(^|\s)!(?=\s|$)/g, "$1");
  } else if (/(^|\s)p1(?=\s|$)/i.test(text)) {
    important = true;
    labels.push("! important");
    text = text.replace(/(^|\s)p1(?=\s|$)/gi, "$1");
  }

  return { text: text.replace(/\s{2,}/g, " ").trim(), due, important, list, labels };
}
