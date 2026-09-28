import { Idea, KanbanColumn, Tag } from './types';

const DB_NAME = 'ideavault';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('ideas')) {
        const ideaStore = db.createObjectStore('ideas', { keyPath: 'id' });
        ideaStore.createIndex('status', 'status', { unique: false });
        ideaStore.createIndex('columnId', 'columnId', { unique: false });
      }
      if (!db.objectStoreNames.contains('tags')) {
        db.createObjectStore('tags', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('columns')) {
        const colStore = db.createObjectStore('columns', { keyPath: 'id' });
        colStore.createIndex('order', 'order', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const store = t.objectStore(storeName);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const db = {
  getAllIdeas: (): Promise<Idea[]> => tx('ideas', 'readonly', (s) => s.getAll()),

  getIdea: (id: string): Promise<Idea | undefined> => tx('ideas', 'readonly', (s) => s.get(id)),

  saveIdea: (idea: Idea): Promise<void> =>
    tx('ideas', 'readwrite', (s) => s.put(idea)).then(() => {}),

  deleteIdea: (id: string): Promise<void> =>
    tx('ideas', 'readwrite', (s) => s.delete(id)).then(() => {}),

  getAllTags: (): Promise<Tag[]> => tx('tags', 'readonly', (s) => s.getAll()),

  saveTag: (tag: Tag): Promise<void> =>
    tx('tags', 'readwrite', (s) => s.put(tag)).then(() => {}),

  deleteTag: (id: string): Promise<void> =>
    tx('tags', 'readwrite', (s) => s.delete(id)).then(() => {}),

  getAllColumns: (): Promise<KanbanColumn[]> => tx('columns', 'readonly', (s) => s.getAll()),

  saveColumn: (col: KanbanColumn): Promise<void> =>
    tx('columns', 'readwrite', (s) => s.put(col)).then(() => {}),

  deleteColumn: (id: string): Promise<void> =>
    tx('columns', 'readwrite', (s) => s.delete(id)).then(() => {}),

  initDefaults: async (): Promise<void> => {
    const cols = await db.getAllColumns();
    if (cols.length === 0) {
      const defaults: KanbanColumn[] = [
        { id: 'col-todo', name: '待整理', order: 0 },
        { id: 'col-doing', name: '正在做', order: 1 },
        { id: 'col-hold', name: '暂时搁置', order: 2 },
      ];
      for (const c of defaults) {
        await db.saveColumn(c);
      }
    }
  },
};
