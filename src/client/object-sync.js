import { storage } from './workspace-storage.js';
import * as cloud from './cloud.js';
import * as zines from './zine-store.js';
import { marker } from './persistence-events.js';
import { noteChat } from './chat-follow.js';
import { mergeObject, sanitizeObject, canonical } from '../shared/objects.js';
const PREFIX = 'pocket:pip-chat:';
function chats() {
  const items = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(PREFIX)) items.push(JSON.parse(storage.getItem(key)));
  }
  return items;
}
function acceptChat(remote) {
  const key = PREFIX + remote.uid, raw = storage.getItem(key), local = raw && JSON.parse(raw);
  const merged = mergeObject('chats', local, remote), acknowledged = canonical(sanitizeObject('chats', merged)) === canonical(remote);
  storage.setItem(key, JSON.stringify(merged));
  if (acknowledged) storage.removeItem(marker('chats', remote.uid)); else storage.setItem(marker('chats', remote.uid), '1');
  return { changed: JSON.stringify(merged) !== raw, acknowledged };
}
export async function syncObjects() {
  let changed = false;
  for (const collection of ['chats', 'zines']) {
    const items = collection === 'chats' ? chats() : await zines.rawBooks();
    const cursorKey = 'pocket:object-cursor:' + collection;
    for (const item of items) {
      const uid = item.uid || item.id, dirty = marker(collection, uid);
      if (!storage.getItem(dirty) && (collection === 'chats' ? storage.getItem('pocket:chat-ack:' + uid) : item._synced === item.updated)) continue;
      storage.setItem(dirty, '1');
      if (collection === 'zines') await zines.uploadPhotos(item);
      const { value, seq } = await cloud.post('/api/objects/' + collection, { value: sanitizeObject(collection, item) });
      if (collection === 'chats') {
        const accepted = acceptChat(value);
        changed = accepted.changed || changed;
        noteChat(uid, seq, accepted.acknowledged);
        storage.setItem('pocket:chat-ack:' + uid, '1');
      }
      else if (await zines.acceptBook(value)) storage.removeItem(dirty);
    }
    let more = true;
    while (more) {
      const result = await cloud.request('/api/objects/' + collection + '?after=' + Number(storage.getItem(cursorKey) || 0));
      for (const item of result.items) {
        if (collection === 'chats') {
          const accepted = acceptChat(item);
          changed = accepted.changed || changed;
          noteChat(item.uid, result.seqs[item.uid], accepted.acknowledged);
          storage.setItem('pocket:chat-ack:' + item.uid, '1');
        }
        else { if (await zines.acceptBook(item)) storage.removeItem(marker(collection, item.id)); else storage.setItem(marker(collection, item.id), '1'); changed = true; }
      }
      storage.setItem(cursorKey, String(result.cursor)); more = result.more;
    }
  }
  if (changed) dispatchEvent(new Event('pocket-objects-synced'));
  return changed;
}
