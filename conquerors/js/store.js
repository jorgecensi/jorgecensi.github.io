// Persistence: activities in IndexedDB (they can be a few MB), small settings in localStorage.

const DB_NAME = 'conquerors';
const STORE = 'kv';
let dbPromise;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const loadActivities = async () => (await run('readonly', (s) => s.get('activities'))) || [];
export const saveActivities = (activities) => run('readwrite', (s) => s.put(activities, 'activities'));
export const clearActivities = () => run('readwrite', (s) => s.delete('activities'));

const PREFIX = 'conquerors.';

export const prefs = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(PREFIX + key);
      else localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch { /* storage full or blocked */ }
  },
};
