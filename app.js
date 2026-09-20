(function () {
  'use strict';

  const STORAGE_KEY = 'local-slice-discovery-v1';
  const AGG_LABELS = { sum: '求和', avg: '平均值', count: '行数计数', min: '最小值', max: '最大值' };

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    const pushField = () => { row.push(field); field = ''; };
    const pushRow = () => { rows.push(row); row = []; };
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 1; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        pushField();
      } else if (ch === '\n') {
        pushField(); pushRow();
      } else if (ch !== '\r') {
        field += ch;
      }
    }
    pushField(); pushRow();
    return rows.filter((items) => items.some((item) => item.trim() !== ''));
  }

  function toNumberOrNull(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = String(value ?? '').trim().replace(/,/g, '');
    if (text === '') return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }

  function parseDataset(text, name, forcedDelimiter) {
    const cleanText = text.replace(/^\uFEFF/, '');
    const sample = cleanText.slice(0, 4096);
    const delimiter = forcedDelimiter || (sample.split('\t').length > sample.split(',').length ? '\t' : ',');
    const matrix = parseDelimited(cleanText, delimiter);
    if (matrix.length < 2) throw new Error('文件至少需要一行表头和一行数据。');
    const headers = matrix[0].map((h, i) => h.trim() || `未命名列 ${i + 1}`);
    const names = new Set();
    headers.forEach((h, i) => {
      let title = h;
      while (names.has(title)) title = `${h}_${i + 1}`;
      names.add(title);
      headers[i] = title;
    });
    const numericCount = headers.map(() => 0);
    const populatedCount = headers.map(() => 0);
    const rows = matrix.slice(1).map((items) => {
      const record = {};
      headers.forEach((header, i) => {
        const raw = (items[i] ?? '').trim();
        if (raw !== '') populatedCount[i] += 1;
        const n = toNumberOrNull(raw);
        if (n !== null && raw !== '') numericCount[i] += 1;
        record[header] = n === null ? raw : n;
      });
      return record;
    });
    const columns = headers.map((header, i) => ({
      name: header,
      kind: populatedCount[i] > 0 && numericCount[i] / populatedCount[i] >= 0.8 ? 'measure' : 'dimension'
    }));
    if (!columns.some((c) => c.kind === 'dimension')) throw new Error('至少需要一列文本维度。');
    return { id: uid('dataset'), name, columns, rows, createdAt: new Date().toISOString() };
  }

  function makeSampleDataset() {
    const regions = ['华东', '华北', '华南', '西部'];
    const categories = ['企业版', '专业版', '基础版'];
    const channels = ['直销', '伙伴', '线上'];
    const rows = [];
    let id = 1;
    regions.forEach((region, r) => categories.forEach((category, c) => channels.forEach((channel, h) => {
      const repeat = (r + c + h) % 3 === 0 ? 1 : 2;
      for (let k = 0; k < repeat; k += 1) {
        const quantity = 4 + ((r * 3 + c * 5 + h * 7 + k * 2) % 18);
        const discount = [0, 0.05, 0.1, 0.15][(r + c + h + k) % 4];
        const unit = 900 + c * 1300 + h * 180 - r * 70;
        rows.push({
          订单号: `S${String(id).padStart(4, '0')}`,
          区域: region, 品类: category, 渠道: channel,
          客户类型: (id % 4 === 0 ? '新客' : '老客'),
          月份: `${((id - 1) % 6) + 1}月`,
          销售额: Math.round(quantity * unit * (1 - discount)),
          数量: quantity,
          折扣率: discount,
          利润: Math.round(quantity * unit * (0.18 - discount * 0.4))
        });
        id += 1;
      }
    })));
    return {
      id: uid('sample'),
      name: '内置销售明细示例',
      createdAt: new Date().toISOString(),
      columns: [
        { name: '订单号', kind: 'dimension' }, { name: '区域', kind: 'dimension' },
        { name: '品类', kind: 'dimension' }, { name: '渠道', kind: 'dimension' },
        { name: '客户类型', kind: 'dimension' }, { name: '月份', kind: 'dimension' },
        { name: '销售额', kind: 'measure' }, { name: '数量', kind: 'measure' },
        { name: '折扣率', kind: 'measure' }, { name: '利润', kind: 'measure' }
      ],
      rows
    };
  }

  function columnKind(dataset, name) {
    const column = dataset.columns.find((item) => item.name === name);
    return column ? column.kind : null;
  }

  function normalizeFilters(dataset, filters) {
    const result = {};
    const source = Array.isArray(filters) ? filters : Object.values(filters || {});
    dataset.columns.forEach((column) => {
      const item = source.find((filter) => filter.column === column.name) || {};
      if (column.kind === 'measure') {
        const min = toNumberOrNull(item.min);
        const max = toNumberOrNull(item.max);
        result[column.name] = {
          column: column.name, kind: 'measure', op: item.op === 'range' ? 'range' : 'all',
          min, max
        };
        if (result[column.name].op === 'range' && min === null && max === null) {
          result[column.name].op = 'all';
        }
      } else {
        result[column.name] = {
          column: column.name, kind: 'dimension', op: item.op === 'in' ? 'in' : 'all',
          values: Array.isArray(item.values) ? item.values.map(String) : []
        };
      }
    });
    return result;
  }

  function rowMatches(row, filters) {
    return Object.values(filters).every((filter) => {
      if (filter.op === 'all') return true;
      if (filter.kind === 'measure') {
        const value = toNumberOrNull(row[filter.column]);
        if (value === null) return false;
        if (filter.min !== null && value < filter.min) return false;
        if (filter.max !== null && value > filter.max) return false;
        return true;
      }
      if (filter.op === 'in') return filter.values.includes(String(row[filter.column] ?? ''));
      return true;
    });
  }

  function aggregateRows(dataset, dimensions, measure, aggregation, minSamples, filters) {
    const normalized = normalizeFilters(dataset, filters);
    const groups = new Map();
    let filteredCount = 0;
    dataset.rows.forEach((row) => {
      if (!rowMatches(row, normalized)) return;
      filteredCount += 1;
      const values = dimensions.map((dimension) => row[dimension] ?? '(空)');
      const key = JSON.stringify(values);
      if (!groups.has(key)) {
        groups.set(key, { key, values, samples: 0, numbers: [] });
      }
      const group = groups.get(key);
      group.samples += 1;
      if (aggregation !== 'count') {
        const n = toNumberOrNull(row[measure]);
        if (n !== null) group.numbers.push(n);
      }
    });
    const result = Array.from(groups.values()).map((group) => {
      let value = null;
      const nums = group.numbers;
      if (aggregation === 'count') value = group.samples;
      else if (nums.length) {
        if (aggregation === 'sum') value = nums.reduce((a, b) => a + b, 0);
        if (aggregation === 'avg') value = nums.reduce((a, b) => a + b, 0) / nums.length;
        if (aggregation === 'min') value = nums.reduce((a, b) => Math.min(a, b), nums[0]);
        if (aggregation === 'max') value = nums.reduce((a, b) => Math.max(a, b), nums[0]);
      }
      return {
        ...group,
        value,
        trusted: group.samples >= minSamples && (aggregation === 'count' || nums.length > 0)
      };
    });
    result.sort((a, b) => {
      for (let i = 0; i < dimensions.length; i += 1) {
        const compare = String(a.values[i]).localeCompare(String(b.values[i]), 'zh-Hans-CN');
        if (compare) return compare;
      }
      return 0;
    });
    return { totalRows: dataset.rows.length, filteredCount, groups: result };
  }

  function makeSnapshot(dataset, config, result, cell) {
    const kinds = {};
    dataset.columns.forEach((column) => { kinds[column.name] = column.kind; });
    return {
      datasetId: dataset.id,
      datasetName: dataset.name,
      columnKinds: kinds,
      dimensions: config.dimensions.slice(),
      measure: config.measure,
      aggregation: config.aggregation,
      minSamples: config.minSamples,
      filters: normalizeFilters(dataset, config.filters),
      filteredCount: result.filteredCount,
      cellKey: cell ? cell.key : null,
      cellValues: cell ? cell.values.slice() : [],
      value: cell ? cell.value : null,
      samples: cell ? cell.samples : 0,
      trusted: cell ? cell.trusted : false,
      createdAt: new Date().toISOString()
    };
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((obj, key) => {
        obj[key] = stableValue(value[key]);
        return obj;
      }, {});
    }
    return value ?? null;
  }

  function evaluateSnapshot(dataset, config, snapshot) {
    const reasons = [];
    if (!dataset || dataset.id !== snapshot.datasetId) reasons.push('数据文件已更换');
    else {
      const kinds = {};
      dataset.columns.forEach((column) => { kinds[column.name] = column.kind; });
      if (JSON.stringify(stableValue(kinds)) !== JSON.stringify(stableValue(snapshot.columnKinds))) {
        reasons.push('字段类型已调整');
      }
      if (!snapshot.dimensions.every((name) => dataset.columns.some((c) => c.name === name))) {
        reasons.push('快照中的维度列已缺失');
      }
      if (snapshot.aggregation !== 'count' && !dataset.columns.some((c) => c.name === snapshot.measure)) {
        reasons.push('快照中的度量列已缺失');
      }
    }
    const specReasons = [];
    if (JSON.stringify(snapshot.dimensions) !== JSON.stringify(config.dimensions)) {
      specReasons.push('维度组合已变化');
    }
    if (snapshot.aggregation !== config.aggregation ||
      (snapshot.aggregation !== 'count' && snapshot.measure !== config.measure)) {
      specReasons.push('度量口径已变化');
    }
    if (snapshot.minSamples !== config.minSamples) specReasons.push('可信度阈值已变化');
    if (specReasons.length && !reasons.length) reasons.push(...specReasons);

    const currentFilters = normalizeFilters(dataset, config.filters);
    if (JSON.stringify(stableValue(currentFilters)) !== JSON.stringify(stableValue(snapshot.filters))) {
      reasons.push('筛选范围或维度取值已变化');
    }

    if (!reasons.length) {
      const result = aggregateRows(
        dataset, snapshot.dimensions, snapshot.measure, snapshot.aggregation,
        snapshot.minSamples, snapshot.filters
      );
      const cell = result.groups.find((group) => group.key === snapshot.cellKey);
      if (!cell) reasons.push('该单元格在当前条件下已不存在');
      else {
        if (cell.samples !== snapshot.samples) reasons.push(`样本数从 ${snapshot.samples} 变为 ${cell.samples}`);
        if (Number(cell.value) !== Number(snapshot.value)) reasons.push('聚合值已变化');
      }
    }
    return { valid: reasons.length === 0, reasons };
  }

  function getNode(records, tombstones, id) {
    const finding = records.find((item) => item.id === id);
    if (finding) return { ...finding, ghost: false };
    const tombstone = tombstones.find((item) => item.id === id);
    if (tombstone) return { ...tombstone, ghost: true, deleted: true };
    return {
      id, ghost: true, deleted: true, title: '已删除且未保留标题的发现',
      note: '', references: [], snapshot: null, deletedAt: null
    };
  }

  function traceUpstream(records, tombstones, rootId) {
    const nodes = [];
    const seen = new Set();
    const visit = (id, trail) => {
      const node = getNode(records, tombstones, id);
      const cycle = trail.includes(id);
      nodes.push({ ...node, level: trail.length, cycle, brokenLink: node.ghost });
      if (seen.has(id) || cycle) return;
      seen.add(id);
      node.references.forEach((refId) => visit(refId, trail.concat(id)));
    };
    getNode(records, tombstones, rootId).references.forEach((refId) => visit(refId, []));
    return nodes;
  }

  function dependencyState(records, tombstones, rootId, validityById) {
    const warnings = [];
    let state = 'ok';
    const visit = (id, trail) => {
      if (trail.includes(id)) {
        state = 'cycle';
        warnings.push(`检测到引用环：${trail.concat(id).join(' → ')}`);
        return;
      }
      const node = getNode(records, tombstones, id);
      if (node.ghost) {
        state = 'broken';
        warnings.push(`断链：${node.title}（${id}）已被删除，原引用仍保留`);
        return;
      }
      const status = validityById.get(id);
      if (status && !status.valid) {
        state = state === 'broken' ? state : 'risky';
        warnings.push(`上游发现“${node.title}”已失效：${status.reasons.join('；')}`);
      }
      node.references.forEach((refId) => visit(refId, trail.concat(id)));
    };
    const root = getNode(records, tombstones, rootId);
    root.references.forEach((id) => visit(id, [rootId]));
    return { state, warnings: Array.from(new Set(warnings)) };
  }

  const api = {
    parseDataset, makeSampleDataset, toNumberOrNull, AGG_LABELS, aggregateRows,
    makeSnapshot, normalizeFilters, evaluateSnapshot, getNode, traceUpstream, dependencyState
  };

  if (typeof document !== 'undefined') {
    const $ = (selector) => document.querySelector(selector);
    const els = {
      fileInput: $('#fileInput'), sampleButton: $('#sampleButton'), datasetStats: $('#datasetStats'),
      schemaList: $('#schemaList'), dimensionPicker: $('#dimensionPicker'),
      measureSelect: $('#measureSelect'), aggregationSelect: $('#aggregationSelect'),
      minSampleInput: $('#minSampleInput'), resetFiltersButton: $('#resetFiltersButton'),
      filterBuilder: $('#filterBuilder'), resultSummary: $('#resultSummary'),
      resultTableWrap: $('#resultTableWrap'), findingStats: $('#findingStats'),
      findingsList: $('#findingsList'), dialog: $('#findingDialog'), form: $('#findingForm'),
      dialogTitle: $('#dialogTitle'), dialogContext: $('#dialogContext'),
      title: $('#findingTitle'), note: $('#findingNote'), referencePicker: $('#referencePicker'),
      saveButton: $('#saveFindingButton'), toast: $('#toast')
    };

    const state = {
      dataset: null, dimensions: [], measure: '', aggregation: 'sum', minSamples: 3,
      filters: [], findings: [], tombstones: [], draft: null
    };

    function showToast(message) {
      els.toast.textContent = message;
      els.toast.classList.add('show');
      clearTimeout(showToast.timer);
      showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2600);
    }

    function persist(showStorageNotice) {
      const payload = {
        dataset: state.dataset, dimensions: state.dimensions, measure: state.measure,
        aggregation: state.aggregation, minSamples: state.minSamples, filters: state.filters,
        findings: state.findings, tombstones: state.tombstones
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch (error) {
        try {
          delete payload.dataset;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
          if (showStorageNotice) showToast('发现已保存；数据量较大，明细本身未写入浏览器存储。');
        } catch (_) {
          if (showStorageNotice) showToast('浏览器本地存储不足，本次记录只在当前页面有效。');
        }
      }
    }

    function setDataset(dataset, config) {
      state.dataset = dataset;
      const dims = dataset.columns.filter((column) => column.kind === 'dimension').map((c) => c.name);
      const measures = dataset.columns.filter((column) => column.kind === 'measure').map((c) => c.name);
      if (config) {
        state.dimensions = (config.dimensions || []).filter((name) => dims.includes(name));
        state.measure = measures.includes(config.measure) ? config.measure : (measures[0] || '');
        state.aggregation = config.aggregation || 'sum';
        state.minSamples = Math.max(1, Number(config.minSamples) || 3);
        state.filters = Array.isArray(config.filters) ? config.filters : [];
      } else {
        const usefulDims = dims.filter((name) => {
          const distinct = new Set(dataset.rows.map((row) => row[name])).size;
          return distinct / Math.max(dataset.rows.length, 1) < 0.8;
        });
        state.dimensions = (usefulDims.length ? usefulDims : dims).slice(0, 2);
        state.measure = measures[0] || '';
        state.aggregation = 'sum';
        state.minSamples = 3;
        state.filters = [];
      }
      state.filters = normalizeFilters(dataset, state.filters);
    }

    function currentConfig() {
      return {
        dimensions: state.dimensions, measure: state.measure, aggregation: state.aggregation,
        minSamples: state.minSamples, filters: state.filters
      };
    }

    function init() {
      let loaded = null;
      try { loaded = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) { loaded = null; }
      if (loaded && loaded.dataset && Array.isArray(loaded.dataset.rows)) {
        setDataset(loaded.dataset, loaded);
        state.findings = loaded.findings || [];
        state.tombstones = loaded.tombstones || [];
      } else {
        setDataset(makeSampleDataset());
        state.findings = loaded && loaded.findings ? loaded.findings : [];
        state.tombstones = loaded && loaded.tombstones ? loaded.tombstones : [];
      }
      bindEvents();
      renderAll();
    }

    function bindEvents() {
      els.fileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const lower = file.name.toLowerCase();
          const delimiter = lower.endsWith('.tsv') ? '\t' : null;
          setDataset(parseDataset(text, file.name, delimiter));
          persist(true);
          renderAll();
          showToast(`已载入 ${state.dataset.rows.length} 行：${file.name}`);
        } catch (error) {
          showToast(error.message || '无法解析该文件');
        } finally {
          els.fileInput.value = '';
        }
      });
      els.sampleButton.addEventListener('click', () => {
        setDataset(makeSampleDataset());
        persist(true);
        renderAll();
        showToast('已恢复内置示例数据。');
      });
      els.schemaList.addEventListener('change', (event) => {
        const name = event.target.dataset.column;
        const kind = event.target.value;
        if (!name) return;
        const column = state.dataset.columns.find((item) => item.name === name);
        column.kind = kind;
        state.dimensions = state.dimensions.filter((dimension) =>
          state.dataset.columns.some((c) => c.name === dimension && c.kind === 'dimension'));
        const measures = state.dataset.columns.filter((c) => c.kind === 'measure').map((c) => c.name);
        if (!measures.includes(state.measure)) state.measure = measures[0] || '';
        state.filters = normalizeFilters(state.dataset, state.filters);
        persist(false);
        renderAll();
      });
      els.dimensionPicker.addEventListener('change', (event) => {
        const name = event.target.value;
        if (event.target.checked && !state.dimensions.includes(name)) state.dimensions.push(name);
        if (!event.target.checked) state.dimensions = state.dimensions.filter((item) => item !== name);
        persist(false);
        renderAll();
      });
      els.measureSelect.addEventListener('change', () => {
        state.measure = els.measureSelect.value; persist(false); renderAll();
      });
      els.aggregationSelect.addEventListener('change', () => {
        state.aggregation = els.aggregationSelect.value; persist(false); renderAll();
      });
      els.minSampleInput.addEventListener('change', () => {
        state.minSamples = Math.max(1, Number(els.minSampleInput.value) || 1);
        persist(false); renderAll();
      });
      els.resetFiltersButton.addEventListener('click', () => {
        state.filters = normalizeFilters(state.dataset, []); persist(false); renderAll();
      });
      els.filterBuilder.addEventListener('input', handleFilterChange);
      els.filterBuilder.addEventListener('change', handleFilterChange);
      els.resultTableWrap.addEventListener('click', (event) => {
        const button = event.target.closest('[data-action="mark"]');
        if (!button) return;
        openDialog(button.dataset.key);
      });
      els.form.addEventListener('submit', (event) => {
        if (event.submitter && event.submitter.value === 'cancel') return;
        event.preventDefault();
        saveDialog();
      });
      els.findingsList.addEventListener('click', handleFindingAction);
    }

    function handleFilterChange(event) {
      const name = event.target.dataset.filterColumn;
      if (!name) return;
      const filter = state.filters[name];
      const card = event.target.closest('.filter-card');
      if (event.target.matches('[data-role="op"]')) filter.op = event.target.value;
      if (event.target.matches('[data-role="dim-value"]')) {
        filter.values = Array.from(card.querySelectorAll('[data-role="dim-value"]:checked')).map((input) => input.value);
        filter.op = filter.values.length ? 'in' : 'all';
      }
      if (event.target.matches('[data-role="min"]')) filter.min = toNumberOrNull(event.target.value);
      if (event.target.matches('[data-role="max"]')) filter.max = toNumberOrNull(event.target.value);
      if (event.target.matches('[data-role="min"],[data-role="max"]')) {
        filter.op = filter.min === null && filter.max === null ? 'all' : 'range';
      }
      persist(false);
      renderResults();
      renderFindings();
    }

    function renderControls() {
      const ds = state.dataset;
      els.datasetStats.textContent = `${ds.rows.length} 行 · ${ds.columns.length} 列 · ${escapeHtml(ds.name)}`;
      els.schemaList.innerHTML = ds.columns.map((column) => `
        <label class="check-item">
          <span>${escapeHtml(column.name)}</span>
          <select data-column="${escapeHtml(column.name)}" aria-label="${escapeHtml(column.name)}字段类型">
            <option value="dimension"${column.kind === 'dimension' ? ' selected' : ''}>维度</option>
            <option value="measure"${column.kind === 'measure' ? ' selected' : ''}>度量</option>
          </select>
        </label>`).join('');

      const dimensions = ds.columns.filter((column) => column.kind === 'dimension');
      els.dimensionPicker.innerHTML = dimensions.map((column) => `
        <label class="check-item">
          <input type="checkbox" value="${escapeHtml(column.name)}"
            ${state.dimensions.includes(column.name) ? 'checked' : ''}>
          <span>${escapeHtml(column.name)}</span>
        </label>`).join('') || '<p class="muted">请至少把一列标记为维度。</p>';

      const measures = ds.columns.filter((column) => column.kind === 'measure');
      els.measureSelect.innerHTML = measures.map((column) =>
        `<option value="${escapeHtml(column.name)}"${column.name === state.measure ? ' selected' : ''}>${escapeHtml(column.name)}</option>`
      ).join('');
      els.measureSelect.disabled = state.aggregation === 'count' || measures.length === 0;
      els.aggregationSelect.value = state.aggregation;
      els.minSampleInput.value = state.minSamples;

      els.filterBuilder.innerHTML = ds.columns.map((column) => {
        const filter = state.filters[column.name];
        if (column.kind === 'measure') {
          return `<div class="filter-card">
            <div class="filter-head"><strong>${escapeHtml(column.name)}</strong>
              <select data-filter-column="${escapeHtml(column.name)}" data-role="op">
                <option value="all"${filter.op === 'all' ? ' selected' : ''}>全部范围</option>
                <option value="range"${filter.op === 'range' ? ' selected' : ''}>限定范围</option>
              </select>
            </div>
            <div class="range-grid">
              <input type="number" step="any" placeholder="最小值" data-filter-column="${escapeHtml(column.name)}" data-role="min"
                value="${filter.min === null || filter.min === undefined ? '' : filter.min}">
              <input type="number" step="any" placeholder="最大值" data-filter-column="${escapeHtml(column.name)}" data-role="max"
                value="${filter.max === null || filter.max === undefined ? '' : filter.max}">
            </div>
          </div>`;
        }
        const values = Array.from(new Set(ds.rows.map((row) => String(row[column.name] ?? '(空)')))).sort((a, b) =>
          a.localeCompare(b, 'zh-Hans-CN'));
        const selected = new Set(filter.values || []);
        const missingValues = (filter.values || []).filter((value) => !values.includes(value));
        const checks = values.map((value) => `
          <label class="check-item value-check">
            <input type="checkbox" value="${escapeHtml(value)}" data-filter-column="${escapeHtml(column.name)}" data-role="dim-value"
              ${selected.has(value) ? 'checked' : ''}>
            <span>${escapeHtml(value)}</span>
          </label>`).join('');
        const missingChecks = missingValues.map((value) => `
          <label class="check-item value-check">
            <input type="checkbox" value="${escapeHtml(value)}" data-filter-column="${escapeHtml(column.name)}" data-role="dim-value" checked>
            <span>${escapeHtml(value)}（当前数据中缺失）</span>
          </label>`).join('');
        return `<div class="filter-card">
          <div class="filter-head"><strong>${escapeHtml(column.name)}</strong>
            <span class="muted">${filter.op === 'in' ? `已选 ${selected.size} 项` : '全部取值'}</span>
          </div>
          <div class="check-list">${missingChecks}${checks}</div>
        </div>`;
      }).join('');
    }

    function formatNumber(value) {
      if (value === null || value === undefined || Number.isNaN(value)) return '—';
      if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString('zh-CN');
      return Number.isInteger(value) ? String(value) : value.toFixed(2);
    }

    function renderResults() {
      const config = currentConfig();
      const result = aggregateRows(
        state.dataset, config.dimensions, config.measure, config.aggregation,
        config.minSamples, config.filters
      );
      state.lastResult = result;
      const lowCount = result.groups.filter((group) => !group.trusted).length;
      els.resultSummary.textContent =
        `${result.filteredCount}/${result.totalRows} 行通过筛选 · ${result.groups.length} 组 · ${lowCount} 组样本不足`;
      if (!config.dimensions.length) {
        els.resultTableWrap.innerHTML = '<p class="muted">请至少选择一个维度；未选维度时无法形成可回看的多维单元格。</p>';
        return;
      }
      if (config.aggregation !== 'count' && !config.measure) {
        els.resultTableWrap.innerHTML = '<p class="muted">请把至少一列标记为度量，或改用“行数计数”。</p>';
        return;
      }
      const metricTitle = config.aggregation === 'count'
        ? '记录数' : `${AGG_LABELS[config.aggregation]}(${config.measure})`;
      const headers = config.dimensions.map((name) => `<th>${escapeHtml(name)}</th>`).join('') +
        `<th class="num">${escapeHtml(metricTitle)}</th><th class="num">样本数</th><th>可信度</th><th>操作</th>`;
      const rows = result.groups.map((group) => `<tr class="${group.trusted ? '' : 'low-confidence'}">
        ${group.values.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}
        <td class="num">${formatNumber(group.value)}</td>
        <td class="num">${group.samples}</td>
        <td><span class="confidence ${group.trusted ? 'ok' : 'low'}">
          ${group.trusted ? '可信' : '样本不足'}</span></td>
        <td><button class="mark-button" data-action="mark" data-key="${escapeHtml(group.key)}">标记发现</button></td>
      </tr>`).join('');
      els.resultTableWrap.innerHTML = `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    }

    function activeFiltersText(filters) {
      const items = Object.values(filters || {}).filter((filter) => filter.op !== 'all');
      if (!items.length) return '<div>筛选：无（全量数据）</div>';
      return items.map((filter) => {
        if (filter.kind === 'measure') {
          return `<div>筛选：${escapeHtml(filter.column)} 在 ${filter.min === null ? '−∞' : filter.min} 至 ${filter.max === null ? '+∞' : filter.max}</div>`;
        }
        return `<div>筛选：${escapeHtml(filter.column)} 属于 ${(filter.values || []).map(escapeHtml).join('、') || '(空)'}</div>`;
      }).join('');
    }

    function contextLines(snapshot) {
      const metric = snapshot.aggregation === 'count'
        ? '记录数' : `${AGG_LABELS[snapshot.aggregation]}(${snapshot.measure})`;
      const dimensions = snapshot.dimensions.length ? snapshot.dimensions.join(' × ') : '(无维度)';
      return `<div>数据：${escapeHtml(snapshot.datasetName)}</div>
        <div>维度：${escapeHtml(dimensions)}</div>
        <div>单元格：${snapshot.cellValues.map(escapeHtml).join(' / ')}</div>
        <div>口径：${escapeHtml(metric)}；最少可信样本 ${snapshot.minSamples}</div>
        <div>结果：${formatNumber(snapshot.value)}；样本 ${snapshot.samples}；${snapshot.trusted ? '当时可信' : '当时样本不足'}</div>
        ${activeFiltersText(snapshot.filters)}`;
    }

    function reaches(records, startId, targetId, trail = []) {
      if (startId === targetId) return true;
      if (trail.includes(startId)) return false;
      const node = records.find((item) => item.id === startId);
      if (!node) return false;
      return node.references.some((id) => reaches(records, id, targetId, trail.concat(startId)));
    }

    function openDialog(cellKeyOrFinding) {
      let finding = null;
      let snapshot = null;
      if (typeof cellKeyOrFinding === 'object') {
        finding = cellKeyOrFinding;
        snapshot = finding.snapshot;
      } else {
        const cell = state.lastResult.groups.find((group) => group.key === cellKeyOrFinding);
        if (!cell) return;
        snapshot = makeSnapshot(state.dataset, currentConfig(), state.lastResult, cell);
      }
      state.draft = { id: finding ? finding.id : null, snapshot };
      els.dialogTitle.textContent = finding ? '编辑发现' : '标记发现';
      els.title.value = finding ? finding.title : '';
      els.note.value = finding ? finding.note : '';
      els.dialogContext.innerHTML = contextLines(snapshot);
      const selected = new Set(finding ? finding.references : []);
      const options = state.findings
        .filter((item) => item.id !== snapshot.id && (!finding || !reaches(state.findings, item.id, finding.id)))
        .map((item) => `<label class="check-item">
          <input type="checkbox" value="${escapeHtml(item.id)}" ${selected.has(item.id) ? 'checked' : ''}>
          <span>${escapeHtml(item.title)}</span>
        </label>`).join('');
      els.referencePicker.innerHTML = options || '<span class="muted">暂无可引用的更早发现。</span>';
      if (typeof els.dialog.showModal === 'function') els.dialog.showModal();
      else els.dialog.setAttribute('open', '');
    }

    function saveDialog() {
      const title = els.title.value.trim();
      if (!title) { showToast('请填写发现标题。'); return; }
      const references = Array.from(els.referencePicker.querySelectorAll('input:checked')).map((input) => input.value);
      const now = new Date().toISOString();
      if (state.draft.id) {
        const finding = state.findings.find((item) => item.id === state.draft.id);
        finding.title = title;
        finding.note = els.note.value.trim();
        finding.references = references;
        finding.updatedAt = now;
      } else {
        state.findings.unshift({
          id: uid('finding'), title, note: els.note.value.trim(),
          snapshot: state.draft.snapshot, references,
          createdAt: now, updatedAt: now
        });
      }
      els.dialog.close();
      persist(true);
      renderAll();
      showToast('发现已保存，条件快照和引用关系一并保留。');
    }

    function deleteFinding(id) {
      const finding = state.findings.find((item) => item.id === id);
      if (!finding || !window.confirm(`删除“${finding.title}”？其他发现对它的引用会作为断链保留。`)) return;
      state.findings = state.findings.filter((item) => item.id !== id);
      state.tombstones = state.tombstones.filter((item) => item.id !== id);
      state.tombstones.unshift({
        id, title: finding.title, note: finding.note, snapshot: finding.snapshot,
        references: finding.references.slice(), deletedAt: new Date().toISOString()
      });
      persist(true);
      renderAll();
      showToast('发现已删除；引用位置和原始引用信息已保留为断链。');
    }

    function restoreSnapshot(snapshot) {
      const dims = snapshot.dimensions.filter((name) =>
        state.dataset.columns.some((column) => column.name === name && column.kind === 'dimension'));
      const measureExists = state.dataset.columns.some((column) => column.name === snapshot.measure && column.kind === 'measure');
      state.dimensions = dims;
      state.aggregation = snapshot.aggregation;
      state.measure = measureExists ? snapshot.measure : state.dataset.columns.find((c) => c.kind === 'measure')?.name || '';
      state.minSamples = snapshot.minSamples;
      state.filters = normalizeFilters(state.dataset, snapshot.filters);
      persist(false);
      renderAll();
      showToast('已按该发现的维度组合、口径和筛选恢复视图。');
    }

    function handleFindingAction(event) {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const id = button.dataset.id;
      const finding = state.findings.find((item) => item.id === id);
      if (button.dataset.action === 'edit' && finding) openDialog(finding);
      if (button.dataset.action === 'delete') deleteFinding(id);
      if (button.dataset.action === 'restore' && finding) restoreSnapshot(finding.snapshot);
    }

    function renderReferenceChain(rootFinding) {
      const nodes = traceUpstream(state.findings, state.tombstones, rootFinding.id);
      if (!nodes.length) return '';
      return `<div class="refs"><div class="ref-line"><strong>引用链：</strong></div>
        ${nodes.map((node) => `<div class="chain" style="margin-left:${Math.min(node.level, 5) * 16}px">
          ${node.cycle ? '↩ ' : '↳ '}${node.ghost ? '⛓ 断链' : '●'}
          ${escapeHtml(node.title)}
          <span class="muted">${node.ghost ? '已删除' : ''} ${escapeHtml(node.id.slice(-6))}</span>
          ${node.snapshot ? `｜${node.snapshot.cellValues.map(escapeHtml).join(' / ')}｜${AGG_LABELS[node.snapshot.aggregation] || node.snapshot.aggregation} ${formatNumber(node.snapshot.value)}` : ''}
        </div>`).join('')}</div>`;
    }

    function renderFinding(finding, validity, dependency) {
      const ownClass = validity.valid ? 'valid' : 'stale';
      const cardClass = validity.valid && dependency.state !== 'ok' ? 'risky' : ownClass;
      const directRefs = finding.references.map((id) => {
        const node = getNode(state.findings, state.tombstones, id);
        const cls = node.ghost ? 'stale' : '';
        return `<span class="badge ${cls}">${node.ghost ? '⛓ 断链 ' : '引用 '}${escapeHtml(node.title)}</span>`;
      }).join('');
      return `<article class="finding-card ${cardClass}">
        <div class="finding-head">
          <div>
            <div class="finding-title">${escapeHtml(finding.title)}</div>
            <div class="muted">${new Date(finding.createdAt).toLocaleString('zh-CN')}</div>
          </div>
        </div>
        <div class="badges">
          <span class="badge ${validity.valid ? 'valid' : 'stale'}">${validity.valid ? '当前有效' : '已失效'}</span>
          ${finding.snapshot.trusted ? '<span class="badge valid">当时可信</span>' : '<span class="badge warn">当时样本不足</span>'}
          ${dependency.state === 'broken' ? '<span class="badge stale">含断链</span>' : ''}
          ${dependency.state === 'risky' ? '<span class="badge warn">上游失效</span>' : ''}
          ${dependency.state === 'cycle' ? '<span class="badge warn">引用成环</span>' : ''}
          ${directRefs}
        </div>
        ${finding.note ? `<p class="finding-note">${escapeHtml(finding.note)}</p>` : ''}
        <div class="context">${contextLines(finding.snapshot)}</div>
        ${!validity.valid ? `<div class="stale-reason">失效原因：${validity.reasons.map(escapeHtml).join('；')}</div>` : ''}
        ${dependency.warnings.length ? `<div class="stale-reason">${dependency.warnings.map(escapeHtml).join('<br>')}</div>` : ''}
        ${renderReferenceChain(finding)}
        <div class="finding-actions">
          <button data-action="restore" data-id="${escapeHtml(finding.id)}">恢复此条件</button>
          <button data-action="edit" data-id="${escapeHtml(finding.id)}">编辑/引用</button>
          <button data-action="delete" data-id="${escapeHtml(finding.id)}">删除并保留断链</button>
        </div>
      </article>`;
    }

    function renderFindings() {
      const validityById = new Map();
      state.findings.forEach((finding) => {
        validityById.set(finding.id, evaluateSnapshot(state.dataset, currentConfig(), finding.snapshot));
      });
      const invalidCount = Array.from(validityById.values()).filter((item) => !item.valid).length;
      const brokenCount = state.findings.filter((finding) =>
        finding.references.some((id) => !state.findings.some((item) => item.id === id))).length;
      els.findingStats.textContent =
        `${state.findings.length} 条 · ${invalidCount} 条已失效 · ${brokenCount} 条含断链`;
      if (!state.findings.length) {
        els.findingsList.innerHTML = '<p class="muted">在聚合结果中点击“标记发现”，即可保存当前条件与结果。</p>';
        return;
      }
      els.findingsList.innerHTML = state.findings.map((finding) => {
        const validity = validityById.get(finding.id);
        const dependency = dependencyState(state.findings, state.tombstones, finding.id, validityById);
        return renderFinding(finding, validity, dependency);
      }).join('');
    }

    function renderAll() {
      renderControls();
      renderResults();
      renderFindings();
    }

    init();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SliceExplorer = api;
})();
