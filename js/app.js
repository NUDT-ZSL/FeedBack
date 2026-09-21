(function () {
  'use strict';

  var core = AutoDemoCore, db = AutoDemoDB;
  var S = core.STATUS, FS = core.FILE_STATUS;
  var state = {
    db: null,
    files: [],
    chunksByJob: {},
    candidatesByJob: {},
    conversionByJob: {},
    sources: new Map(),
    receivers: new Set(),
    runners: new Map(),
    comparers: new Set(),
    workers: new Map(),
    faults: {},
    expanded: {},
    page: {},
    pageSize: 8,
    notice: { kind: '', text: '' },
    renderQueued: false
  };

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $all(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function fileById(id) { return state.files.find(function (f) { return f.id === id; }); }
  function chunksOf(jobId) { return state.chunksByJob[jobId] || []; }
  function candidatesOf(jobId) { return state.candidatesByJob[jobId] || []; }
  function conversionOf(jobId) { return state.conversionByJob[jobId]; }
  function conversionRunning(jobId) { return Boolean(state.runners.has(jobId) || (conversionOf(jobId) || {}).status === 'running'); }
  function sortedChunks(jobId) { return chunksOf(jobId).slice().sort(function (a, b) { return a.index - b.index; }); }
  function sortedCandidates(jobId) {
    return candidatesOf(jobId).slice().sort(function (a, b) {
      if (a.index !== b.index) return a.index - b.index;
      return b.createdAt - a.createdAt;
    });
  }

  function setNotice(kind, text) {
    state.notice = { kind: kind, text: text };
    scheduleRender();
  }

  function scheduleRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(function () {
      state.renderQueued = false;
      render();
    });
  }

  async function loadAll() {
    var names = [db.STORES.files, db.STORES.chunks, db.STORES.candidates, db.STORES.conversion];
    var data = await db.tx(state.db, names, 'readonly', function (stores) {
      return Promise.all([
        db.all(stores[db.STORES.files]),
        db.all(stores[db.STORES.chunks]),
        db.all(stores[db.STORES.candidates]),
        db.all(stores[db.STORES.conversion])
      ]);
    });
    state.files = data[0].sort(function (a, b) { return b.createdAt - a.createdAt; });
    state.chunksByJob = {};
    state.candidatesByJob = {};
    state.conversionByJob = {};
    data[1].forEach(function (chunk) {
      (state.chunksByJob[chunk.jobId] = state.chunksByJob[chunk.jobId] || []).push(chunk);
    });
    data[2].forEach(function (candidate) {
      (state.candidatesByJob[candidate.jobId] = state.candidatesByJob[candidate.jobId] || []).push(candidate);
    });
    data[3].forEach(function (conv) { state.conversionByJob[conv.jobId] = conv; });
  }

  async function persistFile(file) {
    await db.tx(state.db, [db.STORES.files], 'readwrite', function (stores) {
      return db.put(stores[db.STORES.files], file);
    });
  }

  function calcReceiveProgress(file) {
    var chunks = chunksOf(file.id);
    var done = chunks.filter(function (c) { return c.status === S.RECEIVED; }).length;
    return { done: done, total: file.chunkCount, percent: core.percent(done, file.chunkCount) };
  }

  function calcConvertProgress(file) {
    var conv = conversionOf(file.id);
    if (!conv) return { done: 0, total: file.chunkCount, percent: 0, bytes: 0 };
    return {
      done: conv.nextIndex || 0,
      total: file.chunkCount,
      percent: core.percent(conv.nextIndex || 0, file.chunkCount),
      bytes: conv.transformedBytes || 0
    };
  }

  function overallFileStatus(file) {
    var chunks = chunksOf(file.id);
    var unresolved = candidatesOf(file.id).some(function (c) { return !c.resolution; });
    if (unresolved) return FS.CONFLICT;
    if (chunks.some(function (c) { return c.status === S.CONFLICT; })) return FS.CONFLICT;
    var conv = conversionOf(file.id);
    if (conv) {
      if (conv.status === 'running') return FS.CONVERTING;
      if (conv.status === 'paused') return FS.CONVERSION_PAUSED;
      if (conv.status === 'failed') return FS.CONVERSION_FAILED;
      if (conv.status === 'completed') return FS.COMPLETED;
    }
    if (chunks.some(function (c) { return c.status === S.FAILED; })) return FS.FAILED;
    var done = chunks.filter(function (c) { return c.status === S.RECEIVED; }).length;
    if (done === file.chunkCount) return FS.RECEIVED;
    if (state.receivers.has(file.id) || chunks.some(function (c) { return c.status === S.RECEIVING; })) return FS.RECEIVING;
    if (done > 0) return FS.FAILED;
    return FS.WAITING;
  }

  function statusLabel(status) {
    return {
      waiting: '等待', receiving: '接收中', received: '已接收', failed: '失败',
      conflict: '冲突', converting: '转换中', 'conversion-paused': '转换中断',
      'conversion-failed': '转换失败', completed: '转换完成'
    }[status] || status;
  }

  async function addFiles(fileList, chunkSizeInput) {
    var files = Array.prototype.slice.call(fileList);
    var selectedSize = Number(chunkSizeInput);
    if (!files.length) return;
    try {
      for (var i = 0; i < files.length; i++) {
        var browserFile = files[i];
        var chunkSize = selectedSize || core.MIN_CHUNK_SIZE;
        var id = core.jobIdForFile(browserFile);
        var existing = fileById(id);
        if (existing) {
          if (existing.chunkSize !== chunkSize) {
            setNotice('warning', '“' + existing.name + '”已存在，继续使用原分段 ' + core.formatBytes(existing.chunkSize) + '；只重新读取指定分段，不改变已确认分段。');
          }
          existing.sourceMissing = false;
          existing.lastSourceAt = Date.now();
          await persistFile(existing);
          state.sources.set(id, browserFile);
          if (!state.receivers.has(id) && !candidatesOf(id).some(function (c) { return !c.resolution; })) {
            Promise.resolve(startReceiver(id)).catch(function (error) { setNotice('error', error.message || String(error)); });
          }
          continue;
        }
        chunkSize = core.normalizeChunkSize(chunkSize, browserFile.size);
        var manifest = core.buildManifest(browserFile.size, chunkSize);
        var record = {
          id: id, name: browserFile.name, size: browserFile.size,
          chunkSize: chunkSize, chunkCount: manifest.length,
          createdAt: Date.now(), updatedAt: Date.now(),
          sourceMissing: false, lastSourceAt: Date.now()
        };
        var rows = manifest.map(function (part) {
          return {
            id: db.chunkId(id, part.index), jobId: id, index: part.index,
            start: part.start, end: part.end, length: part.length,
            status: S.WAITING, error: '', hash: '', receivedAt: 0, attempts: 0
          };
        });
        await db.tx(state.db, [db.STORES.files, db.STORES.chunks], 'readwrite', function (stores) {
          return Promise.all([
            db.put(stores[db.STORES.files], record),
            Promise.all(rows.map(function (row) { return db.put(stores[db.STORES.chunks], row); }))
          ]);
        });
        state.files.unshift(record);
        state.chunksByJob[id] = rows;
        state.sources.set(id, browserFile);
        Promise.resolve(startReceiver(id)).catch(function (error) { setNotice('error', error.message || String(error)); });
      }
      setNotice('info', files.length === 1 ? '已添加并开始接收：' + files[0].name : '已添加 ' + files.length + ' 个文件，正在后台依次接收。');
      scheduleRender();
    } catch (error) {
      setNotice('error', error.message || String(error));
    }
  }

  function requireSource(jobId) {
    var source = state.sources.get(jobId);
    if (source) return source;
    throw new Error('浏览器安全限制不会持久保存本机文件句柄。刷新页面后请点“重新选择源文件”，已接收的分段不会丢失。');
  }

  async function setFilePatch(jobId, patch) {
    var next = Object.assign({}, fileById(jobId), patch, { updatedAt: Date.now() });
    await persistFile(next);
    state.files[state.files.findIndex(function (f) { return f.id === jobId; })] = next;
    return next;
  }

  async function markChunk(jobId, index, patch, includeData, data) {
    var list = chunksOf(jobId);
    var pos = list.findIndex(function (c) { return c.index === index; });
    var next = Object.assign({}, list[pos], patch, { updatedAt: Date.now() });
    var names = [db.STORES.chunks];
    if (includeData) names.push(db.STORES.chunkData);
    await db.tx(state.db, names, 'readwrite', function (stores) {
      var work = [db.put(stores[db.STORES.chunks], next)];
      if (includeData) work.push(db.put(stores[db.STORES.chunkData], data, db.chunkDataKey(jobId, index)));
      return Promise.all(work);
    });
    list[pos] = next;
    return next;
  }

  async function receiveOne(jobId, index) {
    var chunk = chunksOf(jobId).find(function (c) { return c.index === index; });
    await markChunk(jobId, index, { status: S.RECEIVING, error: '' });
    scheduleRender();
    try {
      var source = requireSource(jobId);
      var buffer = await source.slice(chunk.start, chunk.end).arrayBuffer();
      if (buffer.byteLength !== chunk.length) throw new Error('读取到 ' + buffer.byteLength + ' 字节，与分段计划 ' + chunk.length + ' 字节不一致。');
      var hash = await core.sha256Bytes(buffer);
      if (state.faults[db.chunkId(jobId, index)]) {
        state.faults[db.chunkId(jobId, index)] = false;
        throw new Error('已按分段开关模拟一次接收失败；未覆盖本地已确认数据。');
      }
      await markChunk(jobId, index, {
        status: S.RECEIVED, hash: hash, error: '',
        receivedAt: Date.now(), attempts: (chunk.attempts || 0) + 1
      }, true, buffer);
      await setFilePatch(jobId, { lastReceivedAt: Date.now(), sourceMissing: false });
      scheduleRender();
    } catch (error) {
      await markChunk(jobId, index, {
        status: S.FAILED, error: error.message || String(error),
        attempts: (chunk.attempts || 0) + 1
      });
      await setFilePatch(jobId, { sourceMissing: error.message.indexOf('重新选择源文件') >= 0, lastError: error.message });
      scheduleRender();
      throw error;
    }
  }

  async function startReceiver(jobId) {
    if (state.receivers.has(jobId)) return;
    var file = fileById(jobId);
    if (!file || candidatesOf(jobId).some(function (c) { return !c.resolution; })) return;
    state.receivers.add(jobId);
    scheduleRender();
    try {
      var order = sortedChunks(jobId);
      var first = order.find(function (c) { return c.status === S.WAITING || c.status === S.FAILED; });
      var startIndex = first ? first.index : 0;
      for (var i = startIndex; i < order.length; i++) {
        var chunk = order[i];
        if (chunk.status === S.RECEIVED) continue;
        if (candidatesOf(jobId).some(function (c) { return !c.resolution; })) break;
        try {
          await receiveOne(jobId, chunk.index);
        } catch (error) {
          break;
        }
      }
      if (chunksOf(jobId).every(function (c) { return c.status === S.RECEIVED; }) &&
          !candidatesOf(jobId).some(function (c) { return !c.resolution; })) {
        await setFilePatch(jobId, { receivedAt: Date.now() });
        try { await startConversion(jobId); }
        catch (error) { setNotice('error', error.message || String(error)); }
      }
    } finally {
      state.receivers.delete(jobId);
      scheduleRender();
    }
  }

  async function readCandidate(jobId, index) {
    if (state.runners.has(jobId) || state.comparers.has(jobId)) throw new Error('转换或比对正在使用该分段，请稍候或先中断转换。');
    var chunk = chunksOf(jobId).find(function (c) { return c.index === index; });
    var source = requireSource(jobId);
    var data = await source.slice(chunk.start, chunk.end).arrayBuffer();
    if (data.byteLength !== chunk.length) throw new Error('候选内容长度为 ' + data.byteLength + '，分段计划为 ' + chunk.length + '。');
    var hash = await core.sha256Bytes(data);
    if (chunk.status === S.RECEIVED && hash === chunk.hash) {
      return { unchanged: true, data: data, hash: hash };
    }
    var oldData = await db.tx(state.db, [db.STORES.chunkData], 'readonly', function (stores) {
      return db.get(stores[db.STORES.chunkData], db.chunkDataKey(jobId, index));
    });
    if (!oldData) throw new Error('原分段内容不存在，无法做冲突比对；请直接重试该分段。');
    var diff = core.findDifferences(oldData, data);
    var attempts = candidatesOf(jobId).filter(function (c) { return c.index === index; }).length;
    var candidate = {
      id: db.candidateId(jobId, index, attempts),
      jobId: jobId,
      index: index,
      attempt: attempts,
      oldHash: chunk.hash,
      newHash: hash,
      oldLength: oldData.byteLength,
      newLength: data.byteLength,
      diff: diff,
      resolution: '',
      createdAt: Date.now(),
      resolvedAt: 0
    };
    await db.tx(state.db, [db.STORES.candidates, db.STORES.chunkData], 'readwrite', function (stores) {
      return Promise.all([
        db.put(stores[db.STORES.candidates], candidate),
        db.put(stores[db.STORES.chunkData], data, candidate.id)
      ]);
    });
    await markChunk(jobId, index, { status: S.CONFLICT, error: '检测到与先前记录不一致，已保留新旧双方。' });
    state.candidatesByJob[jobId] = (state.candidatesByJob[jobId] || []).concat(candidate);
    scheduleRender();
    return { unchanged: false, candidate: candidate, data: data, hash: hash };
  }

  async function invalidateConversionForChunk(jobId, index) {
    var conv = conversionOf(jobId);
    if (!conv || conv.status === 'idle' || conv.nextIndex <= index) return null;
    var checkpoint = await getCheckpoint(jobId, index);
    if (!checkpoint) throw new Error('找不到第 ' + (index + 1) + ' 段之前的转换检查点。');
    await deleteConversionTail(jobId, index, conv.nextIndex);
    var nextConv = Object.assign({}, conv, {
      status: 'paused',
      nextIndex: index,
      aggregate: checkpoint.aggregate,
      transformedBytes: checkpoint.transformedBytes,
      finalHash: '',
      updatedAt: Date.now(),
      error: '第 ' + (index + 1) + ' 段内容被裁决更新，转换回退到该分段；更早结果保持原样。'
    });
    await persistConversion(nextConv);
    return nextConv;
  }

  async function resolveCandidate(candidateIdValue, resolution) {
    var candidate = null, jobId = '';
    Object.keys(state.candidatesByJob).some(function (key) {
      candidate = state.candidatesByJob[key].find(function (c) { return c.id === candidateIdValue; });
      if (candidate) jobId = key;
      return Boolean(candidate);
    });
    if (!candidate || candidate.resolution) return;
    var chunk = chunksOf(jobId).find(function (c) { return c.index === candidate.index; });
    var data = await db.tx(state.db, [db.STORES.chunkData], 'readonly', function (stores) {
      return db.get(stores[db.STORES.chunkData], candidate.id);
    });
    if (!data) throw new Error('候选分段内容已不在本地数据库中。');

    var updatedCandidate = Object.assign({}, candidate, {
      resolution: resolution,
      resolvedAt: Date.now()
    });
    if (resolution === 'new') {
      await invalidateConversionForChunk(jobId, candidate.index);
      await db.tx(state.db, [db.STORES.chunks, db.STORES.candidates, db.STORES.chunkData], 'readwrite', function (stores) {
        return Promise.all([
          db.put(stores[db.STORES.candidates], updatedCandidate),
          db.put(stores[db.STORES.chunkData], data, db.chunkDataKey(jobId, candidate.index)),
          db.put(stores[db.STORES.chunks], Object.assign({}, chunk, {
            status: S.RECEIVED, hash: candidate.newHash, error: '',
            receivedAt: Date.now(), updatedAt: Date.now()
          }))
        ]);
      });
    } else {
      await db.tx(state.db, [db.STORES.candidates, db.STORES.chunks], 'readwrite', function (stores) {
        return Promise.all([
          db.put(stores[db.STORES.candidates], updatedCandidate),
          db.put(stores[db.STORES.chunks], Object.assign({}, chunk, {
            status: S.RECEIVED, error: '', updatedAt: Date.now()
          }))
        ]);
      });
    }
    await loadAll();
    var stillConflict = candidatesOf(jobId).some(function (c) { return !c.resolution; });
    if (!stillConflict) {
      var allReceived = chunksOf(jobId).every(function (c) { return c.status === S.RECEIVED; });
      var conv = conversionOf(jobId);
      if (allReceived && !(conv && conv.status === 'completed' && resolution === 'old')) startConversion(jobId);
      else if (!allReceived) Promise.resolve(startReceiver(jobId)).catch(function (error) { setNotice('error', error.message || String(error)); });
    }
    setNotice('info', resolution === 'new' ? '已采用新内容，并只回退受影响的转换分段。' : '已保留原记录，其余处理结果未改变。');
    scheduleRender();
  }

  async function persistConversion(conv) {
    state.conversionByJob[conv.jobId] = conv;
    await db.tx(state.db, [db.STORES.conversion], 'readwrite', function (stores) {
      return db.put(stores[db.STORES.conversion], conv);
    });
  }

  async function getChunkData(jobId, index) {
    return db.tx(state.db, [db.STORES.chunkData], 'readonly', function (stores) {
      return db.get(stores[db.STORES.chunkData], db.chunkDataKey(jobId, index));
    });
  }

  async function getConvertedData(jobId, index) {
    return db.tx(state.db, [db.STORES.conversionData], 'readonly', function (stores) {
      return db.get(stores[db.STORES.conversionData], db.conversionDataKey(jobId, index));
    });
  }

  async function putConvertedData(jobId, index, data) {
    return db.tx(state.db, [db.STORES.conversionData], 'readwrite', function (stores) {
      return db.put(stores[db.STORES.conversionData], data, db.conversionDataKey(jobId, index));
    });
  }

  async function putCheckpoint(jobId, index, value) {
    return db.tx(state.db, [db.STORES.conversionCheckpoints], 'readwrite', function (stores) {
      return db.put(stores[db.STORES.conversionCheckpoints], value, db.checkpointKey(jobId, index));
    });
  }

  async function commitConvertedSegment(jobId, index, result, nextAggregate, nextBytes) {
    var dataStore = db.STORES.conversionData;
    var checkStore = db.STORES.conversionCheckpoints;
    await db.tx(state.db, [dataStore, checkStore], 'readwrite', function (stores) {
      return Promise.all([
        db.put(stores[dataStore], result.data, db.conversionDataKey(jobId, index)),
        db.put(stores[dataStore], {
          hash: result.hash,
          transformedBytes: result.transformedBytes,
        }, db.conversionMetaKey(jobId, index)),
        db.put(stores[checkStore], {
          aggregate: nextAggregate,
          transformedBytes: nextBytes,
          createdAt: Date.now()
        }, db.checkpointKey(jobId, index + 1))
      ]);
    });
  }

  async function getCheckpoint(jobId, index) {
    return db.tx(state.db, [db.STORES.conversionCheckpoints], 'readonly', function (stores) {
      return db.get(stores[db.STORES.conversionCheckpoints], db.checkpointKey(jobId, index));
    });
  }

  async function deleteConversionTail(jobId, fromIndex, toIndex) {
    var dataStore = db.STORES.conversionData;
    var checkStore = db.STORES.conversionCheckpoints;
    await db.tx(state.db, [dataStore, checkStore], 'readwrite', function (stores) {
      var work = [];
      for (var i = fromIndex; i < toIndex; i++) {
        work.push(db.del(stores[dataStore], db.conversionDataKey(jobId, i)));
        work.push(db.del(stores[dataStore], db.conversionMetaKey(jobId, i)));
        if (i > fromIndex) work.push(db.del(stores[checkStore], db.checkpointKey(jobId, i)));
      }
      return Promise.all(work);
    });
  }

  function workerSource() {
    return [
      "function hex(b){var a=new Uint8Array(b),o='';for(var i=0;i<a.length;i++)o+=a[i].toString(16).padStart(2,'0');return o;}",
      "self.onmessage=async function(e){var m=e.data||{};try{if(m.type!=='convert')throw new Error('未知转换请求');",
      "var s=new Uint8Array(m.data),o=new Uint8Array(s.length);for(var i=0;i<s.length;i++)o[i]=s[i]^0x5a;",
      "var h=hex(await crypto.subtle.digest('SHA-256',o.buffer));",
      "self.postMessage({type:'converted',jobId:m.jobId,index:m.index,data:o.buffer,hash:h,transformedBytes:o.byteLength},[o.buffer]);",
      "}catch(x){self.postMessage({type:'conversion-error',jobId:m.jobId,index:m.index,message:x.message||'后台转换失败'});}};"
    ].join('\n');
  }

  function acquireWorker(jobId) {
    if (state.workers.has(jobId)) return state.workers.get(jobId);
    var blob = new Blob([workerSource()], { type: 'application/javascript' });
    var objectUrl = URL.createObjectURL(blob);
    state.workerUrls = state.workerUrls || new Map();
    state.workerUrls.set(jobId, objectUrl);
    var worker = new Worker(objectUrl);
    state.workers.set(jobId, worker);
    return worker;
  }

  function stopWorker(jobId) {
    var worker = state.workers.get(jobId);
    if (worker) {
      worker.terminate();
      state.workers.delete(jobId);
      if (state.workerUrls && state.workerUrls.has(jobId)) {
        URL.revokeObjectURL(state.workerUrls.get(jobId));
        state.workerUrls.delete(jobId);
      }
    }
  }

  function convertWithWorker(jobId, index, data, transfer) {
    return new Promise(function (resolve, reject) {
      var worker = acquireWorker(jobId);
      function cleanup() {
        worker.onmessage = null;
        worker.onerror = null;
      }
      worker.onmessage = function (event) {
        cleanup();
        var msg = event.data || {};
        if (msg.type === 'converted') resolve(msg);
        else reject(new Error(msg.message || '后台转换失败。'));
      };
      worker.onerror = function () {
        cleanup();
        reject(new Error('后台转换 Worker 启动或运行失败。'));
      };
      worker.postMessage({ type: 'convert', jobId: jobId, index: index, data: data }, transfer ? [data] : []);
    });
  }

  async function startConversion(jobId, verifyFrom) {
    var file = fileById(jobId);
    if (!file) return;
    if (state.runners.has(jobId)) return;
    if (candidatesOf(jobId).some(function (c) { return !c.resolution; })) return;
    if (!chunksOf(jobId).every(function (c) { return c.status === S.RECEIVED; })) return;

    var existing = conversionOf(jobId);
    var conv = existing ? Object.assign({}, existing) : {
      jobId: jobId,
      version: core.CONVERSION_VERSION,
      status: 'idle',
      nextIndex: 0,
      aggregate: '',
      finalHash: '',
      transformedBytes: 0,
      verifyFrom: -1,
      error: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    if (!conv.aggregate) conv.aggregate = await core.initialAggregate(file);
    conv.status = 'running';
    conv.error = '';
    var startIndex = Number.isInteger(verifyFrom) && verifyFrom >= 0 ? verifyFrom : (conv.nextIndex || 0);
    if (startIndex > 0) {
      var checkpoint = await getCheckpoint(jobId, startIndex);
      if (!checkpoint) throw new Error('找不到第 ' + (startIndex + 1) + ' 段的转换检查点，无法从该处继续。');
      conv.aggregate = checkpoint.aggregate;
      conv.transformedBytes = checkpoint.transformedBytes;
      conv.nextIndex = startIndex;
      await deleteConversionTail(jobId, startIndex, file.chunkCount);
    }
    conv.verifyFrom = startIndex;
    conv.updatedAt = Date.now();
    state.runners.set(jobId, { cancel: false });
    await persistConversion(conv);
    scheduleRender();

    try {
      var index = conv.nextIndex || 0;
      while (index < file.chunkCount) {
        var runner = state.runners.get(jobId);
        if (!runner || runner.cancel) {
          if (conv.status === 'running') {
            conv.status = 'paused';
            conv.error = '转换已中断，已保留 0 到 ' + conv.nextIndex + ' 段的检查点。';
            await persistConversion(conv);
          }
          break;
        }
        var input = await getChunkData(jobId, index);
        if (!input) throw new Error('第 ' + (index + 1) + ' 段源数据缺失，无法继续转换。');
        var result = await convertWithWorker(jobId, index, input, true);
        var nextAggregate = await core.extendAggregate(conv.aggregate, index, result.hash, result.transformedBytes);
        var nextBytes = (conv.transformedBytes || 0) + result.transformedBytes;
        await commitConvertedSegment(jobId, index, result, nextAggregate, nextBytes);
        conv.aggregate = nextAggregate;
        conv.transformedBytes = nextBytes;
        conv.nextIndex = index + 1;
        conv.updatedAt = Date.now();
        await persistConversion(conv);
        scheduleRender();
        index++;
      }

      if (conv.nextIndex >= file.chunkCount && state.runners.has(jobId) && !state.runners.get(jobId).cancel) {
        conv.status = 'completed';
        conv.finalHash = conv.aggregate;
        conv.error = '';
        conv.verifyFrom = -1;
        conv.completedAt = Date.now();
        conv.updatedAt = Date.now();
        await persistConversion(conv);
        setNotice('success', '“' + file.name + '”转换完成；最终指纹 ' + core.shortHash(conv.finalHash));
      }
    } catch (error) {
      conv.status = 'failed';
      conv.error = error.message || String(error);
      conv.updatedAt = Date.now();
      await persistConversion(conv);
      setNotice('error', '转换第 ' + (conv.nextIndex + 1) + ' 段失败：' + conv.error);
    } finally {
      state.runners.delete(jobId);
      stopWorker(jobId);
      scheduleRender();
    }
  }

  function pauseConversion(jobId) {
    var runner = state.runners.get(jobId);
    if (runner) {
      runner.cancel = true;
      setNotice('info', '已请求中断；当前分段结束后会停在持久化检查点。');
    }
  }

  async function verifyFromSegment(jobId, index) {
    var conv = conversionOf(jobId);
    if (!conv || state.runners.has(jobId)) return;
    startConversion(jobId, index);
  }

  async function simulateChunkConflict(jobId, index) {
    if (state.receivers.has(jobId) || state.runners.has(jobId)) {
      setNotice('warning', '请等待当前接收或转换步骤结束，再注入冲突演示。');
      return;
    }
    var chunk = chunksOf(jobId).find(function (c) { return c.index === index; });
    if (!chunk || chunk.status !== S.RECEIVED) throw new Error('只有已接收分段可以演示内容冲突。');
    var oldData = await getChunkData(jobId, index);
    if (!oldData) throw new Error('原分段数据不存在。');
    var changed = oldData.slice(0);
    var view = new Uint8Array(changed);
    if (view.length === 0) {
      changed = new Uint8Array([0x41]).buffer;
    } else {
      view[0] = view[0] ^ 0xff;
    }
    var hash = await core.sha256Bytes(changed);
    var diff = core.findDifferences(oldData, changed);
    var attempts = candidatesOf(jobId).filter(function (c) { return c.index === index; }).length;
    var candidate = {
      id: db.candidateId(jobId, index, attempts),
      jobId: jobId,
      index: index,
      attempt: attempts,
      oldHash: chunk.hash,
      newHash: hash,
      oldLength: oldData.byteLength,
      newLength: changed.byteLength,
      diff: diff,
      resolution: '',
      synthetic: true,
      createdAt: Date.now(),
      resolvedAt: 0
    };
    await db.tx(state.db, [db.STORES.candidates, db.STORES.chunkData, db.STORES.chunks], 'readwrite', function (stores) {
      return Promise.all([
        db.put(stores[db.STORES.candidates], candidate),
        db.put(stores[db.STORES.chunkData], changed, candidate.id),
        db.put(stores[db.STORES.chunks], Object.assign({}, chunk, {
          status: S.CONFLICT,
          error: '检测到新的分段内容；冲突双方已保留，等待裁决。',
          updatedAt: Date.now()
        }))
      ]);
    });
    await loadAll();
    setNotice('info', '已为第 ' + (index + 1) + ' 段生成一个内容不同的候选版本。');
    scheduleRender();
  }

  async function compareOne(jobId, index, managed) {
    if (!managed && state.comparers.has(jobId)) return;
    if (!managed) {
      state.comparers.add(jobId);
      scheduleRender();
    }
    try {
      var chunk = chunksOf(jobId).find(function (c) { return c.index === index; });
      if (!chunk || chunk.status === S.CONFLICT) return;
      var result = await readCandidate(jobId, index);
      if (result.unchanged) setNotice('success', '第 ' + (index + 1) + ' 段与先前记录一致，已有结果保持不变。');
      else setNotice('warning', '第 ' + (index + 1) + ' 段内容不一致：已保留双方并标出差异位置。');
    } catch (error) {
      setNotice('error', error.message || String(error));
    } finally {
      state.comparers.delete(jobId);
      scheduleRender();
    }
  }

  async function compareAll(jobId) {
    if (state.comparers.has(jobId)) return;
    state.comparers.add(jobId);
    scheduleRender();
    try {
      for (var i = 0; i < fileById(jobId).chunkCount; i++) {
        if (candidatesOf(jobId).some(function (c) { return !c.resolution; })) break;
        await compareOne(jobId, i, true);
      }
    } finally {
      state.comparers.delete(jobId);
      scheduleRender();
    }
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  async function downloadConverted(jobId) {
    var file = fileById(jobId);
    var conv = conversionOf(jobId);
    if (!conv || conv.status !== 'completed') throw new Error('转换完成后才能下载产物。');
    var parts = [];
    for (var i = 0; i < file.chunkCount; i++) {
      var data = await getConvertedData(jobId, i);
      if (!data) throw new Error('第 ' + (i + 1) + ' 段转换产物缺失。');
      parts.push(new Blob([data]));
    }
    downloadBlob(new Blob(parts), file.name + '.xor5a');
    setNotice('success', '已按分段顺序重组离线转换产物。');
  }

  async function exportReport(jobId) {
    var file = fileById(jobId);
    var report = {
      file: {
        id: file.id,
        name: file.name,
        size: file.size,
        chunkSize: file.chunkSize,
        chunkCount: file.chunkCount
      },
      receive: sortedChunks(jobId).map(function (chunk) {
        return {
          index: chunk.index,
          start: chunk.start,
          end: chunk.end,
          status: chunk.status,
          hash: chunk.hash,
          attempts: chunk.attempts,
          error: chunk.error
        };
      }),
      conflicts: sortedCandidates(jobId).map(function (candidate) {
        return {
          index: candidate.index,
          oldHash: candidate.oldHash,
          newHash: candidate.newHash,
          ranges: candidate.diff.ranges,
          differingBytes: candidate.diff.differingBytes,
          resolution: candidate.resolution,
          synthetic: Boolean(candidate.synthetic)
        };
      }),
      conversion: conversionOf(jobId) || null,
      exportedAt: new Date().toISOString()
    };
    downloadBlob(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
      file.name + '.autodemo-report.json'
    );
  }

  function segmentDisplayStatus(chunk, jobId) {
    if (chunk.status === S.CONFLICT) return S.CONFLICT;
    var conv = conversionOf(jobId);
    if (chunk.status === S.RECEIVED && conv && conv.status === 'running' && (conv.nextIndex || 0) === chunk.index) return S.CONVERTING;
    if (chunk.status === S.RECEIVED && conv && conv.status === 'running' && chunk.index < (conv.nextIndex || 0)) return 'converted';
    if (state.receivers.has(jobId) && chunk.status === S.WAITING) return 'queued';
    return chunk.status;
  }

  function renderNotice() {
    if (!state.notice.text) return '';
    return '<div class="notice ' + esc(state.notice.kind) + '">' + esc(state.notice.text) + '</div>';
  }

  function renderProgress(value, label) {
    return '<div class="progress"><span style="width:' + value.toFixed(1) + '%"></span></div>' +
      '<div class="progress-label">' + esc(label) + '</div>';
  }

  function statusBadge(status) {
    return '<span class="badge status-' + esc(status) + '">' + esc(statusLabel(status === 'converted' ? 'received' : status)) + '</span>';
  }

  function renderConflictPanels(jobId) {
    var unresolved = sortedCandidates(jobId).filter(function (c) { return !c.resolution; });
    return unresolved.map(function (candidate) {
      var shown = candidate.diff.ranges.slice(0, 10).map(function (range) {
        return '字节 ' + range.start + '–' + (range.end - 1);
      }).join('；');
      return '<section class="conflict-panel" data-candidate="' + esc(candidate.id) + '">' +
        '<h4>第 ' + (candidate.index + 1) + ' 段冲突' + (candidate.synthetic ? '（演示候选）' : '') + '</h4>' +
        '<p>原长度 ' + core.formatBytes(candidate.oldLength) + ' / 新长度 ' + core.formatBytes(candidate.newLength) +
        '；差异字节 ' + candidate.diff.differingBytes + ' 个。</p>' +
        '<p class="diff-lines">' + esc(shown || '仅长度不同') + (candidate.diff.truncated ? '；差异过多，仅显示前 10 段' : '') + '</p>' +
        '<div class="hashes"><span>原 ' + esc(core.shortHash(candidate.oldHash)) + '</span><span>新 ' + esc(core.shortHash(candidate.newHash)) + '</span></div>' +
        '<div class="actions"><button data-action="resolve-old" data-job="' + esc(jobId) + '" data-candidate="' + esc(candidate.id) + '">保留原分段</button>' +
        '<button class="primary" data-action="resolve-new" data-job="' + esc(jobId) + '" data-candidate="' + esc(candidate.id) + '">采用新分段</button></div>' +
        '</section>';
    }).join('');
  }

  function renderChunkRows(file, chunks) {
    return chunks.map(function (chunk) {
      var display = segmentDisplayStatus(chunk, file.id);
      var conv = conversionOf(file.id);
      var converted = conv && chunk.index < (conv.nextIndex || 0);
      var hashCell = chunk.hash ? esc(core.shortHash(chunk.hash)) : '—';
      if (converted) hashCell += '<small>已转换</small>';
      var busy = state.receivers.has(file.id) || state.runners.has(file.id) || state.comparers.has(file.id);
      var checkbox = '<label class="fault"><input type="checkbox" data-action="fault" data-job="' + esc(file.id) +
        '" data-index="' + chunk.index + '"' + (state.faults[db.chunkId(file.id, chunk.index)] ? ' checked' : '') +
        (chunk.status === S.RECEIVED || busy ? ' disabled' : '') + '>下一次失败</label>';
      var actions = [];
      if (chunk.status === S.FAILED) actions.push('<button data-action="retry-chunk" data-job="' + esc(file.id) + '" data-index="' + chunk.index + '">只重试此段</button>');
      if (chunk.status === S.RECEIVED) actions.push('<button data-action="compare-chunk" data-job="' + esc(file.id) + '" data-index="' + chunk.index + '"' + (busy ? ' disabled' : '') + '>重新读取比对</button>');
      if (chunk.status === S.RECEIVED && chunk.length > 0) actions.push('<button data-action="conflict-demo" data-job="' + esc(file.id) + '" data-index="' + chunk.index + '"' + (busy ? ' disabled' : '') + '>模拟内容变化</button>');
      return '<tr><td>#' + (chunk.index + 1) + '</td><td><code>' + chunk.start + '–' + chunk.end +
        '</code><br><small>' + core.formatBytes(chunk.length) + '</small></td><td><span class="badge status-' +
        esc(display) + '">' + esc(display === 'queued' ? '排队' : display === 'converted' ? '已转换' : statusLabel(display)) +
        '</span></td><td>' + hashCell + '</td><td>' + checkbox + '</td><td class="reason">' +
        esc(chunk.error || '') + '</td><td><div class="row-actions">' + actions.join('') + '</div></td></tr>';
    }).join('');
  }

  function renderFileCard(file) {
    var receive = calcReceiveProgress(file);
    var convert = calcConvertProgress(file);
    var status = overallFileStatus(file);
    var conv = conversionOf(file.id);
    var chunks = sortedChunks(file.id);
    var pageIndex = state.page[file.id] || 0;
    var pageCount = Math.max(1, Math.ceil(chunks.length / state.pageSize));
    var safePage = Math.min(pageIndex, pageCount - 1);
    state.page[file.id] = safePage;
    var visible = chunks.slice(safePage * state.pageSize, (safePage + 1) * state.pageSize);
    var receiverRunning = state.receivers.has(file.id);
    var conversionRunning = state.runners.has(file.id);
    var actions = [];
    if (file.sourceMissing) actions.push('<button data-action="pick-source" data-job="' + esc(file.id) + '">重新选择源文件</button>');
    if (chunks.some(function (c) { return c.status === S.FAILED; }) && !receiverRunning) actions.push('<button class="primary" data-action="retry-failed" data-job="' + esc(file.id) + '">只重试失败分段</button>');
    if (receive.done === file.chunkCount && !conversionRunning && (!conv || conv.status !== 'completed')) actions.push('<button class="primary" data-action="resume-conversion" data-job="' + esc(file.id) + '">继续转换</button>');
    if (conversionRunning) actions.push('<button data-action="pause-conversion" data-job="' + esc(file.id) + '">中断转换</button>');
    if (conv && conv.status === 'completed') actions.push('<button data-action="verify-conversion" data-job="' + esc(file.id) + '">全量复核</button>');
    if (conv && conv.status === 'completed') actions.push('<button class="primary" data-action="download" data-job="' + esc(file.id) + '">下载转换产物</button>');
    if (receive.done === file.chunkCount) actions.push('<button data-action="compare-all" data-job="' + esc(file.id) + '"' + (receiverRunning || conversionRunning || state.comparers.has(file.id) ? ' disabled' : '') + '>全部分段比对</button>');
    actions.push('<button data-action="report" data-job="' + esc(file.id) + '">导出报告</button>');
    return '<article class="card">' +
      '<header><div><h3>' + esc(file.name) + '</h3><p>' + core.formatBytes(file.size) + ' · 分段 ' +
      core.formatBytes(file.chunkSize) + ' · ' + file.chunkCount + ' 段</p></div>' +
      '<span class="badge status-' + esc(status) + '">' + esc(statusLabel(status)) + '</span></header>' +
      '<div class="two-progress"><div><b>接收 ' + receive.done + '/' + file.chunkCount + '</b>' +
      renderProgress(receive.percent, receive.percent.toFixed(1) + '%') + '</div><div><b>转换 ' +
      convert.done + '/' + file.chunkCount + '</b>' + renderProgress(convert.percent, convert.percent.toFixed(1) + '% · ' + core.formatBytes(convert.bytes)) + '</div></div>' +
      (conv && conv.error ? '<p class="reason">转换：' + esc(conv.error) + '</p>' : '') +
      (conv && conv.finalHash ? '<p class="final-hash">最终指纹：<code>' + esc(conv.finalHash) + '</code></p>' : '') +
      '<div class="actions">' + actions.join('') + '</div>' + renderConflictPanels(file.id) +
      '<table><thead><tr><th>序号</th><th>范围</th><th>状态</th><th>哈希</th><th>故障注入</th><th>原因</th><th>分段操作</th></tr></thead><tbody>' +
      renderChunkRows(file, visible) + '</tbody></table>' +
      '<div class="pager"><button data-action="prev-page" data-job="' + esc(file.id) + '"' + (safePage === 0 ? ' disabled' : '') + '>上一页</button>' +
      '<span>' + (safePage + 1) + '/' + pageCount + '</span><button data-action="next-page" data-job="' + esc(file.id) + '"' +
      (safePage === pageCount - 1 ? ' disabled' : '') + '>下一页</button></div></article>';
  }

  function render() {
    var app = $('#jobs');
    var notice = $('#notice');
    if (notice) notice.innerHTML = renderNotice();
    if (!app) return;
    if (!state.files.length) {
      app.innerHTML = '<div class="empty"><h3>尚未添加文件</h3><p>选择一个或多个本地文件并设置分段大小。所有数据只保存在当前浏览器的本地 IndexedDB 中。</p></div>';
      return;
    }
    app.innerHTML = state.files.map(renderFileCard).join('');
  }

  function chooseSource(jobId) {
    var input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    input.onchange = function () {
      var picked = input.files && input.files[0];
      input.remove();
      if (!picked) return;
      if (core.jobIdForFile(picked) !== jobId) {
        setNotice('error', '所选文件名或大小与原任务不一致；请选择原来的文件。修改后的文件可在名称大小不变时使用“重新读取比对”。');
        return;
      }
      state.sources.set(jobId, picked);
      setFilePatch(jobId, { sourceMissing: false, lastSourceAt: Date.now() }).then(function () {
        setNotice('success', '已重新关联源文件，已接收分段仍保持原样。');
        return startReceiver(jobId);
      }).catch(function (error) {
        setNotice('error', error.message || String(error));
      });
    };
    document.body.appendChild(input);
    input.click();
  }

  async function handleAction(button) {
    var action = button.dataset.action;
    var jobId = button.dataset.job;
    var index = Number(button.dataset.index);
    try {
      if (action === 'retry-chunk') {
        await receiveOne(jobId, index);
        if (chunksOf(jobId).every(function (c) { return c.status === S.RECEIVED; })) await startConversion(jobId);
        else await startReceiver(jobId);
      }
      if (action === 'retry-failed') await startReceiver(jobId);
      if (action === 'pick-source') chooseSource(jobId);
      if (action === 'resume-conversion') await startConversion(jobId);
      if (action === 'pause-conversion') pauseConversion(jobId);
      if (action === 'verify-conversion') await startConversion(jobId, 0);
      if (action === 'compare-chunk') await compareOne(jobId, index);
      if (action === 'compare-all') await compareAll(jobId);
      if (action === 'conflict-demo') await simulateChunkConflict(jobId, index);
      if (action === 'resolve-old' || action === 'resolve-new') {
        await resolveCandidate(button.dataset.candidate, action === 'resolve-old' ? 'old' : 'new');
      }
      if (action === 'download') await downloadConverted(jobId);
      if (action === 'report') await exportReport(jobId);
      if (action === 'prev-page' || action === 'next-page') {
        var current = state.page[jobId] || 0;
        state.page[jobId] = action === 'prev-page' ? Math.max(0, current - 1) : current + 1;
        scheduleRender();
      }
    } catch (error) {
      setNotice('error', error.message || String(error));
    }
  }

  async function init() {
    try {
      state.db = await db.open();
      await loadAll();
      state.files.forEach(function (file) {
        var conv = conversionOf(file.id);
        var hadUnfinishedReceive = chunksOf(file.id).some(function (c) {
          return c.status === S.WAITING || c.status === S.RECEIVING || c.status === S.FAILED;
        });
        if (hadUnfinishedReceive) {
          file.sourceMissing = true;
          file.lastError = file.lastError || '上次接收未完成；重新选择源文件后只会继续未接收或失败的分段。';
        }
        chunksOf(file.id).forEach(function (chunk) {
          if (chunk.status === S.RECEIVING) {
            chunk.status = S.WAITING;
            chunk.error = '应用关闭时该分段尚未确认，已安全回到等待状态。';
          }
        });
        if (conv && conv.status === 'running') {
          conv.status = 'paused';
          conv.error = '应用曾在转换过程中关闭；检查点已保留，可从第 ' + (conv.nextIndex + 1) + ' 段继续。';
        }
      });
      await db.tx(state.db, [db.STORES.files, db.STORES.chunks, db.STORES.conversion], 'readwrite', function (stores) {
        return Promise.all(state.files.map(function (file) {
          var work = [db.put(stores[db.STORES.files], file)];
          var conv = conversionOf(file.id);
          if (conv && conv.status === 'paused') work.push(db.put(stores[db.STORES.conversion], conv));
          chunksOf(file.id).forEach(function (chunk) {
            if (chunk.status === S.WAITING && chunk.error) work.push(db.put(stores[db.STORES.chunks], chunk));
          });
          return Promise.all(work);
        }));
      });
      render();

      var form = $('#add-form');
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        addFiles($('#file-input').files, $('#chunk-size').value);
      });
      document.addEventListener('click', function (event) {
        var button = event.target.closest('button[data-action]');
        if (button && !button.disabled) handleAction(button);
      });
      document.addEventListener('change', function (event) {
        var input = event.target.closest('input[data-action="fault"]');
        if (!input) return;
        state.faults[db.chunkId(input.dataset.job, Number(input.dataset.index))] = input.checked;
        setNotice('info', input.checked ? '该分段的下一次接收将模拟失败，成功分段不会被清除。' : '已取消该分段的失败注入。');
      });
    } catch (error) {
      var root = document.body;
      root.innerHTML = '<div class="fatal"><h2>本地应用启动失败</h2><p>' + esc(error.message || String(error)) + '</p></div>';
    }
  }

  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      state: state,
      init: init,
      addFiles: addFiles,
      receiveOne: receiveOne,
      startReceiver: startReceiver,
      startConversion: startConversion,
      pauseConversion: pauseConversion,
      simulateChunkConflict: simulateChunkConflict,
      resolveCandidate: resolveCandidate,
      conversionOf: conversionOf,
      chunksOf: chunksOf,
      candidatesOf: candidatesOf
    };
  }
}());
