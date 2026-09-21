(function () {
  "use strict";
  const core = window.MovementAnalysisCore;
  let state = core.createState(window.MovementDemoSample.buildSamplePoints(), core.DEFAULT_PARAMS);
  let selected = null;

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, s => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[s]));
  const fmt = core.formatTime;

  function pointMap() {
    return new Map(state.analysis.points.map(p => [p.id, p]));
  }

  function segmentMap() {
    return new Map(state.analysis.targets.flatMap(t => t.segments.map(s => [s.id, s])));
  }

  function relationMap() {
    return new Map(state.analysis.relations.map(r => [r.id, r]));
  }

  function groupMap() {
    return new Map(state.analysis.groups.map(g => [g.id, g]));
  }

  function badge(text, cls) {
    return `<span class="badge ${cls || ""}">${esc(text)}</span>`;
  }

  function pointBadges(p) {
    const labels = {
      out_of_order: "时间倒序", duplicate: "重复上报", same_time_conflict: "同时刻冲突",
      obvious_drift: "明显漂移", speed_gap: "速度异常", invalid_coordinate: "坐标非法", invalid_time: "时刻非法"
    };
    return p.anomalies.map(a => badge(labels[a.type] || a.type, a.severity === "bad" ? "bad" : "warn")).join("");
  }

  function paramsToInputs() {
    for (const [key, value] of Object.entries(state.analysis.params)) $(key).value = value;
  }

  function readParams() {
    const out = {};
    for (const key of Object.keys(core.DEFAULT_PARAMS)) out[key] = Number($(key).value);
    return out;
  }

  function parseCSV(text) {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const headers = lines[0].split(",").map(x => x.trim());
    return lines.slice(1).map((line, i) => {
      const cells = line.split(",");
      const row = { id: `I${Date.now()}-${i}` };
      headers.forEach((h, j) => { row[h] = cells[j]?.trim() ?? ""; });
      return row;
    });
  }

  function parseImport(text, name) {
    if (name && name.toLowerCase().endsWith(".json") || text.trim().startsWith("[")) {
      const data = JSON.parse(text);
      return data.map((p, i) => ({ id: p.id || `I${Date.now()}-${i}`, ...p }));
    }
    return parseCSV(text);
  }

  function renderSummary() {
    const a = state.analysis;
    const anomalies = a.points.filter(p => p.anomalies.length).length;
    const stable = a.relations.filter(r => r.relation === "stable").length;
    const casual = a.relations.length - stable;
    $("summary").textContent =
      `${a.targetIds.length} 个目标 · ${a.points.length} 个点 · ${a.points.filter(p => p.canonical).length} 个参与推导 · ${a.targets.reduce((n, t) => n + t.stays.length, 0)} 个停留段 · ${stable} 个稳定同行 / ${casual} 个偶发接近 · ${anomalies} 个异常点`;
    $("pointCount").textContent = `(${a.points.length})`;
    $("anomalyCount").textContent = `(${anomalies})`;
    $("diffCount").textContent = `(${state.relationChanges.length})`;
    $("incrementalNote").textContent = state.lastAffected.reason === "initial" ? "" :
      `局部更新：${state.lastAffected.targetIds.length} 个目标，${state.lastAffected.pairKeys.length} 个目标对`;
  }

  function renderAll() {
    paramsToInputs();
    renderSummary();
    renderTimeline();
    renderMap();
    renderPoints();
    renderAnomalies();
    renderDiff();
    renderDetail();
  }

  function globalTimeRange() {
    const times = state.analysis.points.filter(p => p.canonical).map(p => p.time);
    return { min: Math.min(...times), max: Math.max(...times) };
  }

  function renderTimeline() {
    const view = $("timelineView");
    if (!state.analysis.points.filter(p => p.canonical).length) {
      view.innerHTML = `<div class="empty">暂无可参与时间推导的有效点。</div>`;
      return;
    }
    const range = globalTimeRange();
    const span = Math.max(1, range.max - range.min);
    const pos = t => (t - range.min) / span * 100;
    const rels = state.analysis.relations;
    const rows = state.analysis.targets.map(t => {
      const pts = state.analysis.tracks.get(t.targetId);
      const anomalousIds = new Set(state.analysis.points.filter(p => p.anomalies.length).map(p => p.id));
      const ticks = state.analysis.points
        .filter(p => p.targetId === t.targetId && p.time !== null)
        .map(p => `<span class="point-tick ${anomalousIds.has(p.id) ? "anomaly" : ""}" title="${esc(p.id)}" style="left:${pos(p.time).toFixed(3)}%"></span>`).join("");
      const segments = t.segments.map(s => {
        const left = pos(s.startTime), width = Math.max(1.2, pos(s.endTime) - left);
        const label = s.kind === "stay"
          ? `停留 ${Math.round(s.durationSec / 60)}分`
          : `移动 ${Math.round(s.distanceM)}米`;
        return `<button class="segment ${s.kind}" data-select="segment:${esc(s.id)}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%">${esc(label)}</button>`;
      }).join("");
      const bands = rels.filter(r => r.targetIds.includes(t.targetId)).map(r => {
        const left = pos(r.startTime), width = Math.max(0.8, pos(r.endTime) - left);
        const other = r.targetIds.find(x => x !== t.targetId);
        return `<button class="companion-band ${r.relation}" data-select="relation:${esc(r.id)}" title="${esc(r.relation === "stable" ? "稳定同行" : "偶发接近")} ${esc(other)}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%"></button>`;
      }).join("");
      return `<div class="target-row"><div class="target-name" title="${esc(t.targetId)}">${esc(t.targetId)}</div>
        <div class="track">${ticks}${segments}${bands}</div></div>`;
    }).join("");
    view.innerHTML = `
      <div class="legend">
        <span><i style="background:#bbf7d0"></i>停留段</span>
        <span><i style="background:#bfdbfe"></i>移动段</span>
        <span><i style="background:#fb923c"></i>稳定同行</span>
        <span><i style="background:#fcd34d"></i>偶发接近</span>
        <span><i style="background:#dc2626"></i>异常点时刻</span>
      </div>
      <div class="timeline-scroll"><div class="timeline">
        <div class="time-scale"><span>${esc(fmt(range.min))}</span><span>${esc(fmt(range.min + span / 2))}</span><span>${esc(fmt(range.max))}</span></div>
        ${rows}
      </div></div>`;
  }

  function renderMap() {
    const valid = state.analysis.points.filter(p => p.canonical);
    const view = $("mapView");
    if (valid.length < 2) {
      view.innerHTML = `<div class="empty">至少需要两个有效坐标点。</div>`;
      return;
    }
    const minLat = Math.min(...valid.map(p => p.lat)), maxLat = Math.max(...valid.map(p => p.lat));
    const minLon = Math.min(...valid.map(p => p.lon)), maxLon = Math.max(...valid.map(p => p.lon));
    const W = 760, H = 520, pad = 42;
    const x = p => pad + (p.lon - minLon) / Math.max(1e-9, maxLon - minLon) * (W - pad * 2);
    const y = p => H - pad - (p.lat - minLat) / Math.max(1e-9, maxLat - minLat) * (H - pad * 2);
    const colors = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2"];
    const tracks = state.analysis.targetIds.map((id, i) => {
      const ps = valid.filter(p => p.targetId === id).sort((a, b) => a.time - b.time);
      if (!ps.length) return "";
      const color = colors[i % colors.length];
      const path = ps.map(p => `${x(p).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
      const dots = ps.map(p => {
        const bad = p.anomalies.some(a => a.severity === "bad");
        return `<circle cx="${x(p).toFixed(1)}" cy="${y(p).toFixed(1)}" r="${bad ? 5 : 3}"
          fill="${bad ? "#ef4444" : color}" stroke="#fff" data-select="point:${esc(p.id)}" class="map-dot"/>`;
      }).join("");
      return `<polyline points="${path}" fill="none" stroke="${color}" stroke-width="2.5" opacity=".65"/>${dots}
        <text x="${x(ps[0]).toFixed(1)}" y="${(y(ps[0]) - 10).toFixed(1)}" fill="${color}" font-size="14">${esc(id)}</text>`;
    }).join("");
    view.innerHTML = `<p class="map-note">按经纬度等比放入本地 SVG，无地图底图，完全离线可用；红点表示被标记的严重异常点。</p>
      <div class="map-wrap"><svg class="map-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="#fff" stroke="#e2e8f0"/>
        ${tracks}
      </svg></div>`;
  }

  function renderPoints() {
    const ids = state.analysis.targetIds;
    const options = ids.map(id => `<option value="${esc(id)}">${esc(id)}</option>`).join("");
    const rows = state.analysis.points.map(p => `
      <tr>
        <td>${esc(p.id)}</td>
        <td>${esc(p.targetId)}</td>
        <td>${esc(fmt(p.time))}</td>
        <td>${validCell(Number(p.lat))}</td>
        <td>${validCell(Number(p.lon))}</td>
        <td>${p.canonical ? badge("参与", "good") : badge("保留/排除", "bad")}${pointBadges(p)}</td>
        <td><button data-select="point:${esc(p.id)}" type="button">查看/编辑</button></td>
      </tr>`).join("");
    $("pointsView").innerHTML = `
      <form id="pointForm" class="point-form">
        <input name="id" placeholder="点 ID" value="P${state.rawPoints.length + 1}">
        <select name="targetId">${options}</select>
        <input name="time" type="datetime-local" step="1" class="wide">
        <input name="lat" placeholder="纬度" value="31.2304">
        <input name="lon" placeholder="经度" value="121.4737">
        <button class="wide" type="submit">新增点并局部更新</button>
      </form>
      <div class="table-wrap"><table><thead><tr>
        <th>ID</th><th>目标</th><th>时刻</th><th>纬度</th><th>经度</th><th>状态</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function validCell(v) {
    return Number.isFinite(v) ? v.toFixed(7) : badge("无效", "bad");
  }

  function renderAnomalies() {
    const rows = state.analysis.points.flatMap(p => p.anomalies.map(a => `
      <tr>
        <td>${badge(a.severity === "bad" ? "严重" : "提示", a.severity)}</td>
        <td>${esc(p.targetId)}</td>
        <td><button data-select="point:${esc(p.id)}">${esc(p.id)}</button></td>
        <td>${esc(fmt(p.time))}</td>
        <td>${esc(a.message)}</td>
        <td>${p.canonical ? "参与推导" : "保留但不参与连续推导"}</td>
      </tr>`));
    $("anomaliesView").innerHTML = rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>级别</th><th>目标</th><th>点</th><th>时刻</th><th>原因</th><th>处理</th></tr></thead>
      <tbody>${rows.join("")}</tbody></table></div>` :
      `<div class="empty">没有异常点。</div>`;
  }

  function changeText(detail) {
    const map = { type: "稳定/偶发类型", startTime: "开始时刻", endTime: "结束时刻", confidence: "置信依据" };
    return detail.map(x => map[x] || x).join("、");
  }

  function renderDiff() {
    if (!state.relationChanges.length) {
      $("diffView").innerHTML = `<div class="empty">尚无同行变更。修正点或调整参数后，这里会明确列出新增、消失和区间变化。</div>`;
      return;
    }
    const label = { added: "新增", removed: "消失", changed: "区间变化" };
    $("diffView").innerHTML = state.relationChanges.map(ch => {
      const r = ch.after || ch.before;
      const body = ch.kind === "changed"
        ? `<p>变化：${esc(changeText(ch.details))}</p>
           <p>原：${esc(fmt(ch.before.startTime))} - ${esc(fmt(ch.before.endTime))}，${ch.before.confidence}%</p>
           <p>新：${esc(fmt(ch.after.startTime))} - ${esc(fmt(ch.after.endTime))}，${ch.after.confidence}%</p>`
        : `<p>${esc(fmt(r.startTime))} - ${esc(fmt(r.endTime))}</p><p>${esc(r.rationale)}</p>`;
      return `<div class="diff-card ${ch.kind}">
        <strong>${label[ch.kind]}</strong> ${badge(r.relation === "stable" ? "稳定同行" : "偶发接近", r.relation === "stable" ? "warn" : "")}
        ${badge(r.targetIds.join(" ↔ "), "info")} ${body}
        <button data-select="relation:${esc(r.id)}" type="button">查看依据点</button>
      </div>`;
    }).join("");
  }

  function evidenceItems(ids) {
    const map = pointMap();
    return ids.map(id => {
      const p = map.get(id);
      return p ? `<li>${esc(p.id)} · ${esc(fmt(p.time))} · (${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}) ${pointBadges(p)}</li>` : "";
    }).join("");
  }

  function kv(rows) {
    return `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
  }

  function renderDetail() {
    const panel = $("detailPanel");
    if (!selected) {
      panel.innerHTML = `<h2>明细与复核</h2><p class="muted">点击时间轴、地图、数据点或同行变更，可查看该结论的全部依据点和生效参数。</p>`;
      return;
    }
    if (selected.startsWith("point:")) return renderPointDetail(selected.split(":")[1]);
    if (selected.startsWith("segment:")) {
      const s = segmentMap().get(selected.split(":")[1]);
      if (!s) return renderDetailEmpty();
      panel.innerHTML = `<h2>${s.kind === "stay" ? "停留段" : "移动段"} ${esc(s.id)}</h2>
        ${badge(s.targetId, "info")}${s.kind === "stay" ? badge("停留", "good") : badge("移动", "info")}
        ${kv([
          ["目标", esc(s.targetId)], ["起止", `${esc(fmt(s.startTime))} — ${esc(fmt(s.endTime))}`],
          ["持续", `${Math.round(s.durationSec)} 秒`],
          [s.kind === "stay" ? "聚集半径" : "路径长度", s.kind === "stay" ? `${s.radiusM}m / 阈值 ${s.params.clusterRadius}m` : `${s.distanceM}m`],
          ["依据点数", s.pointCount], ["判定", esc(s.rationale)],
          ["参数", `半径 ${s.params.clusterRadius}m；最短停留 ${s.params.minStayDuration}s`]
        ])}
        <h3>依据点</h3><ul class="evidence-list">${evidenceItems(s.evidencePointIds)}</ul>`;
      return;
    }
    if (selected.startsWith("relation:")) {
      const r = relationMap().get(selected.split(":")[1]);
      if (!r) return renderDetailEmpty();
      panel.innerHTML = `<h2>${r.relation === "stable" ? "稳定同行" : "偶发接近"} ${esc(r.id)}</h2>
        ${r.targetIds.map(x => badge(x, "info")).join("")}${r.groupId ? badge(`群体 ${r.groupId}`, "warn") : ""}
        ${kv([
          ["区间", `${esc(fmt(r.startTime))} — ${esc(fmt(r.endTime))}`],
          ["持续", `${Math.round(r.durationSec)} 秒 / 稳定阈值 ${r.params.stableCompanionDuration}s`],
          ["距离", `平均 ${r.avgDistanceM}m，最大 ${r.maxDistanceM}m / 阈值 ${r.params.companionRadius}m`],
          ["采样", `${r.directSamples} 个直接观测 / 共 ${r.sampleCount} 个；最大插补空档 ${r.params.maxTrackingGap}s`],
          ["置信度", `${r.confidence}%`], ["依据", esc(r.rationale)]
        ])}
        <h3>共同观测依据</h3><ul class="evidence-list">
          ${r.sampleEvidence.map(s => `<li>${esc(fmt(s.time))}：${s.distanceM}m，点 ${s.pointIds.map(esc).join(", ")}</li>`).join("")}
        </ul>
        <h3>轨迹依据点</h3><ul class="evidence-list">${evidenceItems(r.evidencePointIds)}</ul>`;
    }
  }

  function renderDetailEmpty() {
    selected = null;
    renderDetail();
  }

  function renderPointDetail(id) {
    const p = state.analysis.points.find(x => x.id === id);
    if (!p) return renderDetailEmpty();
    const local = new Date(p.time ?? Date.now());
    const value = Number.isFinite(p.time)
      ? `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}T${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}:${String(local.getSeconds()).padStart(2, "0")}`
      : "";
    $("detailPanel").innerHTML = `<h2>数据点 ${esc(p.id)}</h2>
      ${badge(p.targetId, "info")}${p.canonical ? badge("参与推导", "good") : badge("保留/排除", "bad")}${pointBadges(p)}
      <form id="editPointForm" class="selection-list">
        <label>ID <input name="id" value="${esc(p.id)}"></label>
        <label>目标 <input name="targetId" value="${esc(p.targetId)}"></label>
        <label>时刻 <input name="time" type="datetime-local" step="1" value="${esc(value)}"></label>
        <label>纬度 <input name="lat" value="${esc(p.rawLat ?? p.lat)}"></label>
        <label>经度 <input name="lon" value="${esc(p.rawLon ?? p.lon)}"></label>
        <div><button type="submit">保存并局部更新</button>
        <button id="deletePoint" type="button">删除该点</button></div>
      </form>
      <h3>系统识别记录</h3>
      ${p.anomalies.length ? `<ul>${p.anomalies.map(a => `<li><strong>${esc(a.message)}</strong><br><span class="muted">${esc(JSON.stringify(a.details))}</span></li>`).join("")}</ul>` : `<p class="muted">未发现异常。</p>`}
      <p class="muted">原始到达顺序：${p.originalOrder}。异常点不会被静默删除；“排除”只表示不参与连续插值/分段，仍在表格和时间轴中可见。</p>`;
  }

  function rawIndexForEditedPoint(originalId, form) {
    return state.rawPoints.findIndex(p => String(p.id) === originalId);
  }

  function commitPointEdit(originalPoint, form) {
    const index = rawIndexForEditedPoint(originalPoint.id, form);
    if (index < 0) return;
    const oldTarget = String(originalPoint.targetId);
    const edited = {
      id: form.id.value.trim(),
      targetId: form.targetId.value.trim(),
      time: form.time.value,
      lat: form.lat.value.trim(),
      lon: form.lon.value.trim(),
      originalOrder: originalPoint.originalOrder,
      _key: originalPoint._key
    };
    state.rawPoints[index] = edited;
    const affected = new Set([oldTarget, edited.targetId]);
    core.recomputeState(state, [...affected], "point_edit");
    selected = `point:${edited.id}`;
    renderAll();
  }

  function wireEvents() {
    document.body.addEventListener("click", e => {
      const el = e.target.closest("[data-select]");
      if (el) {
        selected = el.dataset.select;
        renderDetail();
      }
    });

    document.body.addEventListener("submit", e => {
      if (e.target.id === "editPointForm") {
        e.preventDefault();
        const id = selected.split(":")[1];
        const p = state.analysis.points.find(x => x.id === id);
        if (p) commitPointEdit(state.rawPoints.find(x => x.id === p.id), e.target);
      }
      if (e.target.id === "pointForm") {
        e.preventDefault();
        const f = e.target;
        state.rawPoints.push({
          id: f.id.value.trim() || `P${Date.now()}`, targetId: f.targetId.value,
          time: f.time.value, lat: f.lat.value, lon: f.lon.value,
          originalOrder: state.rawPoints.length,
          _key: `key-ui-${Date.now()}-${state.rawPoints.length}`
        });
        core.recomputeState(state, [f.targetId.value], "point_edit");
        renderAll();
      }
    });

    document.body.addEventListener("click", e => {
      if (e.target.id !== "deletePoint") return;
      const id = selected.split(":")[1];
      const index = state.rawPoints.findIndex(p => p.id === id);
      if (index >= 0) {
        const target = state.rawPoints[index].targetId;
        state.rawPoints.splice(index, 1);
        core.recomputeState(state, [String(target)], "point_edit");
        selected = null;
        renderAll();
      }
    });
  }

  $("sampleBtn").addEventListener("click", () => {
    const next = core.createState(window.MovementDemoSample.buildSamplePoints(), core.DEFAULT_PARAMS);
    Object.keys(state).forEach(k => delete state[k]);
    Object.assign(state, next);
    selected = null;
    renderAll();
  });

  $("pasteBtn").addEventListener("click", () => $("pasteDialog").showModal());
  $("pasteDialog").addEventListener("close", () => {
      if ($("pasteDialog").returnValue !== "confirm") return;
      try {
        core.updatePoints(state, parseImport($("pasteText").value, "csv"));
        selected = null;
        renderAll();
      } catch (err) { alert("导入失败：" + err.message); }
  });

  $("fileInput").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      core.updatePoints(state, parseImport(await file.text(), file.name));
      selected = null;
      renderAll();
    } catch (err) {
      alert("导入失败：" + err.message);
    } finally {
      e.target.value = "";
    }
  });

  let paramTimer = 0;
  document.querySelector(".params").addEventListener("input", () => {
    clearTimeout(paramTimer);
    paramTimer = setTimeout(() => {
      const next = readParams();
      const old = state.analysis.params;
        const normalizedChanged = next.driftSpeed !== old.driftSpeed;
        const targetChanged = ["clusterRadius", "minStayDuration"].some(k => next[k] !== old[k]);
        const companionChanged = ["companionRadius", "stableCompanionDuration", "maxTrackingGap"].some(k => next[k] !== old[k]);
        if (targetChanged || companionChanged) {
          core.updateParams(state, next, {
            normalizedParams: normalizedChanged, targetParams: targetChanged, companionParams: companionChanged
          });
          renderAll();
        }
    }, 250);
  });

  $("resetParams").addEventListener("click", () => {
    core.updateParams(state, core.DEFAULT_PARAMS, { normalizedParams: true, targetParams: true, companionParams: true });
    renderAll();
  });

  $("exportBtn").addEventListener("click", () => {
    const payload = {
      generatedAt: new Date().toISOString(), params: state.analysis.params,
      points: state.analysis.points, targetSegments: state.analysis.targets,
      companionRelations: state.analysis.relations, companionGroups: state.analysis.groups,
      relationChanges: state.relationChanges
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "movement-pattern-result.json"; a.click();
    URL.revokeObjectURL(url);
  });

  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === btn));
      document.querySelectorAll(".tab-view").forEach(v => v.classList.toggle("active", v.id === btn.dataset.tab + "View"));
    });
  });

  window.AppInternals = { get state() { return state; } };
  wireEvents();
  renderAll();
})();
