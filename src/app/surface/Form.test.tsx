import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Form } from "./components.tsx";

// A form card asks for several answers at once; what the person sends is one ordinary message to Pip.

describe("form card", () => {
  it("sends the filled fields as one message", () => {
    const ask = vi.fn();
    render(<Form title="Your week" fields={[
      { name: "bedtime", label: "Bedtime", type: "text", required: true },
      { name: "runs", label: "Runs", type: "number", required: false },
      { name: "surface", label: "Where", type: "choice", options: ["Road", "Trail"], required: true },
    ]} submitLabel="send answers" onAsk={ask} />);
    fireEvent.change(screen.getByLabelText("Bedtime"), { target: { value: "22:30" } });
    fireEvent.change(screen.getByLabelText("Runs"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Where"), { target: { value: "Trail" } });
    fireEvent.click(screen.getByRole("button", { name: "send answers" }));
    expect(ask).toHaveBeenCalledWith("Your week\nBedtime: 22:30\nRuns: 2\nWhere: Trail");
  });

  it("waits for the fields that are required", () => {
    const ask = vi.fn();
    render(<Form fields={[{ name: "name", label: "Name", type: "text", required: true }]} onAsk={ask} />);
    const send = screen.getByRole("button", { name: "send" });
    expect(send).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sam" } });
    expect(send).toHaveProperty("disabled", false);
    fireEvent.click(send);
    expect(ask).toHaveBeenCalledWith("Name: Sam");
  });

  it("leaves out a field the person left empty", () => {
    const ask = vi.fn();
    render(<Form fields={[
      { name: "note", label: "Note", type: "text", required: false },
      { name: "when", label: "When", type: "text", required: false },
    ]} onAsk={ask} />);
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Long run" } });
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    expect(ask).toHaveBeenCalledWith("Note: Long run");
  });
});
