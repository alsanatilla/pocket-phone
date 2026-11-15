import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipActivity } from "./PipActivity.tsx";

afterEach(() => vi.useRealTimers());

describe("Pip's activity", () => {
  it("follows the run phase, including tool work and a still waiting state", () => {
    const view = render(<PipActivity active phase="requesting" status="streaming" />);
    expect(screen.getByRole("status").textContent).toBe("thinking");
    view.rerender(<PipActivity active phase="reading notes" status="streaming" />);
    expect(screen.getByRole("status").dataset.pipActivity).toBe("working");
    expect(screen.getByRole("status").textContent).toBe("reading notes");
    view.rerender(<PipActivity active phase="waiting for your approval" status="streaming" />);
    expect(screen.getByRole("status").dataset.pipActivity).toBe("waiting");
    view.rerender(<PipActivity active phase="writing" status="streaming" />);
    expect(screen.getByRole("status").textContent).toBe("replying");
  });

  it("briefly acknowledges only a successfully completed live reply", () => {
    vi.useFakeTimers();
    const view = render(<PipActivity active phase="writing" status="streaming" />);
    view.rerender(<PipActivity active={false} phase="done" status="done" />);
    expect(screen.getByRole("status").textContent).toBe("replied");
    act(() => vi.advanceTimersByTime(1600));
    expect(screen.queryByRole("status")).toBeNull();
    view.rerender(<PipActivity active phase="thinking" status="streaming" />);
    view.rerender(<PipActivity active={false} phase="failed" status="failed" />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not replay a reaction when reading old messages", () => {
    render(<PipActivity active={false} phase="done" status="done" />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
