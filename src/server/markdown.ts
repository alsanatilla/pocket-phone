import { randomUUID } from 'node:crypto';
import { markdownToHast, type HastNode } from 'satteri';
import { pocketSpec } from '../shared/pocket-spec.js';

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

/**
 * A fenced ```pocket block is a small component spec, rendered here into plain HTML after the markdown tree.
 * The catalog mirrors the primitives the Vercel json-render examples use — card, text, fields, table, progress,
 * chart, note — so a reply can describe a layout instead of only prose. Unknown types are skipped, never thrown.
 */
const POCKET_FENCE = /^[ \t]*```pocket[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*$/gm;
const POCKET_TOKEN = (index: number) => `POCKETCARD${index}TOKEN`;
const MAX_CHILDREN = 24, MAX_ROWS = 12, MAX_VALUES = 40;

const str = (value: unknown, limit: number) => (typeof value === 'string' ? value.slice(0, limit) : '');
const list = (value: unknown, limit: number) => (Array.isArray(value) ? value.slice(0, limit) : []);

/** Field/Fields: a label and a value, the same pair the standard catalog uses. */
function fields(items: unknown[]): string {
  return items
    .filter(item => item && typeof item === 'object' && typeof (item as Record<string, unknown>).value === 'string')
    .map(item => {
      const row = item as Record<string, unknown>;
      return `<div class="pocket-row"><span class="pocket-k">${escape(str(row.label, 24))}</span><span class="pocket-v">${escape(str(row.value, 160))}</span></div>`;
    })
    .join('');
}

/** Table takes headers + rows + optional caption + align, exactly like the standard component. */
function table(node: Record<string, unknown>): string {
  const headers = list(node.headers, 5).map(item => str(item, 24));
  const rows = list(node.rows, MAX_ROWS).filter(row => Array.isArray(row));
  if (!headers.length || !rows.length) return '';
  const columns = Math.min(5, Math.max(headers.length, ...rows.map(row => (row as unknown[]).length)));
  const align = str(node.align, 10);
  const cell = (tag: string, value: unknown) => `<span class="${tag}"${align === 'right' ? ' data-align="right"' : ''}>${escape(str(value, 120))}</span>`;
  const head = headers.map(item => cell('pocket-th', item)).join('');
  const body = rows.map(row => `<div class="pocket-tr pocket-c${Math.min(4, columns)}">${Array.from({ length: columns }, (_, index) => cell('pocket-td', (row as unknown[])[index] ?? '')).join('')}</div>`).join('');
  const caption = str(node.caption, 80);
  return `<div class="pocket-table"><div class="pocket-tr pocket-thead pocket-c${Math.min(4, columns)}">${head}</div>${body}${caption ? `<div class="pocket-label">${escape(caption)}</div>` : ''}</div>`;
}

/** Chart accepts {data:[{label,value}]} or a bare number list; bars are quantised to ten steps. */
function chart(node: Record<string, unknown>): string {
  const raw = node.chart ?? node;
  const source = Array.isArray(raw) ? raw : Array.isArray((raw as Record<string, unknown>)?.data) ? (raw as Record<string, unknown>).data as unknown[] : [];
  const values = list(source, MAX_VALUES).map(item => {
    if (typeof item === 'number' && Number.isFinite(item)) return Math.max(0, item);
    if (item && typeof item === 'object') { const value = Number((item as Record<string, unknown>).value); return Number.isFinite(value) ? Math.max(0, value) : 0; }
    return 0;
  });
  if (values.length < 2) return '';
  const max = Math.max(...values) || 1;
  const bars = values.map(item => `<span class="pocket-col pocket-h${Math.min(10, Math.max(1, Math.round((item / max) * 10)))}"></span>`).join('');
  const label = str((node && node.title) ?? (raw as Record<string, unknown>)?.title, 80);
  return `<div class="pocket-chart">${label ? `<div class="pocket-label">${escape(label)}</div>` : ''}<div class="pocket-bars">${bars}</div></div>`;
}

/**
 * Two shapes are accepted: json-render's element map ({root, elements:{id:{type, props, children}}}) and the
 * nested form a model writes more easily ({type, title, children:[...]}). Both end up in the same HTML.
 */
function pocketNode(raw: unknown, depth = 0): string {
  if (!raw || typeof raw !== 'object' || depth > 4) return '';
  const node = raw as Record<string, unknown>;
  const type = str(node.type, 20).toLowerCase() || 'card';
  const props = (node.props && typeof node.props === 'object' ? node.props : node) as Record<string, unknown>;
  const children = list(node.children, MAX_CHILDREN);
  if (type === 'text') {
    const value = str(props.content ?? props.text, 600).trim();
    return value ? `<div class="pocket-text${str(props.style, 10) === 'muted' ? ' pocket-muted' : ''}">${escape(value)}</div>` : '';
  }
  if (type === 'note') {
    const value = str(props.text ?? props.content, 300).trim();
    return value ? `<div class="pocket-note">${escape(value)}</div>` : '';
  }
  if (type === 'divider' || type === 'hr') return '<div class="pocket-divider"></div>';
  if (type === 'field') {
    return `<div class="pocket-row"><span class="pocket-k">${escape(str(props.label, 24))}</span><span class="pocket-v">${escape(str(props.value, 160))}</span></div>`;
  }
  if (type === 'fields' || type === 'rows') return fields(list(props.items ?? props.rows ?? children, MAX_ROWS));
  if (type === 'table') return table(props);
  if (type === 'chart' || type === 'bars') return chart(props);
  if (type === 'image') {
    const url = str(props.url, 300);
    if (!/^https:\/\/[^\s"'<>]{4,300}$/i.test(url)) return '';
    return `<div class="pocket-image"><span class="pocket-image-alt">${escape(str(props.alt, 120) || 'image')}</span></div>`;
  }
  if (type === 'button') {
    const label = str(props.label, 40), id = str(props.id, 40), value = str(props.value, 200);
    return `<span class="pocket-button${str(props.style, 10) === 'primary' ? ' pocket-primary' : ''}" role="button" tabindex="0" data-pocket-action="${escape(id || label)}" data-pocket-value="${escape(value || label)}">${escape(label)}</span>`;
  }
  if (type === 'linkbutton') {
    const url = str(props.url, 300);
    if (!/^https?:\/\/[^\s"'<>]{4,300}$/i.test(url)) return `<span class="pocket-button">${escape(str(props.label, 40))}</span>`;
    return `<a class="pocket-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(str(props.label, 40))}</a>`;
  }
  if (type === 'actions') {
    const inner = str((node as Record<string, unknown>).html, 20_000) || children.map(child => pocketNode(child, depth + 1)).join('');
    return inner ? `<div class="pocket-actions">${inner}</div>` : '';
  }
  if (type === 'progress') {
    const value = typeof props.value === 'number' && Number.isFinite(props.value) ? Math.min(1, Math.max(0, props.value)) : 0;
    const cells = 20, filled = Math.round(value * cells);
    return `<div class="pocket-progress" role="img" aria-label="${Math.round(value * 100)}%">${
      Array.from({ length: cells }, (_, index) => `<span class="${index < filled ? 'pocket-on' : 'pocket-off'}"></span>`).join('')}</div>`;
  }
  // Containers: card and section. Children are nested nodes, or HTML already rendered from an element map.
  const nested = str((node as Record<string, unknown>).html, 60_000) || children.map(child => (typeof child === 'string' ? '' : pocketNode(child, depth + 1))).join('');
  const title = str(props.title, 80).trim();
  const subtitle = str(props.subtitle, 120).trim();
  const inline = type === 'section' ? '' : (typeof props.progress === 'number' ? pocketNode({ type: 'progress', value: props.progress }, depth + 1) : '') + fields(list(props.rows, MAX_ROWS));
  const inner = inline + nested;
  if (!title && !subtitle && !inner) return '';
  return `<section class="pocket-card${depth ? ' pocket-nested' : ''}">`
    + (depth ? '' : '<div class="pocket-bar"></div>')
    + (title ? `<div class="pocket-title">${escape(title)}</div>` : '')
    + (subtitle ? `<div class="pocket-sub">${escape(subtitle)}</div>` : '')
    + (inner ? `<div class="pocket-body">${inner}</div>` : '')
    + '</section>';
}

/** Walks an element map from its root id, resolving children by reference. */
function elementMap(spec: Record<string, unknown>): string {
  const elements = spec.elements;
  if (!elements || typeof elements !== 'object') return '';
  const map = elements as Record<string, Record<string, unknown>>;
  const seen = new Set<string>();
  const walk = (id: string, depth: number): string => {
    if (depth > 4 || seen.has(id)) return '';
    const element = map[id];
    if (!element) return '';
    seen.add(id);
    const node = { ...element, props: element.props ?? {}, html: list(element.children, MAX_CHILDREN).map(child => walk(String(child), depth + 1)).filter(Boolean).join('') };
    const built = pocketNode(node, depth);
    // Children were already rendered above; pass them as HTML by re-running the container path.
    if (built) return built;
    return '';
  };
  return walk(str(spec.root, 40) || Object.keys(map)[0] || '', 0);
}

function cardHtml(value: string): string | null {
  const spec = pocketSpec(value);
  if (!spec || typeof spec !== 'object') return null;
  const record = spec as Record<string, unknown>;
  return (record.elements ? elementMap(record) : pocketNode(record)) || null;
}


/** The fenced block at the end of a streaming reply is still open; render what arrived instead of showing code. */
function openCard(source: string): { source: string; card: string | null } {
  const match = /(?:^|\n)([ \t]*)```pocket[ \t]*\n([\s\S]*)$/.exec(source);
  if (!match) return { source, card: null };
  const body = match[2];
  if (body.includes('```')) return { source, card: null };
  const spec = pocketSpec(body);
  const html = spec ? (('elements' in (spec as object)) ? elementMap(spec as Record<string, unknown>) : pocketNode(spec)) : '';
  if (!html) return { source, card: null };
  return { source: source.slice(0, match.index), card: html };
}

/** Replaces every fenced card with a token so markdown never sees the JSON, and keeps the card HTML aside. */
function extractCards(source: string): { source: string; cards: string[] } {
  const cards: string[] = [];
  const replaced = source.replace(POCKET_FENCE, (whole, body: string) => {
    const html = cardHtml(body);
    if (!html) return whole;
    cards.push(html);
    return '\n' + POCKET_TOKEN(cards.length - 1) + '\n';
  });
  return { source: replaced, cards };
}

/** Compile with Astro 7's native Rust Markdown engine, then serialize an allowlisted tree. */
export function renderMarkdown(value: unknown): string {
  const input = markdownInput(value);
  if (!input.source.trim()) return '';
  const cards = input.inline ? { source: input.source, cards: [] as string[] } : extractCards(input.source);
  const open = input.inline ? { source: cards.source, card: null } : openCard(cards.source);
  cards.source = open.source;
  input.source = cards.source;
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
  let html = serialize(root, state, { inline: false, code: false, anchor: false, quote: 0, prose: false });
  if (cards.cards.length) html = html.replace(/<p>POCKETCARD(\d+)TOKEN<\/p>/g, (_whole, index: string) => cards.cards[Number(index)] ?? '');
  if (open.card) html += open.card;
  if (html.length > MAX_HTML) throw problem('Markdown is too complex.', 413);
  return html;
}
