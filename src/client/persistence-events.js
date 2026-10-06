import { storage } from './workspace-storage.js';
export const marker = (collection, uid) => 'pocket:object-dirty:' + collection + ':' + uid;
export function changed(collection, uid) {
  storage.setItem(marker(collection, uid), '1');
  dispatchEvent(new Event('pocket-persistence-change'));
}
export function waiting() {
  let count = 0;
  for (let i = 0; i < storage.length; i++) if (storage.key(i)?.startsWith('pocket:object-dirty:')) count++;
  return count;
}
