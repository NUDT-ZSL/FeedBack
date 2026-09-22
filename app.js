(function () {
  'use strict';
  var Engine = window.RolloutEngine;
  var state = window.createSampleState(Engine);
  var previous = Engine.clone(state);
  var logs = [];
  var editingId = '';
  var filter = 'all';

  function $(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function listText(values, empty) {
    return values && values.length ? esc(values.join(', ')) : '<em>' + esc(empty || '空') + '</em>';
  }
  function log(text) {
    logs.unshift(new Date().toLocaleTimeString() + ' · ' + text);
    logs = logs.slice(0, 80);
  }
  function refresh() {
    var full = Engine.evaluateAll(state);
    render(full);
  }
  function runIncremental(action, label) {
    var before = Engine.evaluateAll(previous);
    var result = action();
    var afterFull = Engine.evaluateAll(state);
    var affected = result.affectedTargetIds || state.targets.map(function (t) { return t.id; });
    var partial = Engine.recomputeAffected(state, affected, state.currentBatchId);
    partial.targets.forEach(function (target) {
      var fresh = afterFull.targets.find(function (t) { return t.targetId === target.targetId; });
      if (JSON.stringify(fresh) !== JSON.stringify(target)) {
        throw new Error('受影响目标 ' + target.targetId + ' 的增量推导与全量重推不一致');
      }
    });
    previous = Engine.clone(state);
    log(label + '；重推目标：' + (affected.length ? affected.join('、') : '无'));
    render(afterFull, before, affected);
  }

  function render(full, beforeFull, affectedIds) {
    renderTimeline(full);
    renderRules();
    renderBatches(full);
    renderTargets(full, beforeFull, affectedIds);
    $('conflictCount').textContent = String(full.conflicts);
    $('untrustedCount').textContent = String(full.untrustedTargets);
    $('affectedBadge').textContent = affectedIds ? String(affectedIds.length) : '全量';
    $('logs').innerHTML = logs.map(esc).join('<br>') || '暂无操作记录。';
  }

  function renderTimeline(full) {
    var currentIndex = state.batches.findIndex(function (b) { return b.id === state.currentBatchId; });
    $('timeline').innerHTML = state.batches.map(function (batch, index) {
      var active = batch.id === state.currentBatchId;
      var ready = batch.ready !== false;
      return '<button type="button" class="batch-pill ' + (active ? 'active' : '') + ' ' +
        (ready ? '' : 'danger') + '" data-time="' + esc(batch.id) + '">' +
        '<b>B' + (index + 1) + '</b><span>' + esc(batch.name) + '</span>' +
        (ready ? '' : '<small>未就绪</small>') + '</button>';
    }).join('<span class="arrow">→</span>');
    $('currentTitle').textContent = state.currentBatchId + ' · ' +
      (state.batches[currentIndex] && state.batches[currentIndex].name || '未知时刻');
  }

  function renderBatches(full) {
    $('batchPanel').innerHTML = full.batches.map(function (batch) {
      var status = batch.trusted ? '<span class="ok">可信</span>' : '<span class="bad">不可信</span>';
      var toggle = batch.exists ? '<button type="button" data-ready="' + esc(batch.id) + '">' +
        (batch.ready ? '标记未就绪' : '恢复就绪') + '</button>' : '';
      return '<article class="mini ' + (batch.trusted ? '' : 'mini-bad') + '"><header>' +
        '<strong>' + esc(batch.id) + '</strong>' + status + toggle + '</header>' +
        '<p>' + esc(batch.name) + '</p><ul>' +
        batch.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') +
        '</ul></article>';
    }).join('');
  }

  document.addEventListener('DOMContentLoaded', function () {
    log('离线推演工具已启动，已载入样例规则与目标。');
    refresh();
  });

  function renderRules() {
    $('rulesList').innerHTML = state.rules.map(function (rule) {
      var data = rule.status === 'published' ? rule.published : rule.draft;
      var statusClass = rule.status === 'published' ? 'ok' : rule.status === 'withdrawn' ? 'muted' : 'warn';
      var actions = '<button type="button" data-edit="' + esc(rule.id) + '">编辑</button>';
      if (rule.status === 'published') {
        actions += '<button type="button" class="danger-button" data-withdraw="' + esc(rule.id) + '">撤回</button>';
      }
      return '<article class="rule-card ' + (editingId === rule.id ? 'editing' : '') + '">' +
        '<header><strong>' + esc(rule.id) + '</strong><span class="' + statusClass + '">' +
        esc(rule.status) + ' v' + (rule.version || 0) + '</span></header>' +
        '<p><b>' + esc(data.key) + '</b>=<code>' + esc(data.value) + '</code>，优先级 ' +
        esc(data.priority) + '，生效批次 ' + esc(data.effectiveBatch) + '</p>' +
        '<p class="meta">批次：' + listText(data.scopeBatches, '未选择') +
        '<br>标签（AND）：' + listText(data.scopeLabels, '不限标签') + '</p>' +
        (rule.withdrawReason ? '<p class="bad">撤回原因：' + esc(rule.withdrawReason) + '</p>' : '') +
        '<div class="actions">' + actions + '</div></article>';
    }).join('');
    var rule = editingId ? state.rules.find(function (r) { return r.id === editingId; }) : null;
    var source = rule ? (rule.draft || rule.published || {}) : {};
    $('ruleEditor').style.display = rule ? 'grid' : 'none';
    $('editorTitle').textContent = rule ? '编辑规则 ' + rule.id : '';
    var map = { ruleKey: 'key', ruleValue: 'value', rulePriority: 'priority', ruleBatch: 'effectiveBatch', ruleScopeBatches: 'scopeBatches', ruleScopeLabels: 'scopeLabels' };
    Object.keys(map).forEach(function (field) {
      var value = source[map[field]];
      if (Array.isArray(value)) value = value.join(', ');
      $(field).value = value == null ? '' : value;
    });
    $('publishButton').textContent = rule && rule.status === 'published' ? '保存并发布新版本' : '发布规则';
  }

  function readEditor() {
    return {
      key: $('ruleKey').value.trim(),
      value: $('ruleValue').value,
      priority: Number($('rulePriority').value || 0),
      effectiveBatch: $('ruleBatch').value.trim(),
      scopeBatches: $('ruleScopeBatches').value.split(','),
      scopeLabels: $('ruleScopeLabels').value.split(',')
    };
  }

  function renderTargets(full, beforeFull, affectedIds) {
    var changed = new Set();
    if (beforeFull && affectedIds) {
      affectedIds.forEach(function (id) {
        var after = full.targets.find(function (t) { return t.targetId === id; });
        var before = beforeFull.targets.find(function (t) { return t.targetId === id; });
        if (JSON.stringify(after) !== JSON.stringify(before)) changed.add(id);
      });
    }
    var targets = full.targets.filter(function (target) {
      if (filter === 'conflict') return target.conflict;
      if (filter === 'untrusted') return target.untrusted;
      if (filter === 'affected') return !affectedIds || affectedIds.indexOf(target.targetId) >= 0;
      return true;
    });
    $('targets').innerHTML = targets.map(function (target) {
      var badge = '<span class="status ' + target.status + '">' + esc(target.status) + '</span>';
      var mark = changed.has(target.targetId) ? '<span class="changed">本次变化</span>' : '';
      return '<article class="target ' + (target.untrusted ? 'untrusted' : '') + ' ' +
        (mark ? 'changed-card' : '') + '">' +
        '<header><div><h3>' + esc(target.name) + ' <small>' + esc(target.targetId) +
        '</small></h3><p>' + esc(target.batchId) + ' · ' + esc(target.labels.join(', ')) + '</p></div>' +
        '<div>' + badge + mark + '</div></header>' +
        target.warnings.map(function (w) { return '<p class="bad">⚠ ' + esc(w) + '</p>'; }).join('') +
        '<div class="config-grid">' + target.configs.map(renderConfig.bind(null, target)).join('') + '</div>' +
        '</article>';
    }).join('') || '<p class="empty">没有符合筛选条件的目标。</p>';
  }

  function candidateHtml(target, config, candidate) {
    var selected = config.chosenCandidateId === candidate.candidateId;
    var recommended = config.recommendedCandidateId === candidate.candidateId;
    return '<label class="candidate ' + candidate.state + '"><input type="radio" name="' +
      esc(target.targetId + ':' + config.key) + '" value="' + esc(candidate.candidateId) +
      '" ' + (selected ? 'checked' : '') + ' ' + (candidate.eligible ? '' : 'disabled') + '>' +
      '<div><strong>' + esc(candidate.candidateId) + (recommended ? ' <em>推荐</em>' : '') +
      '</strong><code>' + esc(candidate.value) + '</code><span>' + esc(candidate.state) +
      ' · P' + esc(candidate.priority) + ' · ' + esc(candidate.effectiveBatch) + '</span>' +
      '<ul>' + candidate.basis.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>' +
      '</div></label>';
  }

  function renderConfig(target, config) {
    var version = config.effectiveVersion ? esc(config.effectiveVersion.candidateId) : '未确定';
    return '<section class="config-card ' + config.status + '"><div class="config-head">' +
      '<h4>' + esc(config.key) + '</h4><span>' + esc(config.status) + '</span></div>' +
      '<p>生效值：<code>' + esc(config.effectiveValue == null ? '—' : config.effectiveValue) +
      '</code></p><p class="meta">版本：' + version + '</p>' +
      (config.staleResolution ? '<p class="warn">原裁决失效：' + esc(config.staleResolution.reason) + '</p>' : '') +
      '<div class="candidate-list">' + config.candidates.map(candidateHtml.bind(null, target, config)).join('') + '</div>' +
      config.evidence.map(function (item) { return '<p class="evidence">↳ ' + esc(item) + '</p>'; }).join('') +
      '<div class="actions"><button type="button" data-resolve="' + esc(target.targetId) +
      '" data-key="' + esc(config.key) + '">裁决所选候选</button>' +
      '<button type="button" data-clear="' + esc(target.targetId) + '" data-key="' +
      esc(config.key) + '">清除裁决</button></div></section>';
  }

  function selectedCandidate(targetId, configKey) {
    var checked = document.querySelector('input[name="' +
      CSS.escape(targetId + ':' + configKey) + '"]:checked');
    return checked ? checked.value : null;
  }

  document.addEventListener('click', function (event) {
    var el = event.target.closest('button');
    if (!el) return;
    try {
      if (el.dataset.time) {
        Engine.setCurrentBatch(state, el.dataset.time);
        log('推演时刻移动到 ' + el.dataset.time + '。');
        previous = Engine.clone(state);
        refresh();
      } else if (el.dataset.ready) {
        var makeReady = state.batches.find(function (b) { return b.id === el.dataset.ready; }).ready;
        runIncremental(function () {
          return Engine.setBatchReady(state, el.dataset.ready, !makeReady);
        }, (makeReady ? '标记批次未就绪：' : '恢复批次就绪：') + el.dataset.ready);
      } else if (el.dataset.edit) {
        editingId = editingId === el.dataset.edit ? '' : el.dataset.edit;
        refresh();
      } else if (el.dataset.withdraw) {
        var reason = window.prompt('请输入撤回原因：', '用户撤回');
        if (reason !== null) {
          var id = el.dataset.withdraw;
          runIncremental(function () { return Engine.withdrawRule(state, id, reason); }, '撤回规则 ' + id);
          editingId = '';
        }
      } else if (el.dataset.resolve) {
        var candidateId = selectedCandidate(el.dataset.resolve, el.dataset.key);
        if (!candidateId) throw new Error('请先选择一个当前可生效候选。');
        runIncremental(function () {
          return Engine.resolveConflict(state, el.dataset.resolve, el.dataset.key, candidateId);
        }, '裁决 ' + el.dataset.resolve + ' / ' + el.dataset.key + ' → ' + candidateId);
      } else if (el.dataset.clear) {
        var clearId = el.dataset.clear;
        runIncremental(function () {
          return Engine.clearResolution(state, clearId, el.dataset.key);
        }, '清除 ' + clearId + ' / ' + el.dataset.key + ' 的裁决');
      } else if (el.id === 'publishButton') {
        if (!editingId) throw new Error('请先点击“新建”或选择一条规则。');
        var data = readEditor();
        if (!data.key) throw new Error('配置键不能为空。');
        if (!data.effectiveBatch) throw new Error('生效批次不能为空。');
        if (!data.scopeBatches.length) throw new Error('作用范围至少包含一个批次。');
        runIncremental(function () { return Engine.publishRule(state, editingId, data); }, '发布规则 ' + editingId);
        editingId = '';
      } else if (el.id === 'saveDraftButton') {
        if (!editingId) throw new Error('请先点击“新建”或选择一条规则。');
        Engine.saveDraft(state, editingId, readEditor());
        log('已保存草稿，尚未进入发布链路。');
        refresh();
      } else if (el.id === 'newRuleButton') {
        var newId = window.prompt('新规则 ID：', 'R-NEW-' + Math.ceil(Math.random() * 999));
        if (newId) {
          Engine.saveDraft(state, newId.trim(), {
            key: 'new_key', value: 'new_value', priority: 1,
            effectiveBatch: state.batches[0].id, scopeBatches: [state.batches[0].id], scopeLabels: []
          });
          editingId = newId.trim();
          refresh();
        }
      } else if (el.id === 'resetButton') {
        state = window.createSampleState(Engine);
        previous = Engine.clone(state);
        editingId = '';
        log('已重置为离线样例。');
        refresh();
      } else if (el.id === 'verifyButton') {
        var full = Engine.evaluateAll(state);
        var recomputed = Engine.recomputeAffected(state, state.targets.map(function (t) { return t.id; }), state.currentBatchId);
        if (JSON.stringify(full.targets) !== JSON.stringify(recomputed.targets)) {
          throw new Error('全量结果与全量重推结果不一致。');
        }
        log('一致性校验通过：受影响重推结果与整体重推一致。');
        render(full);
      }
    } catch (error) {
      window.alert(error.message);
      log('操作被拒绝：' + error.message);
    }
  });

  document.addEventListener('change', function (event) {
    if (event.target.id !== 'filterState') return;
    filter = event.target.value;
    refresh();
  });
})();
