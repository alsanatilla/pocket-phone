import { memo, useMemo } from "react";
import { Card } from "./Card.tsx";
import { Prose } from "./Prose.tsx";
import { segmentAnswer, type Segment } from "./segments.ts";

// A reply's text with its cards in place, as it streams: prose block by block, each card element by element.
// Segment keys only ever grow at the end, so everything already on screen keeps its component.

/**
 * `blocks` is a reply the server streams already cut into prose and cards: they are drawn as they are. Without
 * them (a finished reply, or one that runs in this tab) the text is cut here, once per change.
 */
export const Answer = memo(function Answer({ text, blocks, streaming, onAsk }: { text: string; blocks?: Segment[]; streaming: boolean; onAsk: (prompt: string) => void }) {
  const cut = useMemo(() => (blocks ? null : segmentAnswer(text)), [blocks, text]);
  const segments = blocks ?? cut ?? [];
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
