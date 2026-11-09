import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chats } from "../../data/chats.ts";
import { FREE_ROUTER, loadFreeModels } from "../../data/openrouter-models.ts";
import { ModelPicker } from "./ModelPicker.tsx";

vi.mock("../../data/openrouter-models.ts", async original => ({ ...(await original<typeof import("../../data/openrouter-models.ts")>()), loadFreeModels: vi.fn() }));
const model = { id: "example/tool-model:free", name: "Tool model", context: 128000, maxOutput: 8192, tools: true, reasoning: true, vision: false, description: "" };
beforeEach(() => { vi.mocked(loadFreeModels).mockResolvedValue([FREE_ROUTER, model, { ...model, id: "example/no-tools:free", name: "No tools", tools: false }]); });

describe("composer model picker", () => {
  it("searches the live list, shows capabilities, and applies a choice to the chat", async () => {
    const chat = chats.create();
    render(<ModelPicker chat={chat} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
    const choice = await screen.findByRole("button", { name: /Tool model/ });
    expect(choice.textContent).toContain("128k context");
    expect(screen.getByRole("button", { name: /No tools/ }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Search free models" }), { target: { value: "tool-model" } });
    expect(screen.queryByRole("button", { name: /No tools/ })).toBeNull();
    fireEvent.click(choice);
    expect(chats.get(chat.uid)?.config.model).toBe(model.id);
  });

  it("offers retry and Auto when the catalog is unavailable", async () => {
    vi.mocked(loadFreeModels).mockRejectedValue(new Error("Offline"));
    render(<ModelPicker chat={chats.create()} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Auto · free models/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "retry" })).toBeTruthy();
  });

  it("locks provider and web changes while a reply runs", () => {
    render(<ModelPicker chat={chats.create()} busy />);
    expect(screen.getByRole("button", { name: "Choose model" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Web search" }).hasAttribute("disabled")).toBe(true);
  });
});
