(function () {
  'use strict';

  const engine = window.AssetWorkbench;
  const STORAGE_KEY = 'asset-workbench-v1';

  const seedAssets = [
    {
      id: 'asset-demo-a',
      name: '数控加工中心',
      initialCost: 1000000,
      startYear: 2025,
      lifeYears: 8,
      residualRate: 0.1,
      adjustments: [
        { id: 'adj-a-1', lifeYear: 2, amount: -100000, note: '产能改造后减值', revoked: false }
      ]
    },
    {
      id: 'asset-demo-b',
      name: '厂区电力设备',
      initialCost: 600000,
      startYear: 2026,
      lifeYears: 5,
      residualRate: 0.05,
      adjustments: []
    },
    {
      id: 'asset-demo-c',
      name: '检测仪器组',
      initialCost: 300000,
      startYear: 2024,
      lifeYears: 6,
      residualRate: 0,
      adjustments: [
        { id: 'adj-c-1', lifeYear: 3, amount: 40000, note: '校准与功能升级', revoked: false }
      ]
    }
  ];

  let state = loadState();
  let selectedId = state.assets[0] ? state.assets[0].id : null;

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (s) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && Array.isArray(saved.assets)) return saved;
    } catch (error) {
      console.warn('未能读取本地数据，已载入示例数据。', error);
    }
    return { warningRatio: 0.3, assets: seedAssets };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn('数据无法保存到浏览器本地存储。', error);
    }
  }

  function getSelected() {
    return state.assets.find((asset) => asset.id === selectedId) || null;
  }

  function parseNumber(raw) {
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function parseInteger(raw) {
    const value = Number(raw);
    return Number.isInteger(value) ? value : null;
  }

  function money(value) {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      maximumFractionDigits: 0
    }).format(value || 0);
  }

  function signedMoney(value) {
    const text = money(Math.abs(value));
    return value > 0 ? `+${text}` : value < 0 ? `-${text}` : '¥0';
  }

  function percent(value) {
    return `${(value * 100).toFixed(1)}%`;
  }

  function render() {
    saveState();
    const analysis = engine.calculateAll(state.assets, { warningRatio: state.warningRatio });
    renderIssues(analysis);
    renderMetrics(analysis);
    renderAssetList(analysis);
    renderOverview(analysis);
    renderDetail(analysis);
  }

  function renderIssues(analysis) {
    const panel = $('issuePanel');
    const settingItems = analysis.settingsWarnings.map((item) => `<li>全局设置：${esc(item.message)}</li>`);
    const assetItems = analysis.invalidResults.map((result) =>
      result.errors.map((error) => `<li><strong>${esc(result.name)}</strong>：${esc(error.message)}</li>`).join(''));
    const items = settingItems.concat(assetItems).join('');
    panel.classList.toggle('hidden', !items);
    panel.innerHTML = items
      ? `<h3>以下问题需要修正，涉及资产暂不纳入汇总</h3><ul>${items}</ul>`
      : '';
  }

  function renderMetrics(analysis) {
    const warningAssets = new Set();
    analysis.validResults.forEach((result) => {
      if (result.warningCount > 0) warningAssets.add(result.id);
    });
    $('validCount').textContent = analysis.validAssetCount;
    $('invalidCount').textContent = analysis.excludedAssetCount;
    $('warningAssetCount').textContent = warningAssets.size;
    const latest = analysis.years[analysis.years.length - 1];
    $('latestTotal').textContent = latest ? money(latest.totalBookValue) : '—';
  }

  function statusBadge(result) {
    if (!result) return '<span class="badge invalid">无结果</span>';
    if (!result.valid) return '<span class="badge invalid">已排除</span>';
    return result.warningCount > 0
      ? '<span class="badge warning">触发警戒</span>'
      : '<span class="badge ok">正常</span>';
  }

  function renderAssetList(analysis) {
    const resultMap = new Map(analysis.results.map((item) => [item.id, item]));
    $('assetList').innerHTML = state.assets.map((asset) => {
      const result = resultMap.get(asset.id);
      const selected = asset.id === selectedId ? 'selected' : '';
      const invalid = result && !result.valid ? 'invalid' : '';
      const meta = result && result.valid
        ? `${asset.startYear} 启用 · ${asset.lifeYears} 年 · ${percent(asset.residualRate)} 残值率`
        : result
          ? result.errors.map((error) => esc(error.message)).join('；')
          : '等待计算';
      return `
        <button class="asset-card ${selected} ${invalid}" type="button" data-select-asset="${esc(asset.id)}">
          <div class="asset-card-header">
            <span>${esc(asset.name || '未命名资产')}</span>
            ${statusBadge(result)}
          </div>
          <div class="asset-card-meta">${meta}</div>
        </button>`;
    }).join('');
  }

  function renderOverview(analysis) {
    renderOverviewChart(analysis);
    const resultMap = new Map(analysis.results.map((item) => [item.id, item]));
    const rows = state.assets.map((asset) => {
      const result = resultMap.get(asset.id);
      const lastRow = result && result.valid ? result.rows[result.rows.length - 1] : null;
      return `
        <tr class="asset-row ${asset.id === selectedId ? 'selected' : ''}" data-select-asset="${esc(asset.id)}">
          <td>${esc(asset.name || '未命名资产')}</td>
          <td>${result && result.valid ? asset.startYear : '—'}</td>
          <td>${result && result.valid ? `${asset.lifeYears} 年` : '—'}</td>
          <td class="num">${result && result.valid ? money(asset.initialCost) : '—'}</td>
          <td class="num">${result && result.valid ? money(result.salvage) : '—'}</td>
          <td class="num">${lastRow ? money(lastRow.closing) : '不纳入汇总'}</td>
          <td>${result && result.valid && result.firstWarningYear ? result.firstWarningYear : '无'}</td>
          <td>${statusBadge(result)}</td>
        </tr>`;
    }).join('');
    document.querySelector('#overviewTable tbody').innerHTML = rows;
  }

  function renderOverviewChart(analysis) {
    const width = 1120, height = 330;
    const margin = { top: 30, right: 28, bottom: 42, left: 78 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const target = $('overviewChart');
    if (analysis.years.length === 0) {
      target.innerHTML = '<div class="empty-detail"><p>暂无有效资产可绘制。修正资产问题后将自动生成轨迹。</p></div>';
      return;
    }
    const minYear = analysis.years[0].calendarYear;
    const maxYear = analysis.years[analysis.years.length - 1].calendarYear;
    const maxValue = Math.max(
      ...analysis.validResults.map((item) => item.rows[0] ? item.rows[0].adjustedOpening : 0),
      ...analysis.years.map((item) => item.totalBookValue)
    ) * 1.08;
    const x = (year) => margin.left + ((year - minYear) / Math.max(1, maxYear - minYear)) * innerWidth;
    const y = (value) => margin.top + innerHeight - (value / maxValue) * innerHeight;
    const areaPoints = analysis.years.map((item) => `${x(item.calendarYear)},${y(item.totalBookValue)}`).join(' ');
    const areaPath = `${x(minYear)},${y(0)} ${areaPoints} ${x(maxYear)},${y(0)}`;
    const grid = [0, .25, .5, .75, 1].map((ratio) => {
      const value = maxValue * ratio;
      return `<line x1="${margin.left}" x2="${width - margin.right}" y1="${y(value)}" y2="${y(value)}" stroke="#e5eaf2"/>
              <text x="${margin.left - 10}" y="${y(value) + 4}" text-anchor="end">${Math.round(value / 10000)}万</text>`;
    }).join('');
    const yearLabels = analysis.years.map((item) =>
      `<text x="${x(item.calendarYear)}" y="${height - 14}" text-anchor="middle">${item.calendarYear}</text>`).join('');
    const colors = ['#2563eb', '#0f766e', '#9333ea', '#ea580c', '#be123c', '#0891b2', '#4d7c0f'];
    const assetLines = analysis.validResults.map((result, index) => {
      const asset = state.assets.find((item) => item.id === result.id);
      const points = [];
      for (let year = asset.startYear; year <= result.endYear; year += 1) {
        const row = result.rows.find((item) => item.calendarYear === year);
        if (row) points.push(`${x(year)},${y(row.closing)}`);
      }
      const stroke = colors[index % colors.length];
      const thresholdLine = `<line x1="${x(asset.startYear)}" x2="${x(result.endYear)}" y1="${y(result.threshold)}" y2="${y(result.threshold)}" stroke="#9ca3af" stroke-dasharray="5 4" opacity="0.7"/>`;
      const dots = result.rows.filter((row) => row.warning).map((row) =>
        `<circle cx="${x(row.calendarYear)}" cy="${y(row.closing)}" r="4.5" fill="#f59e0b" stroke="#fff" stroke-width="2"/>`).join('');
      return `${thresholdLine}<polyline points="${points.join(' ')}" fill="none" stroke="${stroke}" stroke-width="2.4"/>
              <title>${esc(result.name)}</title>${dots}`;
    }).join('');
    target.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="资产价值轨迹概览">
        <polygon points="${areaPath}" fill="#2563eb" opacity="0.08"/>
        ${grid}${yearLabels}${assetLines}
        <text x="${margin.left}" y="16">彩色线：单项资产年末账面价值　橙色点：触发警戒　蓝色面积：汇总账面价值</text>
      </svg>`;
  }

  function renderDetail(analysis) {
    const asset = getSelected();
    const empty = $('emptyDetail');
    const detail = $('assetDetail');
    if (!asset) {
      empty.classList.remove('hidden');
      detail.classList.add('hidden');
      return;
    }
    empty.classList.add('hidden');
    detail.classList.remove('hidden');
    const result = analysis.results.find((item) => item.id === asset.id);
    detail.innerHTML = `
      <div class="detail-title">
        <h2>${esc(asset.name || '未命名资产')} ${statusBadge(result)}</h2>
        <div class="detail-actions">
          <button class="button" type="button" data-action="duplicate">复制</button>
          <button class="button danger" type="button" data-action="remove">删除</button>
        </div>
      </div>
      ${renderAssetForm(asset, result)}
      ${renderAdjustmentSection(asset, result)}
      ${result && result.valid ? renderAssetResult(result) : '<div class="inline-issues"><strong>该资产当前未纳入汇总</strong></div>'}
    `;
    if (result && result.valid) renderDetailChart(result);
  }

  function renderAssetForm(asset) {
    return `
      <div class="form-grid">
        <div class="field">
          <label for="fieldName">资产名称</label>
          <input id="fieldName" data-field="name" value="${esc(asset.name || '')}" placeholder="例如：生产线 A">
        </div>
        <div class="field">
          <label for="fieldCost">初始投入（元）</label>
          <input id="fieldCost" data-field="initialCost" type="number" min="0" step="1000" value="${esc(asset.initialCost)}">
        </div>
        <div class="field">
          <label for="fieldStart">启用时间（年份）</label>
          <input id="fieldStart" data-field="startYear" type="number" step="1" value="${esc(asset.startYear)}">
        </div>
        <div class="field">
          <label for="fieldLife">预计使用年限</label>
          <input id="fieldLife" data-field="lifeYears" type="number" min="1" max="100" step="1" value="${esc(asset.lifeYears)}">
        </div>
        <div class="field">
          <label for="fieldResidual">残值率（%）</label>
          <input id="fieldResidual" data-field="residualRate" type="number" min="0" max="100" step="1" value="${esc(Math.round((asset.residualRate || 0) * 100))}">
        </div>
      </div>`;
  }

  function renderAdjustmentSection(asset, result) {
    const issues = result && !result.valid
      ? `<ul>${result.errors.map((item) => `<li>${esc(item.message)}</li>`).join('')}</ul>`
      : '';
    const maxYear = Number.isSafeInteger(asset.lifeYears) ? asset.lifeYears : 0;
    const records = (asset.adjustments || []).map((item) => `
      <tr class="${item.revoked ? 'is-revoked' : ''}">
        <td>第 ${esc(item.lifeYear)} 年${Number.isSafeInteger(asset.startYear) ? `（${esc(asset.startYear + item.lifeYear - 1)} 年）` : ''}</td>
        <td class="num ${item.amount >= 0 ? 'positive' : 'negative'}">${signedMoney(item.amount)}</td>
        <td>${esc(item.note || '—')}</td>
        <td>${item.revoked ? '已撤销' : '已确认'}</td>
        <td><button class="button small" type="button" data-toggle-adjustment="${esc(item.id)}">${item.revoked ? '恢复确认' : '撤销'}</button></td>
      </tr>`).join('');
    return `
      ${issues ? `<div class="inline-issues"><strong>问题清单</strong>${issues}</div>` : ''}
      <div class="adjustment-box">
        <h2>年度价值调整</h2>
        <p class="hint">调整在所选使用年度的年初生效；正数为追加投入/增值，负数为减值。撤销只改变该调整，不影响其他已确认年份。</p>
        <div class="adjustment-form">
          <div class="field">
            <label for="adjYear">使用年度</label>
            <input id="adjYear" type="number" min="1" max="${maxYear}" placeholder="1">
          </div>
          <div class="field">
            <label for="adjAmount">调整金额（元）</label>
            <input id="adjAmount" type="number" step="1000" placeholder="-50000">
          </div>
          <div class="field">
            <label for="adjNote">说明（可选）</label>
            <input id="adjNote" type="text" placeholder="例如：减值测试 / 升级改造">
          </div>
          <button class="button primary" type="button" data-action="add-adjustment" ${maxYear < 1 ? 'disabled' : ''}>追加调整</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>年份</th><th>金额</th><th>说明</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>${records || '<tr><td colspan="5">暂无价值调整</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderAssetResult(result) {
    const warningSummary = result.warningCount > 0
      ? result.rows.filter((row) => row.warning).map((row) =>
          `<li><strong>${row.calendarYear} 年（第 ${row.lifeYear} 年）</strong>：${esc(row.warningReason)}</li>`).join('')
      : '<li>所有年度账面价值均未跌破警戒线。</li>';
    const rows = result.rows.map((row) => `
      <tr class="${row.warning ? 'warning-row' : ''}">
        <td>第 ${row.lifeYear} 年</td>
        <td>${row.calendarYear}</td>
        <td class="num">${money(row.opening)}</td>
        <td class="num ${row.adjustmentAmount >= 0 ? 'positive' : 'negative'}">${signedMoney(row.adjustmentAmount)}</td>
        <td class="num">${money(row.adjustedOpening)}</td>
        <td class="num">${money(row.depreciation)}</td>
        <td class="num"><strong>${money(row.closing)}</strong></td>
        <td>${row.warning ? `<span class="badge warning">${row.calendarYear} 年触发</span>` : '未触发'}</td>
        <td class="reason">${row.warning ? esc(row.warningReason) : `年末账面价值不低于 ${money(row.threshold)}。`}</td>
      </tr>`).join('');
    return `
      <div class="inline-issues" style="background:#fefce8;border-left-color:#f59e0b;">
        <strong>警戒触发依据</strong>
        <ul>${warningSummary}</ul>
      </div>
      <div id="detailChart" class="detail-chart chart"></div>
      <div class="table-wrap detail-table">
        <table>
          <thead>
            <tr>
              <th>使用年度</th><th>日历年份</th><th>年初账面</th><th>年度调整</th>
              <th>调整后年初</th><th>年折旧</th><th>年末账面</th><th>警戒状态</th><th>触发依据</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function renderDetailChart(result) {
    const target = $('detailChart');
    if (!target) return;
    const width = 960, height = 260;
    const margin = { top: 24, right: 20, bottom: 38, left: 72 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const maxValue = Math.max(...result.rows.map((row) => row.adjustedOpening)) * 1.08;
    const x = (lifeYear) => margin.left + ((lifeYear - 1) / Math.max(1, result.rows.length - 1)) * innerWidth;
    const y = (value) => margin.top + innerHeight - (value / maxValue) * innerHeight;
    const points = result.rows.map((row) => `${x(row.lifeYear)},${y(row.closing)}`).join(' ');
    const thresholdLine = `<line x1="${margin.left}" x2="${width - margin.right}" y1="${y(result.threshold)}" y2="${y(result.threshold)}" stroke="#f59e0b" stroke-dasharray="6 5"/>
      <text x="${width - margin.right}" y="${y(result.threshold) - 6}" text-anchor="end">警戒线 ${money(result.threshold)}</text>`;
    const dots = result.rows.map((row) => {
      const fill = row.warning ? '#f59e0b' : '#2563eb';
      return `<circle cx="${x(row.lifeYear)}" cy="${y(row.closing)}" r="4" fill="${fill}"/>
        <text x="${x(row.lifeYear)}" y="${height - 12}" text-anchor="middle">${row.calendarYear}</text>`;
    }).join('');
    const adjustments = result.rows.filter((row) => row.adjustmentAmount !== 0).map((row) =>
      `<text x="${x(row.lifeYear)}" y="${y(row.adjustedOpening) - 9}" text-anchor="middle" fill="${row.adjustmentAmount > 0 ? '#0f766e' : '#b91c1c'}">${signedMoney(row.adjustmentAmount)}</text>`).join('');
    target.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}">
        ${thresholdLine}
        <polyline points="${points}" fill="none" stroke="#2563eb" stroke-width="2.6"/>
        ${dots}${adjustments}
      </svg>`;
  }

  function addAsset() {
    const nextNumber = state.assets.length + 1;
    const asset = {
      id: uid('asset'),
      name: `新资产 ${nextNumber}`,
      initialCost: 500000,
      startYear: new Date().getFullYear(),
      lifeYears: 5,
      residualRate: 0.05,
      adjustments: []
    };
    state.assets.push(asset);
    selectedId = asset.id;
    render();
  }

  function removeSelected() {
    const asset = getSelected();
    if (!asset) return;
    if (!window.confirm(`确认删除「${asset.name || '未命名资产'}」及其调整记录？`)) return;
    state.assets = state.assets.filter((item) => item.id !== asset.id);
    selectedId = state.assets[0] ? state.assets[0].id : null;
    render();
  }

  function duplicateSelected() {
    const asset = getSelected();
    if (!asset) return;
    const copy = JSON.parse(JSON.stringify(asset));
    copy.id = uid('asset');
    copy.name = `${asset.name || '资产'} 副本`;
    copy.adjustments = (copy.adjustments || []).map((item) => Object.assign({}, item, { id: uid('adj') }));
    state.assets.push(copy);
    selectedId = copy.id;
    render();
  }

  function updateSelectedField(field, rawValue) {
    const asset = getSelected();
    if (!asset) return;
    if (field === 'name') {
      asset.name = rawValue;
    } else if (field === 'initialCost') {
      asset.initialCost = parseNumber(rawValue);
    } else if (field === 'startYear') {
      asset.startYear = parseInteger(rawValue);
    } else if (field === 'lifeYears') {
      asset.lifeYears = parseInteger(rawValue);
    } else if (field === 'residualRate') {
      asset.residualRate = parseNumber(rawValue) / 100;
    }
  }

  function addAdjustmentFromForm() {
    const asset = getSelected();
    if (!asset || !Number.isSafeInteger(asset.lifeYears)) return;
    const lifeYear = parseInteger($('adjYear').value);
    const amount = parseNumber($('adjAmount').value);
    const note = $('adjNote').value.trim();
    if (!Number.isSafeInteger(lifeYear) || lifeYear < 1 || lifeYear > asset.lifeYears) {
      window.alert(`请输入第 1 年至第 ${asset.lifeYears} 年之间的使用年度。`);
      return;
    }
    if (!Number.isFinite(amount) || amount === 0) {
      window.alert('请输入非零调整金额；正数为增值，负数为减值。');
      return;
    }
    asset.adjustments.push({
      id: uid('adj'),
      lifeYear,
      amount,
      note,
      revoked: false,
      confirmedAt: new Date().toISOString()
    });
    render();
  }

  function toggleAdjustment(adjustmentId) {
    const asset = getSelected();
    if (!asset) return;
    const adjustment = asset.adjustments.find((item) => item.id === adjustmentId);
    if (!adjustment) return;
    adjustment.revoked = !adjustment.revoked;
    render();
  }

  function bindEvents() {
    $('addAssetTop').addEventListener('click', addAsset);
    $('addAssetSide').addEventListener('click', addAsset);
    $('warningRatio').addEventListener('input', (event) => {
      const nextRatio = parseNumber(event.target.value) / 100;
      if (!Number.isFinite(nextRatio) || nextRatio < 0 || nextRatio > 1) return;
      state.warningRatio = nextRatio;
      render();
      const restored = $('warningRatio');
      restored.focus();
      restored.setSelectionRange(restored.value.length, restored.value.length);
    });

    document.addEventListener('click', (event) => {
      const selectedElement = event.target.closest('[data-select-asset]');
      if (selectedElement) {
        selectedId = selectedElement.dataset.selectAsset;
        render();
        return;
      }
      const actionElement = event.target.closest('[data-action]');
      if (!actionElement) return;
      const action = actionElement.dataset.action;
      if (action === 'add-adjustment') addAdjustmentFromForm();
      if (action === 'remove') removeSelected();
      if (action === 'duplicate') duplicateSelected();
    });

    document.addEventListener('change', (event) => {
      const field = event.target.dataset && event.target.dataset.field;
      if (field) {
        updateSelectedField(field, event.target.value);
        render();
        return;
      }
      const toggleId = event.target.dataset && event.target.dataset.toggleAdjustment;
      if (toggleId) toggleAdjustment(toggleId);
    });

    document.addEventListener('input', (event) => {
      const field = event.target.dataset && event.target.dataset.field;
      if (!field) return;
      const previousId = event.target.id;
      const selection = event.target.selectionStart;
      updateSelectedField(field, event.target.value);
      render();
      const restored = document.getElementById(previousId);
      if (restored) {
        restored.focus();
        const position = Math.min(selection || 0, restored.value.length);
        restored.setSelectionRange(position, position);
      }
    });

    document.addEventListener('click', (event) => {
      const toggleButton = event.target.closest('[data-toggle-adjustment]');
      if (toggleButton) toggleAdjustment(toggleButton.dataset.toggleAdjustment);
    });
  }

  $('warningRatio').value = Math.round(state.warningRatio * 100);
  bindEvents();
  render();
})();
