/**
 * smoke.js — 界面自检：仅当 URL 带 ?smoke=1 时执行。
 * 它在真实页面里驱动表单提交、下拉切换、冲突裁决点击，并把断言结果写入 #smoke-out。
 * 无头浏览器用法：
 *   chrome --headless=new --virtual-time-budget=10000 --dump-dom "index.html?smoke=1"
 */
(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('smoke') !== '1') return;

  function assert(name, cond, detail) {
    results.push({ name: name, ok: !!cond, detail: detail || '' });
  }

  function setVal(id, v) {
    var n = document.getElementById(id);
    n.value = v;
    n.dispatchEvent(new Event('input', { bubbles: true }));
    n.dispatchEvent(new Event('change', { bubbles: true }));
    return n;
  }

  function submitForm(id) {
    document.getElementById(id).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  var results = [];

  function run() {
    var Store = window.Store, RC = window.RetentionCore;
    // 确定性：重置为演示数据
    Store.resetSeed();
    window.dispatchEvent(new Event('reset-for-smoke'));

    // 重新走一次正常启动渲染
    location.hash = '';
    // 通过切换控件触发渲染（app 的 render 是私有的；直接 reload 状态后靠后续操作间接触发）
    // 初始渲染由 DOMContentLoaded 完成；resetSeed 后手动触发一次比较切换：
    setVal('cmpA', 'organic-0601');
    setVal('cmpB', 'paid-0615');

    var cmp = document.getElementById('comparePanel');

    // 1. 初始共同窗口 = 第0–4期（长队列的第5、6期被排除）
    assert('初始比较窗口为第0–4期', /共同观察窗口：第\s*0–4\s*期/.test(cmp.textContent));
    // 2. 反转检出：第2期 A→B
    assert('检出第2期优势反转', /发生 1 次反转/.test(cmp.textContent) && /第2期 A→B/.test(cmp.textContent));
    // 3. 窗口外排除清单含 organic 第6期并说明不得当作0/缺失
    var excl = cmp.textContent;
    assert('长队列尾部被排除且非零填补', /organic|自然搜索/.test(excl) === false || /超出窗口/.test(excl));
    assert('排除原因明示不得当作0或缺失', /不得当作 0 或缺失/.test(excl) || /不作 0\/缺失填补/.test(excl) || /不做零\/缺失填补/.test(excl));
    var exclusionCount = document.querySelectorAll('#comparePanel .excl-list li').length;
    assert('排除清单逐条列出（2条：第5、6期）', exclusionCount === 2, '实际 ' + exclusionCount + ' 条');

    // 4. 幂等上报
    setVal('fObsCohort', 'organic-0601');
    setVal('fPeriod', '0');
    setVal('fActive', '820');
    setVal('fSource', 'BI日报');
    submitForm('formObs');
    assert('重复上报幂等提示', /幂等/.test(document.querySelector('#formObs .form-msg').textContent));

    // 5. 超规模拒绝并指出位置
    setVal('fPeriod', '2');
    setVal('fActive', '99999');
    setVal('fSource', 'BI日报');
    submitForm('formObs');
    var msg2 = document.querySelector('#formObs .form-msg');
    assert('超规模被拒绝', /超过队列规模/.test(msg2.textContent));
    assert('拒绝指出队列与期位置', /自然搜索/.test(msg2.textContent) && /第 2 期/.test(msg2.textContent) && /位置：/.test(msg2.textContent));

    // 6. 时刻倒退拒绝：新建一个 0、3 期有观测、1/2 期从未上报的队列，再补第1期
    setVal('fName', '倒退冒烟队列'); setVal('fChannel', 'Z'); setVal('fStratum', '冒烟倒退层');
    setVal('fSize', '100'); setVal('fStart', '2026-08-03');
    submitForm('formCohort');
    var regIds = window.Store.state().cohorts.map(function (c) { return c.id; });
    var regId = regIds[regIds.length - 1];
    setVal('fObsCohort', regId); setVal('fPeriod', '0'); setVal('fActive', '80'); setVal('fSource', 'BI日报');
    submitForm('formObs');
    setVal('fPeriod', '3'); setVal('fActive', '50');
    submitForm('formObs');
    setVal('fPeriod', '1'); setVal('fActive', '60'); setVal('fSource', '补录脚本');
    submitForm('formObs');
    var msg3 = document.querySelector('#formObs .form-msg');
    assert('时刻倒退被拒绝（从未上报的历史期）', /时刻不允许倒退/.test(msg3.textContent) && /第 3 期/.test(msg3.textContent) && /第 1 期/.test(msg3.textContent));

    // 7. 新冲突：给短视频第3期再报一个矛盾值
    setVal('fObsCohort', 'video-0701');
    setVal('fPeriod', '3');
    setVal('fActive', '330');
    setVal('fSource', '渠道回传');
    submitForm('formObs');
    assert('新矛盾值进入冲突流程', /互相矛盾/.test(document.querySelector('#formObs .form-msg').textContent));
    var conflictCards = document.querySelectorAll('#conflictPanel .conflict-card');
    assert('冲突面板同时展示原有与新增2个冲突', conflictCards.length === 2, '实际 ' + conflictCards.length);
    var cardText = Array.prototype.map.call(conflictCards, function (c) { return c.textContent; }).join('|');
    assert('冲突记录列出双方来源与数值', /360/.test(cardText) && /330/.test(cardText) && /BI日报/.test(cardText) && /渠道回传/.test(cardText));

    // 8. 切到短视频：种子第2期待裁决 + 刚新增的第3期待裁决 → 共同窗口收窄为 0–1
    setVal('cmpB', 'video-0701');
    var cmp2 = document.getElementById('comparePanel');
    assert('冲突期不计入共同窗口（收窄为第0–1期）', /共同观察窗口：第\s*0–1\s*期/.test(cmp2.textContent) && /共 2 期/.test(cmp2.textContent));
    assert('排除清单含冲突未决原因', /冲突未决/.test(cmp2.textContent) && /禁止静默择一/.test(cmp2.textContent));

    // 9. 裁决刚产生的第3期冲突（点候选值 360 / BI日报）
    var targetBtn = null;
    document.querySelectorAll('#conflictPanel .cand-btn').forEach(function (b) {
      if (b.dataset.cohort === 'video-0701' && b.dataset.period === undefined && b.textContent.indexOf('360') === 0) {
        // 第3期冲突卡片里 360 候选（第2期卡片没有360）
        var card = b.closest('.conflict-card');
        if (/第 3 期/.test(card.querySelector('.ctitle').textContent)) targetBtn = b;
      }
    });
    assert('找到第3期冲突360候选按钮', !!targetBtn);
    if (targetBtn) targetBtn.click();
    setVal('cmpB', 'video-0701');
    assert('裁决后冲突记录保留为已裁决', Array.prototype.some.call(document.querySelectorAll('#conflictPanel .conflict-card'), function (c) {
      return /第 3 期/.test(c.textContent) && /已裁决/.test(c.textContent);
    }));

    // 10. 分层不可比标记
    var strataText = document.getElementById('strataCards').textContent;
    assert('老客分层标为不可比且说明缺额', /老客/.test(strataText) && /不可比/.test(strataText) && /缺 1 个/.test(strataText));
    assert('不可比说明禁止并列结论', /不得与其他分层并列/.test(strataText));

    // 11. 规模修正拒绝（小于已观测活跃数）
    setVal('fScaleCohort', 'organic-0601');
    setVal('fNewSize', '100');
    setVal('fScaleReason', '误填');
    submitForm('formScale');
    var msg4 = document.querySelector('#formScale .form-msg');
    assert('规模修正被拒并逐期指出', /规模修正被拒绝/.test(msg4.textContent) && /第 0 期/.test(msg4.textContent));

    // 12. 合法修正后受影响比率立即变化
    setVal('fScaleCohort', 'paid-0615');
    setVal('fNewSize', '2400');
    submitForm('formScale');
    setVal('cmpA', 'paid-0615');
    setVal('cmpB', 'organic-0601');
    var cmp3 = document.getElementById('comparePanel');
    // paid 第0期 936/2400 = 39.0%
    assert('规模修正后留存率即时重算(39.0%)', /39\.0%/.test(cmp3.textContent));

    // 13. 留存矩阵区分未观测/冲突
    var matrixText = document.getElementById('matrixPanel').textContent;
    assert('矩阵渲染且保留未观测占位', /第6期/.test(matrixText) && /从未观测/.test(document.getElementById('matrixPanel').innerHTML + document.querySelector('#matrixPanel .small').textContent));
    assert('矩阵含冲突标记', document.querySelectorAll('#matrixPanel .cell.conflicted').length >= 1);

    // 14. 无共同窗口场景：新建两个期数不重叠的队列
    setVal('fName', '冒烟队列甲'); setVal('fChannel', 'X'); setVal('fStratum', '冒烟层');
    setVal('fSize', '100'); setVal('fStart', '2026-08-01');
    submitForm('formCohort');
    var idA = RC.getCohort(window.Store.state(), 0) ? null : null;
    var ids = window.Store.state().cohorts.map(function (c) { return c.id; });
    var smokeA = ids[ids.length - 1];
    setVal('fObsCohort', smokeA); setVal('fPeriod', '0'); setVal('fActive', '80'); setVal('fSource', 'BI日报');
    submitForm('formObs');
    setVal('fName', '冒烟队列乙'); setVal('fChannel', 'Y'); setVal('fStratum', '冒烟层2');
    setVal('fSize', '100'); setVal('fStart', '2026-08-02');
    submitForm('formCohort');
    var ids2 = window.Store.state().cohorts.map(function (c) { return c.id; });
    var smokeB = ids2[ids2.length - 1];
    setVal('fObsCohort', smokeB); setVal('fPeriod', '9'); setVal('fActive', '40'); setVal('fSource', 'BI日报');
    submitForm('formObs');
    setVal('cmpA', smokeA); setVal('cmpB', smokeB);
    var cmp4 = document.getElementById('comparePanel');
    assert('无共同窗口明确报错且不零填补', /不存在共同观察窗口/.test(cmp4.textContent) && /不做零填补/.test(cmp4.textContent));

    // 15. 增量一致性：通过内核验证当前全部两两比较 增量===全量
    var s = window.Store.state();
    var mismatch = 0, pairs = 0;
    for (var i = 0; i < s.cohorts.length; i++) {
      for (var j = i + 1; j < s.cohorts.length; j++) {
        pairs++;
        var inc = RC.compareCohorts(s, s.cohorts[i].id, s.cohorts[j].id);
        var full = RC.fullRecompute(JSON.parse(RC.serialize(s)), s.cohorts[i].id, s.cohorts[j].id);
        var norm = function (r) {
          return JSON.stringify({ w: r.window, rows: r.rows, ex: (r.exclusions || []).map(function (e) { return [e.cohortId, e.period, e.reasonCode]; }), rev: r.reversals, code: r.code });
        };
        if (norm(inc) !== norm(full)) mismatch++;
      }
    }
    assert('全部 ' + pairs + ' 对比较增量结果 === 全量重算', mismatch === 0, '不一致对数：' + mismatch);

    // 输出
    var pass = results.filter(function (r) { return r.ok; }).length;
    var pre = document.createElement('pre');
    pre.id = 'smoke-out';
    pre.setAttribute('style', 'position:fixed;top:0;left:0;right:0;z-index:999;background:#111;color:#0f0;padding:12px;font:12px monospace;white-space:pre-wrap');
    pre.textContent = 'SMOKE ' + pass + '/' + results.length + '\n' + results.map(function (r) {
      return (r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.detail ? '  << ' + r.detail : '');
    }).join('\n');
    document.body.appendChild(pre);
    window.__SMOKE__ = results;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(run, 50); });
  else setTimeout(run, 50);
})();
