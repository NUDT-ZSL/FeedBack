(function () {
  "use strict";

  const state = { result: null, metricCsv: null, eventCsv: null, metricName: null, selectedSegmentId: null };
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));

  function recompute() {
    const metricRows = window.AnomalyAnalyzer.parseCsv(state.metricCsv || "");
    const eventRows = window.AnomalyAnalyzer.parseCsv(state.eventCsv || "");
    state.result = window.AnomalyAnalyzer.analyzeDataset(metricRows, eventRows);
    if (!state.result.metricNames.includes(state.metricName)) state.metricName = state.result.metricNames[0] || null;
    const metric = currentMetric();
    if (!metric || !metric.segments.some((seg) => seg.id === state.selectedSegmentId)) {
      state.selectedSegmentId = metric && metric.segments[0] ? metric.segments[0].id : null;
    }
    render();
  }
  function currentMetric() {
    return state.result ? state.result.metrics.find((metric) => metric.name === state.metricName) : null;
  }
  function currentSegment() {
    const metric = currentMetric();
    return metric ? metric.segments.find((seg) => seg.id === state.selectedSegmentId) : null;
  }
  function loadSample() {
    state.metricCsv = window.SampleData.metricsCsv();
    state.eventCsv = window.SampleData.eventsCsv();
    state.metricName = null;
    state.selectedSegmentId = null;
    $("dataStatus").textContent = "已载入订单量样例（含缺失、重复、多事件归因）";
    recompute();
  }
  async function readFile(input, kind) {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (kind === "metric") state.metricCsv = text;
      else state.eventCsv = text;
      state.selectedSegmentId = null;
      $("dataStatus").textContent = `已导入：${file.name}`;
      recompute();
    } catch (error) {
      $("dataStatus").textContent = `导入失败：${error.message}`;
      console.error(error);
    }
  }
  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  function renderMetricSelect() {
    const select = $("metricSelect");
    select.innerHTML = "";
    (state.result?.metricNames || []).forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      option.selected = name === state.metricName;
      select.appendChild(option);
    });
  }

  function renderQuality() {
    const issues = (state.result?.issues || []).filter((issue) =>
      issue.scope === "events" || (!issue.metric) ||
      (state.metricName && issue.metric === state.metricName && !issue.date));
    const metric = currentMetric();
    const summary = [];
    if (metric?.missingCount) summary.push({ level: "warning", text: `${metric.name} 缺失 ${metric.missingCount} 天：插补点可能影响异常边界` });
    if (metric?.conflictCount) summary.push({ level: "warning", text: `${metric.conflictCount} 天重复数值冲突：已取均值，峰值可能被平滑` });
    else if (metric?.duplicateCount) summary.push({ level: "info", text: `${metric.duplicateCount} 天完全重复上报：已合并且不改变数值` });
    if (!state.result?.events.length) summary.push({ level: "warning", text: "暂无有效事件记录，无法形成候选原因" });
    const shown = [...summary, ...issues.slice(0, 7)];
    $("qualityStrip").innerHTML = (shown.length ? shown : [{ level: "info", text: "数据质量检查通过，未发现缺失或重复上报" }])
      .map((item) => `<span class="quality-item ${esc(item.level)}">${esc(item.message || item.text)}</span>`).join("");
  }
  function severityText(level) {
    return { high: "高影响", medium: "中影响", low: "低影响" }[level] || level;
  }

  function renderChart() {
    const metric = currentMetric();
    const segment = currentSegment();
    if (!metric) {
      $("chart").innerHTML = `<div class="chart-title"><span>暂无指标</span></div>`;
      return;
    }
    const width = 980;
    const height = 280;
    const pad = { l: 54, r: 18, t: 22, b: 38 };
    const values = metric.points.map((p) => p.value).filter(Number.isFinite);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const x = (i) => pad.l + (i / Math.max(1, metric.points.length - 1)) * (width - pad.l - pad.r);
    const y = (v) => pad.t + (1 - (v - min) / span) * (height - pad.t - pad.b);
    const linePath = metric.points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
    const baselinePath = metric.points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.baseline ?? p.value).toFixed(1)}`).join(" ");
    const bands = metric.segments.map((seg) => {
      const startIdx = metric.points.findIndex((p) => p.date === seg.start);
      const endIdx = metric.points.findIndex((p) => p.date === seg.end);
      return `<rect x="${x(startIdx) - 8}" y="${pad.t}" width="${x(endIdx) - x(startIdx) + 16}" height="${height - pad.t - pad.b}"
        fill="${seg.id === state.selectedSegmentId ? "rgba(36,88,213,.15)" : "rgba(102,112,133,.10)"}" rx="7"/>`;
    }).join("");
    const eventStart = segment ? addDaysLocal(segment.start, -3) : null;
    const eventEnd = segment?.end || null;
    const eventMarks = state.result.events.filter((e) => !segment || (e.date >= eventStart && e.date <= eventEnd)).map((event) => {
      const idx = metric.points.findIndex((p) => p.date === event.date);
      if (idx < 0) return "";
      return `<line x1="${x(idx)}" x2="${x(idx)}" y1="${pad.t}" y2="${height - pad.b}" stroke="#8b5cf6" stroke-dasharray="4 4" opacity=".55"/>
        <text x="${Math.min(width - 80, x(idx) + 4)}" y="${pad.t + 12}" class="event-label">${esc(event.type)}</text>`;
    }).join("");
    const points = metric.points.map((p, i) => {
      if (!p.observed) return `<circle cx="${x(i)}" cy="${y(p.value)}" r="3.5" fill="#f59e0b"/>`;
      if (p.duplicateCount > 1) return `<circle cx="${x(i)}" cy="${y(p.value)}" r="4.5" fill="none" stroke="#f59e0b" stroke-width="2"/>`;
      return `<circle cx="${x(i)}" cy="${y(p.value)}" r="2" fill="#2458d5"/>`;
    }).join("");
    const labels = metric.points.filter((_, i) => i % 14 === 0).map((p) => {
      const i = metric.points.indexOf(p);
      return `<text x="${x(i)}" y="${height - 12}" text-anchor="middle" class="axis-label">${esc(p.date.slice(5))}</text>`;
    }).join("");
    $("chart").innerHTML = `<div class="chart-title"><div>${esc(metric.name)} 日趋势 <span>蓝色实线=实际/插补值，灰线=滚动稳健基线，紫色线=窗口事件</span></div></div>
      <svg viewBox="0 0 ${width} ${height}" width="100%" role="img">
        <style>.axis-label{fill:#667085;font-size:11px}.event-label{fill:#6d28d9;font-size:11px}</style>
        ${bands}${eventMarks}
        <path d="${linePath}" fill="none" stroke="#2458d5" stroke-width="2.4"/>
        <path d="${baselinePath}" fill="none" stroke="#98a2b3" stroke-width="1.4" stroke-dasharray="5 4"/>
        ${points}${labels}
      </svg>`;
  }
  function addDaysLocal(dateText, delta) {
    const date = new Date(`${dateText}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + delta);
    return date.toISOString().slice(0, 10);
  }

  function evidenceText(candidate) {
    const stats = candidate.stats;
    const lift = Number.isFinite(stats.lift) ? stats.lift.toFixed(1) : "高";
    return `历史出现 ${stats.occurrences} 次；异常共现 ${stats.coOccurrences} 次；命中率 ${(stats.hitRate * 100).toFixed(0)}%；提升度 ${lift}；相关 ${stats.correlation.toFixed(2)}；领先 ${candidate.leadDays} 天`;
  }

  function renderDetail() {
    const metric = currentMetric();
    const segment = currentSegment();
    const target = $("segmentDetail");
    if (!metric || !segment) {
      target.innerHTML = `<div class="detail-card empty-state"><h2>${metric ? "未检测到满足阈值的异常区段" : "等待导入指标数据"}</h2><p>默认要求连续异常，或单日 Z 分数至少 5.5。</p></div>`;
      return;
    }
    const attribution = segment.attribution;
    const globalFlags = attribution.hasContradiction
      ? `<span class="tag bad">候选间存在历史方向矛盾</span>` : "";
    const insufficient = attribution.insufficientEvidence
      ? `<span class="tag warn">证据不足：当前排序只可作为线索</span>` : "";
    const qualityFlags = segment.qualityFlags.map((flag) =>
      `<span class="tag ${flag.level === "high" ? "bad" : "warn"}">${esc(flag.message)}</span>`).join("");
    target.innerHTML = `<div class="detail-card">
      <div class="conclusion-banner">
        <div><h2 style="margin:0">${esc(attribution.conclusion)}</h2><p style="margin:5px 0 0;color:#475467">调整任一候选后，仅当前区段立即重新归因。</p><div>${globalFlags}${insufficient}</div></div>
        <div class="confidence">${attribution.confidence}<small style="font-size:13px"> 分</small></div>
      </div>
      <div class="detail-grid">
        <div class="metric-tile"><span>起止时间</span><strong style="font-size:16px">${esc(segment.start)}<br>${esc(segment.end)}</strong></div>
        <div class="metric-tile"><span>峰值偏离</span><strong class="${segment.direction === "up" ? "" : ""}">${segment.peakDeviationPct > 0 ? "+" : ""}${segment.peakDeviationPct}%</strong></div>
        <div class="metric-tile"><span>峰值 Z 分数</span><strong>${segment.peakZ}</strong></div>
        <div class="metric-tile"><span>影响天数</span><strong>${segment.observedDays}/${segment.days} 天有观测</strong></div>
      </div>
      <h3>数据质量影响范围</h3>${qualityFlags || `<span class="tag good">该区段及其前 3 天归因窗口未发现缺失或重复冲突</span>`}
      <h3 style="margin-top:18px">候选原因排序</h3>
      <table><thead><tr><th>排序</th><th>事件与证据</th><th>状态/份额</th><th>人工调整</th></tr></thead><tbody>
        ${attribution.rankedCandidates.map((candidate, index) => renderCandidateRow(candidate, index)).join("")}
      </tbody></table>
      ${renderHistory(segment)}
    </div>`;
    bindCandidateActions(segment);
  }

  function renderCandidateRow(candidate, index) {
    const events = candidate.matchedEvents.map((event) => `<div>${esc(event.date)} · ${esc(event.description)}</div>`).join("");
    const tags = candidate.warnings.map((warning) => `<span class="tag ${warning.includes("矛盾") ? "bad" : "warn"}">${esc(warning)}</span>`).join("");
    const statusText = { auto: "自动", confirmed: "已确认", excluded: "已排除" }[candidate.status];
    return `<tr data-candidate="${esc(candidate.key)}">
      <td><strong>#${index + 1}</strong><br><span class="segment-meta">${candidate.score} 分</span></td>
      <td><strong>${esc(candidate.eventType)}</strong><div class="segment-meta">${events}</div><div class="segment-meta">${esc(evidenceText(candidate))}</div><div>${tags}</div></td>
      <td><span class="tag good">${statusText}</span><div style="margin-top:6px">归因份额 ${candidate.sharePct}%</div><div class="segment-meta">原始 ${candidate.baseScore} × 权重 ${Number(candidate.weight).toFixed(1)}</div></td>
      <td><div class="row-actions">
        <button class="tiny ${candidate.status === "confirmed" ? "active" : ""}" data-action="confirm">确认</button>
        <button class="tiny ${candidate.status === "excluded" ? "active" : ""}" data-action="exclude">排除</button>
        <button class="tiny" data-action="reset">恢复</button>
      </div><div style="margin-top:8px"><input type="range" min="0.1" max="2" step="0.1" value="${candidate.weight}" data-action="weight"><span class="segment-meta">权重 ${Number(candidate.weight).toFixed(1)}</span></div></td>
    </tr>`;
  }

  function bindCandidateActions(segment) {
    document.querySelectorAll("#segmentDetail tr[data-candidate]").forEach((row) => {
      const key = row.dataset.candidate;
      row.querySelectorAll("[data-action]").forEach((control) => {
        if (control.tagName === "INPUT") {
          control.addEventListener("change", () => {
            window.AnomalyAnalyzer.applyAdjustment(state.result, state.metricName, segment.id, key, "weight", control.value, "调整候选权重");
            renderSegmentList();
            renderChart();
            renderDetail();
          });
        } else {
          control.addEventListener("click", () => {
            window.AnomalyAnalyzer.applyAdjustment(state.result, state.metricName, segment.id, key, control.dataset.action, control.value || null, control.textContent);
            renderSegmentList();
            renderChart();
            renderDetail();
          });
        }
      });
    });
  }

  function snapshotList(snapshot) {
    if (!snapshot.candidates.length) return "<div class='segment-meta'>无候选</div>";
    return snapshot.candidates.map((candidate) => {
      const status = { auto: "自动", confirmed: "确认", excluded: "排除" }[candidate.status] || candidate.status;
      return `<div>${esc(candidate.eventType)}：${candidate.score} 分 / ${candidate.sharePct}%（${status}，权重 ${Number(candidate.weight).toFixed(1)}）</div>`;
    }).join("");
  }

  function renderHistory(segment) {
    if (!segment.history.length) {
      return `<div class="history-box"><h3>变更历史</h3><p class="segment-meta">尚未进行人工调整。确认、排除或拖动权重后，会在这里保留调整前后对比。</p></div>`;
    }
    return `<div class="history-box"><h3>变更历史（${segment.history.length}）</h3>
      ${segment.history.map((item) => `<div class="history-item">
        <strong>${esc(item.at.slice(0, 19).replace("T", " "))} · ${esc(item.action)} · ${esc(item.candidate)}</strong>
        ${item.note ? `<div class="segment-meta">${esc(item.note)}</div>` : ""}
        <div class="compare">
          <div><span class="tag warn">调整前</span><p>${esc(item.before.conclusion)}</p>${snapshotList(item.before)}</div>
          <div><span class="tag good">调整后</span><p>${esc(item.after.conclusion)}</p>${snapshotList(item.after)}</div>
        </div>
      </div>`).join("")}
    </div>`;
  }
  function renderSegmentList() {
    const metric = currentMetric();
    const segments = metric?.segments || [];
    $("segmentCount").textContent = `${segments.length} 个`;
    $("segmentList").innerHTML = segments.map((seg) => `<button class="segment-card ${seg.id === state.selectedSegmentId ? "active" : ""}" data-seg="${esc(seg.id)}">
        <span class="segment-title"><span>${esc(seg.start)} → ${esc(seg.end)}</span><span class="badge ${seg.direction}">${seg.directionText}</span></span>
        <span class="segment-meta">${seg.days} 天 · 峰值 ${seg.peakDeviationPct > 0 ? "+" : ""}${seg.peakDeviationPct}% · Z=${seg.peakZ} · ${severityText(seg.severity)}${seg.history.length ? ` · 已调整 ${seg.history.length} 次` : ""}</span>
        ${seg.qualityFlags.length ? `<span class="segment-meta">⚠ ${esc(seg.qualityFlags[0].message)}</span>` : ""}
      </button>`).join("");
    document.querySelectorAll("[data-seg]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedSegmentId = button.dataset.seg;
        renderSegmentList();
        renderDetail();
        renderChart();
      });
    });
  }
  function render() {
    renderMetricSelect();
    renderQuality();
    renderSegmentList();
    renderChart();
    renderDetail();
  }

  $("metricFile").addEventListener("change", (event) => readFile(event.target, "metric"));
  $("eventFile").addEventListener("change", (event) => readFile(event.target, "event"));
  $("metricSelect").addEventListener("change", (event) => {
    state.metricName = event.target.value;
    state.selectedSegmentId = null;
    recompute();
  });
  $("loadSample").addEventListener("click", loadSample);
  $("downloadTemplates").addEventListener("click", () => {
    downloadText("metric-template.csv", "date,metric_name,value\n2026-09-01,订单量,12000\n");
    setTimeout(() => downloadText("event-template.csv", "date,event_type,description\n2026-09-01,营销Push,活动推送\n"), 300);
  });
  $("exportResult").addEventListener("click", () => {
    if (state.result) downloadText("attribution-result.json", JSON.stringify(state.result, null, 2), "application/json;charset=utf-8");
  });
  loadSample();
})();
