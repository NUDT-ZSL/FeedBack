/* 纯函数同步核心：浏览器与 Node 自动化测试共用。 */
(function (root) {
  'use strict';

  function createId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function noteKey(note) {
    return note ? `${note.id}:${note.version}:${note.updatedAt || ''}` : '';
  }

  function findActiveMutation(mutations, noteId) {
    return mutations.find(item => item.noteId === noteId &&
      !['success', 'resolved'].includes(item.status));
  }

  function makeMutation(type, note, baseVersion, baseSnapshot, overrides = {}) {
    return {
      id: createId(),
      seq: 0,
      type,
      noteId: note.id,
      title: note.title,
      content: note.content,
      localDeleted: note.localDeleted ?? Boolean(note.deleted),
      baseVersion,
      baseSnapshot: clone(baseSnapshot),
      status: 'queued',
      createdAt: new Date().toISOString(),
      attempts: 0,
      result: null,
      ...overrides
    };
  }

  function applyOne(noteMap, mutation) {
    if (mutation.type === 'create') {
      if (!mutation.localDeleted) {
        noteMap[mutation.noteId] = {
          id: mutation.noteId,
          title: mutation.title,
          content: mutation.content,
          deleted: false
        };
      }
    } else if (mutation.localDeleted) {
      delete noteMap[mutation.noteId];
    } else if (noteMap[mutation.noteId]) {
      noteMap[mutation.noteId] = {
        ...noteMap[mutation.noteId],
        title: mutation.title,
        content: mutation.content,
        deleted: false
      };
    }
  }

  function projectWorkingNotes(serverNotes, mutations) {
    const map = {};
    (serverNotes || []).forEach(note => {
      if (note && !note.deleted) map[note.id] = clone(note);
    });
    mutations
      .filter(item => !['success', 'resolved'].includes(item.status))
      .sort((a, b) => a.seq - b.seq)
      .forEach(item => applyOne(map, item));
    return Object.values(map).sort((a, b) =>
      new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0) ||
      a.title.localeCompare(b.title, 'zh-CN'));
  }

  function lineDiff(oldText = '', newText = '') {
    const left = String(oldText).split(/\r?\n/);
    const right = String(newText).split(/\r?\n/);
    const table = Array.from({ length: left.length + 1 }, () =>
      Array(right.length + 1).fill(0));

    for (let i = left.length - 1; i >= 0; i -= 1) {
      for (let j = right.length - 1; j >= 0; j -= 1) {
        table[i][j] = left[i] === right[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }

    const pairs = [];
    let i = 0;
    let j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        pairs.push({ type: 'equal', left: left[i], right: right[j] });
        i += 1;
        j += 1;
      } else if (j < right.length && (i === left.length || table[i][j + 1] >= table[i + 1][j])) {
        pairs.push({ type: 'add', left: '', right: right[j] });
        j += 1;
      } else {
        pairs.push({ type: 'del', left: left[i], right: '' });
        i += 1;
      }
    }
    return pairs;
  }

  const CONFLICT_REASONS = {
    updated_remotely_while_editing: '本地离线修改期间，服务端同一笔记也产生了新版本。两边都基于同一个旧版本修改，因此不能直接覆盖。',
    updated_remotely_while_local_delete: '本地离线删除期间，服务端同一笔记又被修改。直接删除会抹掉服务端新内容。',
    deleted_remotely_while_editing: '本地离线编辑期间，服务端已删除这条笔记；本地仍有未提交修改。',
    restored_remotely_after_local_delete: '本地离线删除期间，服务端同一笔记产生了新版本。删除旧版本会误伤新版本。',
    created_concurrently: '本地离线新建的笔记 ID 在服务端已被占用，属于并发创建冲突。',
    server_changed_again_before_resolution: '解决冲突期间服务端又出现了新版本，请基于最新版本重新确认。',
    unknown: '本地基础版本与服务端当前版本不一致。'
  };

  function describeConflict(reason, localSnapshot, serverNote, baseSnapshot) {
    const serverExists = Boolean(serverNote && !serverNote.deleted);
    const localExists = Boolean(localSnapshot && !localSnapshot.deleted);

    if (reason === 'deleted_remotely_while_editing') {
      return '服务端版本已被删除，但本地仍保留并修改了内容。需要决定是恢复本地内容，还是接受服务端删除。';
    }
    if (!serverExists && localExists) {
      return '服务端当前没有这条笔记，而本地保留了内容。';
    }
    if (!localExists && serverExists) {
      return '本地结果是删除，而服务端仍有更新后的内容。';
    }

    const changedFields = [];
    if (!baseSnapshot || (baseSnapshot.title || '') !== (serverNote && serverNote.title || '')) {
      changedFields.push('标题');
    }
    if (!baseSnapshot || (baseSnapshot.content || '') !== (serverNote && serverNote.content || '')) {
      changedFields.push('正文');
    }
    return `${CONFLICT_REASONS[reason] || CONFLICT_REASONS.unknown} 服务端变化涉及：${changedFields.join('、') || '版本元数据'}。`;
  }

  function localSnapshotForConflict(mutation, mutations) {
    let base = mutation.type === 'create' ? null : clone(mutation.baseSnapshot);
    const map = {};
    if (base) map[base.id] = base;
    mutations
      .filter(item => item.noteId === mutation.noteId &&
        item.seq >= 0 &&
        !['success', 'resolved'].includes(item.status))
      .sort((a, b) => a.seq - b.seq)
      .forEach(item => applyOne(map, item));
    return map[mutation.noteId] || {
      id: mutation.noteId,
      title: '',
      content: '',
      deleted: true,
      baseVersion: mutation.baseVersion
    };
  }

  function buildConflict(mutation, mutations, serverConflict) {
    const server = serverConflict.server || null;
    const local = localSnapshotForConflict(mutation, mutations);
    let reason = serverConflict.reason || 'unknown';
    if (reason === 'updated_remotely_while_editing' &&
        local.deleted &&
        server &&
        !server.deleted) {
      reason = 'updated_remotely_while_local_delete';
    }
    return {
      noteId: mutation.noteId,
      reason,
      explanation: describeConflict(serverConflict.reason, local, server, mutation.baseSnapshot),
      baseSnapshot: clone(mutation.type === 'create' ? null : mutation.baseSnapshot),
      local,
      server: server && !server.deleted
        ? clone(server)
        : { id: mutation.noteId, title: '', content: '', deleted: true, version: server ? server.version : 0 },
      detectedAt: new Date().toISOString()
    };
  }

  function markConflict(mutations, blocker, conflict) {
    const withSameNote = mutations.map(item => {
      if (item.noteId !== blocker.noteId || ['success', 'resolved'].includes(item.status)) {
        return item;
      }
      return {
        ...item,
        status: 'conflict',
        conflict,
        result: {
          at: new Date().toISOString(),
          message: '检测到冲突，已暂停提交，等待人工处理。'
        }
      };
    });

    return withSameNote.map(item => {
      if (item.seq <= blocker.seq ||
          ['success', 'resolved', 'conflict'].includes(item.status)) {
        return item;
      }
      return {
        ...item,
        status: 'blocked',
        result: { at: new Date().toISOString(), message: '前面的同一条笔记存在冲突，队列按顺序暂停。' }
      };
    });
  }

  function rebaseAfterSuccess(mutations, successfulId, serverNote) {
    const successful = mutations.find(item => item.id === successfulId);
    if (!successful) return mutations;

    return mutations.map(item => {
      if (item.noteId !== successful.noteId ||
          item.id === successfulId ||
          ['success', 'resolved'].includes(item.status)) {
        return item;
      }

      const next = {
        ...item,
        baseVersion: serverNote ? serverNote.version : item.baseVersion,
        baseSnapshot: serverNote ? clone(serverNote) : null,
        conflict: null
      };

      if (successful.type === 'create') next.type = item.localDeleted ? 'delete' : 'update';
      if (item.status === 'blocked' || item.status === 'failed') next.status = 'queued';
      next.result = null;
      return next;
    });
  }

  function resolutionRequest(choice, conflict, manualNote = {}) {
    if (choice === 'local') {
      return {
        choice,
        baseVersion: conflict.server.version,
        title: conflict.local.title,
        content: conflict.local.content,
        localDeleted: Boolean(conflict.local.deleted)
      };
    }
    if (choice === 'server') {
      return { choice, baseVersion: conflict.server.version };
    }
    return {
      choice: 'manual',
      baseVersion: conflict.server.version,
      title: String(manualNote.title || '未命名笔记'),
      content: String(manualNote.content || ''),
      deleted: Boolean(manualNote.deleted)
    };
  }

  const STATUS_TEXT = {
    queued: '等待中',
    sending: '提交中',
    conflict: '冲突待解决',
    blocked: '队列暂停',
    failed: '网络失败，待重试',
    resolving: '解决中',
    success: '已提交',
    resolved: '冲突已解决'
  };

  const TYPE_TEXT = {
    create: '新建',
    update: '修改',
    delete: '删除'
  };

  root.SyncCore = {
    createId,
    clone,
    noteKey,
    findActiveMutation,
    makeMutation,
    projectWorkingNotes,
    lineDiff,
    describeConflict,
    localSnapshotForConflict,
    buildConflict,
    markConflict,
    rebaseAfterSuccess,
    resolutionRequest,
    STATUS_TEXT,
    TYPE_TEXT,
    CONFLICT_REASONS
  };
})(typeof window !== 'undefined' ? window : globalThis);
