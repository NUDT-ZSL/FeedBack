import assert from 'node:assert/strict';
import test from 'node:test';

import { installBrowserStubs } from './browser-stubs.mjs';
import { installIndexedDB } from './memory-idb.mjs';

installBrowserStubs();
installIndexedDB();

const core = (await import('../js/core.js')).default;
const db = (await import('../js/db.js')).default;
globalThis.AutoDemoCore = core;
globalThis.AutoDemoDB = db;
const app = (await import('../js/app.js')).default;

function makeFile(name, size, chunkSize) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 17 + 3) & 255;
  const file = {
    name,
    size,
    slice(start, end) {
      const copy = bytes.slice(start, end).buffer;
      return { async arrayBuffer() { return copy; } };
    }
  };
  return { file, bytes, chunkSize };
}

async function waitFor(predicate, timeout = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('等待异步状态超时');
}

test('failed segment can retry alone and conversion resumes with identical full-rerun hash', async () => {
  await app.init();
  const setup = makeFile('demo.bin', 5, 2);
  const expectedJobId = core.jobIdForFile({ name: 'demo.bin', size: 5 });
  app.state.faults[db.chunkId(expectedJobId, 1)] = true;
  app.addFiles([setup.file], setup.chunkSize);

  let jobId = core.jobIdForFile(setup.file);
  await waitFor(() => app.chunksOf(jobId).some((chunk) => chunk.status === 'failed'));
  let chunks = app.chunksOf(jobId);
  chunks = app.chunksOf(jobId);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].status, 'received');
  assert.equal(chunks[1].status, 'failed');
  assert.equal(chunks[2].status, 'waiting');
  assert.match(chunks[1].error, /模拟一次接收失败/);

  await app.receiveOne(jobId, 1);
  await app.startReceiver(jobId);
  await waitFor(() => (app.conversionOf(jobId) || {}).status === 'completed');
  chunks = app.chunksOf(jobId);
  assert.equal(chunks[1].status, 'received');
  assert.equal(chunks[0].attempts, 1);
  assert.equal(chunks[1].attempts, 2);
  assert.equal(chunks[2].attempts, 1);

  let conv = app.conversionOf(jobId);
  assert.equal(conv.status, 'completed');
  const fullHash = conv.finalHash;

  // Simulate an interrupted conversion. Restarting from index 1 deletes only the tail and reruns it.
  app.state.runners.delete(jobId);
  conv.status = 'paused';
  conv.nextIndex = 1;
  conv.finalHash = '';
  await app.startConversion(jobId, 1);
  conv = app.conversionOf(jobId);
  assert.equal(conv.status, 'completed');
  assert.equal(conv.finalHash, fullHash);

  // Explicit full re-check rebuilds every conversion result and reaches the same conclusion.
  app.state.runners.delete(jobId);
  await app.startConversion(jobId, 0);
  assert.equal(app.conversionOf(jobId).finalHash, fullHash);
});

test('conflict keeps both sides, marks ranges, and accepting new rolls back only affected tail', async () => {
  await app.init();
  const setup = makeFile('conflict.bin', 6, 2);
  app.addFiles([setup.file], setup.chunkSize);
  const jobId = core.jobIdForFile(setup.file);
  await waitFor(() => (app.conversionOf(jobId) || {}).status === 'completed');
  const originalHash = app.conversionOf(jobId).finalHash;

  app.state.runners.delete(jobId);
  await app.simulateChunkConflict(jobId, 1);
  let candidates = app.candidatesOf(jobId);
  const conflict = candidates.find((candidate) => !candidate.resolution);
  assert.ok(conflict);
  assert.equal(conflict.diff.ranges[0].start, 0);
  assert.equal(app.chunksOf(jobId)[1].status, 'conflict');

  await app.resolveCandidate(conflict.id, 'new');
  await waitFor(() => (app.conversionOf(jobId) || {}).status === 'completed');
  const conv = app.conversionOf(jobId);
  assert.equal(conv.status, 'completed');
  assert.notEqual(conv.finalHash, originalHash);

  // A zero-range checkpoint before segment 1 proves segment 0 was not reconverted.
  const database = app.state.db;
  const checkpointZero = await db.tx(database, [db.STORES.conversionCheckpoints], 'readonly', (stores) =>
    db.get(stores[db.STORES.conversionCheckpoints], db.checkpointKey(jobId, 1))
  );
  assert.ok(checkpointZero.aggregate);

  // Keeping the old side after another synthetic conflict leaves the completed result unchanged.
  app.state.runners.delete(jobId);
  await app.simulateChunkConflict(jobId, 0);
  const oldConflict = app.candidatesOf(jobId).find((candidate) => !candidate.resolution && candidate.index === 0);
  await app.resolveCandidate(oldConflict.id, 'old');
  assert.equal(app.conversionOf(jobId).status, 'completed');
  assert.equal(app.conversionOf(jobId).finalHash, conv.finalHash);
});
