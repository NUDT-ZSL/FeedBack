import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, normalizeEdit, validateEdit, deriveDocument, conflictResolutionKey } from './js/core.js';

function doc() {
  return {
    ...createInitialState(),
    baseSegments: [
      { id: 's1', content: '第一段', source: '原始内容' },
      { id: 's2', content: '第二段', source: '原始内容' }
    ]
  };
}

function addEdit(state, input) {
  const edit = normalizeEdit(input);
  const checked = validateEdit(edit, state, edit.id);
  assert.equal(checked.ok, true, checked.error);
  state.edits.push(checked.edit);
  return checked.edit;
}

test('同顺序修改会保留为冲突，不静默择一', () => {
  const state = doc();
  addEdit(state, { id: 'e1', source: '甲', seq: 1, opType: 'replace', targetId: 's1', content: '甲版本' });
  addEdit(state, { id: 'e2', source: '乙', seq: 1, opType: 'replace', targetId: 's1', content: '乙版本' });
  const result = deriveDocument(state);
  assert.equal(result.pendingConflicts.length, 1);
  assert.equal(result.segments[0].status, 'conflict');
  assert.deepEqual(result.segments[0].editIds, ['e1', 'e2']);
});

test('冲突可以逐槽采纳，并立即形成最终内容', () => {
  const state = doc();
  addEdit(state, { id: 'e1', source: '甲', seq: 1, opType: 'replace', targetId: 's1', content: '甲版本' });
  addEdit(state, { id: 'e2', source: '乙', seq: 2, opType: 'delete', targetId: 's1', content: '' });
  const result = deriveDocument(state);
  assert.equal(result.pendingConflicts.length, 1);
  const conflict = result.conflicts[0];
  state.resolutions[conflictResolutionKey(conflict.id, conflict.slots[0].key)] = {
    type: 'edit', editId: 'e1', content: '甲版本'
  };
  const resolved = deriveDocument(state);
  assert.equal(resolved.pendingConflicts.length, 0);
  assert.equal(resolved.segments[0].content, '甲版本');
  assert.equal(resolved.segments[0].status, 'resolved');
});

test('缺少来源或目标不存在时给出可读错误，其他片段不受影响', () => {
  const state = doc();
  state.edits.push(normalizeEdit({ id: 'bad-source', source: '', seq: 1, opType: 'replace', targetId: 's1', content: 'X' }));
  state.edits.push(normalizeEdit({ id: 'bad-target', source: '甲', seq: 1, opType: 'replace', targetId: 'missing', content: 'Y' }));
  addEdit(state, { id: 'good', source: '乙', seq: 2, opType: 'replace', targetId: 's2', content: '有效修改' });
  const result = deriveDocument(state);
  assert.match(result.errors[0].message, /缺少来源/);
  assert.match(result.errors[1].message, /目标片段不存在/);
  assert.equal(result.segments[0].content, '第一段');
  assert.equal(result.segments[1].content, '有效修改');
});

test('撤回修改后的推导结果与从头只保留有效修改一致', () => {
  const state = doc();
  addEdit(state, { id: 'e1', source: '甲', seq: 1, opType: 'replace', targetId: 's1', content: '甲版本' });
  addEdit(state, { id: 'e2', source: '乙', seq: 2, opType: 'insertAfter', targetId: 's1', content: '插入片段' });
  const withdrawn = structuredClone(state);
  withdrawn.edits[0].withdrawn = true;
  const clean = doc();
  addEdit(clean, { id: 'e2', source: '乙', seq: 2, opType: 'insertAfter', targetId: 's1', content: '插入片段' });
  assert.deepEqual(deriveDocument(withdrawn).segments, deriveDocument(clean).segments);
});

test('同位置并行插入也会成为未决冲突', () => {
  const state = doc();
  addEdit(state, { id: 'i1', source: '甲', seq: 1, opType: 'insertAfter', targetId: 's1', content: '插入甲' });
  addEdit(state, { id: 'i2', source: '乙', seq: 1, opType: 'insertAfter', targetId: 's1', content: '插入乙' });
  const result = deriveDocument(state);
  assert.equal(result.pendingConflicts.length, 1);
  assert.ok(result.segments.some(segment => segment.kind === 'insert' && segment.unresolved));
});

test('相同顺序跨片段时每个受影响位置都需要决策', () => {
  const state = doc();
  addEdit(state, { id: 'a1', source: '甲', seq: 1, opType: 'replace', targetId: 's1', content: '甲改第一段' });
  addEdit(state, { id: 'b1', source: '乙', seq: 1, opType: 'replace', targetId: 's2', content: '乙改第二段' });
  const result = deriveDocument(state);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].slots.length, 2);
  assert.equal(result.stats.pendingCount, 2);
});

test('顺序插入形成的新片段可继续修改，撤回后下游重新推导', () => {
  const state = doc();
  addEdit(state, { id: 'i1', source: '甲', seq: 1, opType: 'insertAfter', targetId: 's1', content: '新插入' });
  addEdit(state, { id: 'r1', source: '乙', seq: 2, opType: 'replace', targetId: 'i1', content: '改写插入' });
  const inserted = deriveDocument(state).segments.map(segment => segment.content);
  assert.deepEqual(inserted, ['第一段', '改写插入', '第二段']);
  state.edits[1].withdrawn = true;
  const afterWithdraw = deriveDocument(state).segments.map(segment => segment.content);
  assert.deepEqual(afterWithdraw, ['第一段', '新插入', '第二段']);
});

test('手动改写也是合法冲突解决结果', () => {
  const state = doc();
  addEdit(state, { id: 'e1', source: '甲', seq: 1, opType: 'replace', targetId: 's1', content: '甲版本' });
  addEdit(state, { id: 'e2', source: '乙', seq: 2, opType: 'replace', targetId: 's1', content: '乙版本' });
  const conflict = deriveDocument(state).conflicts[0];
  state.resolutions[conflictResolutionKey(conflict.id, conflict.slots[0].key)] = {
    type: 'manual', content: '协调后的版本'
  };
  const result = deriveDocument(state);
  assert.equal(result.segments[0].content, '协调后的版本');
  assert.equal(result.segments[0].provenance.at(-1).name, '手动改写');
});

test('删除片段时最终内容会移除该片段，后续片段保持有序', () => {
  const state = doc();
  addEdit(state, { id: 'd1', source: '甲', seq: 1, opType: 'delete', targetId: 's1', content: '' });
  const result = deriveDocument(state);
  assert.deepEqual(result.segments.map(segment => segment.content), ['第二段']);
  assert.equal(result.segments[0].order, 1);
});
