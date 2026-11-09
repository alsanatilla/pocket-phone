import { DEFAULT_CONFIG, config, saveSettings, settings, type PipConfig } from "../../client/pip-core.js";
import { forget, save, status, type KeyStatus } from "../../client/pip-credentials.js";
import { access, saveAccess, type Category } from "../../client/pip-tools.js";
import { OPENCODE_GO } from "../../shared/pip-opencode.js";

// Pocket's AI settings in the person's terms: who provides the model, how much AI to use, and what Pip may read.
// Everything technical (endpoint, model IDs, which model does which job) is derived here, so the settings screen
// never shows a model ID unless "advanced" is opened.

export type Provider = "opencode" | "openrouter" | "anthropic" | "custom";
export type Tier = "light" | "balanced" | "best";
/** The jobs Pocket gives a model: a conversation with Pip, or arranging a screen (fast and frequent). */
export type Job = "chat" | "surface";

export const PROVIDERS: Record<Exclude<Provider, "custom">, { name: string; baseUrl: string; provider: PipConfig["provider"]; relayOnly?: boolean }> = {
  // OpenCode Go answers no CORS preflight, so a browser reaches it only through Pocket's relay (signed in).
  opencode: { name: "OpenCode Go", baseUrl: OPENCODE_GO, provider: "compatible", relayOnly: true },
  openrouter: { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", provider: "compatible" },
  anthropic: { name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", provider: "anthropic" },
};

/** Which model does which job at each tier. */
export const MODELS: Record<Exclude<Provider, "custom">, Record<Tier, Record<Job, string>>> = {
  opencode: {
    light: { chat: "deepseek-v4.1-flash", surface: "deepseek-v4.1-flash" },
    balanced: { chat: "glm-5.3", surface: "deepseek-v4.1-flash" },
    best: { chat: "kimi-k3.1-pro", surface: "glm-5.3" },
  },
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
  light: { name: "Light", blurb: "Fast and cheap." },
  balanced: { name: "Balanced", blurb: "Thoughtful replies, quick screens. The default." },
  best: { name: "Best", blurb: "The strongest model for every reply, with reasoning." },
};

/** Display names for the models Pocket picks. */
export const MODEL_NAMES: Record<string, string> = {
  "openrouter/free": "free models",
  "deepseek-v4.1-flash": "DeepSeek V4.1 Flash", "glm-5.3": "GLM 5.3", "kimi-k3.1-pro": "Kimi K3.1 Pro",
};

/** US$ per million tokens [input, output], list prices (an OpenCode Go subscription covers its models up to its limits). */
const PRICES: Record<string, [number, number]> = {
  "openrouter/free": [0, 0],
  "deepseek-v4.1-flash": [0.15, 0.6], "glm-5.3": [1.4, 4.4], "kimi-k3.1-pro": [2, 10],
  haiku: [0.1, 0.5], sonnet: [2, 10], opus: [4, 20],
};
export function priceOf(model: string): [number, number] | null {
  if (PRICES[model]) return PRICES[model];
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

/**
 * What the classic settings imply, for people who set Pip up before this screen existed. Nothing chosen yet
 * (Pip's built-in default) means OpenCode Go, Pocket's main provider.
 */
function inferred(current: PipConfig): AiProfile {
  const untouched = JSON.stringify(current) === JSON.stringify(DEFAULT_CONFIG);
  if (untouched) return { provider: "opencode", tier: "balanced", web: false, autoArrange: true };
  const host = new URL(current.baseUrl).hostname;
  const provider: Provider = current.provider === "anthropic" ? "anthropic" : host === "openrouter.ai" ? "openrouter" : current.baseUrl === OPENCODE_GO ? "opencode" : "custom";
  const tierOf = (models: Record<Tier, Record<Job, string>>) => (Object.keys(models) as Tier[]).find(tier => models[tier].chat === current.model);
  const tier: Tier = (provider !== "custom" && tierOf(MODELS[provider])) || (/opus|pro\b/.test(current.model) ? "best" : current.model === "openrouter/free" || /haiku|flash/.test(current.model) ? "light" : "balanced");
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
