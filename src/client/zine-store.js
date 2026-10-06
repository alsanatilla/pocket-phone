import { activeAccount } from './workspace-storage.js';
// Photo books live in account-scoped IndexedDB, outside Pocket workspace sync.
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
export const getBook = id => read("books", id);
export const getPhoto = id => read("photos", id);
export const listBooks = async () => (await read("books")).sort((a, b) => b.updated - a.updated);
export function saveBook(book, photos = [], removed = []) {
  const copy = structuredClone(book);
  return write((books, images) => {
    books.put(copy);
    photos.forEach(photo => images.put(photo));
    removed.forEach(id => images.delete(id));
  });
}
export function deleteBook(book) {
  return write((books, images) => {
    books.delete(book.id);
    book.photos.forEach(photo => images.delete(photo.id));
  });
}
