import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chats } from "../../data/chats.ts";
import { FREE_ROUTER, loadFreeModels } from "../../data/openrouter-models.ts";
import { connect } from "../../data/models.ts";
import { ModelPicker } from "./ModelPicker.tsx";

vi.mock("../../data/openrouter-models.ts", async original => ({ ...(await original<typeof import("../../data/openrouter-models.ts")>()), loadFreeModels: vi.fn() }));
const model = { id: "example/tool-model:free", name: "Tool model", context: 128000, maxOutput: 8192, tools: true, reasoning: true, vision: false, description: "" };
beforeEach(async () => { await connect("openrouter", "test-key-12345678"); vi.mocked(loadFreeModels).mockResolvedValue([FREE_ROUTER, model, { ...model, id: "example/no-tools:free", name: "No tools", tools: false }]); });

describe("composer model picker", () => {
  it("offers connected providers and disables disconnected ones", async () => {
    await connect("opencode", "test-key-12345678");
    const chat = chats.create();
    render(<ModelPicker chat={chat} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
    const choice = await screen.findByRole("button", { name: /GLM 5.3/ });
    await waitFor(() => expect(choice.hasAttribute("disabled")).toBe(false));
    expect(screen.getByRole("button", { name: /Claude Sonnet 5.5.*Anthropic/ }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(choice);
    expect(chats.get(chat.uid)?.config.model).toBe("glm-5.3");
  });
  it("searches the live list, shows capabilities, and applies a choice to the chat", async () => {
    const chat = chats.create();
    render(<ModelPicker chat={chat} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
    const choice = await screen.findByRole("button", { name: /Tool model/ });
    expect(choice.textContent).toContain("128k"); expect(choice.textContent).toContain("reasoning");
    expect(screen.getByRole("button", { name: /No tools/ }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Search models" }), { target: { value: "tool-model" } });
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
