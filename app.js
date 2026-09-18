/* 界面交互：渲染步骤序列（四态）、问题卡片、影响判定面板、导航阻止提示 */
(function () {
  'use strict';

  const STORAGE_KEY = 'guided-flow-session-v1';
  const FLOW_KEY = 'guided-flow-definition-v1';

  const STATUS_LABEL = {
    confirmed: '已确认',
    stale: '待重新确认',
    inactive: '未激活',
    unreached: '未到达',
  };
  const OUTCOME_META = {
    reconfirm: { title: '必须重新确认', cls: 'g-reconfirm' },
    deactivated: { title: '转为未激活（答案保留）', cls: 'g-deactivated' },
    reactivated: { title: '恢复激活（原样回到流程）', cls: 'g-reactivated' },
    keep: { title: '可继续沿用（不受影响）', cls: 'g-keep' },
  };

  let flowDef = loadFlowDef();
  let session = createSession(flowDef);
  let lastImpact = null;   // 最近一次改答的影响报告
  let lastBlock = null;    // 最近一次被阻止的操作
  let submitted = false;

  function loadFlowDef() {
    try {
      const raw = localStorage.getItem(FLOW_KEY);
      if (raw) {
        const def = JSON.parse(raw);
        if (FlowEngine.validateFlow(def).ok) return def;
      }
    } catch (e) { /* 忽略损坏的自定义流程，回退到演示流程 */ }
    return DEMO_FLOW;
  }

  function createSession(def) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { /* 忽略 */ }
    try {
      return FlowEngine.createSession(def, saved);
    } catch (e) {
      return FlowEngine.createSession(def);
    }
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, session.serialize()); } catch (e) { /* 离线存储不可用时静默 */ }
  }

  /* ---------------- 渲染 ---------------- */

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const fmtVal = (v) => (v === true ? '是' : v === false ? '否' : JSON.stringify(v));

  function render() {
    const st = session.getState();
    $('flow-title').textContent = st.flowTitle;
    renderProgress(st);
    renderSteps(st);
    renderMain(st);
    renderImpact();
    renderBlock();
    persist();
  }

  function renderProgress(st) {
    const p = st.progress;
    const pct = p.total ? Math.round((p.confirmed / p.total) * 100) : 0;
    $('progress-fill').style.width = pct + '%';
    $('progress-text').textContent =
      `已确认 ${p.confirmed}/${p.total}` + (p.stale ? ` · 待重新确认 ${p.stale}` : '');
  }

  function renderSteps(st) {
    const nav = $('step-list');
    nav.innerHTML = '';
    let lastPhase = null;
    st.steps.forEach((s) => {
      if (s.phase !== lastPhase) {
        lastPhase = s.phase;
        nav.appendChild(el('div', 'phase-label', s.phase || '未分阶段'));
      }
      const item = el('div', `step-item s-${s.status}` + (s.current ? ' current' : '') + (s.status === 'inactive' ? ' locked' : ''));
      const no = el('span', 'step-no', String(s.index + 1));
      const body = el('div', 'step-body');
      body.appendChild(el('div', 'step-title', s.title));
      const meta = el('div', 'step-meta');
      meta.appendChild(el('span', `badge ${s.status}`, STATUS_LABEL[s.status]));
      if (s.skippable) meta.appendChild(el('span', 'badge tag', '可跳过'));
      if (s.status !== 'inactive') meta.appendChild(el('span', '', `${s.progress.confirmed}/${s.progress.total}`));
      body.appendChild(meta);
      item.appendChild(no);
      item.appendChild(body);
      item.title = s.status === 'inactive' ? (s.inactiveReason || '未激活') : s.title;
      item.addEventListener('click', () => {
        if (s.current) return;
        const r = session.goToStep(s.index);
        if (!r.ok) showBlock(r);
        else { lastBlock = null; }
        render();
      });
      nav.appendChild(item);
    });
  }

  function renderMain(st) {
    const view = $('step-view');
    view.innerHTML = '';
    const s = st.steps[st.currentStep];

    const head = el('div', 'step-head');
    const h2 = el('h2');
    h2.appendChild(el('span', '', s.title));
    h2.appendChild(el('span', `badge ${s.status}`, STATUS_LABEL[s.status]));
    if (s.skippable) h2.appendChild(el('span', 'badge tag', '可跳过'));
    head.appendChild(h2);
    head.appendChild(el('div', 'sub', `阶段：${s.phase || '—'} · 第 ${s.index + 1} 步 / 共 ${st.steps.length} 步`));
    if (s.status === 'inactive') {
      head.appendChild(el('div', 'inactive-note',
        `本步骤当前未激活：${s.inactiveReason}。其下答案已保留，条件恢复后将原样回到流程。`));
    }
    view.appendChild(head);

    if (submitted) {
      view.appendChild(el('div', 'submit-done', '✓ 已提交。全部必答问题均已确认，感谢使用。'));
      return;
    }

    s.questions.forEach((q) => view.appendChild(renderQuestion(q)));

    // 导航按钮可用性
    $('btn-prev').disabled = s.index === 0;
    $('btn-skip').classList.toggle('hidden', !s.skippable);
    const isLast = !st.steps.some((x) => x.index > s.index && x.status !== 'inactive');
    $('btn-next').classList.toggle('hidden', isLast);
    $('btn-submit').classList.toggle('hidden', !isLast);
  }

  function renderQuestion(q) {
    const card = el('div', `q-card ${q.status}`);
    const head = el('div', 'q-head');
    const text = el('div', 'q-text');
    text.appendChild(document.createTextNode(q.text));
    if (q.required) text.appendChild(el('span', 'req', ' *'));
    else text.appendChild(el('span', 'opt', '（选答）'));
    head.appendChild(text);
    head.appendChild(el('span', `badge ${q.status}`, STATUS_LABEL[q.status]));
    card.appendChild(head);

    const body = el('div', 'q-body');

    if (q.status === 'inactive') {
      const kept = el('div', 'kept-answer inactive');
      kept.appendChild(el('span', '', q.answerKept ? `原答案已保留：${fmtVal(q.answer)}` : '尚未作答'));
      body.appendChild(kept);
      body.appendChild(el('div', 'q-reason', `未激活原因：${q.reason}`));
    } else if (q.status === 'stale') {
      body.appendChild(buildInput(q, q.answer));
      const kept = el('div', 'kept-answer stale');
      kept.appendChild(el('span', '', `原答案已保留：${fmtVal(q.answer)}，受改答影响需重新确认`));
      const actions = el('div', 'kept-actions');
      const okBtn = el('button', 'btn small', '确认沿用此答案');
      okBtn.addEventListener('click', () => {
        session.confirmAnswer(q.id);
        lastBlock = null;
        render();
      });
      actions.appendChild(okBtn);
      kept.appendChild(actions);
      body.appendChild(kept);
    } else {
      body.appendChild(buildInput(q, q.answer));
    }

    card.appendChild(body);
    return card;
  }

  function buildInput(q, value) {
    const wrap = el('div');
    const commit = (v) => {
      const r = session.setAnswer(q.id, v);
      if (r.ok && r.changed) { lastImpact = r.impact; lastBlock = null; }
      render();
    };
    if (q.type === 'boolean') {
      const row = el('div', 'bool-row');
      [[true, '是'], [false, '否']].forEach(([v, label]) => {
        const b = el('button', 'bool-btn' + (value === v ? ' selected' : ''), label);
        b.addEventListener('click', () => commit(v));
        row.appendChild(b);
      });
      wrap.appendChild(row);
    } else if (q.type === 'choice') {
      const list = el('div', 'choice-list');
      (q.options || []).forEach((opt) => {
        const item = el('div', 'choice-item' + (value === opt.value ? ' selected' : ''));
        const radio = el('input');
        radio.type = 'radio';
        radio.checked = value === opt.value;
        radio.name = 'q-' + q.id;
        item.appendChild(radio);
        item.appendChild(el('span', '', opt.label != null ? opt.label : String(opt.value)));
        item.addEventListener('click', () => commit(opt.value));
        list.appendChild(item);
      });
      wrap.appendChild(list);
    } else {
      const input = el('input', 'text-input');
      input.type = q.type === 'number' ? 'number' : 'text';
      if (value !== undefined && value !== null) input.value = value;
      input.placeholder = q.status === 'stale' ? '修改后自动重新确认；或直接点“确认沿用此答案”' : '请输入';
      input.addEventListener('change', () => {
        const v = q.type === 'number' ? (input.value === '' ? undefined : Number(input.value)) : input.value;
        if (v === undefined || v === '') return;
        commit(v);
      });
      wrap.appendChild(input);
    }
    return wrap;
  }

  /* ---------------- 影响面板 ---------------- */

  function renderImpact() {
    const panel = $('impact-panel');
    panel.innerHTML = '';
    if (!lastImpact || !lastImpact.length) {
      panel.className = 'impact-panel empty';
      panel.textContent = lastImpact ? '本次改答未影响任何其他内容' : '尚未发生改答';
      return;
    }
    panel.className = 'impact-panel';
    const groups = { reconfirm: [], deactivated: [], reactivated: [], keep: [] };
    lastImpact.forEach((i) => groups[i.outcome] && groups[i.outcome].push(i));
    Object.keys(OUTCOME_META).forEach((key) => {
      const items = groups[key];
      if (!items.length) return;
      const meta = OUTCOME_META[key];
      const g = el('div', 'impact-group');
      const h = el('h5');
      h.appendChild(el('i', `dot ${key === 'reconfirm' ? 'st-stale' : key === 'deactivated' ? 'st-inactive' : key === 'reactivated' ? 'st-confirmed' : 'st-unreached'}`));
      h.appendChild(document.createTextNode(`${meta.title}（${items.length}）`));
      g.appendChild(h);
      items.forEach((i) => {
        const item = el('div', `impact-item ${meta.cls}`);
        item.appendChild(el('div', 'who', (i.type === 'step' ? '步骤：' : '') + (i.title || i.text || i.id)));
        item.appendChild(el('div', 'why', '依据：' + i.reason));
        if (i.preserved !== undefined) item.appendChild(el('div', 'kept', `原答案保留：${fmtVal(i.preserved)}`));
        if (i.chain && i.chain.length > 1) item.appendChild(el('div', 'chain', '链条：' + i.chain.join(' → ')));
        g.appendChild(item);
      });
      panel.appendChild(g);
    });
  }

  /* ---------------- 阻止提示 ---------------- */

  function showBlock(r) {
    lastBlock = r;
  }

  function renderBlock() {
    const panel = $('block-panel');
    panel.innerHTML = '';
    if (!lastBlock) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    const close = el('button', 'btn small close', '知道了');
    close.addEventListener('click', () => { lastBlock = null; render(); });
    panel.appendChild(close);
    panel.appendChild(el('h4', '', '已阻止：' + (lastBlock.message || '操作不被允许')));
    if (lastBlock.missing && lastBlock.missing.length) {
      const ul = el('ul');
      lastBlock.missing.forEach((m) => {
        const li = el('li');
        li.appendChild(el('div', '', `缺失问题：${m.text || m.id}（${m.cause}）`));
        (m.basis || []).forEach((b) => li.appendChild(el('div', 'basis', '判定依据：' + b)));
        ul.appendChild(li);
      });
      panel.appendChild(ul);
    }
    if (lastBlock.chain) {
      const chainText = Array.isArray(lastBlock.chain) ? lastBlock.chain.join('；') : lastBlock.chain;
      panel.appendChild(el('div', 'basis', '依赖链：' + chainText));
    }
  }

  /* ---------------- 导航 ---------------- */

  $('btn-prev').addEventListener('click', () => {
    const r = session.prev();
    if (!r.ok) showBlock(r); else lastBlock = null;
    render();
  });
  $('btn-next').addEventListener('click', () => {
    const r = session.next();
    if (!r.ok) showBlock(r); else lastBlock = null;
    render();
  });
  $('btn-skip').addEventListener('click', () => {
    const r = session.skip();
    if (!r.ok) showBlock(r); else lastBlock = null;
    render();
  });
  $('btn-submit').addEventListener('click', () => {
    const st = session.getState();
    if (!st.canSubmit) {
      showBlock({ message: '仍有必答问题未确认，无法提交，已填内容与状态未改动', missing: collectMissing(st) });
    } else {
      submitted = true;
      toast('提交成功');
    }
    render();
  });

  function collectMissing(st) {
    const out = [];
    st.steps.forEach((s) => s.questions.forEach((q) => {
      if (q.required && (q.status === 'unreached' || q.status === 'stale')) {
        out.push({ id: q.id, text: q.text, cause: q.status === 'stale' ? '待重新确认' : '尚未作答', basis: [`位于步骤「${s.title}」`] });
      }
    }));
    return out;
  }

  /* ---------------- 顶栏操作 ---------------- */

  $('btn-reset').addEventListener('click', () => {
    if (!confirm('确定要清空全部已填内容并重新开始吗？')) return;
    localStorage.removeItem(STORAGE_KEY);
    session = createSession(flowDef);
    lastImpact = null; lastBlock = null; submitted = false;
    render();
  });

  const dialog = $('io-dialog');
  let ioMode = null;
  function openDialog(mode) {
    ioMode = mode;
    $('io-errors').innerHTML = '';
    if (mode === 'export') {
      $('io-title').textContent = '导出进度';
      $('io-desc').textContent = '复制以下 JSON，可在本机稍后或其他离线终端恢复。';
      $('io-text').value = session.serialize();
      $('io-ok').textContent = '复制并关闭';
    } else if (mode === 'import') {
      $('io-title').textContent = '导入进度';
      $('io-desc').textContent = '粘贴之前导出的进度 JSON。';
      $('io-text').value = '';
      $('io-ok').textContent = '恢复';
    } else {
      $('io-title').textContent = '自定义流程定义';
      $('io-desc').textContent = '粘贴流程 JSON（steps / questions / 依赖与条件）。重复标识、悬空引用、依赖环会被拒绝并指出位置。';
      $('io-text').value = JSON.stringify(flowDef, null, 2);
      $('io-ok').textContent = '校验并载入';
    }
    dialog.showModal();
  }
  $('btn-export').addEventListener('click', () => openDialog('export'));
  $('btn-import').addEventListener('click', () => openDialog('import'));
  $('btn-custom').addEventListener('click', () => openDialog('custom'));
  $('io-cancel').addEventListener('click', () => dialog.close());
  $('io-ok').addEventListener('click', () => {
    if (ioMode === 'export') {
      $('io-text').select();
      const done = () => { dialog.close(); toast('已复制到剪贴板'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText($('io-text').value).then(done, () => { document.execCommand('copy'); done(); });
      } else { document.execCommand('copy'); done(); }
      return;
    }
    const raw = $('io-text').value;
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { showIoErrors([{ path: '(json)', message: 'JSON 解析失败：' + e.message }]); return; }
    if (ioMode === 'import') {
      try {
        session = FlowEngine.createSession(flowDef, data);
        lastImpact = null; lastBlock = null; submitted = false;
        dialog.close(); render(); toast('进度已恢复');
      } catch (e) { showIoErrors([{ path: '(session)', message: e.message }]); }
      return;
    }
    // custom flow：先校验，拒绝时逐项指出位置
    const check = FlowEngine.validateFlow(data);
    if (!check.ok) { showIoErrors(check.errors); return; }
    flowDef = data;
    try { localStorage.setItem(FLOW_KEY, JSON.stringify(data)); } catch (e) { /* 忽略 */ }
    localStorage.removeItem(STORAGE_KEY);
    session = createSession(flowDef);
    lastImpact = null; lastBlock = null; submitted = false;
    dialog.close(); render(); toast('流程已载入');
  });

  function showIoErrors(errors) {
    const box = $('io-errors');
    box.innerHTML = '';
    errors.forEach((e) => {
      box.appendChild(el('div', '', `✗ 位置 ${e.path}：${e.message}`));
    });
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
  }

  render();
})();
