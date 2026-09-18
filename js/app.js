/**
 * 界面控制层：把 GuideEngine 的状态渲染到 DOM，并把用户操作转成引擎动作。
 * 无外部依赖，直接在浏览器中离线运行。
 */
(function () {
  'use strict';

  const { validateConfig, createGuide, GuideConfigError } = window.GuideEngine;
  const CONFIG = window.DEMO_CONFIG;

  // 启动即校验配置：非法则整页报错（真实部署中配置错误必须显性暴露，而不是静默带病运行）
  let guide;
  try {
    guide = createGuide(CONFIG);
  } catch (e) {
    if (e instanceof GuideConfigError) {
      document.body.innerHTML =
        '<pre style="padding:24px;color:#dc2626;white-space:pre-wrap;font-size:13px;">' +
        '引导配置加载失败，应用未启动：\n\n' +
        e.errors.map((x) => '[' + x.code + '] ' + x.message + '\n位置：' + x.location).join('\n\n') +
        '</pre>';
      return;
    }
    throw e;
  }

  // 快速索引
  const stepById = {};
  CONFIG.steps.forEach((s) => { stepById[s.id] = s; });
  const qMeta = {}; // qid -> {step, def}
  CONFIG.steps.forEach((s) => (s.questions || []).forEach((q) => { qMeta[q.id] = { step: s, def: q }; }));
  const stageTitle = (id) => {
    const st = (CONFIG.stages || []).find((x) => x.id === id);
    return st ? st.title : '';
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const QS_LABEL = {
    confirmed: '已确认',
    needsReconfirm: '待重新确认',
    inactive: '未激活',
    unreached: '未到达'
  };
  const SS_LABEL = {
    done: '已完成',
    active: '进行中',
    inactive: '未激活',
    unreached: '未到达',
    skipped: '已跳过'
  };

  // ---------------------------------------------------------------------------
  // 值展示
  // ---------------------------------------------------------------------------
  function optionLabel(q, value) {
    if (!Array.isArray(q.options)) return esc(value);
    const op = q.options.find((o) => String(o.value) === String(value));
    return esc(op ? op.label : value);
  }
  function displayValue(q, value) {
    if (value === undefined || value === null || value === '') return '<span class="muted">（空）</span>';
    if (q.type === 'boolean') return value === true ? '是' : '否';
    if (q.type === 'radio' || q.type === 'select') return optionLabel(q, value);
    return esc(value);
  }

  // ---------------------------------------------------------------------------
  // 渲染：步骤序列
  // ---------------------------------------------------------------------------
  function renderStepper() {
    const st = guide.getState();
    const el = $('stepper');
    el.innerHTML = '';
    CONFIG.steps.forEach((step, si) => {
      const ss = st.stepStates[step.id] || 'unreached';
      const item = document.createElement('button');
      item.className = 'step-item ' + ss + (st.cursor === step.id ? ' current' : '');
      item.type = 'button';

      // 该步骤内待重确认数（用于步骤上的小角标）
      const pendingCount = (step.questions || [])
        .filter((q) => st.questionStates[q.id] === 'needsReconfirm').length;
      const metaBits = ['<span class="mini-badge ' + ss + '">' + SS_LABEL[ss] + '</span>'];
      if (pendingCount > 0) {
        metaBits.push('<span class="mini-badge pending">' + pendingCount + ' 项待重确认</span>');
      }
      if (step.skippable && ss !== 'skipped') {
        metaBits.push('<span class="mini-badge skipped">可跳过</span>');
      }

      item.innerHTML =
        '<span class="step-rail">' +
        '  <span class="step-node">' + (ss === 'done' ? '✓' : (si + 1)) + '</span>' +
        (si < CONFIG.steps.length - 1 ? '<span class="step-line"></span>' : '<span class="step-line" style="visibility:hidden"></span>') +
        '</span>' +
        '<span class="step-body">' +
        '  <span class="step-name">' + esc(step.title) + '</span>' +
        '  <span class="step-meta">' + metaBits.join(' ') + '</span>' +
        '</span>';

      item.addEventListener('click', () => {
        try {
          guide.goTo(step.id);
          renderAll();
        } catch (e) {
          toast(e.message, 'error');
        }
      });
      el.appendChild(item);
    });
  }

  // ---------------------------------------------------------------------------
  // 渲染：当前步骤与问题
  // ---------------------------------------------------------------------------
  function renderWorkspace() {
    const st = guide.getState();
    const step = stepById[st.cursor];
    const ss = st.stepStates[step.id] || 'unreached';

    $('stage-chip').textContent = stageTitle(step.stage);
    $('step-title').textContent = step.title;
    $('step-desc').textContent = step.description || '';
    const badge = $('step-state-badge');
    badge.className = 'step-state-badge ' + ss;
    badge.textContent = SS_LABEL[ss];

    $('step-inactive-notice').hidden = !(ss === 'inactive');
    $('block-notice').hidden = true;
    $('finish-card').hidden = !(step.id === CONFIG.steps[CONFIG.steps.length - 1].id && guide.canFinish());

    // 按钮
    const si = CONFIG.steps.indexOf(step);
    $('btn-back').disabled = si === 0;
    const skipBtn = $('btn-skip');
    if (step.skippable) {
      skipBtn.hidden = false;
      skipBtn.textContent = ss === 'skipped' ? '取消跳过，返回填写' : '跳过本步骤（可不填）';
    } else {
      skipBtn.hidden = true;
    }
    $('btn-next').textContent = si === CONFIG.steps.length - 1 ? '完成并提交' : '下一步 →';

    const list = $('question-list');
    list.innerHTML = '';
    (step.questions || []).forEach((q) => list.appendChild(renderQuestion(q, st)));
  }

  function renderQuestion(q, st) {
    const qs = st.questionStates[q.id] || 'unreached';
    const hasAnswer = Object.prototype.hasOwnProperty.call(st.answers, q.id);
    const value = hasAnswer ? st.answers[q.id] : undefined;
    const readonly = (qs === 'inactive'); // 失活只读；未到达/待重确认都可编辑
    const card = document.createElement('div');
    card.className = 'q-card ' + qs;
    card.id = 'qcard-' + q.id;

    const reqMark = q.optional
      ? '<span class="q-optional">（选填，可留空）</span>'
      : '<span class="q-required">*</span>';

    card.innerHTML =
      '<div class="q-top">' +
      '  <div class="q-title">' + esc(q.title) + reqMark +
      '    <div class="q-id">标识：' + esc(q.id) + '</div>' +
      '  </div>' +
      '  <span class="q-state-tag ' + qs + '">' + QS_LABEL[qs] + '</span>' +
      '</div>';

    // 待重新确认的依据
    if (qs === 'needsReconfirm') {
      card.appendChild(renderReasons(q, st.reasons[q.id] || []));
    }

    // 控件
    const control = document.createElement('div');
    control.className = 'q-control';
    control.appendChild(buildControl(q, qs, value, readonly));
    card.appendChild(control);

    // 未激活但有答案：保留原值展示
    if (qs === 'inactive' && hasAnswer) {
      const note = document.createElement('div');
      note.className = 'q-retain-note';
      note.innerHTML = '🔒 答案已保留（未激活，不计入进度）：<span class="retained-val">' +
        displayValue(q, value) + '</span>';
      card.appendChild(note);
    }

    // 显式保存按钮（文本/数字/日期类）
    if (['text', 'textarea', 'number', 'date'].indexOf(q.type) !== -1 && !readonly) {
      const row = document.createElement('div');
      row.className = 'q-confirm-row';
      const btn = document.createElement('button');
      btn.className = 'btn ' + (qs === 'needsReconfirm' ? 'btn-primary' : 'btn-ghost');
      btn.type = 'button';
      btn.textContent = qs === 'needsReconfirm'
        ? '✓ 核对无误，重新确认'
        : (hasAnswer ? '保存修改' : '确认本题');
      btn.addEventListener('click', () => {
        const input = control.querySelector('input,textarea');
        submitAnswer(q, input.value);
      });
      row.appendChild(btn);
      if (qs === 'needsReconfirm') {
        const hint = document.createElement('span');
        hint.style.fontSize = '12.5px';
        hint.style.color = 'var(--warn)';
        hint.textContent = '原值已填入，可直接确认，也可修改后确认';
        row.appendChild(hint);
      }
      card.appendChild(row);
    }

    return card;
  }

  function renderReasons(q, reasons) {
    const box = document.createElement('div');
    box.className = 'reasons';
    box.innerHTML = '<div class="reasons-title">⚠ 为什么需要重新确认？</div>';
    reasons.forEach((r) => {
      const line = document.createElement('div');
      line.className = 'reason-line';
      if (r.kind === 'changed') {
        line.innerHTML = '所依赖的「' + esc(r.depTitle) + '」答案已改变：' +
          '<span class="reason-val">' + displayValue(qMeta[r.depId].def, r.from) + '</span> → ' +
          '<span class="reason-val">' + displayValue(qMeta[r.depId].def, r.to) + '</span>';
      } else if (r.kind === 'deactivated') {
        line.innerHTML = '所依赖的「' + esc(r.depTitle) + '」已变为未激活（作答时的值为 ' +
          '<span class="reason-val">' + displayValue(qMeta[r.depId].def, r.from) + '</span>）。';
      } else if (r.kind === 'reactivated') {
        line.innerHTML = '所依赖的「' + esc(r.depTitle) + '」重新激活，当前值为 ' +
          '<span class="reason-val">' + displayValue(qMeta[r.depId].def, r.to) + '</span>。';
      } else if (r.kind === 'upstream') {
        const rootTxt = r.root
          ? '根源：「' + esc(r.root.depTitle) + '」' +
            ({ changed: '答案改变', deactivated: '变为未激活', reactivated: '重新激活' }[r.root.kind] || '发生变化')
          : '上游问题待重新确认';
        line.innerHTML = esc(rootTxt) + '，沿依赖链波及本问题。';
      }
      box.appendChild(line);
      if (r.path && r.path.length > 1) {
        const chain = document.createElement('span');
        chain.className = 'reason-chain';
        chain.textContent = '依赖链：' + r.path
          .map((id) => qMeta[id] ? qMeta[id].def.title : id).join(' → ');
        box.appendChild(chain);
      }
    });
    return box;
  }

  function buildControl(q, qs, value, readonly) {
    const wrap = document.createElement('div');
    if (q.type === 'radio' || (q.type === 'boolean' && !q.options)) {
      // boolean 未配置 options 时给 是/否
      const options = q.options || [
        { value: true, label: '是' },
        { value: false, label: '否' }
      ];
      const list = document.createElement('div');
      list.className = 'radio-list';
      options.forEach((op) => {
        const lab = document.createElement('label');
        lab.className = 'radio-item' + (value !== undefined && String(value) === String(op.value) ? ' checked' : '') +
          (readonly ? ' disabled' : '');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = q.id;
        input.value = String(op.value);
        input.checked = value !== undefined && String(value) === String(op.value);
        input.disabled = readonly;
        input.addEventListener('change', () => {
          // boolean 题值转回布尔
          if (q.type === 'boolean') submitAnswer(q, op.value === true || op.value === 'true');
          else submitAnswer(q, op.value);
        });
        lab.appendChild(input);
        lab.appendChild(document.createTextNode(op.label));
        list.appendChild(lab);
      });
      wrap.appendChild(list);
      return wrap;
    }

    if (q.type === 'select') {
      const sel = document.createElement('select');
      sel.disabled = readonly;
      (q.options || []).forEach((op) => {
        const o = document.createElement('option');
        o.value = String(op.value);
        o.textContent = op.label;
        if (value !== undefined && String(value) === String(op.value)) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => {
        if (sel.value === '') return; // 占位项不提交
        submitAnswer(q, sel.value);
      });
      wrap.appendChild(sel);
      return wrap;
    }

    if (q.type === 'textarea') {
      const ta = document.createElement('textarea');
      ta.disabled = readonly;
      ta.placeholder = '请输入…';
      ta.value = value === undefined ? '' : value;
      wrap.appendChild(ta);
      return wrap;
    }

    const input = document.createElement('input');
    input.type = q.type === 'number' ? 'number' : (q.type === 'date' ? 'date' : 'text');
    input.disabled = readonly;
    input.placeholder = '请输入…';
    input.value = value === undefined ? '' : value;
    wrap.appendChild(input);
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // 动作
  // ---------------------------------------------------------------------------
  function submitAnswer(q, rawValue) {
    let value = rawValue;
    if (q.type === 'number') {
      if (String(rawValue).trim() === '') { toast('请填写数值后再确认', 'error'); return; }
      value = Number(rawValue);
      if (Number.isNaN(value)) { toast('请输入有效数字', 'error'); return; }
    } else if (q.type === 'text' || q.type === 'textarea' || q.type === 'date') {
      if (String(rawValue).trim() === '') { toast('内容不能为空（选填题可直接留空并跳过本步骤）', 'error'); return; }
    }
    try {
      const r = guide.answer(q.id, value);
      renderAll();
      announceChange(r.change);
      if (r.change && r.change.wasReconfirm) toast('已重新确认，相关下游状态已更新', 'ok');
      else toast('已保存', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function tryAdvance() {
    const st = guide.getState();
    const step = stepById[st.cursor];
    try {
      const r = guide.advance(step.id);
      renderAll();
      if (r.finished) toast('已完成全部步骤', 'ok');
    } catch (e) {
      renderAll(); // 状态未变，仅弹出阻止面板
      showBlockNotice(e.reason);
    }
  }

  function showBlockNotice(reason) {
    if (!reason || reason.code !== 'ADVANCE_BLOCKED') return;
    const box = $('block-notice');
    const detail = $('block-detail');
    const lines = (reason.missing || []).map((m) => {
      const why = m.status === 'pending'
        ? '<strong>答案待重新确认</strong>（上游改动）'
        : '<strong>尚未作答</strong>';
      const chain = m.chain && m.chain.length > 1
        ? '<span class="chain">依赖链：' + esc(m.chain
            .map((id) => qMeta[id] ? qMeta[id].def.title : id).join(' → ')) + '</span>'
        : '';
      return '<li>' + esc(m.title) + ' —— ' + why + chain + '</li>';
    }).join('');
    detail.innerHTML = '步骤「' + esc(reason.stepTitle) + '」存在以下必答缺口，系统未改动任何已填内容：<ul>' +
      lines + '</ul>';
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function toggleSkip() {
    const st = guide.getState();
    const step = stepById[st.cursor];
    try {
      if (st.stepStates[step.id] === 'skipped') {
        guide.unskipStep(step.id);
        toast('已返回该步骤', 'ok');
      } else {
        guide.skipStep(step.id);
        toast('已跳过本步骤', 'ok');
      }
      renderAll();
    } catch (e) {
      showBlockNotice(e.reason);
      toast(e.message.split('\n')[0], 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // 右侧影响面板
  // ---------------------------------------------------------------------------
  function renderImpact() {
    const st = guide.getState();
    const body = $('impact-body');
    body.innerHTML = '';

    // 1) 当前所有待重确认项（始终展示，是用户的待办清单）
    const pendingNow = Object.keys(st.questionStates)
      .filter((id) => st.questionStates[id] === 'needsReconfirm');

    if (pendingNow.length) {
      const g = document.createElement('div');
      g.className = 'impact-group';
      g.innerHTML = '<div class="impact-group-title pending">⚠ 待重新确认（' + pendingNow.length + '）</div>';
      pendingNow.forEach((id) => {
        const { def } = qMeta[id];
        const pill = document.createElement('span');
        pill.className = 'impact-pill pending';
        pill.innerHTML = esc(def.title) + ' <span class="pid">' + esc(id) + '</span>';
        pill.title = '点击跳到该问题';
        pill.addEventListener('click', () => {
          guide.goTo(qMeta[id].step.id);
          renderAll();
          setTimeout(() => {
            const card = $('qcard-' + id);
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 0);
        });
        g.appendChild(pill);
      });
      body.appendChild(g);
    }

    // 2) 最近一次改答的影响摘要
    const ch = st.lastChange;
    if (ch && ch.kind === 'answer') {
      const groups = [];
      if (ch.becamePending.length) {
        groups.push({ cls: 'pending', title: '需重新确认', ids: ch.becamePending });
      }
      if (ch.becameInactive.length) {
        groups.push({ cls: 'inactive', title: '转为保留未激活', ids: ch.becameInactive });
      }
      if (ch.becameInactiveSteps.length) {
        const g0 = { cls: 'inactive', title: '步骤转为未激活', ids: [], steps: ch.becameInactiveSteps };
        groups.push(g0);
      }
      if (ch.becameReachable.length) {
        groups.push({ cls: 'ok', title: '恢复激活（答案原样回来）', ids: ch.becameReachable });
      }
      if (ch.reactivatedSteps && ch.reactivatedSteps.length) {
        groups.push({ cls: 'ok', title: '步骤恢复激活', ids: [], steps: ch.reactivatedSteps });
      }

      if (!groups.length && !pendingNow.length) {
        const ok = document.createElement('div');
        ok.className = 'impact-empty';
        ok.textContent = '本次修改没有影响其他已填内容。';
        body.appendChild(ok);
      }

      groups.forEach((grp) => {
        const g = document.createElement('div');
        g.className = 'impact-group';
        const count = (grp.ids ? grp.ids.length : 0) + (grp.steps ? grp.steps.length : 0);
        g.innerHTML = '<div class="impact-group-title ' + grp.cls + '">' + esc(grp.title) +
          '（' + count + '）</div>';
        (grp.ids || []).forEach((id) => {
          const { def, step } = qMeta[id];
          const pill = document.createElement('span');
          pill.className = 'impact-pill ' + grp.cls;
          pill.innerHTML = esc(def.title) + ' <span class="pid">' + esc(id) + '</span>';
          pill.addEventListener('click', () => {
            guide.goTo(step.id); renderAll();
            setTimeout(() => {
              const c = $('qcard-' + id);
              if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 0);
          });
          g.appendChild(pill);
        });
        (grp.steps || []).forEach((sid) => {
          const pill = document.createElement('span');
          pill.className = 'impact-pill ' + grp.cls;
          pill.textContent = '步骤：' + stepById[sid].title;
          pill.addEventListener('click', () => { guide.goTo(sid); renderAll(); });
          g.appendChild(pill);
        });
        body.appendChild(g);
      });
    } else if (!pendingNow.length) {
      body.innerHTML = '<div class="impact-empty">尚未作答。<br>回答后，这里会即时显示哪些后续内容受影响及判定依据。</div>';
    }

    // 3) 依据明细（当前待重确认问题的完整依据链）
    pendingNow.forEach((id) => {
      const { def } = qMeta[id];
      const reasons = st.reasons[id] || [];
      const d = document.createElement('div');
      d.className = 'impact-detail';
      let html = '<strong>' + esc(def.title) + '</strong>';
      reasons.forEach((r) => {
        if (r.kind === 'upstream') {
          html += '<div>上游「' + esc(r.depTitle) + '」待确认，波及本题';
          if (r.path) html += '<span class="chain">' + esc(r.path
            .map((x) => qMeta[x] ? qMeta[x].def.title : x).join(' → ')) + '</span>';
          html += '</div>';
        } else {
          const verb = { changed: '由', deactivated: '原值', reactivated: '现值' }[r.kind];
          html += '<div>「' + esc(r.depTitle) + '」' +
            ({ changed: '答案改变', deactivated: '变为未激活', reactivated: '重新激活' }[r.kind]) + '</div>';
        }
      });
      d.innerHTML = html;
      body.appendChild(d);
    });
  }

  function announceChange() { /* 影响由 renderImpact 统一渲染，此函数保留便于扩展 */ }

  // ---------------------------------------------------------------------------
  // 进度
  // ---------------------------------------------------------------------------
  function renderProgress() {
    const p = guide.progress();
    $('progress-text').textContent = '已确认 ' + p.confirmed + ' / ' + p.required + ' 项必答' +
      (p.pending ? '（' + p.pending + ' 项待重确认）' : '');
    $('progress-percent').textContent = p.percent + '%';
    $('progress-bar').style.width = p.percent + '%';
  }

  // ---------------------------------------------------------------------------
  // 校验演示
  // ---------------------------------------------------------------------------
  const BAD_CONFIGS = {
    dup: () => ({
      title: '错误示例①：标识重复',
      steps: [{
        id: 's1', title: '步骤1',
        questions: [
          { id: 'q1', title: '问题一', type: 'text' },
          { id: 'q1', title: '问题二（重复 id）', type: 'text' }
        ]
      }]
    }),
    ghost: () => ({
      title: '错误示例②：依赖引用了不存在的标识',
      steps: [{
        id: 's1', title: '步骤1',
        questions: [
          { id: 'q1', title: '问题一', type: 'radio', options: [{ value: 'a', label: 'A' }] },
          { id: 'q2', title: '问题二', type: 'text', dependsOn: ['q_typo'], condition: (a) => a.q_typo === 'a' }
        ]
      }]
    }),
    cycle: () => ({
      title: '错误示例③：依赖成环',
      steps: [{
        id: 's1', title: '步骤1',
        questions: [
          { id: 'a', title: '问题A', type: 'text', dependsOn: ['c'], condition: (x) => !!x.c },
          { id: 'b', title: '问题B', type: 'text', dependsOn: ['a'], condition: (x) => !!x.a },
          { id: 'c', title: '问题C', type: 'text', dependsOn: ['b'], condition: (x) => !!x.b }
        ]
      }]
    })
  };

  function runBadDemo(kind) {
    const bad = BAD_CONFIGS[kind]();
    const result = $('validate-result');
    result.hidden = false;
    const v = validateConfig(bad);
    let html = '<div style="font-weight:700;margin-bottom:8px;">' + esc(bad.title) + ' → 已拒绝加载 ✗</div>';
    if (v.valid) {
      html += '（意外通过）';
    } else {
      html += v.errors.map((e) =>
        '<div class="verror"><span class="vcode">[' + esc(e.code) + ']</span> ' + esc(e.message) +
        '<span class="vloc">位置：' + esc(e.location) + '</span>' +
        (e.chain ? '<span class="vchain">链条：' + esc(e.chain.map((n) => n.id).join(' → ')) + '</span>' : '') +
        '</div>').join('');
    }
    result.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // toast / 重置 / 总渲染
  // ---------------------------------------------------------------------------
  let toastTimer = null;
  function toast(msg, kind) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function renderAll() {
    renderStepper();
    renderWorkspace();
    renderImpact();
    renderProgress();
  }

  $('btn-next').addEventListener('click', tryAdvance);
  $('btn-back').addEventListener('click', () => { guide.back(); renderAll(); });
  $('btn-skip').addEventListener('click', toggleSkip);
  $('btn-reset').addEventListener('click', () => {
    if (!confirm('确定清空全部填写并重新开始吗？')) return;
    guide = createGuide(CONFIG);
    renderAll();
    toast('已重置', 'ok');
  });
  $('btn-submit').addEventListener('click', () => {
    if (!guide.canFinish()) { toast('仍有必答内容未确认', 'error'); return; }
    toast('✅ 已模拟提交（离线环境，数据未离开本机）', 'ok');
  });
  document.querySelectorAll('[data-bad]').forEach((btn) =>
    btn.addEventListener('click', () => runBadDemo(btn.getAttribute('data-bad'))));

  // 启动即出现可操作界面
  document.getElementById('app-title').textContent = CONFIG.title;
  window.__guide = guide; // 调试钩子：可在控制台检查状态
  renderAll();

  // 演示种子：#seed 自动构造一个「改答后下游待重新确认」的典型场景，便于快速验收
  if (location.hash === '#seed') seedDemo();
  // #seed2 构造一个「专项步骤失活、答案保留未激活」的场景
  if (location.hash === '#seed2') seedInactiveDemo();
  // #block 在首题未答时尝试前进，触发守卫阻止面板
  if (location.hash === '#block') $('btn-next').click();

  function seedDemo() {
    const g = window.__guide;
    g.answer('applicant_type', 'person'); g.advance('s_identity');
    g.answer('person_name', '张三'); g.answer('person_id', '110101199001011234'); g.advance('s_basic');
    g.answer('subsidy_type', 'hire'); g.advance('s_subsidy');
    g.answer('employee_total', 10);
    g.answer('new_hires', 2);
    g.answer('avg_salary', 5000);
    // 回头改上游数字：new_hires / avg_salary 条件仍成立，但需重新确认
    g.answer('employee_total', 20);
    renderAll();
  }

  function seedInactiveDemo() {
    const g = window.__guide;
    g.answer('applicant_type', 'person'); g.advance('s_identity');
    g.answer('person_name', '张三'); g.answer('person_id', '110101199001011234'); g.advance('s_basic');
    g.answer('subsidy_type', 'startup'); g.advance('s_subsidy');
    g.answer('license_no', '91110120260001'); g.answer('startup_date', '2026-03-01'); g.answer('hire_plan', false);
    // 回头把补贴类型改为培训：创业专项步骤整体失活，已填三项转为「保留未激活」
    g.goTo('s_subsidy');
    g.answer('subsidy_type', 'training');
    g.goTo('s_startup'); // 进入失活步骤查看保留内容
    renderAll();
  }
})();
