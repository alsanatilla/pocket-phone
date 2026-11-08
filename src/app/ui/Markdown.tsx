import { useEffect, useRef } from "react";
import { markdownNode, type MarkdownNode, type MarkdownRenderOptions } from "../../shared/markdown.js";

// Markdown is rendered by Pocket's server (Satteri) and sanitized by src/shared/markdown.js; that module owns a
// DOM node it keeps up to date. This component is the boundary: React owns the container, the renderer its
// contents. The node is made once and fed new text, so streaming or edited text repaints in place.

export type MarkdownOptions = MarkdownRenderOptions;

export function Markdown({ text, options = {}, className = "prose" }: { text: string; options?: MarkdownOptions; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const node = useRef<MarkdownNode | null>(null);
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const element = markdownNode(text, latest.current);
    node.current = element;
    host.current?.replaceChildren(element);
    return () => { latest.current.onBeforeRender?.(element); element.disposeMarkdown(); node.current = null; };
    // Made once per mount; later text goes through updateMarkdown below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const optionsKey = JSON.stringify([options.streaming, options.inline, options.annotations]);
  useEffect(() => {
    // The first run repeats what the mount effect did; updateMarkdown ignores an unchanged text and options.
    node.current?.updateMarkdown(text, latest.current);
  }, [text, optionsKey]);

  return <div className={className} ref={host} />;
}
