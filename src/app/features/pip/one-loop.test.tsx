import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children?: ReactNode; className?: string }) => <a href={"#" + to} className={className}>{children}</a>,
}));
vi.mock("../../ui/toast/toast.ts", () => ({ toast: vi.fn(), toastError: vi.fn(), clearToast: vi.fn() }));
vi.mock("../../ui/Markdown.tsx", () => ({ Markdown: ({ text }: { text: string }) => <div className="prose">{text}</div> }));
vi.mock("../../../client/cloud.js", () => {
  class Expired extends Error { constructor() { super("Sign in to Pocket again."); } }
  return { connected: vi.fn(() => true), account: vi.fn(() => ({ id: "user-a", email: "a@example.com" })), refreshAccount: vi.fn(), Expired, request: vi.fn(), post: vi.fn() };
});
vi.mock("../../../client/pip-remote.js", () => ({
  streamReplyRemote: vi.fn(), serverRuns: vi.fn(async () => ({ available: true })),
  queueReply: vi.fn(), chatQueue: vi.fn(async () => ({ queue: [], active: "" })), changeQueue: vi.fn(),
}));
vi.mock("../../../client/pip-credentials.js", async original => ({
  ...await original<typeof import("../../../client/pip-credentials.js")>(), save: vi.fn(async () => ({ mode: "account", hint: "…5678" })), resolve: vi.fn(async () => null),
}));
vi.mock("../../../client/pip-title.js", () => ({ suggestTitle: vi.fn(async () => null) }));
vi.mock("../../ui/dialog/dialog.ts", async original => ({ ...await original<typeof import("../../ui/dialog/dialog.ts")>(), confirm: vi.fn(async () => true) }));

import * as cloud from "../../../client/cloud.js";
import * as remote from "../../../client/pip-remote.js";
import * as credentials from "../../../client/pip-credentials.js";
import { NOT_SET_UP, NO_TOKENS } from "../../../shared/pip-refusals.js";
import { chats, type ChatTurn } from "../../data/chats.ts";
import { PROVIDERS } from "../../data/ai.ts";
import { confirm } from "../../ui/dialog/dialog.ts";
import { EXPIRED, OFFLINE, resetDeclined, SIGNED_OUT } from "./account.ts";
import { SignedOut } from "./PipPage.tsx";
import { Turn } from "./Turn.tsx";
import { retry, send } from "./runner.ts";

// The new app has one reply loop: Pocket's server. These pin each way a reply used to end up in the tab instead.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OPENCODE = { provider: PROVIDERS.opencode.provider, model: "glm-5.3", baseUrl: PROVIDERS.opencode.baseUrl, maxTokens: 4096, thinking: false, webSearch: false };
const streamed = vi.mocked(remote.streamReplyRemote);

/** Every module the app's entry reaches, statically or by import(), following relative and "@/" specifiers. */
function moduleGraph(entry: string): Set<string> {
  const seen = new Set<string>(), queue = [entry];
  const find = (from: string, spec: string) => {
    const base = spec.startsWith("@/") ? join(ROOT, "src/app", spec.slice(2)) : resolve(dirname(from), spec);
    return [base, base + ".ts", base + ".tsx", base + ".js", join(base, "index.ts"), join(base, "index.tsx")].find(file => existsSync(file) && !file.endsWith("/")) ?? null;
  };
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(m?js|tsx?)$/.test(file)) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g)) {
      const spec = match[1]!;
      if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
      const found = find(file, spec);
      if (found && !found.endsWith(".d.ts")) queue.push(found);
    }
  }
  return seen;
}

function signIn(account = "user-a") { localStorage.setItem("pocket:active-account", account); }
const chatWith = (config = OPENCODE) => chats.create(config);
const lastTurn = (uid: string) => chats.get(uid)!.turns.at(-1)!;

beforeEach(() => {
  resetDeclined();
  vi.mocked(cloud.connected).mockReturnValue(true);
  vi.mocked(remote.serverRuns).mockResolvedValue({ available: true });
  streamed.mockResolvedValue({ answer: "From the server.", activity: [], sources: [], usage: { runtime: "pocket-server" } });
});

describe("the new app's module graph", () => {
  it("never reaches the browser reply loop", () => {
    const graph = moduleGraph(join(ROOT, "src/app/main.tsx"));
    expect(graph.has(join(ROOT, "src/app/features/pip/runner.ts"))).toBe(true);
    expect(graph.has(join(ROOT, "src/client/pip-core.js"))).toBe(true);
    for (const loop of ["src/client/pip-stream.js", "src/client/pip-local.js", "src/client/pip.js"]) expect(graph.has(join(ROOT, loop)), loop).toBe(false);
  });
});

describe("a reply in the new app", () => {
  it("runs on the server every time, signed in, without asking for a key in this tab", async () => {
    signIn();
    const chat = chatWith();
    await send(chat.uid, "What is due today?");
    await send(chat.uid, "And tomorrow?");
    expect(streamed).toHaveBeenCalledTimes(2);
    expect(lastTurn(chat.uid)).toMatchObject({ status: "done", answer: "From the server." });
  });

  it("reads the session once when the tab loaded before it, then runs on the server", async () => {
    signIn();
    vi.mocked(cloud.connected).mockReturnValueOnce(false);
    vi.mocked(cloud.refreshAccount).mockResolvedValueOnce({ id: "user-a" });
    const chat = chatWith();
    await send(chat.uid, "Hello");
    expect(cloud.refreshAccount).toHaveBeenCalledTimes(1);
    expect(streamed).toHaveBeenCalledTimes(1);
  });

  it("says the server cannot be reached when the session cannot be read, and never answers in the tab", async () => {
    signIn();
    vi.mocked(cloud.connected).mockReturnValue(false);
    vi.mocked(cloud.refreshAccount).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const chat = chatWith();
    await send(chat.uid, "Hello");
    expect(streamed).not.toHaveBeenCalled();
    expect(lastTurn(chat.uid)).toMatchObject({ status: "failed", error: OFFLINE });
  });

  it("asks to sign in again when the session ended", async () => {
    signIn();
    vi.mocked(cloud.connected).mockReturnValue(false);
    vi.mocked(cloud.refreshAccount).mockRejectedValueOnce(new cloud.Expired());
    const chat = chatWith();
    await send(chat.uid, "Hello");
    expect(lastTurn(chat.uid)).toMatchObject({ status: "failed", error: EXPIRED });
  });

  it("turns a connection lost mid-reply into the same sentence", async () => {
    signIn();
    streamed.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const chat = chatWith();
    await send(chat.uid, "Hello");
    expect(lastTurn(chat.uid)).toMatchObject({ status: "failed", error: OFFLINE });
  });

  it("refuses a guest before anything is sent", async () => {
    const chat = chatWith();
    await expect(send(chat.uid, "Hello")).rejects.toThrow(SIGNED_OUT);
    expect(streamed).not.toHaveBeenCalled();
    expect(chats.get(chat.uid)!.turns).toHaveLength(0);
  });
});

describe("what the server refuses", () => {
  it("says which key is missing and where to connect it", async () => {
    signIn();
    streamed.mockRejectedValueOnce(Object.assign(new Error(NOT_SET_UP), { status: 409 }));
    const chat = chatWith();
    await send(chat.uid, "Hello");
    const turn = lastTurn(chat.uid);
    expect(turn.status).toBe("failed");
    expect(turn.error).toBe("No OpenCode Go key is on your Pocket account, so Pip cannot answer. Connect OpenCode Go in settings, then start over.");
    render(<Turn turn={turn} chatId={chat.uid} latest live={null} locked={false} />);
    expect(screen.getByText(/No OpenCode Go key is on your Pocket account/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "settings" }).getAttribute("href")).toBe("#/settings");
    expect(screen.getByRole("button", { name: "start over" })).toBeTruthy();
  });

  it("says the daily limit is used up, also for a message the server refused when its turn came", () => {
    signIn();
    const chat = chatWith();
    chats.update(chat.uid, value => { value.turns.push({ uid: "t1", text: "Hello", answer: "", created: Date.now(), status: "failed", error: NO_TOKENS, activity: [], sources: [] } as unknown as ChatTurn); });
    render(<Turn turn={lastTurn(chat.uid)} chatId={chat.uid} latest live={null} locked={false} />);
    expect(screen.getByText(/Today's token limit for Pip on its own is used up\. Connect OpenCode Go in/)).toBeTruthy();
    expect(screen.queryByText(NO_TOKENS)).toBeNull();
  });
});

describe("a key kept only in this tab", () => {
  const tabKey = (config = OPENCODE) => sessionStorage.setItem("pocket:account:user-a:" + credentials.keyName(config), "oc-tab-key-12345678");

  it("is offered to the account once, then stored there before the reply runs", async () => {
    signIn(); tabKey();
    vi.mocked(remote.serverRuns).mockResolvedValueOnce({ available: false });
    const chat = chatWith();
    await send(chat.uid, "Hello");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(confirm).mock.calls[0]![0]).toMatchObject({ title: "Store your OpenCode Go key on your account?", confirmLabel: "store key" });
    expect(credentials.save).toHaveBeenCalledWith(expect.objectContaining({ provider: "compatible", baseUrl: PROVIDERS.opencode.baseUrl }), "oc-tab-key-12345678");
    expect(vi.mocked(credentials.save).mock.invocationCallOrder[0]!).toBeLessThan(streamed.mock.invocationCallOrder[0]!);
  });

  it("is not uploaded when the person declines, and they are not asked again on this page", async () => {
    signIn(); tabKey();
    vi.mocked(remote.serverRuns).mockResolvedValue({ available: false });
    vi.mocked(confirm).mockResolvedValueOnce(false);
    streamed.mockRejectedValue(new Error(NOT_SET_UP));
    const chat = chatWith();
    await send(chat.uid, "Hello");
    await retry(chat.uid, lastTurn(chat.uid).uid);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(credentials.save).not.toHaveBeenCalled();
    expect(lastTurn(chat.uid).error).toMatch(/^No OpenCode Go key is on your Pocket account/);
  });

  it("is left alone when the server already has a key for the chat's endpoint", async () => {
    signIn(); tabKey();
    const chat = chatWith();
    await send(chat.uid, "Hello");
    expect(confirm).not.toHaveBeenCalled();
    expect(credentials.save).not.toHaveBeenCalled();
    expect(streamed).toHaveBeenCalledTimes(1);
  });

  it("from before signing in, in this same tab, is offered as well", async () => {
    sessionStorage.setItem(credentials.keyName(OPENCODE), "oc-guest-key-12345678");
    signIn();
    vi.mocked(remote.serverRuns).mockResolvedValueOnce({ available: false });
    await send(chatWith().uid, "Hello");
    expect(credentials.save).toHaveBeenCalledWith(expect.anything(), "oc-guest-key-12345678");
  });
});

describe("signed out", () => {
  it("shows one sentence and the sign-in key where the field would be", () => {
    render(<SignedOut />);
    expect(screen.getByText(SIGNED_OUT)).toBeTruthy();
    expect(screen.getByRole("link", { name: "sign in" })).toBeTruthy();
    expect(screen.queryByLabelText("Message Pip")).toBeNull();
  });
});

// The device answers a device tool through the same approval the runner already shows; the server run keeps it.
describe("device tools", () => {
  it("are answered through the server run's approval", async () => {
    signIn();
    streamed.mockImplementationOnce(async (_chat, _turn, options) => {
      const approve = (options as { approve: (requests: unknown[], signal: AbortSignal) => Promise<Map<string, unknown>> }).approve;
      const decisions = await approve([{ approvalId: "r1", toolCallId: "r1", rowId: "row-1", toolName: "search_calendar", input: { query: "dentist" } }], new AbortController().signal);
      return { answer: "Decided: " + JSON.stringify([...decisions.values()]) };
    });
    const chat = chatWith();
    const sending = send(chat.uid, "When is the dentist?");
    const { approvalOf, decide } = await import("./runner.ts");
    await waitFor(() => expect(approvalOf(lastTurn(chat.uid).uid, "row-1")).toBeTruthy());
    act(() => decide(lastTurn(chat.uid).uid, "row-1", { approved: true }));
    await sending;
    expect(lastTurn(chat.uid).answer).toBe('Decided: [{"approved":true}]');
  });
});
