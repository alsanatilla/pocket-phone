import { describe, expect, it } from "vitest";
import { classicHref, hrefFor, isClassicArea } from "./classic.ts";

describe("where a path opens", () => {
  it("keeps moved areas here and sends the rest to the classic app", () => {
    expect(hrefFor("/notes/abc")).toBe("#/notes/abc");
    expect(hrefFor("/pip?chat=1")).toBe("#/pip?chat=1");
    expect(hrefFor("/tasks/abc")).toBe("#/tasks/abc");
    expect(hrefFor("/tasks?view=inbox")).toBe("#/tasks?view=inbox");
    expect(hrefFor("calendar/new")).toBe("/classic#/calendar/new");
    expect(classicHref("/account")).toBe("/classic#/account");
  });

  it("knows which areas only the classic app has", () => {
    expect(isClassicArea("/travel/join/abc")).toBe(true);
    expect(isClassicArea("#/movement")).toBe(true);
    expect(isClassicArea("/today")).toBe(false);
    expect(isClassicArea("/nonsense")).toBe(false);
  });
});
