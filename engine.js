/* 配置发布推演内核（纯逻辑，无 DOM 依赖）
 * state = { targets:[{id,batch,ready,labels:{}}],
 *           rules:[{id,key,value,scope:{},priority,batch,
 *                   status:'draft'|'published'|'withdrawn',version}],
 *           overrides:{ "targetId|key": ruleId } }
 * 生效条件：已发布 && rule.batch<=step && target.batch>=rule.batch
 *           && scope 全部命中 target.labels
 * 候选排序：priority 降序 -> batch 升序(先生效优先) -> version 降序
 * 头部 (priority,batch) 并列且取值不同 => 冲突，等待用户裁决
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function matchScope(scope, labels) {
    var keys = Object.keys(scope || {});
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (scope[k] !== '' && String(labels[k]) !== String(scope[k])) return false;
    }
    return true;
  }

  function ruleMatchesTarget(rule, target) {
    return target.batch >= rule.batch && matchScope(rule.scope, target.labels);
  }

  function candidatesFor(state, target, key, step) {
    var out = [];
    for (var i = 0; i < state.rules.length; i++) {
      var r = state.rules[i];
      if (r.status !== 'published' || r.key !== key) continue;
      if (r.batch > step) continue;
      if (!ruleMatchesTarget(r, target)) continue;
      out.push(r);
    }
    out.sort(function (a, b) {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.batch !== b.batch) return a.batch - b.batch;
      return b.version - a.version;
    });
    return out;
  }

  function allKeys(state) {
    var s = {};
    state.rules.forEach(function (r) { if (r.status !== 'draft') s[r.key] = 1; });
    return Object.keys(s).sort();
  }

  function deriveTarget(state, target, step, keys) {
    var result = {};
    (keys || allKeys(state)).forEach(function (key) {
      var cands = candidatesFor(state, target, key, step);
      var ovKey = target.id + '|' + key;
      var ov = state.overrides[ovKey];
      var cell = { candidates: cands.map(function (r) { return r.id; }),
        conflict: false, adjudicated: false, effective: null, reason: '' };
      if (cands.length === 0) {
        cell.reason = '无已发布规则命中';
        result[key] = cell; return;
      }
      if (ov && cands.some(function (r) { return r.id === ov; })) {
        var chosen = cands.filter(function (r) { return r.id === ov; })[0];
        cell.effective = { ruleId: chosen.id, value: chosen.value, version: chosen.version };
        cell.adjudicated = true;
        cell.reason = '用户裁决选定 ' + chosen.id + '(v' + chosen.version + ')';
        result[key] = cell; return;
      }
      var top = cands[0];
      var tied = cands.filter(function (r) {
        return r.priority === top.priority && r.batch === top.batch;
      });
      var distinctVals = {};
      tied.forEach(function (r) { distinctVals[String(r.value)] = 1; });
      if (tied.length > 1 && Object.keys(distinctVals).length > 1) {
        cell.conflict = true;
        cell.reason = '并列冲突：' + tied.map(function (r) {
          return r.id + '(P=' + r.priority + ',B=' + r.batch + ',v' + r.version + ')';
        }).join(' vs ') + '，等待用户裁决';
      } else {
        cell.effective = { ruleId: top.id, value: top.value, version: top.version };
        cell.reason = '优先级 P=' + top.priority + ' 最高；批次 B=' + top.batch +
          ' 先生效；版本 v' + top.version + '（候选 ' + cands.length + ' 条）';
      }
      result[key] = cell;
    });
    return result;
  }

  /* 批次可信度：未就绪目标 / 规则指向缺失，绝不静默跳过 */
  function batchTrust(state, step) {
    var rows = [];
    var maxBatch = 0;
    state.targets.forEach(function (t) { maxBatch = Math.max(maxBatch, t.batch); });
    state.rules.forEach(function (r) {
      if (r.status === 'published') maxBatch = Math.max(maxBatch, r.batch);
    });
    for (var b = 1; b <= Math.max(maxBatch, step); b++) {
      var problems = [];
      var tInBatch = state.targets.filter(function (t) { return t.batch === b; });
      tInBatch.forEach(function (t) {
        if (!t.ready) problems.push('目标 ' + t.id + ' 未就绪');
      });
      state.rules.forEach(function (r) {
        if (r.status !== 'published' || r.batch !== b) return;
        if (tInBatch.length === 0) {
          problems.push('规则 ' + r.id + ' 指向批次 B' + b + '，但该批次没有任何目标');
          return;
        }
        var hit = state.targets.some(function (t) { return ruleMatchesTarget(r, t); });
        if (!hit) problems.push('规则 ' + r.id + ' 的作用范围未命中任何目标（指向缺失）');
      });
      rows.push({ batch: b, reached: b <= step, trusted: problems.length === 0, problems: problems });
    }
    return rows;
  }

  function deriveAll(state, step) {
    var keys = allKeys(state);
    var results = {};
    state.targets.forEach(function (t) { results[t.id] = deriveTarget(state, t, step, keys); });
    return { step: step, keys: keys, results: results, trust: batchTrust(state, step) };
  }

  /* 撤回/改范围时受影响的目标：新旧范围命中的并集 */
  function affectedTargets(state, rule, oldScope) {
    var oldRule = Object.assign({}, rule, oldScope ? { scope: oldScope } : {});
    var ids = {};
    state.targets.forEach(function (t) {
      if (ruleMatchesTarget(rule, t) || ruleMatchesTarget(oldRule, t)) ids[t.id] = 1;
    });
    return Object.keys(ids);
  }

  /* 增量重推：只重算受影响目标，并与整体重推比对一致性 */
  function incrementalDerive(state, step, targetIds) {
    var keys = allKeys(state);
    var partial = {};
    targetIds.forEach(function (id) {
      var t = state.targets.filter(function (x) { return x.id === id; })[0];
      if (t) partial[id] = deriveTarget(state, t, step, keys);
    });
    var full = deriveAll(state, step);
    var consistent = true, diffs = [];
    targetIds.forEach(function (id) {
      if (JSON.stringify(partial[id] || null) !== JSON.stringify(full.results[id] || null)) {
        consistent = false; diffs.push(id);
      }
    });
    return { results: partial, consistent: consistent, diffs: diffs, full: full };
  }

  return {
    matchScope: matchScope,
    ruleMatchesTarget: ruleMatchesTarget,
    candidatesFor: candidatesFor,
    deriveTarget: deriveTarget,
    deriveAll: deriveAll,
    affectedTargets: affectedTargets,
    incrementalDerive: incrementalDerive,
    batchTrust: batchTrust,
    allKeys: allKeys
  };
});
