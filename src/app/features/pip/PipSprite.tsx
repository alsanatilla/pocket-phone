import { useEffect, useRef } from "react";
import { SIZE, accentName, sheet, drawFrame, frameCount, stepMs } from "../../../client/sprite-player.js";

// pip as the PS1 sprite the sheets already hold (tools/sprites/ps1). Drawn on a canvas at its native 96 px and
// scaled down by CSS with image-rendering: pixelated, so the keep-pixels look survives the smaller sizes here.

const ACTIVITY: Record<string, number> = { wave: 0, walk: 1, juggle: 2, read: 3, hop: 4, write: 5 };

export function PipSprite({ activity = "wave", size = 56, label }: { activity?: keyof typeof ACTIVITY; size?: number; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current, context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const index = ACTIVITY[activity] ?? 0, accent = accentName(canvas);
    let frame = 0, timer: ReturnType<typeof setTimeout> | undefined, stopped = false;
    const tick = () => {
      if (stopped) return;
      // While the sheet loads, drawFrame answers false and the canvas stays empty; the next tick picks it up.
      drawFrame(context, "pip", accent, index, frame);
      frame = (frame + 1) % frameCount("pip", index);
      timer = setTimeout(tick, stepMs("pip", index));
    };
    void sheet("pip", accent).then(() => { if (!stopped) tick(); }).catch(() => {});
    return () => { stopped = true; clearTimeout(timer); };
  }, [activity]);
  return (
    <canvas ref={ref} width={SIZE} height={SIZE} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}
      style={{ width: size, height: size, imageRendering: "pixelated" }} />
  );
}
