(function () {
  const STORAGE_KEY = "asset-depreciation-workbench-v1";
  const $ = id => document.getElementById(id);
  const els = {
    warningRatio: $("warningRatio"), loadSamples: $("loadSamples"), clearAll: $("clearAll"),
    issues: $("issuesPanel"), metricValid: $("metricValid"), metricCost: $("metricCost"),
    metricCurrent: $("metricCurrent"), metricWarnings: $("metricWarnings"),
    metricInvalid: $("metricInvalid"), portfolioChart: $("portfolioChart"),
    addAsset: $("addAsset"), assetList: $("assetList"), detailEmpty: $("detailEmpty"),
    assetDetail: $("assetDetail"), detailName: $("detailName"), detailMeta: $("detailMeta"),
    deleteAsset: $("deleteAsset"), form: $("assetForm"), name: $("fieldName"),
    cost: $("fieldCost"), start: $("fieldStart"), life: $("fieldLife"),
    salvage: $("fieldSalvage"), errors: $("assetErrors"),
    adjustmentForm: $("adjustmentForm"), adjYear: $("adjYear"), adjAmount: $("adjAmount"),
    adjustmentList: $("adjustmentList"), assetChart: $("assetChart"), yearRows: $("yearRows")
  };

  let state = loadState();

  function makeAsset(overrides = {}) {
    return Object.assign({
      id: AssetModel.uid(),
      name: "新资产",
      cost: 100000,
      startYear: new Date().getFullYear(),
      lifeYears: 5,
      salvageRate: 0.05
    }, overrides);
  }

  function sampleState() {
    const a = makeAsset({ name: "数控加工中心", cost: 800000, startYear: 2024, lifeYears: 8, salvageRate: 0.08 });
    const b = makeAsset({ name: "仓储冷链设备", cost: 350000, startYear: 2025, lifeYears: 5, salvageRate: 0.35 });
    return {
      selectedId: a.id,
      warningRatio: 0.3,
      assets: [a, b],
      adjustments: {
        [a.id]: [{ id: AssetModel.uid(), yearIndex: 3, amount: -260000 }],
        [b.id]: []
      }
    };
  }

  function normalizeState(value) {
    if (!value || !Array.isArray(value.assets)) return sampleState();
    const assets = value.assets.map(makeAsset);
    const adjustments = {};
    assets.forEach(asset => {
      adjustments[asset.id] = Array.isArray(value.adjustments && value.adjustments[asset.id])
        ? value.adjustments[asset.id].map(adj => ({
          id: adj.id || AssetModel.uid(),
          yearIndex: Number(adj.yearIndex),
          amount: Number(adj.amount)
        }))
        : [];
    });
    const ratio = Number(value.warningRatio);
    return {
      selectedId: assets.some(a => a.id === value.selectedId) ? value.selectedId : (assets[0] && assets[0].id),
      warningRatio: Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : 0.3,
      assets,
      adjustments
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return normalizeState(raw ? JSON.parse(raw) : sampleState());
    } catch (error) {
      return sampleState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function money(value) {
    const sign = value < 0 ? "-" : "";
    return sign + "¥" + Math.abs(value).toLocaleString("zh-CN", {
      maximumFractionDigits: 0
    });
  }

  function percent(value) {
    return (value * 100).toLocaleString("zh-CN", { maximumFractionDigits: 1 }) + "%";
  }

  function signedMoney(value) {
    if (value > 0) return "+" + money(value);
    return money(value);
  }

  function computed() {
    return AssetModel.calculatePortfolio(state.assets, state.adjustments, state.warningRatio);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  function lineChart(series, options = {}) {
    const width = options.width || 900;
    const height = options.height || 230;
    const margin = { top: 22, right: 18, bottom: 38, left: 76 };
    const allPoints = series.flatMap(s => s.points);
    if (!allPoints.length) return "<div class='empty-state'>暂无可绘制的有效轨迹。</div>";
    const xs = allPoints.map(p => p.x);
    const ys = allPoints.map(p => p.y);
    const minX = Math.min.apply(null, xs);
    const maxX = Math.max.apply(null, xs);
    const maxY = Math.max.apply(null, ys) * 1.08 || 1;
    const sx = x => margin.left + (maxX === minX ? 0 : (x - minX) / (maxX - minX) * (width - margin.left - margin.right));
    const sy = y => height - margin.bottom - y / maxY * (height - margin.top - margin.bottom);
    const grid = [0, .25, .5, .75, 1].map(t => {
      const y = margin.top + t * (height - margin.top - margin.bottom);
      const label = money(maxY * (1 - t));
      return `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#e5ebf3"/>
        <text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#667085">${label}</text>`;
    }).join("");
    const xLabels = [];
    const labelCount = Math.min(8, maxX - minX + 1);
    for (let i = 0; i < labelCount; i += 1) {
      const year = Math.round(minX + (maxX - minX) * (labelCount === 1 ? 0 : i / (labelCount - 1)));
      xLabels.push(`<text x="${sx(year)}" y="${height - 13}" text-anchor="middle" font-size="11" fill="#667085">${year}</text>`);
    }
    const paths = series.map(s => {
      const d = s.points.map((p, i) => `${i ? "L" : "M"} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
      const dots = s.points.map(p =>
        `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="${p.alert ? 4 : 2.5}" fill="${p.alert ? "#c63b3b" : s.color}"/>`).join("");
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"/>${dots}`;
    }).join("");
    const legend = series.map((s, i) =>
      `<g transform="translate(${margin.left + i * 170},12)"><circle r="4" cx="0" cy="0" fill="${s.color}"/>
      <text x="9" y="4" font-size="12" fill="#475467">${escapeHtml(s.name)}</text></g>`).join("");
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="价值轨迹折线图">
      ${grid}${xLabels.join("")}${paths}${legend}
      <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#98a2b3"/>
    </svg>`;
  }

  function sparkline(result, asset) {
    if (!result.isValid) return "";
    const width = 310;
    const height = 44;
    const denominator = asset.cost || 1;
    const coords = result.rows.map((row, index) => {
      const x = result.rows.length === 1 ? 4 : 4 + index / (result.rows.length - 1) * (width - 8);
      const y = height - 4 - Math.max(0, row.endingBook / denominator) * (height - 8);
      return { x, y, row };
    });
    const line = coords.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
    const dots = coords.map(point =>
      `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${point.row.firstWarning ? 3.5 : 1.8}"
        fill="${point.row.warning ? "#c63b3b" : "#2458d3"}"/>`).join("");
    return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" aria-hidden="true">
      <path d="${line}" fill="none" stroke="${result.firstWarningRow ? "#c63b3b" : "#2458d3"}" stroke-width="2"/>
      ${dots}
    </svg>`;
  }

  function renderIssues(portfolio) {
    const issues = [];
    portfolio.results.forEach((result, index) => {
      if (result.isValid) return;
      const asset = state.assets[index];
      result.errors.forEach(error => issues.push(
        `<li><strong>${escapeHtml(asset.name || "未命名资产")}</strong>：${escapeHtml(error.message)}</li>`
      ));
    });
    if (issues.length) {
      els.issues.classList.remove("hidden");
      els.issues.innerHTML = `<h3>以下资产存在矛盾，已暂停纳入汇总；修正后会自动恢复。</h3><ul>${issues.join("")}</ul>`;
    } else {
      els.issues.classList.add("hidden");
      els.issues.innerHTML = "";
    }
  }

  function renderAssetList(portfolio) {
    if (!state.assets.length) {
      els.assetList.innerHTML = "<div class='empty-state'>还没有资产。点击“新增资产”开始录入。</div>";
      return;
    }
    els.assetList.innerHTML = state.assets.map(asset => {
      const result = portfolio.results.find(item => item.id === asset.id);
      const active = asset.id === state.selectedId ? " active" : "";
      const invalid = result.isValid ? "" : " invalid";
      const badge = result.isValid
        ? (result.firstWarningRow
          ? `<span class="badge warn">第 ${result.firstWarningRow.yearIndex} 年触发</span>`
          : `<span class="badge ok">正常</span>`)
        : `<span class="badge bad">暂停汇总</span>`;
      const meta = result.isValid
        ? `${money(asset.cost)} · ${asset.lifeYears} 年 · 残值率 ${percent(asset.salvageRate)} · 末年 ${money(result.finalBookValue)}`
        : `${result.errors.length} 项问题待修正`;
      return `<button type="button" class="asset-card${active}${invalid}" data-id="${asset.id}">
        <div class="asset-card-head"><h3>${escapeHtml(asset.name || "未命名资产")}</h3>${badge}</div>
        <p>${meta}</p>
        <div class="sparkline">${sparkline(result, asset)}</div>
      </button>`;
    }).join("");
  }

  function renderPortfolio(portfolio) {
    const series = portfolio.results.filter(r => r.isValid).map((result, i) => {
      const asset = state.assets.find(a => a.id === result.id);
      const colors = ["#2458d3", "#147d57", "#7a4cc2", "#d07a1d", "#0088a9", "#b4237a"];
      return {
        name: asset.name,
        color: colors[i % colors.length],
        points: result.rows.map(row => ({ x: row.calendarYear, y: row.endingBook, alert: row.firstWarning }))
      };
    });
    els.portfolioChart.innerHTML = lineChart(series, { width: Math.max(760, series.length * 160), height: 250 });
  }

  function renderMetrics(portfolio) {
    const warningCount = portfolio.results.filter(result => result.isValid && result.firstWarningRow).length;
    els.metricValid.textContent = portfolio.validCount;
    els.metricCost.textContent = money(portfolio.totalInitialCost);
    els.metricCurrent.textContent = money(portfolio.totalCurrentValue);
    els.metricWarnings.textContent = warningCount;
    els.metricInvalid.textContent = portfolio.invalidCount;
  }

  function renderDetail(portfolio, syncForm = true) {
    const asset = state.assets.find(item => item.id === state.selectedId);
    if (!asset) {
      els.detailEmpty.classList.remove("hidden");
      els.assetDetail.classList.add("hidden");
      return;
    }
    const result = portfolio.results.find(item => item.id === asset.id);
    const adjustments = state.adjustments[asset.id] || [];
    els.detailEmpty.classList.add("hidden");
    els.assetDetail.classList.remove("hidden");
    els.detailName.textContent = asset.name || "未命名资产";
    els.detailMeta.textContent = result.isValid
      ? `${asset.startYear} 年启用 · ${money(asset.cost)} · 使用 ${asset.lifeYears} 年 · 预计残值 ${money(result.salvageValue)} · 最低账面值比例 ${percent(result.lowestRatio)}`
      : "当前参数或调整存在问题，修正前不参与汇总。";

    if (syncForm) {
      els.name.value = asset.name || "";
      els.cost.value = Number.isFinite(asset.cost) ? asset.cost : "";
      els.start.value = Number.isFinite(asset.startYear) ? asset.startYear : "";
      els.life.value = Number.isFinite(asset.lifeYears) ? asset.lifeYears : "";
      els.salvage.value = Number.isFinite(asset.salvageRate) ? (asset.salvageRate * 100).toString() : "";
    }

    renderErrors(result);
    renderAdjustmentControls(asset, adjustments, result);
    renderAssetChart(result);
    renderYearTable(asset, result);
  }

  function renderErrors(result) {
    if (result.isValid) {
      els.errors.classList.add("hidden");
      els.errors.innerHTML = "";
      return;
    }
    els.errors.classList.remove("hidden");
    els.errors.innerHTML = `<h3>该资产存在 ${result.errors.length} 项问题</h3><ul>` +
      result.errors.map(error => `<li>${escapeHtml(error.message)}</li>`).join("") + "</ul>";
  }

  function renderAdjustmentControls(asset, adjustments, result) {
    const maxYear = Number.isInteger(asset.lifeYears) ? asset.lifeYears : 0;
    els.adjYear.innerHTML = Array.from({ length: Math.max(0, maxYear) }, (_, i) => i + 1)
      .map(year => {
        const used = adjustments.some(adj => adj.yearIndex === year);
        return `<option value="${year}" ${used ? "disabled" : ""}>第 ${year} 年（${asset.startYear + year - 1}）${used ? " - 已有调整" : ""}</option>`;
      }).join("");
    if (!adjustments.length) {
      els.adjustmentList.innerHTML = "<p class='hint'>暂无已确认调整。追加后会立即改变该资产后续轨迹。</p>";
      return;
    }
    els.adjustmentList.innerHTML = adjustments
      .slice()
      .sort((a, b) => a.yearIndex - b.yearIndex)
      .map(adj => {
        const row = result.rows.find(item => item.yearIndex === adj.yearIndex);
        return `<div class="adjustment-row">
          <span>第 ${adj.yearIndex} 年（${asset.startYear + adj.yearIndex - 1}）
            <span class="${adj.amount < 0 ? "negative" : "positive"}">${signedMoney(adj.amount)}</span>
            ${row ? `→ 年末 ${money(row.endingBook)}` : ""}
          </span>
          <button type="button" class="subtle danger" data-remove-adjustment="${adj.id}">撤销</button>
        </div>`;
      }).join("");
  }

  function renderAssetChart(result) {
    if (!result.isValid) {
      els.assetChart.innerHTML = "<div class='empty-state'>资产有效后显示价值轨迹。</div>";
      return;
    }
    const valueSeries = {
      name: "年末账面值",
      color: "#2458d3",
      points: result.rows.map(row => ({ x: row.calendarYear, y: row.endingBook, alert: row.firstWarning }))
    };
    const thresholdSeries = {
      name: "警戒线",
      color: "#c63b3b",
      points: result.rows.map(row => ({ x: row.calendarYear, y: row.thresholdValue }))
    };
    els.assetChart.innerHTML = lineChart([valueSeries, thresholdSeries], { width: 610, height: 220 });
  }

  function renderYearTable(asset, result) {
    if (!result.isValid) {
      els.yearRows.innerHTML = "";
      return;
    }
    els.yearRows.innerHTML = result.rows.map(row => {
      let status = `<span class="badge ok">未触发</span>`;
      if (row.warning) {
        const reason = row.cause === "adjustment"
          ? `调整前 ${money(row.preAdjustmentBook)}，本年调整 ${signedMoney(row.adjustment)} 后降至 ${money(row.endingBook)}`
          : `本年折旧 ${money(row.depreciation)} 后降至 ${money(row.endingBook)}`;
        status = `<span class="status-text"><span class="badge warn">${row.firstWarning ? "首次跌破" : "低于警戒"}</span>
          <strong>警戒线 ${money(row.thresholdValue)}（${percent(state.warningRatio)}）</strong><small>${reason}</small></span>`;
      }
      return `<tr class="${row.warning ? "warning-row" : ""} ${row.firstWarning ? "first-warning" : ""}">
        <td>第 ${row.yearIndex} 年<br><small>${row.calendarYear}</small></td>
        <td>${money(row.beginningBook)}</td>
        <td>${money(row.depreciation)}</td>
        <td>${money(row.preAdjustmentBook)}</td>
        <td class="${row.adjustment < 0 ? "negative" : row.adjustment > 0 ? "positive" : ""}">${row.adjustment ? signedMoney(row.adjustment) : "—"}</td>
        <td><strong>${money(row.endingBook)}</strong></td>
        <td>${percent(row.bookRatio)}</td>
        <td>${status}</td>
      </tr>`;
    }).join("");
  }

  function render(syncForm = true) {
    if (document.activeElement !== els.warningRatio) {
      els.warningRatio.value = Math.round(state.warningRatio * 1000) / 10;
    }
    const portfolio = computed();
    renderMetrics(portfolio);
    renderIssues(portfolio);
    renderAssetList(portfolio);
    renderPortfolio(portfolio);
    renderDetail(portfolio, syncForm);
    saveState();
  }

  function selectedAsset() {
    return state.assets.find(asset => asset.id === state.selectedId);
  }

  els.addAsset.addEventListener("click", () => {
    const asset = makeAsset();
    state.assets.push(asset);
    state.adjustments[asset.id] = [];
    state.selectedId = asset.id;
      render();
  });

  els.assetList.addEventListener("click", event => {
    const card = event.target.closest("[data-id]");
    if (card) {
      state.selectedId = card.dataset.id;
      render();
    }
  });

  els.deleteAsset.addEventListener("click", () => {
    const asset = selectedAsset();
    if (asset && confirm(`确定删除“${asset.name}”及其全部调整？此操作只影响当前浏览器数据。`)) {
      state.assets = state.assets.filter(item => item.id !== asset.id);
      delete state.adjustments[asset.id];
      state.selectedId = state.assets[0] ? state.assets[0].id : null;
      render();
    }
  });

  els.form.addEventListener("input", () => {
    const asset = selectedAsset();
    if (!asset) return;
    asset.name = els.name.value;
    asset.cost = Number(els.cost.value);
    asset.startYear = Number(els.start.value);
    asset.lifeYears = Number(els.life.value);
    asset.salvageRate = Number(els.salvage.value) / 100;

    render(false);
  });

  els.adjustmentForm.addEventListener("submit", event => {
    event.preventDefault();
    const asset = selectedAsset();
    if (!asset) return;
    const yearIndex = Number(els.adjYear.value);
    const amount = Number(els.adjAmount.value);
    const list = state.adjustments[asset.id] || [];
    if (list.some(adj => adj.yearIndex === yearIndex)) {
      alert("该年份已有确认调整；请先撤销原调整。");
      return;
    }
    list.push({ id: AssetModel.uid(), yearIndex, amount });
    els.adjAmount.value = "";
    render();
  });

  els.adjustmentList.addEventListener("click", event => {
    const button = event.target.closest("[data-remove-adjustment]");
    const asset = selectedAsset();
    if (!button || !asset) return;
    const id = button.dataset.removeAdjustment;
    state.adjustments[asset.id] = (state.adjustments[asset.id] || [])
      .filter(adj => adj.id !== id);
    render();
  });

  els.warningRatio.addEventListener("input", () => {
    const value = Number(els.warningRatio.value) / 100;
    if (value >= 0 && value <= 1) {
      state.warningRatio = value;
      render();
    }
  });

  els.loadSamples.addEventListener("click", () => {
    if (confirm("载入示例将覆盖当前浏览器中的工作台数据，是否继续？")) {
      state = sampleState();
      render();
    }
  });

  els.clearAll.addEventListener("click", () => {
    if (confirm("确定清空全部资产和调整？")) {
      state = { selectedId: null, warningRatio: state.warningRatio, assets: [], adjustments: {} };
      render();
    }
  });

  render();
})();
