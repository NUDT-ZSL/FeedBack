const DEFAULT_NODE_HEIGHT = 34;
const DEFAULT_FILE_HEIGHT = 30;
const ROOT_ID = null;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function makeError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function rejection(code, message, extra = {}) {
  return {
    ok: false,
    errors: [Object.assign({ code, message }, extra)]
  };
}

function okResult(data = {}) {
  return { ok: true, errors: [], ...data };
}

function normalizeTime(value, field = 'revisedAt') {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw makeError('INVALID_REVISED_AT', field + ' must be a finite timestamp');
    }
    return new Date(value).toISOString();
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw makeError('INVALID_REVISED_AT', field + ' must be a non-empty ISO time string');
  }
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) {
    throw makeError('INVALID_REVISED_AT', field + ' is not a valid time: ' + value);
  }
  return parsed.toISOString();
}

function timeLabel(value) {
  return value === null || value === undefined ? '(none)' : value;
}

class DirectoryStore {
  constructor(options = {}) {
    this.now = options.now || (() => new Date().toISOString());
    this.reset();
  }

  reset() {
    this.nodes = new Map();
    this.children = new Map();
    this.children.set(ROOT_ID, []);
    this.files = new Map();
    this.filesByNode = new Map();
    this.fileSequence = new Set();
    this.stateValues = new Map();
    this.sourcePriority = new Map([['local-ui', 100], ['batch-import', 10]]);
    this.activeConflicts = [];
    this.conflictLog = [];
    this.log = [];
    return this.snapshotSummary('reset');
  }

  snapshotSummary(action) {
    return {
      action,
      nodeCount: this.nodes.size,
      fileCount: this.files.size,
      conflictCount: this.activeConflicts.length
    };
  }

  getNode(id) {
    return this.nodes.get(id);
  }

  getFiles(nodeId) {
    return (this.filesByNode.get(nodeId) || []).map((id) => this.files.get(id));
  }

  getFile(seq) {
    return this.files.get(seq);
  }

  childrenOf(parentId) {
    return (this.children.get(parentId) || []).slice();
  }

  pathOf(nodeId) {
    if (nodeId === ROOT_ID) return [];
    if (!this.nodes.has(nodeId)) {
      throw makeError('UNKNOWN_NODE', 'Node is not registered: ' + nodeId, { nodeId });
    }
    const path = [];
    let current = nodeId;
    while (current !== ROOT_ID) {
      const node = this.nodes.get(current);
      path.unshift({ id: node.id, label: node.label });
      current = node.parentId;
    }
    return path;
  }

  locate(nodeId) {
    const path = this.pathOf(nodeId);
    return path.length
      ? '/' + path.map((item) => item.label || item.id).join('/')
      : '/';
  }

  isAncestor(maybeAncestorId, nodeId) {
    let current = nodeId;
    while (current !== ROOT_ID) {
      if (current === maybeAncestorId) return true;
      const node = this.nodes.get(current);
      if (!node) return false;
      current = node.parentId;
    }
    return maybeAncestorId === ROOT_ID;
  }

  addNodes(input) {
    const list = Array.isArray(input) ? input : input && input.nodes;
    if (!Array.isArray(list)) {
      return rejection('INVALID_NODES_PAYLOAD', 'Expected an array of nodes or { nodes: [...] }.');
    }

    const errors = [];
    const pendingIds = new Set();
    list.forEach((node, index) => {
      const location = 'nodes[' + index + ']';
      if (!isPlainObject(node)) {
        errors.push({ code: 'INVALID_NODE', message: location + ' must be an object.', location });
        return;
      }
      if (!node.id || typeof node.id !== 'string') {
        errors.push({ code: 'INVALID_NODE_ID', message: location + '.id must be a non-empty string.', location, index });
      } else if (this.nodes.has(node.id)) {
        errors.push({
          code: 'DUPLICATE_NODE_ID',
          message: 'Node id is already registered: ' + node.id + ' at ' + location + '.',
          location,
          nodeId: node.id
        });
      } else if (pendingIds.has(node.id)) {
        errors.push({
          code: 'DUPLICATE_NODE_ID_IN_BATCH',
          message: 'Node id occurs more than once in this batch: ' + node.id + ' at ' + location + '.',
          location,
          nodeId: node.id
        });
      } else {
        pendingIds.add(node.id);
      }

      const parentId = node.parentId === undefined ? ROOT_ID : node.parentId;
      if (parentId !== ROOT_ID && typeof parentId !== 'string') {
        errors.push({ code: 'INVALID_PARENT_ID', message: location + '.parentId must be null or a string.', location, nodeId: node.id });
      } else if (parentId !== ROOT_ID && !this.nodes.has(parentId)) {
        errors.push({
          code: 'UNKNOWN_PARENT',
          message: 'Node ' + node.id + ' at ' + location + ' references an unregistered parent: ' + parentId + '.',
          location,
          nodeId: node.id,
          parentId
        });
      }

      if (node.order !== undefined && (!Number.isSafeInteger(node.order) || node.order < 0)) {
        errors.push({ code: 'INVALID_ORDER', message: location + '.order must be a non-negative safe integer.', location, nodeId: node.id });
      }
      if (node.expanded !== undefined && typeof node.expanded !== 'boolean') {
        errors.push({ code: 'INVALID_EXPANDED', message: location + '.expanded must be true or false.', location, nodeId: node.id });
      }
      if (node.height !== undefined && (!Number.isFinite(node.height) || node.height <= 0)) {
        errors.push({ code: 'INVALID_HEIGHT', message: location + '.height must be a positive number.', location, nodeId: node.id });
      }
    });

    const groups = new Map();
    list.forEach((node, index) => {
      if (!isPlainObject(node) || !node.id || typeof node.id !== 'string') return;
      const parentId = node.parentId === undefined ? ROOT_ID : node.parentId;
      const key = String(parentId);
      if (!groups.has(key)) groups.set(key, { parentId, seen: new Set(), rows: [] });
      const group = groups.get(key);
      if (group.seen.has(node.id)) return;
      if (node.order !== undefined) {
        const order = node.order;
        const existing = group.rows.find((row) => row.order === order);
        if (existing) {
          errors.push({
            code: 'DUPLICATE_SIBLING_ORDER',
            message: 'Nodes ' + existing.nodeId + ' and ' + node.id + ' both claim sibling order ' + order + ' under parent ' + String(parentId) + '.',
            location: 'nodes[' + index + '].order',
            parentId,
            order
          });
        } else {
          group.rows.push({ order, nodeId: node.id });
        }
      }
    });

    if (errors.length) return { ok: false, errors };

    const maxOrderByParent = new Map();
    const getMax = (parentId) => {
      if (!maxOrderByParent.has(parentId)) {
        const childrenNow = this.children.get(parentId) || [];
        maxOrderByParent.set(parentId, childrenNow.reduce((max, id) => {
          const order = this.nodes.get(id)?.order ?? 0;
          return Math.max(max, order);
        }, -1));
      }
      return maxOrderByParent.get(parentId);
    };

    const inserted = [];
    for (const node of list) {
      const parentId = node.parentId === undefined ? ROOT_ID : node.parentId;
      let order = node.order;
      if (order === undefined) {
        order = getMax(parentId) + 1;
        maxOrderByParent.set(parentId, order);
      }
      const record = {
        id: node.id,
        label: node.label === undefined ? node.id : String(node.label),
        parentId,
        order,
        createdAt: this.now()
      };
      this.nodes.set(node.id, record);
      if (!this.children.has(parentId)) this.children.set(parentId, []);
      this.children.get(parentId).push(node.id);
      inserted.push(record);

      const source = node.source || 'batch-import';
      if (node.expanded !== undefined) {
        this.putStateValue(node.id, 'expanded', source, node.expanded);
      }
      if (node.height !== undefined) {
        this.putStateValue(node.id, 'height', source, node.height);
      }
    }

    for (const parentId of new Set(inserted.map((node) => node.parentId))) {
      this.sortChildren(parentId);
    }
    this.refreshConflicts();
    this.log.push({ at: this.now(), action: 'addNodes', count: inserted.length, inserted: inserted.map((n) => n.id) });
    return okResult({ added: inserted, summary: this.snapshotSummary('addNodes') });
  }

  sortChildren(parentId) {
    const ids = this.children.get(parentId) || [];
    ids.sort((a, b) => {
      const left = this.nodes.get(a);
      const right = this.nodes.get(b);
      if (!left || !right) return 0;
      if (left.order !== right.order) return left.order - right.order;
      return left.id.localeCompare(right.id);
    });
  }

  putStateValue(nodeId, attribute, source, value) {
    if (!this.stateValues.has(nodeId)) this.stateValues.set(nodeId, new Map());
    const attributes = this.stateValues.get(nodeId);
    if (!attributes.has(attribute)) attributes.set(attribute, new Map());
    const values = attributes.get(attribute);
    const normalized = attribute === 'expanded' ? Boolean(value) : Number(value);
    const previous = values.get(source);
    values.set(source, { source, value: normalized, at: previous ? previous.at : this.now() });
    return previous && Object.is(previous.value, normalized);
  }

  stateSources(nodeId, attribute) {
    return Array.from((this.stateValues.get(nodeId)?.get(attribute) || new Map()).values());
  }

  effectiveState(nodeId, attribute) {
    const values = this.stateSources(nodeId, attribute);
    if (!values.length) {
      return attribute === 'expanded' ? true : DEFAULT_NODE_HEIGHT;
    }
    return values.slice().sort((left, right) => {
      const priorityDelta = (this.sourcePriority.get(right.source) || 0) - (this.sourcePriority.get(left.source) || 0);
      if (priorityDelta) return priorityDelta;
      return left.at.localeCompare(right.at);
    })[0];
  }

  isExpanded(nodeId) {
    return Boolean(this.effectiveState(nodeId, 'expanded').value);
  }

  nodeHeight(nodeId) {
    const state = this.effectiveState(nodeId, 'height');
    return Number(state.value) || DEFAULT_NODE_HEIGHT;
  }

  reportState(input, fallbackSource = 'state-report') {
    const reports = Array.isArray(input) ? input : input && input.reports;
    if (!Array.isArray(reports)) {
      return rejection('INVALID_STATE_PAYLOAD', 'Expected an array of reports or { reports: [...] }.');
    }
    const errors = [];
    reports.forEach((report, index) => {
      const location = 'reports[' + index + ']';
      if (!isPlainObject(report)) {
        errors.push({ code: 'INVALID_STATE_REPORT', message: location + ' must be an object.', location });
        return;
      }
      if (!this.nodes.has(report.nodeId)) {
        errors.push({ code: 'UNKNOWN_NODE', message: 'State report references unregistered node ' + report.nodeId + ' at ' + location + '.', location, nodeId: report.nodeId });
      }
      if (!['expanded', 'height'].includes(report.attribute)) {
        errors.push({ code: 'INVALID_ATTRIBUTE', message: location + '.attribute must be expanded or height.', location, nodeId: report.nodeId });
      } else if (report.attribute === 'expanded' && typeof report.value !== 'boolean') {
        errors.push({ code: 'INVALID_EXPANDED', message: location + '.value must be a boolean.', location, nodeId: report.nodeId });
      } else if (report.attribute === 'height' && (!Number.isFinite(report.value) || report.value <= 0)) {
        errors.push({ code: 'INVALID_HEIGHT', message: location + '.value must be a positive number.', location, nodeId: report.nodeId });
      }
      if (!report.source || typeof report.source !== 'string') {
        errors.push({ code: 'INVALID_SOURCE', message: location + '.source must be a non-empty string.', location, nodeId: report.nodeId });
      }
    });
    if (errors.length) return { ok: false, errors };

    const affected = new Set();
    for (const report of reports) {
      this.putStateValue(report.nodeId, report.attribute, report.source || fallbackSource, report.value);
      affected.add(report.nodeId);
    }
    const conflicts = this.refreshConflicts();
    this.log.push({ at: this.now(), action: 'reportState', count: reports.length, affected: Array.from(affected) });
    return okResult({ affected: Array.from(affected), conflicts, summary: this.snapshotSummary('reportState') });
  }

  setLocalState(nodeId, attribute, value) {
    if (!this.nodes.has(nodeId)) {
      return rejection('UNKNOWN_NODE', 'Node is not registered: ' + nodeId, { nodeId });
    }
    if (attribute === 'expanded' && typeof value !== 'boolean') {
      return rejection('INVALID_EXPANDED', 'Expanded value must be a boolean.', { nodeId });
    }
    if (attribute === 'height' && (!Number.isFinite(value) || value <= 0)) {
      return rejection('INVALID_HEIGHT', 'Height must be a positive number.', { nodeId });
    }
    this.putStateValue(nodeId, attribute, 'local-ui', value);
    const conflicts = this.refreshConflicts();
    this.log.push({ at: this.now(), action: 'setLocalState', nodeId, attribute, value });
    return okResult({ nodeId, attribute, value, conflicts });
  }

  refreshConflicts() {
    const active = [];
    for (const nodeId of this.stateValues.keys()) {
      for (const attribute of ['expanded', 'height']) {
        const values = this.stateSources(nodeId, attribute);
        const distinct = new Map();
        for (const item of values) distinct.set(String(item.value), item);
        if (distinct.size > 1) {
          const winning = this.effectiveState(nodeId, attribute);
          const conflict = {
            id: nodeId + ':' + attribute,
            kind: 'STATE_CONFLICT',
            nodeId,
            attribute,
            location: this.locate(nodeId),
            sources: values.slice().sort((left, right) => left.source.localeCompare(right.source)),
            effective: winning,
            message: '节点 ' + nodeId + ' 的 ' + attribute + ' 存在冲突：' +
              values.map((item) => item.source + '=' + String(item.value)).join('，') +
              '；当前显示采用 ' + winning.source + '=' + String(winning.value) + '。'
          };
          active.push(conflict);
        }
      }
    }
    const previousById = new Map(this.activeConflicts.map((item) => [item.id, item]));
    this.activeConflicts = active;
    for (const conflict of active) {
      if (!previousById.has(conflict.id)) this.conflictLog.push({ ...conflict, firstSeenAt: this.now() });
    }
    return active;
  }

  addFiles(input) {
    const list = Array.isArray(input) ? input : input && input.files;
    if (!Array.isArray(list)) {
      return rejection('INVALID_FILES_PAYLOAD', 'Expected an array of files or { files: [...] }.');
    }

    const errors = [];
    const batchSeq = new Map();
    list.forEach((file, index) => {
      const location = 'files[' + index + ']';
      if (!isPlainObject(file)) {
        errors.push({ code: 'INVALID_FILE', message: location + ' must be an object.', location });
        return;
      }
      if (!Number.isSafeInteger(file.seq) || file.seq < 0) {
        errors.push({ code: 'INVALID_SEQ', message: location + '.seq must be a non-negative safe integer.', location });
      } else if (this.fileSequence.has(file.seq) || batchSeq.has(file.seq)) {
        const existing = this.files.get(file.seq) || batchSeq.get(file.seq);
        const same = existing &&
          existing.nodeId === file.nodeId &&
          existing.size === file.size &&
          existing.revisedAt === (typeof file.revisedAt === 'number' ? normalizeTime(file.revisedAt) : file.revisedAt);
        if (!same) {
          errors.push({
            code: 'DUPLICATE_SEQ_CONFLICT',
            message: 'Sequence ' + file.seq + ' already identifies another file. Re-delivery is idempotent only when size, node and revisedAt match exactly.',
            location,
            seq: file.seq
          });
        }
      }
      if (!this.nodes.has(file.nodeId)) {
        errors.push({
          code: 'UNKNOWN_NODE',
          message: 'File with sequence ' + file.seq + ' references unregistered node ' + file.nodeId + '.',
          location,
          seq: file.seq,
          nodeId: file.nodeId
        });
      }
      if (!Number.isSafeInteger(file.size) || file.size < 0) {
        errors.push({ code: 'INVALID_SIZE', message: location + '.size must be a non-negative safe integer.', location, seq: file.seq });
      }
      try {
        normalizeTime(file.revisedAt);
      } catch (error) {
        errors.push({ code: error.code, message: error.message, location, seq: file.seq });
      }

      if (Number.isSafeInteger(file.seq) && file.seq >= 0) {
        if (batchSeq.has(file.seq)) return;
        batchSeq.set(file.seq, file);
      }
    });

    const latestByNode = new Map();
    const latestFor = (nodeId) => {
      if (!latestByNode.has(nodeId)) {
        const ids = this.filesByNode.get(nodeId) || [];
        latestByNode.set(nodeId, ids.reduce((latest, seq) => {
          const file = this.files.get(seq);
          return !latest || file.revisedAt > latest ? file.revisedAt : latest;
        }, null));
      }
      return latestByNode.get(nodeId);
    };

    const normalized = [];
    for (const file of list) {
      if (!Number.isSafeInteger(file.seq) || !this.nodes.has(file.nodeId)) continue;
      const revisedAt = normalizeTime(file.revisedAt);
      if (this.files.has(file.seq)) {
        const existing = this.files.get(file.seq);
        if (existing.nodeId === file.nodeId && existing.size === file.size && existing.revisedAt === revisedAt) continue;
      }
      const latest = latestFor(file.nodeId);
      if (latest !== null && revisedAt < latest) {
        errors.push({
          code: 'REVISION_GOES_BACKWARD',
          message: 'Node ' + file.nodeId + ' latest revision is ' + timeLabel(latest) + ', file seq ' + file.seq + ' arrives at ' + revisedAt + '.',
          location: 'files seq ' + file.seq,
          nodeId: file.nodeId,
          seq: file.seq,
          latest,
          revisedAt
        });
      }
      normalized.push({ ...file, revisedAt });
    }

    if (errors.length) return { ok: false, errors };

    const added = [];
    const idempotent = [];
    for (const file of normalized) {
      if (this.files.has(file.seq)) {
        idempotent.push(file.seq);
        continue;
      }
      const record = {
        seq: file.seq,
        nodeId: file.nodeId,
        size: file.size,
        revisedAt: file.revisedAt,
        name: file.name === undefined ? 'file-' + String(file.seq) : String(file.name),
        receivedAt: this.now()
      };
      this.files.set(file.seq, record);
      this.fileSequence.add(file.seq);
      if (!this.filesByNode.has(file.nodeId)) this.filesByNode.set(file.nodeId, []);
      this.filesByNode.get(file.nodeId).push(file.seq);
      this.filesByNode.get(file.nodeId).sort((a, b) => a - b);
      added.push(record);
    }
    this.log.push({ at: this.now(), action: 'addFiles', added: added.map((f) => f.seq), idempotent });
    return okResult({ added, idempotent, affectedNodes: Array.from(new Set(added.map((f) => f.nodeId))), summary: this.snapshotSummary('addFiles') });
  }

  removeNodeFromParent(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    const siblings = this.children.get(node.parentId) || [];
    const index = siblings.indexOf(nodeId);
    if (index >= 0) siblings.splice(index, 1);
  }

  attachNode(nodeId, parentId, order) {
    const node = this.nodes.get(nodeId);
    node.parentId = parentId;
    node.order = order;
    if (!this.children.has(parentId)) this.children.set(parentId, []);
    this.children.get(parentId).push(nodeId);
    this.normalizeSiblingOrders(parentId);
    this.sortChildren(parentId);
  }

  normalizeSiblingOrders(parentId) {
    this.sortChildren(parentId);
    this.children.get(parentId).forEach((id, index) => {
      this.nodes.get(id).order = index;
    });
  }

  moveNode(input) {
    const op = isPlainObject(input) ? input : {};
    const nodeId = op.nodeId;
    const targetParentId = op.targetParentId === undefined ? ROOT_ID : op.targetParentId;
    if (!this.nodes.has(nodeId)) {
      return rejection('UNKNOWN_NODE', 'Cannot move unregistered node ' + nodeId + '.', { nodeId });
    }
    if (targetParentId !== ROOT_ID && !this.nodes.has(targetParentId)) {
      return rejection('UNKNOWN_TARGET_PARENT', 'Target parent is not registered: ' + targetParentId, { targetParentId });
    }
    if (nodeId === targetParentId || this.isAncestor(nodeId, targetParentId)) {
      return rejection('CYCLIC_MOVE', 'Cannot move node ' + nodeId + ' into itself or one of its descendants.', { nodeId, targetParentId });
    }
    if (op.afterNodeId !== undefined) {
      if (op.afterNodeId !== null && (!this.nodes.has(op.afterNodeId) || this.nodes.get(op.afterNodeId).parentId !== targetParentId)) {
        return rejection('INVALID_ANCHOR', 'afterNodeId must be null or an existing child of the target parent.', { nodeId, afterNodeId: op.afterNodeId });
      }
    }

    const oldParentId = this.nodes.get(nodeId).parentId;
    this.removeNodeFromParent(nodeId);
    if (!this.children.has(targetParentId)) this.children.set(targetParentId, []);
    const siblings = this.children.get(targetParentId);
    const insertAt = op.afterNodeId === undefined
      ? siblings.length
      : op.afterNodeId === null ? 0 : siblings.indexOf(op.afterNodeId) + 1;
    siblings.splice(insertAt, 0, nodeId);
    this.normalizeSiblingOrders(targetParentId);
    if (oldParentId !== targetParentId) this.normalizeSiblingOrders(oldParentId);

    const affected = oldParentId === targetParentId
      ? [targetParentId, nodeId]
      : [oldParentId, targetParentId, nodeId];
    this.log.push({ at: this.now(), action: 'moveNode', nodeId, oldParentId, targetParentId });
    return okResult({ moved: nodeId, affectedNodes: affected, oldParentId, targetParentId });
  }

  mergeNodes(input) {
    const op = isPlainObject(input) ? input : {};
    if (!this.nodes.has(op.sourceId)) return rejection('UNKNOWN_SOURCE', 'Source node is not registered: ' + op.sourceId, { sourceId: op.sourceId });
    if (!this.nodes.has(op.targetId)) return rejection('UNKNOWN_TARGET', 'Target node is not registered: ' + op.targetId, { targetId: op.targetId });
    if (op.sourceId === op.targetId) return rejection('INVALID_MERGE', 'A node cannot be merged into itself.', { sourceId: op.sourceId, targetId: op.targetId });
    if (this.isAncestor(op.sourceId, op.targetId)) {
      return rejection('CYCLIC_MERGE', 'Cannot merge an ancestor into its descendant.', { sourceId: op.sourceId, targetId: op.targetId });
    }

    const sourceId = op.sourceId;
    const targetId = op.targetId;
    const source = this.nodes.get(sourceId);
    const oldParentId = source.parentId;
    const removedIds = this.subtreeIds(sourceId);
    for (const fileId of this.filesByNode.get(sourceId) || []) {
      const file = this.files.get(fileId);
      file.nodeId = targetId;
      if (!this.filesByNode.has(targetId)) this.filesByNode.set(targetId, []);
      this.filesByNode.get(targetId).push(fileId);
    }
    this.filesByNode.get(targetId)?.sort((a, b) => a - b);
    this.filesByNode.delete(sourceId);

    for (const childId of this.childrenOf(sourceId)) {
      this.nodes.get(childId).parentId = targetId;
      this.children.get(targetId).push(childId);
    }
    this.children.delete(sourceId);
    this.removeNodeFromParent(sourceId);
    this.nodes.delete(sourceId);
    for (const id of removedIds) {
      if (id !== sourceId) this.stateValues.delete(id);
    }
    this.stateValues.delete(sourceId);
    this.normalizeSiblingOrders(oldParentId);
    this.normalizeSiblingOrders(targetId);
    this.refreshConflicts();
    this.log.push({ at: this.now(), action: 'mergeNodes', sourceId, targetId });
    return okResult({ removedNodeId: sourceId, mergedInto: targetId, affectedNodes: [oldParentId, targetId], anchorMap: { node: sourceId, file: null, mappedRow: { kind: 'node', nodeId: targetId } } });
  }

  subtreeIds(nodeId) {
    const result = [];
    const walk = (id) => {
      result.push(id);
      for (const childId of this.children.get(id) || []) walk(childId);
    };
    walk(nodeId);
    return result;
  }

  splitNode(input) {
    const op = isPlainObject(input) ? input : {};
    if (!this.nodes.has(op.nodeId)) return rejection('UNKNOWN_NODE', 'Cannot split unregistered node ' + op.nodeId + '.', { nodeId: op.nodeId });
    if (!op.aId || !op.bId || typeof op.aId !== 'string' || typeof op.bId !== 'string') {
      return rejection('INVALID_SPLIT', 'aId and bId must be non-empty strings.', { nodeId: op.nodeId });
    }
    if (this.nodes.has(op.aId) || this.nodes.has(op.bId) || op.aId === op.bId) {
      return rejection('DUPLICATE_NODE_ID', 'Split target ids must be distinct and unregistered.', { aId: op.aId, bId: op.bId });
    }
    const fileSeqs = Array.isArray(op.fileSeqs) ? op.fileSeqs : [];
    for (const seq of fileSeqs) {
      if (!this.files.has(seq) || this.files.get(seq).nodeId !== op.nodeId) {
        return rejection('INVALID_SPLIT_FILE', 'File seq ' + seq + ' does not belong to split node ' + op.nodeId + '.', { seq });
      }
    }

    const original = this.nodes.get(op.nodeId);
    const parentId = original.parentId;
    const aNode = { id: op.aId, label: op.aLabel || op.aId, parentId, order: original.order, createdAt: this.now() };
    const bNode = { id: op.bId, label: op.bLabel || op.bId, parentId, order: original.order + 1, createdAt: this.now() };
    const aFileSet = new Set(fileSeqs);
    this.nodes.set(aNode.id, aNode);
    this.nodes.set(bNode.id, bNode);
    this.children.set(aNode.id, []);
    this.children.set(bNode.id, []);

    const remaining = [];
    for (const seq of this.filesByNode.get(op.nodeId) || []) {
      const file = this.files.get(seq);
      file.nodeId = aFileSet.has(seq) ? aNode.id : bNode.id;
      remaining.push(seq);
    }
    this.filesByNode.set(aNode.id, remaining.filter((seq) => this.files.get(seq).nodeId === aNode.id).sort((a, b) => a - b));
    this.filesByNode.set(bNode.id, remaining.filter((seq) => this.files.get(seq).nodeId === bNode.id).sort((a, b) => a - b));

    const sourceChildren = this.children.get(op.nodeId) || [];
    const childSet = new Set((op.childIds || []).filter((id) => sourceChildren.includes(id)));
    this.children.set(aNode.id, sourceChildren.filter((id) => childSet.has(id)));
    this.children.set(bNode.id, sourceChildren.filter((id) => !childSet.has(id)));
    for (const id of this.children.get(aNode.id)) this.nodes.get(id).parentId = aNode.id;
    for (const id of this.children.get(bNode.id)) this.nodes.get(id).parentId = bNode.id;

    const siblings = this.children.get(parentId);
    const index = siblings.indexOf(op.nodeId);
    siblings.splice(index, 1, aNode.id, bNode.id);
    this.nodes.delete(op.nodeId);
    this.children.delete(op.nodeId);
    this.stateValues.delete(op.nodeId);
    this.normalizeSiblingOrders(parentId);
    this.refreshConflicts();
    this.log.push({ at: this.now(), action: 'splitNode', sourceId: op.nodeId, aId: aNode.id, bId: bNode.id });
    return okResult({
      removedNodeId: op.nodeId,
      aId: aNode.id,
      bId: bNode.id,
      affectedNodes: [parentId, aNode.id, bNode.id],
      anchorMap: { node: op.nodeId, file: null, mappedRow: { kind: 'node', nodeId: aNode.id } }
    });
  }

  applyOperation(input) {
    if (!isPlainObject(input) || !input.type) {
      return rejection('INVALID_OPERATION', 'Operation must be an object with a type.');
    }
    if (input.type === 'moveNode') return this.moveNode(input);
    if (input.type === 'mergeNodes') return this.mergeNodes(input);
    if (input.type === 'splitNode') return this.splitNode(input);
    return rejection('UNKNOWN_OPERATION', 'Unsupported operation: ' + input.type, { type: input.type });
  }

  serialize() {
    return JSON.stringify({
      version: 1,
      nodes: Array.from(this.nodes.values()),
      files: Array.from(this.files.values()),
      stateValues: Array.from(this.stateValues, ([nodeId, attributes]) => [
        nodeId,
        Array.from(attributes, ([attribute, values]) => [
          attribute,
          Array.from(values.values())
        ])
      ]),
      sourcePriority: Array.from(this.sourcePriority.entries()),
      conflictLog: this.conflictLog
    }, null, 2);
  }

  load(raw) {
    this.reset();
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const nodes = data.nodes || [];
    const byParent = new Map();
    nodes.forEach((node) => {
      const parentId = node.parentId === undefined ? ROOT_ID : node.parentId;
      if (!byParent.has(parentId)) byParent.set(parentId, []);
      byParent.get(parentId).push(node.id);
    });
    for (const node of nodes) {
      this.nodes.set(node.id, { ...node, parentId: node.parentId === undefined ? ROOT_ID : node.parentId });
      this.filesByNode.set(node.id, []);
    }
    for (const [parentId, ids] of byParent.entries()) {
      this.children.set(parentId, ids);
      this.normalizeSiblingOrders(parentId);
    }
    for (const file of data.files || []) {
      this.files.set(file.seq, file);
      this.fileSequence.add(file.seq);
      if (!this.filesByNode.has(file.nodeId)) this.filesByNode.set(file.nodeId, []);
      this.filesByNode.get(file.nodeId).push(file.seq);
    }
    for (const ids of this.filesByNode.values()) ids.sort((a, b) => a - b);
    for (const [nodeId, attributes] of data.stateValues || []) {
      this.stateValues.set(nodeId, new Map(attributes.map(([attribute, values]) => [attribute, new Map(values.map((item) => [item.source, item]))])));
    }
    this.sourcePriority = new Map(data.sourcePriority || [['local-ui', 100], ['batch-import', 10]]);
    this.conflictLog = data.conflictLog || [];
    this.refreshConflicts();
    return this.snapshotSummary('load');
  }
}

class IncrementalLayout {
  constructor(store) {
    this.store = store;
    this.blocks = new Map();
    this.rootBlock = null;
    this.rebuildAll();
  }

  rebuildAll() {
    this.blocks = new Map();
    this.rootBlock = this.buildBlock(ROOT_ID, -1, []);
  }

  rebuildAffected(nodeIds = []) {
    const affected = new Set(nodeIds.filter((id) => id !== ROOT_ID && id !== null && id !== undefined));
    for (const id of Array.from(affected)) {
      let current = this.store.nodes.get(id)?.parentId;
      while (current !== ROOT_ID && current !== null && current !== undefined) {
        affected.add(current);
        current = this.store.nodes.get(current)?.parentId;
      }
    }
    if (!affected.size) {
      this.rebuildAll();
      return { changed: true, affectedBlocks: [ROOT_ID] };
    }
    const byDepth = new Map();
    for (const id of affected) {
      const depth = this.store.pathOf(id).length;
      if (!byDepth.has(depth)) byDepth.set(depth, []);
      byDepth.get(depth).push(id);
    }
    const changed = new Set();
    const depths = Array.from(byDepth.keys()).sort((a, b) => b - a);
    for (const depth of depths) {
      for (const id of byDepth.get(depth)) {
        if (!this.store.nodes.has(id) || !this.blocks.has(id)) {
          this.blocks.delete(id);
          continue;
        }
        const oldBlock = this.blocks.get(id);
        const newBlock = this.buildBlock(id, depth, oldBlock.path);
        this.blocks.set(id, newBlock);
        changed.add(id);
      }
    }
    const rootPath = [];
    const oldRoot = this.rootBlock;
    this.rootBlock = this.buildBlock(ROOT_ID, -1, rootPath, new Set(changed));
    if (oldRoot) changed.add(ROOT_ID);
    return { changed: true, affectedBlocks: Array.from(changed) };
  }

  buildBlock(nodeId, depth, parentPath, reused = new Set()) {
    const node = nodeId === ROOT_ID ? null : this.store.nodes.get(nodeId);
    const path = nodeId === ROOT_ID ? [] : parentPath.concat([{ id: node.id, label: node.label }]);
    const fileRows = nodeId === ROOT_ID ? [] : (this.store.filesByNode.get(nodeId) || []).map((seq) => {
      const file = this.store.files.get(seq);
      return {
        kind: 'file',
        key: 'file:' + seq,
        nodeId,
        seq,
        depth: depth + 1,
        height: DEFAULT_FILE_HEIGHT,
        file,
        path: path.concat([{ id: 'file:' + seq, label: file.name }])
      };
    });
    const childIds = this.store.childrenOf(nodeId);
    const childBlocks = [];
    for (const childId of childIds) {
      const cached = this.blocks.get(childId);
      if (cached && !reused.has(childId)) {
        childBlocks.push(cached);
      } else {
        const child = this.store.nodes.get(childId);
        const block = this.buildBlock(childId, depth + 1, path);
        this.blocks.set(childId, block);
        childBlocks.push(block);
      }
    }
    const expanded = nodeId === ROOT_ID || this.store.isExpanded(nodeId);
    const nodeHeight = nodeId === ROOT_ID ? 0 : this.store.nodeHeight(nodeId);
    const ownRowCount = nodeId === ROOT_ID ? 0 : 1;
    const fileCount = fileRows.length;
    const childRowCount = childBlocks.reduce((sum, block) => sum + block.totalRows, 0);
    const totalRows = ownRowCount + fileCount + (expanded ? childRowCount : 0);
    const childHeight = childBlocks.reduce((sum, block) => sum + block.totalHeight, 0);
    const totalHeight = nodeHeight + fileRows.reduce((sum, row) => sum + row.height, 0) + (expanded ? childHeight : 0);
    const block = {
      id: nodeId,
      kind: 'node',
      key: 'node:' + String(nodeId),
      nodeId,
      depth,
      path,
      expanded,
      ownRow: nodeId === ROOT_ID ? null : {
        kind: 'node',
        key: 'node:' + nodeId,
        nodeId,
        depth,
        height: nodeHeight,
        node,
        path,
        conflictAttributes: this.store.activeConflicts.filter((conflict) => conflict.nodeId === nodeId).map((conflict) => conflict.attribute)
      },
      fileRows,
      childBlocks,
      ownRowCount,
      fileCount,
      childRowCount,
      totalRows,
      totalHeight
    };
    if (block.ownRow) block.ownRow.block = block;
    for (const row of fileRows) row.block = block;
    return block;
  }

  get totalRows() {
    return this.rootBlock.totalRows;
  }

  get totalHeight() {
    return this.rootBlock.totalHeight;
  }

  collectRange(startIndex, count, options = {}) {
    const rows = [];
    const includeFiles = options.includeFiles !== false;
    const includeCollapsedChildren = Boolean(options.includeCollapsedChildren);
    const visit = (block) => {
      if (rows.length >= count) return;
      if (block.ownRow) {
        const index = block.localRowIndex !== undefined ? block.localRowIndex : null;
        rows.push(block.ownRow);
        if (rows.length >= count) return;
      }
      if (includeFiles) {
        for (const row of block.fileRows) {
          rows.push(row);
          if (rows.length >= count) return;
        }
      }
      if (block.expanded || includeCollapsedChildren) {
        for (const child of block.childBlocks) {
          visit(child);
          if (rows.length >= count) return;
        }
      }
    };
    const slice = [];
    this.collectRows(this.rootBlock, Math.max(0, startIndex), Number.POSITIVE_INFINITY, slice, { includeFiles, includeCollapsedChildren });
    for (const row of slice.slice(0, count)) rows.push(row);
    let currentTop = 0;
    const indexed = [];
    const assign = (block) => {
      if (block.ownRow) {
        block.ownRow.index = indexed.length;
        block.ownRow.top = currentTop;
        currentTop += block.ownRow.height;
        indexed.push(block.ownRow);
      }
      if (includeFiles) {
        for (const row of block.fileRows) {
          row.index = indexed.length;
          row.top = currentTop;
          currentTop += row.height;
          indexed.push(row);
        }
      }
      if (block.expanded || includeCollapsedChildren) block.childBlocks.forEach(assign);
    };
    assign(this.rootBlock);
    return indexed.slice(startIndex, startIndex + count);
  }
