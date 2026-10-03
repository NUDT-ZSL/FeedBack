export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type SavePayload = Record<string, unknown>;

export type SaveTransport = (exhibitionId: string, payload: SavePayload) => Promise<unknown>;

export type SaveStatusListener = (status: SaveStatus) => void;

interface SaveWaiter {
  version: number;
  resolve: () => void;
  reject: (err: unknown) => void;
}

interface ExhibitionSaveState {
  status: SaveStatus;
  error: unknown;
  pendingPayload: SavePayload | null;
  pendingVersion: number;
  confirmedVersion: number;
  enqueuedVersion: number;
  draining: boolean;
  lastFailedPayload: SavePayload | null;
  listeners: Set<SaveStatusListener>;
  waiters: SaveWaiter[];
  idleListeners: Array<() => void>;
}

export interface SaveManager {
  enqueueSave: (exhibitionId: string, payload: SavePayload) => Promise<void>;
  retrySave: (exhibitionId: string, payload?: SavePayload) => Promise<void> | null;
  flushSaves: (exhibitionId: string) => Promise<SaveStatus>;
  getStatus: (exhibitionId: string) => SaveStatus;
  getError: (exhibitionId: string) => unknown;
  subscribe: (exhibitionId: string, listener: SaveStatusListener) => () => void;
}

const createState = (): ExhibitionSaveState => ({
  status: 'idle',
  error: null,
  pendingPayload: null,
  pendingVersion: 0,
  confirmedVersion: 0,
  enqueuedVersion: 0,
  draining: false,
  lastFailedPayload: null,
  listeners: new Set(),
  waiters: [],
  idleListeners: []
});

/**
 * Serializes saves per exhibition so the server applies them in mutation order:
 * at most one request is in flight per exhibition, and payloads queued while a
 * request is in flight are coalesced into the latest snapshot. A save that
 * starts later can therefore never be overwritten by one that started earlier.
 */
export function createSaveManager(transport: SaveTransport): SaveManager {
  const states = new Map<string, ExhibitionSaveState>();

  const getState = (id: string): ExhibitionSaveState => {
    let state = states.get(id);
    if (!state) {
      state = createState();
      states.set(id, state);
    }
    return state;
  };

  const setStatus = (state: ExhibitionSaveState, status: SaveStatus, error: unknown = null) => {
    state.status = status;
    state.error = error;
    state.listeners.forEach((listener) => listener(status));
  };

  const settleWaiters = (state: ExhibitionSaveState, version: number, err: unknown) => {
    const remaining: SaveWaiter[] = [];
    for (const waiter of state.waiters) {
      if (waiter.version <= version) {
        if (err === null) {
          waiter.resolve();
        } else {
          waiter.reject(err);
        }
      } else {
        remaining.push(waiter);
      }
    }
    state.waiters = remaining;
  };

  const notifyIdle = (state: ExhibitionSaveState) => {
    const listeners = state.idleListeners;
    state.idleListeners = [];
    listeners.forEach((listener) => listener());
  };

  const drain = async (id: string): Promise<void> => {
    const state = getState(id);
    if (state.draining) return;
    state.draining = true;
    try {
      while (state.pendingPayload !== null) {
        const payload = state.pendingPayload;
        const version = state.pendingVersion;
        state.pendingPayload = null;
        setStatus(state, 'saving');
        try {
          await transport(id, payload);
          state.confirmedVersion = Math.max(state.confirmedVersion, version);
          state.lastFailedPayload = null;
          settleWaiters(state, version, null);
          setStatus(state, state.pendingPayload !== null ? 'saving' : 'saved');
        } catch (err) {
          state.lastFailedPayload = payload;
          settleWaiters(state, version, err);
          setStatus(state, 'error', err);
        }
      }
    } finally {
      state.draining = false;
      notifyIdle(state);
    }
  };

  const enqueueSave = (id: string, payload: SavePayload): Promise<void> => {
    const state = getState(id);
    state.enqueuedVersion += 1;
    const version = state.enqueuedVersion;
    state.pendingPayload = payload;
    state.pendingVersion = version;
    const promise = new Promise<void>((resolve, reject) => {
      state.waiters.push({ version, resolve, reject });
    });
    void drain(id);
    return promise;
  };

  const retrySave = (id: string, payload?: SavePayload): Promise<void> | null => {
    const state = getState(id);
    const effectivePayload = payload ?? state.lastFailedPayload;
    if (!effectivePayload) return null;
    return enqueueSave(id, effectivePayload);
  };

  const flushSaves = async (id: string): Promise<SaveStatus> => {
    const state = getState(id);
    while (state.draining || state.pendingPayload !== null) {
      await new Promise<void>((resolve) => {
        state.idleListeners.push(resolve);
      });
    }
    return state.status;
  };

  return {
    enqueueSave,
    retrySave,
    flushSaves,
    getStatus: (id) => getState(id).status,
    getError: (id) => getState(id).error,
    subscribe: (id, listener) => {
      const state = getState(id);
      state.listeners.add(listener);
      return () => {
        state.listeners.delete(listener);
      };
    }
  };
}
