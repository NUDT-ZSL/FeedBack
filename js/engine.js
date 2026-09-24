/* 响应式布局规则裁决引擎 —— 纯逻辑，无 DOM 依赖，可在浏览器与 Node 中运行 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RDEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function ruleSpan(rule) { return rule.maxWidth - rule.minWidth; }
  function matches(rule, width) { return width >= rule.minWidth && width <= rule.maxWidth; }

  /* 冲突签名：同一属性 + 同一组并列候选规则，跨设备复用同一次人工裁决 */
  function conflictSignature(propKey, ruleIds) {
    return propKey + '|' + ruleIds.slice().sort().join(',');
  }

  /* 对单个属性做裁决。candidates: [{rule, value}] */
  function resolveProperty(propKey, candidates, adjudications) {
    var suppressed = [];
    var bestPriority = Math.max.apply(null, candidates.map(function (c) { return c.rule.priority; }));
    var top = candidates.filter(function (c) { return c.rule.priority === bestPriority; });
    candidates.forEach(function (c) {
      if (c.rule.priority !== bestPriority) {
        suppressed.push({ ruleId: c.rule.id, ruleName: c.rule.name, value: c.value,
          reason: '优先级 ' + c.rule.priority + ' 低于最高优先级 ' + bestPriority });
      }
    });
    var minSpan = Math.min.apply(null, top.map(function (c) { return ruleSpan(c.rule); }));
    var narrow = top.filter(function (c) { return ruleSpan(c.rule) === minSpan; });
    top.forEach(function (c) {
      if (ruleSpan(c.rule) !== minSpan) {
        suppressed.push({ ruleId: c.rule.id, ruleName: c.rule.name, value: c.value,
          reason: '优先级相同，但区间宽度 ' + ruleSpan(c.rule) + ' 大于最窄区间 ' + minSpan + '（收窄程度不足）' });
      }
    });
    if (narrow.length === 1) {
      return { status: 'ok', value: narrow[0].value,
        source: { type: 'rule', ruleId: narrow[0].rule.id, ruleName: narrow[0].rule.name },
        suppressed: suppressed };
    }
    var sig = conflictSignature(propKey, narrow.map(function (c) { return c.rule.id; }));
    var pick = adjudications && adjudications[sig];
    if (pick && narrow.some(function (c) { return c.rule.id === pick; })) {
      narrow.forEach(function (c) {
        if (c.rule.id !== pick) {
          suppressed.push({ ruleId: c.rule.id, ruleName: c.rule.name, value: c.value,
            reason: '优先级与区间收窄程度相同，人工裁决未选中该规则' });
        }
      });
      var winner = narrow.filter(function (c) { return c.rule.id === pick; })[0];
      return { status: 'ok', value: winner.value,
        source: { type: 'adjudication', ruleId: winner.rule.id, ruleName: winner.rule.name, signature: sig },
        suppressed: suppressed };
    }
    narrow.forEach(function (c) {
      suppressed.push({ ruleId: c.rule.id, ruleName: c.rule.name, value: c.value,
        reason: '优先级与区间收窄程度相同，等待人工裁决' });
    });
    return { status: 'unresolved', value: null,
      source: null, signature: sig,
      tieRuleIds: narrow.map(function (c) { return c.rule.id; }),
      suppressed: suppressed };
  }

  /* 计算单个设备预设下所有属性的最终取值 */
  function computeDevice(device, rules, adjudications) {
    var matched = rules.filter(function (r) { return matches(r, device.width); });
    var propKeys = [];
    matched.forEach(function (r) {
      Object.keys(r.props || {}).forEach(function (k) {
        if (propKeys.indexOf(k) < 0) propKeys.push(k);
      });
    });
    var props = {};
    propKeys.sort().forEach(function (k) {
      var candidates = matched
        .filter(function (r) { return Object.prototype.hasOwnProperty.call(r.props, k); })
        .map(function (r) { return { rule: r, value: r.props[k] }; });
      props[k] = resolveProperty(k, candidates, adjudications);
    });
    return {
      deviceId: device.id, width: device.width,
      matchedRuleIds: matched.map(function (r) { return r.id; }),
      noRulesMatched: matched.length === 0,
      props: props
    };
  }

  function computeAll(devices, rules, adjudications) {
    var out = {};
    devices.forEach(function (d) { out[d.id] = computeDevice(d, rules, adjudications); });
    return out;
  }

  /* 缺口检测：未覆盖宽度段、同优先级区间重叠、无规则命中的设备 */
  function detectGaps(rules, devices) {
    var points = [];
    rules.forEach(function (r) { points.push(r.minWidth, r.maxWidth); });
    devices.forEach(function (d) { points.push(d.width); });
    var gaps = { uncoveredSegments: [], equalPriorityOverlaps: [], uncoveredDevices: [] };
    if (!points.length) return gaps;
    var lo = Math.min.apply(null, points), hi = Math.max.apply(null, points);
    if (rules.length) {
      var events = [];
      rules.forEach(function (r) { events.push([r.minWidth, 1], [r.maxWidth + 1, -1]); });
      events.sort(function (a, b) { return a[0] - b[0]; });
      var depth = 0, segStart = lo, i = 0, pos = lo;
      while (i < events.length) {
        var next = events[i][0];
        if (depth === 0 && next > pos && pos < hi) {
          gaps.uncoveredSegments.push({ from: Math.max(pos, lo), to: Math.min(next - 1, hi) });
        }
        while (i < events.length && events[i][0] === next) { depth += events[i][1]; i++; }
        pos = next;
      }
      if (depth === 0 && pos <= hi) gaps.uncoveredSegments.push({ from: Math.max(pos, lo), to: hi });
      gaps.uncoveredSegments = gaps.uncoveredSegments.filter(function (s) { return s.to >= s.from; });
    } else {
      gaps.uncoveredSegments.push({ from: lo, to: hi });
    }
    for (var a = 0; a < rules.length; a++) {
      for (var b = a + 1; b < rules.length; b++) {
        var ra = rules[a], rb = rules[b];
        if (ra.priority !== rb.priority) continue;
        var from = Math.max(ra.minWidth, rb.minWidth), to = Math.min(ra.maxWidth, rb.maxWidth);
        if (from > to) continue;
        var shared = Object.keys(ra.props || {}).filter(function (k) {
          return Object.prototype.hasOwnProperty.call(rb.props || {}, k);
        });
        if (shared.length) {
          gaps.equalPriorityOverlaps.push({
            ruleIds: [ra.id, rb.id], ruleNames: [ra.name, rb.name],
            sharedProps: shared, from: from, to: to
          });
        }
      }
    }
    devices.forEach(function (d) {
      if (!rules.some(function (r) { return matches(r, d.width); })) {
        gaps.uncoveredDevices.push(d.id);
      }
    });
    return gaps;
  }

  /* 增量更新：计算受某条规则变更影响的设备（旧区间 ∪ 新区间命中的设备） */
  function affectedByRuleChange(oldRule, newRule, devices) {
    return devices.filter(function (d) {
      return (oldRule && matches(oldRule, d.width)) || (newRule && matches(newRule, d.width));
    }).map(function (d) { return d.id; });
  }

  /* 增量更新：受人工裁决影响的设备（裁决涉及规则命中的设备） */
  function affectedByAdjudication(ruleIds, rules, devices) {
    var involved = rules.filter(function (r) { return ruleIds.indexOf(r.id) >= 0; });
    return devices.filter(function (d) {
      return involved.some(function (r) { return matches(r, d.width); });
    }).map(function (d) { return d.id; });
  }

  /* 增量应用：只重算 affectedIds 中的设备，其余沿用旧结果 */
  function applyIncremental(prevResults, devices, rules, adjudications, affectedIds) {
    var next = {};
    Object.keys(prevResults).forEach(function (k) { next[k] = prevResults[k]; });
    devices.forEach(function (d) {
      if (affectedIds.indexOf(d.id) >= 0 || !next[d.id]) {
        next[d.id] = computeDevice(d, rules, adjudications);
      }
    });
    Object.keys(next).forEach(function (k) {
      if (!devices.some(function (d) { return d.id === k; })) delete next[k];
    });
    return next;
  }

  function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  return {
    ruleSpan: ruleSpan,
    matches: matches,
    conflictSignature: conflictSignature,
    resolveProperty: resolveProperty,
    computeDevice: computeDevice,
    computeAll: computeAll,
    detectGaps: detectGaps,
    affectedByRuleChange: affectedByRuleChange,
    affectedByAdjudication: affectedByAdjudication,
    applyIncremental: applyIncremental,
    deepEqual: deepEqual
  };
});
