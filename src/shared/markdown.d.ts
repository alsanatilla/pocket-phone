// Types for markdown.js: a DOM node that renders Markdown through Pocket's server and keeps itself up to date.
export interface MarkdownRenderOptions {
  streaming?: boolean;
  inline?: boolean;
  annotations?: unknown[];
  onRender?: (node: HTMLElement) => void;
  onBeforeRender?: (node: HTMLElement) => void;
}
export interface MarkdownNode extends HTMLDivElement {
  updateMarkdown(text: string, options?: MarkdownRenderOptions): void;
  disposeMarkdown(): void;
}
export function markdownNode(text: string, options?: MarkdownRenderOptions): MarkdownNode;
/** Sanitized HTML for `source`, rendered by Pocket's server, cached and de-duplicated. */
export function renderMarkdown(source: string, options?: { inline?: boolean; annotations?: unknown[] }, persist?: boolean): Promise<string>;
/** A checked DOM fragment for HTML from renderMarkdown. */
export function markdownFragment(html: string, namespace?: string): DocumentFragment;
