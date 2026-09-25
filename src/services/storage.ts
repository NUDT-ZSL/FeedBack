import { BudgetRecord, StorageAdapter, StorageType } from '../types';

const STORAGE_KEY = 'budget_records';
const DB_NAME = 'BudgetTrackerDB';
const DB_VERSION = 1;
const STORE_NAME = 'records';

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

class LocalStorageAdapter implements StorageAdapter {
  async getAll(): Promise<BudgetRecord[]> {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? (JSON.parse(data) as BudgetRecord[]) : [];
  }

  async add(record: BudgetRecord): Promise<void> {
    const records = await this.getAll();
    records.unshift(record);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  async update(record: BudgetRecord): Promise<void> {
    const records = await this.getAll();
    const index = records.findIndex(item => item.id === record.id);

    if (index === -1) return;

    records[index] = record;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  async delete(id: string): Promise<void> {
    const records = await this.getAll();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(records.filter(record => record.id !== id)),
    );
  }
}

class IndexedDBAdapter implements StorageAdapter {
  private db: IDBDatabase | null = null;

  private async initDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      request.onupgradeneeded = event => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('date', 'date');
          store.createIndex('category', 'category');
        }
      };
    });
  }

  async getAll(): Promise<BudgetRecord[]> {
    const db = await this.initDB();
    const records = await requestToPromise(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll(),
    );

    return records.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }

  async add(record: BudgetRecord): Promise<void> {
    const db = await this.initDB();
    await requestToPromise(
      db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).add(record),
    );
  }

  async update(record: BudgetRecord): Promise<void> {
    const db = await this.initDB();
    await requestToPromise(
      db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record),
    );
  }

  async delete(id: string): Promise<void> {
    const db = await this.initDB();
    await requestToPromise(
      db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id),
    );
  }
}

export const createStorageAdapter = (type: StorageType): StorageAdapter =>
  type === 'localStorage'
    ? new LocalStorageAdapter()
    : new IndexedDBAdapter();
