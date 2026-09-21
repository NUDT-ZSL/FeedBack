(() => {
  'use strict';

  const C = window.SyncCore;
  const STORE_KEY = 'offline-field-notes.v1';
  const $ = selector => document.querySelector(selector);

  const els = {
    dot: $('#networkDot'),
    networkState: $('#networkState'),
    lastSync: $('#lastSync'),
    toggleNetwork: $('#toggleNetwork'),
    slowSubmit: $('#slowSubmit'),
    title: $('#titleInput'),
    content: $('#contentInput'),
    editorTitle: $('#editorTitle'),
    save: $('#saveNote'),
    deleteNote: $('#deleteNote'),
    newNote: $('#newNote'),
    refresh: $('#refreshNotes'),
    noteList: $('#noteList'),
    queueList: $('#queueList'),
    conflictDock: $('#conflictDock'),
    clearFinished: $('#clearFinished'),
    toast: $('#toast')
  };

  const state = loadState();
  let selectedId = state.selectedId || null;
  let editorDirty = false;
  let syncing = false;
  let controller = null;

  function defaultState() {
    return {
      serverNotes: [],
      mutations: [],
      seq: 0,
      online: navigator.onLine,
      lastSyncAt: null,
      selectedId: null
    };
  }

  function loadState() {
    try {
      const loaded = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      const merged = { ...defaultState(), ...(loaded || {}) };
      merged.mutations = (merged.mutations || []).map(item => ({ ...item, conflict: item.conflict || null }));
      return merged;
    } catch {
      return defaultState();
    }
  }

  function persist() {
    state.selectedId = selectedId;
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  function activeNotes() {
    return C.projectWorkingNotes(state.serverNotes, state.mutations);
  }

  function activeMutation(noteId) {
    return C.findActiveMutation(state.mutations, noteId);
  }

  function latestConflict() {
    const resolvingConflict = state.mutations
      .filter(item => item.type === 'resolve' && item.status === 'conflict' && item.conflict)
      .sort((a, b) => b.seq - a.seq)[0];
    if (resolvingConflict) return resolvingConflict.conflict;

    const conflicted = state.mutations
      .filter(item => item.status === 'conflict' && item.conflict)
      .filter(item => item.type !== 'resolve')
      .sort((a, b) => b.seq - a.seq);
    return conflicted.length ? conflicted[0].conflict : null;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function formatTime(value) {
    return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '';
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { els.toast.hidden = true; }, 3200);
  }

  async function api(path, options = {}) {
    if (!state.online) {
      throw Object.assign(new Error('当前处于离线模式'), { offline: true });
    }

    if (els.slowSubmit.checked && options.method && options.method !== 'GET') {
      await new Promise(resolve => setTimeout(resolve, 2500));
      if (!state.online) throw Object.assign(new Error('提交过程中断网'), { offline: true });
    }

    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(path, {
        ...options,
        headers: { 'Content-Type': 'application/json' },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body.error || `HTTP_${response.status}`);
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return body;
    } catch (error) {
      if (error.name === 'AbortError' || error.message === 'Failed to fetch') {
        throw Object.assign(new Error('网络不可用或请求中断，改动保留在队列中。'), { offline: true, cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      controller = null;
    }
  }

  async function checkHealth() {
    if (!state.online) return false;
    try {
      await api('/api/health');
      return true;
    } catch {
      return false;
    }
  }

  async function setOnline(value) {
    state.online = value;
    persist();
    render();
    if (!value && controller) controller.abort();
    if (value) {
      const healthy = await checkHealth();
      if (healthy) {
        await refreshNotes(false);
        if (!await resumeFailedResolution()) syncQueue();
      } else {
        state.online = false;
        persist();
        render();
        showToast('服务仍不可达，已继续保持离线状态。');
      }
    }
  }

  async function refreshNotes(showMessage = true) {
    if (state.mutations.some(item => !['success', 'resolved'].includes(item.status))) {
      if (showMessage) showToast('存在未完成队列，已保留当前同步基线；请先提交或解决冲突。');
      return;
    }
    try {
      const data = await api('/api/notes');
      state.serverNotes = data.notes;
      state.lastSyncAt = new Date().toISOString();
      persist();
      render();
      if (showMessage) showToast('已从服务端刷新最新笔记。');
    } catch (error) {
      if (showMessage) showToast(error.offline ? '当前离线，不能刷新服务端。' : error.message);
    }
  }

  function saveEditor() {
    if (latestConflict() && latestConflict().noteId === selectedId) {
      showToast('这条笔记存在未解决冲突，请先在下方选择处理方式。');
      return;
    }
    const title = els.title.value.trim() || '未命名笔记';
    const content = els.content.value;
    const editing = selectedId
      ? state.serverNotes.find(note => note.id === selectedId) || activeNotes().find(note => note.id === selectedId)
      : null;

    if (selectedId && activeMutation(selectedId)) {
      showToast('这条笔记已有未完成改动，已将新的编辑追加到同一条队列。');
    }

    let mutation;
    if (!selectedId) {
      const id = C.createId();
      mutation = C.makeMutation('create', {
        id, title, content
      }, 0, null);
      selectedId = id;
    } else if (activeMutation(selectedId)?.type === 'create') {
      mutation = C.makeMutation('create', { id: selectedId, title, content }, 0, null);
    } else {
      const base = state.serverNotes.find(note => note.id === selectedId) || editing;
      const queued = activeMutation(selectedId);
      mutation = C.makeMutation(
        'update',
        { id: selectedId, title, content },
        queued?.baseVersion ?? base.version,
        queued?.baseSnapshot || base
      );
    }

    state.seq += 1;
    mutation.seq = state.seq;
    state.mutations.push(mutation);
    persist();
    editorDirty = false;
    render();
    showToast('已保存到本地，并加入待提交队列。');
    syncQueue();
  }

  function deleteSelected() {
    if (!selectedId) return;
    if (latestConflict() && latestConflict().noteId === selectedId) {
      showToast('请先在冲突面板中决定删除、保留或手动合并。');
      return;
    }
    const existing = state.serverNotes.find(note => note.id === selectedId);
    const active = activeMutation(selectedId);
    const note = { id: selectedId, deleted: true };
    const mutation = C.makeMutation(
      active?.type === 'create' ? 'create' : (existing || active ? 'delete' : 'create'),
      note,
      existing ? existing.version : (active?.baseVersion || 0),
      existing || active?.baseSnapshot || null,
      { localDeleted: true, title: existing?.title || active?.title || '', content: '' }
    );
    state.seq += 1;
    mutation.seq = state.seq;
    state.mutations.push(mutation);
    persist();
    selectedId = null;
    editorDirty = false;
    render();
    showToast('删除操作已进入本地队列；服务端删除会等待提交。');
    syncQueue();
  }

  function requestFor(mutation, opId) {
    const common = { opId };
    if (mutation.type === 'create') {
      return {
        path: '/api/notes',
        options: {
          method: 'POST',
          body: {
            ...common,
            id: mutation.noteId,
            title: mutation.title,
            content: mutation.content
          }
        }
      };
    }

    if (mutation.type === 'delete') {
      return {
        path: `/api/notes/${encodeURIComponent(mutation.noteId)}`,
        options: {
          method: 'DELETE',
          body: { ...common, baseVersion: mutation.baseVersion }
        }
      };
    }

    return {
      path: `/api/notes/${encodeURIComponent(mutation.noteId)}`,
      options: {
        method: 'PATCH',
        body: {
          ...common,
          baseVersion: mutation.baseVersion,
          title: mutation.title,
          content: mutation.content
        }
      }
    };
  }

  async function syncQueue() {
    if (syncing || !state.online || latestConflict()) return;
    syncing = true;
    render();

    try {
      while (state.online && !latestConflict()) {
        const mutation = state.mutations
          .filter(item => ['queued', 'failed'].includes(item.status))
          .filter(item => item.type !== 'resolve')
          .sort((a, b) => a.seq - b.seq)[0];
        if (!mutation) break;

        mutation.status = 'sending';
        mutation.attempts += 1;
        mutation.result = null;
        persist();
        render();

        const opId = mutation.opId || C.createId();
        mutation.opId = opId;

        if (mutation.type === 'create' && mutation.localDeleted) {
          mutation.status = 'success';
          mutation.result = {
            at: new Date().toISOString(),
            message: '笔记在离线新建后、首次提交前已删除，因此无需在服务端创建。'
          };
          state.lastSyncAt = new Date().toISOString();
          persist();
          render();
          continue;
        }

        if (mutation.type === 'delete' &&
            mutation.localDeleted &&
            !state.serverNotes.some(note => note.id === mutation.noteId)) {
          mutation.status = 'success';
          mutation.result = {
            at: new Date().toISOString(),
            message: '本地新建记录已在前序操作中取消，删除操作无需提交服务端。'
          };
          state.lastSyncAt = new Date().toISOString();
          persist();
          render();
          continue;
        }

        const request = requestFor(mutation, opId);

        try {
          const data = await api(request.path, request.options);
          mutation.status = 'success';
          mutation.result = {
            at: new Date().toISOString(),
            message: '服务端已接受。',
            note: data.note
          };
          if (data.note && state.serverNotes.some(note => note.id === data.note.id)) {
            state.serverNotes = state.serverNotes.map(note =>
              note.id === data.note.id ? data.note : note);
          } else if (data.note) {
            state.serverNotes.push(data.note);
          } else {
            state.serverNotes = state.serverNotes.filter(note => note.id !== mutation.noteId);
          }
          state.mutations = C.rebaseAfterSuccess(state.mutations, mutation.id, data.note);
          state.lastSyncAt = new Date().toISOString();
        } catch (error) {
          if (error.status === 409 && error.body?.conflict) {
            const conflict = C.buildConflict(mutation, state.mutations, error.body.conflict);
            state.mutations = C.markConflict(state.mutations, mutation, conflict);
            mutation.result = { at: new Date().toISOString(), message: conflict.explanation };
          } else {
            mutation.status = 'failed';
            mutation.result = {
              at: new Date().toISOString(),
              message: error.offline
                ? '网络中断：未确认的改动保留在队列，下次重连使用同一提交标识重试。'
                : error.message
            };
            if (error.offline) state.online = false;
          }
        }
        persist();
        render();
        if (mutation.status !== 'success') break;
      }
    } finally {
      syncing = false;
      persist();
      render();
    }
  }

  function resolveConflict(choice, manualNote) {
    const conflict = latestConflict();
    if (!conflict) return;
    if (syncing) {
      showToast('当前冲突解决请求仍在提交中，请等待结果或网络中断后重试。');
      return;
    }

    const payload = C.resolutionRequest(choice, conflict, manualNote);
    const mutation = C.makeMutation('resolve',
      {
        id: conflict.noteId,
        title: manualNote?.title ?? conflict.local.title,
        content: manualNote?.content ?? conflict.local.content,
        deleted: Boolean(manualNote?.deleted)
      },
      conflict.server.version,
      conflict.server,
      {
        status: 'resolving',
        resolutionChoice: choice,
        resolutionPayload: payload
      }
    );
    state.seq += 1;
    mutation.seq = state.seq;
    mutation.opId = C.createId();
    mutation.resolutionPayload = { ...mutation.resolutionPayload, opId: mutation.opId };
    state.mutations = state.mutations.map(item =>
      item.type === 'resolve' &&
      item.noteId === conflict.noteId &&
      ['failed', 'conflict', 'resolving'].includes(item.status)
        ? { ...item, status: 'resolved', result: { at: new Date().toISOString(), message: '用户已基于更新后的版本重新选择解决方式。' } }
        : item);
    state.mutations.push(mutation);
    persist();
    render();
    resolveQueue(mutation.id);
  }

  async function resolveQueue(resolveId) {
    if (syncing) return;
    syncing = true;
    render();

    const mutation = state.mutations.find(item => item.id === resolveId);
    if (!mutation || mutation.status === 'resolved') {
      syncing = false;
      render();
      return;
    }

    try {
      if (!state.online) throw Object.assign(new Error('离线'), { offline: true });
      mutation.attempts += 1;
      mutation.status = 'resolving';
      persist();
      render();

      const data = await api(`/api/notes/${encodeURIComponent(mutation.noteId)}/resolve`, {
        method: 'POST',
        body: mutation.resolutionPayload
      });

      state.mutations = state.mutations.map(item => {
        if (item.noteId !== mutation.noteId ||
            !['conflict', 'resolving', 'failed', 'blocked', 'superseded'].includes(item.status)) {
          return item;
        }
        return {
          ...item,
          status: 'resolved',
          result: {
            at: new Date().toISOString(),
            message: item.id === mutation.id ? '冲突解决结果已提交到服务端。' : '相关本地改动已标记为已解决。'
          }
        };
      });

      state.mutations = state.mutations.map(item =>
        item.status === 'blocked' && item.noteId !== mutation.noteId
          ? { ...item, status: 'queued', result: null }
          : item);

      if (data.note) {
        if (state.serverNotes.some(note => note.id === data.note.id)) {
          state.serverNotes = state.serverNotes.map(note =>
            note.id === data.note.id ? data.note : note);
        } else {
          state.serverNotes.push(data.note);
        }
      } else {
        state.serverNotes = state.serverNotes.filter(note => note.id !== mutation.noteId);
      }
      state.lastSyncAt = new Date().toISOString();
      showToast('冲突已解决，服务端已确认最终结果。');
    } catch (error) {
      if (error.status === 409 && error.body?.conflict) {
        const serverConflict = error.body.conflict;
        const server = serverConflict.server || {
          id: mutation.noteId,
          title: '',
          content: '',
          deleted: true,
          version: mutation.baseVersion
        };
        const local = mutation.resolutionChoice === 'server'
          ? server
          : {
              id: mutation.noteId,
              title: mutation.title,
              content: mutation.content,
              deleted: Boolean(mutation.resolutionPayload?.deleted ?? mutation.resolutionPayload?.localDeleted)
            };
        const conflict = {
          ...C.buildConflict(mutation, [], { ...serverConflict, server }),
          local,
          explanation: C.describeConflict(serverConflict.reason, local, server, server)
        };
        state.mutations = state.mutations.map(item =>
          item.id === mutation.id
            ? { ...item, status: 'conflict', conflict, result: { at: new Date().toISOString(), message: conflict.explanation } }
            : item);
      } else {
        mutation.status = 'failed';
        mutation.result = {
          at: new Date().toISOString(),
          message: error.offline
            ? '解决结果尚未提交，已留在队列；重连后可重试。'
            : error.message
        };
        if (error.offline) state.online = false;
      }
    } finally {
      syncing = false;
      persist();
      render();
    }
    syncQueue();
  }

  function retryFailedResolution(id) {
    const mutation = state.mutations.find(item => item.id === id);
    if (mutation?.type === 'resolve') resolveQueue(id);
  }

  async function resumeFailedResolution() {
    const pending = state.mutations
      .find(item => item.type === 'resolve' && ['failed', 'resolving'].includes(item.status));
    if (pending) {
      await resolveQueue(pending.id);
      return true;
    }
    return false;
  }

  function renderNotes() {
    const notes = activeNotes();
    if (!notes.length) {
      els.noteList.innerHTML = '<p class="hint">暂无笔记。断网时也可以先在左侧新建。</p>';
      return;
    }

    els.noteList.innerHTML = notes.map(note => {
      const mutation = activeMutation(note.id);
      const status = mutation
        ? `<span class="pill ${mutation.status}">${C.STATUS_TEXT[mutation.status] || mutation.status}</span>`
        : '<span class="pill success">已同步</span>';
      return `
        <button class="note-card ${note.id === selectedId ? 'active' : ''}" data-note="${esc(note.id)}">
          <h3>${esc(note.title)}</h3>
          <p>${esc(note.content)}</p>
          <div class="meta">
            ${status}
            <span class="pill">v${note.version || '本地'}</span>
            <span class="pill">${formatTime(note.updatedAt) || '未提交'}</span>
          </div>
        </button>`;
    }).join('');

    els.noteList.querySelectorAll('[data-note]').forEach(button => {
      button.addEventListener('click', () => selectNote(button.dataset.note));
    });
  }

  function renderQueue() {
    if (!state.mutations.length) {
      els.queueList.innerHTML = '<p class="hint">队列为空。离线产生的新建、修改、删除都会按产生顺序显示在这里。</p>';
      return;
    }

    els.queueList.innerHTML = state.mutations
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .map(item => {
        const action = item.type === 'resolve'
          ? `解决冲突：${{ local: '保留本地', server: '保留服务端', manual: '手动合并' }[item.resolutionChoice] || ''}`
          : C.TYPE_TEXT[item.type] || item.type;
        const retry = item.type === 'resolve' && item.status === 'failed'
          ? `<button class="secondary small" data-retry-resolve="${esc(item.id)}">重试解决</button>`
          : '';
        const simulate = item.status === 'sending' && item.type !== 'create'
          ? `<button class="secondary small" data-remote-version="${esc(item.noteId)}">模拟服务端新版本</button>`
          : '';
        return `
          <article class="queue-item ${['conflict', 'blocked'].includes(item.status) ? 'blocked' : ''} ${['success', 'resolved'].includes(item.status) ? 'done' : ''}">
            <span class="seq">#${item.seq}</span>
            <div>
              <h3>${esc(action)}：${esc(item.title || item.noteId)}</h3>
              <p>提交标识：${esc(item.opId || '尚未获得标识')}</p>
              <p>基础版本：v${item.baseVersion ?? 0} · 尝试 ${item.attempts} 次</p>
            </div>
            <div>
              <span class="pill ${item.status}">${C.STATUS_TEXT[item.status] || item.status}</span>
              <p>${esc(item.result?.message || '等待提交。')}</p>
              <p>${item.result?.at ? `结果时间：${formatTime(item.result.at)}` : ''}</p>
            </div>
            <div class="meta">${simulate}${retry}</div>
          </article>`;
      }).join('');

    els.queueList.querySelectorAll('[data-remote-version]').forEach(button => {
      button.addEventListener('click', () => simulateRemote(button.dataset.remoteVersion));
    });
    els.queueList.querySelectorAll('[data-retry-resolve]').forEach(button => {
      button.addEventListener('click', () => retryFailedResolution(button.dataset.retryResolve));
    });
  }

  function diffPane(title, note, base, sideClass) {
    const deleted = note.deleted;
    const titleDiff = C.lineDiff(base?.title || '', deleted ? '' : note.title);
    const contentDiff = C.lineDiff(base?.content || '', deleted ? '' : note.content);
    const lines = pairs => pairs.map(pair => {
      const value = sideClass === 'local'
        ? (pair.type === 'add' ? pair.right : pair.left)
        : (pair.type === 'add' ? pair.right : pair.left);
      if (!value && pair.type === 'equal') return '<div class="diff-line empty">（空行）</div>';
      return `<div class="diff-line ${pair.type}">${esc(value)}</div>`;
    }).join('');

    return `
      <article class="diff-pane">
        <h3>${title} · ${deleted ? '此版本为删除' : `v${note.version}`}</h3>
        <div class="diff-body">
          <div class="field-diff">
            <strong>标题差异（相对共同旧版本）</strong>
            ${lines(titleDiff)}
          </div>
          <div class="field-diff">
            <strong>正文差异（相对共同旧版本）</strong>
            ${lines(contentDiff)}
          </div>
        </div>
      </article>`;
  }

  function renderConflict() {
    const conflict = latestConflict();
    els.conflictDock.hidden = !conflict;
    if (!conflict) return;

    els.conflictDock.innerHTML = `
      <h2>检测到冲突：系统未覆盖任何一方</h2>
      <div class="conflict-reason">
        <strong>原因：</strong>${esc(conflict.explanation)}
        <p><strong>涉及内容：</strong>笔记 ID ${esc(conflict.noteId)}；共同基础版本 v${conflict.baseSnapshot?.version ?? 0}，
        本地结果基于该旧版本修改，服务端当前为 v${conflict.server.version}。</p>
      </div>
      <div class="diff-grid">
        ${diffPane('本地版本', conflict.local, conflict.baseSnapshot, 'local')}
        ${diffPane('服务端版本', conflict.server, conflict.baseSnapshot, 'server')}
      </div>
      <div class="resolution">
        <button data-choice="local">保留本地并提交</button>
        <button class="secondary" data-choice="server">保留服务端</button>
        <button class="secondary" data-choice="manual">使用下方手动合并结果</button>
        <span class="hint">“保留服务端”只确认服务端结果，并将本地相关队列全部标记为已解决。</span>
      </div>
      <div class="merge-editor">
        <label>合并标题 <input id="manualTitle" value="${esc(conflict.local.deleted ? conflict.server.title : conflict.local.title)}"></label>
        <label>合并正文 <textarea id="manualContent" rows="6">${esc(conflict.local.deleted ? conflict.server.content : conflict.local.content)}</textarea></label>
        <label class="inline"><input id="manualDeleted" type="checkbox"> 合并结果为删除</label>
      </div>`;

    els.conflictDock.querySelectorAll('[data-choice]').forEach(button => {
      button.addEventListener('click', () => {
        const choice = button.dataset.choice;
        if (choice === 'local') return resolveConflict('local');
        if (choice === 'server') return resolveConflict('server');
        resolveConflict('manual', {
          title: $('#manualTitle').value.trim() || '未命名笔记',
          content: $('#manualContent').value,
          deleted: $('#manualDeleted').checked
        });
      });
    });
  }

  async function simulateRemote(noteId) {
    const note = state.serverNotes.find(item => item.id === noteId);
    if (!note) {
      showToast('只有已存在于服务端的笔记才能模拟另一端修改。');
      return;
    }
    try {
      const data = await api('/api/notes/simulate-remote-change', {
        method: 'POST',
        body: {
          id: noteId,
          content: `${note.content}\n\n[另一端修改] ${new Date().toLocaleString('zh-CN')}：服务端有了新版本`
        }
      });
      state.serverNotes = state.serverNotes.map(item =>
        item.id === noteId ? data.note : item);
      state.lastSyncAt = new Date().toISOString();
      persist();
      render();
      showToast('已模拟另一台设备修改服务端；现在可重放本地队列触发冲突。');
    } catch (error) {
      showToast(error.message);
    }
  }

  function selectNote(id) {
    selectedId = id;
    editorDirty = false;
    render();
  }

  function startNewNote() {
    selectedId = null;
    els.editorTitle.textContent = '新建现场笔记';
    els.title.value = '';
    els.content.value = '';
    els.deleteNote.hidden = true;
    editorDirty = false;
    render();
  }

  function clearFinished() {
    state.mutations = state.mutations.filter(item =>
      !['success', 'resolved'].includes(item.status));
    persist();
    render();
  }

  function render() {
    const notes = activeNotes();
    const selected = selectedId ? notes.find(note => note.id === selectedId) : null;

    els.dot.className = `dot ${state.online ? 'online' : 'offline'}`;
    els.networkState.textContent = state.online
      ? (syncing ? '在线，正在提交' : '在线')
      : '离线（本地可用）';
    els.lastSync.textContent = state.lastSyncAt
      ? `上次服务端确认：${formatTime(state.lastSyncAt)}`
      : '尚未同步';
    els.toggleNetwork.textContent = state.online ? '切到离线' : '切回在线';

    if (!editorDirty) {
      if (selected) {
        els.editorTitle.textContent = `编辑：${selected.title}`;
        els.title.value = selected.title;
        els.content.value = selected.content;
        els.deleteNote.hidden = false;
      } else if (!selectedId) {
        els.deleteNote.hidden = true;
      }
    }

    renderNotes();
    renderQueue();
    renderConflict();
    persist();
  }

  els.save.addEventListener('click', saveEditor);
  els.deleteNote.addEventListener('click', deleteSelected);
  els.newNote.addEventListener('click', startNewNote);
  els.refresh.addEventListener('click', () => refreshNotes(true));
  els.clearFinished.addEventListener('click', clearFinished);
  els.toggleNetwork.addEventListener('click', () => setOnline(!state.online));
  [els.title, els.content].forEach(input => {
    input.addEventListener('input', () => { editorDirty = true; });
  });

  window.addEventListener('online', () => {
    if (!state.online) setOnline(true);
  });
  window.addEventListener('offline', () => setOnline(false));

  async function boot() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    render();
    if (state.online) {
      const healthy = await checkHealth();
      if (healthy) {
        state.online = true;
        await refreshNotes(false);
        if (!await resumeFailedResolution()) syncQueue();
      } else {
        state.online = false;
        persist();
        render();
      }
    }
  }

  boot();
})();
