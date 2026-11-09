import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { markdownFragment, renderMarkdown } from "../../../../shared/markdown.js";
import { inlineTokens, pendingShape, splitProse } from "./segments.ts";

// Prose of a reply. While it streams, every settled block is rendered once by Pocket's Markdown renderer (on the
// server, sanitized) and then left alone; the block still being written is drawn right away with light inline
// formatting, shaped like what it will become, so nothing raw or half-formatted appears and nothing re-flows.
// A finished reply is rendered as one piece; until that arrives, the block view (which looks the same) stays.

const rendered = new Map<string, string>();
const RENDERED_LIMIT = 400;

function remember(text: string, html: string) {
  rendered.set(text, html);
  if (rendered.size > RENDERED_LIMIT) rendered.delete(rendered.keys().next().value!);
}

/** The rendered HTML for `text` (null while it is on its way, or when `text` is null). */
export function useRenderedMarkdown(text: string | null): string | null {
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (text == null || rendered.has(text)) return;
    let live = true;
    renderMarkdown(text, {}, false)
      .then(html => { remember(text, html); if (live) setVersion(n => n + 1); })
      .catch(() => { /* the pending view stays readable offline */ });
    return () => { live = false; };
  }, [text]);
  return text == null ? null : rendered.get(text) ?? null;
}

/** Sanitized HTML, mounted once per change. */
const Html = memo(function Html({ html }: { html: string }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { host.current?.replaceChildren(markdownFragment(html)); }, [html]);
  return <div ref={host} />;
});

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineTokens(text).map((token, index) =>
        token.type === "strong" ? <strong key={index}>{token.text}</strong>
        : token.type === "em" ? <em key={index}>{token.text}</em>
        : token.type === "code" ? <code key={index}>{token.text}</code>
        : token.type === "link" ? <span key={index} className="text-primary">{token.text}</span>
        : <span key={index}>{token.text}</span>)}
    </>
  );
}

/** The block being written, in the shape it will have once rendered. */
export function Pending({ text, caret }: { text: string; caret: boolean }) {
  const shape = pendingShape(text);
  const tail = caret ? "caret" : undefined;
  let body: ReactNode;
  if (shape.kind === "heading") body = shape.level <= 2 ? <h2 className={tail}><Inline text={shape.text} /></h2> : <h3 className={tail}><Inline text={shape.text} /></h3>;
  else if (shape.kind === "code") body = <pre><code className={tail}>{shape.text}</code></pre>;
  else if (shape.kind === "quote") body = <blockquote><p className={tail}><Inline text={shape.text} /></p></blockquote>;
  else if (shape.kind === "list") {
    const items = shape.items.map((item, index) => <li key={index} className={index === shape.items.length - 1 ? tail : undefined}><Inline text={item} /></li>);
    body = shape.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
  } else body = <p className={cn("whitespace-pre-line", tail)}><Inline text={shape.text} /></p>;
  return <div>{body}</div>;
}

/** One settled block: its rendered HTML when it has arrived, the same text drawn directly until then. */
const Block = memo(function Block({ text }: { text: string }) {
  const html = useRenderedMarkdown(text);
  return html ? <Html html={html} /> : <Pending text={text} caret={false} />;
});

export const Prose = memo(function Prose({ text, streaming, className }: { text: string; streaming: boolean; className?: string }) {
  const whole = useRenderedMarkdown(streaming ? null : text);
  if (whole) return <div className={cn("prose", className)}><Html html={whole} /></div>;
  const { blocks, pending } = splitProse(text, streaming);
  return (
    <div className={cn("prose", className)}>
      {blocks.map((block, index) => <Block key={index} text={block} />)}
      {pending ? <Pending text={pending} caret={streaming} /> : null}
    </div>
  );
});
