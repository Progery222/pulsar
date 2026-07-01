import type { ProDocument } from './proTypes';

// Хранение проектов Pulsar Pro в IndexedDB (§6 ТЗ): несколько проектов + текущий.

const DB_NAME = 'pulsar-pro';
const STORE = 'projects'; // id -> { id, name, doc, updatedAt }
const META = 'meta'; // 'currentId' -> string
const LEGACY = 'project'; // старое одиночное хранилище (миграция)

export interface ProjectRec {
  id: string;
  name: string;
  doc: ProDocument;
  updatedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      if (!db.objectStoreNames.contains(LEGACY)) db.createObjectStore(LEGACY);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listProjects(): Promise<{ id: string; name: string; updatedAt: number }[]> {
  const db = await openDb();
  const recs = await new Promise<ProjectRec[]>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const rq = tx.objectStore(STORE).getAll();
    rq.onsuccess = () => resolve((rq.result as ProjectRec[]) ?? []);
    rq.onerror = () => resolve([]);
  });
  db.close();
  return recs.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<{ name: string; doc: ProDocument } | null> {
  const db = await openDb();
  const rec = await new Promise<ProjectRec | null>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const rq = tx.objectStore(STORE).get(id);
    rq.onsuccess = () => resolve((rq.result as ProjectRec) ?? null);
    rq.onerror = () => resolve(null);
  });
  db.close();
  return rec ? { name: rec.name, doc: rec.doc } : null;
}

export async function saveProject(id: string, name: string, doc: ProDocument): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ id, name, doc, updatedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

export async function getCurrentId(): Promise<string | null> {
  const db = await openDb();
  const id = await new Promise<string | null>((resolve) => {
    const tx = db.transaction(META, 'readonly');
    const rq = tx.objectStore(META).get('currentId');
    rq.onsuccess = () => resolve((rq.result as string) ?? null);
    rq.onerror = () => resolve(null);
  });
  db.close();
  return id;
}

export async function setCurrentId(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(META, 'readwrite');
    tx.objectStore(META).put(id, 'currentId');
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

// Миграция старого одиночного проекта в мультипроект (однократно).
export async function migrateLegacy(): Promise<void> {
  const db = await openDb();
  try {
    const hasProjects = await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).count();
      rq.onsuccess = () => resolve(rq.result > 0);
      rq.onerror = () => resolve(false);
    });
    if (hasProjects) return;
    const legacy = await new Promise<ProDocument | null>((resolve) => {
      const tx = db.transaction(LEGACY, 'readonly');
      const rq = tx.objectStore(LEGACY).get('current');
      rq.onsuccess = () => resolve((rq.result as ProDocument) ?? null);
      rq.onerror = () => resolve(null);
    });
    if (legacy && Array.isArray(legacy.tracks)) {
      const id = newProjectId();
      await new Promise<void>((resolve) => {
        const tx = db.transaction([STORE, META], 'readwrite');
        tx.objectStore(STORE).put({ id, name: 'Проект 1', doc: legacy, updatedAt: Date.now() });
        tx.objectStore(META).put(id, 'currentId');
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
  } finally {
    db.close();
  }
}

export function newProjectId(): string {
  return `p${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
