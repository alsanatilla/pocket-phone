import type { Spec } from "@json-render/core";
import type { PipConfig } from "../../client/pip-core.js";
import { activeAccount } from "../../client/workspace-storage.js";
import type { Moment } from "./context.ts";
import type { StreamOptions } from "./engine.ts";

export async function remoteSurface(key: string, { signal, onSpec, onRunning }: StreamOptions & { onRunning?: () => void }, start?: { moment: Moment; config: PipConfig; force: boolean }): Promise<Spec | null> {
  const owner = activeAccount();
  if (!owner) return null;
  let submit = start;
  while (!signal.aborted) {
    const response = await fetch('/api/pip/surface' + (submit ? '' : '?key=' + encodeURIComponent(key)), {
      method: submit ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal,
      ...(submit ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...submit, key, accountId: owner }) } : {}),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Today is unavailable.');
    if (activeAccount() !== owner || body.accountId !== owner) throw new Error('Account changed.');
    const row = body.surface;
    if (!row) return null;
    if (row.spec) onSpec(row.spec);
    if (row.status === 'done') return row.spec;
    if (row.status === 'failed') throw new Error(row.error || 'Could not arrange Today.');
    onRunning?.();
    submit = undefined;
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 1000);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }
  throw signal.reason;
}
