import { describe, expect, it } from "vitest";
import { chats } from "../../data/chats.ts";
import { createNote } from "../../data/notes.ts";
import { createTask } from "../../data/tasks.ts";
import { findAnything, foundCount } from "./chat-search.ts";

// The sheet's field finds what the person keeps: chats first, then notes and tasks, then the pages themselves.

function seedChat(title: string, text: string, home = false): string {
  const created = chats.create();
  chats.update(created.uid, chat => {
    chat.title = title;
    if (home) { chat.home = true; chat.titled = true; }
    chat.turns.push({ uid: title + "-turn", text, answer: "", created: 1, status: "done" });
  });
  return created.uid;
}

describe("finding things from the chats sheet", () => {
  it("finds a chat by its name, with the words around the match", () => {
    seedChat("Training plan", "The half marathon is in April.");
    seedChat("Groceries", "Oat milk and coffee.");

    const found = findAnything("training");
    expect(found?.chats.map(hit => hit.title)).toEqual(["Training plan"]);
    expect(found?.chats[0]!.uid).toBeTruthy();
    expect(found?.notes).toEqual([]);
    expect(found?.tasks).toEqual([]);
  });

  it("finds what a chat said, not only its name", () => {
    seedChat("Groceries", "Oat milk and coffee.");
    expect(findAnything("milk")?.chats.map(hit => hit.title)).toEqual(["Groceries"]);
  });

  it("shows the big chat once, whatever it has been split into", () => {
    seedChat("pip", "The dentist is on Monday.", true);
    seedChat("pip", "Also book the dentist for June.", true);

    const found = findAnything("dentist");
    expect(found?.chats).toHaveLength(1);
    expect(found?.chats[0]!.uid).toBe("home");
    expect(found?.chats[0]!.title).toBe("pip");
  });

  it("finds notes and tasks by their words", () => {
    createNote("Roof repair\nAsk the neighbour about the leak.");
    createTask("Renew the passport", { due: "2026-11-20" });

    const found = findAnything("leak");
    expect(found?.notes).toHaveLength(1);
    expect(found?.notes[0]!.title).toBe("Roof repair");
    expect(found?.notes[0]!.snippet).toContain("neighbour");
    expect(found?.notes[0]!.snippet).not.toContain("Roof repair");
    expect(found?.tasks).toEqual([]);

    // When the name is the whole thing, the row does not say it twice.
    expect(findAnything("passport")?.tasks[0]!.title).toBe("Renew the passport");
    expect(findAnything("passport")?.tasks[0]!.snippet).toBe("");
  });

  it("counts the pages that answer to a word as places to go", () => {
    const found = findAnything("job");
    expect(found?.pages.map(hit => hit.title)).toEqual(["jobs"]);
    expect(foundCount(found!)).toBe(found!.pages.length);
  });

  it("has nothing to show for an empty query", () => {
    expect(findAnything("")).toBeNull();
    expect(findAnything("   ")).toBeNull();
  });
});
