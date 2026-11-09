import { useCallback, useEffect, useState } from "react";
import { clearNotes, deleteJob, loadJobs, runJob, saveBackgroundSettings, saveJob, type BackgroundSettings, type JobDraft, type JobsState } from "../../data/jobs.ts";
import { toast, toastError } from "../../ui/toast/toast.ts";

// The jobs screen's state: what the server says, and actions that replace it with the server's answer.

export function useJobs() {
  const [state, setState] = useState<JobsState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setState(await loadJobs()); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const act = async <T extends JobsState>(label: string, work: () => Promise<T>, done?: (value: T) => string | void) => {
    setBusy(label);
    try { const value = await work(); setState(value); const message = done?.(value); if (message) toast(message); return value; }
    catch (failure) { toastError(failure); return null; }
    finally { setBusy(null); }
  };

  return {
    state, error, busy, refresh,
    save: (draft: JobDraft) => act("save", () => saveJob(draft), () => "Saved."),
    remove: (id: string) => act("remove:" + id, () => deleteJob(id), () => "Removed."),
    run: (id: string) => act("run:" + id, () => runJob(id), value => value.run.status === "done" ? "Pip answered; it is in the job's chat." : value.run.status === "unchanged" ? "Nothing new to report." : value.run.error || "The job did not run."),
    clear: (id: string) => act("clear:" + id, () => clearNotes(id), () => "Notes cleared."),
    toggle: (draft: JobDraft) => act("toggle:" + draft.id, () => saveJob(draft)),
    setup: (settings: BackgroundSettings) => act("setup", () => saveBackgroundSettings(settings), value => value.settings?.enabled ? "Pip works on its own now." : "Paused."),
  };
}
