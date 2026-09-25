/**
 * Offline verification for the collaborative-editing core logic in
 * shared/protocol.ts. Runs with the built-in Node test runner:
 *   node --test tests/protocol.test.ts
 * No WebSocket, browser, or network is involved.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOperation,
  applyOperationAtState,
  compareVersions,
  compareVersionVectors,
  operationFromDiff,
  transformOperation,
  OperationApplyError,
} from '../shared/protocol.ts';
import type { OpType, TextOperation } from '../shared/protocol.ts';

let opCounter = 0;

function makeOp(partial: Partial<TextOperation> & { type: OpType }): TextOperation {
  opCounter += 1;
  return {
    id: `op_${opCounter}`,
    position: 0,
    timestamp: opCounter,
    userId: 'user',
    baseVersion: 0,
    ...partial,
  };
}

function insert(at: number, text: string, extra: Partial<TextOperation> = {}): TextOperation {
  return makeOp({ type: 'insert', position: at, text, ...extra });
}

function del(at: number, length: number, extra: Partial<TextOperation> = {}): TextOperation {
  return makeOp({ type: 'delete', position: at, length, ...extra });
}

/**
 * Simulate two replicas that both start from `base`: each applies its own
 * op first, then the peer's op transformed against it. TP1 requires both
 * replicas to converge on identical content.
 */
function converge(base: string, a: TextOperation, b: TextOperation): { sideA: string; sideB: string } {
  const bAgainstA = transformOperation(b, a);
  const aAgainstB = transformOperation(a, b);
  const afterA = applyOperation(base, a);
  const afterB = applyOperation(base, b);
  return {
    sideA: bAgainstA === null ? afterA : applyOperation(afterA, bAgainstA),
    sideB: aAgainstB === null ? afterB : applyOperation(afterB, aAgainstB),
  };
}

function assertConverges(base: string, a: TextOperation, b: TextOperation, expected?: string): string {
  const { sideA, sideB } = converge(base, a, b);
  assert.equal(
    sideA,
    sideB,
    `transform divergence on "${base}": A=${JSON.stringify(a)} B=${JSON.stringify(b)} ` +
      `produced "${sideA}" vs "${sideB}"`,
  );
  if (expected !== undefined) {
    assert.equal(sideA, expected, `converged content differs from the serial-order expectation`);
  }
  return sideA;
}

describe('compareVersionVectors / compareVersions', () => {
  test('equal vectors, including empty ones', () => {
    assert.equal(compareVersionVectors({}, {}), 'equal');
    assert.equal(compareVersionVectors({ a: 1 }, { a: 1 }), 'equal');
    assert.equal(compareVersionVectors({ a: 2, b: 3 }, { b: 3, a: 2 }), 'equal');
    assert.equal(compareVersions({ a: 2, b: 3 }, { b: 3, a: 2 }), 0);
  });

  test('one side strictly ahead', () => {
    assert.equal(compareVersionVectors({ a: 2 }, { a: 1 }), 'ahead');
    assert.equal(compareVersionVectors({ a: 1, b: 1 }, { a: 1 }), 'ahead');
    assert.equal(compareVersions({ a: 2 }, { a: 1 }), 1);
  });

  test('one side strictly behind', () => {
    assert.equal(compareVersionVectors({ a: 1 }, { a: 2 }), 'behind');
    assert.equal(compareVersionVectors({ a: 1 }, { a: 1, b: 1 }), 'behind');
    assert.equal(compareVersions({ a: 1 }, { a: 2 }), -1);
  });

  test('concurrent branches are neither equal nor ahead/behind', () => {
    // disjoint users
    assert.equal(compareVersionVectors({ a: 1 }, { b: 1 }), 'concurrent');
    // same users, mixed progress
    assert.equal(compareVersionVectors({ a: 2, b: 1 }, { a: 1, b: 2 }), 'concurrent');
    // the numeric comparator collapses concurrent to 0, so callers must not
    // mistake that 0 for equality
    assert.equal(compareVersions({ a: 1 }, { b: 1 }), 0);
    assert.notEqual(compareVersionVectors({ a: 1 }, { b: 1 }), 'equal');
    assert.notEqual(compareVersionVectors({ a: 1 }, { b: 1 }), 'ahead');
    assert.notEqual(compareVersionVectors({ a: 1 }, { b: 1 }), 'behind');
  });
});

describe('transformOperation convergence', () => {
  test('duplicate op id transforms to null', () => {
    const a = insert(1, 'x', { id: 'same' });
    const b = insert(2, 'y', { id: 'same' });
    assert.equal(transformOperation(a, b), null);
  });

  test('concurrent inserts at different positions', () => {
    assertConverges('hello', insert(0, 'A'), insert(5, 'B'), 'AhelloB');
    assertConverges('hello', insert(5, 'B'), insert(0, 'A'), 'AhelloB');
    assertConverges('', insert(0, 'A'), insert(0, 'B', { timestamp: 0 }), 'BA');
  });

  test('concurrent inserts at the same position use a deterministic tie-break', () => {
    // later timestamp sorts after
    const a = insert(2, 'A', { timestamp: 2 });
    const b = insert(2, 'B', { timestamp: 1 });
    assertConverges('hello', a, b, 'heBAllo');
    // equal timestamps fall back to op id
    const c = insert(2, 'C', { id: 'a_op', timestamp: 1 });
    const d = insert(2, 'D', { id: 'b_op', timestamp: 1 });
    assertConverges('hello', c, d, 'heCDllo');
  });

  test('concurrent deletes: non-overlapping, overlapping, contained, identical', () => {
    assertConverges('abcdef', del(0, 1), del(4, 1), 'bcdf');
    assertConverges('abcdef', del(1, 3), del(3, 3), 'a');
    assertConverges('abcdef', del(1, 4), del(2, 1), 'af');
    assertConverges('abcdef', del(1, 2), del(1, 2), 'adef');
    assertConverges('abc', del(0, 3), del(0, 3), '');
  });

  test('insert vs delete: before, after, at start, at end', () => {
    assertConverges('abcdef', insert(1, 'X'), del(3, 2), 'aXbcf');
    assertConverges('abcdef', insert(5, 'X'), del(1, 2), 'adeXf');
    assertConverges('abcdef', insert(1, 'X'), del(1, 2), 'aXdef');
    assertConverges('abcdef', insert(3, 'X'), del(1, 2), 'aXdef');
  });

  test('insert strictly inside a deleted range is absorbed', () => {
    assertConverges('abcdef', insert(2, 'X'), del(1, 3), 'aef');
    assertConverges('abcdef', del(1, 3), insert(2, 'X'), 'aef');
  });

  test('delete vs insert strictly inside the delete range expands to absorb it', () => {
    assertConverges('abcdef', del(1, 3), insert(2, 'XY'), 'aef');
  });

  test('replace vs non-overlapping insert and delete', () => {
    const repl = makeOp({ type: 'replace', position: 2, length: 2, text: 'XY' });
    assertConverges('abcdef', repl, insert(0, 'Q'), 'QabXYef');
    const repl2 = makeOp({ type: 'replace', position: 1, length: 4, text: 'Z' });
    assertConverges('abcdef', del(2, 1), repl2, 'aZf');
  });

  test('insert inside a replaced range is absorbed by the replacement', () => {
    const repl = makeOp({ type: 'replace', position: 1, length: 3, text: 'Z' });
    assertConverges('abcdef', insert(2, 'X'), repl, 'aZef');
  });
});

function assertApplyError(fn: () => unknown, code: string): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof OperationApplyError, `expected OperationApplyError, got ${String(err)}`);
    assert.equal((err as OperationApplyError).code, code);
    return true;
  });
}

describe('applyOperation explicit failures', () => {
  test('valid operations apply correctly', () => {
    assert.equal(applyOperation('hello', insert(5, '!')), 'hello!');
    assert.equal(applyOperation('hello', insert(0, '>')), '>hello');
    assert.equal(applyOperation('hello', del(1, 3)), 'ho');
    assert.equal(
      applyOperation('hello', makeOp({ type: 'replace', position: 1, length: 3, text: 'EL' })),
      'hELo',
    );
    assert.equal(applyOperation('', insert(0, 'x')), 'x');
  });

  test('position beyond content length fails instead of corrupting', () => {
    assertApplyError(() => applyOperation('abc', insert(4, 'x')), 'INVALID_POSITION');
    assertApplyError(() => applyOperation('abc', insert(10, 'x')), 'INVALID_POSITION');
    assertApplyError(() => applyOperation('', insert(1, 'x')), 'INVALID_POSITION');
  });

  test('negative position fails', () => {
    assertApplyError(() => applyOperation('abc', insert(-1, 'x')), 'INVALID_POSITION');
    assertApplyError(() => applyOperation('abc', del(-2, 1)), 'INVALID_POSITION');
  });

  test('delete/replace range past the end fails', () => {
    assertApplyError(() => applyOperation('abc', del(2, 5)), 'INVALID_POSITION');
    assertApplyError(() => applyOperation('abc', del(3, 1)), 'INVALID_POSITION');
    assertApplyError(
      () => applyOperation('abc', makeOp({ type: 'replace', position: 1, length: 3, text: 'x' })),
      'INVALID_POSITION',
    );
  });

  test('malformed operations fail', () => {
    assertApplyError(
      () => applyOperation('abc', makeOp({ type: 'move' as OpType, position: 0 })),
      'INVALID_OPERATION',
    );
    assertApplyError(() => applyOperation('abc', del(0, -1)), 'INVALID_OPERATION');
    assertApplyError(() => applyOperation('abc', insert(1.5, 'x')), 'INVALID_POSITION');
  });
});

describe('applyOperationAtState version/vector checks', () => {
  const state = { version: 5, vector: { alice: 3, bob: 2 } };

  test('matching version applies', () => {
    const op = insert(0, 'x', { baseVersion: 5 });
    assert.equal(applyOperationAtState('abc', op, state, { alice: 3, bob: 2 }), 'xabc');
  });

  test('baseVersion mismatch fails with VERSION_MISMATCH', () => {
    assertApplyError(
      () => applyOperationAtState('abc', insert(0, 'x', { baseVersion: 4 }), state),
      'VERSION_MISMATCH',
    );
    assertApplyError(
      () => applyOperationAtState('abc', insert(0, 'x', { baseVersion: 6 }), state),
      'VERSION_MISMATCH',
    );
  });

  test('op vector ahead of local vector fails with VECTOR_CONFLICT', () => {
    const op = insert(0, 'x', { baseVersion: 5 });
    assertApplyError(
      () => applyOperationAtState('abc', op, state, { alice: 4, bob: 2 }),
      'VECTOR_CONFLICT',
    );
    assertApplyError(
      () => applyOperationAtState('abc', op, state, { alice: 3, bob: 2, carol: 1 }),
      'VECTOR_CONFLICT',
    );
  });

  test('equal, behind, or concurrent op vectors are not contradictions', () => {
    const op = insert(0, 'x', { baseVersion: 5 });
    assert.equal(applyOperationAtState('abc', op, state, { alice: 3, bob: 2 }), 'xabc');
    assert.equal(applyOperationAtState('abc', op, state, { alice: 2, bob: 2 }), 'xabc');
    assert.equal(applyOperationAtState('abc', op, state, { alice: 4, carol: 1 }), 'xabc');
  });
});

function assertDiffRoundTrip(oldContent: string, newContent: string): void {
  const op = operationFromDiff(oldContent, newContent, 'user', 0);
  if (oldContent === newContent) {
    assert.equal(op, null, `expected no op for identical content "${oldContent}"`);
    return;
  }
  assert.ok(op !== null, `expected an op for "${oldContent}" -> "${newContent}"`);
  const applied = applyOperation(oldContent, op);
  assert.equal(
    applied,
    newContent,
    `diff round-trip failed for "${oldContent}" -> "${newContent}" via ${JSON.stringify(op)}`,
  );
}

describe('operationFromDiff round-trip boundaries', () => {
  test('insert at the start', () => assertDiffRoundTrip('world', 'hello world'));
  test('insert at the end', () => assertDiffRoundTrip('hello', 'hello world'));
  test('insert into empty text', () => assertDiffRoundTrip('', 'abc'));
  test('pure delete of everything', () => assertDiffRoundTrip('abc', ''));
  test('delete at the start', () => assertDiffRoundTrip('hello world', 'world'));
  test('delete at the end', () => assertDiffRoundTrip('hello world', 'hello'));
  test('delete in the middle', () => assertDiffRoundTrip('abcdef', 'abef'));
  test('replace in the middle', () => assertDiffRoundTrip('abcdef', 'abXYef'));
  test('replace everything', () => assertDiffRoundTrip('abc', 'xyz'));
  test('empty to empty yields no op', () => assertDiffRoundTrip('', ''));
  test('identical text yields no op', () => assertDiffRoundTrip('same', 'same'));
  test('single character edits', () => {
    assertDiffRoundTrip('a', 'ab');
    assertDiffRoundTrip('ab', 'a');
    assertDiffRoundTrip('a', 'b');
  });
});

/** Deterministic PRNG so fuzz failures reproduce exactly. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomText(rand: () => number, maxLen: number): string {
  const len = Math.floor(rand() * (maxLen + 1));
  let out = '';
  for (let i = 0; i < len; i++) {
    out += 'abcde'[Math.floor(rand() * 5)];
  }
  return out;
}

function randomOp(rand: () => number, contentLen: number): TextOperation {
  const canDelete = contentLen > 0;
  const kind = canDelete && rand() < 0.5 ? 'delete' : 'insert';
  // small timestamp pool to exercise the tie-break paths
  const timestamp = Math.floor(rand() * 3);
  if (kind === 'insert') {
    const at = Math.floor(rand() * (contentLen + 1));
    const text = randomText(rand, 3) || 'x';
    return insert(at, text, { timestamp });
  }
  const at = Math.floor(rand() * contentLen);
  const length = 1 + Math.floor(rand() * (contentLen - at));
  return del(at, length, { timestamp });
}

describe('seeded fuzz: transform convergence (TP1)', () => {
  test('random concurrent insert/delete pairs converge', () => {
    const rand = mulberry32(0xc0ffee);
    for (let i = 0; i < 2000; i++) {
      const base = randomText(rand, 15);
      const a = randomOp(rand, base.length);
      const b = randomOp(rand, base.length);
      assertConverges(base, a, b);
    }
  });
});

describe('seeded fuzz: diff round-trip', () => {
  test('random old/new pairs reproduce the target', () => {
    const rand = mulberry32(0xbad5eed);
    for (let i = 0; i < 2000; i++) {
      assertDiffRoundTrip(randomText(rand, 12), randomText(rand, 12));
    }
  });
});
