import { storage } from './workspace-storage.js';
import { importDocument } from './store.js';

const PREFS = new Set(['appearance', 'dice', 'pip-defaults', 'today-tiles', 'camera', 'calculator', 'home-tiles', 'daily-brief']);
const KINDS = new Set(['note', 'task', 'thought', 'capture', 'appointment']);
const SECRET = /^(?:key|api[_-]?key|key_value|key_endpoint|key_last4|password|credential|token|access[_-]?token|refresh[_-]?token|authorization|permission|permissions|alarm|boot)$/i;
const clone = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
let applying = 0, initialized = false;
function portable(value, depth = 0) {
  if (depth > 10) throw new Error('This setting is too deeply nested.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, 16000);
  if (Array.isArray(value)) return value.slice(0, 300).map(item => portable(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key)).slice(0, 100).map(([key, item]) => [key, portable(item, depth + 1)]));
  return null;
}
function document(name) { try { const value = JSON.parse(storage.getItem('pocket:' + name)); if (Array.isArray(value?.items)) return value; } catch {} return { v: 1, items: [] }; }
function put(name, uid, value, fields = {}, deleted = false) {
  const doc = document(name), old = doc.items.find(item => item.uid === uid), safe = deleted ? null : portable(value);
  if (canonical([old?.value, Boolean(old?.deleted), old?.kind || '', old?.target_uid || '']) === canonical([safe, deleted, fields.kind || '', fields.target_uid || ''])) return old;
  const item = { uid, ...fields, value: safe, updated: Math.max(Date.now(), (old?.updated || 0) + 1), deleted };
  const at = doc.items.findIndex(item => item.uid === uid); if (at < 0) doc.items.push(item); else doc.items[at] = item;
  importDocument(name, doc); return item;
}
const draftUid = (kind, target = '') => kind + '-' + (target || 'new');
export const drafts = {
  list: () => document('drafts.json').items.filter(item => !item.deleted),
  get: (kind, target = '') => clone(document('drafts.json').items.find(item => item.uid === draftUid(kind, target) && !item.deleted)?.value),
  set(kind, target = '', value) { if (!KINDS.has(kind)) throw new Error('Unknown draft.'); return put('drafts.json', draftUid(kind, target), value, { kind, target_uid: String(target) }); },
  clear(kind, target = '') { if (!KINDS.has(kind)) throw new Error('Unknown draft.'); return put('drafts.json', draftUid(kind, target), null, { kind, target_uid: String(target) }, true); },
};
export const preferences = {
  get: uid => clone(document('preferences.json').items.find(item => item.uid === uid && !item.deleted)?.value),
  set(uid, value) { if (!PREFS.has(uid)) throw new Error('Unknown preference.'); if(uid==='daily-brief'&&(!value||typeof value!=='object'||Array.isArray(value)||typeof value.enabled!=='boolean'||Object.keys(value).some(key=>key!=='enabled')))throw new Error('Check the brief setting.'); return put('preferences.json', uid, value); },
  clear(uid) { if (!PREFS.has(uid)) throw new Error('Unknown preference.'); return put('preferences.json', uid, null, {}, true); },
};
export const TODAY_CATALOG = Object.freeze(['brief', 'tasks', 'agenda', 'thoughts', 'notes', 'movement', 'gym', 'pip', 'activity', 'focus', 'clock', 'paper', 'zines', 'dice']);
export const TODAY_DEFAULTS = Object.freeze(['agenda', 'thoughts', 'tasks', 'activity'].map(kind => Object.freeze({ uid: kind, kind })));
function tiles(value) { const seen = new Set(); return (Array.isArray(value) ? value : TODAY_DEFAULTS).filter(tile => tile && TODAY_CATALOG.includes(tile.kind) && !seen.has(tile.kind) && seen.add(tile.kind)).slice(0, TODAY_CATALOG.length).map(tile => ({ uid: String(tile.uid || tile.kind).slice(0, 100), kind: tile.kind, ...(typeof tile.label === 'string' && tile.label.trim() ? { label: tile.label.trim().slice(0, 40) } : {}) })); }
export const todayTiles = { catalog: TODAY_CATALOG, list: () => tiles(preferences.get('today-tiles')), save: value => preferences.set('today-tiles', tiles(value)) };

function draftKey(key) {
  if (key === 'pocket:thought-draft') return ['thought', ''];
  const match = /^pocket:(note|task)-draft(?::(.+))?$/.exec(key); return match ? [match[1], match[2] || ''] : null;
}
function captureKey(key, deleted = false) {
  if (applying) return;
  const draft = draftKey(key);
  if (draft) { if (deleted) drafts.clear(...draft); else { const raw = storage.getItem(key); let value; try { value = JSON.parse(raw); } catch { value = { text: raw || '' }; } if (typeof value === 'string') value = { text: value }; drafts.set(...draft, value); } return; }
  if (key === 'pocket:pip-settings') { let value; try { value = JSON.parse(storage.getItem(key)); } catch { value = null; } if (value) preferences.set('pip-defaults', { ...preferences.get('pip-defaults'), ...value }); else if (deleted) preferences.clear('pip-defaults'); }
  else if (key.startsWith('pocket:dice-') && !['pocket:dice-list'].includes(key)) {
    let history; try { history = JSON.parse(storage.getItem('pocket:dice-history') || '[]'); } catch { history = []; }
    preferences.set('dice', { ...preferences.get('dice'), mode: storage.getItem('pocket:dice-mode') || 'dice', count: Math.max(1, Math.min(5, Number(storage.getItem('pocket:dice-count') || 2))), lastFace: storage.getItem('pocket:dice-face') || '', lastDetail: storage.getItem('pocket:dice-detail') || '', history });
  } else if (key === 'pocket:appearance') { try { const value = JSON.parse(storage.getItem(key)); if (value) preferences.set('appearance', value); else if (deleted) preferences.clear('appearance'); } catch {} }
}
/** Import old local drafts/settings once; subsequent storage changes are captured at their source. */
export function captureLocal() {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys) {
    const draft = draftKey(key), preference = key === 'pocket:pip-settings' ? 'pip-defaults' : key === 'pocket:dice-mode' ? 'dice' : key === 'pocket:appearance' ? 'appearance' : null;
    if (draft && !document('drafts.json').items.some(item => item.uid === draftUid(...draft)) || preference && !document('preferences.json').items.some(item => item.uid === preference)) captureKey(key);
  }
}
/** Applying remote values must never become a fresh edit or a perpetual sync loop. */
export function applyDocument(name) {
  if (!['drafts.json', 'preferences.json'].includes(name)) return;
  applying++;
  try {
    for (const item of document(name).items) {
      if (name === 'drafts.json') {
        const key = item.kind === 'thought' ? 'pocket:thought-draft' : ['note', 'task'].includes(item.kind) ? 'pocket:' + item.kind + '-draft' + (item.target_uid ? ':' + item.target_uid : '') : null;
        if (!key) continue; if (item.deleted) storage.removeItem(key); else storage.setItem(key, item.kind === 'task' ? JSON.stringify(item.value || {}) : String(item.value?.text || ''));
      } else if (item.uid === 'pip-defaults') { if (item.deleted) storage.removeItem('pocket:pip-settings'); else storage.setItem('pocket:pip-settings', JSON.stringify(portable(item.value))); }
      else if (item.uid === 'appearance') { if (item.deleted) storage.removeItem('pocket:appearance'); else storage.setItem('pocket:appearance', JSON.stringify(item.value)); }
      else if (item.uid === 'dice') {
        const value = item.deleted ? {} : item.value || {};
        for (const [key, field] of [['mode', 'mode'], ['count', 'count'], ['face', 'lastFace'], ['detail', 'lastDetail']]) {
          if (value[field] === undefined) storage.removeItem('pocket:dice-' + key); else storage.setItem('pocket:dice-' + key, String(value[field]));
        }
        if (value.history) storage.setItem('pocket:dice-history', JSON.stringify(value.history)); else storage.removeItem('pocket:dice-history');
      }
    }
  } finally { applying--; }
  globalThis.dispatchEvent?.(new Event('pocket-extras-applied'));
}
export function initExtras() {
  if (initialized) return; initialized = true;
  const set = storage.setItem.bind(storage), remove = storage.removeItem.bind(storage);
  storage.setItem = (key, value) => { set(key, value); captureKey(key); };
  storage.removeItem = key => { remove(key); captureKey(key, true); };
  applyDocument('drafts.json'); applyDocument('preferences.json'); captureLocal();
}
export const apply = applyDocument;
export const fromLocal = captureLocal;
