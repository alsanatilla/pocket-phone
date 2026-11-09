import { access, saveAccess } from "../../client/pip-tools.js";
import { config } from "../../client/pip-core.js";
import { chats } from "./chats.ts";
import { readProfile, saveProfile } from "./ai.ts";
import type { FreeModel } from "./openrouter-models.ts";

export function selectFreeModel(chatId: string, model: FreeModel): void {
  if (!model.tools || !(model.id === "openrouter/free" || model.id.endsWith(":free"))) throw new Error("Choose a free model with tool support for Pip.");
  const chat = chats.get(chatId);
  if (!chat) throw new Error("This chat is no longer available.");
  const granted = access(chat.config);
  const next = config({ ...chat.config, provider: "compatible", baseUrl: "https://openrouter.ai/api/v1", model: model.id, thinking: false,
    maxTokens: Math.min(chat.config.maxTokens, model.maxOutput ?? chat.config.maxTokens) });
  saveAccess(next, granted);
  chats.update(chatId, value => { value.config = next; });
  saveProfile({ ...readProfile(), provider: "openrouter", tier: "light", freeModel: model.id, web: next.webSearch });
}
