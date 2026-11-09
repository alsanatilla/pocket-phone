import { useCallback, useEffect, useState } from "react";
import type { KeyStatus } from "../../../client/pip-credentials.js";
import type { Category } from "../../../client/pip-tools.js";
import { forgetKey, keyStatus, readAccess, readProfile, saveKey, saveProfile, writeAccess, type AiProfile } from "../../data/ai.ts";
import { monthUsage } from "../../data/usage.ts";
import { toast, toastError } from "../../ui/toast/toast.ts";
import * as openrouter from "./openrouter.ts";

// The settings screen's behaviour: every change saves at once (there is no "save settings" button), the key
// status follows the chosen provider, and an OpenRouter sign-in that just came back is finished here.

export type Connection = { state: "checking" } | { state: "connected"; status: KeyStatus } | { state: "missing"; stale?: boolean } | { state: "unreachable" };

export function useAiSettings() {
  const [profile, setProfile] = useState<AiProfile>(readProfile);
  const [connection, setConnection] = useState<Connection>({ state: "checking" });
  const [granted, setGranted] = useState<Category[]>(readAccess);
  const [usage] = useState(monthUsage);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async (value: AiProfile) => {
    setConnection({ state: "checking" });
    try {
      const status = await keyStatus(value);
      setConnection(status.unreachable && !status.tab ? { state: "unreachable" } : status.saved || status.tab ? { state: "connected", status } : { state: "missing", stale: Boolean(status.stale) });
    } catch { setConnection({ state: "missing" }); }
  }, []);

  const update = useCallback((change: Partial<AiProfile>) => {
    setProfile(current => {
      const next = { ...current, ...change };
      try { saveProfile(next); } catch (error) { toastError(error); return current; }
      if (change.provider || change.custom) void check(next);
      return next;
    });
  }, [check]);

  // Finish an OpenRouter sign-in that brought us here; otherwise just read the key status.
  useEffect(() => {
    if (!openrouter.pending()) { void check(readProfile()); return; }
    const next: AiProfile = { ...readProfile(), provider: "openrouter" };
    setBusy(true);
    openrouter.finish()
      .then(key => saveKey(next, key))
      .then(() => { saveProfile(next); setProfile(next); toast("Connected to OpenRouter."); })
      .catch(toastError)
      .finally(() => { setBusy(false); void check(next); });
  }, [check]);

  return {
    profile, connection, granted, usage, busy,
    setProvider: (provider: AiProfile["provider"]) => update({ provider }),
    setTier: (tier: AiProfile["tier"]) => update({ tier }),
    setWeb: (web: boolean) => update({ web }),
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
