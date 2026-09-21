import assert from 'node:assert/strict';
import test from 'node:test';

const core = (await import('../js/core.js')).default;

test('builds ordered bounded segments including a trailing partial segment', () => {
  const chunks = core.buildManifest(130, 64);
  assert.deepEqual(chunks.map((c) => [c.start, c.end, c.length]), [
    [0, 64, 64],
    [64, 128, 64],
    [128, 130, 2]
  ]);
});

test('empty files still have one deterministic zero-length segment', () => {
  const chunks = core.buildManifest(0, 64);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 0);
});

test('locates changed and appended byte ranges', () => {
  const oldData = new Uint8Array([1, 2, 3, 4]).buffer;
  const newData = new Uint8Array([1, 9, 3, 4, 5]).buffer;
  const diff = core.findDifferences(oldData, newData);
  assert.equal(diff.differingBytes, 2);
  assert.deepEqual(diff.ranges, [{ start: 1, end: 2 }, { start: 4, end: 5 }]);
});

test('XOR transformation is deterministic and reversible', () => {
  const data = new Uint8Array([0, 15, 240, 255]).buffer;
  const transformed = core.transformBytes(data);
  assert.deepEqual(Array.from(new Uint8Array(transformed)), [90, 85, 170, 165]);
  assert.deepEqual(Array.from(new Uint8Array(core.transformBytes(transformed))), [0, 15, 240, 255]);
});

test('checkpointed conversion reaches the same aggregate as a full conversion', async () => {
  const file = { size: 5, chunkCount: 5 };
  const chunks = [];
  for (let index = 0; index < 5; index++) {
    const data = new Uint8Array([index + 1, index + 2, index + 3]).buffer;
    const output = core.transformBytes(data);
    chunks.push({
      hash: await core.sha256Bytes(output),
      transformedBytes: output.byteLength
    });
  }

  const full = await core.computeFinalAggregate(file, chunks);
  let aggregate = await core.initialAggregate(file);
  let bytes = 0;
  for (let i = 0; i < 2; i++) {
    aggregate = await core.extendAggregate(aggregate, i, chunks[i].hash, chunks[i].transformedBytes);
    bytes += chunks[i].transformedBytes;
  }

  // Persisted checkpoint at index 2 survives an interruption.
  for (let i = 2; i < chunks.length; i++) {
    aggregate = await core.extendAggregate(aggregate, i, chunks[i].hash, chunks[i].transformedBytes);
    bytes += chunks[i].transformedBytes;
  }

  assert.equal(aggregate, full);
  assert.equal(bytes, 15);
});
