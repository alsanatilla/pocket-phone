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
  it("offers connected accounts' models, and one line to connect each other account", async () => {
    await connect("opencode", "test-key-12345678");
    const chat = chats.create();
    render(<ModelPicker chat={chat} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
    const choice = await screen.findByRole("button", { name: /GLM 5.3/ });
    await waitFor(() => expect(choice.hasAttribute("disabled")).toBe(false));
    // Anthropic is not connected: no models from it, one line that leads to connecting it.
    // (Claude through OpenRouter, which is connected, stays: only the Anthropic account's own group goes.)
    expect(screen.queryByRole("heading", { name: "Anthropic" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /Claude Sonnet 5.5/ })).toHaveLength(1);
    expect((await screen.findByRole("link", { name: /Anthropic.*connect/ })).getAttribute("href")).toBe("/#/settings");
    fireEvent.click(choice);
    expect(chats.get(chat.uid)?.config.model).toBe("glm-5.3");
  });
  it("searches the live list, shows capabilities, and applies a choice to the chat", async () => {
    const chat = chats.create();
    render(<ModelPicker chat={chat} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
    const choice = await screen.findByRole("button", { name: /Tool model/ });
    expect(choice.textContent).toContain("128k"); expect(choice.querySelector('[aria-label="reasons first"]')).toBeTruthy();
    // A model without tools is shown, but it is not a key: it cannot be pressed.
    expect(screen.getByText("No tools")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /No tools/ })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Search models" }), { target: { value: "tool-model" } });
    expect(screen.queryByText("No tools")).toBeNull();
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
    expect(screen.getByRole("switch", { name: "Web search" }).hasAttribute("disabled")).toBe(true);
  });
});
