import test from 'node:test';
import assert from 'node:assert/strict';
import { TagEngine } from '../src/chain/index.js';
import {
  R_NUM,
  R_WORD,
  R_PLURAL,
  R_VAR,
  R_AFTER_VAR,
  R_AFTER_NUM,
  R_KEY,
  R_GHOST,
  R_CYCLE_C,
  R_CYCLE_D,
  scenarios,
} from '../samples/scenarios.js';

function snapshot(eng) {
  const r = eng.report();
  return {
    positions: r.positions,
    conflicts: r.conflicts,
    unconverged: r.unconverged,
    dangling: r.dangling,
    cycles: r.cycles,
  };
}

function assertLocalEqualsFull(eng, msg = '局部重推与整体重推必须一致') {
  const before = snapshot(eng);
  eng.recomputeAll();
  assert.deepStrictEqual(snapshot(eng), before, msg);
}

function byId(eng, id) {
  return eng.report().positions.find((p) => p.position === id);
}

test('乱序到达按 (来源, 顺序) 装配，与到达先后无关', () => {
  const eng = new TagEngine();
  eng.upsertRule(R_NUM);
  eng.upsertRule(R_WORD);
  eng.upsertRule(R_PLURAL);
  eng.submitFragment({ source: 'cam1', seq: 2, revision: 0, text: 's' });
  eng.submitFragment({ source: 'cam1', seq: 0, revision: 0, text: 'ab' });
  eng.submitFragment({ source: 'cam1', seq: 1, revision: 0, text: '3' });
  const text = eng.positions().map((p) => p.char).join('');
  assert.equal(text, 'ab3s');
  assert.deepEqual(
    eng.positions().map((p) => p.id),
    ['cam1#0@0', 'cam1#0@1', 'cam1#1@0', 'cam1#2@0']
  );
});

test('同一位置重复提交：幂等忽略，不改变结果', () => {
  const eng = new TagEngine();
  eng.upsertRule(R_WORD);
  eng.submitFragment({ source: 'cam1', seq: 0, revision: 0, text: 'a' });
  const before = snapshot(eng);
  const res = eng.submitFragment({ source: 'cam1', seq: 0, revision: 0, text: 'a' });
  assert.equal(res.kind, 'duplicate');
  assert.equal(res.rederived, 0);
  assert.deepStrictEqual(snapshot(eng), before);
  assert.ok(eng.report().events.some((e) => e.type === 'duplicate-ignored'));
});

test('同版本不同内容的重复提交被拒绝且可观察，不静默择一', () => {
  const eng = new TagEngine();
  eng.upsertRule(R_WORD);
  eng.upsertRule(R_NUM);
  eng.submitFragment({ source: 'cam1', seq: 0, revision: 0, text: 'a' });
  const res = eng.submitFragment({ source: 'cam1', seq: 0, revision: 0, text: '5' });
  assert.equal(res.kind, 'conflicting-duplicate');
  assert.equal(res.rederived, 0);
  assert.equal(byId(eng, 'cam1#0@0').finalTag, 'WORD');
  assert.ok(eng.report().events.some((e) => e.type === 'conflicting-duplicate-rejected'));
});

test('过期版本提交被拒绝（stale-rejected）', () => {
  const eng = new TagEngine();
  eng.upsertRule(R_WORD);
  eng.submitFragment({ source: 'cam1', seq: 0, revision: 2, text: 'ab' });
  const res = eng.submitFragment({ source: 'cam1', seq: 0, revision: 1, text: 'cd' });
  assert.equal(res.kind, 'stale');
  assert.equal(eng.positions().map((p) => p.char).join(''), 'ab');
  assert.ok(eng.report().events.some((e) => e.type === 'stale-rejected'));
});

test('中途修正只重推受影响位置，下游沿依赖联动', () => {
  const eng = new TagEngine();
  eng.upsertRule(R_NUM);
  eng.upsertRule(R_WORD);
  eng.upsertRule(R_PLURAL);
  eng.submitFragment({ source: 'cam1', seq: 0, revision: 0, text: 'ab' });
  eng.submitFragment({ source: 'cam1', seq: 1, revision: 0, text: '3' });
  eng.submitFragment({ source: 'cam1', seq: 2, revision: 0, text: 's' });
  assert.equal(byId(eng, 'cam1#2@0').finalTag, 'WORD');

  const r = eng.submitFragment({ source: 'cam1', seq: 1, revision: 1, text: 'c' });
  // 只有被修正的 c 位置与下游 s 位置参与重推，a/b 不重推
  assert.ok(r.rederived <= 3, `重推范围应受限，实际 ${r.rederived}`);
  const sPos = byId(eng, 'cam1#2@0');
  assert.equal(sPos.finalTag, 'PLURAL');
  assert.deepEqual(sPos.propagationPath, [{ position: 'cam1#1@0', tag: 'WORD' }]);
  assertLocalEqualsFull(eng);
});

test('同优先级冲突保留各方依据、finalTag 为空、列入冲突清单', () => {
  const eng = new TagEngine();
  eng.upsertRule(R_WORD);
  eng.upsertRule(R_VAR);
  eng.upsertRule(R_AFTER_VAR);
  eng.submitFragment({ source: 'cam2', seq: 0, revision: 0, text: 'xy' });
  const x = byId(eng, 'cam2#0@0');
  assert.equal(x.status, 'conflict');
  assert.equal(x.finalTag, null);
  assert.equal(x.hits.length, 2);
  assert.deepEqual(x.hits.map((h) => h.ruleId), ['R-VAR', 'R-WORD']);
  assert.deepEqual(eng.report().conflicts, ['cam2#0@0']);
  // 冲突未解，下游不能拿到 VAR
  assert.equal(byId(eng, 'cam2#0@1').finalTag, 'WORD');
});

test('多规则共同作用但结论一致时：标记胜出，全部依据保留', () => {
  const eng = new TagEngine();
  eng.upsertRule(R_KEY); // p5
  eng.upsertRule({ id: 'R-KEY2', priority: 5, scope: null, apply: (p) => (p.char === 'i' ? 'KEY' : null) });
  eng.upsertRule(R_WORD); // p1
  eng.submitFragment({ source: 'cam1', seq: 0, revision: 0, text: 'i' });
  const p = byId(eng, 'cam1#0@0');
  assert.equal(p.status, 'ok');
  assert.equal(p.finalTag, 'KEY');
  assert.equal(p.hits.length, 3);
  assertLocalEqualsFull(eng);
});

test('人工裁决后沿依赖传播到全部下游，且与整体重推一致', () => {
  const eng = new TagEngine();
  eng.upsertRule(R_WORD);
  eng.upsertRule(R_VAR);
  eng.upsertRule(R_AFTER_VAR);
  eng.submitFragment({ source: 'cam2', seq: 0, revision: 0, text: 'xy' });
  const res = eng.adjudicate('cam2#0@0', 'VAR', '人工判定');
  assert.ok(res.accepted);
  const x = byId(eng, 'cam2#0@0');
  assert.equal(x.status, 'adjudicated');
  assert.equal(x.finalTag, 'VAR');
  const y = byId(eng, 'cam2#0@1');
  assert.equal(y.finalTag, 'BOUND');
  assert.deepEqual(y.propagationPath, [{ position: 'cam2#0@0', tag: 'VAR' }]);
  assertLocalEqualsFull(eng);
  // 撤销裁决后恢复冲突中间态，下游回退
  eng.clearAdjudication('cam2#0@0');
  assert.equal(byId(eng, 'cam2#0@0').status, 'conflict');
  assert.equal(byId(eng, 'cam2#0@1').finalTag, 'WORD');
  assertLocalEqualsFull(eng);
});

test('对不存在位置的裁决被拒绝并记录', () => {
  const eng = new TagEngine();
  eng.upsertRule(R_WORD);
  eng.submitFragment({ source: 'cam2', seq: 0, revision: 0, text: 'a' });
  const res = eng.adjudicate('cam2#0@99', 'X', '无效');
  assert.equal(res.accepted, false);
  assert.ok(eng.report().events.some((e) => e.type === 'adjudication-rejected'));
});

test('规则改写：只重推新旧作用域内位置，下游联动，与整体一致', () => {
  const eng = new TagEngine();
  eng.upsertRule(R_NUM);
  eng.upsertRule(R_WORD);
  eng.upsertRule(R_AFTER_NUM);
  eng.submitFragment({ source: 'cam3', seq: 0, revision: 0, text: '一2uxyz' });
  assert.equal(byId(eng, 'cam3#0@0').status, 'untagged');
  assert.equal(byId(eng, 'cam3#0@1').finalTag, 'NUM');

  const r = eng.upsertRule({
    id: 'R-NUM',
    priority: 1,
    scope: { pattern: /[0-9一]/ },
    apply: (pos) => (/[0-9一]/.test(pos.char) ? 'NUM' : null),
  });
  assert.ok(r.rederived < 6, `仅受影响位置应重推，实际 ${r.rederived}`);
  assert.equal(byId(eng, 'cam3#0@0').finalTag, 'NUM');
  assert.equal(byId(eng, 'cam3#0@1').finalTag, 'FOLLOW'); // 下游由 NUM 传播
  assertLocalEqualsFull(eng);
});

test('依赖成环：位置列入未收敛清单并给出环路，不静默产出结论', () => {
  const eng = new TagEngine();
  eng.upsertRule(R_CYCLE_C);
  eng.upsertRule(R_CYCLE_D);
  eng.submitFragment({ source: 'cam4', seq: 0, revision: 0, text: 'cd' });
  const rep = eng.report();
  assert.deepEqual(rep.unconverged, ['cam4#0@0', 'cam4#0@1']);
  assert.ok(rep.positions.every((p) => p.status === 'unconverged'));
  assert.ok(rep.cycles.length >= 1);
  assert.ok(eng.report().events.some((e) => e.type === 'rule-dependency-cycle'));
  // 未收敛是确定的中间状态：整体重推后仍是未收敛
  assertLocalEqualsFull(eng);
});

test('依赖指向不存在的位置：悬空读取如实列出，不崩溃不丢弃', () => {
  const eng = new TagEngine();
  eng.upsertRule(R_WORD);
  eng.upsertRule(R_GHOST);
  eng.submitFragment({ source: 'cam5', seq: 0, revision: 0, text: 'go' });
  const rep = eng.report();
  assert.deepEqual(rep.dangling, [{ reader: 'cam5#0@0', missing: 'void#99@0' }]);
  assert.equal(byId(eng, 'cam5#0@0').finalTag, 'HAUNTED');
  assertLocalEqualsFull(eng);
});

test('作用范围部分重叠：重叠位置保留全部候选，域外位置不命中域外规则', () => {
  const eng = new TagEngine();
  eng.upsertRule(R_WORD);
  eng.upsertRule(R_KEY);
  eng.upsertRule(R_NUM);
  eng.submitFragment({ source: 'cam1', seq: 0, revision: 0, text: 'i7' });
  eng.submitFragment({ source: 'cam9', seq: 0, revision: 0, text: 'i' });
  const iCam1 = byId(eng, 'cam1#0@0');
  assert.deepEqual(iCam1.hits.map((h) => h.ruleId), ['R-KEY', 'R-WORD']);
  assert.equal(iCam1.finalTag, 'KEY');
  const iCam9 = byId(eng, 'cam9#0@0');
  assert.deepEqual(iCam9.hits.map((h) => h.ruleId), ['R-WORD']);
  assertLocalEqualsFull(eng);
});

test('全部样例场景：每一步变更后局部重推都与整体重推一致', () => {
  for (const make of scenarios) {
    const { name, eng, steps } = make();
    for (const [label, fn] of steps) {
      fn();
      assertLocalEqualsFull(eng, `场景「${name}」步骤「${label}」不一致`);
    }
  }
});

test('最终标记与依据自洽：胜出标记必属于该位置命中候选或人工裁决', () => {
  for (const make of scenarios) {
    const { name, eng, steps } = make();
    for (const [, fn] of steps) {
      fn();
      for (const p of eng.report().positions) {
        if (p.status === 'adjudicated') {
          assert.equal(p.finalTag, p.override.tag, name);
        } else if (p.status === 'ok') {
          assert.ok(p.hits.some((h) => h.tag === p.finalTag), `${name} ${p.position}`);
        } else if (p.status === 'conflict' || p.status === 'unconverged') {
          assert.equal(p.finalTag, null, `${name} ${p.position} 未裁决前不应有静默结论`);
        }
      }
    }
  }
});
