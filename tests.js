'use strict';
/* 自检：node 下 `node tests.js` 可跑；浏览器内由“运行自检”按钮触发同一套用例。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./engine.js'));
  else root.Tests = factory(root.Engine);
})(typeof self !== 'undefined' ? self : this, function (E) {

  function runSelfTests() {
    const out = [];
    const t = (name, fn) => {
      try { fn(); out.push({ name, ok: true, detail: '' }); }
      catch (e) { out.push({ name, ok: false, detail: String((e && e.message) || e) }); }
    };
    const ok = (c, msg) => { if (!c) throw new Error(msg); };
    const eq = (a, b, msg) => {
      if (JSON.stringify(a) !== JSON.stringify(b))
        throw new Error(msg + '\n  A=' + JSON.stringify(a) + '\n  B=' + JSON.stringify(b));
    };
    const newCache = () => ({ map: new Map(), hits: 0, misses: 0, rebuilt: [] });

    t('需求3 贡献分解守恒：各假设贡献之和 = 指标总变化', () => {
      const s = E.makeSeedState();
      s.values = { rev_growth: 3, gross_margin: 35, opex_ratio: 20, tax_rate: 22 };
      for (const m of s.metrics) {
        const d = E.decompose(s, m.id, s.values);
        const sum = d.parts.reduce((x, p) => x + p.c, 0);
        ok(Math.abs((d.total - d.base) - sum) < 1e-9, '贡献之和与总变化不符');
      }
    });

    t('需求5 求解结果与登记顺序无关', () => {
      const s1 = E.makeSeedState();
      const s2 = E.makeSeedState();
      s2.assumptions.reverse(); s2.responses.reverse(); s2.metrics.reverse();
      for (const m of s1.metrics)
        eq(E.sweep(s1, m.id, s1.direction), E.sweep(s2, m.id, s2.direction), `指标 ${m.id} 的扫描结果随登记顺序变化`);
    });

    t('需求7 增量求解与全量一致，且未受影响部分不重算', () => {
      const s = E.makeSeedState();
      const cache = newCache();
      E.sweep(s, 'net_profit', s.direction, cache); /* 预热 */
      cache.rebuilt.length = 0;                     /* 只统计编辑后的重算 */
      const r = s.responses.find(r => r.aid === 'rev_growth' && r.mid === 'net_profit');
      E.setResponsePoints(s, 'rev_growth', 'net_profit',
        r.points.map(p => (p.x === 18 ? { x: 18, y: 22 } : p)));
      const fullCache = newCache();
      const full = E.sweep(s, 'net_profit', s.direction, fullCache); /* 从头全量 */
      const inc = E.sweep(s, 'net_profit', s.direction, cache);      /* 增量复用 */
      eq(inc, full, '增量结果 ≠ 全量结果');
      ok(cache.rebuilt.length === 1 && cache.rebuilt[0] === 'net_profit|rev_growth',
        '未受影响的假设被重算：' + cache.rebuilt.join(','));
    });

    t('需求7 局部修改响应段不影响未涉及区间的取值与边界', () => {
      const s = E.makeSeedState();
      const r = s.responses.find(r => r.aid === 'rev_growth' && r.mid === 'net_profit');
      const probes = [-10, -5, 0, 2, 5, 8, 10, 12, 14].map(x => [x, E.evalPoints(r.points, x)]);
      E.setResponsePoints(s, 'rev_growth', 'net_profit',
        r.points.map(p => (p.x === 18 ? { x: 18, y: 22 } : p))); /* 只动 [14,25] 两段 */
      const r2 = s.responses.find(r => r.aid === 'rev_growth' && r.mid === 'net_profit');
      for (const [x, v] of probes)
        ok(Math.abs(E.evalPoints(r2.points, x) - v) < 1e-12, `未涉及点 x=${x} 的取值被改变`);
      ok(r2.points[0].x === -10 && r2.points[r2.points.length - 1].x === 25, '区间边界被改变');
    });

    t('需求1/2 非法输入被拒绝并指出位置', () => {
      const s = E.makeSeedState();
      let r = E.addAssumption(s, { id: 'bad1', base: 5, min: 10, max: 0 });
      ok(!r.ok && r.errs.some(e => e.field === 'min'), '未拒绝非法区间');
      r = E.addAssumption(s, { id: 'bad2', base: 99, min: 0, max: 10 });
      ok(!r.ok && r.errs.some(e => e.field === 'base'), '未拒绝越界基准值');
      r = E.addAssumption(s, { id: 'rev_growth', name: '收入增长率', unit: '%', base: 8, min: -10, max: 25, source: '测试' });
      ok(!r.ok && r.errs.some(e => e.field === 'id'), '未拒绝重复标识');
      r = E.addResponse(s, 'rev_growth', 'net_profit', [{ x: -10, y: 0 }, { x: 10, y: 1 }], '测试');
      ok(!r.ok && /断点缺失/.test(r.errs.map(e => e.msg).join()), '未检出断点缺失');
      r = E.addResponse(s, 'rev_growth', 'net_profit', [{ x: -10, y: 0 }, { x: 30, y: 1 }], '测试');
      ok(!r.ok && /越界/.test(r.errs.map(e => e.msg).join()), '未检出断点越界');
      r = E.addResponse(s, 'rev_growth', 'net_profit', [{ x: -10, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 2 }, { x: 25, y: 3 }], '测试');
      ok(!r.ok && /重叠|倒序/.test(r.errs.map(e => e.msg).join()), '未检出区间重叠');
    });

    t('需求6 冲突双方保留、可读、可解决，且冲突项不参与计算', () => {
      const s = E.makeSeedState();
      const c = s.conflicts.find(c => c.kind === 'assumption' && c.aid === 'tax_rate');
      ok(c, '预置冲突缺失');
      ok(c.options.length === 2 && c.options[0].source !== c.options[1].source, '未保留双方来源');
      ok(!E.activeAssumptions(s).some(a => a.id === 'tax_rate'), '冲突假设不应参与计算');
      E.resolveConflict(s, c.cid, 1);
      const a = E.activeAssumptions(s).find(a => a.id === 'tax_rate');
      ok(a && a.base === 23 && a.source === '审计调整', '冲突解决后内容不符');
    });

    t('需求4/5 平台与非单调：全部穿越点、贴线平台、不可达区间，且重复求解一致', () => {
      const s = E.makeSeedState();
      E.addAssumption(s, { id: 'h1', name: 'h1', base: 0, min: 0, max: 10, source: 't' });
      s.metrics.push({ id: 'mm', name: 'mm', unit: '', base: 0, threshold: 5, violate: 'below' });
      E.addResponse(s, 'h1', 'mm', [
        { x: 0, y: 0 }, { x: 2, y: 5 }, { x: 4, y: 5 }, { x: 6, y: 8 }, { x: 8, y: 3 }, { x: 10, y: 7 }
      ], 't');
      const sw = E.sweep(s, 'mm', { h1: 1 });
      ok(sw.ok, '扫描失败');
      ok(sw.plateaus.length === 1 && Math.abs(sw.plateaus[0].t0 - 2) < 1e-6 && Math.abs(sw.plateaus[0].t1 - 4) < 1e-6,
        '贴线平台未识别：' + JSON.stringify(sw.plateaus));
      ok(sw.crossings.some(c => Math.abs(c.t - 7.2) < 1e-6), '缺少穿越点 t=7.2');
      ok(sw.crossings.some(c => Math.abs(c.t - 9) < 1e-6), '缺少穿越点 t=9');
      ok(Math.abs(sw.first - 2) < 1e-6, '首次越线位置错误：' + sw.first);
      ok(sw.unreachable.length >= 3, '不可达区间缺失：' + JSON.stringify(sw.unreachable));
      eq(E.sweep(s, 'mm', { h1: 1 }), sw, '重复求解结果不一致');
    });

    t('需求4 首次越线位置与该处假设取值正确', () => {
      const s = E.makeSeedState();
      const sw = E.sweep(s, 'net_profit', s.direction);
      ok(sw.ok && sw.first !== null, '未求出首次越线');
      ok(Math.abs(sw.first - 8 / 3) < 1e-6, '首次越线 t 错误：' + sw.first);
      ok(Math.abs(sw.firstValues.rev_growth - (8 - 2 * 8 / 3)) < 1e-6, '越线处 rev_growth 取值错误');
      ok(Math.abs(sw.firstValues.opex_ratio - (18 + 0.5 * 8 / 3)) < 1e-6, '越线处 opex_ratio 取值错误');
    });

    return out;
  }

  return { runSelfTests };
});

if (typeof module !== 'undefined' && require.main === module) {
  const results = module.exports.runSelfTests();
  let fail = 0;
  for (const r of results) {
    console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.ok ? '' : '\n     ' + r.detail));
    if (!r.ok) fail++;
  }
  console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
  process.exit(fail ? 1 : 0);
}
