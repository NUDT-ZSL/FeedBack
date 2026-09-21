var AutoDemoDB = (function () {
  'use strict';

  var DB_NAME = 'autodemo-offline-relay-v1';
  var DB_VERSION = 2;
  var STORES = {
    files: 'files',
    chunks: 'chunks',
    chunkData: 'chunkData',
    candidates: 'candidates',
    conversion: 'conversion',
    conversionData: 'conversionData',
    conversionCheckpoints: 'conversionCheckpoints'
  };

  function request(requestObject) {
    return new Promise(function (resolve, reject) {
      requestObject.onsuccess = function () { resolve(requestObject.result); };
      requestObject.onerror = function () { reject(requestObject.error || new Error('IndexedDB 操作失败。')); };
    });
  }

  function open() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORES.files)) db.createObjectStore(STORES.files, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORES.chunks)) db.createObjectStore(STORES.chunks, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORES.chunkData)) db.createObjectStore(STORES.chunkData);
        if (!db.objectStoreNames.contains(STORES.candidates)) db.createObjectStore(STORES.candidates, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORES.conversion)) db.createObjectStore(STORES.conversion, { keyPath: 'jobId' });
        if (!db.objectStoreNames.contains(STORES.conversionData)) db.createObjectStore(STORES.conversionData);
        if (!db.objectStoreNames.contains(STORES.conversionCheckpoints)) db.createObjectStore(STORES.conversionCheckpoints);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('无法打开本地数据库。')); };
    });
  }

  function tx(db, names, mode, callback) {
    return new Promise(function (resolve, reject) {
      var transaction = db.transaction(names, mode);
      var stores = {};
      names.forEach(function (name) { stores[name] = transaction.objectStore(name); });
      Promise.resolve(callback(stores)).then(function (value) {
        if (transaction.__whenCallbackDone) {
          transaction.__whenCallbackDone();
          resolve(value);
        } else {
          transaction.oncomplete = function () { resolve(value); };
          transaction.onerror = function () { reject(transaction.error || new Error('本地事务失败。')); };
          transaction.onabort = function () { reject(transaction.error || new Error('本地事务被中止。')); };
        }
      }, function (error) {
        reject(error);
      });
    });
  }

  function put(store, value, key) {
    return request(arguments.length === 3 ? store.put(value, key) : store.put(value));
  }
  function get(store, key) { return request(store.get(key)); }
  function del(store, key) { return request(store.delete(key)); }
  function all(store) {
    return new Promise(function (resolve, reject) {
      var rows = [];
      var cursorReq = store.openCursor();
      cursorReq.onsuccess = function () {
        var cursor = cursorReq.result;
        if (cursor) { rows.push(cursor.value); cursor.continue(); } else resolve(rows);
      };
      cursorReq.onerror = function () { reject(cursorReq.error); };
    });
  }

  function rangeForJob(jobId) {
    return IDBKeyRange.bound(jobId + '#', jobId + '#\uffff', false, false);
  }

  function chunkId(jobId, index) { return jobId + '#chunk#' + String(index).padStart(8, '0'); }
  function chunkDataKey(jobId, index) { return jobId + '#data#' + String(index).padStart(8, '0'); }
  function candidateId(jobId, index, attempt) {
    return jobId + '#candidate#' + String(index).padStart(8, '0') + '#' + String(attempt).padStart(4, '0');
  }
  function conversionDataKey(jobId, index) {
    return jobId + '#converted#' + String(index).padStart(8, '0');
  }
  function conversionMetaKey(jobId, index) {
    return jobId + '#converted-meta#' + String(index).padStart(8, '0');
  }
  function checkpointKey(jobId, index) {
    return jobId + '#checkpoint#' + String(index).padStart(8, '0');
  }

  var api = {
    STORES: STORES,
    open: open,
    tx: tx,
    put: put,
    get: get,
    del: del,
    all: all,
    rangeForJob: rangeForJob,
    chunkId: chunkId,
    chunkDataKey: chunkDataKey,
    candidateId: candidateId,
    conversionDataKey: conversionDataKey,
    conversionMetaKey: conversionMetaKey,
    checkpointKey: checkpointKey
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
}());
