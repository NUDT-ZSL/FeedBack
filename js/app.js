/* 应用层：状态管理 + 增量更新 + 渲染 */
(function () {
  'use strict';
  var E = window.RDEngine;
  var STORE_KEY = 'rd-workbench-v1';

  function seedState() {
    return {
      devices: [
        { id: 'd-phone', name: '手机 竖屏', width: 375, dpr: 2, orientation: 'portrait' },
        { id: 'd-phone-l', name: '手机 横屏', width: 812, dpr: 2, orientation: 'landscape' },
        { id: 'd-tablet', name: '平板 竖屏', width: 768, dpr: 2, orientation: 'portrait' },
        { id: 'd-desktop', name: '桌面', width: 1440, dpr: 1, orientation: 'landscape' }
      ],
      rules: [
        { id: 'r-base', name: '全局基础', minWidth: 0, maxWidth: 4000, priority: 1,
          props: { columns: 1, gutter: 8, fontSize: 14 } },
        { id: 'r-tablet', name: '平板档', minWidth: 600, maxWidth: 1024, priority: 2,
          props: { columns: 2, gutter: 16 } },
        { id: 'r-desktop', name: '桌面档', minWidth: 1025, maxWidth: 4000, priority: 2,
          props: { columns: 4, gutter: 24, fontSize: 16 } },
        { id: 'r-tablet-tie', name: '平板紧凑(并列示例)', minWidth: 600, maxWidth: 1024, priority: 2,
          props: { columns: 3 } }
      ],
      adjudications: {},
      selectedDeviceId: 'd-phone'
    };
  }

  var state;
  try {
    state = JSON.parse(localStorage.getItem(STORE_KEY)) || seedState();
  } catch (e) { state = seedState(); }
  if (!state.adjudications) state.adjudications = {};

  /* 增量结果缓存：results 只保存受影响设备的最新结论 */
  var results = null;
  var lastVerify = null; // null | true | false

  function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

  function fullRecompute() {
    results = E.computeAll(state.devices, state.rules, state.adjudications);
  }
  function incrementalUpdate(affectedIds) {
    if (!results) { fullRecompute(); return; }
    results = E.applyIncremental(results, state.devices, state.rules, state.adjudications, affectedIds);
  }
  /* 与全量重推比对，验证增量结果一致性 */
  function verifyConsistency() {
    var full = E.computeAll(state.devices, state.rules, state.adjudications);
    lastVerify = E.deepEqual(results, full);
    return lastVerify;
  }

  function gaps() { return E.detectGaps(state.rules, state.devices); }

  function uid(prefix) { return prefix + '-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4); }

  /* ---- 变更入口：每个入口都走增量路径并记录受影响设备 ---- */
  function afterMutation(affectedIds) {
    save();
    incrementalUpdate(affectedIds);
    lastVerify = null;
    render();
  }

  function upsertDevice(dev) {
    var idx = state.devices.findIndex(function (d) { return d.id === dev.id; });
    if (idx >= 0) state.devices[idx] = dev; else state.devices.push(dev);
    afterMutation([dev.id]);
  }
  function deleteDevice(id) {
    state.devices = state.devices.filter(function (d) { return d.id !== id; });
    if (state.selectedDeviceId === id) {
      state.selectedDeviceId = state.devices.length ? state.devices[0].id : null;
    }
    afterMutation([]);
  }
  function upsertRule(rule) {
    var idx = state.rules.findIndex(function (r) { return r.id === rule.id; });
    var oldRule = idx >= 0 ? state.rules[idx] : null;
    if (idx >= 0) state.rules[idx] = rule; else state.rules.push(rule);
    var affected = E.affectedByRuleChange(oldRule, rule, state.devices);
    afterMutation(affected);
  }
  function deleteRule(id) {
    var oldRule = state.rules.find(function (r) { return r.id === id; });
    state.rules = state.rules.filter(function (r) { return r.id !== id; });
    // 清理涉及该规则的人工裁决
    Object.keys(state.adjudications).forEach(function (sig) {
      if (sig.split('|')[1].split(',').indexOf(id) >= 0) delete state.adjudications[sig];
    });
    var affected = oldRule ? E.affectedByRuleChange(oldRule, null, state.devices) : [];
    afterMutation(affected);
  }
  function adjudicate(signature, ruleId) {
    state.adjudications[signature] = ruleId;
    var ruleIds = signature.split('|')[1].split(',');
    var affected = E.affectedByAdjudication(ruleIds, state.rules, state.devices);
    afterMutation(affected);
  }
  function revokeAdjudication(signature) {
    var ruleIds = signature.split('|')[1].split(',');
    delete state.adjudications[signature];
    var affected = E.affectedByAdjudication(ruleIds, state.rules, state.devices);
    afterMutation(affected);
  }

  /* ---- 渲染 ---- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderBadge() {
    var el = document.getElementById('consistency-badge');
    if (lastVerify === null) { el.className = 'badge'; el.textContent = '增量模式 · 未校验'; }
    else if (lastVerify) { el.className = 'badge ok'; el.textContent = '增量 == 全量重推 ✓'; }
    else { el.className = 'badge bad'; el.textContent = '增量与全量不一致 ✗'; }
  }

  function renderDevices() {
    var box = document.getElementById('device-list');
    box.innerHTML = '';
    var g = gaps();
    state.devices.forEach(function (d) {
      var div = document.createElement('div');
      div.className = 'card' + (d.id === state.selectedDeviceId ? ' selected' : '');
      var uncovered = g.uncoveredDevices.indexOf(d.id) >= 0;
      div.innerHTML =
        '<div class="title">' + esc(d.name) +
        (uncovered ? '<span class="tag err">无规则命中</span>' : '') +
        (d.id === state.selectedDeviceId ? '<span class="tag ok">预览目标</span>' : '') +
        '</div>' +
        '<div class="meta">宽度 ' + d.width + 'px · DPR ' + d.dpr + ' · ' +
        (d.orientation === 'portrait' ? '竖屏' : '横屏') + '</div>' +
        '<div class="ops"><button class="small" data-act="edit">编辑</button>' +
        '<button class="small" data-act="del">删除</button></div>';
      div.querySelector('[data-act="edit"]').addEventListener('click', function (ev) {
        ev.stopPropagation(); fillDeviceForm(d);
      });
      div.querySelector('[data-act="del"]').addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (confirm('删除设备预设「' + d.name + '」？')) deleteDevice(d.id);
      });
      div.addEventListener('click', function () {
        state.selectedDeviceId = d.id; save(); render();
      });
      box.appendChild(div);
    });
    if (!state.devices.length) box.innerHTML = '<div class="empty-hint">暂无设备预设</div>';
  }

  function renderRules() {
    var box = document.getElementById('rule-list');
    box.innerHTML = '';
    state.rules.forEach(function (r) {
      var div = document.createElement('div');
      div.className = 'card';
      var props = Object.keys(r.props).map(function (k) { return k + '=' + r.props[k]; }).join('，');
      div.innerHTML =
        '<div class="title">' + esc(r.name) + '<span class="tag">优先级 ' + r.priority + '</span></div>' +
        '<div class="meta">区间 [' + r.minWidth + ', ' + r.maxWidth + '] · 跨度 ' + E.ruleSpan(r) + '</div>' +
        '<div class="meta">' + esc(props || '（无属性）') + '</div>' +
        '<div class="ops"><button class="small" data-act="edit">编辑</button>' +
        '<button class="small" data-act="del">删除</button></div>';
      div.querySelector('[data-act="edit"]').addEventListener('click', function () { fillRuleForm(r); });
      div.querySelector('[data-act="del"]').addEventListener('click', function () {
        if (confirm('删除规则「' + r.name + '」？')) deleteRule(r.id);
      });
      box.appendChild(div);
    });
    if (!state.rules.length) box.innerHTML = '<div class="empty-hint">暂无布局规则</div>';
  }

  function renderGaps() {
    var box = document.getElementById('gap-panel');
    var g = gaps();
    var html = '';
    g.uncoveredSegments.forEach(function (s) {
      html += '<div class="gap-item err">⚠ 宽度缺口：[' + s.from + ', ' + s.to +
        ']px 区间内没有任何规则覆盖，系统不会给出默认值。</div>';
    });
    g.equalPriorityOverlaps.forEach(function (o) {
      html += '<div class="gap-item">⚠ 同优先级区间重叠：「' + esc(o.ruleNames[0]) + '」与「' +
        esc(o.ruleNames[1]) + '」在 [' + o.from + ', ' + o.to + ']px 重叠，共享属性 ' +
        esc(o.sharedProps.join('、')) + '，区间收窄程度相同时需人工裁决。</div>';
    });
    g.uncoveredDevices.forEach(function (id) {
      var d = state.devices.find(function (x) { return x.id === id; });
      html += '<div class="gap-item err">⚠ 设备「' + esc(d ? d.name : id) +
        '」(' + (d ? d.width : '?') + 'px) 落在无规则命中的宽度上。</div>';
    });
    box.innerHTML = html || '<div class="gap-item" style="border-color:#16a34a;background:#f0fdf4">✓ 当前无覆盖缺口与重叠告警</div>';
  }

  function sourceHtml(res) {
    if (res.source.type === 'adjudication') {
      return '<span class="src-adj">人工裁决 → ' + esc(res.source.ruleName) + '</span>' +
        ' <button class="small" data-revoke="' + esc(res.source.signature) + '">撤销裁决</button>';
    }
    return '<span class="src-rule">规则「' + esc(res.source.ruleName) + '」</span>';
  }

  function suppressedHtml(list) {
    if (!list.length) return '';
    var items = list.map(function (s) {
      return '<li><span class="val">' + esc(s.ruleName) + '=' + esc(s.value) + '</span>' + esc(s.reason) + '</li>';
    }).join('');
    return '<ul class="suppressed">' + items + '</ul>';
  }

  function renderPreview() {
    var box = document.getElementById('preview-list');
    box.innerHTML = '';
    state.devices.forEach(function (d) {
      var res = results[d.id];
      var wrap = document.createElement('div');
      wrap.className = 'device-preview' + (d.id === state.selectedDeviceId ? ' selected' : '');
      var rows = '';
      if (res.noRulesMatched) {
        rows = '<tr><td colspan="3" class="unresolved">该设备宽度无任何规则命中 —— 缺口，不提供默认值</td></tr>';
      } else {
        Object.keys(res.props).forEach(function (k) {
          var p = res.props[k];
          if (p.status === 'unresolved') {
            var btns = p.tieRuleIds.map(function (rid) {
              var rr = state.rules.find(function (x) { return x.id === rid; });
              return '<button class="small primary" data-adj="' + esc(p.signature) + '" data-rule="' + esc(rid) +
                '">选定「' + esc(rr ? rr.name : rid) + '」</button>';
            }).join('');
            rows += '<tr><td>' + esc(k) + '</td>' +
              '<td class="unresolved">未裁决冲突<div class="adj-buttons">' + btns + '</div></td>' +
              '<td>' + suppressedHtml(p.suppressed) + '</td></tr>';
          } else {
            rows += '<tr><td>' + esc(k) + '</td>' +
              '<td><strong>' + esc(p.value) + '</strong><br>' + sourceHtml(p) + '</td>' +
              '<td>' + suppressedHtml(p.suppressed) + '</td></tr>';
          }
        });
      }
      wrap.innerHTML =
        '<div class="head">' + esc(d.name) + ' · ' + d.width + 'px · DPR ' + d.dpr +
        ' · 命中规则 ' + res.matchedRuleIds.length + ' 条</div>' +
        '<table><thead><tr><th style="width:18%">属性</th><th style="width:34%">最终取值 / 来源</th>' +
        '<th>被压制候选及依据</th></tr></thead><tbody>' + rows + '</tbody></table>';
      wrap.querySelector('.head').addEventListener('click', function () {
        state.selectedDeviceId = d.id; save(); render();
      });
      box.appendChild(wrap);
    });
    box.querySelectorAll('[data-adj]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        adjudicate(btn.getAttribute('data-adj'), btn.getAttribute('data-rule'));
      });
    });
    box.querySelectorAll('[data-revoke]').forEach(function (btn) {
      btn.addEventListener('click', function () { revokeAdjudication(btn.getAttribute('data-revoke')); });
    });
    if (!state.devices.length) box.innerHTML = '<div class="empty-hint">请先添加设备预设</div>';
  }

  function render() {
    renderBadge(); renderDevices(); renderRules(); renderGaps(); renderPreview();
  }

  /* ---- 表单 ---- */
  function fillDeviceForm(d) {
    document.getElementById('dev-id').value = d.id;
    document.getElementById('dev-name').value = d.name;
    document.getElementById('dev-width').value = d.width;
    document.getElementById('dev-dpr').value = d.dpr;
    document.getElementById('dev-orient').value = d.orientation;
    document.getElementById('device-add').open = true;
  }
  function clearDeviceForm() {
    document.getElementById('device-form').reset();
    document.getElementById('dev-id').value = '';
  }
  function fillRuleForm(r) {
    document.getElementById('rule-id').value = r.id;
    document.getElementById('rule-name').value = r.name;
    document.getElementById('rule-min').value = r.minWidth;
    document.getElementById('rule-max').value = r.maxWidth;
    document.getElementById('rule-priority').value = r.priority;
    document.getElementById('rule-props').value = Object.keys(r.props)
      .map(function (k) { return k + '=' + r.props[k]; }).join('\n');
    document.getElementById('rule-add').open = true;
  }
  function clearRuleForm() {
    document.getElementById('rule-form').reset();
    document.getElementById('rule-id').value = '';
  }
  function parseProps(text) {
    var props = {};
    text.split('\n').forEach(function (line) {
      var t = line.trim();
      if (!t) return;
      var eq = t.indexOf('=');
      if (eq <= 0) throw new Error('属性格式错误：「' + t + '」，应为 key=value');
      var k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
      if (!k) throw new Error('属性名不能为空');
      var num = Number(v);
      props[k] = (v !== '' && !isNaN(num)) ? num : v;
    });
    return props;
  }

  function bindEvents() {
    document.getElementById('device-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var id = document.getElementById('dev-id').value || uid('d');
      var dev = {
        id: id,
        name: document.getElementById('dev-name').value.trim(),
        width: Number(document.getElementById('dev-width').value),
        dpr: Number(document.getElementById('dev-dpr').value),
        orientation: document.getElementById('dev-orient').value
      };
      upsertDevice(dev);
      clearDeviceForm();
      document.getElementById('device-add').open = false;
    });
    document.getElementById('dev-cancel').addEventListener('click', function () {
      clearDeviceForm(); document.getElementById('device-add').open = false;
    });
    document.getElementById('rule-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var props;
      try { props = parseProps(document.getElementById('rule-props').value); }
      catch (e) { alert(e.message); return; }
      var min = Number(document.getElementById('rule-min').value);
      var max = Number(document.getElementById('rule-max').value);
      if (max < min) { alert('最大宽度不能小于最小宽度'); return; }
      var id = document.getElementById('rule-id').value || uid('r');
      upsertRule({
        id: id,
        name: document.getElementById('rule-name').value.trim(),
        minWidth: min, maxWidth: max,
        priority: Number(document.getElementById('rule-priority').value),
        props: props
      });
      clearRuleForm();
      document.getElementById('rule-add').open = false;
    });
    document.getElementById('rule-cancel').addEventListener('click', function () {
      clearRuleForm(); document.getElementById('rule-add').open = false;
    });
    document.getElementById('btn-verify').addEventListener('click', function () {
      verifyConsistency(); renderBadge();
    });
    document.getElementById('btn-reset').addEventListener('click', function () {
      if (!confirm('放弃当前全部修改并恢复内置示例？')) return;
      state = seedState();
      fullRecompute(); save(); lastVerify = null; render();
    });
  }

  fullRecompute();
  bindEvents();
  render();
})();
