import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("../../client/cloud.js", () => ({ connected: vi.fn(() => true), account: vi.fn(() => ({ id: "user-a", email: "a@example.com" })) }));
vi.mock("../../client/live.js", () => {
  const listeners = new Set<(message: unknown) => void>();
  return { connected: vi.fn(() => false), on: vi.fn((listener: (message: unknown) => void) => { listeners.add(listener); return () => listeners.delete(listener); }),
    emit: (message: unknown) => listeners.forEach(listener => listener(message)), count: () => listeners.size };
});
vi.mock("../../client/pip-remote.js", () => ({ assignmentList: vi.fn(), stopAssignment: vi.fn(), retryAssignment: vi.fn() }));

import * as cloud from "../../client/cloud.js";
import * as liveSocket from "../../client/live.js";
import { assignmentList, retryAssignment, stopAssignment, type Assignment, type AssignmentList } from "../../client/pip-remote.js";
import { latestOf, resetAssignments, retry, stop, useAssignments } from "./assignments.ts";

// The shared list of assignments and decisions: read while a view uses it, again when the socket says a run moved,
// polled only without the socket while something works, and never shown to another account.

const socket = liveSocket as unknown as { emit: (message: unknown) => void; count: () => number };
const item = (id: string, fields: Partial<Assignment> = {}): Assignment => ({ id, title: "Bike prices", state: "working", created: 1, started: 1, ended: 0, origin: null, report: null, error: "", lookups: 0, retryOf: "", retried: "", ...fields });
const answer = (accountId: string, assignments: Assignment[]): AssignmentList => ({ accountId, assignments, decisions: [] });
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

beforeEach(() => {
  vi.useFakeTimers();
  resetAssignments();
  vi.mocked(cloud.connected).mockReturnValue(true);
  vi.mocked(cloud.account).mockReturnValue({ id: "user-a", email: "a@example.com" });
  vi.mocked(liveSocket.connected).mockReturnValue(false);
  vi.mocked(assignmentList).mockReset();
});
afterEach(() => { resetAssignments(); vi.useRealTimers(); });

describe("the assignments list", () => {
  it("is read when a view opens and stops everything it started when the last one leaves", async () => {
    vi.mocked(assignmentList).mockResolvedValue(answer("user-a", [item("a1")]));
    const view = renderHook(() => useAssignments());
    await settle();
    expect(view.result.current.status).toBe("ready");
    expect(view.result.current.assignments.map(entry => entry.id)).toEqual(["a1"]);
    expect(socket.count()).toBe(1);
    view.unmount();
    expect(socket.count()).toBe(0);
    // Nothing reads it again once nothing shows it, also not the poll that was due.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(assignmentList).toHaveBeenCalledTimes(1);
  });

  it("without the socket, reads again while something works and the tab is visible, and stops once all have ended", async () => {
    vi.mocked(assignmentList).mockResolvedValue(answer("user-a", [item("a1")]));
    const view = renderHook(() => useAssignments());
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(assignmentList).toHaveBeenCalledTimes(2);
    vi.mocked(assignmentList).mockResolvedValue(answer("user-a", [item("a1", { state: "done", ended: 2 })]));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(view.result.current.assignments[0]!.state).toBe("done");
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(assignmentList).toHaveBeenCalledTimes(3);
    view.unmount();
  });

  it("with the socket, never polls: a run's step reads it again, once for a burst, and a text delta does not", async () => {
    vi.mocked(liveSocket.connected).mockReturnValue(true);
    vi.mocked(assignmentList).mockResolvedValue(answer("user-a", [item("a1")]));
    const view = renderHook(() => useAssignments());
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(assignmentList).toHaveBeenCalledTimes(1);
    act(() => { socket.emit({ type: "event", event: "run", data: { runId: "a1", kind: "delta" } }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(assignmentList).toHaveBeenCalledTimes(1);
    act(() => {
      socket.emit({ type: "event", event: "run", data: { runId: "a1", kind: "done" } });
      socket.emit({ type: "event", event: "run", data: { runId: "a2", kind: "started" } });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(assignmentList).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it("belongs to one account: another account starts empty, and an answer for the one before is dropped", async () => {
    vi.mocked(liveSocket.connected).mockReturnValue(true);
    vi.mocked(assignmentList).mockResolvedValue(answer("user-a", [item("mine")]));
    const view = renderHook(() => useAssignments());
    await settle();
    expect(view.result.current.assignments).toHaveLength(1);

    // Another account signs in on this tab while a read for the first one is still under way.
    let late: (value: AssignmentList) => void = () => {};
    vi.mocked(assignmentList).mockImplementationOnce(() => new Promise(resolve => { late = resolve; }));
    vi.mocked(cloud.account).mockReturnValue({ id: "user-b", email: "b@example.com" });
    view.rerender();
    expect(view.result.current.assignments).toEqual([]);
    act(() => { socket.emit({ type: "hello", accountId: "user-b", at: 1 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(view.result.current).toMatchObject({ account: "user-b", status: "loading", assignments: [] });
    await act(async () => { late(answer("user-a", [item("mine")])); await vi.advanceTimersByTimeAsync(0); });
    expect(view.result.current.assignments).toEqual([]);

    vi.mocked(cloud.connected).mockReturnValue(false);
    act(() => { socket.emit({ type: "closed" }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(view.result.current.status).toBe("signed-out");
    view.unmount();
  });

  it("says when it cannot be read and keeps what it showed", async () => {
    vi.mocked(assignmentList).mockRejectedValueOnce(new Error("Pocket could not be reached."));
    const view = renderHook(() => useAssignments());
    await settle();
    expect(view.result.current).toMatchObject({ status: "failed", error: "Pocket could not be reached." });
    vi.mocked(assignmentList).mockResolvedValue(answer("user-a", [item("a1")]));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(view.result.current).toMatchObject({ status: "ready", error: "" });
    vi.mocked(assignmentList).mockRejectedValueOnce(new Error("Dropped."));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(view.result.current).toMatchObject({ status: "ready", error: "Dropped." });
    expect(view.result.current.assignments).toHaveLength(1);
    view.unmount();
  });

  it("stop and try again show the server's answer", async () => {
    vi.mocked(liveSocket.connected).mockReturnValue(true);
    vi.mocked(assignmentList).mockResolvedValue(answer("user-a", [item("a1")]));
    const view = renderHook(() => useAssignments());
    await settle();
    vi.mocked(stopAssignment).mockResolvedValue(answer("user-a", [item("a1", { state: "stopped" })]));
    await act(async () => { await stop("a1"); });
    expect(stopAssignment).toHaveBeenCalledWith("a1");
    expect(view.result.current.assignments[0]!.state).toBe("stopped");
    vi.mocked(retryAssignment).mockResolvedValue(answer("user-a", [item("a2", { retryOf: "a1" }), item("a1", { state: "stopped", retried: "a2" })]));
    await act(async () => { await retry("a1"); });
    const list = view.result.current.assignments;
    expect(latestOf(list.find(entry => entry.id === "a1")!, list).id).toBe("a2");
    view.unmount();
  });
});
