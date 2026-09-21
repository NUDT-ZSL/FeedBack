(() => {
  'use strict';

  const D = window.SemanticTree;
  const STORAGE_KEY = 'semantic-tree-workbench-v1';

  const sampleElements = [
    { id: 'app-window', role: 'dialog', name: '账户设置', parentId: null, order: 1 },
    { id: 'title-bar', role: 'banner', name: '标题栏', parentId: 'app-window', order: 1 },
    { id: 'close-btn', role: 'button', name: '关闭', parentId: 'title-bar', order: 1 },
    { id: 'settings-tabs', role: 'tablist', name: '设置分类', parentId: 'app-window', order: 2 },
    { id: 'profile-tab', role: 'tab', name: '个人资料', parentId: 'settings-tabs', order: 1 },
    { id: 'security-tab', role: 'tab', name: '安全', parentId: 'settings-tabs', order: 2 },
    { id: 'profile-panel', role: 'tabpanel', name: '个人资料面板', parentId: 'app-window', order: 3 },
    { id: 'name-field', role: 'textbox', name: '姓名', parentId: 'profile-panel', order: 1 },
    { id: 'save-btn', role: 'button', name: '保存更改', parentId: 'profile-panel', order: 2 },
    { id: 'decorative-line', role: 'presentation', name: '装饰分隔线', parentId: 'profile-panel', order: 3 },
    { id: 'legacy-help', role: 'generic', name: '旧版帮助入口', parentId: 'profile-panel', order: 4, hidden: true }
  ];

  const $ = (selector) => document.querySelector(selector);
  const els = {
    sampleBtn: $('#sampleBtn'), clearBtn: $('#clearBtn'),
    singleTab: $('#singleTab'), bulkTab: $('#bulkTab'),
    singleForm: $('#singleForm'), bulkForm: $('#bulkForm'), bulkJson: $('#bulkJson'),
    formatJsonBtn: $('#formatJsonBtn'),
    elementId: $('#elementId'), elementRole: $('#elementRole'), elementName: $('#elementName'),
    elementParent: $('#elementParent'), elementOrder: $('#elementOrder'), elementHidden: $('#elementHidden'),
    parentOptions: $('#parentOptions'),
    treeMeta: $('#treeMeta'), conflictBox: $('#conflictBox'), treeView: $('#treeView'),
    planStats: $('#planStats'), readingSequence: $('#readingSequence'), skippedList: $('#skippedList'),
    historyList: $('#historyList'),
    editDialog: $('#editDialog'), editForm: $('#editForm'), editIdLine: $('#editIdLine'),
    editRole: $('#editRole'), editName: $('#editName'), editParent: $('#editParent'),
    editOrder: $('#editOrder'), editHidden: $('#editHidden'),
    parentEditOptions: $('#parentEditOptions'), cancelEditBtn: $('#cancelEditBtn')
  };

  let state = {
    history: [],
    currentIndex: 0,
    lastConflict: null,
    editingId: null
  };

  function blankSnapshot(id = makeSnapshotId('empty')) {
    return D.createSnapshot([], {
      id, label: '空白方案', createdAt: new Date().toISOString(), basis: '尚未录入元素'
    }).snapshot;
  }

  function makeSnapshotId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function currentSnapshot() {
    return state.history[state.currentIndex];
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1, history: state.history, currentIndex: state.currentIndex
      }));
    } catch (_) { /* 本地存储不可用时仍可在当前页面会话中使用。 */ }
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && saved.version === 1 && Array.isArray(saved.history) && saved.history.length) {
        const verified = D.createSnapshot(saved.history[saved.currentIndex].elements, {});
        if (verified.ok) {
          state.history = saved.history;
          state.currentIndex = Math.min(saved.currentIndex, state.history.length - 1);
          return;
        }
      }
    } catch (_) { /* 忽略损坏的本地缓存。 */ }
    state.history = [blankSnapshot()];
    state.currentIndex = 0;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function roleText(role) {
    return `${D.ROLE_LABELS[role] || role}（${role}）`;
  }

  function formatTime(iso) {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  }

  function populateRoles() {
    const options = D.ROLES.map((role) =>
      `<option value="${role}">${escapeHtml(roleText(role))}</option>`).join('');
    els.elementRole.innerHTML = options;
    els.editRole.innerHTML = options;
    els.elementRole.value = 'button';
  }

  function populateParentLists() {
    const ids = currentSnapshot().elements.map((element) =>
      `<option value="${escapeHtml(element.id)}">${escapeHtml(element.name)}</option>`).join('');
    els.parentOptions.innerHTML = ids;
    els.parentEditOptions.innerHTML = ids;
  }

  function applyCandidate(result, label, basis) {
    if (!result.ok) {
      state.lastConflict = { label, basis, errors: result.errors };
      render();
      return false;
    }
    const parentIndex = state.currentIndex;
    const parent = state.history[parentIndex];
    const snapshot = result.snapshot;
    snapshot.id = makeSnapshotId('snapshot');
    snapshot.label = label;
    snapshot.createdAt = new Date().toISOString();
    snapshot.basis = `基于“${parent.label}” · ${basis}`;
    state.history = state.history.concat(snapshot);
    state.currentIndex = state.history.length - 1;
    state.lastConflict = null;
    persist();
    render();
    return true;
  }

  function renderConflict() {
    if (!state.lastConflict) {
      els.conflictBox.hidden = true;
      els.conflictBox.innerHTML = '';
      return;
    }
    const { label, basis, errors } = state.lastConflict;
    els.conflictBox.hidden = false;
    els.conflictBox.innerHTML = `
      <strong>已阻止：${escapeHtml(label)}</strong>
      <div>${escapeHtml(basis)}。当前历史方案没有被修改。</div>
      <ul>${errors.map((error) => {
        const target = error.elementId ? `元素：${escapeHtml(error.elementId)}` : '数据';
        const relation = error.relation ? `；关系/字段：${escapeHtml(error.relation)}` : '';
        return `<li><strong>${escapeHtml(target)}${relation}</strong><br>${escapeHtml(error.message)}</li>`;
      }).join('')}</ul>`;
  }

  function renderTree() {
    const snapshot = currentSnapshot();
    const children = D.buildChildren(snapshot.elements);
    const plan = D.getReadingPlan(snapshot.elements);
    const skippedIds = new Set(plan.skipped.map((item) => item.id));
    els.treeMeta.textContent = `${snapshot.label} · ${snapshot.elements.length} 个元素`;

    if (!snapshot.elements.length) {
      els.treeView.innerHTML = '<div class="empty-state"><div>当前还没有元素。<br>请从左侧单个录入，粘贴 JSON，或载入示例。</div></div>';
      return;
    }

    const renderNode = (node) => {
      const descendants = children.get(node.id) || [];
      const skipped = skippedIds.has(node.id);
      const tags = `${node.hidden ? '<span class="hidden-tag">隐藏</span>' : ''}${skipped ? '<span class="skip-tag">跳过</span>' : ''}`;
      return `
        <li class="tree-node" role="none">
          <div class="node-card ${skipped ? 'skipped' : ''}">
            <span class="role-badge">${escapeHtml(node.role)}</span>
            <span>
              <span class="node-name">${escapeHtml(node.name)}${tags}</span>
              <span class="node-detail">ID：${escapeHtml(node.id)} · 父级：${escapeHtml(node.parentId || '界面根')} · 顺序：${node.order}</span>
            </span>
            <span class="node-actions">
              <button type="button" data-action="up" data-id="${escapeHtml(node.id)}" aria-label="将 ${escapeHtml(node.name)} 上移">↑</button>
              <button type="button" data-action="down" data-id="${escapeHtml(node.id)}" aria-label="将 ${escapeHtml(node.name)} 下移">↓</button>
              <button type="button" data-action="edit" data-id="${escapeHtml(node.id)}" class="secondary">调整</button>
            </span>
          </div>
          ${descendants.length ? `<ul class="node-children">${descendants.map(renderNode).join('')}</ul>` : ''}
        </li>`;
    };
    els.treeView.innerHTML = `<ul class="tree-list">${(children.get('__ROOT__') || []).map(renderNode).join('')}</ul>`;
  }

  function renderPlan() {
    const snapshot = currentSnapshot();
    const plan = D.getReadingPlan(snapshot.elements);
    els.planStats.innerHTML = `
      <div class="stat"><strong>${snapshot.elements.length}</strong><span>元素总数</span></div>
      <div class="stat"><strong>${plan.sequence.length}</strong><span>将朗读</span></div>
      <div class="stat"><strong>${plan.skipped.length}</strong><span>将跳过</span></div>`;
    els.readingSequence.innerHTML = plan.sequence.map((item) => `
      <li class="reading-item">
        <span class="reading-number">${item.number}</span>
        <span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(roleText(item.role))} · 深度 ${item.depth + 1} · ID ${escapeHtml(item.id)}</small></span>
      </li>`).join('') || '<li class="empty-state">没有会被朗读的元素。</li>';
    els.skippedList.innerHTML = plan.skipped.map((item) => `
      <li><strong>${escapeHtml(item.name)}</strong>（${escapeHtml(item.id)}）<br>${escapeHtml(item.reason)}</li>`
    ).join('') || '<li class="muted">没有被跳过的元素。</li>';
  }

  function renderHistory() {
    els.historyList.innerHTML = state.history.map((snapshot, index) => `
      <li class="history-card ${index === state.currentIndex ? 'active' : ''}">
        <h3>${escapeHtml(snapshot.label)}</h3>
        <p>${formatTime(snapshot.createdAt)}<br>${snapshot.elements.length} 个元素</p>
        <span class="history-basis">${escapeHtml(snapshot.basis || '初始方案')}</span>
        <button type="button" data-history="${index}" ${index === state.currentIndex ? 'disabled' : ''}>
          ${index === state.currentIndex ? '正在查看' : '切换查看'}
        </button>
      </li>`).join('');
  }

  function render() {
    populateParentLists();
    renderConflict();
    renderTree();
    renderPlan();
    renderHistory();
  }

  function setConflict(label, basis, errors) {
    state.lastConflict = { label, basis, errors };
    render();
  }

  function switchTab(which) {
    const single = which === 'single';
    els.singleTab.setAttribute('aria-selected', String(single));
    els.bulkTab.setAttribute('aria-selected', String(!single));
    els.singleTab.tabIndex = single ? 0 : -1;
    els.bulkTab.tabIndex = single ? -1 : 0;
    els.singleForm.hidden = !single;
    els.bulkForm.hidden = single;
  }

  function openEditor(id) {
    const node = currentSnapshot().elements.find((item) => item.id === id);
    if (!node) return;
    state.editingId = id;
    els.editIdLine.textContent = `正在调整 ID：${id}`;
    els.editRole.value = node.role;
    els.editName.value = node.name;
    els.editParent.value = node.parentId || '';
    els.editOrder.value = String(node.order);
    els.editHidden.checked = node.hidden;
    if (typeof els.editDialog.showModal === 'function') els.editDialog.showModal();
    else els.editDialog.setAttribute('open', '');
    els.editName.focus();
  }

  function closeEditor() {
    if (els.editDialog.open) els.editDialog.close();
    state.editingId = null;
  }

  els.singleTab.addEventListener('click', () => switchTab('single'));
  els.bulkTab.addEventListener('click', () => switchTab('bulk'));

  els.singleForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const patch = {
      id: els.elementId.value.trim(),
      role: els.elementRole.value,
      name: els.elementName.value.trim(),
      parentId: els.elementParent.value.trim() || null,
      order: Number(els.elementOrder.value),
      hidden: els.elementHidden.checked
    };
    const result = D.addElement(currentSnapshot(), patch);
    if (applyCandidate(result, `添加 ${patch.id}`, `添加元素“${patch.name}”`)) {
      els.singleForm.reset();
      els.elementRole.value = 'button';
      els.elementOrder.value = '1';
    }
  });

  els.bulkForm.addEventListener('submit', (event) => {
    event.preventDefault();
    let parsed;
    try {
      parsed = JSON.parse(els.bulkJson.value);
    } catch (error) {
      setConflict('JSON 构建初始树', '批量录入',
        [{ code: 'invalid-json', elementId: '', relation: 'JSON', message: `JSON 无法解析：${error.message}` }]);
      return;
    }
    const result = D.createSnapshot(parsed, {});
    applyCandidate(result, '初始导入', '批量 JSON 构建初始语义树');
  });

  els.formatJsonBtn.addEventListener('click', () => {
    try {
      els.bulkJson.value = JSON.stringify(JSON.parse(els.bulkJson.value), null, 2);
      state.lastConflict = null;
      render();
    } catch (error) {
      setConflict('格式化 JSON', '批量录入',
        [{ code: 'invalid-json', elementId: '', relation: 'JSON', message: `JSON 无法解析：${error.message}` }]);
    }
  });

  els.treeView.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'edit') openEditor(id);
    if (action === 'up' || action === 'down') {
      const node = currentSnapshot().elements.find((item) => item.id === id);
      const result = D.moveElement(currentSnapshot(), id, action);
      if (result.snapshot) {
        applyCandidate(result, `${action === 'up' ? '上移' : '下移'} ${id}`,
          `调整元素“${node.name}”的同级顺序`);
      }
    }
  });

  els.editForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!state.editingId) return;
    const old = currentSnapshot().elements.find((item) => item.id === state.editingId);
    const patch = {
      id: state.editingId,
      role: els.editRole.value,
      name: els.editName.value.trim(),
      parentId: els.editParent.value.trim() || null,
      order: Number(els.editOrder.value),
      hidden: els.editHidden.checked
    };
    const result = D.changeElement(currentSnapshot(), patch);
    if (applyCandidate(result, `调整 ${patch.id}`,
      `修改元素“${old.name}”的角色、归属、顺序或隐藏状态`)) closeEditor();
  });
  els.cancelEditBtn.addEventListener('click', closeEditor);

  els.historyList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-history]');
    if (!button) return;
    state.currentIndex = Number(button.dataset.history);
    state.lastConflict = null;
    persist();
    render();
  });

  els.sampleBtn.addEventListener('click', () => {
    const result = D.createSnapshot(sampleElements, {});
    applyCandidate(result, '示例：账户设置', '载入内置示例元素');
    els.bulkJson.value = JSON.stringify(sampleElements, null, 2);
  });

  els.clearBtn.addEventListener('click', () => {
    if (!window.confirm('确定清空当前项目吗？系统会把“空白方案”保存为一个历史节点，已有历史仍可切换查看。')) return;
    const empty = blankSnapshot(makeSnapshotId('empty'));
    state.history = state.history.concat(empty);
    state.currentIndex = state.history.length - 1;
    state.lastConflict = null;
    els.bulkJson.value = '';
    persist();
    render();
  });

  restore();
  populateRoles();
  els.elementRole.value = 'button';
  els.bulkJson.value = JSON.stringify(sampleElements, null, 2);
  render();
})();
