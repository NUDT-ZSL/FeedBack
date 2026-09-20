/* 界面逻辑：每次结构/归属变化都整体收敛 + analyze 重推，保证与全局结果一致 */
(function () {
  'use strict';
  const E = window.FormEngine;
  const STORE_KEY = 'form-step-load:v1';

  let state = load() || window.FormSample.sampleForm();
  let autoConverge = true;
  let lastResult = null;

  function load() {
    try { const raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function uid(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 8);
  }
  function fieldById(id) { return state.fields.find(f => f.id === id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 统一入口：任何修改后整体重推
  function commit() {
    persist();
    if (autoConverge) {
      const c = E.converge(state);
      state = c.form;
      persist();
    }
    lastResult = E.analyze(state);
    render();
  }

  function render() {
    renderOverview();
    renderAlerts();
    renderSteps();
    renderSide();
    syncConfigInputs();
  }

  function renderOverview() {
    const s = lastResult.summary;
    const blockedCls = s.blockedFieldCount ? 'bad' : 'good';
    const confCls = s.conflictFieldCount ? 'warn' : 'good';
    document.getElementById('overview').innerHTML =
      stat(s.activeFieldCount, '启用字段', '') +
      stat(s.stepCount, '分步数', '') +
      stat(s.maxTotalRead, '单步最高阅读量', s.maxTotalRead >= lastResult.config.readThreshold ? 'warn' : '') +
      stat(s.blockedFieldCount, '不可完成字段', blockedCls) +
      stat(s.blockedSteps.length, '不可完成步骤', s.blockedSteps.length ? 'bad' : 'good') +
      stat(s.conflictFieldCount, '要求冲突字段', confCls) +
      stat(s.excludedCount, '已排除字段', '');
  }
  function stat(num, lab, cls) {
    return '<div class="stat ' + cls + '"><div class="num">' + num + '</div><div class="lab">' + lab + '</div></div>';
  }

  function renderAlerts() {
    const box = document.getElementById('globalAlerts');
    const alerts = [];
    if (lastResult.summary.blockedSteps.length) {
      const names = lastResult.summary.blockedSteps.map(i => '步骤' + (i + 1)).join('、');
      alerts.push('<div class="alert red">以下步骤不可完成：' + esc(names) +
        '。红色字段及其阻断依据见各步明细。</div>');
    }
    if (lastResult.conflictFields.length) {
      alerts.push('<div class="alert amber">有 ' + lastResult.conflictFields.length +
        ' 个字段被多条依赖提出互斥要求，全部依据已保留并在右侧"要求冲突"中列出，系统未静默取舍。</div>');
    }
    lastResult.steps.forEach(st => {
      if (st.highRead) alerts.push('<div class="alert amber">步骤' + (st.index + 1) +
        ' 阅读量 ' + st.totalRead + '（本步 ' + st.localRead + '＋回忆 ' + st.recallRead +
        '）达到高负担阈值 ' + lastResult.config.readThreshold + '。</div>');
      if (st.highRequired) alerts.push('<div class="alert amber">步骤' + (st.index + 1) +
        ' 必填项 ' + st.requiredCount + ' 个，达到高必填压力阈值 ' + lastResult.config.requiredThreshold + '。</div>');
    });
    box.innerHTML = alerts.join('');
  }
  function depEdge(depId) { return state.dependencies.find(d => d.id === depId); }
  function depText(e) {
    const s = fieldById(e.source), t = fieldById(e.target);
    return (s ? s.label : e.source) + ' 依赖 ' + (t ? t.label : e.target) +
      '（要求：' + E.KIND_LABELS[e.requirement] + '）';
  }

  function renderSteps() {
    const wrap = document.getElementById('steps');
    wrap.innerHTML = lastResult.steps.map(st => {
      const badges =
        '<span class="badge read">阅读量 ' + st.totalRead +
          (st.recallRead ? '（本步' + st.localRead + '＋回忆' + st.recallRead + '）' : '') + '</span>' +
        '<span class="badge req">必填 ' + st.requiredCount + '</span>' +
        '<span class="badge read">前置未满足 ' + st.unmetCount + '</span>' +
        (st.highRead ? '<span class="badge high">高阅读</span>' : '') +
        (st.highRequired ? '<span class="badge high">高必填压力</span>' : '') +
        (st.conflictCount ? '<span class="badge conflict">冲突字段 ' + st.conflictCount + '</span>' : '') +
        (st.blocked ? '<span class="badge block">本步不可完成</span>'
                   : '<span class="badge ok">可完成</span>');
      const rows = st.fieldIds.map(id => fieldRow(id, st)).join('');
      const reasons = renderStepReasons(st);
      return '<div class="step-card' + (st.blocked ? ' blocked' : '') + '">' +
        '<div class="step-head"><span class="step-idx">步骤 ' + (st.index + 1) + '</span>' +
        '<span class="step-name">' + esc(state.stepNames && state.stepNames[st.index] ||
          ('步骤 ' + (st.index + 1))) + '</span>' + badges + '</div>' +
        '<div class="step-body">' + rows + reasons + '</div></div>';
    }).join('');
    bindStepEvents();
  }

  function fieldRow(id, st) {
    const f = fieldById(id);
    const rep = lastResult.fieldReports.get(id);
    const cls = rep.blocked ? 'blocked' : (rep.conflicts.length ? 'conflict' : '');
    const edgeReq = rep.outgoing.some(e => e.requirement === 'required');
    const tags =
      (f.required ? '<span class="tag req">必填</span>' : '') +
      (edgeReq && !f.required ? '<span class="tag req">依赖要求必填</span>' : '') +
      ('<span class="tag">阅读量 ' + (f.readWeight || 1) + '</span>') +
      (f.locked ? '<span class="tag lock">已锁定</span>' : '') +
      (rep.blocked ? '<span class="tag block">不可完成</span>' : '') +
      (rep.conflicts.length ? '<span class="tag conflict">要求冲突</span>' : '');
    const disL = (f.locked || st.index === 0) ? 'disabled' : '';
    const disR = (f.locked || st.index === lastResult.config.stepCount - 1) ? 'disabled' : '';
    return '<div class="field-row ' + cls + '" data-id="' + esc(f.id) + '">' +
      '<button class="mini act-left" title="移到上一步" ' + disL + '>←</button>' +
      '<button class="mini act-right" title="移到下一步" ' + disR + '>→</button>' +
      '<span><span class="field-name">' + esc(f.label) + '</span> ' +
      '<span class="field-id">' + esc(f.id) + '</span></span>' +
      '<span class="field-tags">' + tags + '</span>' +
      '<span class="field-actions"><button class="mini act-edit" title="编辑">✎</button></span>' +
      '</div>';
  }

  function renderStepReasons(st) {
    if (!st.blockReasons.length) return '';
    const items = [];
    st.blockReasons.forEach(br => {
      const f = fieldById(br.fieldId);
      br.reasons.forEach(r => {
        let line = '';
        if (r.depId) { const e = depEdge(r.depId); if (e) line = '<span class="dep-line">依据：' + esc(depText(e)) + '</span>'; }
        items.push('<li><b>' + esc(f.label) + '：</b>' + esc(r.text) + line + '</li>');
      });
    });
    return '<ul class="reason-list">' + items.join('') + '</ul>';
  }

  function bindStepEvents() {
    document.querySelectorAll('.field-row').forEach(row => {
      const id = row.getAttribute('data-id');
      const f = fieldById(id);
      row.querySelector('.act-left') && row.querySelector('.act-left').addEventListener('click', () => {
        if (!f.locked && f.step > 0) { f.step--; commit(); }
      });
      row.querySelector('.act-right') && row.querySelector('.act-right').addEventListener('click', () => {
        if (!f.locked && f.step < state.config.stepCount - 1) { f.step++; commit(); }
      });
      row.querySelector('.act-edit').addEventListener('click', () => openFieldDialog(id));
    });
  }
  function renderSide() {
    // 要求冲突：保留全部依据
    const cpanel = document.getElementById('conflictsPanel');
    if (!lastResult.conflictFields.length) {
      cpanel.innerHTML = '<h3>要求冲突</h3><p class="muted">当前没有字段被多条依赖提出互斥要求。</p>';
    } else {
      cpanel.innerHTML = '<h3>要求冲突（全部依据已保留）</h3>' +
        lastResult.conflictFields.map(id => {
          const f = fieldById(id);
          const rep = lastResult.fieldReports.get(id);
          return rep.conflicts.map(c =>
            '<div class="conflict-item"><b>' + esc(f.label) + '</b>：' +
            esc(c.kinds.map(k => E.KIND_LABELS[k]).join(' vs ')) +
            '<div class="ev">' + c.evidence.map(e =>
              '<div>· ' + esc(depText(e)) + '</div>').join('') + '</div></div>').join('');
        }).join('');
    }
    // 已排除字段与依赖列表
    const epanel = document.getElementById('excludedPanel');
    const excluded = state.fields.filter(f => f.excluded);
    const depChips = state.dependencies.map(d => {
      const s = fieldById(d.source), t = fieldById(d.target);
      const bad = s && t && !s.excluded && !t.excluded && t.step > s.step;
      return '<div class="dep-chip' + (bad ? ' bad' : '') + '"><span class="kind">' +
        esc(E.KIND_LABELS[d.requirement]) + '</span><span>' +
        esc(s ? s.label : d.source) + ' → ' + esc(t ? t.label : d.target) + '</span>' +
        '<button class="mini act-dep-edit" data-did="' + esc(d.id) + '" style="margin-left:auto">✎</button></div>';
    }).join('');
    epanel.innerHTML = '<h3>依赖关系（' + state.dependencies.length + '）</h3>' +
      (state.dependencies.length ? depChips : '<p class="muted">暂无依赖</p>') +
      '<h3 style="margin-top:14px">已排除字段（' + excluded.length + '）</h3>' +
      (excluded.length ? excluded.map(f =>
        '<div class="excluded-item"><span>' + esc(f.label) + '</span>' +
        '<span class="field-id">' + esc(f.id) + '</span>' +
        '<button class="mini act-restore" data-id="' + esc(f.id) + '" style="margin-left:auto">↺</button></div>').join('')
        : '<p class="muted">暂无排除字段。可点击字段 ✎ 勾选"排除出表单"。</p>');
    epanel.querySelectorAll('.act-dep-edit').forEach(b =>
      b.addEventListener('click', () => openDepDialog(b.getAttribute('data-did'))));
    epanel.querySelectorAll('.act-restore').forEach(b =>
      b.addEventListener('click', () => {
        fieldById(b.getAttribute('data-id')).excluded = false;
        commit();
      }));
  }

  function syncConfigInputs() {
    document.getElementById('cfgSteps').value = state.config.stepCount;
    document.getElementById('cfgRead').value = state.config.readThreshold;
    document.getElementById('cfgRequired').value = state.config.requiredThreshold;
  }

  function range(n) { return Array.from({ length: n }, (_, i) => i); }
  // ---- 字段编辑弹窗 ----
  const fieldDialog = document.getElementById('fieldDialog');
  function openFieldDialog(id) {
    const f = fieldById(id);
    document.getElementById('f_id').value = f.id;
    document.getElementById('f_label').value = f.label || f.id;
    document.getElementById('f_step').innerHTML = range(state.config.stepCount).map(i =>
      '<option value="' + i + '"' + (i === f.step ? ' selected' : '') + '>步骤 ' + (i + 1) + '</option>').join('');
    document.getElementById('f_weight').value = f.readWeight || 1;
    document.getElementById('f_required').checked = !!f.required;
    document.getElementById('f_locked').checked = !!f.locked;
    document.getElementById('f_excluded').checked = !!f.excluded;
    fieldDialog.showModal();
  }
  document.getElementById('f_save').addEventListener('click', () => {
    const f = fieldById(document.getElementById('f_id').value);
    f.label = document.getElementById('f_label').value.trim() || f.id;
    if (!f.locked) f.step = parseInt(document.getElementById('f_step').value, 10) || 0;
    f.readWeight = parseInt(document.getElementById('f_weight').value, 10) || 1;
    f.required = document.getElementById('f_required').checked;
    f.locked = document.getElementById('f_locked').checked;
    f.excluded = document.getElementById('f_excluded').checked;
    commit();
  });
  document.getElementById('f_delete').addEventListener('click', () => {
    const id = document.getElementById('f_id').value;
    if (!confirm('删除字段「' + id + '」及其全部依赖？')) return;
    state.fields = state.fields.filter(f => f.id !== id);
    state.dependencies = state.dependencies.filter(d => d.source !== id && d.target !== id);
    fieldDialog.close();
    commit();
  });

  // ---- 依赖编辑弹窗 ----
  const depDialog = document.getElementById('depDialog');
  function fieldOptions(sel) {
    return state.fields.map(f =>
      '<option value="' + esc(f.id) + '"' + (sel === f.id ? ' selected' : '') + '>' +
      esc(f.label) + '（' + esc(f.id) + '）</option>').join('');
  }
  function openDepDialog(did) {
    const d = did ? state.dependencies.find(x => x.id === did) : null;
    document.getElementById('d_id').value = d ? d.id : '';
    document.getElementById('d_source').innerHTML = fieldOptions(d && d.source);
    document.getElementById('d_target').innerHTML = fieldOptions(d && d.target);
    document.getElementById('d_kind').innerHTML = E.KINDS.map(k =>
      '<option value="' + k + '"' + (d && d.requirement === k ? ' selected' : '') +
      '>' + E.KIND_LABELS[k] + '</option>').join('');
    depDialog.showModal();
  }
  document.getElementById('depForm').addEventListener('submit', ev => {
    if (ev.submitter && ev.submitter.value !== 'ok') return;
    const did = document.getElementById('d_id').value;
    const payload = {
      source: document.getElementById('d_source').value,
      target: document.getElementById('d_target').value,
      requirement: document.getElementById('d_kind').value
    };
    if (payload.source === payload.target) { alert('依赖方与前置不能是同一字段'); ev.preventDefault(); return; }
    if (did) Object.assign(state.dependencies.find(d => d.id === did), payload);
    else state.dependencies.push(Object.assign({ id: uid('d') }, payload));
    commit();
  });
  document.getElementById('d_delete').addEventListener('click', () => {
    const did = document.getElementById('d_id').value;
    if (did) state.dependencies = state.dependencies.filter(d => d.id !== did);
    depDialog.close();
    commit();
  });
  // ---- 工具栏与参数 ----
  document.getElementById('autoConverge').addEventListener('change', e => {
    autoConverge = e.target.checked;
    commit();
  });
  document.getElementById('btnConverge').addEventListener('click', () => {
    state = E.converge(state).form;
    commit();
  });
  document.getElementById('btnAddField').addEventListener('click', () => {
    const id = uid('field');
    state.fields.push({ id: id, label: '新字段 ' + state.fields.length, step: 0,
      readWeight: 1, required: false, locked: false, excluded: false });
    commit();
    openFieldDialog(id);
  });
  document.getElementById('btnAddDep').addEventListener('click', () => openDepDialog(null));
  document.getElementById('btnReset').addEventListener('click', () => {
    if (!confirm('放弃当前调整并恢复内置示例？')) return;
    state = window.FormSample.sampleForm();
    commit();
  });
  document.getElementById('btnExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'form-structure.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById('fileImport').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed.fields)) throw new Error('JSON 缺少 fields 数组');
        state = parsed;
        if (!state.config) state.config = Object.assign({}, E.DEFAULT_CONFIG);
        commit();
      } catch (err) { alert('导入失败：' + err.message); }
      e.target.value = '';
    };
    reader.readAsText(file, 'utf-8');
  });
  document.getElementById('cfgSteps').addEventListener('change', e => {
    const v = parseInt(e.target.value, 10);
    if (!v || v < 1) return;
    state.config.stepCount = Math.max(1, Math.min(12, v));
    state.fields.forEach(f => {
      if (!f.excluded && f.step >= state.config.stepCount) f.step = state.config.stepCount - 1;
    });
    if (state.stepNames) state.stepNames = state.stepNames.slice(0, state.config.stepCount);
    commit();
  });
  document.getElementById('cfgRead').addEventListener('change', e => {
    const v = parseInt(e.target.value, 10);
    if (v && v > 0) { state.config.readThreshold = v; commit(); }
  });
  document.getElementById('cfgRequired').addEventListener('change', e => {
    const v = parseInt(e.target.value, 10);
    if (v && v > 0) { state.config.requiredThreshold = v; commit(); }
  });

  // 启动即整体重推并展示可操作的分步结构
  commit();
})();
