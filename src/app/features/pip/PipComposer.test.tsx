import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
vi.mock("../../ui/toast/toast.ts", () => ({ toast: vi.fn(), toastError: vi.fn(), clearToast: vi.fn() }));
import { chats } from "../../data/chats.ts";
import { PipComposer } from "./PipComposer.tsx";

// While a reply runs, a chat on the server takes the next message (it waits its turn there); a chat that answers in
// this tab keeps the field closed to sending until the reply ends, as before.
describe("the message field while Pip replies", () => {
  it("sends while a reply runs when the chat can queue, next to the stop key", async () => {
    const chat = chats.create(), onSend = vi.fn(() => Promise.resolve());
    render(<PipComposer chat={chat} busy queueing onSend={onSend} onStop={() => {}} />);
    fireEvent.change(screen.getByLabelText("Message Pip"), { target: { value: "And then the next thing." } });
    expect(screen.getByRole("button", { name: "Stop the reply" })).toBeTruthy();
    await act(async () => { fireEvent.keyDown(screen.getByLabelText("Message Pip"), { key: "Enter" }); });
    expect(onSend).toHaveBeenCalledWith("And then the next thing.");
  });

  it("does not send while a reply runs in this tab", async () => {
    const chat = chats.create(), onSend = vi.fn(() => Promise.resolve());
    render(<PipComposer chat={chat} busy onSend={onSend} onStop={() => {}} />);
    fireEvent.change(screen.getByLabelText("Message Pip"), { target: { value: "Not yet." } });
    expect(screen.queryByRole("button", { name: /^Send/ })).toBeNull();
    await act(async () => { fireEvent.keyDown(screen.getByLabelText("Message Pip"), { key: "Enter" }); });
    expect(onSend).not.toHaveBeenCalled();
  });
});
