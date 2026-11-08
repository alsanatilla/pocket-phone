import { describe, expect, it, vi } from "vitest";
vi.mock("./toast/toast.ts", () => ({ toast: vi.fn(), toastError: vi.fn(), clearToast: vi.fn() }));
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DialogHost } from "./dialog/DialogHost.tsx";
import { choose, confirm, prompt } from "./dialog/dialog.ts";
import { Composer } from "./Composer.tsx";
import { toastError } from "./toast/toast.ts";

describe("dialogs", () => {
  it("confirm resolves true on its action and false on cancel", async () => {
    render(<DialogHost />);
    let answer: Promise<boolean>;
    act(() => { answer = confirm({ title: "Delete?", confirmLabel: "delete", danger: true }); });
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    await expect(answer!).resolves.toBe(true);

    act(() => { answer = confirm({ title: "Again?", confirmLabel: "yes" }); });
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    await expect(answer!).resolves.toBe(false);
  });

  it("prompt returns what was typed, choose the picked index", async () => {
    render(<DialogHost />);
    let typed: Promise<string | null>;
    act(() => { typed = prompt({ title: "Name", value: "Al" }); });
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Alma" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await expect(typed!).resolves.toBe("Alma");

    let picked: Promise<number | null>;
    act(() => { picked = choose({ title: "Revisit", options: ["tonight", "tomorrow"] }); });
    fireEvent.click(screen.getByRole("button", { name: "tomorrow" }));
    await expect(picked!).resolves.toBe(1);
  });

  it("opening a second dialog cancels the first", async () => {
    render(<DialogHost />);
    let first: Promise<boolean>;
    act(() => { first = confirm({ title: "One", confirmLabel: "ok" }); void confirm({ title: "Two", confirmLabel: "ok" }); });
    await expect(first!).resolves.toBe(false);
  });
});

describe("Composer", () => {
  it("clears on success and keeps the text when the action fails", async () => {
    const onSubmit = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("No key."));
    render(<Composer label="Message" placeholder="…" action="send" onSubmit={onSubmit} />);
    const field = screen.getByLabelText("Message") as HTMLInputElement;

    fireEvent.change(field, { target: { value: "hello" } });
    await act(async () => { fireEvent.submit(field.form!); });
    expect(onSubmit).toHaveBeenCalledWith("hello");
    expect(field.value).toBe("");

    fireEvent.change(field, { target: { value: "again" } });
    await act(async () => { fireEvent.submit(field.form!); });
    expect(field.value).toBe("again");
    expect(toastError).toHaveBeenCalledWith(new Error("No key."));
  });
});
