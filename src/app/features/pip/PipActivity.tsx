import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { PipSprite } from "./PipSprite.tsx";

/** An honest, small sign of life: the run's phase, never a guessed emotion or fabricated progress. */
export function PipActivity({ active, phase, status }: { active: boolean; phase?: string; status: string }) {
  const wasActive = useRef(active);
  const [replied, setReplied] = useState(false);
  useEffect(() => {
    const finished = wasActive.current && !active && status === "done";
    wasActive.current = active;
    setReplied(finished);
    if (finished) {
      const timer = setTimeout(() => setReplied(false), 1600);
      return () => clearTimeout(timer);
    }
  }, [active, status]);

  // A completion acknowledgment only follows a reply observed live, never when opening old messages.
  if (!active && !replied) return null;
  const waiting = /waiting|approval/.test(phase || "");
  const thinking = !phase || ["requesting", "thinking", "preparing reply"].includes(phase);
  const mode = !active ? "replied" : waiting ? "waiting" : phase === "writing" ? "replying" : thinking ? "thinking" : "working";
  const label = mode === "replied" ? "replied" : mode === "replying" ? "replying" : mode === "thinking" ? "thinking" : phase || "working";
  return (
    <div className="pip-activity flex min-h-9 items-center gap-2 text-xs text-muted-foreground" data-pip-activity={mode} role="status" aria-live="polite" aria-atomic="true">
      <span className="pip-activity-mark" aria-hidden="true">
        {mode === "replied" ? <Check className="size-3.5" /> : <PipSprite activity={mode === "replying" ? "write" : "read"} size={36} />}
      </span>
      <span>{label}</span>
    </div>
  );
}
