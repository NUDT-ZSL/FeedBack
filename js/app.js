/* 界面编排：每次状态变化都对当前表单做一次 analyze() 全量重推后整体重渲染 */
(function () {
  'use strict';
  var M = window.FormModel;
  var state = null;   // { stepCount, fields, deps }
  var result = null;  // 最近一次 analyze 结果

  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fieldById(id) {
    for (var i = 0; i < state.fields.length; i++)
      if (state.fields[i].id === id) return state.fields[i];
    return null;
  }

  /* ---------------- 状态操作 ---------------- */
  function commit() {
    result = M.analyze(state);
    FormStorage.save(state);
    render();
  }

  function setFieldStep(id, step) {
    var f = fieldById(id);
    if (!f) return;
    f.step = Math.max(1, Math.min(state.stepCount, parseInt(step, 10) || 1));
    commit();
  }
  function toggleLock(id) {
    var f = fieldById(id);
    if (f) { f.locked = !f.locked; commit(); }
  }
  function toggleExclude(id) {
    var f = fieldById(id);
    if (f) { f.excluded = !f.excluded; commit(); }
  }
  function convergeAll() {
    var next = M.applyConvergence(state);
    state.fields = next.fields;
    commit();
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    var saved = FormStorage.load();
    state = saved && saved.fields ? saved : M.sampleForm();
    state = JSON.parse(JSON.stringify(state));
    bindToolbar();
    commit();
  }

  function bindToolbar() {
    $('#stepCountInput').addEventListener('change', function (e) {
      var n = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1));
      state.stepCount = n;
      state.fields.forEach(function (f) {
        if (!f.excluded && f.step > n) f.step = n;
      });
      commit();
      e.target.value = n;
    });
    $('#convergeBtn').addEventListener('click', convergeAll);
    $('#addFieldBtn').addEventListener('click', openFieldModal);
    $('#addDepBtn').addEventListener('click', openDepModal);
    $('#resetBtn').addEventListener('click', function () {
      if (confirm('恢复为内置示例？当前修改将丢失。')) {
        FormStorage.clear();
        state = JSON.parse(JSON.stringify(M.sampleForm()));
        $('#stepCountInput').value = state.stepCount;
        commit();
      }
    });
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    renderBoard();
    renderConflicts();
    renderDeps();
  }

  function renderBoard() {
    var board = $('#board');
    board.innerHTML = '';
    $('#stepCountInput').value = state.stepCount;

    var blockedCount = result.steps.reduce(function (n, s) {
      return n + (s.infeasible ? 1 : 0);
    }, 0);
    var banner = $('#conflictBanner');
    if (result.conflicts.length || blockedCount) {
      banner.classList.remove('hidden');
      banner.classList.toggle('warn', !result.conflicts.length);
      banner.textContent = result.conflicts.length
        ? '存在 ' + result.conflicts.length + ' 项冲突（见右侧“冲突与依据”），其中 ' +
          blockedCount + ' 个步骤当前不可完成。'
        : blockedCount + ' 个步骤当前不可完成（前置排在更靠后步骤）。';
    } else {
      banner.classList.add('hidden');
    }

    result.steps.forEach(function (st) {
      board.appendChild(renderStepCard(st));
    });

    var excluded = state.fields.filter(function (f) { return f.excluded; });
    if (excluded.length) {
      var zone = el('div', 'excluded-zone');
      zone.appendChild(el('h3', null, '已排除字段（不参与分步，但其被依赖关系会造成前置缺失）'));
      excluded.forEach(function (f) {
        var row = el('div', 'excluded-row');
        var info = el('span', null, '<b>' + esc(f.label) + '</b> <span class="field-id">(' + esc(f.id) + ')</span>');
        var btn = el('button', 'tiny', '取消排除');
        btn.addEventListener('click', function () { toggleExclude(f.id); });
        row.appendChild(info); row.appendChild(btn);
        zone.appendChild(row);
      });
      board.appendChild(zone);
    }
  }

  function renderStepCard(st) {
    var card = el('div', 'step-card' + (st.infeasible ? ' infeasible' : ''));
    var head = el('div', 'step-head');
    head.appendChild(el('div', 'step-name', '步骤 ' + st.step));
    var badges = el('div', 'step-badges');
    badges.appendChild(badge('阅读 ' + st.read, st.readLevel));
    badges.appendChild(badge('必填 ' + st.requiredCount, st.pressureLevel));
    badges.appendChild(badge('回溯 ' + st.unmetPrereqs.length, st.memoryLevel));
    if (st.infeasible) badges.appendChild(badge('不可完成', 'blocked'));
    head.appendChild(badges);
    card.appendChild(head);

    var metrics = el('div', 'metrics');
    metrics.appendChild(metric(st.read, '字阅读量'));
    metrics.appendChild(metric(st.requiredCount + '/' + st.fields.length, '必填字段'));
    metrics.appendChild(metric(st.backRead, '字回溯记忆'));
    card.appendChild(metrics);

    var body = el('div', 'step-body');
    if (!st.fields.length) {
      body.appendChild(el('div', 'step-empty', '本步骤暂无字段'));
    } else {
      st.fields.forEach(function (id) {
        var f = fieldById(id);
        if (f && !f.excluded) body.appendChild(renderFieldCard(f, st));
      });
    }
    card.appendChild(body);

    if (st.blockedBy.length) {
      var blk = el('div', 'blocked-list');
      blk.appendChild(el('h4', null,
        st.infeasible ? '不可完成 / 违规依据' : '依赖违规（该步仍可完成，但排布不满足要求）'));
      uniqReasons(st.blockedBy).forEach(function (b) {
        blk.appendChild(el('div', 'blocked-item',
          '⛔ ' + esc(b.message) + (b.dep && b.dep.reason ? '' : '')));
      });
      card.appendChild(blk);
    }
    if (st.unmetPrereqs.length) {
      var mem = el('div', 'blocked-list memory');
      mem.appendChild(el('h4', null, '跨步骤记忆（需要回忆早前步骤）'));
      uniqReasons(st.unmetPrereqs).forEach(function (b) {
        mem.appendChild(el('div', 'memory-item', '↩ ' + esc(b.message)));
      });
      card.appendChild(mem);
    }
    return card;
  }

  function uniqReasons(items) {
    var seen = {}, out = [];
    items.forEach(function (x) {
      if (!seen[x.message]) { seen[x.message] = true; out.push(x); }
    });
    return out;
  }

  function badge(text, cls) { return el('span', 'badge ' + (cls || ''), esc(text)); }
  function metric(num, lbl) {
    var n = el('div', 'metric');
    n.appendChild(el('div', 'num', String(num)));
    n.appendChild(el('div', 'lbl', esc(lbl)));
    return n;
  }

  function renderFieldCard(f, st) {
    var card = el('div', 'field-card');
    var req = result.requirement[f.id];
    var hasConflict = !!(req && req.conflict);

    var top = el('div', 'field-top');
    top.appendChild(el('span', 'field-name', esc(f.label)));
    top.appendChild(el('span', 'field-id', esc(f.id)));
    var flags = el('div', 'field-flags');
    flags.appendChild(el('span', 'tag ' + (req ? req.effective : f.require),
      M.reqLabel(req ? req.effective : f.require)));
    if (f.locked) flags.appendChild(el('span', 'tag lock', '已锁定'));
    if (hasConflict) flags.appendChild(el('span', 'tag conflict', '要求冲突'));
    top.appendChild(flags);
    card.appendChild(top);

    if (f.note) card.appendChild(el('div', 'field-note', esc(f.note)));

    var actions = el('div', 'field-actions');
    var sel = el('select');
    for (var s = 1; s <= state.stepCount; s++) {
      var opt = document.createElement('option');
      opt.value = String(s); opt.textContent = '第 ' + s + ' 步';
      if (s === f.step) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', function () { setFieldStep(f.id, sel.value); });
    if (f.locked) sel.disabled = true;
    actions.appendChild(sel);

    var lockBtn = el('button', 'tiny', f.locked ? '解锁' : '锁定');
    lockBtn.title = '锁定后该字段步骤不再被自动收敛调整';
    lockBtn.addEventListener('click', function () { toggleLock(f.id); });
    actions.appendChild(lockBtn);

    var exBtn = el('button', 'tiny', '排除');
    exBtn.title = '从分步方案中排除该字段';
    exBtn.addEventListener('click', function () { toggleExclude(f.id); });
    actions.appendChild(exBtn);

    var editBtn = el('button', 'tiny ghost', '编辑');
    editBtn.addEventListener('click', function () { openFieldModal(f.id); });
    actions.appendChild(editBtn);

    card.appendChild(actions);

    // 与建议收敛方案不一致时给出提示（不自动改动，尊重当前排布）
    if (!f.locked && result.suggested[f.id] != null &&
        result.suggested[f.id] !== f.step) {
      var hint = el('div', 'field-note',
        '💡 依赖收敛建议：第 ' + result.suggested[f.id] + ' 步（点击顶部“收敛分步”应用）');
      hint.style.color = '#2f6fed';
      card.appendChild(hint);
      card.classList.add('suggested');
    }
    return card;
  }

  function renderConflicts() {
    var host = $('#conflictList');
    host.innerHTML = '';
    if (!result.conflicts.length) {
      host.appendChild(el('div', 'field-note', '当前没有冲突。'));
      return;
    }
    result.conflicts.forEach(function (c) {
      var item = el('div', 'conflict-item kind-' + c.kind);
      item.appendChild(el('div', 'kind', esc(kindLabel(c.kind))));
      item.appendChild(el('div', null, esc(c.message)));
      if (c.evidences) {
        var ul = el('ul', 'evidence-list');
        c.evidences.forEach(function (ev) {
          var txt = ev.source === 'declared'
            ? '字段自身声明：' + M.reqLabel(ev.demand)
            : '依赖 [' + ev.dep.from + ' → ' + ev.dep.to + '（' +
              M.DEP_TYPES[ev.dep.type].label + '）] 理由：“' + ev.reason +
              '” → 要求 ' + M.reqLabel(ev.demand);
          ul.appendChild(el('li', null, esc(txt)));
        });
        item.appendChild(ul);
      }
      if (c.trail && c.trail.length > 1) {
        item.appendChild(el('div', 'field-note',
          '约束链：' + c.trail.map(function (t) {
            return (t.kind === 'lock' ? '锁定' : '步骤') +
              ' ≥ ' + t.step + '（' + result.graph.members[t.comp].join('/') + '）';
          }).join(' → ')));
      }
      host.appendChild(item);
    });
  }

  function kindLabel(k) {
    return {
      REQUIREMENT: '填写要求冲突',
      ORDER: '顺序约束不可满足',
      ORDER_CYCLE: '依赖正环',
      LOCK_EDGE: '锁定与依赖冲突',
      LOCK_LOCK: '锁定互相矛盾',
      SELF: '同步骤/异步骤自相矛盾'
    }[k] || k;
  }

  function renderDeps() {
    var host = $('#depList');
    host.innerHTML = '';
    result.edgeChecks.forEach(function (chk, i) {
      var e = chk.dep;
      var bad = chk.status !== 'ok';
      var item = el('div', 'dep-item' + (bad ? ' bad' : ''));
      var head = el('div', 'dep-head');
      var left = el('span', null,
        '<b>' + esc(e.from) + '</b> → <b>' + esc(e.to) + '</b>');
      var right = el('span', null,
        '<span class="dep-type">' + M.DEP_TYPES[e.type].label + '</span> ' +
        '<span class="dep-status ' + (bad ? 'bad' : 'ok') + '">' +
        esc(statusLabel(chk.status)) + '</span>');
      head.appendChild(left); head.appendChild(right);
      item.appendChild(head);
      item.appendChild(el('div', 'dep-reason', esc(e.reason || '（无说明）')));
      if (bad) item.appendChild(el('div', 'dep-reason', esc(chk.detail)));
      var acts = el('div', 'dep-actions');
      var editBtn = el('button', 'tiny', '编辑');
      editBtn.addEventListener('click', function () { openDepModal(state.deps.indexOf(e)); });
      var delBtn = el('button', 'tiny danger', '删除');
      delBtn.addEventListener('click', function () {
        if (confirm('删除该依赖？')) { state.deps.splice(state.deps.indexOf(e), 1); commit(); }
      });
      acts.appendChild(editBtn); acts.appendChild(delBtn);
      item.appendChild(acts);
      host.appendChild(item);
    });
    if (!result.edgeChecks.length) {
      host.appendChild(el('div', 'field-note', '暂无依赖。'));
    }
  }

  function statusLabel(s) {
    return { ok: '满足', blocked: '前置在更后步骤', violation: '不满足',
             excluded: '一端已排除' }[s] || s;
  }

  /* ---------------- 弹窗：字段 ---------------- */
  function openFieldModal(existingId) {
    var existing = existingId ? fieldById(existingId) : null;
    var f = existing || {
      id: uniqueId('field'), label: '新字段', step: 1,
      require: 'optional', read: 10, note: '', locked: false, excluded: false
    };
    var host = $('#modalHost');
    var mask = el('div', 'modal-mask');
    var modal = el('div', 'modal');
    modal.appendChild(el('h3', null, existing ? '编辑字段' : '新增字段'));

    modal.appendChild(row('字段 ID（唯一标识）', input('f-id', f.id, existing)));
    modal.appendChild(row('显示名称', input('f-label', f.label)));
    var grid = el('div', 'form-grid');
    var stepSel = select('f-step', range(1, state.stepCount), f.step);
    var reqSel = select('f-require',
      [['required', '必填'], ['optional', '选填'], ['hidden', '隐藏']], f.require);
    grid.appendChild(row('所属步骤', stepSel));
    grid.appendChild(row('填写要求', reqSel));
    modal.appendChild(grid);
    modal.appendChild(row('阅读量（估算字数）', input('f-read', f.read)));
    modal.appendChild(row('填写说明 / 备注', textarea('f-note', f.note)));

    var lockWrap = el('label', 'form-row');
    lockWrap.innerHTML = '<input type="checkbox" id="f-lock" ' +
      (f.locked ? 'checked' : '') + ' style="width:auto"> 锁定当前步骤位置';
    modal.appendChild(lockWrap);

    var acts = el('div', 'modal-actions');
    if (existing) {
      var del = el('button', 'danger', '删除字段');
      del.addEventListener('click', function () {
        if (confirm('删除该字段及其相关依赖？')) {
          state.fields = state.fields.filter(function (x) { return x.id !== f.id; });
          state.deps = state.deps.filter(function (e) {
            return e.from !== f.id && e.to !== f.id;
          });
          close(); commit();
        }
      });
      acts.appendChild(del);
    }
    var cancel = el('button', null, '取消');
    cancel.addEventListener('click', close);
    var save = el('button', 'primary', '保存');
    save.addEventListener('click', function () {
      var id = $('#f-id').value.trim();
      if (!id) return alert('字段 ID 不能为空');
      if (!existing && fieldById(id)) return alert('字段 ID 已存在');
      if (existing && id !== existing.id && fieldById(id)) return alert('字段 ID 已存在');
      var data = {
        id: id,
        label: $('#f-label').value.trim() || id,
        step: parseInt($('#f-step').value, 10),
        require: $('#f-require').value,
        read: Math.max(0, parseFloat($('#f-read').value) || 0),
        note: $('#f-note').value.trim(),
        locked: $('#f-lock').checked
      };
      if (existing) {
        var oldId = existing.id;
        Object.assign(existing, data);
        state.deps.forEach(function (e) {
          if (e.from === oldId) e.from = id;
          if (e.to === oldId) e.to = id;
        });
      } else {
        state.fields.push(Object.assign({ excluded: false }, data));
      }
      close(); commit();
    });
    acts.appendChild(cancel); acts.appendChild(save);
    modal.appendChild(acts);
    mask.appendChild(modal);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    host.appendChild(mask);

    function close() { host.innerHTML = ''; }
  }

  function uniqueId(prefix) {
    var i = 1;
    while (fieldById(prefix + '_' + i)) i++;
    return prefix + '_' + i;
  }
  function row(labelText, ctl) {
    var r = el('div', 'form-row');
    r.appendChild(el('label', null, labelText));
    r.appendChild(ctl);
    return r;
  }
  function input(id, val, disabled) {
    var n = el('input');
    n.id = id; n.value = val == null ? '' : val;
    if (disabled) { n.disabled = true; n.title = '已有依赖引用，ID 不可修改'; }
    return n;
  }
  function textarea(id, val) {
    var n = el('textarea'); n.id = id; n.value = val || ''; return n;
  }
  function select(id, options, selected) {
    var n = el('select'); n.id = id;
    options.forEach(function (o) {
      var v = Array.isArray(o) ? o[0] : o;
      var t = Array.isArray(o) ? o[1] : o;
      var opt = document.createElement('option');
      opt.value = v; opt.textContent = t;
      if (String(v) === String(selected)) opt.selected = true;
      n.appendChild(opt);
    });
    return n;
  }
  function range(a, b) {
    var out = [];
    for (var i = a; i <= b; i++) out.push([i, '第 ' + i + ' 步']);
    return out;
  }

  /* ---------------- 弹窗：依赖 ---------------- */
  function openDepModal(index) {
    var existing = index != null ? state.deps[index] : null;
    var e = existing || { from: '', to: '', type: 'before', reason: '' };
    var fieldOptions = state.fields
      .filter(function (x) { return !x.excluded; })
      .map(function (x) { return [x.id, x.label + ' (' + x.id + ')']; });

    var host = $('#modalHost');
    var mask = el('div', 'modal-mask');
    var modal = el('div', 'modal');
    modal.appendChild(el('h3', null, existing ? '编辑依赖' : '新增依赖'));

    var hint = el('div', 'field-note');
    hint.style.marginBottom = '10px';
    hint.textContent = '语义：左侧字段的填写依赖右侧字段；可在理由中写“必填/选填”以提出填写要求（多条要求冲突会被标出）。';
    modal.appendChild(hint);

    var grid = el('div', 'form-grid');
    grid.appendChild(row('字段（from）', select('d-from', fieldOptions, e.from)));
    grid.appendChild(row('依赖字段（to）', select('d-to', fieldOptions, e.to)));
    modal.appendChild(grid);
    modal.appendChild(row('依赖方式', select('d-type', [
      ['before', '前置步骤：to 必须在 from 之前的步骤'],
      ['same', '同一步骤：from 与 to 必须同一步'],
      ['after', '后置步骤：to 必须在 from 之后的步骤']
    ], e.type)));
    modal.appendChild(row('依赖理由（依据，会原样保留在冲突列表）', textarea('d-reason', e.reason)));

    var acts = el('div', 'modal-actions');
    var cancel = el('button', null, '取消');
    cancel.addEventListener('click', close);
    var save = el('button', 'primary', '保存');
    save.addEventListener('click', function () {
      var data = {
        from: $('#d-from').value, to: $('#d-to').value,
        type: $('#d-type').value, reason: $('#d-reason').value.trim()
      };
      if (!data.from || !data.to) return alert('请选择依赖两端字段');
      if (data.from === data.to) return alert('依赖的两个字段不能相同');
      if (existing) Object.assign(existing, data);
      else state.deps.push(data);
      close(); commit();
    });
    acts.appendChild(cancel); acts.appendChild(save);
    modal.appendChild(acts);
    mask.appendChild(modal);
    mask.addEventListener('click', function (ev) { if (ev.target === mask) close(); });
    host.appendChild(mask);

    function close() { host.innerHTML = ''; }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
