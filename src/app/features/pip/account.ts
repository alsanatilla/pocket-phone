import * as cloud from "../../../client/cloud.js";
import { apiKey, save } from "../../../client/pip-credentials.js";
import { serverRuns } from "../../../client/pip-remote.js";
import { activeAccount } from "../../../client/workspace-storage.js";
import type { PipConfig } from "../../../client/pip-core.js";
import { NOT_SET_UP, NO_TOKENS } from "../../../shared/pip-refusals.js";
import { PROVIDER_NAMES, providerOf } from "../../data/models.ts";
import { confirm } from "../../ui/dialog/dialog.ts";

// In this app every Pip reply runs on Pocket's server (docs/pip-agent-runtime.md): there is no reply in the tab to
// fall back to. This is what stands between a message and that server: the account it needs, a key the server can
// use, and what the server's refusals mean in this app's words.

/** What a person without a Pocket account reads where the message field would be. */
export const SIGNED_OUT = "Pip answers on Pocket's server, so it needs your Pocket account.";
export const EXPIRED = "Your Pocket session ended. Sign in again to use Pip.";
export const OFFLINE = "Pocket's server cannot be reached, so Pip cannot answer. Check your connection, then start over.";

const nameOf = (value?: Pick<PipConfig, "provider" | "baseUrl"> | null) => {
  if (!value) return "this model's provider";
  const key = providerOf(value);
  return key === "custom" ? "your endpoint" : PROVIDER_NAMES[key];
};
const say = (message: string) => Object.assign(new Error(message), { code: "pip_refused" });

/**
 * The server's refusals and a lost connection, as one sentence that says what to do. `value` is the chat's model,
 * for the provider's name. Anything else is returned as it was: it already says what happened.
 */
export function explain(message: string, value?: Pick<PipConfig, "provider" | "baseUrl"> | null): string {
  const name = nameOf(value);
  if (message === NOT_SET_UP) return "No " + name + " key is on your Pocket account, so Pip cannot answer. Connect " + name + " in settings, then start over.";
  if (message.startsWith(NO_TOKENS)) return "Today's token limit for Pip on its own is used up. Connect " + name + " in settings to go on today, or start over tomorrow.";
  if (/stored key (could not be read|does not match)/.test(message)) return "The " + name + " key on your account can no longer be read. Connect " + name + " again in settings, then start over.";
  if (/^(Failed to fetch|Load failed|NetworkError\b)/.test(message)) return OFFLINE;
  return message;
}

/** The same as an error, keeping what the runner reads from it (a stop, a queued message). */
export function explainError(error: unknown, value?: Pick<PipConfig, "provider" | "baseUrl"> | null): unknown {
  if (!(error instanceof Error)) return error;
  const message = explain(error.message, value);
  return message === error.message ? error : say(message);
}

/**
 * A reply needs the account this tab belongs to, signed in now. A tab that loaded offline (or before the session
 * was read) asks for the session once; a session that ended and an unreachable server each say so.
 */
export async function reachAccount(): Promise<void> {
  if (!activeAccount()) throw say(SIGNED_OUT);
  if (cloud.connected()) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw say(OFFLINE);
  try { await cloud.refreshAccount(); }
  catch (error) { throw say(error instanceof cloud.Expired ? EXPIRED : OFFLINE); }
  if (!cloud.connected()) throw say(OFFLINE);
}

/** Endpoints whose key the person chose to keep in this tab: asked once per page, not on every message. */
const declined = new Set<string>();

/**
 * A key kept only in this tab (from before keys were stored on the account, or typed in before signing in) cannot
 * answer: the server runs the reply, continues it after an approval in a later request and after a restart, so the
 * key must be on the account. When the server has no key of its own for the chat's endpoint, this asks once, in a
 * dialog over the chat, and stores the key sealed in the account's vault (pip-credentials save, /api/pip/keys). The
 * key never leaves the tab unasked. Resolves when there is nothing to do or the key is stored; a declined move
 * leaves the server's own answer (no key) to the reply.
 */
export async function moveTabKey(chat: { uid: string; config: PipConfig }): Promise<"none" | "stored" | "declined"> {
  const value = chat.config;
  // The account's tab copy first, then a guest's from before signing in, in this same tab.
  const key = apiKey(value) || apiKey(value, globalThis.sessionStorage);
  const id = value.provider + "|" + value.baseUrl;
  if (!key || declined.has(id) || !cloud.connected()) return "none";
  const state = await serverRuns({ chat: chat.uid, config: value, force: true }).catch(() => null);
  if (!state || state.available) return "none";
  const name = nameOf(value);
  const yes = await confirm({
    title: "Store your " + name + " key on your account?",
    message: "It is only in this tab now. Pip answers on Pocket's server, so the key is kept there, encrypted; it never comes back to this browser.",
    confirmLabel: "store key",
  });
  if (!yes) { declined.add(id); return "declined"; }
  await save(value, key);
  return "stored";
}

/** For tests: forget which moves were declined. */
export const resetDeclined = (): void => declined.clear();
