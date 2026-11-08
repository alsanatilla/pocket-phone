import { useEffect, useRef } from "react";
import { markdownNode } from "../../../shared/markdown.js";
import { hydrateCards, releaseCards } from "../../../client/pip-cards.jsx";

// Markdown keeps the shared renderer and its sanitizer; React only owns the container. The node is created once
// and fed new text, so a streaming answer repaints in place instead of being rebuilt.

const renderOptions = streaming => ({ streaming, onBeforeRender: releaseCards, onRender: element => { hydrateCards(element); } });

export function Prose({ text, streaming = false }) {
  const host = useRef(null);
  const node = useRef(null);

  useEffect(() => {
    const element = markdownNode(text, renderOptions(streaming));
    node.current = element;
    host.current.replaceChildren(element);
    return () => { releaseCards(element); element.disposeMarkdown?.(); node.current = null; };
    // Created once per mount; later text arrives through updateMarkdown below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    node.current?.updateMarkdown(text, renderOptions(streaming));
  }, [text, streaming]);

  return <div className="prose" ref={host} />;
}
