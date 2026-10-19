// What a notification says about a Pip reply. The server pushes these to devices nobody is watching from; a tab
// shows the same ones itself while it is hidden. Each chat has one tag, so a newer notice replaces the last one.

/** A reply's first words, without Markdown, for a notification body. */
export const excerpt = (text, limit = 160) => {
  const plain = String(text || '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|\*|~~|`)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/(^|\W)(__|_)(\S(?:.*?\S)?)\2(?=\W|$)/g, '$1$3')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[|`]/g, ' ').replace(/(^|\s):?-{3,}:?(?=\s|$)/g, '$1').replace(/\s+/g, ' ').trim();
  return plain.length > limit ? plain.slice(0, limit - 1).trimEnd() + '…' : plain;
};
const titleOf = chat => { const title = String(chat?.title || '').trim() || 'Pip'; return /^pip\b/i.test(title) ? title : 'Pip · ' + title; };
const place = chat => ({ href: '/pip/' + chat.uid, tag: 'pip-' + chat.uid });

/** A finished or failed reply; nothing for one that was stopped. */
export function replyNotice(chat, turn) {
  if (turn?.status === 'done') return { title: titleOf(chat), body: excerpt(turn.answer) || 'Pip replied.', ...place(chat) };
  if (turn?.status === 'failed') return { title: titleOf(chat), body: 'Pip could not finish: ' + excerpt(turn.error || 'the reply failed.', 120), ...place(chat) };
  return null;
}
/** A reply paused for the user. `changes` are the titles of the changes it waits to have approved. */
export function waitingNotice(chat, changes = []) {
  const named = changes.filter(Boolean);
  return { title: titleOf(chat), body: named.length ? 'Waiting for your OK: ' + excerpt(named.join(' · '), 140) : 'Pip is waiting for you.', ...place(chat) };
}
