import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createNote, getNote, listNotes } from "../../data/notes.ts";
import { openThoughts } from "../../data/thoughts.ts";
import { useNoteEditor } from "./useNoteEditor.ts";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("useNoteEditor", () => {
  it("creates a fresh note under its uid on the first save, keeping a draft until then", () => {
    const { result } = renderHook(() => useNoteEditor("n-1", true));
    expect(result.current.exists).toBe(true);
    expect(result.current.stored).toBe(false);

    act(() => result.current.edit("# Groceries", 0));
    expect(localStorage.getItem("pocket:note-draft:n-1")).toBe("# Groceries");
    act(() => { vi.advanceTimersByTime(600); });

    expect(getNote("n-1")?.text).toBe("# Groceries");
    expect(result.current.stored).toBe(true);
    expect(result.current.status).toBe("saved");
    expect(localStorage.getItem("pocket:note-draft:n-1")).toBeNull();
  });

  it("reports a missing note that is not fresh as deleted", () => {
    const { result } = renderHook(() => useNoteEditor("gone", false));
    expect(result.current.exists).toBe(false);
  });

  it("restores a draft over the saved text and saves on unmount", () => {
    const note = createNote("old");
    localStorage.setItem("pocket:note-draft:" + note.uid, "newer draft");
    const { result, unmount } = renderHook(() => useNoteEditor(note.uid));
    expect(result.current.text).toBe("newer draft");
    expect(result.current.status).toBe("draft");

    unmount();
    expect(getNote(note.uid)?.text).toBe("newer draft");
  });

  it("parks a finished thought line and counts it", () => {
    const note = createNote("# Day");
    const { result } = renderHook(() => useNoteEditor(note.uid));
    act(() => result.current.edit("# Day\n>> book dentist\n", 2));
    act(() => { vi.advanceTimersByTime(600); });
    expect(result.current.parked).toBe(1);
    expect(openThoughts().map(item => item.text)).toEqual(["book dentist"]);
  });

  it("does not create an empty note", () => {
    const { unmount } = renderHook(() => useNoteEditor("n-2", true));
    unmount();
    expect(listNotes()).toHaveLength(0);
  });
});
