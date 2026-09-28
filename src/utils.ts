import { v4 as uuidv4 } from 'uuid';

export type TagType = 'soil' | 'vegetation' | 'water' | 'building';

export interface SurveyPoint {
  id: string;
  name: string;
  description: string;
  tag: TagType;
  imageUrl?: string;
  lat: number;
  lng: number;
  createdAt: string;
}

export const TAG_OPTIONS: { value: TagType; label: string; color: string }[] = [
  { value: 'soil', label: '土壤', color: '#8B5A2B' },
  { value: 'vegetation', label: '植被', color: '#228B22' },
  { value: 'water', label: '水体', color: '#4682B4' },
  { value: 'building', label: '建筑', color: '#808080' }
];

export const getTagColor = (tag: TagType): string => {
  const found = TAG_OPTIONS.find(t => t.value === tag);
  return found ? found.color : '#666';
};

export const getTagLabel = (tag: TagType): string => {
  const found = TAG_OPTIONS.find(t => t.value === tag);
  return found ? found.label : '未知';
};

const DB_NAME = 'FieldSurveyDB';
const DB_VERSION = 2;
const STORE_NAME = 'survey_points';

type MigrationFn = (db: IDBDatabase, transaction: IDBTransaction | null) => void;

const DB_MIGRATIONS: Record<number, MigrationFn> = {
  1: (db: IDBDatabase) => {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('createdAt', 'createdAt', { unique: false });
      store.createIndex('tag', 'tag', { unique: false });
    }
  },
  2: (db: IDBDatabase, transaction: IDBTransaction | null) => {
    if (db.objectStoreNames.contains(STORE_NAME) && transaction) {
      const store = transaction.objectStore(STORE_NAME);
      if (!store.indexNames.contains('name')) {
        store.createIndex('name', 'name', { unique: false });
      }
    }
  }
};

let dbInstance: IDBDatabase | null = null;

export const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onblocked = () => {
      reject(new Error('数据库被阻塞，请关闭其他标签页后重试'));
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onversionchange = () => {
        if (dbInstance) {
          dbInstance.close();
          dbInstance = null;
        }
      };
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const transaction = (event.target as IDBOpenDBRequest).transaction || null;
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion || 0;
      const newVersion = DB_VERSION;

      for (let v = oldVersion + 1; v <= newVersion; v++) {
        const migration = DB_MIGRATIONS[v];
        if (migration) {
          try {
            migration(db, transaction);
          } catch (err) {
            console.error(`数据库迁移 v${v} 失败:`, err);
          }
        }
      }
    };
  });
};

export const addPoint = async (point: Omit<SurveyPoint, 'id' | 'createdAt'>): Promise<SurveyPoint> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const newPoint: SurveyPoint = {
      ...point,
      id: uuidv4(),
      createdAt: new Date().toISOString()
    };

    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.add(newPoint);

    request.onsuccess = () => resolve(newPoint);
    request.onerror = () => reject(request.error);
  });
};

export const getAllPoints = async (): Promise<SurveyPoint[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const points = request.result.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      resolve(points);
    };
    request.onerror = () => reject(request.error);
  });
};

export const clearPoints = async (): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const exportToGeoJSON = (points: SurveyPoint[]): string => {
  const features = points.map(point => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [
        Number(point.lng.toFixed(6)),
        Number(point.lat.toFixed(6))
      ]
    },
    properties: {
      id: point.id,
      name: point.name,
      description: point.description,
      tag: point.tag,
      tagLabel: getTagLabel(point.tag),
      imageUrl: point.imageUrl || null,
      createdAt: point.createdAt
    }
  }));

  const geoJSON = {
    type: 'FeatureCollection',
    name: 'field_survey_points',
    crs: {
      type: 'name',
      properties: {
        name: 'urn:ogc:def:crs:OGC:1.3:CRS84'
      }
    },
    features
  };

  return JSON.stringify(geoJSON, null, 2);
};

export const downloadFile = (content: string, filename: string, mimeType: string): void => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const formatDate = (isoString: string): string => {
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
};
