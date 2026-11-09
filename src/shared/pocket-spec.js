// json-render's patch stream, applied without a JSON-patch dependency: /root and /elements/<id> are the only
// paths a card needs, and a half-written last line is skipped so a reply can be drawn while it streams.

/**
 * json-render streams a spec as JSONL of RFC 6902 patches: /root, then one /elements/<id> per component, so a card
 * can be drawn while the model is still writing. Pocket accepts that stream (a half-written last line is skipped)
 * as well as a finished spec. Only the paths that build a tree are honoured.
 */
function pointer(path) {
  return path.split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function applyPatch(root, path, value, remove) {
  const parts = pointer(path);
  if (!parts.length) return remove ? null : value;
  let node = (root && typeof root === 'object' ? root : {});
  const base = node;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const next = node[key];
    if (!next || typeof next !== 'object') node[key] = /^\d+$/.test(parts[index + 1]) ? [] : {};
    node = node[key];
  }
  const last = parts[parts.length - 1];
  if (remove) {
    if (Array.isArray(node)) node.splice(Number(last), 1);
    else delete node[last];
  } else if (Array.isArray(node)) node[Number(last)] = value;
  else node[last] = value;
  return base;
}

/**
 * One JSONL patch. Repair missing closing brackets only; incomplete strings, values and mismatched
 * brackets stay invalid so truncated data is not silently accepted.
 */
function parsePatch(text) {
  try { return JSON.parse(text); } catch { /* try a repaired line */ }
  const open = [];
  let inString = false, escaped = false;
  for (const ch of text) {
    if (escaped) { escaped = false; continue; }
    if (inString && ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') open.push(ch === '{' ? '}' : ']');
    else if ((ch === '}' || ch === ']') && open.pop() !== ch) return null;
  }
  if (!open.length || inString) return null;
  try { return JSON.parse(text + open.reverse().join('')); } catch { return null; }
}

/** A finished spec, or the spec built so far from a patch stream. */
export function pocketSpec(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed);
    // Only something that looks like a card is a spec; arbitrary JSON in the fence stays prose.
    if (value && typeof value === 'object' && ('root' in value || 'elements' in value || 'type' in value)) return value;
    // A card of a single patch line is a patch stream too.
    if (!value || typeof value !== 'object' || typeof value.op !== 'string') return null;
  } catch { /* not one object: try patches */ }
  let spec = null, applied = 0;
  for (const line of trimmed.split('\n')) {
    const candidate = line.trim();
    if (!candidate.startsWith('{')) continue;
    const patch = parsePatch(candidate);
    if (!patch) continue;
    const op = patch;
    if (typeof op.op !== 'string' || typeof op.path !== 'string' || !['add', 'replace', 'remove'].includes(op.op)) continue;
    spec = applyPatch(spec, String(op.path), op.value, op.op === 'remove');
    applied += 1;
  }
  return applied ? spec : null;
}

/**
 * Some models write a card as one nested tree: {"type":"Stack","children":[{"type":"Chart",…}]}, either as the
 * whole spec or as the value of /root, with text as {"text": "…"} children. That becomes the flat form json-render
 * draws: each nested element gets an id (from its type, numbered in order, so ids stay the same as the tree grows
 * while it streams), and text children become the element's text prop. Flat specs pass through unchanged.
 */
function flattenTree(spec) {
  if (!spec || typeof spec !== 'object') return spec;
  const nested = node => node && typeof node === 'object' && typeof node.type === 'string';
  const tree = nested(spec) && !spec.elements ? spec : nested(spec.root) ? spec.root : null;
  const existing = spec.elements && typeof spec.elements === 'object' ? spec.elements : {};
  const inline = Object.values(existing).some(element => Array.isArray(element?.children) && element.children.some(child => child && typeof child === 'object'));
  if (!tree && !inline) return spec;
  const elements = { ...existing }, taken = new Set(Object.keys(elements));
  const fresh = type => {
    const base = String(type).toLowerCase().replace(/[^a-z0-9]/g, '') || 'element';
    let id = base, count = 1;
    while (taken.has(id)) id = base + '_' + ++count;
    taken.add(id); return id;
  };
  const shape = node => {
    const { type, props, children, ...rest } = node;
    const element = { ...rest, type, props: props && typeof props === 'object' && !Array.isArray(props) ? { ...props } : {}, children: [] };
    const words = [];
    for (const child of Array.isArray(children) ? children : []) {
      if (typeof child === 'string') element.children.push(child);
      else if (nested(child)) element.children.push(place(child));
      else if (child && typeof child.text === 'string') words.push(child.text);
    }
    if (words.length && element.props.text == null && element.props.label == null) element.props.text = words.join(' ');
    // Text draws only its own text. Text wrapped around other elements is a group of them, so it becomes a Stack
    // whose first child is that text (if it had any).
    if (type === 'Text' && element.children.length) {
      const own = element.props.text != null ? [place({ type: 'Text', props: { ...element.props } })] : [];
      return { ...rest, type: 'Stack', props: { direction: 'vertical', gap: 'sm' }, children: [...own, ...element.children] };
    }
    return element;
  };
  const place = node => { const id = fresh(node.type); elements[id] = null; elements[id] = shape(node); return id; };
  for (const [id, element] of Object.entries(existing)) if (nested(element)) elements[id] = shape(element);
  const root = tree ? place(tree) : spec.root;
  const { type: _type, props: _props, children: _children, ...meta } = tree === spec ? spec : { ...spec };
  return { ...(tree === spec ? meta : spec), root, elements };
}

/**
 * json-render draws elements[root]. If the named root is missing,
 * one top-level element becomes the
 * root itself, several are wrapped in a Stack under the id the model named.
 */
export function normalizeSpec(spec) {
  spec = flattenTree(spec);
  const elements = spec && spec.elements;
  if (!elements || typeof elements !== 'object') return spec;
  const ids = Object.keys(elements);
  if (!ids.length) return spec;
  const named = typeof spec.root === 'string' && spec.root ? spec.root : null;
  if (named && elements[named]) return spec;
  const referenced = new Set();
  for (const element of Object.values(elements)) {
    if (!element || typeof element !== 'object') continue;
    for (const child of Array.isArray(element.children) ? element.children : []) referenced.add(String(child));
  }
  const top = ids.filter(id => !referenced.has(id));
  if (!top.length) return spec;
  if (top.length === 1) return { ...spec, root: top[0] };
  let id = named || 'main';
  while (Object.hasOwn(elements, id)) id += '_';
  return { ...spec, root: id, elements: { ...elements, [id]: { type: 'Stack', props: { direction: 'vertical', gap: 'md' }, children: top } } };
}

/** Types and props only the retired card format had; see src/app/surface/cards.tsx for the same test. */
const LEGACY_TYPES = new Set(['Section', 'Fields', 'Field', 'Divider', 'Actions', 'LinkButton']);

/** Whether a spec was written in the retired card format, which the current renderer cannot draw as intended. */
export function isLegacySpec(spec) {
  const elements = spec && spec.elements;
  if (!elements || typeof elements !== 'object') return false;
  return Object.values(elements).some(element => {
    if (!element || typeof element !== 'object') return false;
    const props = element.props;
    return LEGACY_TYPES.has(String(element.type))
      || (element.type === 'Chart' && props != null && 'chart' in props)
      || (element.type === 'Table' && props != null && 'headers' in props)
      || (element.type === 'Card' && props != null && 'subtitle' in props)
      || (element.type === 'Button' && !element.on && props != null && ('value' in props || 'id' in props));
  });
}

/**
 * A replayed answer is history the model copies: a card in the retired format would teach it that shape again.
 * The prose stays; only such a fence is replaced, and with a line that says the format is gone.
 */
export function withoutLegacyCards(text) {
  return String(text ?? '').replace(/```pocket[ \t]*\r?\n([\s\S]*?)```/g, (block, body) => {
    const spec = pocketSpec(body);
    return spec && isLegacySpec(spec) ? '[card omitted: it used the retired card format; draw cards only in the current one]' : block;
  });
}

