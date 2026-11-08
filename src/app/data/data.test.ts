import { describe, expect, it } from "vitest";
import { createNote, noteExcerpt, searchNotes } from "./notes.ts";
import { initialSeen, noteThoughts, openThoughts, parkFinished, thoughtAnnotations } from "./thoughts.ts";
import { daySummary } from "./tasks.ts";
import type { Task } from "./types.ts";

const task = (fields: Partial<Task>): Task => ({ uid: crypto.randomUUID(), text: "t", done: false, due: "", important: false, steps: [], created: 1, updated: 1, deleted: false, ...fields });

describe("notes", () => {
  it("excerpts the prose after the title, without markers or thought lines", () => {
    const note = { text: "# Shopping\n\n- milk\n>> call Sam @tomorrow\n2. bread" };
    expect(noteExcerpt(note)).toBe("milk bread");
  });

  it("searches case-insensitively and returns everything for an empty query", () => {
    const list = [createNote("Alpha"), createNote("beta")];
    expect(searchNotes(list, "ALP").map(note => note.text)).toEqual(["Alpha"]);
    expect(searchNotes(list, "  ")).toHaveLength(2);
  });
});

describe("thought lines", () => {
  it("parks a line only once the cursor has left it", () => {
    const note = createNote("# Plan");
    const text = "# Plan\n>> call Sam @tomorrow";

    let state = parkFinished(note.uid, text, 1, false, initialSeen(note.uid, "# Plan"));
    expect(state.parked).toBe(0);
    expect(openThoughts()).toHaveLength(0);

    state = parkFinished(note.uid, text + "\n", 2, false, state.seen);
    expect(state.parked).toBe(1);
    expect(openThoughts().map(item => item.text)).toEqual(["call Sam"]);
    expect(openThoughts()[0]!.due).toBeGreaterThan(Date.now());
  });

  it("never parks an unchanged line twice, also after reopening the note", () => {
    const note = createNote("x");
    const text = ">> water plants\nnext";
    const first = parkFinished(note.uid, text, 1, true, initialSeen(note.uid, ""));
    expect(first.parked).toBe(1);

    const reopened = parkFinished(note.uid, text, 1, true, initialSeen(note.uid, text));
    expect(reopened.parked).toBe(0);
    expect(openThoughts()).toHaveLength(1);
  });

  it("reports each thought's state for chips and the preview", () => {
    const note = createNote(">> read the paper\n");
    parkFinished(note.uid, note.text, 1, true, initialSeen(note.uid, ""));
    expect(noteThoughts(note)).toEqual([{ text: "read the paper", state: "saved to thoughts" }]);
    expect(thoughtAnnotations(note.uid, note.text)).toEqual([{ line: 1, thought: { text: "read the paper", status: "saved to thoughts" } }]);
    expect(thoughtAnnotations(null, note.text)).toEqual([]);
  });
});

describe("daySummary", () => {
  it("counts open, due (today and overdue) and done", () => {
    const list = [task({ due: "2026-11-07" }), task({ due: "2026-11-08" }), task({ due: "2026-11-09" }), task({ due: "2026-11-01", done: true }), task({})];
    const summary = daySummary(list, "2026-11-08");
    expect(summary.open).toHaveLength(4);
    expect(summary.due.map(item => item.due)).toEqual(["2026-11-07", "2026-11-08"]);
    expect(summary.done).toBe(1);
  });
});
