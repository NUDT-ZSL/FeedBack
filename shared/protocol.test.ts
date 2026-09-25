/**
 * shared/protocol.ts 核心协作编辑逻辑的离线验证。
 * 运行方式：node --test shared/protocol.test.ts（Node >= 22.6，无需浏览器或 WebSocket）。
 * 覆盖四类风险：操作变换收敛性、版本向量比较、操作应用校验、差异提取还原。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOperation,
  applyOperationStrict,
  compareVersions,
  compareVersionVectors,
  operationFromDiff,
  OperationApplyError,
  transformOperation,
  validateOperation,
  type TextOperation,
} from './protocol.ts';

let opSeq = 0;
function makeOp(partial: Partial<TextOperation> & Pick<TextOperation, 'type' | 'position'>): TextOperation {
  opSeq += 1;
  return {
    id: `test_op_${opSeq}`,
    timestamp: opSeq,
    userId: 'user-a',
    baseVersion: 0,
    ...partial,
  };
}

function ins(position: number, text: string, userId = 'ua', timestamp = 1): TextOperation {
  return makeOp({ type: 'insert', position, text, userId, timestamp });
}

function del(position: number, length: number, userId = 'ua', timestamp = 1): TextOperation {
  return makeOp({ type: 'delete', position, length, userId, timestamp });
}

function rep(position: number, length: number, text: string, userId = 'ua', timestamp = 1): TextOperation {
  return makeOp({ type: 'replace', position, length, text, userId, timestamp });
}

/** 确定性伪随机数（LCG），保证失败可复现。 */
function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * 收敛性断言：并发操作 A、B 基于同一内容，
 * 「先应用 A 再应用变换后的 B」必须与「先应用 B 再应用变换后的 A」得到同一内容。
 */
function assertConverges(label: string, base: string, a: TextOperation, b: TextOperation, expected?: string): void {
  const bAfterA = transformOperation(b, a);
  const aAfterB = transformOperation(a, b);
  assert.ok(bAfterA, `${label}: B 相对 A 变换结果不应为 null`);
  assert.ok(aAfterB, `${label}: A 相对 B 变换结果不应为 null`);

  let pathA = '';
  let pathB = '';
  try {
    pathA = applyOperation(applyOperation(base, a), bAfterA!);
  } catch (err) {
    assert.fail(`${label}: 路径 A→B' 应用失败: ${(err as Error).message}`);
  }
  try {
    pathB = applyOperation(applyOperation(base, b), aAfterB!);
  } catch (err) {
    assert.fail(`${label}: 路径 B→A' 应用失败: ${(err as Error).message}`);
  }
  assert.equal(
    pathA,
    pathB,
    `${label}: 双向变换未收敛，A→B'=${JSON.stringify(pathA)}，B→A'=${JSON.stringify(pathB)}`,
  );
  if (expected !== undefined) {
    assert.equal(pathA, expected, `${label}: 合并结果与预期串行结果不一致`);
  }
}

describe('版本向量比较', () => {
  test('双方相等（含键缺失视为 0 的情形）', () => {
    assert.equal(compareVersionVectors({ u1: 1, u2: 2 }, { u1: 1, u2: 2 }), 'equal');
    assert.equal(compareVersionVectors({ u1: 1 }, { u1: 1, u2: 0 }), 'equal', '缺失键应视为 0');
    assert.equal(compareVersionVectors({}, {}), 'equal', '空向量相等');
    assert.equal(compareVersions({ u1: 1 }, { u1: 1 }), 0);
  });

  test('一方严格领先 / 落后', () => {
    assert.equal(compareVersionVectors({ u1: 2, u2: 1 }, { u1: 1, u2: 1 }), 'ahead');
    assert.equal(compareVersionVectors({ u1: 1, u2: 1 }, { u1: 2, u2: 1 }), 'behind');
    assert.equal(compareVersionVectors({ u1: 3 }, {}), 'ahead', '对空向量严格领先');
    assert.equal(compareVersionVectors({}, { u2: 1 }), 'behind');
    assert.equal(compareVersions({ u1: 2 }, { u1: 1 }), 1);
    assert.equal(compareVersions({ u1: 1 }, { u1: 2 }), -1);
  });

  test('并发分支不能被误判为领先、落后或相等', () => {
    const a = { u1: 2, u2: 1 };
    const b = { u1: 1, u2: 2 };
    assert.equal(compareVersionVectors(a, b), 'concurrent', '互有领先分量应判定为并发');
    assert.equal(compareVersionVectors(b, a), 'concurrent', '并发关系应对称');
    assert.equal(compareVersionVectors({ u1: 1 }, { u2: 1 }), 'concurrent', '互不相干的键也是并发');
    // 数值形式下并发返回 0，但绝不能被当成领先/落后
    assert.equal(compareVersions(a, b), 0);
    assert.notEqual(compareVersionVectors(a, b), 'equal', '并发不是相等');
    assert.notEqual(compareVersionVectors(a, b), 'ahead', '并发不是领先');
    assert.notEqual(compareVersionVectors(a, b), 'behind', '并发不是落后');
  });
});

describe('操作变换收敛性', () => {
  test('并发插入：不同位置', () => {
    assertConverges('插入-不同位置', 'hello', ins(1, 'X', 'ua', 1), ins(4, 'Y', 'ub', 2), 'hXellYo');
    assertConverges('插入-边界', 'ab', ins(0, 'X', 'ua', 1), ins(2, 'Y', 'ub', 2), 'XabY');
  });

  test('并发插入：同一位置按确定性优先级排序', () => {
    // ua 时间戳更小，优先级更高，ua 的文本在前
    assertConverges('插入-同位置', 'ab', ins(1, 'X', 'ua', 1), ins(1, 'Y', 'ub', 2), 'aXYb');
    // 交换时间戳后顺序随之反转，两端仍收敛
    assertConverges('插入-同位置-反序', 'ab', ins(1, 'X', 'ua', 2), ins(1, 'Y', 'ub', 1), 'aYXb');
    // 时间戳相同时按 userId 决胜
    assertConverges('插入-同位置-同时间戳', 'ab', ins(1, 'X', 'ua', 1), ins(1, 'Y', 'ub', 1), 'aXYb');
  });

  test('并发删除：不相交 / 相邻 / 部分重叠 / 包含 / 相同', () => {
    assertConverges('删除-不相交', 'abcdef', del(1, 1, 'ua', 1), del(4, 1, 'ub', 2), 'acdf');
    assertConverges('删除-相邻', 'abcde', del(1, 2, 'ua', 1), del(3, 2, 'ub', 2), 'a');
    assertConverges('删除-部分重叠', 'abcdef', del(1, 3, 'ua', 1), del(3, 3, 'ub', 2), 'a');
    assertConverges('删除-包含', 'abcdef', del(1, 4, 'ua', 1), del(2, 1, 'ub', 2), 'af');
    assertConverges('删除-相同范围', 'abcdef', del(2, 2, 'ua', 1), del(2, 2, 'ub', 2), 'abef');
  });

  test('插入与删除交错：插入落在删除区间内被删除吸收', () => {
    assertConverges('插入-删除区间内', 'abcdef', del(2, 3, 'ua', 1), ins(3, 'X', 'ub', 2), 'abf');
    assertConverges('插入-删除区间起点', 'abcdef', del(2, 3, 'ua', 1), ins(2, 'X', 'ub', 2), 'abf');
    assertConverges('插入-删除区间终点', 'abcdef', del(2, 3, 'ua', 1), ins(5, 'X', 'ub', 2), 'abXf');
  });

  test('插入与删除交错：区间外正常平移', () => {
    assertConverges('插入在删除之前', 'abcdef', del(3, 2, 'ua', 1), ins(1, 'X', 'ub', 2), 'aXbcf');
    assertConverges('插入在删除之后', 'abcdef', del(1, 2, 'ua', 1), ins(5, 'X', 'ub', 2), 'adeXf');
  });

  test('替换与插入/删除交错', () => {
    assertConverges('替换吸收起点处插入', 'abcdef', rep(2, 2, 'R', 'ua', 1), ins(2, 'X', 'ub', 2), 'abRef');
    assertConverges('替换吸收区间内插入', 'abcdef', rep(2, 2, 'R', 'ua', 1), ins(3, 'X', 'ub', 2), 'abRef');
    assertConverges('替换与区间后插入', 'abcdef', rep(2, 2, 'R', 'ua', 1), ins(5, 'Y', 'ub', 2), 'abReYf');
    assertConverges('替换与区间前插入', 'abcdef', rep(2, 2, 'R', 'ua', 1), ins(1, 'Y', 'ub', 2), 'aYbRef');
    assertConverges('替换与相邻删除', 'abcdefg', rep(2, 2, 'R', 'ua', 1), del(4, 2, 'ub', 2), 'abRg');
    assertConverges('替换与不相交替换', 'abcde', rep(0, 1, 'X', 'ua', 1), rep(4, 1, 'Y', 'ub', 2), 'XbcdY');
  });

  test('同一操作 id 变换返回 null（去重语义）', () => {
    const op = ins(1, 'X');
    assert.equal(transformOperation(op, op), null);
  });

  test('模糊测试：随机并发插入/删除对双向收敛（确定性种子）', () => {
    const rng = createRng(20260926);
    const alphabet = 'abc';
    for (let i = 0; i < 1000; i++) {
      const baseLen = Math.floor(rng() * 21);
      let base = '';
      for (let j = 0; j < baseLen; j++) base += alphabet[Math.floor(rng() * alphabet.length)];

      const randomOp = (userId: string): TextOperation => {
        // 时间戳取自小集合以强制出现同值，触发优先级决胜分支
        const ts = 1 + Math.floor(rng() * 2);
        if (baseLen === 0 || rng() < 0.5) {
          const pos = Math.floor(rng() * (baseLen + 1));
          const text = alphabet[Math.floor(rng() * alphabet.length)];
          return ins(pos, text, userId, ts);
        }
        const pos = Math.floor(rng() * baseLen);
        const len = 1 + Math.floor(rng() * (baseLen - pos));
        return del(pos, len, userId, ts);
      };

      const a = randomOp('u1');
      const b = randomOp('u2');
      assertConverges(`fuzz#${i} base=${JSON.stringify(base)}`, base, a, b);
    }
  });

  test('差异操作按原始顺序串行应用可逐步还原每个版本', () => {
    const versions = ['', 'hello', 'hello world', 'hello brave world', 'brave new world', ''];
    let content = versions[0];
    for (let i = 1; i < versions.length; i++) {
      const op = operationFromDiff(content, versions[i], 'user-x', i - 1);
      assert.ok(op, `版本 ${i}: '${content}' → '${versions[i]}' 应生成操作`);
      content = applyOperation(content, op!);
      assert.equal(content, versions[i], `版本 ${i}: 串行应用结果与目标不一致`);
    }
  });
});

describe('操作应用校验', () => {
  test('合法操作正常应用（含边界位置）', () => {
    assert.equal(applyOperation('abc', ins(0, 'X')), 'Xabc', '头部插入');
    assert.equal(applyOperation('abc', ins(3, 'X')), 'abcX', '尾部插入（position == 长度）');
    assert.equal(applyOperation('abc', del(0, 3)), '', '整段删除');
    assert.equal(applyOperation('abc', rep(1, 1, 'Y')), 'aYc', '中间替换');
    assert.equal(applyOperation('', ins(0, 'X')), 'X', '空文本插入');
    assert.equal(applyOperation('abc', ins(1, '')), 'abc', '空插入是合法空操作');
  });

  test('位置越界必须明确失败', () => {
    assert.throws(
      () => applyOperation('abc', ins(4, 'X')),
      (err: unknown) => err instanceof OperationApplyError && /越界/.test((err as Error).message),
      '插入位置超出内容长度应抛出越界错误',
    );
    assert.throws(
      () => applyOperation('abc', del(2, 5)),
      (err: unknown) => err instanceof OperationApplyError && /越界/.test((err as Error).message),
      '删除范围超出内容长度应抛出越界错误',
    );
    assert.throws(
      () => applyOperation('abc', rep(3, 1, 'X')),
      (err: unknown) => err instanceof OperationApplyError && /越界/.test((err as Error).message),
      '替换范围超出内容长度应抛出越界错误',
    );
    assert.throws(
      () => applyOperation('abc', makeOp({ type: 'insert', position: -1, text: 'X' })),
      (err: unknown) => err instanceof OperationApplyError && /非法/.test((err as Error).message),
      '负数位置应抛出非法错误',
    );
    assert.throws(
      () => validateOperation('abc', makeOp({ type: 'delete', position: 1.5, length: 1 })),
      /非法/,
      '非整数位置应抛出非法错误',
    );
  });

  test('版本不匹配必须明确失败', () => {
    const op = makeOp({ type: 'insert', position: 0, text: 'X', baseVersion: 3 });
    assert.throws(
      () => applyOperationStrict('abc', op, { localVersion: 2 }),
      (err: unknown) => err instanceof OperationApplyError && /版本不匹配/.test((err as Error).message),
      'baseVersion 与本地版本不一致应抛出版本不匹配',
    );
    assert.equal(
      applyOperationStrict('abc', op, { localVersion: 3 }),
      'Xabc',
      '版本一致时应正常应用',
    );
  });

  test('操作携带的版本向量与本地状态矛盾必须明确失败', () => {
    const op = makeOp({ type: 'insert', position: 0, text: 'X', baseVersion: 2 });
    const localVector = { u1: 1, u2: 1 };

    assert.throws(
      () => applyOperationStrict('abc', op, { localVersion: 2, localVector, operationVector: { u1: 2, u2: 1 } }),
      (err: unknown) => err instanceof OperationApplyError && /矛盾/.test((err as Error).message),
      '操作向量领先于本地（本地缺少前置操作）应失败',
    );
    assert.throws(
      () => applyOperationStrict('abc', op, { localVersion: 2, localVector, operationVector: { u1: 1, u2: 2 } }),
      /矛盾/,
      '操作向量与本地并发应失败',
    );
    assert.throws(
      () => applyOperationStrict('abc', op, { localVersion: 2, localVector, operationVector: { u1: 1 } }),
      /矛盾/,
      '操作向量落后于本地应失败',
    );
    assert.equal(
      applyOperationStrict('abc', op, { localVersion: 2, localVector, operationVector: { u1: 1, u2: 1 } }),
      'Xabc',
      '向量一致时应正常应用',
    );
  });
});

describe('差异提取还原', () => {
  const roundTrip = (label: string, oldContent: string, newContent: string) => {
    const op = operationFromDiff(oldContent, newContent, 'user-d', 0);
    assert.ok(op, `${label}: 应生成操作`);
    assert.equal(
      applyOperation(oldContent, op!),
      newContent,
      `${label}: 差异操作应用回原文本必须还原目标文本`,
    );
    return op!;
  };

  test('无差异时返回 null', () => {
    assert.equal(operationFromDiff('', '', 'u', 0), null, '空对空');
    assert.equal(operationFromDiff('abc', 'abc', 'u', 0), null, '相同文本');
  });

  test('首尾插入', () => {
    const head = roundTrip('头部插入', 'abc', 'XYZabc');
    assert.equal(head.type, 'insert');
    assert.equal(head.position, 0);
    const tail = roundTrip('尾部插入', 'abc', 'abcXYZ');
    assert.equal(tail.type, 'insert');
    assert.equal(tail.position, 3);
    roundTrip('空文本插入', '', 'abc');
  });

  test('纯删除', () => {
    roundTrip('头部删除', 'abcdef', 'def');
    roundTrip('尾部删除', 'abcdef', 'abc');
    roundTrip('中间删除', 'abcdef', 'abf');
    const all = roundTrip('删除为空', 'abc', '');
    assert.equal(all.type, 'delete');
    assert.equal(all.length, 3);
  });

  test('中间替换', () => {
    const mid = roundTrip('中间替换', 'abcde', 'abXYe');
    assert.equal(mid.type, 'replace');
    assert.equal(mid.position, 2);
    roundTrip('替换为更长文本', 'abc', 'aXYZc');
    roundTrip('整体替换', 'abc', 'xyz');
    roundTrip('重复字符前缀', 'aaa', 'a');
    roundTrip('重复字符后缀', 'aaa', 'aa');
  });

  test('模糊测试：随机文本对差异往返还原（确定性种子）', () => {
    const rng = createRng(20260926);
    const alphabet = 'ab \n';
    const randomText = () => {
      const len = Math.floor(rng() * 31);
      let s = '';
      for (let i = 0; i < len; i++) s += alphabet[Math.floor(rng() * alphabet.length)];
      return s;
    };
    for (let i = 0; i < 1000; i++) {
      const oldText = randomText();
      const newText = randomText();
      const op = operationFromDiff(oldText, newText, 'user-f', i);
      if (oldText === newText) {
        assert.equal(op, null, `fuzz#${i}: 相同文本不应生成操作`);
      } else {
        assert.ok(op, `fuzz#${i}: 不同文本应生成操作`);
        assert.equal(
          applyOperation(oldText, op!),
          newText,
          `fuzz#${i}: 往返还原失败 old=${JSON.stringify(oldText)} new=${JSON.stringify(newText)}`,
        );
      }
    }
  });
});
