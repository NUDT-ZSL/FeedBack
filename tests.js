/**
 * 离线验收自检：node tests.js
 * 覆盖需求 1~7。退出码非 0 即失败。
 */
const assert = require('assert');
const EV = require('./engine.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e)); }
}
function group(name, fn) { console.log('\n[' + name + ']'); fn(); }

const fresh = () => EV.createStore(EV.demoState());
const mk = (state) => EV.createStore(state);

/* ---------- 需求 1：假设维护与拒绝 ---------- */
group('需求1 假设维护：空陈述/重复标识必须拒绝并指出位置', () => {
  test('正常登记通过', () => {
    const s = mk(EV.createState());
    const r = EV.act(s, 'ADD_HYPOTHESIS', { id: 'H1', statement: 'X 成立', population: '人群A', segments: '细分1' });
    assert.ok(r.ok);
    assert.strictEqual(s.state.hypotheses[0].segments[0], '细分1');
  });
  test('空陈述被拒绝且指出字段位置', () => {
    const s = mk(EV.createState());
    const r = EV.act(s, 'ADD_HYPOTHESIS', { id: 'H1', statement: '   ', population: '人群A' });
    assert.ok(!r.ok);
    assert.ok(r.errors.some((e) => e.code === 'STATEMENT_EMPTY' && e.message.includes('陈述字段')));
  });
  test('标识缺失被拒绝', () => {
    const s = mk(EV.createState());
    const r = EV.act(s, 'ADD_HYPOTHESIS', { id: '', statement: 'X', population: 'P' });
    assert.ok(r.errors.some((e) => e.code === 'ID_EMPTY'));
  });
  test('重复标识被拒绝且指出是哪条标识', () => {
    const s = fresh();
    const r = EV.act(s, 'ADD_HYPOTHESIS', { id: 'H1', statement: '另一条', population: 'P' });
    assert.ok(!r.ok);
    assert.ok(r.errors.some((e) => e.code === 'ID_DUPLICATE' && e.message.includes('H1')));
  });
  test('空人群被拒绝', () => {
    const s = mk(EV.createState());
    const r = EV.act(s, 'ADD_HYPOTHESIS', { id: 'H9', statement: 'X', population: '' });
    assert.ok(r.errors.some((e) => e.code === 'POPULATION_EMPTY'));
  });
  test('拒绝时状态不发生任何改变', () => {
    const s = fresh();
    const n = s.state.hypotheses.length;
    EV.act(s, 'ADD_HYPOTHESIS', { id: 'H1', statement: '', population: '' });
    assert.strictEqual(s.state.hypotheses.length, n);
  });
});

/* ---------- 需求 2：材料字段缺失必须标记 ---------- */
group('需求2 观察材料：来源/时刻/立场缺失不得默认通过，必须标记并说明原因', () => {
  test('缺来源→登记为 flagged 且说明原因，不计入结论', () => {
    const s = fresh();
    const before = s.results.get('H3').counts.active;
    const r = EV.act(s, 'ADD_EVIDENCE', { hypothesisId: 'H3', sourceId: '', capturedAt: '2026-09-10 10:00', stance: '支持', quality: 'high' });
    assert.ok(!r.ok);
    assert.ok(r.notices.some((m) => m.includes('来源缺失')));
    assert.strictEqual(s.results.get('H3').counts.active, before);
    assert.strictEqual(s.results.get('H3').counts.flagged, s.state.evidence.filter((e) => e.hypothesisId === 'H3' && e.flagged).length);
  });
  test('缺时刻→标记并保留原始输入', () => {
    const s = fresh();
    const r = EV.act(s, 'ADD_EVIDENCE', { hypothesisId: 'H3', sourceId: 'U99', capturedAt: '', stance: '反驳' });
    assert.ok(!r.ok);
    const rec = s.state.evidence.find((e) => e.sourceId === 'U99');
    assert.ok(rec.flagged);
    assert.ok(rec.fieldIssues.some((f) => f.field === 'capturedAt' && f.reason.includes('采集时刻缺失')));
  });
  test('立场缺失或乱填→标记，绝不默认成支持', () => {
    const s = fresh();
    const r = EV.act(s, 'ADD_EVIDENCE', { hypothesisId: 'H3', sourceId: 'U98', capturedAt: '2026-09-10', stance: '' });
    assert.ok(!r.ok);
    const rec = s.state.evidence.find((e) => e.sourceId === 'U98');
    assert.ok(rec.flagged && rec.fieldIssues.some((f) => f.field === 'stance'));
    assert.strictEqual(s.results.get('H3').weights.refute, 0);
  });
  test('非法时刻格式被标记', () => {
    const s = fresh();
    EV.act(s, 'ADD_EVIDENCE', { hypothesisId: 'H3', sourceId: 'U97', capturedAt: '上周三下午', stance: '支持' });
    const rec = s.state.evidence.find((e) => e.sourceId === 'U97');
    assert.ok(rec.flagged);
  });
  test('指向不存在假设→硬拒绝不留存', () => {
    const s = fresh();
    const r = EV.act(s, 'ADD_EVIDENCE', { hypothesisId: 'HX', sourceId: 'U1', capturedAt: '2026-09-10', stance: '支持' });
    assert.ok(!r.ok && r.errors.some((e) => e.code === 'H_UNKNOWN'));
  });
  test('更正补全字段后标记解除并进入结论', () => {
    const s = fresh();
    EV.act(s, 'ADD_EVIDENCE', { hypothesisId: 'H3', sourceId: 'U96', capturedAt: '', stance: '支持' });
    const rec = s.state.evidence.find((e) => e.sourceId === 'U96');
    assert.ok(rec.flagged);
    const r = EV.act(s, 'CORRECT_EVIDENCE', { id: rec.id, capturedAt: '2026-09-12 09:00' });
    assert.ok(r.ok);
    assert.ok(!s.state.evidence.find((e) => e.id === rec.id).flagged);
  });
});

/* ---------- 需求 3：去重 / 同源派生无环 / 顺序无关 ---------- */
group('需求3 独立性：同来源只算一条；同源/派生无环；判定与登记顺序无关', () => {
  test('同一来源多次出现只算一条证据（H1 的 U001 出现两次）', () => {
    const s = fresh();
    const res = s.results.get('H1');
    const u001 = res.units.filter((u) => u.sources.includes('U001'));
    assert.strictEqual(u001.length, 1);
    assert.strictEqual(u001[0].recordCount, 2); // 两条记录都可见
    assert.strictEqual(u001[0].weight, 3); // 质量取最强
  });
  test('派生材料不另计独立证据：N001 派生自 U003 → 同一组', () => {
    const s = fresh();
    const unit = s.results.get('H1').units.find((u) => u.sources.includes('U003'));
    assert.ok(unit.sources.includes('N001'));
  });
  test('同源材料合并：N002 与 U002 同组', () => {
    const s = fresh();
    const unit = s.results.get('H1').units.find((u) => u.sources.includes('U002'));
    assert.ok(unit.sources.includes('N002'));
  });
  test('H1 共 4 个独立来源组（U001 / U002+N002 / U003+N001 / U004）', () => {
    const s = fresh();
    assert.strictEqual(s.results.get('H1').units.length, 4);
  });
  test('拒绝直接成环的派生（A→B 后再 B→A）', () => {
    const st = EV.createState();
    st.hypotheses.push({ id: 'H1', statement: 'X', population: 'P', segments: [], status: '待验证' });
    st.evidence.push({ id: 'E001', hypothesisId: 'H1', sourceId: 'A', capturedAt: '2026-09-01', stance: 'support', quality: 'medium', flagged: false, withdrawn: false });
    st.evidence.push({ id: 'E002', hypothesisId: 'H1', sourceId: 'B', capturedAt: '2026-09-02', stance: 'support', quality: 'medium', flagged: false, withdrawn: false });
    const s = mk(st);
    assert.ok(EV.act(s, 'ADD_RELATION', { from: 'A', to: 'B', kind: 'derived' }).ok);
    const r = EV.act(s, 'ADD_RELATION', { from: 'B', to: 'A', kind: 'derived' });
    assert.ok(!r.ok);
    assert.ok(r.errors.some((e) => e.code === 'DERIVE_CYCLE' && e.message.includes('有向环')));
    assert.strictEqual(s.state.relations.length, 1);
  });
  test('拒绝长链成环 A→B→C 后再 C→A，并给出现存路径', () => {
    const st = EV.createState();
    st.hypotheses.push({ id: 'H1', statement: 'X', population: 'P', segments: [], status: '待验证' });
    ['A', 'B', 'C'].forEach((x, i) => st.evidence.push({ id: 'E00' + i, hypothesisId: 'H1', sourceId: x, capturedAt: '2026-09-0' + (i + 1), stance: 'support', quality: 'medium', flagged: false, withdrawn: false }));
    const s = mk(st);
    EV.act(s, 'ADD_RELATION', { from: 'A', to: 'B', kind: 'derived' });
    EV.act(s, 'ADD_RELATION', { from: 'B', to: 'C', kind: 'derived' });
    const r = EV.act(s, 'ADD_RELATION', { from: 'C', to: 'A', kind: 'derived' });
    assert.ok(!r.ok && r.errors[0].message.includes('A → B → C'));
  });
  test('同源是对称的：反向重复声明被拒绝', () => {
    const s = fresh();
    const r = EV.act(s, 'ADD_RELATION', { from: 'U002', to: 'N002', kind: 'same' });
    assert.ok(!r.ok && r.errors[0].code === 'SAME_CYCLE');
  });
  test('同源源之间不能再声明派生', () => {
    const s = fresh();
    const r = EV.act(s, 'ADD_RELATION', { from: 'N002', to: 'U002', kind: 'derived' });
    assert.ok(!r.ok && r.errors[0].code === 'DERIVE_FROM_SAME');
  });
  test('自环被拒绝', () => {
    const s = fresh();
    const r = EV.act(s, 'ADD_RELATION', { from: 'U001', to: 'U001', kind: 'same' });
    assert.ok(!r.ok && r.errors[0].code === 'SELF_LOOP');
  });
  test('顺序无关：证据/关系打乱顺序登记，结论完全一致', () => {
    const a = fresh();
    const shuffled = EV.demoState();
    shuffled.evidence = shuffled.evidence.slice().reverse();
    shuffled.relations = shuffled.relations.slice().reverse();
    // 再用一次插入顺序不同的增量操作序列构建同样的逻辑状态
    const b = mk(shuffled);
    for (const id of ['H1', 'H2', 'H3']) {
      assert.strictEqual(JSON.stringify(a.results.get(id)), JSON.stringify(b.results.get(id)), '假设 ' + id + ' 结论不一致');
    }
  });
  test('顺序无关：单条逐条增量录入 vs 一次性状态，权重与档位相同', () => {
    const st = EV.createState();
    st.hypotheses.push({ id: 'H1', statement: 'X', population: 'P', segments: ['g1', 'g2'], status: '待验证' });
    const s = mk(st);
    const rows = [
      { sourceId: 'B', capturedAt: '2026-09-02', stance: '支持', quality: '高', segment: 'g2' },
      { sourceId: 'A', capturedAt: '2026-09-01', stance: '支持', quality: '高', segment: 'g1' },
      { sourceId: 'X', capturedAt: '2026-09-03', stance: '支持', quality: '中', segment: 'g1' },
    ];
    rows.forEach((r2) => EV.act(s, 'ADD_EVIDENCE', Object.assign({ hypothesisId: 'H1' }, r2)));
    EV.act(s, 'ADD_RELATION', { from: 'X', to: 'A', kind: 'same' });
    const oneShot = (() => {
      const st2 = EV.createState();
      st2.hypotheses = JSON.parse(JSON.stringify(st.hypotheses));
      st2.evidence = [
        { id: 'E001', hypothesisId: 'H1', sourceId: 'A', capturedAt: '2026-09-01T00:00', stance: 'support', quality: 'high', segment: 'g1', flagged: false, withdrawn: false },
        { id: 'E002', hypothesisId: 'H1', sourceId: 'B', capturedAt: '2026-09-02T00:00', stance: 'support', quality: 'high', segment: 'g2', flagged: false, withdrawn: false },
        { id: 'E003', hypothesisId: 'H1', sourceId: 'X', capturedAt: '2026-09-03T00:00', stance: 'support', quality: 'medium', segment: 'g1', flagged: false, withdrawn: false },
      ];
      st2.relations = [{ id: 'R001', from: 'X', to: 'A', kind: 'same' }];
      return mk(st2).results.get('H1');
    })();
    assert.strictEqual(s.results.get('H1').grade, oneShot.grade);
    assert.strictEqual(s.results.get('H1').units.length, oneShot.units.length);
    assert.strictEqual(s.results.get('H1').weights.support, oneShot.weights.support);
  });
  test('派生关系移除后恢复独立性，只影响相关假设', () => {
    const s = fresh();
    const before = s.results.get('H1').units.length;
    const r = EV.act(s, 'REMOVE_RELATION', { id: 'R001' }); // N001 不再派生自 U003
    assert.ok(r.ok);
    assert.strictEqual(s.results.get('H1').units.length, before + 1);
    assert.deepStrictEqual(r.recomputed.sort(), ['H1']);
  });
});

/* ---------- 需求 4：分档 + 同分按标识序 ---------- */
group('需求4 结论强度：质量/独立性/覆盖/反证四维分档，同分按标识序', () => {
  test('H1 = 强支持（3 个独立占优组、质量高、覆盖充分、占比 75%+）', () => {
    const s = fresh();
    const r = s.results.get('H1');
    assert.strictEqual(r.grade, EV.GRADE.STRONG_SUPPORT, r.reasons.join(' | '));
    assert.ok(r.ladder.length === 3);
    assert.ok(r.reasons.some((x) => x.includes('独立性')));
    assert.ok(r.reasons.some((x) => x.includes('证据质量')));
    assert.ok(r.reasons.some((x) => x.includes('人群覆盖')));
    assert.ok(r.reasons.some((x) => x.includes('反证') || x.includes('并存')));
  });
  test('演示数据档位逐档留痕：强档检查项含明细', () => {
    const s = fresh();
    const ladder = s.results.get('H1').ladder[0];
    assert.ok(ladder.checks.length === 5);
    assert.ok(ladder.checks.every((c) => typeof c.detail === 'string'));
  });
  test('覆盖不足会封顶到弱档', () => {
    const st = EV.createState();
    st.hypotheses.push({ id: 'H1', statement: 'X', population: 'P', segments: ['a', 'b', 'c', 'd'], status: '待验证' });
    st.evidence = [
      { id: 'E001', hypothesisId: 'H1', sourceId: 'A', capturedAt: '2026-09-01', stance: 'support', quality: 'high', segment: 'a', flagged: false, withdrawn: false },
      { id: 'E002', hypothesisId: 'H1', sourceId: 'B', capturedAt: '2026-09-02', stance: 'support', quality: 'high', segment: 'a', flagged: false, withdrawn: false },
      { id: 'E003', hypothesisId: 'H1', sourceId: 'C', capturedAt: '2026-09-03', stance: 'support', quality: 'high', segment: 'a', flagged: false, withdrawn: false },
    ];
    const s = mk(st);
    assert.strictEqual(s.results.get('H1').grade, EV.GRADE.WEAK_SUPPORT);
  });
  test('同分按假设标识升序排名（构造 H10 与 H2 同分）', () => {
    const st = EV.createState();
    ['H10', 'H2'].forEach((id) => {
      st.hypotheses.push({ id, statement: id + ' X', population: 'P', segments: [], status: '待验证' });
      st.evidence.push({ id: 'E' + id, hypothesisId: id, sourceId: 'S' + id, capturedAt: '2026-09-01', stance: 'support', quality: 'medium', flagged: false, withdrawn: false });
    });
    const s = mk(st);
    assert.strictEqual(s.results.get('H10').score, s.results.get('H2').score);
    assert.ok(s.results.get('H10').rank < s.results.get('H2').rank, 'H10 字典序应在 H2 前');
  });
  test('无证据 = 无法判定', () => {
    const st = EV.createState();
    st.hypotheses.push({ id: 'H1', statement: 'X', population: 'P', segments: [], status: '待验证' });
    assert.strictEqual(mk(st).results.get('H1').grade, EV.GRADE.NONE);
  });
});

/* ---------- 需求 5：正反并存 ---------- */
group('需求5 正反并存：双方保留、差距量化；势均力敌=证据不足', () => {
  test('H2 正反 5:5 持平 → 证据不足，不得定论', () => {
    const s = fresh();
    const r = s.results.get('H2');
    assert.strictEqual(r.grade, EV.GRADE.INSUFFICIENT);
    assert.strictEqual(r.weights.support, 5);
    assert.strictEqual(r.weights.refute, 5);
    assert.strictEqual(r.opposition.dominant, 'tie');
    assert.ok(r.reasons.some((x) => x.includes('持平') && x.includes('证据不足')));
  });
  test('H1 正反并存：支持方占优且量化差距，反证保留可见', () => {
    const s = fresh();
    const r = s.results.get('H1');
    assert.ok(r.opposition.hasBoth);
    assert.strictEqual(r.opposition.dominant, 'support');
    assert.strictEqual(r.opposition.supportWeight, 8); // U001=3, U002组=2, U003组=max(2,3)=3
    assert.strictEqual(r.opposition.refuteWeight, 1);
    assert.strictEqual(r.opposition.margin, 7);
    assert.ok(r.opposition.note.includes('占双方权重'));
    // 反证单元仍保留在 units 中
    assert.ok(r.units.some((u) => u.stance === 'refute'));
  });
  test('占比未达 2/3 → 证据不足（小差距不定论）', () => {
    const st = EV.createState();
    st.hypotheses.push({ id: 'H1', statement: 'X', population: 'P', segments: [], status: '待验证' });
    // 支持权重 3，反驳 2 → 占比 60%
    [['A', 'support', 'high'], ['B', 'refute', 'medium'], ['C', 'refute', 'low']]
      .forEach((x, i) => st.evidence.push({ id: 'E00' + i, hypothesisId: 'H1', sourceId: x[0], capturedAt: '2026-09-0' + (i + 1), stance: x[1], quality: x[2], flagged: false, withdrawn: false }));
    assert.strictEqual(mk(st).results.get('H1').grade, EV.GRADE.INSUFFICIENT);
  });
  test('同源组内立场矛盾：该组不计入任何一方并被指出', () => {
    const st = EV.createState();
    st.hypotheses.push({ id: 'H1', statement: 'X', population: 'P', segments: [], status: '待验证' });
    st.evidence = [
      { id: 'E001', hypothesisId: 'H1', sourceId: 'A', capturedAt: '2026-09-01', stance: 'support', quality: 'medium', flagged: false, withdrawn: false },
      { id: 'E002', hypothesisId: 'H1', sourceId: 'B', capturedAt: '2026-09-02', stance: 'refute', quality: 'medium', flagged: false, withdrawn: false },
    ];
    st.relations = [{ id: 'R001', from: 'B', to: 'A', kind: 'same' }];
    const r = mk(st).results.get('H1');
    assert.strictEqual(r.units[0].stance, 'conflicted');
    assert.strictEqual(r.weights.support, 0);
    assert.strictEqual(r.weights.refute, 0);
    assert.ok(r.reasons.some((x) => x.includes('立场矛盾')));
  });
});

/* ---------- 需求 6：增量重算与全量一致 ---------- */
group('需求6 增量重算：只重算受影响假设，且与全量重算完全一致', () => {
  test('新增材料：parityOk 且只重算对应假设', () => {
    const s = fresh();
    const r = EV.act(s, 'ADD_EVIDENCE', { hypothesisId: 'H3', sourceId: 'U30', capturedAt: '2026-09-12 10:00', stance: '反驳', quality: '高' });
    assert.ok(r.parityOk);
    assert.deepStrictEqual(r.recomputed, ['H3']);
  });
  test('来源关系变更：只重算用到这些来源的假设', () => {
    const st = EV.createState();
    st.hypotheses = [
      { id: 'H1', statement: 'a', population: 'P', segments: [], status: '待验证' },
      { id: 'H2', statement: 'b', population: 'P', segments: [], status: '待验证' },
    ];
    st.evidence = [
      { id: 'E001', hypothesisId: 'H1', sourceId: 'A', capturedAt: '2026-09-01', stance: 'support', quality: 'medium', flagged: false, withdrawn: false },
      { id: 'E002', hypothesisId: 'H1', sourceId: 'B', capturedAt: '2026-09-02', stance: 'support', quality: 'medium', flagged: false, withdrawn: false },
      { id: 'E003', hypothesisId: 'H2', sourceId: 'C', capturedAt: '2026-09-01', stance: 'support', quality: 'medium', flagged: false, withdrawn: false },
    ];
    const s = mk(st);
    const r = EV.act(s, 'ADD_RELATION', { from: 'B', to: 'A', kind: 'same' });
    assert.ok(r.parityOk);
    assert.deepStrictEqual(r.recomputed, ['H1']);
  });
  test('调整假设人群：只重算该假设', () => {
    const s = fresh();
    const r = EV.act(s, 'UPDATE_HYPOTHESIS', { id: 'H1', segments: ['年轻妈妈', '银发买菜者'] });
    assert.ok(r.parityOk && JSON.stringify(r.recomputed) === JSON.stringify(['H1']));
  });
  test('撤回整个独立来源组：只重算对应假设，档位下降', () => {
    const s = fresh();
    assert.strictEqual(s.results.get('H1').grade, EV.GRADE.STRONG_SUPPORT);
    // U002 与 N002 同属一个独立来源组，只撤回一条不影响结论；两条都撤回才移除整组
    const targets = s.state.evidence.filter((x) => ['U002', 'N002'].includes(x.sourceId)).map((x) => x.id);
    let r;
    for (const id of targets) r = EV.act(s, 'WITHDRAW_EVIDENCE', { id, reason: '受访者身份存疑' });
    assert.ok(r.parityOk);
    assert.deepStrictEqual(r.recomputed, ['H1']);
    assert.strictEqual(s.results.get('H1').grade, EV.GRADE.MODERATE_SUPPORT);
    targets.forEach((id) => assert.ok(s.state.evidence.find((x) => x.id === id).withdrawn));
  });
  test('撤回同组中的单条记录不改变结论（同组证据仍在）', () => {
    const s = fresh();
    const e = s.state.evidence.find((x) => x.sourceId === 'U002');
    const r = EV.act(s, 'WITHDRAW_EVIDENCE', { id: e.id, reason: '测试' });
    assert.ok(r.parityOk);
    assert.strictEqual(s.results.get('H1').grade, EV.GRADE.STRONG_SUPPORT);
  });
  test('未受影响结论保持同一对象引用', () => {
    const s = fresh();
    const h2 = s.results.get('H2');
    EV.act(s, 'ADD_EVIDENCE', { hypothesisId: 'H3', sourceId: 'U31', capturedAt: '2026-09-13', stance: '支持' });
    assert.strictEqual(s.results.get('H2'), h2);
  });
  test('随机化压力测试：任意增量操作序列后，增量结果 === 全量结果', () => {
    for (let trial = 0; trial < 40; trial++) {
      const s = mk(EV.demoState());
      const ops = 20;
      for (let i = 0; i < ops; i++) {
        const pick = i % 5;
        let r;
        if (pick === 0) {
          r = EV.act(s, 'ADD_EVIDENCE', { hypothesisId: ['H1', 'H2', 'H3'][i % 3], sourceId: 'U' + (100 + i), capturedAt: '2026-09-1' + (i % 9) + ' 10:00', stance: i % 2 ? '支持' : '反驳', quality: i % 3 ? 'high' : 'low' });
        } else if (pick === 1) {
          const e = s.state.evidence[i % s.state.evidence.length];
          r = e.withdrawn ? EV.act(s, 'RESTORE_EVIDENCE', { id: e.id }) : EV.act(s, 'WITHDRAW_EVIDENCE', { id: e.id });
        } else if (pick === 2) {
          const a = 'U' + (100 + ((i * 3) % 30));
          const b = 'U' + (100 + ((i * 7 + 1) % 30));
          r = EV.act(s, 'ADD_RELATION', { from: a, to: b, kind: i % 2 ? 'same' : 'derived' });
        } else if (pick === 3) {
          if (s.state.relations.length) {
            const rel = s.state.relations[i % s.state.relations.length];
            r = EV.act(s, 'REMOVE_RELATION', { id: rel.id });
          } else r = { parityOk: true };
        } else {
          r = EV.act(s, 'UPDATE_HYPOTHESIS', { id: ['H1', 'H2'][i % 2], segments: i % 2 ? 'a,b,c' : ['年轻妈妈'] });
        }
        if (r && r.parityOk === false) throw new Error('trial ' + trial + ' op ' + i + ' parity failed');
      }
      const full = EV.computeAll(s.state);
      s.state.hypotheses.forEach((h) => {
        assert.strictEqual(JSON.stringify(s.results.get(h.id)), JSON.stringify(full.get(h.id)), 'trial ' + trial + ' ' + h.id);
      });
    }
  });
  test('更正来源：新旧两个假设都被重算', () => {
    const s = fresh();
    const e = s.state.evidence.find((x) => x.sourceId === 'U020');
    const r = EV.act(s, 'CORRECT_EVIDENCE', { id: e.id, hypothesisId: 'H2' });
    assert.ok(r.parityOk);
    assert.deepStrictEqual(r.recomputed.sort(), ['H2', 'H3']);
  });
});

/* ---------- 需求 7：界面所需数据契约（撤回/标记/关系在模型中可用） ---------- */
group('需求7 界面数据契约：时间线/依赖图/变化说明齐备', () => {
  test('证据时间线可按采集时刻排序且含来源/立场/状态', () => {
    const s = fresh();
    const tl = s.state.evidence.slice().sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : 1));
    assert.ok(tl[0].capturedAt <= tl[1].capturedAt);
    assert.ok(tl.every((e) => 'withdrawn' in e && 'flagged' in e));
  });
  test('来源依赖模型提供类成员与簇成员，供界面画依赖图', () => {
    const s = fresh();
    assert.deepStrictEqual(s.model.classMembers.get('N002').sort(), ['N002', 'U002'].sort());
    const cluster = Array.from(s.model.clusterMembers.values()).find((m) => m.includes('U003'));
    assert.ok(cluster.includes('N001'));
  });
  test('act 返回 changes：变更前后档位对比', () => {
    const s = fresh();
    const r = EV.act(s, 'ADD_EVIDENCE', { hypothesisId: 'H3', sourceId: 'U40', capturedAt: '2026-09-15 09:00', stance: 'refute', quality: 'high' });
    const c = r.changes.find((x) => x.id === 'H3');
    assert.ok(c.before && c.after);
  });
  test('批量解析：支持制表符/竖线，错误行指出行号', () => {
    const text = 'U1|2026-09-01 10:00|支持|g1|高|愿意付费\n坏行\nU2\t2026-09-02\t反驳';
    const { rows, parseErrors } = EV.parseEvidenceText(text, { hypothesisId: 'H1' });
    assert.strictEqual(rows.length, 2);
    assert.ok(parseErrors[0].message.includes('第 2 行'));
    assert.strictEqual(rows[0].quality, '高');
  });
});

console.log('\n========================================');
console.log(`通过 ${passed} 项，失败 ${failed} 项`);
if (failed) process.exit(1);
console.log('全部验收通过 ✅');
