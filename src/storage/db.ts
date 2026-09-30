/**
 * IndexedDB 持久化（无后端）。
 *
 * Schema v1：
 * - projects：完整工程文档（相机、图层、笔画、裁剪框）
 * - meta：单行键值（最近打开的工程 id 等）
 */

const DB_NAME = 'perspective-ruler';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_META = 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        const store = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const req = fn(t.objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function putProject<T extends { id: string }>(project: T): Promise<void> {
  await tx(STORE_PROJECTS, 'readwrite', (store) => store.put(project));
}

export async function getProject<T>(id: string): Promise<T | undefined> {
  return tx(STORE_PROJECTS, 'readonly', (store) => store.get(id) as IDBRequest<T>);
}

export async function getAllProjects<T>(): Promise<T[]> {
  return tx(STORE_PROJECTS, 'readonly', (store) =>
    store.getAll() as IDBRequest<T[]>,
  );
}

export async function deleteProject(id: string): Promise<void> {
  await tx(STORE_PROJECTS, 'readwrite', (store) => store.delete(id));
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await tx(STORE_META, 'readwrite', (store) => store.put({ key, value }));
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await tx<{ key: string; value: T }>(STORE_META, 'readonly', (store) =>
    store.get(key) as IDBRequest<{ key: string; value: T }>,
  );
  return row?.value;
}

/** 测试辅助：删除数据库（验证持久化往返时使用）。 */
export async function deleteDatabase(): Promise<void> {
  const db = await openDb();
  db.close();
  dbPromise = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
