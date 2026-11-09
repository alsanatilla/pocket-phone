import { describe, expect, it } from "vitest";
import { settings } from "../../client/pip-core.js";
import { chats } from "./chats.ts";
import { chooseModel, connect, disconnect, saveCustomEndpoint } from "./models.ts";

describe("connections and chat choices", () => {
  it("connecting, disconnecting and configuring an endpoint leave every chat and the default unchanged", async () => {
    const first = chats.create(), second = chats.create(), before = settings();
    await connect("openrouter", "test-key-123456789");
    await disconnect("openrouter");
    saveCustomEndpoint({ baseUrl: "https://models.example/v1", model: "my-model" });
    await connect("custom", "test-key-123456789");
    expect(settings()).toEqual(before);
    expect(chats.get(first.uid)).toEqual(first);
    expect(chats.get(second.uid)).toEqual(second);
    expect(chats.create().config).toEqual(before);
  });

  it("choosing a model affects that chat and new chats, while another chat keeps its config", () => {
    const first = chats.create(), second = chats.create();
    chats.update(first.uid, chat => { chat.draft = "keep me"; chat.config.webSearch = true; });
    chooseModel(first.uid, { provider: "opencode", id: "glm-5.3", name: "GLM" });
    expect(chats.get(first.uid)).toMatchObject({ draft: "keep me", config: { model: "glm-5.3", webSearch: true } });
    expect(chats.get(second.uid)).toEqual(second);
    expect(chats.create().config.model).toBe("glm-5.3");
  });
});
