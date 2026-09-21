/* 评分工作台 UI：状态管理、实时重算、等级变化对照。 */
(function () {
  "use strict";
  const E = window.ScoringEngine;
  const STORAGE_KEY = "skillcamp-scoring-workbench-v1";

  const state = loadState() || {
    scheme: E.defaultScheme(),
    students: [
      { id: "s1", name: "张三", scores: { tech: 88, comm: 72, team: 90, deliver: 65, attitude: 95 } },
      { id: "s2", name: "李四", scores: { tech: 60, comm: null, team: 55, deliver: 70, attitude: 80 } },
    ],
    currentStudentId: "s1",
    changeLog: [],
  };
  let lastResult = null; // 上一次计算结果，用于检测等级变化

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  function currentStudent() {
    return state.students.find((s) => s.id === state.currentStudentId) || state.students[0];
  }
  function $(id) {
    return document.getElementById(id);
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ---------- 渲染 ---------- */

  function renderStudentPicker() {
    const select = $("studentSelect");
    select.innerHTML = "";
    for (const s of state.students) {
      const opt = el("option", "", s.name);
      opt.value = s.id;
      select.appendChild(opt);
    }
    select.value = currentStudent().id;
  }

  function renderScoreRows(result) {
    const host = $("scoreRows");
    host.innerHTML = "";
    const student = currentStudent();
    for (const dim of result.dimensions) {
      const row = el("div", "dim-row");
      const head = el("div", "head");
      head.appendChild(el("span", "name", dim.name));
      head.appendChild(el("span", "weight-tag", `权重 ${dim.weight}%（有效 ${dim.effectiveWeight}%）`));

      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.max = "100";
      input.placeholder = "缺分";
      const raw = student.scores[dim.id];
      if (raw !== null && raw !== undefined) input.value = raw;
      input.dataset.focusKey = "score-" + dim.id;
      input.dataset.dimId = dim.id;
      input.addEventListener("input", onScoreInput);
      head.appendChild(input);

      if (dim.excluded) {
        head.appendChild(el("span", "missing-tag", `缺分 · ${dim.strategyLabel} · 已剔除`));
      } else {
        if (dim.missing) head.appendChild(el("span", "missing-tag", `缺分 · ${dim.strategyLabel}`));
        const badge = el("span", "band-badge" + (dim.lowestBand ? " lowest" : ""), dim.band);
        head.appendChild(badge);
      }
      row.appendChild(head);

      const bar = el("div", "contrib-bar");
      const fill = document.createElement("div");
      fill.style.width = Math.min(100, dim.contribution) + "%";
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(el("div", "contrib-text",
        dim.excluded ? "该维度被剔除，权重已分摊到其余维度" : `得分贡献：${dim.contribution} 分`));
      host.appendChild(row);
    }
  }

  function renderResult(result, explanation) {
    $("totalScore").textContent = result.total;
    $("totalGrade").textContent = result.grade;
    const list = $("explanationList");
    list.innerHTML = "";
    for (const line of explanation.lines) list.appendChild(el("li", "", line));
  }

  function renderScheme() {
    const sum = state.scheme.dimensions.reduce((s, d) => s + (Number(d.weight) || 0), 0);
    const rounded = Math.round(sum * 100) / 100;
    $("weightSum").textContent = rounded;
    const consistent = Math.abs(rounded - 100) < 1e-9;
    const status = $("weightStatus");
    status.textContent = consistent ? "一致" : "不一致，已按归一化计算";
    status.className = "badge " + (consistent ? "ok" : "warn");
    $("normalizeBtn").classList.toggle("hidden", consistent);

    const host = $("schemeRows");
    host.innerHTML = "";
    const header = el("div", "scheme-row");
    header.appendChild(el("span", "col-label", "维度"));
    header.appendChild(el("span", "col-label", "权重 %"));
    header.appendChild(el("span", "col-label", "缺省分"));
    header.appendChild(el("span", "col-label", "缺分策略"));
    host.appendChild(header);

    for (const d of state.scheme.dimensions) {
      const row = el("div", "scheme-row");
      row.appendChild(el("span", "", d.name));

      const weightInput = document.createElement("input");
      weightInput.type = "number";
      weightInput.min = "0";
      weightInput.max = "100";
      weightInput.value = d.weight;
      weightInput.dataset.focusKey = "weight-" + d.id;
      weightInput.addEventListener("input", () => {
        d.weight = Number(weightInput.value) || 0;
        recompute(`调整「${d.name}」权重为 ${d.weight}%`);
      });
      row.appendChild(weightInput);

      const defInput = document.createElement("input");
      defInput.type = "number";
      defInput.min = "0";
      defInput.max = "100";
      defInput.value = d.defaultScore;
      defInput.dataset.focusKey = "default-" + d.id;
      defInput.addEventListener("input", () => {
        d.defaultScore = Number(defInput.value) || 0;
        recompute(`调整「${d.name}」缺省分为 ${d.defaultScore}`);
      });
      row.appendChild(defInput);

      const select = document.createElement("select");
      for (const [key, label] of Object.entries(E.MISSING_STRATEGIES)) {
        const opt = el("option", "", label);
        opt.value = key;
        select.appendChild(opt);
      }
      select.value = d.missingStrategy;
      select.dataset.focusKey = "strategy-" + d.id;
      select.addEventListener("change", () => {
        d.missingStrategy = select.value;
        recompute(`调整「${d.name}」缺分策略`);
      });
      row.appendChild(select);
      host.appendChild(row);
    }

    const bandsHost = $("overallBands");
    bandsHost.innerHTML = "";
    for (const b of state.scheme.overallBands) {
      bandsHost.appendChild(el("div", "band-row", `≥ ${b.min} 分：${b.label}`));
    }
  }

  function renderChangeLog() {
    const host = $("changeLog");
    host.innerHTML = "";
    if (!state.changeLog.length) {
      host.appendChild(el("p", "empty-log", "暂无等级变化记录。"));
      return;
    }
    for (const entry of [...state.changeLog].reverse()) {
      const box = el("div", "entry");
      box.appendChild(el("div", "meta",
        `${entry.time} · ${entry.student} · ${entry.cause} · 等级 ${entry.before.grade} → ${entry.after.grade}`));
      const compare = el("div", "compare");
      compare.appendChild(buildSide("改动前", entry.before));
      compare.appendChild(buildSide("改动后", entry.after));
      box.appendChild(compare);
      host.appendChild(box);
    }
  }

  function buildSide(title, snapshot) {
    const side = el("div", "side");
    side.appendChild(el("h4", "", `${title}：${snapshot.total} 分 · ${snapshot.grade}`));
    const ul = document.createElement("ul");
    for (const line of snapshot.lines) ul.appendChild(el("li", "", line));
    side.appendChild(ul);
    return side;
  }

  /* ---------- 重算与等级变化检测 ---------- */

  function recompute(cause) {
    const student = currentStudent();
    const result = E.computeResult(state.scheme, student.scores);
    const explanation = E.buildExplanation(state.scheme, result);
    const focusKey = document.activeElement && document.activeElement.dataset
      ? document.activeElement.dataset.focusKey
      : null;
    const caret = document.activeElement && "selectionStart" in document.activeElement
      ? document.activeElement.selectionStart
      : null;

    const change = E.detectGradeChange(lastResult && lastResult.result, result);
    const banner = $("gradeChangeBanner");
    if (change && cause) {
      banner.textContent = `等级变化：${change.from}（${change.fromTotal} 分）→ ${change.to}（${change.toTotal} 分），由「${cause}」触发。`;
      banner.classList.remove("hidden");
      state.changeLog.push({
        time: new Date().toLocaleString("zh-CN"),
        student: student.name,
        cause,
        before: snapshot(lastResult),
        after: snapshot({ result, explanation }),
      });
    } else if (!cause) {
      // 切换学员或初始化时隐藏提示；普通编辑保留最近一次等级变化提示。
      banner.classList.add("hidden");
    }

    lastResult = { result, explanation };
    renderScoreRows(result);
    renderResult(result, explanation);
    renderScheme();
    renderChangeLog();
    saveState();
    if (focusKey) {
      const target = document.querySelector(`[data-focus-key="${focusKey}"]`);
      if (target) {
        target.focus();
        if (caret !== null && "setSelectionRange" in target) {
          try { target.setSelectionRange(caret, caret); } catch (e) { /* 忽略 */ }
        }
      }
    }
  }

  function snapshot(entry) {
    return {
      total: entry.result.total,
      grade: entry.result.grade,
      lines: entry.explanation.lines.slice(),
    };
  }

  /* ---------- 事件 ---------- */

  function onScoreInput(e) {
    const dimId = e.target.dataset.dimId;
    const student = currentStudent();
    const dim = state.scheme.dimensions.find((d) => d.id === dimId);
    const v = e.target.value.trim();
    student.scores[dimId] = v === "" ? null : Number(v);
    recompute(v === "" ? `清空「${dim.name}」分数` : `调整「${dim.name}」分数为 ${v}`);
  }

  function bindStaticEvents() {
    $("studentSelect").addEventListener("change", (e) => {
      state.currentStudentId = e.target.value;
      lastResult = null; // 切换学员不做等级变化对比
      recompute(null);
    });
    $("addStudentBtn").addEventListener("click", () => {
      const name = $("newStudentName").value.trim();
      if (!name) return;
      const id = "s" + Date.now();
      state.students.push({ id, name, scores: {} });
      state.currentStudentId = id;
      $("newStudentName").value = "";
      lastResult = null;
      renderStudentPicker();
      recompute(null);
    });
    $("normalizeBtn").addEventListener("click", () => {
      const sum = state.scheme.dimensions.reduce((s, d) => s + (Number(d.weight) || 0), 0);
      if (sum <= 0) return;
      const dims = state.scheme.dimensions;
      for (const d of dims) d.weight = Math.round(((d.weight / sum) * 100) * 100) / 100;
      // 舍入残差补到权重最大的维度，保证合计精确为 100。
      const residual = Math.round((100 - dims.reduce((s, d) => s + d.weight, 0)) * 100) / 100;
      if (residual !== 0) {
        const largest = dims.reduce((a, b) => (b.weight > a.weight ? b : a), dims[0]);
        largest.weight = Math.round((largest.weight + residual) * 100) / 100;
      }
      recompute("权重归一化到 100");
    });
  }

  /* ---------- 启动 ---------- */

  renderStudentPicker();
  bindStaticEvents();
  recompute(null);
})();
