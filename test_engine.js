/* 引擎测试：node test_engine.js */
'use strict';
const E = require('./engine.js');

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name); }
}
function canon(o) {
  if (Array.isArray(o)) return '[' + o.map(canon).join(',') + ']';
  if (o && typeof o === 'object') {
    return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
  }
  return JSON.stringify(o);
}

// 1. 基本推导与缺口归属
{
  const s = { decisions: {},
    materials: [{ id: 'A', name: 'A', source: 's', arrival: 10 }, { id: 'B', name: 'B', source: 's', arrival: 3 }],
    subs: [],
    products: [{ id: 'P', name: 'P', minOutput: 5, ingredients: [{ material: 'A', qty: 2 }, { material: 'B', qty: 1 }] }] };
  const r = E.fullAnalysis(s);
  check('shortage: gap on B, feasible 3', r.products.P.status === 'shortage' &&
    r.products.P.feasibleOutput === 3 && r.products.P.ingredients.find(i => i.material === 'B').gap === 2);
  s.materials[0].arrival = 7;
  const r2 = E.fullAnalysis(s);
  const row = r2.products.P.ingredients.find(i => i.material === 'A');
  check('shortage: gap on A', r2.products.P.status === 'shortage' && row.gap === 3 && row.demand === 10);
}

// 2. 替代链供给累加
{
  const s = { decisions: {},
    materials: [{ id: 'A', arrival: 4 }, { id: 'B', arrival: 6 }, { id: 'C', arrival: 5 }],
    subs: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }],
    products: [{ id: 'P', minOutput: 3, ingredients: [{ material: 'A', qty: 5 }] }] };
  const r = E.fullAnalysis(s);
  check('chain supply 4+6+5=15', r.products.P.status === 'ok' && r.products.P.ingredients[0].supply === 15);
}

// 3. 替代环 -> 不可信
{
  const s = { decisions: {},
    materials: [{ id: 'A', arrival: 4 }, { id: 'B', arrival: 6 }],
    subs: [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }],
    products: [{ id: 'P', minOutput: 1, ingredients: [{ material: 'A', qty: 1 }] },
               { id: 'Q', minOutput: 1, ingredients: [{ material: 'B', qty: 1 }] }] };
  const r = E.fullAnalysis(s);
  check('cycle -> untrusted P,Q', r.products.P.status === 'untrusted' && r.products.Q.status === 'untrusted');
  check('cycle issue reported', r.materials.A.issues.some(i => i.type === 'cycle'));
}

// 4. 指向不存在物料 -> 不可信，不静默跳过
{
  const s = { decisions: {},
    materials: [{ id: 'A', arrival: 4 }],
    subs: [{ from: 'A', to: 'GHOST' }],
    products: [{ id: 'P', minOutput: 1, ingredients: [{ material: 'A', qty: 1 }] }] };
  const r = E.fullAnalysis(s);
  check('missing target -> untrusted', r.products.P.status === 'untrusted');
  check('missing issue reported', r.materials.A.issues.some(i => i.type === 'missing'));
}

// 5. 多路径保留依据 + 裁决后更新
{
  const s = { decisions: {},
    materials: [{ id: 'A', arrival: 2 }, { id: 'B', arrival: 20 }, { id: 'C', arrival: 1 }],
    subs: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }],
    products: [{ id: 'P', minOutput: 2, ingredients: [{ material: 'A', qty: 5 }] }] };
  let r = E.fullAnalysis(s);
  check('branch -> pending', r.products.P.status === 'pending');
  check('both paths kept', r.materials.A.paths.length === 2 &&
    r.materials.A.paths.map(p => p.supply).sort((x, y) => x - y).join(',') === '3,22');
  s.decisions.A = 'C';
  r = E.incrementalAnalysis(s, r, ['A']);
  check('decide C -> shortage', r.products.P.status === 'shortage' && r.products.P.ingredients[0].supply === 3);
  s.decisions.A = 'B';
  r = E.incrementalAnalysis(s, r, ['A']);
  check('decide B -> ok', r.products.P.status === 'ok' && r.products.P.ingredients[0].supply === 22);
}

// 6. 增量重推与整体重推一致性（随机变更序列）
{
  let seed = 20260924;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  let incOk = true;
  for (let trial = 0; trial < 30; trial++) {
    const mids = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5'];
    const state = { decisions: {},
      materials: mids.map(id => ({ id, arrival: Math.floor(rnd() * 50) })),
      subs: [],
      products: ['P0', 'P1', 'P2'].map(id => ({ id, minOutput: 1 + Math.floor(rnd() * 10),
        ingredients: [{ material: pick(mids.concat(['NOPE'])), qty: 1 + Math.floor(rnd() * 3) }] })) };
    for (let i = 0; i < 4; i++) state.subs.push({ from: pick(mids), to: pick(mids.concat(['GHOST'])) });
    let prev = E.fullAnalysis(state);
    for (let step = 0; step < 60; step++) {
      const op = Math.floor(rnd() * 4);
      let changed;
      if (op === 0) { const m = pick(state.materials); m.arrival = Math.floor(rnd() * 60); changed = [m.id]; }
      else if (op === 1) { const f = pick(mids); state.subs.push({ from: f, to: pick(mids.concat(['GHOST'])) }); changed = [f]; }
      else if (op === 2 && state.subs.length) { const e = state.subs.splice(Math.floor(rnd() * state.subs.length), 1)[0]; changed = [e.from]; }
      else { const n = pick(mids); if (rnd() < 0.5) state.decisions[n] = pick(mids); else delete state.decisions[n]; changed = [n]; }
      const inc = E.incrementalAnalysis(state, prev, changed);
      const full = E.fullAnalysis(state);
      const a = canon(inc.products), b = canon(full.products);
      if (a !== b || canon(inc.materials) !== canon(full.materials)) {
        incOk = false;
        console.log('FAIL incremental==full trial=' + trial + ' step=' + step + ' op=' + op);
        console.log('  inc : ' + a.slice(0, 300));
        console.log('  full: ' + b.slice(0, 300));
        step = 999; trial = 999;
        break;
      }
      prev = inc;
    }
  }
  check('incremental == full (30 trials x 60 steps)', incOk);
}

console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
