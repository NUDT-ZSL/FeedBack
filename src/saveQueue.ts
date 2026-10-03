export type SaveStatus = 'saved' | 'saving' | 'error';

export type SaveFields = Record<string, unknown>;

export interface SaveResponse {
  version?: number;
  [key: string]: unknown;
}

export type SaveRequestFn = (id: string, body: SaveFields) => Promise<SaveResponse>;

export type StatusListener = (id: string, status: SaveStatus) => void;

interface QueueEntry {
  status: SaveStatus;
  serverVersion: number | null;
  pending: SaveFields | null;
  running: boolean;
  waiters: Array<() => void>;
}

export interface SaveQueue {
  save: (id: string, fields: SaveFields) => void;
  retry: (id: string) => void;
  flush: (id: string) => Promise<void>;
  getStatus: (id: string) => SaveStatus;
  setServerVersion: (id: string, version: number) => void;
  getServerVersion: (id: string) => number | null;
}

export function createSaveQueue(request: SaveRequestFn, onStatus?: StatusListener): SaveQueue {
  const entries = new Map<string, QueueEntry>();

  const getEntry = (id: string): QueueEntry => {
    let entry = entries.get(id);
    if (!entry) {
      entry = {
        status: 'saved',
        serverVersion: null,
        pending: null,
        running: false,
        waiters: []
      };
      entries.set(id, entry);
    }
    return entry;
  };

  const setStatus = (id: string, entry: QueueEntry, status: SaveStatus) => {
    if (entry.status === status) return;
    entry.status = status;
    onStatus?.(id, status);
  };

  const notifyIfIdle = (entry: QueueEntry) => {
    if (entry.running) return;
    if (entry.pending && entry.status !== 'error') return;
    const waiters = entry.waiters.splice(0);
    waiters.forEach((resolve) => resolve());
  };

  const drain = async (id: string, entry: QueueEntry): Promise<void> => {
    if (entry.running) return;
    entry.running = true;
    try {
      while (entry.pending) {
        const fields = entry.pending;
        const body: SaveFields = { ...fields };
        if (entry.serverVersion !== null) {
          body.version = entry.serverVersion;
        }
        try {
          const res = await request(id, body);
          if (res && typeof res.version === 'number') {
            entry.serverVersion = res.version;
          } else if (entry.serverVersion !== null) {
            entry.serverVersion += 1;
          }
          if (entry.pending === fields) {
            entry.pending = null;
          }
        } catch {
          setStatus(id, entry, 'error');
          return;
        }
      }
      setStatus(id, entry, 'saved');
    } finally {
      entry.running = false;
      notifyIfIdle(entry);
      if (entry.pending && entry.status !== 'error') {
        void drain(id, entry);
      }
    }
  };

  return {
    save(id, fields) {
      const entry = getEntry(id);
      entry.pending = entry.pending ? { ...entry.pending, ...fields } : { ...fields };
      setStatus(id, entry, 'saving');
      void drain(id, entry);
    },

    retry(id) {
      const entry = getEntry(id);
      if (entry.status !== 'error' || !entry.pending) return;
      setStatus(id, entry, 'saving');
      void drain(id, entry);
    },

    flush(id) {
      const entry = getEntry(id);
      if (!entry.running && (!entry.pending || entry.status === 'error')) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        entry.waiters.push(resolve);
      });
    },

    getStatus(id) {
      return getEntry(id).status;
    },

    setServerVersion(id, version) {
      getEntry(id).serverVersion = version;
    },

    getServerVersion(id) {
      return getEntry(id).serverVersion;
    }
  };
}
