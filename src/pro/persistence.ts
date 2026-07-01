import type { ProDocument } from './proTypes';

// Автосохранение проекта Pulsar Pro в IndexedDB (§6 ТЗ).
// Документ — plain JSON (tracks/clips), сериализуется structured-clone.

const DB_NAME = 'pulsar-pro';
const STORE = 'project';
const KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDoc(doc: ProDocument): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(doc, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadDoc(): Promise<ProDocument | null> {
  const db = await openDb();
  const result = await new Promise<ProDocument | null>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const rq = tx.objectStore(STORE).get(KEY);
    rq.onsuccess = () => resolve((rq.result as ProDocument) ?? null);
    rq.onerror = () => resolve(null);
  });
  db.close();
  return result;
}
