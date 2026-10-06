export const objectId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const stamp = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const pick = (value, names) => Object.fromEntries(names.filter(name => value[name] !== undefined).map(name => [name, value[name]]));
export function sanitizeObject(collection, value) {
  const uid = collection === 'chats' ? 'uid' : 'id';
  if (value.deleted) return { [uid]: value[uid], updated: value.updated, deleted: true };
  if (collection === 'zines') return { id: value.id, title: value.title, byline: value.byline || '', tone: value.tone, photos: value.photos.map(photo => pick(photo, ['id', 'caption', 'layout'])), created: value.created, updated: value.updated };
  const context = values => (values || []).map(item => pick(item, ['kind', 'uid', 'id', 'title', 'text', 'originalLength', 'href']));
  return { ...pick(value, ['uid', 'title', 'created', 'updated', 'draft', 'draftUpdated', 'returnedModel', 'usage']),
    config: pick(value.config, ['provider', 'model', 'baseUrl', 'maxTokens', 'thinking', 'webSearch']), context: context(value.context),
    turns: value.turns.map(turn => ({ ...pick(turn, ['uid', 'assistantUid', 'owner', 'text', 'answer', 'reasoning', 'error', 'status', 'created', 'updated', 'attempt', 'usage', 'activity', 'sources', 'phase', 'model']), context: context(turn.context) })) };
}
function safeConfig(value) {
  try {
    const url = new URL(value.baseUrl);
    return ['anthropic', 'compatible'].includes(value.provider) && typeof value.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,119}$/.test(value.model) && url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && Number.isInteger(value.maxTokens) && value.maxTokens >= 64 && value.maxTokens <= 8192;
  } catch { return false; }
}
const contexts = value => Array.isArray(value) && value.length <= 3 && value.every(item => object(item) && typeof item.text === 'string' && item.text.length <= 8000 && typeof item.title === 'string' && item.title.length <= 500);
export function canonical(value) { if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'; if (object(value)) return '{' + Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'; return JSON.stringify(value); }
const newer = (a, b, left, right) => left !== right ? left > right : canonical(a) > canonical(b);
export function validObject(collection, value) {
  if (!object(value) || !stamp(value.updated)) return false;
  if (collection === 'zines') return objectId(value.id) && (value.deleted === true || (typeof value.title === 'string' && value.title.length <= 1000 && Array.isArray(value.photos) && value.photos.length <= 40 && value.photos.every(photo => object(photo) && objectId(photo.id))));
  if (collection === 'chats') return objectId(value.uid) && (value.deleted === true || (
    typeof value.title === 'string' && value.title.length <= 1000 && typeof value.draft === 'string' && value.draft.length <= 16000 && contexts(value.context) && Array.isArray(value.turns) && value.turns.length <= 2000 && object(value.config) && safeConfig(value.config) &&
    value.turns.every(turn => object(turn) && objectId(turn.uid) && typeof turn.text === 'string' && turn.text.length <= 16000 && typeof turn.answer === 'string' && ['streaming', 'done', 'failed', 'stopped'].includes(turn.status) && contexts(turn.context || []) && (turn.updated === undefined || stamp(turn.updated)))));
  return false;
}
export function mergeObject(collection, stored, incoming) {
  if (!stored) return incoming;
  if (stored.deleted || incoming.deleted) return (incoming.deleted && (!stored.deleted || incoming.updated > stored.updated)) ? incoming : stored;
  if (collection === 'zines') return newer(incoming, stored, incoming.updated, stored.updated) ? incoming : stored;
  const latest = newer(incoming, stored, incoming.updated, stored.updated) ? incoming : stored;
  const draft = newer([incoming.draft, incoming.context], [stored.draft, stored.context], incoming.draftUpdated ?? incoming.updated, stored.draftUpdated ?? stored.updated) ? incoming : stored;
  const turns = new Map(stored.turns.map(turn => [turn.uid, turn]));
  for (const turn of incoming.turns) {
    const previous = turns.get(turn.uid);
    if (!previous || newer(turn, previous, turn.updated ?? incoming.updated, previous.updated ?? stored.updated)) turns.set(turn.uid, turn);
  }
  return { ...latest, draft: draft.draft, context: draft.context, draftUpdated: draft.draftUpdated ?? draft.updated,
    turns: [...turns.values()].sort((a, b) => a.created - b.created || a.uid.localeCompare(b.uid)), updated: Math.max(stored.updated, incoming.updated) };
}
