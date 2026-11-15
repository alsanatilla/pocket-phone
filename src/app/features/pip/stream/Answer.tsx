import { memo, useMemo } from "react";
import { Card, type CardPlace } from "./Card.tsx";
import { Prose } from "./Prose.tsx";
import { segmentAnswer, type Segment } from "./segments.ts";

// A reply's text with its cards in place, as it streams: prose block by block, each card element by element.
// Segment keys only ever grow at the end, so everything already on screen keeps its component.

/**
 * `blocks` is a reply the server streams already cut into prose and cards: they are drawn as they are. Without
 * them (a finished reply, or one that runs in this tab) the text is cut here, once per change.
 */
export const Answer = memo(function Answer({ text, blocks, streaming, onAsk, at }: { text: string; blocks?: Segment[]; streaming: boolean; onAsk: (prompt: string) => void; at?: CardPlace }) {
  const cut = useMemo(() => (blocks ? null : segmentAnswer(text)), [blocks, text]);
  const segments = blocks ?? cut ?? [];
  return (
    <div>
      {segments.map((segment, index) => {
        const last = index === segments.length - 1;
        return segment.kind === "prose"
          ? <Prose key={segment.key} text={segment.text} streaming={streaming && last} />
          : <Card key={segment.key} source={segment.source} closed={segment.closed} streaming={streaming} onAsk={onAsk} at={at} />;
      })}
    </div>
  );
});
