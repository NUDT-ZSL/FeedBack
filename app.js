(() => {
  "use strict";
  const E = window.ProductionEngine;
  const STORE_KEY = "production-chain-workbench-v1";

  const sample = {
    resources: [
      { id: "drill", name: "电钻", initialStock: 0, source: "manual" },
      { id: "motor", name: "电机", initialStock: 2, source: "manual" },
      { id: "gear", name: "齿轮组", initialStock: 4, source: "manual" },
      { id: "shaft", name: "转轴", initialStock: 1, source: "manual" },
      { id: "body", name: "机壳", initialStock: 3, source: "manual" },
      { id: "plate", name: "钢板", initialStock: 10, source: "manual" },
      { id: "bar", name: "棒料", initialStock: 20, source: "manual" },
      { id: "raw", name: "备用原料", initialStock: 10, source: "manual" }
    ],
    recipes: [
      { id: "r_drill", name: "电钻装配", outputId: "drill", outputQty: 1, enabled: true,
        inputs: [{ resourceId: "motor", qty: 1 }, { resourceId: "gear", qty: 2 },
          { resourceId: "body", qty: 1 }] },
      { id: "r_motor", name: "电机制造", outputId: "motor", outputQty: 1, enabled: true,
        inputs: [{ resourceId: "shaft", qty: 2 }] },
      { id: "r_gear", name: "齿轮冲压", outputId: "gear", outputQty: 2, enabled: true,
        inputs: [{ resourceId: "plate", qty: 1 }] },
      { id: "r_body", name: "机壳成型", outputId: "body", outputQty: 1, enabled: true,
        inputs: [{ resourceId: "plate", qty: 3 }] },
      { id: "r_shaft", name: "转轴车削", outputId: "shaft", outputQty: 1, enabled: true,
        inputs: [{ resourceId: "bar", qty: 2 }] }
    ],
    targetId: "drill",
    targetQty: 5
  };

  let state = loadState();
  let previousRun = null;
  let change = null;

  const $ = (id) => document.getElementById(id);
  const fmt = (value) => String(E.round(Number(value) || 0));

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (saved && Array.isArray(saved.resources) && Array.isArray(saved.recipes)) return saved;
    } catch (error) { console.warn("本地数据读取失败，使用示例", error); }
    return JSON.parse(JSON.stringify(sample));
  }
  function saveState() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }
  function findResource(id) { return state.resources.find((item) => item.id === id); }
  function findRecipe(id) { return state.recipes.find((item) => item.id === id); }

  function parseInputs(text) {
    return text.split(",").map((part) => part.trim()).filter(Boolean).map((part, index) => {
      const pieces = part.split(":");
      if (pieces.length !== 2) throw new Error(`第 ${index + 1} 段投入格式应为 资源ID:用量`);
      const qty = Number(pieces[1]);
      if (!Number.isFinite(qty) || qty <= 0) throw new Error(`投入 ${pieces[0]} 的用量必须是正数`);
      return { resourceId: pieces[0].trim(), qty };
    });
  }

  function runProjection() {
    saveState();
    const request = { targetId: state.targetId, targetQty: Number(state.targetQty) };
    const result = previousRun && change
      ? E.projectIncremental({ resources: state.resources, recipes: state.recipes,
          conflicts: previousRun.conflicts }, request, previousRun)
      : E.projectIncremental({ resources: state.resources, recipes: state.recipes }, request, null);
    previousRun = result;
    change = null;
    render(result);
  }

  function validateCandidate(candidate) {
    const checked = E.buildConflicts(candidate);
    if (!checked.valid) {
      render(Object.assign({
        feasible: false,
        validationErrors: checked.errors,
        conflicts: checked.conflicts || [],
        levels: [], groups: [], production: [], alternativesTried: [],
        targetId: state.targetId, targetQty: state.targetQty
      }, checked));
      return false;
    }
    return true;
  }

  function sourceList(sources = []) {
    if (!sources.length) return "";
    return sources.map((s) =>
      `${s.fromResource}${s.recipeId ? ` via ${s.recipeId}` : ""}：需求 ${fmt(s.requested)}` +
      `${s.shortageAtParent ? `，父缺口 ${fmt(s.shortageAtParent)}` : ""}` +
      `${s.qtyPerOutput ? `，单耗 ×${fmt(s.qtyPerOutput)}` : ""}`
    ).join("<br>");
  }

  function renderTargetOptions() {
    $("targetId").innerHTML = state.resources.map((r) =>
      `<option value="${escapeHtml(r.id)}" ${r.id === state.targetId ? "selected" : ""}>${escapeHtml(r.id)}${r.name ? ` / ${r.name}` : ""}</option>`
    ).join("");
    $("targetQty").value = state.targetQty;
  }

  function renderErrors(result) {
    const errors = result.validationErrors || [];
    const box = $("validationErrors");
    if (!errors.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = errors.map((e) => `<div><strong>${escapeHtml(e.code)}</strong>：${escapeHtml(e.location || "")} — ${escapeHtml(e.message)}</div>`).join("");
  }

  function renderStatus(result) {
    const status = $("runStatus");
    const banner = $("shortageBanner");
    renderErrors(result);
    if ((result.validationErrors || []).length) {
      status.className = "status-card bad";
      status.textContent = "数据被拒绝：请根据下方位置修正。";
      banner.hidden = true;
      return;
    }
    if (!result.feasible) {
      status.className = "status-card bad";
      status.textContent = "推演停止：存在无法补齐的缺口";
      const e = result.earliestShortage;
      banner.hidden = false;
      banner.innerHTML = `最早断供：第 <strong>${e.level}</strong> 级资源 <strong>${escapeHtml(e.resourceId)}</strong><br>${escapeHtml(e.reason)}`;
      return;
    }
    status.className = "status-card";
    const hits = result.stats?.cacheHits?.length || 0;
    status.textContent = `推演可满足；${hits ? `增量复用 ${hits} 个未受影响需求节点` : "已完成全量推演"}。`;
    banner.hidden = true;
  }

  function renderLevels(result) {
    $("levels").innerHTML = (result.levels || []).map((level) =>
      `<div class="level-card"><strong>L${level.level}</strong><span>需求 ${fmt(level.totalRequested)}</span><br><span class="${level.totalShortage > 0 ? "tag bad" : "tag ok"}">缺口 ${fmt(level.totalShortage)}</span></div>`
    ).join("");
    $("resultRows").innerHTML = (result.groups || []).map((g) =>
      `<tr class="${g.shortage > 0 ? "is-shortage" : ""}">
        <td>${g.level}</td><td class="mono">${escapeHtml(g.resourceId)}</td>
        <td>${fmt(g.requested)}</td><td>×${fmt(g.amplification)}</td>
        <td>${fmt(g.stockUsed)}</td><td>${fmt(g.produced)}</td>
        <td><span class="tag ${g.shortage > 0 ? "bad" : "ok"}">${fmt(g.shortage)}</span></td>
        <td class="sources">${sourceList(g.sources)}</td></tr>`
    ).join("");
    const info = $("incrementalInfo");
    if (result.stats?.affectedResourceIds?.length)
      info.textContent = `受影响：${result.stats.affectedResourceIds.join(", ")}（${result.stats.changeReason || ""}）`;
    else info.textContent = "全量推演";
    $("attempts").innerHTML = (result.alternativesTried || []).length
      ? `<h3>替代配方尝试与阻断</h3><ul>${result.alternativesTried.map((a) =>
          `<li>L${a.level} ${escapeHtml(a.resourceId)} / ${escapeHtml(a.recipeId || "无配方")}：${escapeHtml(a.result)}</li>`).join("")}</ul>`
      : "";
  }

  function renderConflicts(result) {
    const conflicts = result.conflicts || [];
    $("conflicts").innerHTML = conflicts.length ? conflicts.map((c, index) => {
      const claimButtons = (c.claims || []).map((claim, i) =>
        `<button type="button" data-conflict="${index}" data-claim="${i}">采用：${escapeHtml(claim.source)} = ${escapeHtml(String(claim.initialStock ?? ""))}</button>`
      ).join("");
      return `<div class="conflict-item ${c.resolution ? "resolved" : ""}">
        <strong>${c.kind === "resource" ? "库存冲突" : "配方冲突"}：${escapeHtml(c.resourceId || c.recipeId)}</strong>
        <p>${escapeHtml(c.message)}</p>
        ${c.resolution ? `<span class="tag ok">已处理：${escapeHtml(c.resolution.note || "手动采用")}</span>`
          : `<div class="conflict-actions">${claimButtons}</div>`}
      </div>`;
    }).join("") : `<span class="tag muted">当前没有冲突</span>`;
  }

  function renderTables(result) {
    const conflictResources = new Set((result.conflicts || [])
      .filter((c) => c.kind === "resource" && !c.resolution).map((c) => c.resourceId));
    $("resourceRows").innerHTML = state.resources.map((r, i) => `
      <tr>
        <td class="mono">${escapeHtml(r.id)} ${conflictResources.has(r.id) ? '<span class="tag warn">冲突</span>' : ""}</td>
        <td>${escapeHtml(r.name || "")}</td>
        <td><input type="number" min="0" step="0.0001" value="${escapeHtml(String(r.initialStock))}" data-resource-stock="${i}"></td>
        <td>${escapeHtml(r.source || "manual")}</td>
        <td class="row-actions"><button type="button" class="danger" data-delete-resource="${i}">删除</button></td>
      </tr>`).join("");

    const conflictRecipes = new Set((result.conflicts || [])
      .filter((c) => c.kind === "recipe" && !c.resolution).map((c) => c.recipeId));
    $("recipeRows").innerHTML = state.recipes.map((p, i) => `
      <tr>
        <td><input type="checkbox" ${p.enabled ? "checked" : ""} data-recipe-enabled="${i}"></td>
        <td class="mono">${escapeHtml(p.id)} ${conflictRecipes.has(p.id) ? '<span class="tag warn">冲突停用</span>' : ""}</td>
        <td>${escapeHtml(p.outputId)} × ${fmt(p.outputQty)}</td>
        <td>${p.inputs.map((x) => `${escapeHtml(x.resourceId)}:${fmt(x.qty)}`).join("<br>")}</td>
        <td>${escapeHtml(p.source || "manual")}</td>
        <td class="row-actions"><button type="button" class="danger" data-delete-recipe="${i}">删除</button></td>
      </tr>`).join("");
  }

  function renderGraph(result) {
    const groups = result.groups || [];
    const maxLevel = Math.max(-1, ...groups.map((g) => g.level));
    const columns = [];
    for (let level = 0; level <= maxLevel; level += 1) {
      columns.push(`<div class="graph-column"><h3>第 ${level} 级</h3>` +
        groups.filter((g) => g.level === level).map((g) =>
          `<div class="graph-node ${g.shortage > 0 ? "shortage" : ""}">
            <h3>${escapeHtml(g.resourceId)}</h3>
            <p>需求 ${fmt(g.requested)} / 库存 ${fmt(g.stockUsed)} / 产出 ${fmt(g.produced)}</p>
            <p>放大 ×${fmt(g.amplification)}　缺口 <strong>${fmt(g.shortage)}</strong></p>
          </div>`).join("") + `</div>`);
    }
    $("graph").innerHTML = columns.join("");
  }

  function render(result) {
    renderTargetOptions();
    renderStatus(result);
    if ((result.validationErrors || []).length) {
      $("levels").innerHTML = "";
      $("resultRows").innerHTML = "";
      $("attempts").innerHTML = "";
      $("incrementalInfo").textContent = "数据校验未通过";
      renderConflicts(result);
      $("resourceRows").innerHTML = state.resources.map((r, i) => `
        <tr><td class="mono">${escapeHtml(r.id)}</td><td>${escapeHtml(r.name || "")}</td>
        <td><input type="number" min="0" value="${escapeHtml(String(r.initialStock))}" data-resource-stock="${i}"></td>
        <td>${escapeHtml(r.source || "manual")}</td><td></td></tr>`).join("");
      $("recipeRows").innerHTML = state.recipes.map((p, i) => `
        <tr><td><input type="checkbox" ${p.enabled ? "checked" : ""} data-recipe-enabled="${i}"></td>
        <td class="mono">${escapeHtml(p.id)}</td><td>${escapeHtml(p.outputId)}</td>
        <td>${p.inputs.map((x) => escapeHtml(x.resourceId)).join(",")}</td>
        <td>${escapeHtml(p.source || "manual")}</td><td></td></tr>`).join("");
      $("graph").innerHTML = "";
      return;
    }
    renderLevels(result);
    renderConflicts(result);
    renderTables(result);
    renderGraph(result);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (s) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]));
  }

  $("targetId").addEventListener("change", (event) => {
    state.targetId = event.target.value;
    previousRun = null;
    runProjection();
  });
  $("targetQty").addEventListener("input", (event) => {
    state.targetQty = event.target.value;
    previousRun = null;
    runProjection();
  });

  $("resourceForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const item = {
      id: String(data.get("id")).trim(),
      name: String(data.get("name") || "").trim(),
      initialStock: Number(data.get("initialStock")),
      source: String(data.get("source") || "manual").trim() || "manual"
    };
    const candidate = { resources: state.resources.concat(item), recipes: state.recipes };
    if (!validateCandidate(candidate)) return;
    state.resources.push(item);
    event.currentTarget.reset();
    previousRun = null;
    runProjection();
  });

  $("recipeForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const recipe = {
        id: String(data.get("id")).trim(),
        name: String(data.get("id")).trim(),
        outputId: String(data.get("outputId")).trim(),
        outputQty: Number(data.get("outputQty")),
        enabled: true,
        source: String(data.get("source") || "manual").trim() || "manual",
        inputs: parseInputs(String(data.get("inputs")))
      };
      const candidate = { resources: state.resources, recipes: state.recipes.concat(recipe) };
      if (!validateCandidate(candidate)) return;
      state.recipes.push(recipe);
      event.currentTarget.reset();
      previousRun = null;
      runProjection();
    } catch (error) {
      alert(error.message);
    }
  });

  document.addEventListener("input", (event) => {
    const stockIndex = event.target.getAttribute("data-resource-stock");
    if (stockIndex !== null) {
      const item = state.resources[Number(stockIndex)];
      const value = Number(event.target.value);
      if (!Number.isFinite(value) || value < 0) {
        const candidate = { resources: state.resources, recipes: state.recipes };
        const checked = E.buildConflicts(candidate);
        render(Object.assign({
          feasible: false,
          validationErrors: [{ code: "INVALID_STOCK",
            location: `资源 ${item.id} 的库存输入框`,
            message: "初始库存必须是非负数字" }],
          conflicts: checked.conflicts || [],
          levels: [], groups: [], production: [], alternativesTried: [],
          targetId: state.targetId, targetQty: state.targetQty
        }, checked));
        return;
      }
      if (true) {
        item.initialStock = value;
        change = { resourceIds: [item.id], reason: "库存修正" };
        runProjection();
      }
    }
  });
  document.addEventListener("change", (event) => {
    const recipeIndex = event.target.getAttribute("data-recipe-enabled");
    if (recipeIndex !== null) {
      const item = state.recipes[Number(recipeIndex)];
      item.enabled = event.target.checked;
      change = { recipeId: item.id, resourceIds: [item.outputId], reason: item.enabled ? "配方恢复" : "配方停用" };
      runProjection();
    }
  });
  document.addEventListener("click", (event) => {
    const deleteResource = event.target.getAttribute("data-delete-resource");
    const deleteRecipe = event.target.getAttribute("data-delete-recipe");
    if (deleteResource !== null) {
      const [removed] = state.resources.splice(Number(deleteResource), 1);
      change = { resourceIds: [removed.id], reason: "资源删除" };
      runProjection();
    }
    if (deleteRecipe !== null) {
      const removed = state.recipes[Number(deleteRecipe)];
      state.recipes.splice(Number(deleteRecipe), 1);
      change = { recipeId: removed.id, resourceIds: [removed.outputId], reason: "配方删除" };
      runProjection();
    }
    const conflictIndex = event.target.getAttribute("data-conflict");
    const claimIndex = event.target.getAttribute("data-claim");
    if (conflictIndex !== null && claimIndex !== null) resolveConflict(Number(conflictIndex), Number(claimIndex));
  });

  function resolveConflict(conflictIndex, claimIndex) {
    const checked = E.buildConflicts({ resources: state.resources, recipes: state.recipes });
    const c = checked.conflicts[conflictIndex];
    const chosen = c.claims[claimIndex];
    if (c.kind === "resource") {
      const item = findResource(c.resourceId);
      item.initialStock = Number(chosen.initialStock);
      item.source = chosen.source;
      state.resources = state.resources.filter((r) => r.id !== c.resourceId);
      state.resources.push(item);
    } else {
      const replacements = new Map(state.recipes.filter((p) => p.id === c.recipeId)
        .map((p, i) => [p.source, {
          id: c.recipeId, name: c.recipeId, outputId: chosen.outputId, outputQty: Number(chosen.outputQty),
          enabled: true, source: chosen.source, inputs: chosen.inputs.map((x) => ({ ...x }))
        }]));
      replacements.set(chosen.source, {
        id: c.recipeId, name: c.recipeId, outputId: chosen.outputId, outputQty: Number(chosen.outputQty),
        enabled: true, source: chosen.source, inputs: chosen.inputs.map((x) => ({ ...x }))
      });
      state.recipes = state.recipes.filter((p) => p.id !== c.recipeId).concat([...replacements.values()]);
    }
    previousRun = null;
    runProjection();
  }

  $("resetBtn").addEventListener("click", () => {
    if (confirm("恢复为内置示例？当前本地修改会被覆盖。")) {
      state = JSON.parse(JSON.stringify(sample));
      previousRun = null;
      runProjection();
    }
  });
  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "production-chain.json"; a.click();
    URL.revokeObjectURL(url);
  });
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    state = JSON.parse(await file.text());
    previousRun = null;
    runProjection();
    event.target.value = "";
  });

  runProjection();
})();
