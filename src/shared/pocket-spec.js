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

/** A finished spec, or the spec built so far from a patch stream. */
export function pocketSpec(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed);
    // Only something that looks like a card is a spec; arbitrary JSON in the fence stays prose.
    if (value && typeof value === 'object' && ('root' in value || 'elements' in value || 'type' in value)) return value;
    return null;
  } catch { /* not one object: try patches */ }
  let spec = null, applied = 0;
  for (const line of trimmed.split('\n')) {
    const candidate = line.trim();
    if (!candidate.startsWith('{')) continue;
    let patch;
    try { patch = JSON.parse(candidate); } catch { continue; }
    const op = patch;
    if (typeof op.op !== 'string' || typeof op.path !== 'string' || !['add', 'replace', 'remove'].includes(op.op)) continue;
    spec = applyPatch(spec, String(op.path), op.value, op.op === 'remove');
    applied += 1;
  }
  return applied ? spec : null;
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

