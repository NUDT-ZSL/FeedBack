var AutoDemoCore = (function () {
  'use strict';
  var STATUS = { WAITING: 'waiting', RECEIVING: 'receiving', RECEIVED: 'received', FAILED: 'failed', CONFLICT: 'conflict', CONVERTING: 'converting' };
  var FILE_STATUS = { WAITING: 'waiting', RECEIVING: 'receiving', RECEIVED: 'received', FAILED: 'failed', CONFLICT: 'conflict', CONVERTING: 'converting', CONVERSION_PAUSED: 'conversion-paused', CONVERSION_FAILED: 'conversion-failed', COMPLETED: 'completed' };
  var CONVERSION_VERSION = 'xor5a-sha256-v1';
  var MIN_CHUNK_SIZE = 64 * 1024;
  function jobIdForFile(file) { return file.name + '::' + String(file.size); }
  function normalizeChunkSize(value, fileSize) {
    var n = Number(value);
    if (!Number.isFinite(n) || Math.floor(n) !== n) throw new Error('分段大小必须是整数字节数。');
    if (n < MIN_CHUNK_SIZE && fileSize > MIN_CHUNK_SIZE) throw new Error('大于 64 KiB 的文件请使用不小于 65536 字节的分段。');
    if (n < 1) throw new Error('分段大小必须大于 0。');
    return n;
  }
  function buildManifest(fileSize, chunkSize) {
    if (!Number.isInteger(fileSize) || fileSize < 0) throw new Error('文件大小无效。');
    if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error('分段大小无效。');
    var chunks = [], total = fileSize === 0 ? 1 : Math.ceil(fileSize / chunkSize);
    for (var i = 0; i < total; i++) {
      var start = i * chunkSize, end = fileSize === 0 ? 0 : Math.min(start + chunkSize, fileSize);
      chunks.push({ index: i, start: start, end: end, length: end - start });
    }
    return chunks;
  }
  function bufferHex(buffer) {
    var bytes = new Uint8Array(buffer), out = '';
    for (var i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
  }
  async function sha256Bytes(buffer) { return bufferHex(await crypto.subtle.digest('SHA-256', buffer)); }
  async function sha256Text(text) { return sha256Bytes(new TextEncoder().encode(text)); }

  function findDifferences(oldBuffer, newBuffer, maxRanges) {
    var oldBytes = new Uint8Array(oldBuffer);
    var newBytes = new Uint8Array(newBuffer);
    var limit = maxRanges || 80;
    var maxLength = Math.max(oldBytes.length, newBytes.length);
    var ranges = [];
    var start = null;
    var differences = 0;
    for (var pos = 0; pos < maxLength; pos++) {
      var mismatch = pos >= oldBytes.length || pos >= newBytes.length || oldBytes[pos] !== newBytes[pos];
      if (mismatch) {
        differences++;
        if (start === null) start = pos;
      }
      var ending = mismatch && pos === maxLength - 1;
      if (start !== null && (ending || !mismatch)) {
        var end = ending ? pos + 1 : pos;
        if (ranges.length < limit) ranges.push({ start: start, end: end });
        start = null;
      }
    }
    return {
      oldLength: oldBytes.length,
      newLength: newBytes.length,
      differingBytes: differences,
      truncated: differences > ranges.length,
      ranges: ranges
    };
  }

  function transformBytes(input) {
    var source = new Uint8Array(input);
    var output = new Uint8Array(source.length);
    for (var i = 0; i < source.length; i++) output[i] = source[i] ^ 0x5a;
    return output.buffer;
  }

  async function initialAggregate(file) {
    return sha256Text([CONVERSION_VERSION, String(file.size), String(file.chunkCount)].join('\n'));
  }

  async function extendAggregate(previous, index, chunkHash, transformedLength) {
    return sha256Text([previous, String(index), chunkHash, String(transformedLength)].join('\n'));
  }

  async function computeFinalAggregate(file, chunkResults) {
    var acc = await initialAggregate(file);
    for (var i = 0; i < chunkResults.length; i++) {
      if (!chunkResults[i]) throw new Error('第 ' + (i + 1) + ' 段缺少转换结果。');
      acc = await extendAggregate(acc, i, chunkResults[i].hash, chunkResults[i].transformedBytes);
    }
    return acc;
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    var units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    var value = bytes, unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return value.toFixed(value >= 10 || unit === 0 ? 0 : 1) + ' ' + units[unit];
  }

  function percent(done, total) {
    if (!total) return 100;
    return Math.min(100, Math.max(0, (done / total) * 100));
  }

  function shortHash(hash) { return hash ? hash.slice(0, 12) + '…' : '—'; }

  function hexPreview(buffer, start, length) {
    var total = Math.max(0, buffer.byteLength - start);
    var bytes = new Uint8Array(buffer, start, Math.min(length || 24, total));
    var rows = [];
    for (var i = 0; i < bytes.length; i += 8) {
      var part = Array.prototype.slice.call(bytes.subarray(i, i + 8));
      rows.push(part.map(function (b) { return b.toString(16).padStart(2, '0'); }).join(' '));
    }
    return rows.join('\n');
  }

  var api = {
    STATUS: STATUS,
    FILE_STATUS: FILE_STATUS,
    CONVERSION_VERSION: CONVERSION_VERSION,
    MIN_CHUNK_SIZE: MIN_CHUNK_SIZE,
    jobIdForFile: jobIdForFile,
    normalizeChunkSize: normalizeChunkSize,
    buildManifest: buildManifest,
    bufferHex: bufferHex,
    sha256Bytes: sha256Bytes,
    sha256Text: sha256Text,
    findDifferences: findDifferences,
    transformBytes: transformBytes,
    initialAggregate: initialAggregate,
    extendAggregate: extendAggregate,
    computeFinalAggregate: computeFinalAggregate,
    formatBytes: formatBytes,
    percent: percent,
    shortHash: shortHash,
    hexPreview: hexPreview
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
}());
