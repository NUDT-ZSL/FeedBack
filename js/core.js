// 纯函数核心：不访问 DOM / localStorage，便于命令行测试和保证重算一致性。

export const BASE_SOURCE = { id: 'base', name: '原始内容', color: '#64748b' };

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createInitialState() {
  return {
    id: uid('doc'),
    title: '未命名共享内容',
    baseSegments: [],
    edits: [],
    resolutions: {}
  };
}

export function normalizeEdit(input = {}) {
  const seq = Number(input.seq);
  return {
    id: input.id || uid('edit'),
    source: String(input.source || '').trim(),
    seq: Number.isFinite(seq) ? Math.trunc(seq) : NaN,
    opType: input.opType,
    targetId: String(input.targetId || ''),
    content: String(input.content ?? '').trim(),
    withdrawn: Boolean(input.withdrawn),
    updatedAt: input.updatedAt || new Date().toISOString()
  };
}

export function validateEdit(input, state, ignoreId = null) {
  const edit = normalizeEdit(input);
  if (!edit.source) return { ok: false, error: '缺少来源：请填写提交者或来源名称。', edit };
  if (!Number.isInteger(edit.seq) || edit.seq < 0) {
    return { ok: false, error: '发生顺序无效：请填写不小于 0 的整数。', edit };
  }
  if (!['replace', 'insertAfter', 'delete'].includes(edit.opType)) {
    return { ok: false, error: '操作类型无效：仅支持改写、插入或删除。', edit };
  }
  if (!edit.targetId) return { ok: false, error: '缺少目标：请选择该修改针对的片段。', edit };

  const duplicate = state.edits.find(item => item.id !== ignoreId &&
    item.source === edit.source && item.seq === edit.seq &&
    item.opType === edit.opType && item.targetId === edit.targetId &&
    item.content === edit.content && !item.withdrawn);
  if (duplicate) return { ok: false, error: '这是一条完全相同的未撤回修改，已避免重复提交。', edit };

  const base = state.baseSegments.find(segment => segment.id === edit.targetId);
  const provider = !base && !edit.targetId
    ? null
    : state.edits.find(item => item.id !== ignoreId && !item.withdrawn && item.id === edit.targetId && item.opType === 'insertAfter');
  if (!base && !provider) {
    return { ok: false, error: `目标片段不存在：“${edit.targetId}”可能已被撤回，或从未加入共享内容。`, edit };
  }
  if (provider && provider.seq >= edit.seq) {
    return { ok: false, error: '目标插入片段尚未发生：只能针对发生顺序更早的插入片段继续修改。', edit };
  }
  if (edit.opType !== 'delete' && !edit.content) {
    return { ok: false, error: edit.opType === 'insertAfter' ? '插入内容不能为空。' : '改写内容不能为空。', edit };
  }
  return { ok: true, error: null, edit };
}

class DSU {
  constructor(items) { this.parent = new Map(items.map(item => [item, item])); }
  find(item) {
    const next = this.parent.get(item);
    if (next === item) return item;
    const root = this.find(next);
    this.parent.set(item, root);
    return root;
  }
  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function slotKey(edit) {
  return `${edit.opType === 'insertAfter' ? 'insert' : 'mutate'}:${edit.targetId}`;
}

function optionFromEdit(edit) {
  return {
    type: 'edit',
    editId: edit.id,
    sourceId: edit.id,
    label: edit.opType === 'delete'
      ? `采纳删除（${edit.source}，顺序 ${edit.seq}）`
      : `采纳 ${edit.source} 的内容（顺序 ${edit.seq}）`,
    content: edit.opType === 'delete' ? '' : edit.content
  };
}

function buildConflicts(active) {
  const byId = new Map(active.map(edit => [edit.id, edit]));
  const dsu = new DSU(active.map(edit => edit.id));
  const reasons = [];

  const bySeq = new Map();
  for (const edit of active) {
    const list = bySeq.get(edit.seq) || [];
    list.push(edit);
    bySeq.set(edit.seq, list);
  }
  for (const list of bySeq.values()) {
    for (let i = 1; i < list.length; i++) {
      dsu.union(list[0].id, list[i].id);
      reasons.push({ kind: 'same-seq', seq: list[i].seq, editIds: [list[0].id, list[i].id] });
    }
  }

  const byTarget = new Map();
  for (const edit of active) {
    const list = byTarget.get(edit.targetId) || [];
    list.push(edit);
    byTarget.set(edit.targetId, list);
  }
  for (const list of byTarget.values()) {
    const mutations = list.filter(edit => edit.opType !== 'insertAfter');
    for (let i = 1; i < mutations.length; i++) {
      dsu.union(mutations[0].id, mutations[i].id);
      reasons.push({ kind: 'same-target', targetId: mutations[i].targetId, editIds: [mutations[0].id, mutations[i].id] });
    }
    if (mutations.some(edit => edit.opType === 'delete')) {
      for (let i = 1; i < list.length; i++) dsu.union(list[0].id, list[i].id);
    }
  }

  const groups = new Map();
  for (const edit of active) {
    const root = dsu.find(edit.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(edit);
  }

  const conflicts = [];
  for (const edits of groups.values()) {
    if (edits.length === 1) continue;
    const ids = edits.map(edit => edit.id).sort();
    const slotMap = new Map();
    for (const edit of edits) {
      const key = slotKey(edit);
      if (!slotMap.has(key)) slotMap.set(key, []);
      slotMap.get(key).push(edit);
    }
    const slots = [...slotMap.entries()].map(([key, slotEdits]) => {
      const kind = key.startsWith('insert:') ? 'insert' : 'mutate';
      const options = slotEdits.map(optionFromEdit);
      if (kind === 'mutate') options.push({ type: 'base', label: '保留原始片段', content: null });
      options.push({ type: 'manual', label: '手动改写为……', content: '' });
      if (kind === 'insert') options.splice(options.length - 1, 0, { type: 'omit', label: '不插入此片段', content: '' });
      return { key, kind, targetId: slotEdits[0].targetId, editIds: slotEdits.map(edit => edit.id), options };
    });
    conflicts.push({
      id: `conflict_${ids.join('_')}`,
      editIds: ids,
      participantIds: ids,
      slots,
      reasons: reasons.filter(reason => reason.editIds.every(editId => ids.includes(editId)))
    });
  }
  return { byId, conflicts };
}

function sourceFromEdit(edit) {
  return { id: edit.id, name: `${edit.source} · #${edit.seq}`, sourceName: edit.source, seq: edit.seq };
}

function resolutionFor(conflict, slot, resolutions) {
  const value = resolutions[`${conflict.id}::${slot.key}`];
  if (!value) return null;
  if (value.type === 'edit' && slot.editIds.includes(value.editId)) return value;
  if (value.type === 'base' && slot.kind === 'mutate') return value;
  if (value.type === 'omit' && slot.kind === 'insert') return value;
  if (value.type === 'manual' && String(value.content || '').trim()) return { ...value, content: String(value.content).trim() };
  return null;
}

function conflictSummary(conflict) {
  const sameSeq = conflict.reasons.filter(reason => reason.kind === 'same-seq');
  const sameTarget = conflict.reasons.filter(reason => reason.kind === 'same-target');
  const parts = [];
  if (sameSeq.length) parts.push(`存在相同发生顺序 ${[...new Set(sameSeq.map(item => item.seq))].join('、')}`);
  if (sameTarget.length) parts.push('多个修改指向同一片段');
  return parts.join('；') || '并行修改相互关联';
}

export function deriveDocument(state) {
  const errors = [];
  const valid = [];
  for (const edit of state.edits) {
    if (edit.withdrawn) continue;
    const check = validateEdit(edit, state, edit.id);
    if (check.ok) valid.push(edit);
    else errors.push({ editId: edit.id, source: edit.source, message: check.error });
  }

  const active = valid.sort((a, b) => a.seq - b.seq || a.source.localeCompare(b.source, 'zh-CN') || a.id.localeCompare(b.id));
  const { byId, conflicts: rawConflicts } = buildConflicts(active);
  const conflictByEdit = new Map();
  for (const conflict of rawConflicts) {
    for (const editId of conflict.editIds) conflictByEdit.set(editId, conflict);
  }

  const contributions = new Map();
  const ensureTarget = id => {
    if (!contributions.has(id)) contributions.set(id, { mutate: null, inserts: [] });
    return contributions.get(id);
  };
  for (const edit of active) {
    const target = ensureTarget(edit.targetId);
    const conflict = conflictByEdit.get(edit.id);
    if (!conflict) {
      const contribution = { kind: 'clean', edit, minSeq: edit.seq };
      if (edit.opType === 'insertAfter') target.inserts.push(contribution);
      else target.mutate = contribution;
    }
  }
  for (const conflict of rawConflicts) {
    for (const slot of conflict.slots) {
      const target = ensureTarget(slot.targetId);
      const contribution = {
        kind: 'conflict', conflict, slot,
        minSeq: Math.min(...slot.editIds.map(id => byId.get(id).seq))
      };
      if (slot.kind === 'insert') target.inserts.push(contribution);
      else target.mutate = contribution;
    }
  }
  for (const target of contributions.values()) {
    target.inserts.sort((a, b) => a.minSeq - b.minSeq ||
      (a.edit?.id || a.conflict.id).localeCompare(b.edit?.id || b.conflict.id));
  }

  const warnings = [];
  const blockedEditIds = new Set();
  const segments = [];
  function allContributionEditIds(contribution) {
    if (contribution.kind === 'clean') return [contribution.edit.id];
    return contribution.slot.editIds;
  }

  function blockContribution(contribution, reason, silent = false) {
    for (const editId of allContributionEditIds(contribution)) {
      if (!blockedEditIds.has(editId)) {
        blockedEditIds.add(editId);
        const edit = byId.get(editId);
        if (edit && !silent) warnings.push({ editId, source: edit.source, message: reason });
      }
    }
  }

  function blockDescendants(anchorIds, reason, seen = new Set()) {
    for (const anchorId of anchorIds) {
      if (seen.has(anchorId)) continue;
      seen.add(anchorId);
      const target = contributions.get(anchorId);
      if (!target) continue;
      const nextIds = [];
      if (target.mutate) {
        blockContribution(target.mutate, reason, target.mutate.kind === 'conflict');
        nextIds.push(...allContributionEditIds(target.mutate));
      }
      for (const insert of target.inserts) {
        blockContribution(insert, reason, insert.kind === 'conflict');
        nextIds.push(...allContributionEditIds(insert));
      }
      blockDescendants(nextIds, reason, seen);
    }
  }

  function renderInsert(contribution, resolved, anchorId, provenance, parentUnavailable = false) {
    const blocked = parentUnavailable || contribution.kind === 'conflict' && !resolved;
    if (blocked) blockContribution(contribution, '所依赖的上游片段仍有未决冲突，这条修改暂不进入最终内容。');
    if (contribution.kind === 'clean') {
      const edit = contribution.edit;
      if (parentUnavailable) {
        blockContribution(contribution, '上游片段不可用，该插入及其后续修改暂不应用。');
        blockDescendants([edit.id], '上游片段不可用，该插入及其后续修改暂不应用。');
        return;
      }
      renderNode({ id: edit.id, content: edit.content, source: edit.source }, [...provenance, sourceFromEdit(edit)], 'insert');
      return;
    }

    const { conflict, slot } = contribution;
    if (resolved) {
      const edit = resolved.type === 'edit' ? byId.get(resolved.editId) : null;
      if (resolved.type === 'omit') {
        // 用户明确选择不插入；其后代没有可依附的片段。
        blockContribution(contribution, '上游插入方案已选择“不插入”，后续修改暂不应用。', true);
        blockDescendants(slot.editIds, '上游插入方案已选择“不插入”，后续修改暂不应用。');
      } else {
        if (edit) {
          renderNode({ id: edit.id, content: resolved.content, source: edit.source },
            [...provenance, sourceFromEdit(edit)], 'insert');
        } else {
          const id = `manual::${conflict.id}::${slot.key}`;
          outputSegment(id, resolved.content, [...provenance, { id: 'manual', name: '手动改写' }], {
            kind: 'insert', status: 'resolved', conflictId: conflict.id, editIds: slot.editIds, slotKey: slot.key
          });
          renderChildAnchors([id]);
        }
      }
    } else {
      renderConflict(conflict, slot, anchorId, provenance, 'insert');
      blockDescendants(slot.editIds, '所依赖的插入片段仍有未决冲突，后续修改暂不进入最终内容。');
    }
  }

  function renderConflict(conflict, slot, anchorId, provenance, kind) {
    segments.push({
      id: `${conflict.id}::${slot.key}`,
      key: `conflict:${anchorId}:${slot.key}`,
      content: '',
      status: 'conflict',
      kind,
      conflictId: conflict.id,
      targetId: anchorId,
      provenance,
      editIds: slot.editIds,
      slotKey: slot.key,
      unresolved: true
    });
  }

  function renderChildAnchors(anchorIds, parentUnavailable = false) {
    const seen = new Set();
    for (const anchorId of anchorIds) {
      if (seen.has(anchorId)) continue;
      seen.add(anchorId);
      const target = contributions.get(anchorId);
      if (!target) continue;
      for (const insert of target.inserts) {
        if (insert.kind === 'clean' && contributions.get(insert.edit.id)?.mutate) {
          renderNode(
            { id: insert.edit.id, content: insert.edit.content, source: insert.edit.source },
            [sourceFromEdit(insert.edit)],
            'insert'
          );
          continue;
        }
        const conflict = insert.kind === 'conflict' ? insert.conflict : null;
        const slot = insert.kind === 'conflict' ? insert.slot : null;
        const resolved = conflict ? resolutionFor(conflict, slot, state.resolutions || {}) : null;
        renderInsert(insert, resolved, anchorId, [], parentUnavailable);
      }
    }
  }

  function renderNode(base, provenance, nodeKind = 'base') {
    const target = contributions.get(base.id);
    const mutation = target?.mutate;
    if (!mutation) {
      outputSegment(base.id, base.content, provenance, {
        kind: nodeKind === 'base' ? 'base' : 'insert',
        status: nodeKind === 'base' ? 'base' : 'clean',
        editIds: nodeKind === 'base' ? [] : [base.id]
      });
      renderChildAnchors([base.id]);
      return;
    }

    if (mutation.kind === 'clean') {
      const edit = mutation.edit;
      if (edit.opType === 'delete') {
        blockContribution(mutation, '该片段已被删除；依附于它的后续插入暂不进入最终内容。', true);
        renderChildAnchors([base.id]);
        return;
      }
      outputSegment(edit.id, edit.content, [...provenance, sourceFromEdit(edit)], {
        kind: nodeKind === 'base' ? 'replacement' : 'insert', status: 'clean', editIds: [edit.id]
      });
      if (nodeKind === 'base') renderChildAnchors([base.id]);
      else renderChildAnchors([edit.id]);
      return;
    }

    const { conflict, slot } = mutation;
    const resolved = resolutionFor(conflict, slot, state.resolutions || {});
    if (!resolved) {
      renderConflict(conflict, slot, base.id, provenance, 'mutate');
      blockDescendants(slot.editIds, '锚点片段的冲突尚未解决，后续修改暂不进入最终内容。');
      return;
    }

    if (resolved.type === 'base') {
      outputSegment(base.id, base.content, provenance, {
        kind: nodeKind === 'base' ? 'base' : 'insert',
        status: 'resolved', conflictId: conflict.id, editIds: slot.editIds, slotKey: slot.key
      });
      if (nodeKind === 'base') renderChildAnchors([base.id]);
      else renderChildAnchors([base.id]);
    } else if (resolved.type === 'edit' && byId.get(resolved.editId)?.opType === 'delete') {
      blockContribution(mutation, '用户选择删除该片段；依附于它的后续插入暂不进入最终内容。', true);
      renderChildAnchors([base.id]);
    } else {
      const edit = resolved.type === 'edit' ? byId.get(resolved.editId) : null;
      const id = edit ? edit.id : `manual::${conflict.id}::${slot.key}`;
          const source = edit
            ? sourceFromEdit(edit)
            : { id: 'manual', name: '手动改写', sourceName: '手动改写' };
      outputSegment(id, resolved.content, [...provenance, source], {
        kind: nodeKind === 'base' ? 'replacement' : 'insert',
        status: 'resolved', conflictId: conflict.id, editIds: slot.editIds, slotKey: slot.key
      });
      if (nodeKind === 'base') renderChildAnchors([base.id]);
      else renderChildAnchors([edit ? edit.id : id]);
    }
  }

  function outputSegment(id, content, provenance, meta) {
    const key = meta.kind === 'replacement' ? `replace:${id}`
      : meta.kind === 'insert' ? `insert:${id}`
      : `base:${id}`;
    segments.push({
      id, key, content,
      provenance,
      ...meta
    });
  }

  for (const base of state.baseSegments) {
    renderNode(base, [{ ...BASE_SOURCE, name: base.source || BASE_SOURCE.name }]);
  }
  segments.forEach((segment, index) => { segment.order = index + 1; });

  const conflicts = rawConflicts.map(conflict => {
    const slots = conflict.slots.map(slot => {
      const chosen = resolutionFor(conflict, slot, state.resolutions || {});
      return { ...slot, chosen, resolved: Boolean(chosen) };
    });
    return {
      ...conflict,
      summary: conflictSummary(conflict),
      slots,
      resolved: slots.every(slot => slot.resolved),
      pendingSlotCount: slots.filter(slot => !slot.resolved).length
    };
  });

  // 冲突解决后，未入选方案及其后代不能继续附着。
  for (const conflict of conflicts) {
    if (!conflict.resolved) continue;
    for (const slot of conflict.slots) {
      for (const editId of slot.editIds) {
        if (slot.chosen.type === 'edit' && editId === slot.chosen.editId) continue;
        if (slot.chosen.type === 'base' || slot.chosen.type === 'manual' || slot.chosen.type === 'omit') {
          blockDescendants([editId], '冲突已选择其他方案，该候选及其后续修改暂不应用。');
        } else if (slot.kind === 'insert') {
          blockDescendants([editId], '冲突已选择其他插入方案，该候选及其后续修改暂不应用。');
        }
      }
    }
  }

  const externalBlockedConflicts = new Set();
  for (const conflict of conflicts) {
    const slotTargets = conflict.slots.map(slot => slot.targetId);
    if (slotTargets.some(targetId => blockedEditIds.has(targetId))) externalBlockedConflicts.add(conflict.id);
    conflict.blocked = externalBlockedConflicts.has(conflict.id);
  }

  const pendingConflicts = conflicts.filter(conflict => !conflict.resolved && !conflict.blocked);
  const editStatus = new Map(active.map(edit => {
    const conflict = conflictByEdit.get(edit.id);
    let status = 'applied';
    if (errors.some(error => error.editId === edit.id)) status = 'invalid';
    else if (conflict) status = conflicts.find(item => item.id === conflict.id)?.resolved
      ? (blockedEditIds.has(edit.id) ? 'blocked-candidate' : 'resolved-candidate')
      : 'in-conflict';
    else if (blockedEditIds.has(edit.id)) status = 'blocked';
    return [edit.id, status];
  }));

  return {
    segments,
    conflicts,
    pendingConflicts,
    errors,
    warnings,
    editStatus,
    stats: {
      segmentCount: segments.filter(segment => !segment.unresolved).length,
      pendingCount: pendingConflicts.reduce((count, conflict) => count + conflict.pendingSlotCount, 0),
      activeEditCount: active.length,
      errorCount: state.edits.filter(edit => !edit.withdrawn).length - active.length
    }
  };
}

export function conflictResolutionKey(conflictId, slotKey) {
  return `${conflictId}::${slotKey}`;
}
