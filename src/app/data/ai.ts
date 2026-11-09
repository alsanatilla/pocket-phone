import { config, saveSettings, settings, type PipConfig } from "../../client/pip-core.js";
import { forget, save, status, type KeyStatus } from "../../client/pip-credentials.js";
import { access, saveAccess, type Category } from "../../client/pip-tools.js";

// Pocket's AI settings in the person's terms: who provides the model, how much AI to use, and what Pip may read.
// Everything technical (endpoint, model IDs, which model does which job) is derived here, so the settings screen
// never shows a model ID unless "advanced" is opened.

export type Provider = "openrouter" | "anthropic" | "custom";
export type Tier = "light" | "balanced" | "best";
/** The jobs Pocket gives a model: a conversation with Pip, or arranging a screen (fast and frequent). */
export type Job = "chat" | "surface";

export const PROVIDERS: Record<Exclude<Provider, "custom">, { name: string; baseUrl: string; provider: PipConfig["provider"] }> = {
  openrouter: { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", provider: "compatible" },
  anthropic: { name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", provider: "anthropic" },
};

/** Which model does which job at each tier. */
export const MODELS: Record<Exclude<Provider, "custom">, Record<Tier, Record<Job, string>>> = {
  openrouter: {
    light: { chat: "openrouter/free", surface: "openrouter/free" },
    balanced: { chat: "anthropic/claude-sonnet-5.5", surface: "anthropic/claude-haiku-5.5" },
    best: { chat: "anthropic/claude-opus-5.5", surface: "anthropic/claude-sonnet-5.5" },
  },
  anthropic: {
    light: { chat: "claude-haiku-5-5", surface: "claude-haiku-5-5" },
    balanced: { chat: "claude-sonnet-5-5", surface: "claude-haiku-5-5" },
    best: { chat: "claude-opus-5-5", surface: "claude-sonnet-5-5" },
  },
};

export const TIERS: Record<Tier, { name: string; blurb: string }> = {
  light: { name: "Light", blurb: "Fast and cheap. Free models through OpenRouter." },
  balanced: { name: "Balanced", blurb: "Thoughtful replies, quick screens. The default." },
  best: { name: "Best", blurb: "The strongest model for every reply, with reasoning." },
};

/** US$ per million tokens [input, output] for the models above (same for Anthropic and OpenRouter). */
export const PRICES: Record<string, [number, number]> = {
  "openrouter/free": [0, 0],
  haiku: [0.1, 0.5],
  sonnet: [2, 10],
  opus: [4, 20],
};
export function priceOf(model: string): [number, number] | null {
  if (model === "openrouter/free") return PRICES["openrouter/free"]!;
  const family = /haiku|sonnet|opus/.exec(model)?.[0];
  return family ? PRICES[family]! : null;
}

export interface AiProfile {
  provider: Provider;
  tier: Tier;
  /** Only for "custom": an OpenAI-compatible endpoint and its model. */
  custom?: { baseUrl: string; model: string };
  web: boolean;
  /** Let a model arrange Today by itself when the moment changes. */
  autoArrange: boolean;
}

const PROFILE = "pocket:ai-profile";

/** What the classic settings imply, for people who set Pip up before this screen existed. */
function inferred(current: PipConfig): AiProfile {
  const host = new URL(current.baseUrl).hostname;
  const provider: Provider = current.provider === "anthropic" ? "anthropic" : host === "openrouter.ai" ? "openrouter" : "custom";
  const tier: Tier = /opus/.test(current.model) ? "best" : current.model === "openrouter/free" || /haiku/.test(current.model) ? "light" : "balanced";
  return { provider, tier, web: current.webSearch, autoArrange: true, ...(provider === "custom" ? { custom: { baseUrl: current.baseUrl, model: current.model } } : {}) };
}

function currentConfig(): PipConfig {
  try { return settings(); } catch { return config(); }
}

export function readProfile(): AiProfile {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE) || "null") as AiProfile | null;
    if (saved && saved.provider && saved.tier) return saved;
  } catch { /* fall through to what the classic settings say */ }
  return inferred(currentConfig());
}

/** The endpoint and model for one job under a profile. */
export function configFor(profile: AiProfile, job: Job): PipConfig {
  const base = currentConfig();
  if (profile.provider === "custom") {
    if (!profile.custom) throw new Error("Enter an endpoint and a model under advanced.");
    return config({ ...base, provider: "compatible", baseUrl: profile.custom.baseUrl, model: profile.custom.model, webSearch: profile.web, thinking: false });
  }
  const provider = PROVIDERS[profile.provider];
  return config({ ...base, provider: provider.provider, baseUrl: provider.baseUrl, model: MODELS[profile.provider][profile.tier][job], webSearch: profile.web, thinking: profile.tier === "best" });
}

/**
 * Saves the profile and makes Pip use it: its default config for new chats, and the same read permissions
 * on the new endpoint (they are stored per endpoint).
 */
export function saveProfile(profile: AiProfile): void {
  const before = currentConfig();
  const granted = access(before);
  const chat = configFor(profile, "chat");
  saveSettings(chat);
  saveAccess(chat, granted);
  localStorage.setItem(PROFILE, JSON.stringify(profile));
}

export const keyTarget = (profile: AiProfile): Pick<PipConfig, "provider" | "baseUrl"> => {
  const chat = configFor(profile, "chat");
  return { provider: chat.provider, baseUrl: chat.baseUrl };
};
export const keyStatus = (profile: AiProfile): Promise<KeyStatus> => status(keyTarget(profile));
export const saveKey = (profile: AiProfile, key: string) => save(keyTarget(profile), key);
export const forgetKey = (profile: AiProfile) => forget(keyTarget(profile));

export const readAccess = (): Category[] => access(currentConfig());
export function writeAccess(categories: Category[]): void { saveAccess(currentConfig(), categories); }
