import type { StoredSetMeta } from '../types';

const DB_NAME = 'mania-player';
const DB_VERSION = 1;
const META_STORE = 'sets';
const FILE_STORE = 'files';

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(FILE_STORE)) {
          db.createObjectStore(FILE_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open local storage'));
    });
  }
  return database;
}

function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = run(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Local storage request failed'));
      }),
  );
}

export async function listSets(): Promise<StoredSetMeta[]> {
  const sets = await withStore<StoredSetMeta[]>(META_STORE, 'readonly', (store) =>
    store.getAll() as IDBRequest<StoredSetMeta[]>,
  );
  return sets.sort((a, b) => b.addedAt - a.addedAt);
}

export function getSetFile(id: string): Promise<ArrayBuffer | undefined> {
  return withStore<ArrayBuffer | undefined>(FILE_STORE, 'readonly', (store) =>
    store.get(id) as IDBRequest<ArrayBuffer | undefined>,
  );
}

export async function saveSet(meta: StoredSetMeta, file: ArrayBuffer): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([META_STORE, FILE_STORE], 'readwrite');
    transaction.objectStore(META_STORE).put(meta);
    transaction.objectStore(FILE_STORE).put(file, meta.id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save beatmap'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Could not save beatmap'));
  });
}

export async function removeSet(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([META_STORE, FILE_STORE], 'readwrite');
    transaction.objectStore(META_STORE).delete(id);
    transaction.objectStore(FILE_STORE).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not delete beatmap'));
  });
}

export async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage && navigator.storage.persist) {
      await navigator.storage.persist();
    }
  } catch {
    // Persistence is a best-effort hint; ignore failures.
  }
}

export async function getStorageInfo(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}
