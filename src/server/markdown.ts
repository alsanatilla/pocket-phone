import { randomUUID } from 'node:crypto';
import { markdownToHast, type HastNode } from 'satteri';

export const MARKDOWN_SOURCE_LIMIT = 200_000;
export const MARKDOWN_BODY_LIMIT = 1024 * 1024;
const MAX_ANNOTATIONS = 1000;
const MAX_NODES = 20_000;
const MAX_DEPTH = 128;
const MAX_HTML = 1800_000;

export type Annotation = {
  line: number;
  thought?: { text: string; status: string };
  strip?: { top: number; bottom: number };
};
export type MarkdownInput = { source: string; inline?: boolean; annotations?: Annotation[] };
export class MarkdownError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.name = 'MarkdownError'; this.status = status; }
}

type Tree = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Tree[];
  position?: { start: { line: number; column: number }; end: { line: number; column: number } };
};
type State = {
  nodes: number;
  scope: string;
  ids: Map<string, string>;
  lines: string[];
  originalLines: number[];
  annotations: Map<number, Annotation>;
  markers: Map<string, Annotation>;
  strips: Set<number>;
};
type Context = { inline: boolean; code: boolean; anchor: boolean; quote: number; prose: boolean };

const escape = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const problem = (message: string, status = 400) => new MarkdownError(message, status);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));

/** Only text and bounded metadata cross this boundary; callers cannot provide HTML. */
export function markdownInput(value: unknown): MarkdownInput {
  if (!object(value) || !keys(value, ['source', 'inline', 'annotations']) || typeof value.source !== 'string') throw problem('Invalid Markdown request.');
  if (value.source.length > MARKDOWN_SOURCE_LIMIT) throw problem('Markdown is too long.', 413);
  if (value.inline !== undefined && typeof value.inline !== 'boolean') throw problem('Invalid Markdown options.');
  const source = value.source.replace(/\r\n?/g, '\n');
  const lineCount = source.split('\n').length;
  const annotations: Annotation[] = [];
  if (value.annotations !== undefined) {
    if (!Array.isArray(value.annotations) || value.annotations.length > MAX_ANNOTATIONS || value.inline === true && value.annotations.length > 0) throw problem('Invalid Markdown annotations.');
    const seen = new Set<number>();
    for (const item of value.annotations) {
      if (!object(item) || !keys(item, ['line', 'thought', 'strip']) || !Number.isSafeInteger(item.line) || Number(item.line) < 1 || Number(item.line) > lineCount || seen.has(Number(item.line))) throw problem('Invalid Markdown annotations.');
      const annotation: Annotation = { line: Number(item.line) };
      seen.add(annotation.line);
      if (item.thought !== undefined) {
        if (!object(item.thought) || !keys(item.thought, ['text', 'status']) || typeof item.thought.text !== 'string' || !item.thought.text.trim() || item.thought.text.length > 20_000 || /[\r\n]/.test(item.thought.text) || (item.thought.status !== undefined && (typeof item.thought.status !== 'string' || item.thought.status.length > 80))) throw problem('Invalid Markdown annotations.');
        annotation.thought = { text: item.thought.text, status: String(item.thought.status ?? '') };
      }
      if (item.strip !== undefined) {
        if (!object(item.strip) || !keys(item.strip, ['top', 'bottom']) || typeof item.strip.top !== 'number' || typeof item.strip.bottom !== 'number' || !Number.isFinite(item.strip.top) || !Number.isFinite(item.strip.bottom) || item.strip.top < 0 || item.strip.bottom > 1 || item.strip.bottom <= item.strip.top) throw problem('Invalid Markdown annotations.');
        annotation.strip = { top: item.strip.top, bottom: item.strip.bottom };
      }
      if (!annotation.thought && !annotation.strip) throw problem('Invalid Markdown annotations.');
      annotations.push(annotation);
    }
  }
  return { source, inline: value.inline === true, annotations };
}

function tree(source: string, scope: string): Tree {
  return markdownToHast(source, {
    position: true,
    features: { gfm: { footnotes: { clobberPrefix: scope } }, frontmatter: false, rawHtml: false },
  }) as HastNode as Tree;
}

function inspect(node: Tree, visit: (node: Tree, footnotes: boolean) => void, depth = 0, footnotes = false, count = { value: 0 }) {
  if (depth > MAX_DEPTH || ++count.value > MAX_NODES) throw problem('Markdown is too complex.', 413);
  const inFootnotes = footnotes || (node.type === 'element' && node.tagName === 'section' && node.properties?.dataFootnotes === true);
  visit(node, inFootnotes);
  for (const child of node.children ?? []) inspect(child, visit, depth + 1, inFootnotes, count);
}

function collectIds(root: Tree, state: State) {
  inspect(root, (node, footnotes) => {
    if (node.type !== 'element') return;
    const id = node.properties?.id;
    if (typeof id !== 'string' || id.length > 200) return;
    if (id.startsWith(state.scope + 'fn-') || id.startsWith(state.scope + 'fnref-')) {
      state.ids.set(id, state.scope + encodeURIComponent(id.slice(state.scope.length)).replace(/[!'()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase()));
    } else if (footnotes && node.tagName === 'h2' && id === 'footnote-label') state.ids.set(id, state.scope + 'label');
  });
}

const POCKET_PAGE = /^\/(?:notes|tasks|thoughts|gym|movement|calendar)(?:\/[A-Za-z0-9_:.~%-]{1,120})?$/;
function destination(value: unknown, state: State, footnote: boolean) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  const raw = value.trim();
  if (/^https?:\/\//i.test(raw)) {
    try { const url = new URL(raw); return url.username || url.password ? null : { href: url.href, external: true }; } catch { return null; }
  }
  if (/^mailto:[^\s<>"'`\\]{3,200}$/i.test(raw)) return { href: raw, external: false };
  const route = raw.startsWith('#/') ? raw.slice(1) : raw;
  if (POCKET_PAGE.test(route)) return { href: '#' + route, external: false };
  if (footnote && raw.startsWith('#') && state.ids.has(raw.slice(1))) return { href: '#' + state.ids.get(raw.slice(1)), external: false };
  return null;
}

function attributes(annotation: Annotation | undefined, state: State) {
  const strip = annotation?.strip;
  if (!strip || state.strips.has(annotation!.line)) return '';
  state.strips.add(annotation!.line);
  return ` data-top="${strip.top}" data-bottom="${strip.bottom}"`;
}

function sourceLine(node: Tree, state: State) {
  return node.position ? state.originalLines[node.position.start.line - 1] || 0 : 0;
}

function inline(source: string, state: State, depth: number) {
  // A harmless text prefix makes leading Markdown block markers ordinary inline text.
  // This still uses the native parser; no browser parser or JavaScript evaluation is involved.
  const prefix = state.scope + 'inline ';
  const root = tree(prefix + source, state.scope);
  const first = root.children?.find(node => node.type === 'element');
  const firstText = first?.children?.find(node => node.type === 'text');
  if (firstText?.value?.startsWith(prefix)) firstText.value = firstText.value.slice(prefix.length);
  return serialize(root, state, { inline: true, code: false, anchor: false, quote: 0, prose: true }, depth).replace(/<br>$/, '');
}

/** Split positioned inline nodes, retaining the native parser's resolved links,
 * footnotes and formatting instead of reparsing each photographed source line. */
function byLine(nodes: Tree[], fallback: number, depth = 0): Map<number, Tree[]> {
  if (depth > MAX_DEPTH) throw problem('Markdown is too complex.', 413);
  const result = new Map<number, Tree[]>();
  const append = (line: number, node: Tree) => {
    const list = result.get(line) ?? [];
    list.push(node); result.set(line, list);
    if (result.size > MAX_NODES) throw problem('Markdown is too complex.', 413);
  };
  for (const node of nodes) {
    const start = node.position?.start.line ?? fallback;
    if ((node.type === 'text' || node.type === 'raw') && node.position && node.position.end.line > start) {
      const parts = (node.value || '').split('\n');
      for (let offset = 0; offset < parts.length; offset++) if (parts[offset]) append(start + offset, { ...node, value: parts[offset], position: { start: { line: start + offset, column: offset ? 1 : node.position.start.column }, end: { line: start + offset, column: 1 } } });
    } else if (node.type === 'element' && node.tagName !== 'code' && node.children?.length) {
      for (const [line, children] of byLine(node.children, start, depth + 1)) append(line, { ...node, children, position: { start: { line, column: 1 }, end: { line, column: 1 } } });
    } else append(start, node);
  }
  return result;
}

const TAGS = new Set(['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'section', 'sup']);
const INLINE_TAGS = new Set(['br', 'strong', 'em', 'del', 'code', 'a', 'sup']);
function serialize(node: Tree, state: State, context: Context, depth = 0): string {
  if (depth > MAX_DEPTH || ++state.nodes > MAX_NODES) throw problem('Markdown is too complex.', 413);
  if (node.type === 'text') return context.code || !context.prose || !node.position ? escape(node.value) : escape(node.value).replace(/\n/g, '<br>');
  if (node.type === 'raw') {
    const text = escape(node.value).replace(/\n/g, '<br>');
    return context.prose || context.inline ? text : `<p>${text}</p>`;
  }
  const children = (next = context) => (node.children ?? []).map(child => serialize(child, state, next, depth + 1)).join('');
  if (node.type === 'root') return children();
  if (node.type !== 'element') return '';
  const tag = node.tagName || '', props = node.properties ?? {};
  if (tag === 'input') return props.type === 'checkbox' && props.disabled === true ? (props.checked === true ? '[x]' : '[ ]') : '';
  if (tag === 'img') {
    const label = escape(typeof props.alt === 'string' && props.alt ? props.alt : 'image');
    const target = destination(props.src, state, false);
    if (!target || context.anchor) return label;
    return `<a href="${escape(target.href)}"${target.external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
  }
  if (!TAGS.has(tag)) return children();
  if (context.inline && !INLINE_TAGS.has(tag)) return children({ ...context, code: tag === 'pre' || context.code, prose: true }) + (tag === 'p' || tag === 'li' ? '<br>' : '');
  const line = sourceLine(node, state), annotation = state.annotations.get(line);
  if (tag === 'p' && !context.code) {
    const first = node.children?.[0];
    const marker = first?.type === 'text' ? (first.value || '').split(' ', 1)[0] : '';
    const replacement = state.markers.get(marker);
    if (replacement?.thought && first?.value?.startsWith(marker + ' ')) {
      first.value = first.value.slice(marker.length + 1);
      return `<p class="thought-line"${attributes(replacement, state)}><span class="accent">»</span> ${children({ ...context, prose: true })}${replacement.thought.status ? ` <span class="meta muted">· ${escape(replacement.thought.status)}</span>` : ''}</p>`;
    }
    const begin = node.position?.start.line ?? 0, end = node.position?.end.line ?? 0;
    if (end > begin && Array.from({ length: end - begin + 1 }, (_, offset) => state.originalLines[begin + offset - 1]).some(original => state.annotations.get(original)?.strip)) {
      // A paper note has a separate crop for each source line. Split only these
      // paragraphs; ordinary Markdown keeps its complete native document tree.
      const out: string[] = [];
      for (const [index, parts] of [...byLine(node.children ?? [], begin).entries()].sort(([a], [b]) => a - b)) {
        const original = state.originalLines[index - 1], at = state.annotations.get(original);
        out.push(`<p${attributes(at, state)}>${parts.map(part => serialize(part, state, { ...context, prose: true }, depth + 1)).join('')}</p>`);
      }
      return out.join('');
    }
  }
  if (tag === 'a') {
    const footnote = props.dataFootnoteRef === true || props.dataFootnoteBackref !== undefined;
    const target = destination(props.href, state, footnote);
    const label = children({ ...context, anchor: true, prose: true });
    if (!target || context.anchor) return label;
    const id = typeof props.id === 'string' ? state.ids.get(props.id) : undefined;
    const described = Array.isArray(props.ariaDescribedBy) ? props.ariaDescribedBy.filter(item => typeof item === 'string' && state.ids.has(item)).map(item => state.ids.get(item)).join(' ') : '';
    return `<a href="${escape(target.href)}"${target.external ? ' target="_blank" rel="noopener noreferrer"' : ''}${typeof props.title === 'string' && props.title.length <= 1000 ? ` title="${escape(props.title)}"` : ''}${id ? ` id="${escape(id)}"` : ''}${described ? ` aria-describedby="${escape(described)}"` : ''}${footnote && typeof props.ariaLabel === 'string' ? ` aria-label="${escape(props.ariaLabel)}"` : ''}>${label}</a>`;
  }
  if (tag === 'br' || tag === 'hr') return `<${tag}>`;
  let outTag = /^h[1-6]$/.test(tag) ? 'h' + Math.min(Number(tag[1]) + 1, 6) : tag;
  let attrs = '';
  if ((tag === 'p' || /^h[1-6]$/.test(tag) || tag === 'li' || tag === 'tr') && !context.code) attrs += attributes(annotation, state);
  if (tag === 'ol' && Number.isSafeInteger(props.start) && Number(props.start) >= 0 && Number(props.start) < 1e9 && props.start !== 1) attrs += ` start="${props.start}"`;
  if ((tag === 'ul' || tag === 'ol') && Array.isArray(props.className) && props.className.includes('contains-task-list')) attrs += ' class="tasks"';
  if (tag === 'code' && Array.isArray(props.className)) {
    const language = props.className.find(item => typeof item === 'string' && /^language-[A-Za-z0-9_#+.-]{1,24}$/.test(item));
    if (language) attrs += ` class="${escape(language)}"`;
  }
  if (tag === 'th' || tag === 'td') {
    const alignment = typeof props.style === 'string' ? /^text-align:\s*(left|right|center)\s*;?$/.exec(props.style)?.[1] : undefined;
    if (alignment) attrs += ` data-align="${alignment}"`;
  }
  if (tag === 'section' && props.dataFootnotes === true) attrs += ' class="footnotes"';
  const id = typeof props.id === 'string' ? state.ids.get(props.id) : undefined;
  if (id) attrs += ` id="${escape(id)}"`;
  if (tag === 'h2' && props.id === 'footnote-label' && id) { outTag = 'h2'; attrs += ' class="sr-only"'; }
  const html = `<${outTag}${attrs}>${children({ ...context, code: context.code || tag === 'pre' || tag === 'code', quote: context.quote + (tag === 'blockquote' ? 1 : 0), prose: tag === 'p' || /^h[1-6]$/.test(tag) || tag === 'li' || tag === 'th' || tag === 'td' || context.prose })}</${outTag}>`;
  return tag === 'table' ? `<div class="md-table">${html}</div>` : html;
}

/** Compile with Astro 7's native Rust Markdown engine, then serialize an allowlisted tree. */
export function renderMarkdown(value: unknown): string {
  const input = markdownInput(value);
  if (!input.source.trim()) return '';
  const scope = 'md-' + randomUUID().replace(/-/g, '') + '-';
  const state: State = { nodes: 0, scope, ids: new Map(), lines: input.source.split('\n'), originalLines: [], annotations: new Map((input.annotations ?? []).map(item => [item.line, item])), markers: new Map(), strips: new Set() };
  if (input.inline) {
    const html = inline(input.source, state, 0).replace(/<br>$/, '');
    if (html.length > MAX_HTML) throw problem('Markdown is too complex.', 413);
    return html;
  }
  let root = tree(input.source, scope);
  const blocked = new Set<number>();
  if ((input.annotations ?? []).length) inspect(root, node => {
    if ((node.tagName === 'pre' || (node.type === 'raw' && (node.value || '').includes('\n'))) && node.position) for (let line = node.position.start.line; line <= node.position.end.line; line++) blocked.add(line);
  });
  for (const line of blocked) state.annotations.delete(line);
  const rewritten: string[] = [];
  for (let index = 0; index < state.lines.length; index++) {
    const line = index + 1, annotation = state.annotations.get(line), source = state.lines[index];
    if (annotation?.thought && !blocked.has(line) && /^[ \t]*>>[ \t]+\S/.test(source)) {
      const marker = scope + 'thought-' + line;
      state.markers.set(marker, annotation);
      rewritten.push('', marker + ' ' + annotation.thought.text, ''); state.originalLines.push(0, line, 0);
    } else { rewritten.push(source); state.originalLines.push(line); }
  }
  if (state.markers.size) root = tree(rewritten.join('\n'), scope);
  collectIds(root, state);
  const html = serialize(root, state, { inline: false, code: false, anchor: false, quote: 0, prose: false });
  if (html.length > MAX_HTML) throw problem('Markdown is too complex.', 413);
  return html;
}
