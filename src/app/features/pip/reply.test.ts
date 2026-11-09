import { describe, expect, it } from "vitest";
import type { ChatTurn } from "../../data/chats.ts";
import { changeLabel, ledger, ledgerTitle, offersOf, planOf, sourcesOf } from "./reply.ts";

const row = (fields: Record<string, unknown>) => ({ id: String(Math.random()), name: "search_tasks", title: "Tasks", state: "done", started: 1, ended: 2, ...fields });
const turn = (activity: unknown[], extra: Partial<ChatTurn> = {}): ChatTurn => ({ uid: "t", text: "q", answer: "a", created: 1, status: "done", activity: activity as ChatTurn["activity"], ...extra });

describe("a reply's parts", () => {
  it("finds proposals, changes and waiting approvals, and marks what was saved", () => {
    const rows = ledger(turn([
      row({ result: JSON.stringify({ proposal: { kind: "task", title: "Call the clinic", text: "" } }), applied_href: "/tasks/x" }),
      row({ result: JSON.stringify({ kind: "change", change: { change: "complete_task", id: "a" }, before: { title: "Old bill" } }) }),
      row({ name: "create_record", state: "awaiting", result: JSON.stringify({ action: { title: "Dentist" } }), input: JSON.stringify({ kind: "appointment", title: "Dentist" }) }),
      row({ result: JSON.stringify({ found: 3 }) }),
    ]), false);
    const offers = offersOf(rows);
    expect(offers.map(offer => offer.type)).toEqual(["create", "change", "approval"]);
    expect(offers[0]).toMatchObject({ saved: "/tasks/x" });
    expect(offers[2]).toMatchObject({ title: "Dentist", input: { kind: "appointment" } });
    expect(changeLabel({ change: "complete_task", id: "a" })).toBe("mark done");
  });

  it("shows a reply that stopped mid-way as interrupted, not still running", () => {
    const rows = ledger(turn([row({ state: "running" })], { status: "streaming" }), false);
    expect(rows[0]!.state).toBe("stopped");
    expect(ledgerTitle(rows)).not.toMatch(/◌/);
  });

  it("keeps the latest plan and each source once", () => {
    const rows = ledger(turn([
      row({ result: JSON.stringify({ plan: [{ text: "old", status: "done" }] }) }),
      row({ result: JSON.stringify({ plan: [{ text: "look up tasks", status: "done" }, { text: "suggest an order", status: "in_progress" }, { bad: true }] }), sources: [{ href: "/tasks/a", title: "A" }] }),
    ]), false);
    expect(planOf(rows).map(step => step.text)).toEqual(["look up tasks", "suggest an order"]);
    expect(sourcesOf(turn([], { sources: [{ href: "/tasks/a", title: "A" }, { href: "https://example.com/", title: "B" }] }), rows)).toHaveLength(2);
  });
});
