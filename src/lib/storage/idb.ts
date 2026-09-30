import type { Project, ProjectMeta } from '../../types';

/**
 * IndexedDB 工程存储（无后端）。
 * - store：id (keyPath) 为主键，updatedAt 建索引；
 * - 保存的是完整 Project（含 raw 与 axes），不保存任何派生约束点，
 *   约束永远在读取后由 raw + ruler 重新派生。
 */

const DB_NAME = 'perspective-ruler-studio';
const DB_VERSION = 1;
const STORE = 'projects';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function saveProject(project: Project): Promise<void> {
  const record: Project = { ...project, updatedAt: Date.now() };
  await tx('readwrite', (store) => store.put(record));
}

export async function loadProject(id: string): Promise<Project | undefined> {
  return tx<Project | undefined>('readonly', (store) => store.get(id));
}

export async function deleteProject(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id));
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await tx<Project[]>('readonly', (store) => store.getAll());
  return all
    .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
