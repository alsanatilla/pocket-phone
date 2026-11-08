import { useEffect, useRef } from "react";
import { markdownNode } from "../../shared/markdown.js";

// Markdown goes through the shared renderer and its sanitizer; React only owns the container. The node is made
// once and fed new text, so streaming or live-edited text repaints in place instead of being rebuilt.
// `options` is passed to markdownNode on every update: streaming, annotations, onRender, onBeforeRender, inline.

export function Markdown({ text, options = {}, className = "prose" }) {
  const host = useRef(null);
  const node = useRef(null);
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const element = markdownNode(text, latest.current);
    node.current = element;
    host.current.replaceChildren(element);
    return () => { latest.current.onBeforeRender?.(element); element.disposeMarkdown?.(); node.current = null; };
    // Made once per mount; later text arrives through updateMarkdown below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const first = useRef(true);
  const optionsKey = JSON.stringify([options.streaming, options.inline, options.annotations]);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    node.current?.updateMarkdown(text, latest.current);
  }, [text, optionsKey]);

  return <div className={className} ref={host} />;
}
