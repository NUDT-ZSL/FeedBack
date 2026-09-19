import {
  BASE_SOURCE,
  createInitialState,
  normalizeEdit,
  validateEdit,
  deriveDocument,
  conflictResolutionKey,
  uid
} from './core.js';

const STORAGE_KEY = 'offline-coeditor-state-v1';

const $ = selector => document.querySelector(selector);
const elements = {
  docTitle: $('#docTitle'),
  segmentList: $('#segmentList'),
  editList: $('#editList'),
  statSegments: $('#statSegments'),
  statPending: $('#statPending'),
  statEdits: $('#statEdits'),
  statErrors: $('#statErrors'),
  form: $('#editForm'),
  formTitle: $('#formTitle'),
  editId: $('#editId'),
  source: $('#sourceInput'),
  seq: $('#seqInput'),
  opType: $('#opTypeInput'),
  target: $('#targetInput'),
  content: $('#contentInput'),
  contentLabel: $('#contentLabel'),
  formMessage: $('#formMessage'),
  cancelEdit: $('#cancelEditBtn'),
  reset: $('#resetBtn'),
  exportBtn: $('#exportBtn'),
  toast: $('#toast')
};

let state = loadState();
let previousState = structuredClone(state);
let recomputedKeys = new Set();
let toastTimer = null;

function seedState() {
  const seeded = createInitialState();
  seeded.id = 'demo-document';
  seeded.title = '产品公告草稿';
  seeded.baseSegments = [
    { id: 'seg-intro', content: '我们将在本周五发布离线协作功能。', source: '原稿' },
    { id: 'seg-detail', content: '新版本支持多人提交、冲突解释与逐项确认。', source: '原稿' },
    { id: 'seg-ending', content: '感谢所有参与试用的同事。', source: '原稿' }
  ];
  seeded.edits = [
    normalizeEdit({ id: 'edit-chen-1', source: '陈编辑', seq: 1, opType: 'replace', targetId: 'seg-intro', content: '本周五，离线多人共编功能将正式发布。' }),
    normalizeEdit({ id: 'edit-lin-1', source: '林编辑', seq: 1, opType: 'replace', targetId: 'seg-intro', content: '我们计划在本周五上线离线协作协调功能。' }),
    normalizeEdit({ id: 'edit-wang-2', source: '王编辑', seq: 2, opType: 'insertAfter', targetId: 'seg-detail', content: '所有数据默认保留在本机，不会上传服务器。' }),
    normalizeEdit({ id: 'edit-bad-target', source: '赵编辑', seq: 3, opType: 'replace', targetId: 'old-paragraph', content: '这是一条指向已失效片段的记录。' })
  ];
  return seeded;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (error) {
    console.warn('读取本地状态失败，已使用示例数据。', error);
  }
  return seedState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function editById(id) {
  return state.edits.find(edit => edit.id === id);
}

function targetName(id) {
  const base = state.baseSegments.find(segment => segment.id === id);
  if (base) return `原片段：${base.content.slice(0, 18)}${base.content.length > 18 ? '…' : ''}`;
  const edit = editById(id);
  if (edit) return `插入片段：${edit.content.slice(0, 18)}${edit.content.length > 18 ? '…' : ''}`;
  return `不存在的片段：${id}`;
}

function opName(opType) {
  return { replace: '改写', insertAfter: '后插入', delete: '删除' }[opType] || opType;
}

function statusLabel(edit, result) {
  if (edit.withdrawn) return { text: '已撤回', className: 'status withdrawn' };
  if (result.errors.some(error => error.editId === edit.id)) return { text: '目标/数据问题', className: 'status invalid' };
  const status = result.editStatus.get(edit.id);
  return {
    applied: { text: '已合成', className: 'status applied' },
    'in-conflict': { text: '未决冲突', className: 'status pending' },
    'resolved-candidate': { text: '已参与解决', className: 'status applied' },
    'blocked-candidate': { text: '候选未采纳', className: 'status muted' },
    blocked: { text: '等待上游', className: 'status muted' }
  }[status] || { text: '未应用', className: 'status muted' };
}

function renderProvenance(segment) {
  const sources = segment.provenance?.map(source => {
    if (source.id === BASE_SOURCE.id || source.id === 'manual') return `<span class="source-tag ${source.id}">${escapeHtml(source.name)}</span>`;
    const edit = editById(source.id);
    const name = source.sourceName ? `${source.sourceName} · #${source.seq}` : source.name;
    return `<span class="source-tag" title="来源：${escapeHtml(edit?.source || source.sourceName || source.name)}｜顺序 ${edit?.seq ?? ''}">${escapeHtml(name)}</span>`;
  }).join('') || '<span class="source-tag base">原始内容</span>';
  return `<div class="provenance"><span>参与来源</span>${sources}</div>`;
}

function renderParticipants(segment) {
  if (!segment.conflictId || !segment.editIds?.length) return '';
  const names = segment.editIds.map(id => editById(id)).filter(Boolean)
    .map(edit => `<span class="source-tag">${escapeHtml(edit.source)} · #${escapeHtml(edit.seq)}</span>`)
    .join('');
  return `<div class="provenance participants"><span>冲突参与来源</span>${names}</div>`;
}

function renderConflictCard(conflict, slot) {
  const participants = slot.editIds.map(editById).filter(Boolean);
  const sameSeq = conflict.reasons.filter(reason => reason.kind === 'same-seq');
  const sharedSequences = [...new Set(sameSeq.map(reason => reason.seq))];
  const sameTarget = conflict.reasons.some(reason => reason.kind === 'same-target');
  const reasonParts = [];
  if (sharedSequences.length) reasonParts.push(`存在相同发生顺序 ${sharedSequences.join('、')}`);
  if (sameTarget) reasonParts.push('有多个修改指向同一片段');
  const reason = reasonParts.join('；') || '这些并行修改相互关联';
  const current = state.resolutions[conflictResolutionKey(conflict.id, slot.key)];
  const options = slot.options.map((option, index) => {
    const value = `${conflictResolutionKey(conflict.id, slot.key)}|${index}`;
    const checked = current && (
      option.type === current.type &&
      (option.type !== 'edit' || option.editId === current.editId)
    );
    const detail = option.type === 'edit'
      ? participants.find(edit => edit.id === option.editId)?.content
      : option.type === 'manual' ? current?.content || '' : '';
    return `
      <label class="choice ${checked ? 'selected' : ''}">
        <input type="radio" name="${escapeHtml(conflictResolutionKey(conflict.id, slot.key))}"
          data-conflict="${escapeHtml(conflict.id)}" data-slot="${escapeHtml(slot.key)}"
          data-option-index="${index}" value="${escapeHtml(value)}" ${checked ? 'checked' : ''}>
        <span class="choice-label">${escapeHtml(option.label)}</span>
        ${detail ? `<span class="candidate-content">${escapeHtml(detail)}</span>` : ''}
      </label>`;
  }).join('');
  return `
    <article class="conflict-card ${slot.resolved ? 'resolved' : 'open'}">
      <div class="conflict-heading">
        <span class="conflict-badge">${slot.resolved ? '已解决' : '未决冲突'}</span>
        <strong>${slot.kind === 'insert' ? '插入位置冲突' : '片段内容冲突'}</strong>
      </div>
      <p class="conflict-reason">${escapeHtml(reason)}，系统保留全部候选，不自动择一。</p>
      <div class="choices">${options}</div>
      <textarea class="manual-input hidden" data-conflict="${escapeHtml(conflict.id)}" data-slot="${escapeHtml(slot.key)}"
        rows="2" placeholder="输入手动改写后的内容">${escapeHtml(current?.type === 'manual' ? current.content : '')}</textarea>
    </article>`;
}

function renderSegments(result) {
  if (!result.segments.length) return '<div class="empty">还没有共享片段。</div>';
  return result.segments.map(segment => {
    const conflict = segment.unresolved
      ? result.conflicts.find(item => item.id === segment.conflictId)
      : null;
    const slot = conflict?.slots.find(item => item.key === segment.slotKey);
    const segmentCount = segment.unresolved ? '—' : segment.order;
    const badge = segment.unresolved
      ? '<span class="segment-badge pending">未决冲突占位</span>'
      : `<span class="segment-badge ${segment.status === 'base' ? 'base' : 'resolved'}">${
          { base: '原始', clean: '已合成', resolved: '冲突已解决' }[segment.status] || '已合成'
        }</span>`;
    const recomputed = recomputedKeys.has(segment.key)
      ? '<span class="segment-badge recomputed">撤回/改写后重新推导</span>' : '';
    return `
      <article class="segment-card ${segment.unresolved ? 'conflict' : ''} ${recomputed ? 'recomputed-card' : ''}">
        <div class="segment-meta">
          <span class="order">#${segmentCount}</span>${badge}${recomputed}
        </div>
        ${segment.unresolved
          ? renderConflictCard(conflict, slot)
          : `<p class="segment-content">${escapeHtml(segment.content || '（该片段已删除）')}</p>
             ${renderProvenance(segment)}${renderParticipants(segment)}
             ${segment.conflictId ? renderResolvedConflictControls(segment, result) : ''}`}
      </article>`;
  }).join('');
}

function renderResolvedConflictControls(segment, result) {
  const conflict = result.conflicts.find(item => item.id === segment.conflictId);
  const slot = conflict?.slots.find(item => item.key === segment.slotKey);
  if (!conflict || !slot) return '';
  const chosenLabel = slot.options.find(option =>
    option.type === slot.chosen.type && (option.type !== 'edit' || option.editId === slot.chosen.editId)
  )?.label || '手动改写';
  return `<details class="resolution-detail"><summary>当前选择：${escapeHtml(chosenLabel)}（点击改选）</summary>${renderConflictCard(conflict, slot)}</details>`;
}

function renderEdits(result) {
  const edits = [...state.edits].sort((a, b) => a.seq - b.seq ||
    a.source.localeCompare(b.source, 'zh-CN') || a.id.localeCompare(b.id));
  if (!edits.length) return '<div class="empty">还没有修改记录。</div>';
  return edits.map(edit => {
    const status = statusLabel(edit, result);
    const error = result.errors.find(item => item.editId === edit.id)?.message;
    const warning = result.warnings.find(item => item.editId === edit.id)?.message;
    return `
      <article class="edit-card ${edit.withdrawn ? 'withdrawn' : ''} ${error ? 'invalid' : ''}">
        <div class="edit-head">
          <strong>${escapeHtml(edit.source || '未命名来源')}</strong>
          ${status.text ? `<span class="${status.className}">${escapeHtml(status.text)}</span>` : ''}
        </div>
        <div class="edit-flow">#${escapeHtml(edit.seq)} · ${escapeHtml(opName(edit.opType))} · ${escapeHtml(targetName(edit.targetId))}</div>
        ${edit.opType !== 'delete' ? `<p class="edit-content">${escapeHtml(edit.content)}</p>` : ''}
        ${error ? `<p class="issue-message">${escapeHtml(error)}</p>` : ''}
        ${warning ? `<p class="warning-message">${escapeHtml(warning)}</p>` : ''}
        <div class="edit-actions">
          <button type="button" class="button tiny" data-action="edit" data-id="${escapeHtml(edit.id)}">改写记录</button>
          <button type="button" class="button tiny subtle" data-action="toggle-withdraw" data-id="${escapeHtml(edit.id)}">
            ${edit.withdrawn ? '恢复' : '撤回'}
          </button>
        </div>
      </article>`;
  }).join('');
}

function render() {
  const result = deriveDocument(state);
  elements.docTitle.textContent = state.title;
  elements.segmentList.innerHTML = renderSegments(result);
  elements.editList.innerHTML = renderEdits(result);
  elements.statSegments.textContent = result.stats.segmentCount;
  elements.statPending.textContent = result.stats.pendingCount;
  elements.statEdits.textContent = result.stats.activeEditCount;
  elements.statErrors.textContent = result.stats.errorCount;

  const currentTarget = elements.target.value;
  const targetOptions = [
    ...state.baseSegments.map(segment => [segment.id, targetName(segment.id)]),
    ...state.edits.filter(edit => !edit.withdrawn && edit.opType === 'insertAfter')
      .map(edit => [edit.id, targetName(edit.id)])
  ];
  elements.target.innerHTML = targetOptions.map(([id, label]) =>
    `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`).join('');
  if (targetOptions.some(([id]) => id === currentTarget)) elements.target.value = currentTarget;
  elements.contentLabel.firstChild.textContent = elements.opType.value === 'insertAfter'
    ? '要插入的内容' : '修改后的内容';
  return result;
}

function setFormMessage(message = '', isError = false) {
  elements.formMessage.textContent = message;
  elements.formMessage.classList.toggle('error', isError);
}

function resetForm() {
  elements.form.reset();
  elements.editId.value = '';
  elements.seq.value = 1;
  elements.formTitle.textContent = '提交修改';
  elements.cancelEdit.classList.add('hidden');
  setFormMessage('');
  render();
}

function updateManualVisibility() {
  document.querySelectorAll('.conflict-card').forEach(card => {
    const radios = [...card.querySelectorAll('input[type="radio"]')];
    const checked = card.querySelector('input[type="radio"]:checked');
    const manual = card.querySelector('.manual-input');
    const option = checked ? slotOption(card, Number(checked.dataset.optionIndex)) : null;
    manual?.classList.toggle('hidden', option?.type !== 'manual');
  });
}

function slotOption(card, optionIndex) {
  const result = deriveDocument(state);
  const conflict = result.conflicts.find(item => item.id === card.querySelector('[data-conflict]').dataset.conflict);
  const slot = conflict.slots.find(item => item.key === card.querySelector('[data-slot]').dataset.slot);
  return slot.options[optionIndex];
}

elements.form.addEventListener('submit', event => {
  event.preventDefault();
  const editingId = elements.editId.value || null;
  const input = {
    id: editingId || uid('edit'), source: elements.source.value, seq: elements.seq.value,
    opType: elements.opType.value, targetId: elements.target.value,
    content: elements.content.value, withdrawn: elements.editId.value
      ? Boolean(state.edits.find(edit => edit.id === elements.editId.value)?.withdrawn)
      : false
  };
  const checked = validateEdit(input, state, editingId);
  if (!checked.ok) {
    setFormMessage(checked.error, true);
    return;
  }
  const next = structuredClone(state);
  checked.edit.updatedAt = new Date().toISOString();
  if (editingId) {
    const index = next.edits.findIndex(edit => edit.id === editingId);
    checked.edit.withdrawn = next.edits[index]?.withdrawn || false;
    next.edits[index] = checked.edit;
  } else {
    next.edits.push(checked.edit);
  }
  commit(next, editingId ? '已改写记录，并重新推导受影响片段。' : '修改已提交并重新合成。');
  resetForm();
});

elements.opType.addEventListener('change', () => {
  elements.content.classList.toggle('hidden', elements.opType.value === 'delete');
  elements.contentLabel.classList.toggle('hidden', elements.opType.value === 'delete');
  elements.contentLabel.firstChild.textContent = elements.opType.value === 'insertAfter'
    ? '要插入的内容' : '修改后的内容';
});

elements.cancelEdit.addEventListener('click', resetForm);

elements.editList.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const edit = editById(button.dataset.id);
  if (!edit) return;
  if (button.dataset.action === 'edit') {
    elements.editId.value = edit.id;
    elements.source.value = edit.source;
    elements.seq.value = edit.seq;
    elements.opType.value = edit.opType;
    elements.target.value = edit.targetId;
    elements.content.value = edit.content;
    elements.formTitle.textContent = `改写记录：${edit.source}`;
    elements.cancelEdit.classList.remove('hidden');
    elements.content.classList.toggle('hidden', edit.opType === 'delete');
    elements.contentLabel.classList.toggle('hidden', edit.opType === 'delete');
    setFormMessage('保存后会重新推导该记录及其下游片段。');
  }
  if (button.dataset.action === 'toggle-withdraw') {
    const next = structuredClone(state);
    const target = next.edits.find(item => item.id === edit.id);
    target.withdrawn = !target.withdrawn;
    target.updatedAt = new Date().toISOString();
    commit(next, target.withdrawn ? '修改已撤回，最终内容已重新推导。' : '修改已恢复，最终内容已重新推导。');
  }
});

elements.segmentList.addEventListener('change', event => {
  const input = event.target;
  if (!input.matches('input[type="radio"][data-conflict]')) return;
  const card = input.closest('.conflict-card');
  card.querySelectorAll('.choice').forEach(choice => choice.classList.remove('selected'));
  input.closest('.choice').classList.add('selected');
  const result = deriveDocument(state);
  const conflict = result.conflicts.find(item => item.id === input.dataset.conflict);
  const slot = conflict.slots.find(item => item.key === input.dataset.slot);
  const option = slot.options[Number(input.dataset.optionIndex)];
  const textarea = card.querySelector('.manual-input');
  if (option.type === 'manual') {
    if (!textarea.value.trim()) {
      textarea.focus();
      updateManualVisibility();
      return;
    }
  }
  updateManualVisibility();
  const next = structuredClone(state);
  const key = conflictResolutionKey(conflict.id, slot.key);
  if (option.type === 'edit') next.resolutions[key] = { type: 'edit', editId: option.editId, content: option.content };
  if (option.type === 'base') next.resolutions[key] = { type: 'base' };
  if (option.type === 'omit') next.resolutions[key] = { type: 'omit' };
  if (option.type === 'manual') next.resolutions[key] = { type: 'manual', content: textarea.value.trim() };
  const beforeResolution = structuredClone(state);
  state = next;
  saveState();
  markRecomputed(beforeResolution, state);
  render();
  updateManualVisibility();
  showToast('冲突选择已立即写入最终内容。');
});

elements.segmentList.addEventListener('input', event => {
  const textarea = event.target;
  if (!textarea.matches('.manual-input')) return;
  const card = textarea.closest('.conflict-card');
  const result = deriveDocument(state);
  const conflict = result.conflicts.find(item => item.id === textarea.dataset.conflict);
  const slot = conflict.slots.find(item => item.key === textarea.dataset.slot);
  const manualIndex = slot.options.findIndex(option => option.type === 'manual');
  const manualRadio = card.querySelector(`input[data-option-index="${manualIndex}"]`);
  if (textarea.value.trim() && !manualRadio.checked) {
    manualRadio.checked = true;
    card.querySelectorAll('.choice').forEach(choice => choice.classList.remove('selected'));
    manualRadio.closest('.choice').classList.add('selected');
  }
});

elements.reset.addEventListener('click', () => {
  const next = seedState();
  commit(next, '已重置为内置离线示例。');
});

elements.exportBtn.addEventListener('click', () => {
  const payload = {
    exportedAt: new Date().toISOString(),
    state,
    derived: deriveDocument(state)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `coeditor-export-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});

render();
updateManualVisibility();

function commit(nextState, message) {
  previousState = structuredClone(state);
  state = nextState;
  saveState();
  markRecomputed(previousState, state);
  render();
  showToast(message);
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.add('hidden'), 2400);
}

function markRecomputed(beforeState, nextState) {
  const before = deriveDocument(beforeState);
  const after = deriveDocument(nextState);
  recomputedKeys = new Set();
  const beforeMap = new Map(before.segments.map(segment => [segment.key, segment]));
  for (const segment of after.segments) {
    const old = beforeMap.get(segment.key);
    if (!old || old.content !== segment.content || old.status !== segment.status || old.order !== segment.order) {
      recomputedKeys.add(segment.key);
    }
  }
  for (const segment of before.segments) {
    if (!after.segments.some(item => item.key === segment.key)) recomputedKeys.add(segment.key);
  }
}
