(function () {
  'use strict';

  const STORAGE_KEY = 'local-slice-explorer-findings-v1';
  const AGG_LABELS = { sum: '求和', avg: '平均', min: '最小', max: '最大', count: '计数' };
  const $ = (id) => document.getElementById(id);

  const state = {
    datasetName: '内置示例数据', rows: [], columns: [], types: {}, roles: {},
    filters: {}, selectedDimensions: [], selectedMeasures: [],
    aggregation: 'sum', threshold: 3, fingerprint: '', findings: []
  };

  function uid() {
    return 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function parseCSV(text) {
    const records = [];
    let row = [], field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 1; }
          else quoted = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i += 1;
        row.push(field); records.push(row); row = []; field = '';
      } else { field += ch; }
    }
    if (field !== '' || row.length) { row.push(field); records.push(row); }
    return records.filter((r) => r.some((v) => String(v).trim() !== ''));
  }

  function isNumericValue(value) {
    const v = String(value ?? '').trim();
    return v !== '' && /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v);
  }

  function numberValue(value) {
    const v = parseFloat(String(value ?? '').trim());
    return Number.isFinite(v) ? v : null;
  }

  function hashString(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function defaultFilter(col) {
    return state.types[col] === 'number'
      ? { kind: 'range', min: '', max: '' }
      : { kind: 'set', values: [] };
  }

  function normalizeCell(value, type) {
    if (type === 'number') {
      const n = numberValue(value);
      return n === null ? null : n;
    }
    const text = String(value ?? '').trim();
    return text === '' ? '(空)' : text;
  }

  function loadDataset(name, csvText) {
    const records = parseCSV(csvText.replace(/^\uFEFF/, ''));
    if (records.length < 2) throw new Error('CSV 至少需要表头和一行明细。');
    const columns = records[0].map((h) => String(h).trim()).filter(Boolean);
    if (!columns.length) throw new Error('没有读取到有效字段名。');
    const rows = records.slice(1).map((r) => {
      const item = {};
      columns.forEach((col, i) => { item[col] = r[i] ?? ''; });
      return item;
    });
    const types = {};
    columns.forEach((col) => {
      types[col] = rows.some((r) => !isNumericValue(r[col]) && String(r[col]).trim() !== '')
        ? 'text' : 'number';
    });
    const roles = {};
    columns.forEach((col) => { roles[col] = types[col] === 'number' ? 'measure' : 'dimension'; });
    const textColumns = columns.filter((c) => roles[c] === 'dimension');
    const defaultDimensions = textColumns.slice(0, Math.min(2, textColumns.length));
    Object.assign(state, {
      datasetName: name, rows, columns, types, roles,
      filters: Object.fromEntries(columns.map((c) => [c, defaultFilter(c)])),
      selectedDimensions: defaultDimensions,
      selectedMeasures: columns.filter((c) => roles[c] === 'measure'),
      aggregation: 'sum', threshold: 3,
      fingerprint: hashString(columns.join('|') + '\n' +
        rows.map((r) => columns.map((c) => r[c]).join('␟')).join('␞'))
    });
    $('aggSelect').value = 'sum';
    $('thresholdInput').value = '3';
    renderAll();
  }

  function loadSample() { loadDataset('内置示例数据', window.SAMPLE_CSV); }
  function loadFindings() {
    try { state.findings = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { state.findings = []; }
  }
  function saveFindings() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.findings)); }

  function bindEvents() {
    $('fileInput').addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { loadDataset(file.name, String(reader.result || '')); }
        catch (err) { alert('无法载入 CSV：' + err.message); }
      };
      reader.readAsText(file, 'utf-8');
      event.target.value = '';
    });
    $('sampleBtn').addEventListener('click', loadSample);
    $('aggSelect').addEventListener('change', (e) => { state.aggregation = e.target.value; renderAll(); });
    $('thresholdInput').addEventListener('change', (e) => {
      state.threshold = Math.max(1, parseInt(e.target.value, 10) || 3);
      e.target.value = String(state.threshold);
      renderAll();
    });
    $('resetBtn').addEventListener('click', resetSlice);
    $('findingFilter').addEventListener('change', renderFindings);
    $('showDeleted').addEventListener('change', renderFindings);
    $('clearFindingsBtn').addEventListener('click', () => {
      if (confirm('确定清空全部发现记录？此操作会删除本地保存的引用与快照。')) {
        state.findings = [];
        saveFindings();
        renderAll();
      }
    });
    $('modalBackdrop').addEventListener('click', (e) => {
      if (e.target === $('modalBackdrop')) closeModal();
    });
  }

  function resetSlice() {
    state.selectedDimensions = state.columns.filter((c) => state.roles[c] === 'dimension');
    state.selectedMeasures = state.columns.filter((c) =>
      state.roles[c] === 'measure' && state.types[c] === 'number');
    state.aggregation = 'sum';
    state.threshold = 3;
    state.filters = Object.fromEntries(state.columns.map((c) => [c, defaultFilter(c)]));
    $('aggSelect').value = 'sum';
    $('thresholdInput').value = '3';
    renderAll();
  }

  function renderAll() {
    renderControls();
    renderResults();
    renderFindings();
  }

  function renderControls() {
    $('datasetMeta').textContent = `${state.datasetName} · ${state.rows.length} 行 · ${state.columns.length} 列`;
    renderFieldRoles();
    renderDimensionChoices();
    renderMeasureChoices();
    renderFilters();
  }

  function renderFieldRoles() {
    $('fieldList').innerHTML = state.columns.map((col) => `
      <div class="field-row">
        <span title="${esc(col)}">${esc(col)}
          <span class="hint">（${state.types[col] === 'number' ? '数值' : '文本'}）</span>
        </span>
        <select data-role-field="${esc(col)}">
          <option value="dimension"${state.roles[col] === 'dimension' ? ' selected' : ''}>维度</option>
          ${state.types[col] === 'number' ? `<option value="measure"${state.roles[col] === 'measure' ? ' selected' : ''}>度量</option>` : ''}
          <option value="ignore"${state.roles[col] === 'ignore' ? ' selected' : ''}>忽略</option>
        </select>
      </div>`).join('');
    $('fieldList').querySelectorAll('select[data-role-field]').forEach((select) => {
      select.addEventListener('change', () => changeRole(select.dataset.roleField, select.value));
    });
  }

  function changeRole(col, role) {
    state.roles[col] = role;
    if (role !== 'dimension') state.selectedDimensions = state.selectedDimensions.filter((c) => c !== col);
    else if (!state.selectedDimensions.includes(col)) state.selectedDimensions.push(col);
    if (role !== 'measure') state.selectedMeasures = state.selectedMeasures.filter((c) => c !== col);
    else if (state.types[col] === 'number' && !state.selectedMeasures.includes(col)) state.selectedMeasures.push(col);
    renderAll();
  }

  function renderDimensionChoices() {
    const dims = state.columns.filter((c) => state.roles[c] === 'dimension');
    $('dimensionList').innerHTML = dims.length ? dims.map((col) => `
      <div class="check-row">
        <input type="checkbox" id="dim_${esc(col)}" data-dimension="${esc(col)}"
          ${state.selectedDimensions.includes(col) ? 'checked' : ''}>
        <label for="dim_${esc(col)}">${esc(col)}</label>
      </div>`).join('') : '<p class="hint">暂无可选维度。</p>';
    $('dimensionList').querySelectorAll('[data-dimension]').forEach((box) => {
      box.addEventListener('change', () => {
        state.selectedDimensions = box.checked
          ? [...state.selectedDimensions, box.dataset.dimension]
          : state.selectedDimensions.filter((c) => c !== box.dataset.dimension);
        renderResults();
        renderFindings();
      });
    });
  }

  function renderMeasureChoices() {
    const measures = state.columns.filter((c) => state.roles[c] === 'measure' && state.types[c] === 'number');
    $('measureList').innerHTML = measures.length ? measures.map((col) => `
      <div class="check-row">
        <input type="checkbox" id="mea_${esc(col)}" data-measure="${esc(col)}"
          ${state.selectedMeasures.includes(col) ? 'checked' : ''}>
        <label for="mea_${esc(col)}">${esc(col)}</label>
      </div>`).join('') : '<p class="hint">暂无可选数值度量；计数口径仍可使用。</p>';
    $('measureList').querySelectorAll('[data-measure]').forEach((box) => {
      box.addEventListener('change', () => {
        state.selectedMeasures = box.checked
          ? [...state.selectedMeasures, box.dataset.measure]
          : state.selectedMeasures.filter((c) => c !== box.dataset.measure);
        renderResults();
        renderFindings();
      });
    });
  }

  function uniqueValues(col) {
    const values = state.rows.map((r) => normalizeCell(r[col], state.types[col]));
    return [...new Set(values)].sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));
  }

  function activeFilters() {
    const result = {};
    state.columns.forEach((col) => {
      if (state.roles[col] === 'ignore' || !state.filters[col]) return;
      const f = state.filters[col];
      if (f.kind === 'set' && f.values.length) {
        result[col] = { kind: 'set', values: [...f.values].sort() };
      } else if (f.kind === 'range' && (f.min !== '' || f.max !== '')) {
        result[col] = {
          kind: 'range',
          min: f.min === '' ? null : numberValue(f.min),
          max: f.max === '' ? null : numberValue(f.max)
        };
      }
    });
    return result;
  }

  function renderFilters() {
    const fields = state.columns.filter((c) => state.roles[c] !== 'ignore');
    $('filterList').innerHTML = fields.map((col) => {
      const filter = state.filters[col] || defaultFilter(col);
      if (state.types[col] === 'text') {
        return `<div class="filter-card"><strong>${esc(col)}</strong><div class="chip-grid">
          ${uniqueValues(col).map((v) => `
            <button type="button" class="chip ${filter.values?.includes(v) ? 'active' : ''}"
              data-filter-set="${esc(col)}" data-value="${esc(v)}">${esc(v)}</button>`).join('')}
        </div></div>`;
      }
      return `<div class="filter-card"><strong>${esc(col)}</strong>
        <div class="range-grid">
          <label>最小值<input type="number" step="any" data-filter-min="${esc(col)}" value="${esc(filter.min ?? '')}"></label>
          <label>最大值<input type="number" step="any" data-filter-max="${esc(col)}" value="${esc(filter.max ?? '')}"></label>
        </div></div>`;
    }).join('') || '<p class="hint">没有可筛选字段。</p>';

    $('filterList').querySelectorAll('[data-filter-set]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const col = btn.dataset.filterSet;
        const f = state.filters[col] || { kind: 'set', values: [] };
        f.values = f.values.includes(btn.dataset.value)
          ? f.values.filter((v) => v !== btn.dataset.value)
          : [...f.values, btn.dataset.value];
        renderAll();
      });
    });
    ['min', 'max'].forEach((edge) => {
      $('filterList').querySelectorAll(`[data-filter-${edge}]`).forEach((input) => {
        input.addEventListener('change', () => {
          const col = input.dataset[`filter${edge[0].toUpperCase()}${edge.slice(1)}`];
          state.filters[col] = { kind: 'range', ...(state.filters[col] || {}), [edge]: input.value };
          renderAll();
        });
      });
    });
  }

  function rowPassesFilters(row, filters) {
    return Object.entries(filters).every(([col, f]) => {
      const value = normalizeCell(row[col], state.types[col]);
      if (f.kind === 'set') return f.values.includes(value);
      if (value === null) return false;
      return (f.min === null || value >= f.min) && (f.max === null || value <= f.max);
    });
  }

  function metricDefinitions() {
    if (state.aggregation === 'count') {
      return [{ field: '__count', label: '记录数' }];
    }
    return state.selectedMeasures.map((field) => ({ field, label: field }));
  }

  function aggregateRows() {
    const filters = activeFilters();
    const dims = state.selectedDimensions;
    const groups = new Map();
    state.rows.forEach((row) => {
      if (!rowPassesFilters(row, filters)) return;
      const key = dims.map((col) => normalizeCell(row[col], state.types[col]));
      const id = JSON.stringify(key);
      if (!groups.has(id)) groups.set(id, { key, rows: [] });
      groups.get(id).rows.push(row);
    });
    const metrics = metricDefinitions();
    return [...groups.values()].map((group) => {
      const cells = {};
      metrics.forEach((metric) => {
        let value = group.rows.length;
        if (metric.field !== '__count' && state.aggregation !== 'count') {
          const nums = group.rows
            .map((r) => numberValue(r[metric.field]))
            .filter((n) => n !== null);
          if (state.aggregation === 'sum') value = nums.reduce((a, b) => a + b, 0);
          if (state.aggregation === 'avg') value = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
          if (state.aggregation === 'min') value = nums.length ? Math.min(...nums) : null;
          if (state.aggregation === 'max') value = nums.length ? Math.max(...nums) : null;
        }
        cells[metric.field] = {
          value,
          support: group.rows.length,
          lowSupport: group.rows.length < state.threshold
        };
      });
      return { key: group.key, rows: group.rows, cells };
    }).sort((a, b) => JSON.stringify(a.key).localeCompare(JSON.stringify(b.key), 'zh-CN'));
  }

  function formatNumber(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
  }

  function makeSnapshot(row, metric) {
    const cell = row.cells[metric.field];
    return {
      datasetFingerprint: state.fingerprint,
      datasetName: state.datasetName,
      dimensions: [...state.selectedDimensions],
      dimensionValues: row.key.map((v) => (v === null ? null : String(v))),
      aggregation: state.aggregation,
      measure: metric.field,
      measureLabel: metric.label,
      filters: activeFilters(),
      threshold: state.threshold,
      value: cell.value,
      support: cell.support,
      lowSupport: cell.lowSupport
    };
  }

  function renderResults() {
    const dims = state.selectedDimensions;
    const metrics = metricDefinitions();
    const rows = aggregateRows();
    $('querySummary').textContent =
      `维度：${dims.length ? dims.join(' / ') : '整体'} · 口径：${AGG_LABELS[state.aggregation]} · 命中明细 ${state.rows.filter((r) => rowPassesFilters(r, activeFilters())).length} 行`;
    if (!metrics.length) {
      $('resultWrap').innerHTML = '<div class="empty">请选择至少一个数值度量，或将聚合方式切换为“计数”。</div>';
      $('invalidBanner').classList.add('hidden');
      return;
    }
    const table = `<table>
      <thead><tr>
        <th>${dims.length ? esc(dims.join(' / ')) : '切片'}</th>
        ${metrics.map((m) => `<th>${esc(AGG_LABELS[state.aggregation] + ' · ' + m.label)}</th>`).join('')}
      </tr></thead>
      <tbody>${rows.map((row) => {
        const dimText = row.key.length ? row.key.map(esc).join(' / ') : '整体';
        const anyLow = metrics.some((m) => row.cells[m.field].lowSupport);
        return `<tr class="${anyLow ? 'low' : ''}">
          <td>${dimText}</td>
          ${metrics.map((m) => {
            const cell = row.cells[m.field];
            return `<td class="metric-cell">
              <span class="cell-main">${formatNumber(cell.value)}</span>
              <span class="cell-meta">${cell.lowSupport ? '不可信 · ' : ''}n=${cell.support}</span>
              <button type="button" class="cell-mark" data-action="mark"
                data-key="${esc(JSON.stringify(row.key))}" data-measure="${esc(m.field)}">标记为发现</button>
            </td>`;
          }).join('')}
        </tr>`;
      }).join('')}</tbody></table>`;
    $('resultWrap').innerHTML = rows.length ? table : '<div class="empty">当前筛选条件下没有数据。</div>';
    $('resultWrap').querySelectorAll('[data-action="mark"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = JSON.parse(btn.dataset.key);
        const row = rows.find((r) => JSON.stringify(r.key) === JSON.stringify(key));
        const metric = metrics.find((m) => m.field === btn.dataset.measure);
        openMarkModal(row, metric);
      });
    });
    renderInvalidBanner();
  }

  function arraysEqual(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  function sameFilters(a, b) {
    const keysA = Object.keys(a || {}).sort();
    const keysB = Object.keys(b || {}).sort();
    if (!arraysEqual(keysA, keysB)) return false;
    return keysA.every((key) => {
      const x = a[key], y = b[key];
      if (x.kind !== y.kind) return false;
      if (x.kind === 'set') return arraysEqual(x.values, y.values);
      return x.min === y.min && x.max === y.max;
    });
  }

  function findCurrentCell(snapshot) {
    const rows = aggregateRows();
    const expectedKey = state.selectedDimensions.map((col) =>
      snapshot.dimensionValues[snapshot.dimensions.indexOf(col)]);
    return rows.find((r) => arraysEqual(
      r.key.map((v) => (v === null ? null : String(v))),
      expectedKey.map((v) => (v === null ? null : String(v)))
    ));
  }

  function evaluateFinding(finding, trail = []) {
    const reasons = [];
    let status = 'active';
    if (finding.deleted) return { status: 'deleted', reasons: ['记录已删除'] };
    if (trail.includes(finding.id)) return { status: 'active', reasons: [] };
    const s = finding.snapshot || {};
    if (s.datasetFingerprint !== state.fingerprint) {
      return { status: 'invalid', reasons:['当前数据集与记录快照不一致'] };
    }
    if (s.aggregation !== state.aggregation) reasons.push(`聚合口径从 ${AGG_LABELS[s.aggregation] || s.aggregation} 改为 ${AGG_LABELS[state.aggregation]}`);
    if (!arraysEqual([...s.dimensions].sort(), [...state.selectedDimensions].sort())) reasons.push('维度组合已变化');
    if (state.aggregation !== 'count' && !state.selectedMeasures.includes(s.measure)) reasons.push('原度量未参与当前切片');
    if (!sameFilters(s.filters, activeFilters())) reasons.push('筛选范围已变化');

    if (reasons.length) status = 'stale';
    const cell = findCurrentCell(s);
    if (!cell) {
      return { status: 'invalid', reasons: [...reasons, '原切片在当前条件下不存在'] };
    }
    const current = cell.cells[s.measure];
    if (!current) return { status: 'invalid', reasons: [...reasons, '原度量在当前口径中不存在'] };
    if (Math.abs((current.value || 0) - (s.value || 0)) > 1e-8) {
      reasons.push(`当前值 ${formatNumber(current.value)} 与记录值 ${formatNumber(s.value)} 不一致`);
      status = 'invalid';
    }
    if (s.threshold !== state.threshold) {
      reasons.push(`可信度阈值已从 ${s.threshold} 改为 ${state.threshold}`);
      status = 'stale';
    }
    const broken = brokenRefs(finding, trail).length > 0;
    return { status: broken ? 'broken' : status, reasons };
  }

  function brokenRefs(finding, trail = []) {
    return (finding.references || []).filter((ref) => {
      const target = state.findings.find((f) => f.id === ref.id);
      if (!target || target.deleted) return true;
      if (trail.includes(target.id)) return false;
      const targetStatus = evaluateFinding(target, [...trail, finding.id]).status;
      return targetStatus === 'invalid' || targetStatus === 'broken';
    });
  }

  function renderInvalidBanner() {
    const affected = state.findings
      .filter((f) => !f.deleted)
      .map((f) => ({ finding: f, result: evaluateFinding(f, [f.id]) }))
      .filter((x) => ['invalid', 'broken', 'stale'].includes(x.result.status));
    const banner = $('invalidBanner');
    if (!affected.length) {
      banner.className = 'banner hidden';
      banner.textContent = '';
      return;
    }
    banner.className = 'banner warn';
    banner.innerHTML = `当前条件导致 ${affected.length} 条发现需要回看：` +
      affected.slice(0, 5).map((x) => `「${esc(x.finding.title)}」${x.result.status === 'broken' ? '存在断链' : x.result.status === 'stale' ? '条件已变更' : '已失效'}`).join('；') +
      (affected.length > 5 ? ' 等' : '');
  }

  function closeModal() {
    $('modalBackdrop').classList.add('hidden');
    $('modal').innerHTML = '';
  }

  function describeFilterValue(filter) {
    if (filter.kind === 'set') return filter.values.join(', ');
    const left = filter.min === null || filter.min === undefined ? '不限' : `≥${filter.min}`;
    const right = filter.max === null || filter.max === undefined ? '不限' : `≤${filter.max}`;
    return `${left} / ${right}`;
  }

  function describeFilters(filters) {
    const keys = Object.keys(filters || {});
    if (!keys.length) return '无';
    return keys.map((key) => `${key}=${describeFilterValue(filters[key])}`).join('；');
  }

  function openMarkModal(row, metric) {
    const snapshot = makeSnapshot(row, metric);
    const candidates = state.findings.filter((f) => !f.deleted);
    $('modal').innerHTML = `
      <h2>标记发现</h2>
      <div class="form-grid">
        <label>发现标题
          <input id="findingTitle" value="${esc(snapshot.dimensionValues.join(' / ') || '整体')}：${esc(snapshot.measureLabel)} = ${formatNumber(snapshot.value)}">
        </label>
        <label>备注
          <textarea id="findingNote" rows="3" placeholder="记录你的判断、假设或下一步推演"></textarea>
        </label>
        <div>
          <strong>将随发现保存的切片快照</strong>
          <div class="kv">维度：${esc(snapshot.dimensions.join(' / ') || '整体')}；取值：${esc(snapshot.dimensionValues.join(' / ') || '整体')}</div>
          <div class="kv">口径：${esc(AGG_LABELS[snapshot.aggregation])} · ${esc(snapshot.measureLabel)}；值：${formatNumber(snapshot.value)}；样本数：${snapshot.support}</div>
          <div class="kv">筛选：${esc(describeFilters(snapshot.filters))}；低样本阈值：${snapshot.threshold}</div>
          ${snapshot.lowSupport ? '<div class="banner warn">该单元格样本数不足，保存后会保留“不可信”标记。</div>' : ''}
        </div>
        <div>
          <strong>引用更早的发现</strong>
          ${candidates.length ? candidates.map((f) => `
            <div class="finding-ref-row">
              <input type="checkbox" id="ref_${f.id}" data-ref-id="${f.id}" data-ref-title="${esc(f.title)}">
              <label for="ref_${f.id}">${esc(f.title)}</label>
            </div>`).join('') : '<p class="hint">还没有可引用的发现。</p>'}
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="secondary" id="cancelMarkBtn">取消</button>
        <button type="button" id="saveMarkBtn">保存发现</button>
      </div>`;
    $('modalBackdrop').classList.remove('hidden');
    $('cancelMarkBtn').addEventListener('click', closeModal);
    $('saveMarkBtn').addEventListener('click', () => {
      const title = $('findingTitle').value.trim();
      if (!title) { alert('请填写发现标题。'); return; }
      const references = [...$('modal').querySelectorAll('[data-ref-id]:checked')].map((box) => ({
        id: box.dataset.refId,
        title: box.dataset.refTitle
      }));
      state.findings.unshift({
        id: uid(),
        title,
        note: $('findingNote').value.trim(),
        createdAt: new Date().toISOString(),
        references,
        snapshot
      });
      saveFindings();
      closeModal();
      renderResults();
      renderFindings();
    });
  }

  const STATUS_META = {
    active: { label: '可复现', cls: 'active' },
    stale: { label: '条件已变更', cls: 'stale' },
    invalid: { label: '已失效', cls: 'invalid' },
    broken: { label: '引用断链', cls: 'broken' },
    deleted: { label: '已删除', cls: 'invalid' }
  };

  function formatDate(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false });
  }

  function snapshotSummary(s) {
    return `维度：${esc(s.dimensions.join(' / ') || '整体')} = ${esc(s.dimensionValues.join(' / ') || '整体')}<br>` +
      `口径：${esc(AGG_LABELS[s.aggregation] || s.aggregation)} · ${esc(s.measureLabel)} = ${formatNumber(s.value)}，n=${s.support}` +
      (s.lowSupport ? '（当时已不可信）' : '') +
      `<br>筛选：${esc(describeFilters(s.filters))} · 阈值 ${s.threshold}`;
  }

  function renderFindings() {
    if (!state.rows.length) return;
    const mode = $('findingFilter').value;
    const showDeleted = $('showDeleted').checked;
    const evaluated = state.findings.map((f) => ({ f, x: evaluateFinding(f) }));
    const visible = evaluated.filter(({ f, x }) => {
      if (f.deleted && !showDeleted) return false;
      if (mode === 'active') return x.status === 'active';
      if (mode === 'invalid') return x.status === 'invalid' || x.status === 'stale';
      if (mode === 'broken') return x.status === 'broken';
      return true;
    });
    const counts = {
      active: evaluated.filter((x) => !x.f.deleted && x.x.status === 'active').length,
      invalid: evaluated.filter((x) => !x.f.deleted && (x.x.status === 'invalid' || x.x.status === 'stale')).length,
      broken: evaluated.filter((x) => !x.f.deleted && x.x.status === 'broken').length
    };
    $('findingSummary').textContent =
      `${counts.active} 条可复现 · ${counts.invalid} 条条件变化/失效 · ${counts.broken} 条断链`;
    $('findingsList').innerHTML = visible.length ? visible.map(({ f, x }) => {
      const meta = STATUS_META[f.deleted ? 'deleted' : x.status] || STATUS_META.active;
      const refs = (f.references || []).map((ref) => {
        const target = state.findings.find((item) => item.id === ref.id);
        const broken = !target || target.deleted;
        return `<div class="ref-line ${broken ? 'ref-broken' : ''}">${broken ? '⛓ 断链' : '↳ 引用'}：${esc(ref.title || '未命名发现')} <span>(${esc(ref.id)})</span></div>`;
      }).join('');
      return `<article class="finding-card ${f.deleted ? 'deleted' : meta.cls}">
        <div class="finding-title"><strong>${esc(f.title)}</strong><span class="pill ${meta.cls}">${meta.label}</span></div>
        ${f.note ? `<div class="finding-body">${esc(f.note)}</div>` : ''}
        <div class="kv">${snapshotSummary(f.snapshot)}</div>
        ${x.reasons.length ? `<div class="kv"><strong>状态说明：</strong>${x.reasons.map(esc).join('；')}</div>` : ''}
        ${refs ? `<div class="refs">${refs}</div>` : ''}
        <div class="kv">创建于 ${formatDate(f.createdAt)}</div>
        <div class="finding-actions">
          <button type="button" data-finding-action="chain" data-id="${f.id}">查看引用链</button>
          ${!f.deleted ? `<button type="button" data-finding-action="restore" data-id="${f.id}">恢复到记录条件</button>
            <button type="button" class="danger" data-finding-action="delete" data-id="${f.id}">删除</button>`
            : `<button type="button" data-finding-action="undelete" data-id="${f.id}">撤销删除</button>
               <button type="button" class="danger" data-finding-action="purge" data-id="${f.id}">永久移除</button>`}
        </div>
      </article>`;
    }).join('') : '<div class="empty">还没有符合条件的发现。点击结果单元格旁的“标记为发现”。</div>';

    $('findingsList').querySelectorAll('[data-finding-action]').forEach((btn) => {
      btn.addEventListener('click', () => findingAction(btn.dataset.findingAction, btn.dataset.id));
    });
    renderInvalidBanner();
  }

  function findingAction(action, id) {
    const finding = state.findings.find((f) => f.id === id);
    if (!finding && action !== 'chain') return;
    if (action === 'delete' && finding) {
      finding.deleted = true;
      saveFindings();
      renderResults();
      renderFindings();
    } else if (action === 'undelete' && finding) {
      finding.deleted = false;
      saveFindings();
      renderResults();
      renderFindings();
    } else if (action === 'purge' && finding) {
      if (!confirm('永久移除后，引用它的记录仍会保留原始引用信息并显示断链。继续？')) return;
      state.findings = state.findings.filter((f) => f.id !== id);
      saveFindings();
      renderResults();
      renderFindings();
    } else if (action === 'restore' && finding) {
      restoreSnapshot(finding.snapshot);
    } else if (action === 'chain' && finding) {
      openChainModal(finding);
    }
  }

  function restoreSnapshot(snapshot) {
    if (!snapshot || snapshot.datasetFingerprint !== state.fingerprint) {
      alert('该发现来自其他数据集，无法在当前数据中恢复原条件。');
      return;
    }
    snapshot.dimensions.forEach((col) => { if (state.columns.includes(col)) state.roles[col] = 'dimension'; });
    Object.keys(snapshot.filters || {}).forEach((col) => {
      if (!state.columns.includes(col)) return;
      state.roles[col] = state.types[col] === 'text' ? 'dimension' : 'measure';
    });
    if (snapshot.measure !== '__count' && state.columns.includes(snapshot.measure)) {
      state.roles[snapshot.measure] = 'measure';
    }
    state.selectedDimensions = [...snapshot.dimensions];
    state.selectedMeasures = snapshot.measure === '__count' ? [] : [snapshot.measure];
    state.aggregation = snapshot.aggregation;
    state.threshold = snapshot.threshold;
    state.filters = Object.fromEntries(state.columns.map((c) => [c, defaultFilter(c)]));
    Object.entries(snapshot.filters || {}).forEach(([col, f]) => {
      if (f.kind === 'set') state.filters[col] = { kind: 'set', values: [...f.values] };
      else state.filters[col] = {
        kind: 'range',
        min: f.min === null || f.min === undefined ? '' : String(f.min),
        max: f.max === null || f.max === undefined ? '' : String(f.max)
      };
    });
    $('aggSelect').value = state.aggregation;
    $('thresholdInput').value = String(state.threshold);
    renderAll();
  }

  function chainNode(findingId, refInfo, trail) {
    const target = state.findings.find((f) => f.id === findingId);
    const cyclic = trail.includes(findingId);
    const broken = !target || target.deleted;
    if (cyclic) {
      return `<div class="chain-node broken"><strong>循环引用：</strong>${esc(refInfo?.title || findingId)}
        <div class="kv">系统已在此处停止展开，避免引用链无限循环。</div></div>`;
    }
    if (!target) {
      return `<div class="chain-node broken"><strong>断链：${esc(refInfo?.title || '记录已不存在')}</strong>
        <div class="kv">原引用 ID：${esc(findingId)}</div>
        <div class="kv">该发现已被永久移除；引用位置与原标题已保留。</div></div>`;
    }
    const meta = STATUS_META[target.deleted ? 'deleted' : evaluateFinding(target).status];
    const nextTrail = [...trail, target.id];
    return `<div class="chain-node ${broken ? 'broken' : ''}">
      <strong>${broken ? '⛓ 断链位置 → ' : ''}${esc(target.title)}</strong> <span class="pill ${meta.cls}">${meta.label}</span>
      <div class="kv">${snapshotSummary(target.snapshot)}</div>
      ${target.note ? `<div class="kv">备注：${esc(target.note)}</div>` : ''}
      ${(target.references || []).map((ref) => chainNode(ref.id, ref, nextTrail)).join('')}
    </div>`;
  }

  function openChainModal(finding) {
    $('modal').innerHTML = `
      <h2>引用链：${esc(finding.title)}</h2>
      <p class="hint">下方按依赖方向展开；越靠内的节点是越早的发现。</p>
      <div class="chain-node">
        <strong>${esc(finding.title)}</strong>
        <div class="kv">${snapshotSummary(finding.snapshot)}</div>
        ${(finding.references || []).map((ref) => chainNode(ref.id, ref, [finding.id])).join('') ||
          '<div class="kv">该发现没有引用更早记录。</div>'}
      </div>
      <div class="modal-actions"><button type="button" id="closeChainBtn">关闭</button></div>`;
    $('modalBackdrop').classList.remove('hidden');
    $('closeChainBtn').addEventListener('click', closeModal);
  }

  loadFindings();
  bindEvents();
  loadSample();
})();
