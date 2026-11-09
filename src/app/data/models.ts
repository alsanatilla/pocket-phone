import { config, saveSettings, settings, type PipConfig } from "../../client/pip-core.js";
import { forget, save, status, type KeyStatus } from "../../client/pip-credentials.js";
import { access, saveAccess } from "../../client/pip-tools.js";
import { chats } from "./chats.ts";
import { readProfile, PROVIDERS } from "./ai.ts";

// Two separate things: connections (settings: which model accounts Pocket may use, with a key on the account) and
// the model of a chat (chosen in the chat). Connecting never changes a chat. Choosing a model changes that chat, and
// new chats start with the model chosen last. Today and Pip's jobs use that same last choice.

export type ProviderKey = "opencode" | "openrouter" | "anthropic" | "custom";
export const PROVIDER_KEYS: ProviderKey[] = ["opencode", "openrouter", "anthropic", "custom"];

export interface ModelChoice {
  provider: ProviderKey;
  id: string;
  name: string;
  /** One line on what it is good for. */
  note?: string;
  /** Reasoning on by default: the strongest models think before they answer. */
  thinking?: boolean;
  context?: number | null;
  maxOutput?: number | null;
  tools?: boolean;
  reasoning?: boolean;
  vision?: boolean;
  free?: boolean;
}

/** The models Pocket offers for each account. OpenRouter adds its current free models, loaded live. */
export const CURATED: Record<Exclude<ProviderKey, "custom">, ModelChoice[]> = {
  opencode: [
    { provider: "opencode", id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", note: "fast, for everyday questions" },
    { provider: "opencode", id: "glm-5.3", name: "GLM 5.3", note: "thoughtful, a good default" },
    { provider: "opencode", id: "kimi-k3.1-pro", name: "Kimi K3.1 Pro", note: "strongest, thinks first", thinking: true, reasoning: true },
  ],
  openrouter: [
    { provider: "openrouter", id: "anthropic/claude-haiku-5.5", name: "Claude Haiku 5.5", note: "fast, paid" },
    { provider: "openrouter", id: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5", note: "thoughtful, paid" },
    { provider: "openrouter", id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5", note: "strongest, paid, thinks first", thinking: true, reasoning: true },
  ],
  anthropic: [
    { provider: "anthropic", id: "claude-haiku-5-5", name: "Claude Haiku 5.5", note: "fast" },
    { provider: "anthropic", id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", note: "thoughtful, a good default" },
    { provider: "anthropic", id: "claude-opus-5-5", name: "Claude Opus 5.5", note: "strongest, thinks first", thinking: true, reasoning: true },
  ],
};

export const PROVIDER_NAMES: Record<ProviderKey, string> = { opencode: "OpenCode Go", openrouter: "OpenRouter", anthropic: "Anthropic", custom: "Your endpoint" };

// An OpenAI-compatible endpoint of the person's own, with its one model.
const CUSTOM = "pocket:ai-custom";
export function customEndpoint(): { baseUrl: string; model: string } | null {
  try { const value = JSON.parse(localStorage.getItem(CUSTOM) || "null"); return value?.baseUrl && value?.model ? value : readProfile().custom ?? null; } catch { return null; }
}
export function saveCustomEndpoint(value: { baseUrl: string; model: string } | null): void {
  if (!value) { localStorage.removeItem(CUSTOM); return; }
  const validated = config({ ...defaultConfig(), provider: "compatible", baseUrl: value.baseUrl, model: value.model }); // checks the URL and model ID
  localStorage.setItem(CUSTOM, JSON.stringify({ baseUrl: validated.baseUrl, model: validated.model }));
}

/** Where an account's key belongs (the key vault is per endpoint). */
export function targetOf(provider: ProviderKey): Pick<PipConfig, "provider" | "baseUrl"> {
  if (provider === "custom") {
    const custom = customEndpoint();
    if (!custom) throw new Error("Enter an endpoint first.");
    return { provider: "compatible", baseUrl: custom.baseUrl };
  }
  return { provider: PROVIDERS[provider].provider, baseUrl: PROVIDERS[provider].baseUrl };
}

/** Which account a chat's model belongs to. */
export function providerOf(value: Pick<PipConfig, "provider" | "baseUrl">): ProviderKey {
  if (value.provider === "anthropic") return "anthropic";
  if (value.baseUrl === PROVIDERS.opencode.baseUrl) return "opencode";
  if (value.baseUrl === PROVIDERS.openrouter.baseUrl) return "openrouter";
  return "custom";
}

export const connectionOf = (provider: ProviderKey): Promise<KeyStatus> =>
  provider === "custom" && !customEndpoint() ? Promise.resolve({ mode: "account", saved: false, hint: "" }) : status(targetOf(provider));
export const isConnected = (value: KeyStatus) => Boolean(value.saved || value.tab);

/** The model Pocket uses outside a chat (Today, Pip's jobs) and for new chats: the one chosen last. */
export function defaultConfig(): PipConfig {
  try { return settings(); } catch { return config(); }
}

/** A chat's settings with another model; everything else (web, reply limit) stays as the chat had it. */
export function configWith(base: PipConfig, choice: Pick<ModelChoice, "provider" | "id" | "thinking" | "maxOutput">): PipConfig {
  const target = targetOf(choice.provider);
  return config({ ...base, ...target, model: choice.id, thinking: Boolean(choice.thinking),
    maxTokens: choice.maxOutput ? Math.min(base.maxTokens, choice.maxOutput) : base.maxTokens });
}

/**
 * Gives one chat another model. What Pip may read carries over (it is kept per endpoint), and new chats start with
 * this model. Other chats keep theirs.
 */
export function chooseModel(chatId: string, choice: ModelChoice): void {
  if (choice.tools === false) throw new Error("Pip needs a model that can use tools.");
  const chat = chats.get(chatId);
  if (!chat) throw new Error("This chat is no longer available.");
  const granted = access(chat.config), next = configWith(chat.config, choice);
  saveAccess(next, granted);
  chats.update(chatId, value => { value.config = next; });
  saveSettings(next);
}

/** Connecting only stores credentials; model selection belongs to the chat. */
export async function connect(provider: ProviderKey, key: string): Promise<void> {
  await save(targetOf(provider), key);
}
export const disconnect = (provider: ProviderKey) => forget(targetOf(provider));

/** "anthropic/claude-sonnet-5.5" → "Sonnet 5.5"; Pocket's own picks keep their names. */
export function modelLabel(id: string): string {
  for (const list of Object.values(CURATED)) { const known = list.find(item => item.id === id); if (known) return known.name.replace(/^Claude /, ""); }
  if (id === "openrouter/free") return "Auto · free models";
  const match = /(haiku|sonnet|opus)[-.]?([\d.-]+)?/i.exec(id);
  if (!match) return id.replace(/:free$/, "");
  return match[1]![0]!.toUpperCase() + match[1]!.slice(1) + (match[2] ? " " + match[2].replace(/-/g, ".") : "");
}
