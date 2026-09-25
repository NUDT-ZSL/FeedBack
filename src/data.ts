import { Record, StorageAdapter, StorageType } from './types';

const STORAGE_KEY = 'budget_records';
const DB_NAME = 'BudgetTrackerDB';
const DB_VERSION = 1;
const STORE_NAME = 'records';

class LocalStorageAdapter implements StorageAdapter {
  async getAll(): Promise<Record[]> {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  }

  async add(record: Record): Promise<void> {
    const records = await this.getAll();
    records.unshift(record);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  async update(record: Record): Promise<void> {
    const records = await this.getAll();
    const index = records.findIndex(r => r.id === record.id);
    if (index !== -1) {
      records[index] = record;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    }
  }

  async delete(id: string): Promise<void> {
    const records = await this.getAll();
    const filtered = records.filter(r => r.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
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

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('date', 'date');
          store.createIndex('category', 'category');
        }
      };
    });
  }

  async getAll(): Promise<Record[]> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const records = request.result.sort((a, b) => 
          new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        resolve(records);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async add(record: Record): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async update(record: Record): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async delete(id: string): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

let currentAdapter: StorageAdapter = new LocalStorageAdapter();

export const setStorageType = (type: StorageType): void => {
  currentAdapter = type === 'localStorage' 
    ? new LocalStorageAdapter() 
    : new IndexedDBAdapter();
};

export const getStorageType = (): StorageType => {
  return currentAdapter instanceof LocalStorageAdapter ? 'localStorage' : 'indexedDB';
};

export const getAllRecords = (): Promise<Record[]> => currentAdapter.getAll();
export const addRecord = (record: Record): Promise<void> => currentAdapter.add(record);
export const updateRecord = (record: Record): Promise<void> => currentAdapter.update(record);
export const deleteRecord = (id: string): Promise<void> => currentAdapter.delete(id);
