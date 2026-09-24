'use strict';
/* 纯逻辑模块：结构规范化、默认顺序推导、约束冲突/循环消解、可达性检查 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FocusCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {

function normalize(doc) {
  var errors = [], warnings = [];
  doc = doc || {};
  var rootId = doc.root != null ? String(doc.root) : 'root';
  var elements = {}, elementIds = [];
  var containers = {}, containerIds = [];

  (doc.elements || []).forEach(function (e) {
    if (!e || e.id == null) { errors.push('存在缺少 id 的可聚焦元素'); return; }
    var id = String(e.id);
    if (elements[id] || containers[id]) { errors.push('元素 id 重复: ' + id); return; }
    elements[id] = { id: id, label: e.label != null ? String(e.label) : id, required: !!e.required };
    elementIds.push(id);
  });
  (doc.containers || []).forEach(function (c) {
    if (!c || c.id == null) { errors.push('存在缺少 id 的层级容器'); return; }
    var id = String(c.id);
    if (containers[id] || elements[id]) { errors.push('容器 id 冲突: ' + id); return; }
    containers[id] = { id: id, label: c.label != null ? String(c.label) : id, parent: c.parent != null ? String(c.parent) : null };
    containerIds.push(id);
  });
  if (!containers[rootId]) {
    containers[rootId] = { id: rootId, label: rootId, parent: null };
    containerIds.unshift(rootId);
  }

  var children = {};
  containerIds.forEach(function (id) { children[id] = []; });
  Object.keys(doc.children || {}).forEach(function (cid) {
    cid = String(cid);
    if (!containers[cid]) { errors.push('children 引用了不存在的容器: ' + cid); return; }
    (doc.children[cid] || []).forEach(function (ch) {
      var id = String(ch);
      if (!elements[id] && !containers[id]) { errors.push('容器 ' + cid + ' 的子项不存在: ' + id); return; }
      children[cid].push(id);
    });
  });
  var parentOf = {};
  containerIds.forEach(function (cid) {
    children[cid].forEach(function (ch) { parentOf[ch] = cid; });
  });
  elementIds.concat(containerIds).forEach(function (id) {
    if (id !== rootId && parentOf[id] == null) {
      children[rootId].push(id);
      warnings.push('「' + (elements[id] ? elements[id].label : containers[id].label) + '」未在结构中声明位置，已挂到根容器末尾');
    }
  });

  var initialFocus = doc.initialFocus != null ? String(doc.initialFocus) : (elementIds[0] || null);
  if (!initialFocus || !elements[initialFocus]) {
    errors.push('初始焦点不存在: ' + String(doc.initialFocus));
    initialFocus = elementIds[0] || null;
  }

  var usedIds = {}, constraints = [], invalid = [];
  (doc.constraints || []).forEach(function (raw, i) {
    raw = raw || {};
    var id = raw.id != null ? String(raw.id) : ('j' + (i + 1));
    var c = { id: id, from: raw.from != null ? String(raw.from) : '', to: raw.to != null ? String(raw.to) : '', priority: Number(raw.priority) || 0, note: raw.note != null ? String(raw.note) : '', index: i };
    if (usedIds[id]) { invalid.push({ constraint: c, reason: '约束 id 重复，已忽略' }); return; }
    if (!elements[c.from]) { invalid.push({ constraint: c, reason: '起点「' + c.from + '」不是可聚焦元素' }); return; }
    if (!elements[c.to]) { invalid.push({ constraint: c, reason: '终点「' + c.to + '」不是可聚焦元素' }); return; }
    usedIds[id] = 1;
    constraints.push(c);
  });

  return { root: rootId, elements: elements, elementIds: elementIds, containers: containers, containerIds: containerIds, children: children, initialFocus: initialFocus, constraints: constraints, invalid: invalid, errors: errors, warnings: warnings };
}

function defaultOrder(model) {
  var order = [], seen = {};
  function dfs(cid) {
    (model.children[cid] || []).forEach(function (id) {
      if (model.containers[id]) dfs(id);
      else if (model.elements[id] && !seen[id]) { seen[id] = 1; order.push(id); }
    });
  }
  dfs(model.root);
  model.elementIds.forEach(function (id) { if (!seen[id]) { seen[id] = 1; order.push(id); } });
  return order;
}

function computePlan(model) {
  var order = defaultOrder(model);
  var defaultNext = {};
  // 默认顺序为线性：走到末尾即路径结束（不绕回），这样“跳过必需元素”才能被检验出来
  order.forEach(function (id, i) { defaultNext[id] = i + 1 < order.length ? order[i + 1] : null; });
  var label = function (id) { var e = model.elements[id]; return e ? e.label : id; };

  // 同源冲突：优先级高者生效（并列时先声明者生效）
  var active = {}, overridden = [];
  var byFrom = {};
  model.constraints.forEach(function (c) { (byFrom[c.from] = byFrom[c.from] || []).push(c); });
  Object.keys(byFrom).forEach(function (f) {
    var list = byFrom[f].slice().sort(function (a, b) {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.index - b.index;
    });
    active[f] = list[0];
    list.slice(1).forEach(function (c) {
      overridden.push({ constraint: c, kind: 'conflict', reason: '与更高优先级约束 ' + list[0].id + ' 同源（均从「' + label(f) + '」出发），已被覆盖' });
    });
  });

  function buildEdges() {
    var edges = {};
    order.forEach(function (id) { edges[id] = { to: defaultNext[id], via: null }; });
    Object.keys(active).forEach(function (f) { edges[f] = { to: active[f].to, via: active[f].id }; });
    return edges;
  }
  function simulate(edges) {
    var seen = {}, path = [];
    var cur = model.initialFocus;
    while (cur != null && !seen[cur]) { seen[cur] = 1; path.push(cur); cur = edges[cur] ? edges[cur].to : null; }
    return { path: path, entry: cur };
  }

  // 循环消解：定位实际走到的环，移除环内优先级最低的跳转，重算直到覆盖全部元素或无可断边
  var edges = buildEdges();
  var sim = simulate(edges);
  var guard = 0;
  while (sim.path.length < order.length && guard++ < 1000) {
    var k = sim.path.indexOf(sim.entry);
    if (k < 0) break;
    var inCycle = {};
    sim.path.slice(k).forEach(function (id) { inCycle[id] = 1; });
    var cand = [];
    sim.path.slice(k).forEach(function (id) {
      var c = active[id];
      if (c && inCycle[c.to]) cand.push(c);
    });
    if (!cand.length) break;
    cand.sort(function (a, b) {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.index - a.index;
    });
    var loser = cand[0];
    var others = cand.filter(function (c) { return c.id !== loser.id; }).map(function (c) { return c.id; }).join('、');
    overridden.push({ constraint: loser, kind: 'cycle', reason: '与约束' + (others ? ' ' + others + ' ' : '') + '构成循环，按最低优先级断开（优先级 ' + loser.priority + '）' });
    delete active[loser.from];
    edges = buildEdges();
    sim = simulate(edges);
  }

  var visited = {};
  sim.path.forEach(function (id) { visited[id] = 1; });
  var posInPath = {};
  sim.path.forEach(function (id, i) { posInPath[id] = i; });

  // 必需元素可达性校验，并定位断裂段
  var problems = [];
  model.elementIds.forEach(function (id) {
    if (!model.elements[id].required || visited[id]) return;
    var cause = null;
    Object.keys(active).forEach(function (f) {
      if (cause || !visited[f]) return;
      var c = active[f], a = order.indexOf(f), b = order.indexOf(c.to);
      var skipped = [];
      for (var step = (a + 1) % order.length; step !== b; step = (step + 1) % order.length) skipped.push(order[step]);
      if (skipped.indexOf(id) >= 0) cause = c;
    });
    var last = sim.path[sim.path.length - 1];
    var reason = '路径在「' + label(last) + '」之后回到已访问的「' + label(sim.entry) + '」，闭环终止；必需元素「' + label(id) + '」从未进入路径。';
    if (cause) reason += ' 断裂段：约束 ' + cause.id + ' 从「' + label(cause.from) + '」跳转到「' + label(cause.to) + '」，跳过该元素所在区间，且后续没有任何跳转返回该区间。';
    problems.push({ element: id, reason: reason, cause: cause ? cause.id : null, last: last, entry: sim.entry });
  });

  return {
    order: order, edges: edges, path: sim.path, entry: sim.entry,
    visited: visited, posInPath: posInPath, active: active,
    overridden: overridden, invalid: model.invalid,
    warnings: model.warnings, errors: model.errors,
    problems: problems, complete: sim.path.length === order.length
  };
}

return { normalize: normalize, defaultOrder: defaultOrder, computePlan: computePlan };

});
