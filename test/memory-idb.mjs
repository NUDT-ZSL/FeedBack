export function createDeferredRequest(result) {
  const request = {
    _onsuccess: null,
    _onerror: null,
    result,
    get onsuccess() { return this._onsuccess; },
    set onsuccess(value) {
      this._onsuccess = value;
      queueMicrotask(() => value({ target: this }));
    },
    get onerror() { return this._onerror; },
    set onerror(value) { this._onerror = value; }
  };
  return request;
}

export class MemoryObjectStore {
  constructor(name, keyPath) {
    this.name = name;
    this.keyPath = keyPath;
    this.values = new Map();
  }

  put(value, explicitKey) {
    const key = this.keyPath ? value[this.keyPath] : explicitKey;
    this.values.set(key, value);
    return createDeferredRequest(key);
  }

  get(key) {
    return createDeferredRequest(this.values.get(key));
  }

  delete(key) {
    this.values.delete(key);
    return createDeferredRequest(undefined);
  }

  openCursor() {
    const rows = Array.from(this.values.values());
    let position = 0;
    const request = {};
    let handler = null;
    const advance = () => {
      request.result = position < rows.length
        ? { value: rows[position++], continue: () => queueMicrotask(advance) }
        : null;
      if (handler) handler({ target: request });
    };
    Object.defineProperty(request, 'onsuccess', {
      configurable: true,
      get() { return handler; },
      set(value) {
        handler = value;
        queueMicrotask(advance);
      }
    });
    return request;
  }
}

export class MemoryDatabase {
  constructor() {
    this.stores = new Map();
    [
      ['files', 'id'], ['chunks', 'id'], ['chunkData', null], ['candidates', 'id'],
      ['conversion', 'jobId'], ['conversionData', null], ['conversionCheckpoints', null]
    ].forEach(([name, keyPath]) => this.stores.set(name, new MemoryObjectStore(name, keyPath)));
  }

  objectStore(name) { return this.stores.get(name); }

  transaction(names) {
    let completedHandler = null;
    return {
      onerror: null,
      onabort: null,
      abort() {},
      __whenCallbackDone() {
        if (completedHandler) completedHandler({ target: this });
      },
      objectStore: (name) => this.stores.get(name),
      get oncomplete() { return completedHandler; },
      set oncomplete(value) {
        completedHandler = value;
      }
    };
  }
}

export function installIndexedDB() {
  const db = new MemoryDatabase();
  globalThis.indexedDB = {
    open() {
      return {
        onupgradeneeded: null,
        _onsuccess: null,
        onerror: null,
        result: db,
        get onsuccess() { return this._onsuccess; },
        set onsuccess(value) {
          this._onsuccess = value;
          queueMicrotask(() => value({ target: this }));
        }
      };
    }
  };
  return db;
}
