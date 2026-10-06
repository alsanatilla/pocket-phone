import { activeAccount } from './workspace-storage.js';
import * as cloud from './cloud.js';
import { changed } from './persistence-events.js';
import { mergeObject, canonical } from '../shared/objects.js';
// Account-scoped IndexedDB keeps books and downloaded originals available offline.
let opening;
let writes = Promise.resolve();
function database() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(activeAccount() ? "pocket-zines:" + activeAccount() : "pocket-zines", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("books", { keyPath: "id" });
      request.result.createObjectStore("photos", { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    request.onerror = () => { opening = null; reject(request.error); };
    request.onblocked = () => { opening = null; reject(new Error("Close other Pocket tabs, then try again.")); };
  });
  return opening;
}
async function read(store, id) {
  await writes;
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store)[id === undefined ? "getAll" : "get"](id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function write(run) {
  const next = writes.then(async () => {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["books", "photos"], "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error || new Error("Couldn't save this zine. Check the browser's free storage."));
      try { run(tx.objectStore("books"), tx.objectStore("photos")); }
      catch (error) { tx.abort(); reject(error); }
    });
  });
  writes = next.catch(() => {});
  return next;
}
export const getBook = async id => { const book = await read('books', id); return book?.deleted ? null : book; };
export const rawBooks = () => read('books');
export async function getPhoto(id) {
  const saved = await read('photos', id);
  if (saved || !navigator.onLine || !cloud.connected()) return saved;
  const owner = (await rawBooks()).find(book => !book.deleted && book.photos.some(photo => photo.id === id));
  if (!owner) return null;
  const [source, thumbnail] = await Promise.all([cloud.media('zine-source-' + id + '.jpg'), cloud.media('zine-thumb-' + id + '.jpg')]);
  if (!source || !thumbnail) throw new Error('This zine photo could not be loaded. Try sync again.');
  const photo = { id, name: '', source, thumbnail, uploaded: true };
  await write((books, images) => images.put(photo)); return photo;
}
export const listBooks = async () => (await rawBooks()).filter(book => !book.deleted).sort((a, b) => b.updated - a.updated);
export function saveBook(book, photos = [], removed = []) {
  const copy = structuredClone(book);
  return write((books, images) => {
    copy._synced = 0;
    const get = books.get(copy.id);
    get.onsuccess = () => {
      if (get.result?.deleted) return;
      books.put(copy); photos.forEach(photo => images.put(photo)); removed.forEach(id => images.delete(id));
    };
  }).then(() => changed('zines', book.id));
}
export function deleteBook(book) {
  return write((books, images) => {
    books.put({ id: book.id, deleted: true, updated: Math.max(Date.now(), book.updated + 1), _synced: 0 });
    book.photos.forEach(photo => images.delete(photo.id));
  }).then(() => changed('zines', book.id));
}
export function acceptBook(remote) {
  let acknowledged = false;
  return write((books, images) => {
    const get = books.get(remote.id);
    get.onsuccess = () => {
      const local = get.result;
      const merged = mergeObject('zines', local || null, remote);
      acknowledged = canonical(portableBook(merged)) === canonical(remote);
      books.put({ ...merged, _synced: acknowledged ? merged.updated : 0 });
      if (merged.deleted) (local?.photos || []).forEach(photo => images.delete(photo.id));
    };
  }).then(() => acknowledged);
}
export function portableBook(book) {
  if (book.deleted) return { id: book.id, updated: book.updated, deleted: true };
  return { id: book.id, title: book.title, byline: book.byline || '', tone: book.tone, photos: book.photos.map(p => ({ id: p.id, caption: p.caption || '', layout: p.layout })), created: book.created, updated: book.updated };
}
export async function uploadPhotos(book) {
  if (book.deleted) return;
  for (const entry of book.photos) {
    const photo = await read('photos', entry.id);
    if (!photo) throw new Error('A zine photo is missing on this device.');
    if (photo.uploaded) continue;
    await cloud.media('zine-source-' + photo.id + '.jpg', photo.source, book.id);
    await cloud.media('zine-thumb-' + photo.id + '.jpg', photo.thumbnail, book.id);
    await write((books, images) => images.put({ ...photo, uploaded: true }));
  }
}
export async function importGuestBooks(accountId) {
  const open = name => new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('books', { keyPath: 'id' }); request.result.createObjectStore('photos', { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const guest = await open('pocket-zines'), target = await open('pocket-zines:' + accountId);
  try {
    const all = name => new Promise((resolve, reject) => { const request = guest.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const [books, photos] = await Promise.all([all('books'), all('photos')]);
    await new Promise((resolve, reject) => {
      const tx = target.transaction(['books', 'photos'], 'readwrite'); tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error);
      for (const book of books) { const store = tx.objectStore('books'), get = store.get(book.id); get.onsuccess = () => { if (!get.result) store.put({ ...book, _synced: 0 }); }; }
      for (const photo of photos) { const store = tx.objectStore('photos'), get = store.get(photo.id); get.onsuccess = () => { if (!get.result) store.put({ ...photo, uploaded: false }); }; }
    });
    books.forEach(book => changed('zines', book.id));
  } finally { guest.close(); target.close(); }
}
