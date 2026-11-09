import { describe, expect, it } from "vitest";
import { freeModels } from "./openrouter-models.ts";
import { selectFreeModel } from "./chat-models.ts";
import { chats } from "./chats.ts";
import { readProfile } from "./ai.ts";
import { access, saveAccess } from "../../client/pip-tools.js";

const row = { id: "example/small:free", name: "Small (free)", pricing: { prompt: "0", completion: "0" }, context_length: 128000,
  top_provider: { max_completion_tokens: 8192 }, supported_parameters: ["tools", "reasoning"], architecture: { input_modalities: ["text", "image"] } };

describe("OpenRouter free catalog", () => {
  it("excludes paid and incomplete prices and returns useful capability metadata", () => {
    const models = freeModels({ data: [row, { ...row, id: "paid/model" }, { ...row, id: "bad/model:free", pricing: { prompt: "0", completion: "0.001" } },
      { ...row, id: "missing/model:free", pricing: {} }, { ...row, id: "fee/model:free", pricing: { prompt: "0", completion: "0", request: "1" } }] });
    expect(models).toHaveLength(2);
    expect(models[0]?.id).toBe("openrouter/free");
    expect(models[1]).toMatchObject({ name: "Small", context: 128000, maxOutput: 8192, tools: true, reasoning: true, vision: true });
    expect(() => freeModels({ error: "unavailable" })).toThrow();
  });

  it("changes the current chat and new-chat default without discarding draft, history or grants", () => {
    const chat = chats.create();
    chats.update(chat.uid, value => { value.draft = "Keep this draft"; });
    saveAccess(chat.config, ["notes"]);
    selectFreeModel(chat.uid, freeModels({ data: [row] })[1]!);
    expect(chats.get(chat.uid)).toMatchObject({ draft: "Keep this draft", config: { model: row.id, baseUrl: "https://openrouter.ai/api/v1", thinking: false } });
    expect(access(chats.get(chat.uid)!.config)).toEqual(["notes"]);
    expect(readProfile()).toMatchObject({ provider: "openrouter", tier: "light", freeModel: row.id });
    expect(chats.create().config.model).toBe(row.id);
  });

  it("does not allow a paid or tool-less model to be selected", () => {
    const chat = chats.create(), model = freeModels({ data: [row] })[1]!;
    expect(() => selectFreeModel(chat.uid, { ...model, id: "paid/model" })).toThrow();
    expect(() => selectFreeModel(chat.uid, { ...model, tools: false })).toThrow();
    expect(chats.get(chat.uid)?.config).toEqual(chat.config);
  });
});
