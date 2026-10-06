// The browser and account index use the same searchable text.
export const SEARCH_KINDS = { 'notes.json': ['note'], 'tasks.json': ['task'], 'parking.json': ['thought'], 'journal.json': ['paper'] };
const clip = (value, limit) => String(value || '').slice(0, limit);
const firstLine = text => clip(String(text || '').split('\n').map(line => line.replace(/^#+\s*/, '').trim()).find(Boolean) || 'Untitled', 200);
export function documentRows(name, doc) {
  if (name === 'notes.json') return (doc?.notes || []).filter(n => !n.deleted && n.text).map(n => ({ kind: 'note', uid: String(n.uid), title: firstLine(n.text), body: String(n.text), updated: n.updated || 0 }));
  if (name === 'tasks.json') return (doc?.tasks || []).filter(t => !t.deleted && t.text).map(t => ({ kind: 'task', uid: String(t.uid), title: clip(t.text, 500), body: [t.text, t.done ? 'done' : '', ...(t.steps || []).map(s => s.text), t.source?.text || ''].filter(Boolean).join('\n'), updated: t.updated || 0 }));
  if (name === 'parking.json') return (doc?.items || []).filter(i => i.state === 'parked' && i.text).map(i => ({ kind: 'thought', uid: String(i.id), title: clip(i.text, 500), body: String(i.text), updated: i.updated || 0 }));
  if (name === 'journal.json') return (doc?.pages || []).filter(p => !p.deleted && p.lines?.length).map(p => ({ kind: 'paper', uid: String(p.uid), title: clip(p.title || 'Paper page', 200), body: [p.title, ...p.lines.map(line => line.text)].filter(Boolean).join('\n'), updated: p.updated || 0 }));
  return [];
}
export function chatRows(chat) {
  if (!chat || chat.deleted) return [];
  // Synced conversations already have a 3 MiB payload bound. Keep every turn searchable.
  const body = [chat.title, ...(chat.turns || []).map(turn => [turn.text, turn.answer].filter(Boolean).join('\n'))].filter(Boolean).join('\n\n');
  return [{ kind: 'chat', uid: String(chat.uid), title: clip(chat.title || 'Chat', 200), body, updated: chat.updated || 0 }];
}
export const searchWords = query => (String(query || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).slice(0, 8);
const folded = text => String(text).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
export function excerpt(text, words) {
  text = String(text || '');
  const lower = text.toLowerCase(); let at = -1;
  for (const word of words) { at = lower.indexOf(word); if (at >= 0) break; }
  if (at < 0) return text.slice(0, 140);
  const start = Math.max(0, at - 50), slice = text.slice(start, start + 160);
  return (start ? '…' : '') + slice.replace(new RegExp('(' + words.join('|') + ')', 'giu'), '\u0001$1\u0002') + (start + 160 < text.length ? '…' : '');
}
export function localSearch(rows, query) {
  const words = searchWords(query); if (!words.length) return [];
  return rows.filter(row => words.every(word => folded(row.title + '\n' + row.body).includes(folded(word))))
    .map(row => ({ ...row, snippet: excerpt(row.body, words), score: words.reduce((score, word) => score + (row.title.toLowerCase().includes(word) ? 5 : 1), 0) }))
    .sort((a, b) => b.score - a.score || b.updated - a.updated).slice(0, 30);
}
