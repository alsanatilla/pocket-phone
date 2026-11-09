// Types for live.js: the account's live socket.
export type LiveMessage =
  | { type: "hello"; accountId: string; at: number }
  | { type: "event"; event: string; data: Record<string, any> }
  | { type: "res"; id: number; ok: boolean }
  | { type: "closed" };
export function on(listener: (message: LiveMessage) => void): () => void;
export function connected(): boolean;
export function start(accountId: string): void;
export function stop(): void;
export function request(method: string, params?: Record<string, unknown>): boolean;
