import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyStatus } from "../../../client/pip-credentials.js";
import type { Category } from "../../../client/pip-tools.js";
import { forgetKey, keyStatus, readAccess, readProfile, saveKey, writeAccess, type AiProfile } from "../../data/ai.ts";
import { connect, customEndpoint, saveCustomEndpoint } from "../../data/models.ts";
import { monthUsage } from "../../data/usage.ts";
import { toast, toastError } from "../../ui/toast/toast.ts";
import * as openrouter from "./openrouter.ts";

// Each provider card manages its own connection. Only Today preferences are persisted here;
// chat model defaults are changed exclusively by the chat picker.

export type Connection = { state: "checking" } | { state: "connected"; status: KeyStatus } | { state: "missing"; stale?: boolean } | { state: "unreachable" };

export function useAiSettings(provider?: AiProfile["provider"]) {
  const [profile, setProfile] = useState<AiProfile>(() => ({ ...readProfile(), ...(provider ? { provider } : {}), custom: customEndpoint() ?? undefined }));
  const [connection, setConnection] = useState<Connection>({ state: "checking" });
  const [granted, setGranted] = useState<Category[]>(readAccess);
  const [usage] = useState(monthUsage);
  const [busy, setBusy] = useState(false);

  const checkVersion = useRef(0);
  const check = useCallback(async (value: AiProfile) => {
    const version = ++checkVersion.current;
    setConnection({ state: "checking" });
    try {
      const status = await keyStatus(value);
      if (version !== checkVersion.current) return;
      setConnection(status.unreachable && !status.tab ? { state: "unreachable" } : status.saved || status.tab ? { state: "connected", status } : { state: "missing", stale: Boolean(status.stale) });
    } catch { if (version === checkVersion.current) setConnection({ state: "missing" }); }
  }, []);

  const update = useCallback((change: Partial<AiProfile>) => {
    const next = { ...profile, ...change };
    try {
      if (change.custom) saveCustomEndpoint(change.custom);
      if (change.autoArrange !== undefined) {
        localStorage.setItem("pocket:ai-profile", JSON.stringify({ ...readProfile(), autoArrange: change.autoArrange }));
      }
      setProfile(next);
      if (change.provider || change.custom) void check(next);
    } catch (error) { toastError(error); }
  }, [check, profile]);

  // Finish an OpenRouter sign-in that brought us here; otherwise just read the key status.
  useEffect(() => {
    if (!provider) return;
    if (provider !== "openrouter" || !openrouter.pending()) { void check(profile); return; }
    const next: AiProfile = { ...readProfile(), provider: "openrouter" };
    setBusy(true);
    openrouter.finish()
      .then(key => connect("openrouter", key))
      .then(() => { setProfile(next); toast("Connected to OpenRouter."); })
      .catch(toastError)
      .finally(() => { setBusy(false); void check(next); });
  }, [check, provider]);

  return {
    profile, connection, granted, usage, busy,
    setProvider: (provider: AiProfile["provider"]) => update({ provider }),
    setAutoArrange: (autoArrange: boolean) => update({ autoArrange }),
    setCustom: (custom: NonNullable<AiProfile["custom"]>) => update({ provider: "custom", custom }),
    toggleAccess(category: Category, on: boolean) {
      const next = on ? [...granted, category] : granted.filter(item => item !== category);
      writeAccess(next); setGranted(next);
    },
    async signInOpenRouter() {
      try { setBusy(true); await openrouter.connect(); } catch (error) { setBusy(false); toastError(error); }
    },
    async connectKey(key: string) {
      setBusy(true);
      try { await saveKey(profile, key); toast("Key saved."); await check(profile); return true; }
      catch (error) { toastError(error); return false; }
      finally { setBusy(false); }
    },
    async disconnect() {
      setBusy(true);
      try { await forgetKey(profile); toast("Disconnected."); await check(profile); }
      catch (error) { toastError(error); }
      finally { setBusy(false); }
    },
  };
}
