import { memo, type ComponentProps } from "react";
import { Block, Streamdown, defaultRemarkPlugins } from "streamdown";
import { cn } from "@/lib/utils";

// Prose of a reply, drawn in the browser by Streamdown. The text of a reply is Markdown that is still being written:
// the library keeps every block it has drawn mounted, completes unfinished syntax itself (an open **, an open fence,
// a table whose header has arrived), and asks nothing of the server, so a block that is on screen is never drawn
// again. Cards are cut out before this (Answer.tsx), so only prose arrives here.
//
// The look is Pocket's: every element is drawn as the plain element the `.prose` rules style, and the caret at the
// end of the text being written is the same `.caret` (see the rules in global.css).

type BlockProps = ComponentProps<typeof Block>;
type ElementProps<K extends keyof React.JSX.IntrinsicElements> = React.JSX.IntrinsicElements[K] & { node?: unknown };

/** One block of the text in its own box: the `.prose` margins between blocks stay exactly as they were. */
function ReplyBlock(props: BlockProps) {
  return <div className="reply-block"><Block {...props} /></div>;
}

/** Without rehype-raw, Streamdown shows HTML in the text as text and never as elements (as the server renderer did). */
type RehypePlugins = NonNullable<ComponentProps<typeof Streamdown>["rehypePlugins"]>;
const REHYPE_PLUGINS: RehypePlugins = [];

type Mdast = { type: string; value?: string; children?: Mdast[] };

/** A newline inside a paragraph becomes a line break, as the server renderer drew it; Streamdown would join it. */
function lineBreaks() {
  return (tree: Mdast) => { breakLines(tree); };
}

function breakLines(node: Mdast) {
  if (!node.children || node.type === "code" || node.type === "inlineCode") return;
  const children: Mdast[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value?.includes("\n")) {
      child.value.split("\n").forEach((line, index) => {
        if (index) children.push({ type: "break" });
        if (line) children.push({ type: "text", value: line });
      });
      continue;
    }
    breakLines(child);
    children.push(child);
  }
  node.children = children;
}

/** GFM (tables, strikethrough, task lists) plus the line breaks a reply has always shown. */
const REMARK_PLUGINS = [defaultRemarkPlugins.gfm!, lineBreaks];

/** Only web addresses and mail are links; anything else loses its address and stays plain text. */
function allowedUrl(url: string, key: string): string | undefined {
  if (/^https?:\/\//i.test(url)) return url;
  if (key === "href" && /^mailto:/i.test(url)) return url;
  return undefined;
}

/** A link as the server renderer made it: web links in a new tab, mail and the rest in this one. */
function Link({ node: _node, href, children, ...props }: ElementProps<"a">) {
  if (!href) return <span {...props}>{children}</span>;
  const web = /^https?:/i.test(href);
  return <a {...props} href={href} target={web ? "_blank" : undefined} rel={web ? "noopener noreferrer" : undefined}>{children}</a>;
}

/** The server renderer drew a heading one level lower (a reply sits under the page's title); keep that. */
function heading(level: number) {
  const tag = ("h" + Math.min(level + 1, 6)) as "h2";
  return ({ node: _node, ...props }: ElementProps<typeof tag>) => {
    const Heading = tag;
    return <Heading {...props} />;
  };
}

/** Every element a reply's text can make, as the element the `.prose` rules were written for. */
const COMPONENTS = {
  p: ({ node: _node, ...props }: ElementProps<"p">) => <p {...props} />,
  h1: heading(1),
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),
  h5: heading(5),
  h6: heading(6),
  ul: ({ node: _node, ...props }: ElementProps<"ul">) => <ul {...props} />,
  ol: ({ node: _node, ...props }: ElementProps<"ol">) => <ol {...props} />,
  li: ({ node: _node, ...props }: ElementProps<"li">) => <li {...props} />,
  blockquote: ({ node: _node, ...props }: ElementProps<"blockquote">) => <blockquote {...props} />,
  hr: ({ node: _node, ...props }: ElementProps<"hr">) => <hr {...props} />,
  pre: ({ node: _node, ...props }: ElementProps<"pre">) => <pre {...props} />,
  code: ({ node: _node, ...props }: ElementProps<"code">) => <code {...props} />,
  table: ({ node: _node, ...props }: ElementProps<"table">) => <table {...props} />,
  thead: ({ node: _node, ...props }: ElementProps<"thead">) => <thead {...props} />,
  tbody: ({ node: _node, ...props }: ElementProps<"tbody">) => <tbody {...props} />,
  tr: ({ node: _node, ...props }: ElementProps<"tr">) => <tr {...props} />,
  th: ({ node: _node, ...props }: ElementProps<"th">) => <th {...props} />,
  td: ({ node: _node, ...props }: ElementProps<"td">) => <td {...props} />,
  strong: ({ node: _node, ...props }: ElementProps<"strong">) => <strong {...props} />,
  a: Link,
  // A reply never showed remote pictures; leaving them out keeps that, and fetches nothing from a model's URL.
  img: () => null,
};

/** Streamdown's own root box would space the blocks itself; `.prose` owns the rhythm between them. */
const ROOT = "reply-md space-y-0";

export const Prose = memo(function Prose({ text, streaming, className }: { text: string; streaming: boolean; className?: string }) {
  return (
    <div className={cn("prose", streaming && "caret", className)}>
      <Streamdown
        className={ROOT}
        components={COMPONENTS}
        BlockComponent={ReplyBlock}
        rehypePlugins={REHYPE_PLUGINS}
        remarkPlugins={REMARK_PLUGINS}
        urlTransform={allowedUrl}
        isAnimating={streaming}
      >
        {text}
      </Streamdown>
    </div>
  );
});
