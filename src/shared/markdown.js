// Satteri runs on Pocket's Astro server. Unsent text is readable immediately;
// bounded account-scoped previews remain available offline.
import { storage, activeAccount } from '../client/workspace-storage.js';

const CACHE_KEY = 'pocket:markdown-cache:v1', MAX_CACHE = 600000, MAX_ENTRIES = 20;
const TAGS = new Set('P BR STRONG EM DEL CODE PRE A UL OL LI BLOCKQUOTE H2 H3 H4 H5 H6 HR TABLE THEAD TBODY TR TH TD DIV SPAN SECTION SUP'.split(' '));
const ATTRS = new Set('class data-align start title href target rel id aria-describedby aria-label role data-top data-bottom'.split(' '));
const PAGE = /^#\/(?:notes|tasks|thoughts|gym|movement|calendar)(?:\/[A-Za-z0-9_:.~%-]{1,120})?$/;
const FOOTNOTE = /^md-[A-Za-z0-9_%~.-]{1,1000}$/;
let owner = null, cache = [], pending = new Map(), serial = 0;
const key = (source, options) => JSON.stringify([source, !!options.inline, options.annotations || []]);

function scopedCache() {
  const current = activeAccount();
  if (owner !== current) {
    for (const request of pending.values()) request.controller.abort();
    pending.clear(); owner = current; cache = [];
    try {
      const value = storage.getItem(CACHE_KEY);
      if (value && value.length <= MAX_CACHE + 1000) {
        const rows = JSON.parse(value);
        if (Array.isArray(rows)) cache = rows.filter(row => row && typeof row.key === 'string' && typeof row.html === 'string').slice(-MAX_ENTRIES);
      }
    } catch { /* Cache loss never loses a note or answer. */ }
  }
  return current;
}
function remember(requestKey, html) {
  if (requestKey.length + html.length > MAX_CACHE / 2) return;
  cache = cache.filter(row => row.key !== requestKey); cache.push({ key: requestKey, html });
  while (cache.length > MAX_ENTRIES || JSON.stringify(cache).length > MAX_CACHE) cache.shift();
  try { storage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* Storage may be full. */ }
}
function safeHref(value) {
  if (PAGE.test(value) || value.startsWith('#') && FOOTNOTE.test(value.slice(1))) return true;
  if (/^mailto:[^\s<>"'`\\]{3,200}$/i.test(value)) return true;
  if (!/^https?:\/\//i.test(value)) return false;
  try { const url = new URL(value); return !url.username && !url.password; } catch { return false; }
}
// Cache HTML is checked inside an inert template before any node is attached.
function fragment(html, namespace) {
  if (typeof html !== 'string' || html.length > 1800000) throw new Error('Invalid Markdown response.');
  const template = document.createElement('template'); template.innerHTML = html;
  const elements = template.content.querySelectorAll('*');
  if (elements.length > 20000) throw new Error('Markdown is too large.');
  for (const node of elements) {
    if (!TAGS.has(node.tagName)) throw new Error('Invalid Markdown markup.');
    for (const attr of node.attributes) {
      if (!ATTRS.has(attr.name)) throw new Error('Invalid Markdown attribute.');
      if (attr.name === 'href' && (node.tagName !== 'A' || !safeHref(attr.value))) throw new Error('Invalid Markdown link.');
      if (attr.name === 'id' && !FOOTNOTE.test(attr.value)) throw new Error('Invalid Markdown id.');
      if (attr.name === 'class' && !/^(?:language-[\w#+.-]{1,24}|tasks|md-table|thought-line|accent|meta muted|footnotes|footnote-backref|footnote-ref|sr-only)$/.test(attr.value)) throw new Error('Invalid Markdown class.');
      if (attr.name === 'target' && attr.value !== '_blank' || attr.name === 'rel' && attr.value !== 'noopener noreferrer') throw new Error('Invalid Markdown target.');
      if (attr.name === 'data-align' && !/^(left|right|center)$/.test(attr.value)) throw new Error('Invalid Markdown alignment.');
      if (attr.name === 'start' && !/^\d{1,9}$/.test(attr.value)) throw new Error('Invalid list start.');
      if ((attr.name === 'data-top' || attr.name === 'data-bottom') && (!Number.isFinite(+attr.value) || +attr.value < 0 || +attr.value > 1)) throw new Error('Invalid handwriting strip.');
    }
    if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href') || '')) { node.target = '_blank'; node.rel = 'noopener noreferrer'; }
    if (node.id) node.id = namespace + node.id;
    const href = node.getAttribute('href');
    if (href?.startsWith('#md-')) node.setAttribute('href', '#' + namespace + href.slice(1));
    const described = node.getAttribute('aria-describedby');
    if (described) {
      if (!described.split(/\s+/).every(id => FOOTNOTE.test(id))) throw new Error('Invalid Markdown description.');
      node.setAttribute('aria-describedby', described.split(/\s+/).map(id => namespace + id).join(' '));
    }
  }
  return template.content;
}
async function compile(source, options, persist) {
  const account = scopedCache(), requestKey = key(source, options), hit = cache.find(row => row.key === requestKey);
  if (hit) {
    try { fragment(hit.html, 'check-'); return hit.html; }
    catch { cache = cache.filter(row => row !== hit); }
  }
  let entry = pending.get(requestKey);
  if (!entry) {
    const controller = new AbortController(); entry = { controller, persist };
    entry.promise = (async () => {
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch('/api/markdown', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source, inline: !!options.inline, annotations: options.annotations || [] }), signal: controller.signal });
        if (!response.ok) throw new Error('Markdown is unavailable.');
        const value = await response.json(); fragment(value.html, 'check-');
        if (activeAccount() !== account) throw new Error('Workspace changed.');
        if (entry.persist) remember(requestKey, value.html);
        return value.html;
      } finally { clearTimeout(timeout); if (pending.get(requestKey) === entry) pending.delete(requestKey); }
    })();
    pending.set(requestKey, entry);
  } else if (persist) entry.persist = true;
  return entry.promise;
}

/** Stable node with throttled, version-safe formatting for streamed replies. */
export function markdownNode(initial, initialOptions = {}) {
  const node = document.createElement('div'), namespace = 'pocket-markdown-' + ++serial + '-';
  let source = '', options = {}, currentKey = '', renderedSource = '', renderedHtml = '', account = scopedCache();
  let timer = 0, busy = false, disposed = false, generation = 0, lastStarted = 0;
  const paint = () => {
    if (disposed || activeAccount() !== account) return;
    const previous = options.onBeforeRender?.(node);
    if (renderedHtml && source.startsWith(renderedSource)) {
      try {
        node.replaceChildren(fragment(renderedHtml, namespace));
        if (source.length > renderedSource.length) { const tail = document.createElement('span'); tail.className = 'md-pending'; tail.textContent = source.slice(renderedSource.length); node.append(tail); }
        options.onRender?.(node, previous); return;
      } catch { renderedHtml = ''; renderedSource = ''; }
    }
    const plain = document.createElement(options.inline ? 'span' : 'p'); plain.className = 'md-pending'; plain.textContent = source; node.replaceChildren(plain);
    options.onRender?.(node, previous);
  };
  const schedule = () => {
    if (timer || busy || disposed || !source.trim() || source.length > 200000) return;
    timer = setTimeout(run, options.streaming ? Math.max(0, 600 - (Date.now() - lastStarted)) : 0);
  };
  const run = async () => {
    timer = 0;
    if (disposed || activeAccount() !== account) return;
    const text = source, settings = options, requestKey = currentKey, token = generation;
    busy = true; lastStarted = Date.now();
    try {
      const html = await compile(text, settings, !settings.streaming);
      if (disposed || activeAccount() !== account) return;
      if (token === generation || options.streaming && source.startsWith(text) && key('', settings) === key('', options)) {
        renderedSource = text; renderedHtml = html;
        if (!options.streaming && text === source) remember(currentKey, html);
        paint();
      }
    } catch { /* Text stays readable offline or after a failed render. */ }
    finally { busy = false; if (requestKey !== currentKey) schedule(); }
  };
  node.updateMarkdown = (value, nextOptions = options) => {
    if (disposed || activeAccount() !== account) return;
    const next = String(value ?? '').replace(/\r\n?/g, '\n'), nextKey = key(next, nextOptions);
    if (nextKey === currentKey) {
      const finished = options.streaming && !nextOptions.streaming; options = nextOptions;
      if (finished && renderedSource === source && renderedHtml) remember(currentKey, renderedHtml);
      else if (finished) { clearTimeout(timer); timer = 0; schedule(); }
      return;
    }
    source = next; options = nextOptions; currentKey = nextKey; generation++;
    const hit = cache.find(row => row.key === currentKey);
    if (hit) { renderedSource = source; renderedHtml = hit.html; }
    else if (!options.streaming || !source.startsWith(renderedSource)) { renderedSource = ''; renderedHtml = ''; }
    paint(); clearTimeout(timer); timer = 0; schedule();
  };
  node.disposeMarkdown = () => { disposed = true; clearTimeout(timer); };
  node.addEventListener('click', event => {
    const link = event.target.closest?.('a[href^="#pocket-markdown-"]');
    if (!link || !node.contains(link)) return;
    const target = node.querySelector('[id="' + link.getAttribute('href').slice(1) + '"]');
    if (target) { event.preventDefault(); target.scrollIntoView({ block: 'nearest' }); }
  });
  node.updateMarkdown(initial, initialOptions); return node;
}
