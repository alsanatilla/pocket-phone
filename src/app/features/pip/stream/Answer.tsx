import { memo, useMemo } from "react";
import { Card } from "./Card.tsx";
import { Prose } from "./Prose.tsx";
import { segmentAnswer } from "./segments.ts";

// A reply's text with its cards in place, as it streams: prose block by block, each card element by element.
// Segment keys only ever grow at the end, so everything already on screen keeps its component.

export const Answer = memo(function Answer({ text, streaming, onAsk }: { text: string; streaming: boolean; onAsk: (prompt: string) => void }) {
  const segments = useMemo(() => segmentAnswer(text), [text]);
  return (
    <div className="text-[15px]">
      {segments.map((segment, index) => {
        const last = index === segments.length - 1;
        return segment.kind === "prose"
          ? <Prose key={segment.key} text={segment.text} streaming={streaming && last} />
          : <Card key={segment.key} source={segment.source} closed={segment.closed} streaming={streaming} onAsk={onAsk} />;
      })}
    </div>
  );
});

/** Before the first words: the shape of a reply, softly lit, instead of an empty space or a spinner. */
export function Thinking({ label }: { label: string }) {
  return (
    <div className="arrive space-y-2 py-1" role="status" aria-label={label}>
      <div className="shimmer h-3.5 w-4/5 rounded-sm" />
      <div className="shimmer h-3.5 w-3/5 rounded-sm" />
      <p className="pt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
