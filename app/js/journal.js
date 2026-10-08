// Field journal: every finished quest with its photo, stored in IndexedDB on this device only.

const DB_NAME = 'grassgate';
const STORE = 'journal';

let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const addEntry = (entry) => run('readwrite', (s) => s.put(entry));

export const deleteEntry = (id) => run('readwrite', (s) => s.delete(id));

export const clearJournal = () => run('readwrite', (s) => s.clear());

export async function listEntries() {
  const all = await run('readonly', (s) => s.getAll());
  return all.sort((a, b) => b.ts - a.ts);
}
