/*
 * Offline configuration rollout engine.
 * No browser APIs, no network access and no third-party dependencies.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RolloutEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function uniqueTrimmed(values) {
    var seen = Object.create(null);
    var result = [];
    (values || []).forEach(function (value) {
      var text = String(value == null ? '' : value).trim();
      if (text && !Object.prototype.hasOwnProperty.call(seen, text)) {
        seen[text] = true;
        result.push(text);
      }
    });
    return result;
  }

  function normalizeRuleInput(input) {
    input = input || {};
    return {
      key: String(input.key || '').trim(),
      value: String(input.value == null ? '' : input.value),
      priority: Number(input.priority) || 0,
      effectiveBatch: String(input.effectiveBatch || '').trim(),
      scopeLabels: uniqueTrimmed(input.scopeLabels),
      scopeBatches: uniqueTrimmed(input.scopeBatches)
    };
  }

  function snapshotRule(rule, version, ruleId, name) {
    var data = normalizeRuleInput(rule);
    data.ruleId = ruleId || rule.ruleId || rule.id;
    data.version = version || rule.version || 1;
    data.name = name || rule.name || data.ruleId;
    return data;
  }

  function batchOrder(state) {
    return (state.batches || []).map(function (batch) { return batch.id; });
  }

  function batchPosition(state, batchId) {
    return batchOrder(state).indexOf(batchId);
  }

  function batchName(state, batchId) {
    var found = (state.batches || []).find(function (batch) {
      return batch.id === batchId;
    });
    return found ? found.name : batchId;
  }

  function targetPosition(state, target) {
    return batchPosition(state, target.batchId);
  }

  function scopeMatches(rule, target) {
    var batchMatched = rule.scopeBatches.indexOf(target.batchId) >= 0;
    var labelMatched = rule.scopeLabels.length === 0 || rule.scopeLabels.every(function (label) {
      return target.labels.indexOf(label) >= 0;
    });
    return batchMatched && labelMatched;
  }

  function publishedRules(state) {
    return (state.rules || []).filter(function (rule) {
      return rule.status === 'published' && rule.published;
    }).map(function (rule) { return rule.published; });
  }

  function evaluateBatchTrust(state) {
    var trust = new Map();
    function ensure(id, name) {
      if (!trust.has(id)) {
        trust.set(id, {
          id: id,
          name: name || id,
          exists: false,
          ready: false,
          reasons: [],
          relatedRules: []
        });
      }
      return trust.get(id);
    }

    (state.batches || []).forEach(function (batch) {
      var item = ensure(batch.id, batch.name);
      item.exists = true;
      item.ready = batch.ready !== false;
      if (!item.ready) {
        item.reasons.push('批次未就绪：发布线不能把该批目标视为可信生效。');
      }
    });

    (state.targets || []).forEach(function (target) {
      if (batchPosition(state, target.batchId) < 0) {
        var missingTargetBatch = ensure(target.batchId);
        missingTargetBatch.exists = false;
        missingTargetBatch.ready = false;
        missingTargetBatch.reasons.push(
          '目标 ' + target.id + ' 归属于不存在的批次，无法确定其上线时刻。'
        );
      }
    });

    publishedRules(state).forEach(function (rule) {
      if (batchPosition(state, rule.effectiveBatch) < 0) {
        var effective = ensure(rule.effectiveBatch);
        effective.exists = false;
        effective.ready = false;
        if (effective.relatedRules.indexOf(rule.ruleId) < 0) {
          effective.relatedRules.push(rule.ruleId);
        }
        effective.reasons.push(
          '规则 ' + rule.ruleId + ' 的生效批次缺失，无法确定其进入发布链路的时刻。'
        );
      }
      rule.scopeBatches.forEach(function (batchId) {
        if (batchPosition(state, batchId) < 0) {
          var scoped = ensure(batchId);
          scoped.exists = false;
          scoped.ready = false;
          if (scoped.relatedRules.indexOf(rule.ruleId) < 0) {
            scoped.relatedRules.push(rule.ruleId);
          }
          scoped.reasons.push(
            '规则 ' + rule.ruleId + ' 的作用范围指向缺失批次。'
          );
        }
      });
    });

    return trust;
  }

  function trustItem(trustMap, batchId) {
    return trustMap.get(batchId) || null;
  }

  function isUntrustedBatch(trustMap, batchId) {
    var item = trustItem(trustMap, batchId);
    return Boolean(item && (!item.exists || !item.ready));
  }

  function candidateStatus(rule, target, state, currentIndex) {
    var targetIndex = targetPosition(state, target);
    var effectiveIndex = batchPosition(state, rule.effectiveBatch);
    if (targetIndex < 0) return { eligible: false, state: 'blocked', reason: '目标批次缺失，无法确认目标是否已到发布时刻。' };
    if (effectiveIndex < 0) return { eligible: false, state: 'blocked', reason: '规则指向的生效批次缺失，不能静默假定其已生效。' };
    if (currentIndex < 0) return { eligible: false, state: 'blocked', reason: '当前推演时刻不在已定义批次中。' };
    if (targetIndex > currentIndex) return { eligible: false, state: 'waiting-target', reason: '该目标属于更晚批次，尚未到达生效时刻。' };
    if (effectiveIndex > currentIndex) return { eligible: false, state: 'waiting-rule', reason: '规则在更晚批次才进入发布链路。' };
    return { eligible: true, state: 'eligible', reason: '规则已发布，作用范围命中，且生效批次不晚于当前推演时刻。' };
  }

  function makeCandidate(rule, target, state, currentIndex) {
    var status = candidateStatus(rule, target, state, currentIndex);
    var effectiveIndex = batchPosition(state, rule.effectiveBatch);
    var targetIndex = targetPosition(state, target);
    var labelText = rule.scopeLabels.length ? rule.scopeLabels.join('、') : '不限标签';
    var basis = [
      '作用范围：批次包含 ' + rule.scopeBatches.join('、') + '；标签条件为 ' + labelText + '。',
      '目标归属：批次 ' + target.batchId + '；标签 ' + target.labels.join('、') + '。',
      '优先级：' + rule.priority + '；生效批次：' + rule.effectiveBatch +
        (effectiveIndex >= 0 ? '（顺序 ' + (effectiveIndex + 1) + '）' : '（缺失）') + '。'
    ];
    if (targetIndex >= 0) basis.push('目标批次顺序：' + (targetIndex + 1) + '。');
    basis.push(status.reason);
    return {
      candidateId: rule.ruleId + '@v' + rule.version,
      ruleId: rule.ruleId, version: rule.version, name: rule.name,
      key: rule.key, value: rule.value, priority: rule.priority,
      effectiveBatch: rule.effectiveBatch, effectiveBatchIndex: effectiveIndex,
      scopeLabels: clone(rule.scopeLabels), scopeBatches: clone(rule.scopeBatches),
      eligible: status.eligible, state: status.state, basis: basis
    };
  }

  function sortCandidates(candidates) {
    return candidates.slice().sort(function (a, b) {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (b.effectiveBatchIndex !== a.effectiveBatchIndex) return b.effectiveBatchIndex - a.effectiveBatchIndex;
      if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
      return b.version - a.version;
    });
  }

  function decisionKey(targetId, configKey) {
    return targetId + '\u0000' + configKey;
  }

  function evaluateConfigKey(target, configKey, candidates, state, currentIndex, trustMap) {
    var ordered = sortCandidates(candidates);
    var eligible = ordered.filter(function (candidate) { return candidate.eligible; });
    var recommended = eligible[0] || null;
    var resolution = (state.resolutions || {})[decisionKey(target.id, configKey)] || null;
    var chosen = null;
    var staleResolution = null;

    if (resolution) {
      var found = ordered.find(function (candidate) {
        return candidate.ruleId === resolution.ruleId &&
          candidate.version === resolution.ruleVersion;
      });
      if (found && found.eligible) chosen = found;
      else staleResolution = {
        ruleId: resolution.ruleId,
        ruleVersion: resolution.ruleVersion,
        reason: !found ? '原裁决规则或版本已不在当前候选集中，需要重新确认。' : '原裁决规则当前不可生效，不能继续作为确定值。'
      };
    }

    var conflict = eligible.length > 1;
    var status = 'inactive';
    if (eligible.length > 0) status = conflict && !chosen ? 'conflict' : 'active';

    var warnings = [];
    var targetBatchTrust = trustItem(trustMap, target.batchId);
    if (targetBatchTrust && (!targetBatchTrust.exists || !targetBatchTrust.ready)) {
      warnings.push('目标批次不可信：' + targetBatchTrust.reasons.join('；'));
    }
    if (currentIndex < 0) warnings.push('当前推演批次缺失，无法建立可信的时间顺序。');
    candidates.forEach(function (candidate) {
      if (isUntrustedBatch(trustMap, candidate.effectiveBatch)) {
        warnings.push('候选 ' + candidate.candidateId + ' 的生效批次不可信。');
      }
      candidate.scopeBatches.forEach(function (batchId) {
        if (batchId === target.batchId && isUntrustedBatch(trustMap, batchId)) {
          warnings.push('候选 ' + candidate.candidateId + ' 通过缺失的目标批次命中。');
        }
      });
    });
    warnings = uniqueTrimmed(warnings);

    var effective = chosen || (eligible.length === 1 && !conflict ? eligible[0] : null);
    var evidence = [];
    if (eligible.length === 0) evidence.push('当前没有可生效候选，配置键保持未由发布链路确定的状态。');
    else if (eligible.length === 1) evidence.push('仅有一条可生效候选，无需用户裁决；' + eligible[0].candidateId + ' 成为当前版本。');
    else if (chosen) {
      evidence.push('存在 ' + eligible.length + ' 条可生效覆盖；用户裁决选择 ' + chosen.candidateId + '。');
      if (recommended && recommended.candidateId !== chosen.candidateId) {
        evidence.push('系统推荐为 ' + recommended.candidateId + '，但推荐不会覆盖用户裁决。');
      }
    } else {
      evidence.push('存在 ' + eligible.length + ' 条可生效覆盖；所有候选均保留，等待用户裁决后才确定生效值。');
      if (recommended) evidence.push('推荐候选：' + recommended.candidateId + '；依据为优先级、生效批次和稳定排序。');
    }
    if (staleResolution) evidence.push(staleResolution.reason);
    warnings.forEach(function (warning) { evidence.push('可信性提示：' + warning); });

    return {
      key: configKey,
      status: status,
      untrusted: warnings.length > 0,
      conflict: conflict,
      chosenCandidateId: chosen ? chosen.candidateId : null,
      recommendedCandidateId: recommended ? recommended.candidateId : null,
      effectiveValue: effective ? effective.value : null,
      effectiveVersion: effective ? {
        ruleId: effective.ruleId, version: effective.version,
        candidateId: effective.candidateId, priority: effective.priority,
        effectiveBatch: effective.effectiveBatch
      } : null,
      candidates: ordered,
      staleResolution: staleResolution,
      warnings: warnings,
      evidence: evidence
    };
  }

  function evaluateTarget(state, target, currentBatchId, trustMap) {
    trustMap = trustMap || evaluateBatchTrust(state);
    currentBatchId = currentBatchId == null ? state.currentBatchId : currentBatchId;
    var currentIndex = batchPosition(state, currentBatchId);
    var activePublished = publishedRules(state);
    var matched = activePublished.filter(function (rule) { return scopeMatches(rule, target); });
    var groups = new Map();
    matched.forEach(function (rule) {
      if (!groups.has(rule.key)) groups.set(rule.key, []);
      groups.get(rule.key).push(makeCandidate(rule, target, state, currentIndex));
    });
    (target.observedKeys || []).forEach(function (key) {
      if (!groups.has(key)) groups.set(key, []);
    });
    (target.baseConfig || []).forEach(function (item) {
      if (!groups.has(item.key)) groups.set(item.key, []);
    });

    var configs = Array.from(groups.keys()).sort().map(function (key) {
      return evaluateConfigKey(target, key, groups.get(key), state, currentIndex, trustMap);
    });
    var targetTrust = trustItem(trustMap, target.batchId);
    var targetWarnings = [];
    if (targetTrust && (!targetTrust.exists || !targetTrust.ready)) {
      targetWarnings.push.apply(targetWarnings, targetTrust.reasons);
    }
    var hasConflict = configs.some(function (item) { return item.status === 'conflict'; });
    var hasActive = configs.some(function (item) { return item.status === 'active'; });
    var hasUntrusted = targetWarnings.length > 0 || configs.some(function (item) { return item.untrusted; });
    return {
      targetId: target.id,
      name: target.name,
      batchId: target.batchId,
      labels: clone(target.labels),
      status: hasConflict ? 'conflict' : hasUntrusted ? 'untrusted' : hasActive ? 'active' : 'inactive',
      untrusted: hasUntrusted,
      conflict: hasConflict,
      warnings: uniqueTrimmed(targetWarnings),
      configs: configs
    };
  }

  function evaluateAll(state, currentBatchId) {
    currentBatchId = currentBatchId == null ? state.currentBatchId : currentBatchId;
    var trustMap = evaluateBatchTrust(state);
    var results = (state.targets || []).map(function (target) {
      return evaluateTarget(state, target, currentBatchId, trustMap);
    });
    var knownOrder = batchOrder(state);
    var referencedIds = Array.from(trustMap.keys()).filter(function (id) {
      return knownOrder.indexOf(id) < 0;
    }).sort();
    var batches = knownOrder.concat(referencedIds).map(function (id) {
      var item = trustMap.get(id);
      return {
        id: id,
        name: item.name,
        exists: item.exists,
        ready: item.ready,
        trusted: item.exists && item.ready,
        reasons: item.reasons,
        relatedRules: item.relatedRules
      };
    });
    return {
      currentBatchId: currentBatchId,
      batches: batches,
      targets: results,
      conflicts: results.reduce(function (total, item) {
        return total + item.configs.filter(function (config) { return config.conflict && config.status === 'conflict'; }).length;
      }, 0),
      untrustedTargets: results.filter(function (item) { return item.untrusted; }).length
    };
  }

  function getRule(state, ruleId) {
    return (state.rules || []).find(function (rule) { return rule.id === ruleId; }) || null;
  }

  function ruleMatchesTarget(ruleData, target) {
    return scopeMatches(ruleData, target);
  }

  function targetsForRule(state, ruleData) {
    if (!ruleData) return [];
    return (state.targets || []).filter(function (target) {
      return scopeMatches(ruleData, target);
    }).map(function (target) { return target.id; });
  }

  function targetsWithResolution(state, ruleId) {
    return (state.targets || []).filter(function (target) {
      return Object.keys(state.resolutions || {}).some(function (key) {
        return key.indexOf(target.id + '\u0000') === 0 &&
          state.resolutions[key].ruleId === ruleId;
      });
    }).map(function (target) { return target.id; });
  }

  function affectedTargetIds(state, oldData, newData, ruleId) {
    var ids = new Set(targetsForRule(state, oldData));
    targetsForRule(state, newData).forEach(function (id) { ids.add(id); });
    targetsWithResolution(state, ruleId).forEach(function (id) { ids.add(id); });
    return Array.from(ids);
  }

  function rememberObservedKeys(state, ids, keys) {
    (state.targets || []).forEach(function (target) {
      if (ids.indexOf(target.id) < 0) return;
      target.observedKeys = target.observedKeys || [];
      keys.forEach(function (key) {
        if (key && target.observedKeys.indexOf(key) < 0) target.observedKeys.push(key);
      });
      target.observedKeys.sort();
    });
  }

  function publishRule(state, ruleId, patch) {
    var rule = getRule(state, ruleId);
    if (!rule) {
      rule = { id: ruleId, name: ruleId, status: 'draft', version: 0, draft: normalizeRuleInput({ id: ruleId }) };
      state.rules.push(rule);
    }
    var nextInput = normalizeRuleInput(Object.assign({
      key: rule.draft ? rule.draft.key : (rule.published || {}).key,
      value: rule.draft ? rule.draft.value : (rule.published || {}).value,
      priority: rule.draft ? rule.draft.priority : (rule.published || {}).priority,
      effectiveBatch: rule.draft ? rule.draft.effectiveBatch : (rule.published || {}).effectiveBatch,
      scopeLabels: rule.draft ? rule.draft.scopeLabels : (rule.published || {}).scopeLabels,
      scopeBatches: rule.draft ? rule.draft.scopeBatches : (rule.published || {}).scopeBatches
    }, patch));
    var oldData = rule.published || null;
    var nextVersion = (rule.version || 0) + 1;
    var snapshot = snapshotRule(nextInput, nextVersion, ruleId, rule.name || ruleId);
    var affected = affectedTargetIds(state, oldData, snapshot, ruleId);
    rememberObservedKeys(state, affected, [snapshot.key, oldData ? oldData.key : null]);
    rule.name = snapshot.name;
    rule.draft = clone(nextInput);
    rule.published = snapshot;
    rule.version = nextVersion;
    rule.status = 'published';
    rule.updatedAt = state.currentBatchId;
    delete rule.withdrawnAt;
    delete rule.withdrawReason;
    return { rule: clone(rule), affectedTargetIds: affected };
  }

  function saveDraft(state, ruleId, patch) {
    var rule = getRule(state, ruleId);
    if (!rule) {
      rule = { id: ruleId, name: ruleId, status: 'draft', version: 0, draft: normalizeRuleInput({ id: ruleId }) };
      state.rules.push(rule);
    }
    var source = rule.draft || rule.published || {};
    rule.draft = normalizeRuleInput(Object.assign({}, source, patch));
    rule.status = rule.published ? rule.status : 'draft';
    return { rule: clone(rule), affectedTargetIds: [] };
  }

  function withdrawRule(state, ruleId, reason) {
    var rule = getRule(state, ruleId);
    if (!rule) throw new Error('Unknown rule: ' + ruleId);
    var oldData = rule.published || null;
    var affected = affectedTargetIds(state, oldData, null, ruleId);
    rememberObservedKeys(state, affected, oldData ? [oldData.key] : []);
    rule.status = 'withdrawn';
    rule.withdrawnAt = state.currentBatchId;
    rule.withdrawReason = reason || '用户撤回';
    return { rule: clone(rule), affectedTargetIds: affected };
  }

  function resolveConflict(state, targetId, configKey, candidateId) {
    var candidate = null;
    publishedRules(state).some(function (rule) {
      if (rule.ruleId + '@v' + rule.version !== candidateId) return false;
      var target = (state.targets || []).find(function (item) { return item.id === targetId; });
      if (target && rule.key === configKey && scopeMatches(rule, target)) {
        candidate = rule;
        return true;
      }
      return false;
    });
    if (!candidate) throw new Error('Candidate is not currently available: ' + candidateId);
    state.resolutions = state.resolutions || {};
    state.resolutions[decisionKey(targetId, configKey)] = {
      ruleId: candidate.ruleId,
      ruleVersion: candidate.version,
      candidateId: candidateId,
      decidedAt: state.currentBatchId
    };
    return { targetId: targetId, affectedTargetIds: [targetId] };
  }

  function clearResolution(state, targetId, configKey) {
    if (state.resolutions) delete state.resolutions[decisionKey(targetId, configKey)];
    return { targetId: targetId, affectedTargetIds: [targetId] };
  }

  function setBatchReady(state, batchId, ready) {
    var batch = (state.batches || []).find(function (item) { return item.id === batchId; });
    if (!batch) throw new Error('Unknown batch: ' + batchId);
    batch.ready = Boolean(ready);
    return {
      batchId: batchId,
      affectedTargetIds: (state.targets || [])
        .filter(function (target) { return target.batchId === batchId; })
        .map(function (target) { return target.id; })
    };
  }

  function setCurrentBatch(state, batchId) {
    if (batchPosition(state, batchId) < 0) throw new Error('Unknown current batch: ' + batchId);
    state.currentBatchId = batchId;
    return { batchId: batchId };
  }

  function recomputeAffected(state, targetIds, currentBatchId) {
    currentBatchId = currentBatchId == null ? state.currentBatchId : currentBatchId;
    var trustMap = evaluateBatchTrust(state);
    var targets = (state.targets || []).filter(function (target) {
      return targetIds.indexOf(target.id) >= 0;
    }).map(function (target) {
      return evaluateTarget(state, target, currentBatchId, trustMap);
    });
    var knownOrder = batchOrder(state);
    var batches = knownOrder.concat(Array.from(trustMap.keys()).filter(function (id) {
      return knownOrder.indexOf(id) < 0;
    }).sort()).map(function (id) {
      var item = trustMap.get(id);
      return {
        id: id, name: item.name, exists: item.exists, ready: item.ready,
        trusted: item.exists && item.ready, reasons: item.reasons,
        relatedRules: item.relatedRules
      };
    });
    return { currentBatchId: currentBatchId, batches: batches, targets: targets };
  }

  function defaultState() {
    return { currentBatchId: null, batches: [], targets: [], rules: [], resolutions: {} };
  }

  return {
    clone: clone,
    normalizeRuleInput: normalizeRuleInput,
    evaluateBatchTrust: evaluateBatchTrust,
    evaluateTarget: evaluateTarget,
    evaluateAll: evaluateAll,
    recomputeAffected: recomputeAffected,
    publishRule: publishRule,
    saveDraft: saveDraft,
    withdrawRule: withdrawRule,
    resolveConflict: resolveConflict,
    clearResolution: clearResolution,
    setBatchReady: setBatchReady,
    setCurrentBatch: setCurrentBatch,
    affectedTargetIds: affectedTargetIds,
    defaultState: defaultState
  };
});
