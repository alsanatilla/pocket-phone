import { describe, expect, it, vi } from "vitest";
import { saveSettings, settings } from "../../../client/pip-core.js";
import { access, saveAccess } from "../../../client/pip-tools.js";
import { chats } from "../../data/chats.ts";
import { configFor, priceOf, readProfile, saveProfile } from "../../data/ai.ts";
import { monthUsage } from "../../data/usage.ts";
import { captureReturn, challengeFor, finish } from "./openrouter.ts";
import { modelLabel } from "./SettingsPage.tsx";

describe("AI profile", () => {
  it("starts on OpenCode Go when nothing was chosen yet", () => {
    expect(readProfile()).toMatchObject({ provider: "opencode", tier: "balanced" });
    const chat = configFor(readProfile(), "chat");
    expect(chat).toMatchObject({ provider: "compatible", baseUrl: "https://opencode.ai/inference/go/openai/v1", model: "glm-5.3" });
    expect(configFor(readProfile(), "surface").model).toBe("deepseek-v4.1-flash");
  });

  it("recognises an OpenCode Go setup made in the classic settings", () => {
    saveSettings({ provider: "compatible", baseUrl: "https://opencode.ai/inference/go/openai/v1", model: "kimi-k3.1-pro", maxTokens: 4096, thinking: false, webSearch: false });
    expect(readProfile()).toMatchObject({ provider: "opencode", tier: "best" });
  });

  it("reads what the classic settings imply", () => {
    saveSettings({ provider: "compatible", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/free", maxTokens: 4096, thinking: false, webSearch: true });
    expect(readProfile()).toMatchObject({ provider: "openrouter", tier: "light", web: true });
  });

  it("gives each job its model and reasoning only at the best tier", () => {
    const anthropic = { provider: "anthropic", tier: "balanced", web: false, autoArrange: true } as const;
    expect(configFor(anthropic, "chat")).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5", thinking: false });
    expect(configFor(anthropic, "surface").model).toBe("claude-haiku-5-5");
    const best = { provider: "openrouter", tier: "best", web: true, autoArrange: true } as const;
    expect(configFor(best, "chat")).toMatchObject({ baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-opus-5.5", thinking: true, webSearch: true });
  });

  it("makes the profile Pip's default and keeps what Pip may read on the new endpoint", () => {
    saveSettings({ provider: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5", maxTokens: 4096, thinking: false, webSearch: false });
    saveAccess(settings(), ["notes", "tasks"]);
    saveProfile({ provider: "openrouter", tier: "balanced", web: false, autoArrange: false });
    expect(settings()).toMatchObject({ baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-sonnet-5.5" });
    expect(access(settings())).toEqual(["notes", "tasks"]);
    expect(readProfile()).toMatchObject({ provider: "openrouter", autoArrange: false });
  });

  it("prices the models it chooses", () => {
    expect(priceOf("anthropic/claude-opus-5.5")).toEqual([4, 20]);
    expect(priceOf("claude-haiku-5-5")).toEqual([0.1, 0.5]);
    expect(priceOf("openrouter/free")).toEqual([0, 0]);
    expect(priceOf("mystery-model")).toBeNull();
    expect(modelLabel("anthropic/claude-sonnet-5.5")).toBe("Sonnet 5.5");
    expect(modelLabel("claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(modelLabel("deepseek-v4.1-flash")).toBe("DeepSeek V4.1 Flash");
    expect(priceOf("glm-5.3")).toEqual([1.4, 4.4]);
  });
});

describe("usage this month", () => {
  it("adds up recorded replies and estimates their cost", () => {
    const chat = chats.create();
    chats.update(chat.uid, value => {
      value.turns.push({ uid: "t1", text: "q", answer: "a", created: Date.now(), status: "done", usage: { request_identity: "anthropic|https://api.anthropic.com/v1|claude-sonnet-5-5", input_tokens: 1_000_000, output_tokens: 100_000 } } as never);
      value.turns.push({ uid: "t2", text: "q", answer: "a", created: Date.now(), status: "done", usage: { request_identity: "compatible|https://x.example/v1|other", input_tokens: 10, output_tokens: 10 } } as never);
      value.turns.push({ uid: "t3", text: "old", answer: "a", created: Date.now() - 62 * 864e5, status: "done", usage: { request_identity: "anthropic|x|claude-opus-5-5", input_tokens: 5, output_tokens: 5 } } as never);
    });
    const usage = monthUsage();
    expect(usage.replies).toBe(2);
    expect(usage.dollars).toBeCloseTo(3, 5);
    expect(usage.unpriced).toBe(1);
  });
});

describe("sign in with OpenRouter", () => {
  it("hashes the verifier as RFC 7636 says", async () => {
    expect(await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("takes the code out of the URL and trades it once for a key", async () => {
    sessionStorage.setItem("pocket:openrouter-verifier", "verifier-123");
    history.replaceState(null, "", "/next?code=abc");
    expect(captureReturn()).toBe(true);
    expect(location.search).toBe("");
    expect(location.hash).toBe("#/settings");

    const fetcher = vi.fn(async () => new Response(JSON.stringify({ key: "sk-or-v1-test" }), { status: 200 }));
    const [first, second] = await Promise.all([finish(fetcher as typeof fetch), finish(fetcher as typeof fetch)]);
    expect(first).toBe("sk-or-v1-test");
    expect(second).toBe("sk-or-v1-test");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ code: "abc", code_verifier: "verifier-123", code_challenge_method: "S256" });
  });

  it("ignores a ?code that did not come from our sign-in", () => {
    history.replaceState(null, "", "/next?code=abc");
    expect(captureReturn()).toBe(false);
  });
});
