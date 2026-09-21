/* 评分工作台界面状态。所有规则计算均委托 engine / narration。 */
(function () {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const engine = window.ScoringEngine;
  const schema = window.ScoringSchema;
  const narration = window.ScoringNarration;
  const STORAGE_KEY = "skills-scoring-workbench-v1";

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && saved.scheme && saved.students) return saved;
    } catch (error) {
      console.warn("本地数据无法读取，已使用演示数据。", error);
    }
    const scheme = schema.defaultScheme();
    return {
      scheme,
      students: schema.defaultStudents(),
      selectedStudentId: "s-lin",
      activeTab: "score",
      weightBaselines: {},
      comparisons: {},
      dismissed: {},
      revision: 0
    };
  }

  let state = loadState();

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("当前浏览器无法写入本地存储。", error);
    }
  }

  function selectedStudent() {
    return state.students.find((student) => student.id === state.selectedStudentId) ||
      state.students[0] || null;
  }

  function getResult(student, weights) {
    const workingScheme = weights
      ? Object.assign({}, state.scheme, { weights })
      : state.scheme;
    return engine.evaluate(workingScheme, student ? student.scores : {});
  }

  function gradeClass(grade) {
    if (/卓越|优秀|熟练|高/.test(grade)) return "green";
    if (/合格|良好/.test(grade)) return "blue";
    if (/待改进|需复训|复训|低/.test(grade)) return "red";
    return "gray";
  }

  function deltaHtml(value) {
    const label = value > 0.05 ? "+" + narration.formatScore(value) :
      value < -0.05 ? narration.formatScore(value) : "±0.0";
    const cls = value > 0.05 ? "delta-positive" :
      value < -0.05 ? "delta-negative" : "delta-neutral";
    return `<span class="${cls}">${label}</span>`;
  }

  function policyName(id) {
    const policy = schema.MISSING_POLICIES.find((item) => item.id === id);
    return policy ? policy.name : id;
  }

  function commit(nextFocus) {
    const active = document.activeElement;
    const focusMeta = active && active.dataset
      ? {
          selector: active.dataset.focus,
          start: active.selectionStart,
          end: active.selectionEnd
        }
      : null;
    saveState();
    renderApp();
    const wanted = nextFocus || (focusMeta && focusMeta.selector);
    if (wanted) {
      const element = document.querySelector(`[data-focus="${CSS.escape(wanted)}"]`);
      if (element) {
        element.focus();
        if (Number.isInteger(focusMeta && focusMeta.start)) {
          element.setSelectionRange(focusMeta.start, focusMeta.end);
        }
      }
    }
  }

  function setBaseline(studentId) {
    const student = state.students.find((item) => item.id === studentId);
    if (!student) return;
    state.weightBaselines[studentId] = {
      weights: Object.assign({}, state.scheme.weights),
      outcome: getResult(student),
      updatedAt: new Date().toISOString(),
      revision: state.revision || 0
    };
  }

  function handleFocusIn(event) {
    const target = event.target;
    if (target.dataset && target.dataset.type === "weight") {
      const current = selectedStudent();
      const studentId = target.dataset.studentId || current && current.id;
      if (studentId && !state.weightBaselines[studentId]) setBaseline(studentId);
      if (studentId) state.dismissed[studentId] = false;
    }
  }

  function applyWeightChange(dimensionId, value) {
    const beforeWeights = Object.assign({}, state.scheme.weights);
    state.scheme.weights = schema.allocateIntegerWeights(
      beforeWeights, dimensionId, value
    );
    state.scheme.dimensions.forEach((dim) => {
      dim.weight = state.scheme.weights[dim.id];
    });
    state.students.forEach((student) => {
      const baseline = state.weightBaselines[student.id];
      if (!baseline || state.dismissed[student.id]) return;
      const before = baseline.outcome;
      const after = getResult(student);
      const comparison = narration.compareOutcomes(before, after);
      if (comparison) state.comparisons[student.id] = comparison;
    });
  }

  function invalidateEvidence() {
    state.weightBaselines = {};
    state.comparisons = {};
    state.dismissed = {};
    state.revision = (state.revision || 0) + 1;
  }

  function handleInput(event) {
    const target = event.target;
    if (!target.dataset || !target.dataset.type) return;
    const type = target.dataset.type;
    const student = selectedStudent();
    if (type === "score" && student) {
      delete state.weightBaselines[student.id];
      delete state.comparisons[student.id];
      state.revision = (state.revision || 0) + 1;
      const value = target.value.trim();
      if (value === "") delete student.scores[target.dataset.dimId];
      else student.scores[target.dataset.dimId] = Number(value);
      commit(target.dataset.focus);
    } else if (type === "weight") {
      const current = selectedStudent();
      const currentStudentId = target.dataset.studentId || current && current.id;
      const baseline = currentStudentId ? state.weightBaselines[currentStudentId] : null;
      if (currentStudentId && (!baseline || baseline.revision !== (state.revision || 0))) {
        setBaseline(currentStudentId);
      }
      if (currentStudentId) state.dismissed[currentStudentId] = false;
      applyWeightChange(target.dataset.dimId, target.value);
      commit(target.dataset.focus);
    } else if (type === "scheme-name") {
      state.scheme.name = target.value;
      commit(target.dataset.focus);
    } else if (type === "student-name") {
      if (student) student.name = target.value;
      commit(target.dataset.focus);
    } else if (type === "student-team") {
      if (student) student.team = target.value;
      commit(target.dataset.focus);
    } else if (type === "dimension-name") {
      const dim = state.scheme.dimensions.find((item) => item.id === target.dataset.dimId);
      if (dim) dim.name = target.value;
      state.revision = (state.revision || 0) + 1;
      commit(target.dataset.focus);
    } else if (type === "band-grade") {
      const dim = state.scheme.dimensions.find((item) => item.id === target.dataset.dimId);
      const collection = target.dataset.scope === "overall"
        ? state.scheme.overallBands : dim && dim.levels;
      if (collection) {
        collection[Number(target.dataset.index)].grade = target.value;
        invalidateEvidence();
      }
      commit(target.dataset.focus);
    } else if (type === "band-min") {
      const dim = state.scheme.dimensions.find((item) => item.id === target.dataset.dimId);
      const collection = target.dataset.scope === "overall"
        ? state.scheme.overallBands : dim && dim.levels;
      if (collection) {
        collection[Number(target.dataset.index)].min = Number(target.value);
        invalidateEvidence();
      }
      commit(target.dataset.focus);
    }
  }

  function handleChange(event) {
    const target = event.target;
    if (!target.dataset || !target.dataset.type) return;
    const student = selectedStudent();
    if (target.dataset.type === "missing-policy") {
      const dim = state.scheme.dimensions.find((item) => item.id === target.dataset.dimId);
      if (dim) {
        dim.missingPolicy = target.value;
        invalidateEvidence();
      }
    } else if (target.dataset.type === "max-score") {
      const dim = state.scheme.dimensions.find((item) => item.id === target.dataset.dimId);
      if (dim) {
        dim.maxScore = Math.max(1, Number(target.value) || 100);
        invalidateEvidence();
      }
    } else if (target.dataset.type === "score-select" && student) {
      state.selectedStudentId = target.value;
    }
    commit();
  }

  function addStudent() {
    const student = {
      id: schema.createId("s"),
      name: "新学员",
      team: "未分班",
      scores: {}
    };
    state.students.push(student);
    state.selectedStudentId = student.id;
    commit();
  }

  function addDimension() {
    const previous = Object.assign({}, state.scheme.weights);
    state.scheme.dimensions.forEach((dim) => {
      previous[dim.id] = dim.weight;
    });
    const id = schema.createId("d");
    const rebalanced = schema.allocateIntegerWeights(previous, id, 0);
    const dimension = {
      id,
      name: "新维度",
      weight: 0,
      maxScore: 100,
      missingPolicy: "prorate",
      levels: schema.defaultLevels()
    };
    state.scheme.dimensions.push(dimension);
      invalidateEvidence();
      state.scheme.weights = rebalanced;
    commit();
  }

  function removeDimension(id) {
    if (state.scheme.dimensions.length <= 1) return;
    state.scheme.dimensions = state.scheme.dimensions.filter((dim) => dim.id !== id);
    const removedWeight = state.scheme.weights[id] || 0;
    delete state.scheme.weights[id];
    const remaining = state.scheme.dimensions;
    const remainingSum = remaining.reduce((sum, dim) => {
      return sum + (state.scheme.weights[dim.id] || 0);
    }, 0);
    if (remainingSum > 0) {
      let toAdd = removedWeight;
      remaining.forEach((dim, index) => {
        const current = state.scheme.weights[dim.id] || 0;
        const exact = removedWeight * current / remainingSum;
        const take = index === remaining.length - 1 ? toAdd : Math.round(exact);
        state.scheme.weights[dim.id] = current + take;
        toAdd -= take;
      });
    } else {
      remaining.forEach((dim) => { state.scheme.weights[dim.id] = 0; });
      state.scheme.weights[remaining[0].id] = 100;
    }
    remaining.forEach((dim) => { dim.weight = state.scheme.weights[dim.id]; });
    invalidateEvidence();
    state.students.forEach((student) => delete student.scores[id]);
    commit();
  }

  function normalizeWeightsNow() {
    const currentStudent = selectedStudent();
    if (currentStudent) setBaseline(currentStudent.id);
    const dims = state.scheme.dimensions;
    const values = dims.map((dim) => Number(state.scheme.weights[dim.id]) || 0);
    const total = values.reduce((sum, value) => sum + value, 0);
    if (total <= 0) {
      dims.forEach((dim, index) => {
        state.scheme.weights[dim.id] = index === 0 ? 100 : 0;
      });
    } else {
      const exact = values.map((value) => value * 100 / total);
      const floored = exact.map((value) => Math.floor(value));
      let leftover = 100 - floored.reduce((sum, value) => sum + value, 0);
      exact.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
        .sort((a, b) => b.fraction - a.fraction)
        .forEach((item, rank) => {
          if (rank < leftover) floored[item.index] += 1;
        });
      dims.forEach((dim, index) => { state.scheme.weights[dim.id] = floored[index]; });
    }
    dims.forEach((dim) => { dim.weight = state.scheme.weights[dim.id]; });
    if (currentStudent) {
      const before = state.weightBaselines[currentStudent.id].outcome;
      const after = getResult(currentStudent);
      const comparison = narration.compareOutcomes(before, after);
      if (comparison) state.comparisons[currentStudent.id] = comparison;
    }
    commit();
  }

  function resetDemo() {
    const scheme = schema.defaultScheme();
    state.scheme = scheme;
    state.students = schema.defaultStudents();
    state.selectedStudentId = state.students[0].id;
    state.weightBaselines = {};
    state.comparisons = {};
    state.dismissed = {};
    state.activeTab = "score";
    state.revision = 0;
    commit();
  }

  function findFreeThreshold(bands) {
    const mins = bands.map((band) => Number(band.min)).filter(Number.isFinite);
    const sorted = mins.slice().sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const middle = Math.round((sorted[i] + sorted[i + 1]) / 2);
      if (middle > sorted[i] && middle < sorted[i + 1] && !mins.includes(middle)) {
        return middle;
      }
    }
    for (const value of [85, 70, 50, 95, 30]) {
      if (!mins.includes(value)) return value;
    }
    return null;
  }

  function addBand(scope, dimId) {
    const collection = scope === "overall"
      ? state.scheme.overallBands
      : state.scheme.dimensions.find((dim) => dim.id === dimId)?.levels;
    if (!collection) return;
    const min = findFreeThreshold(collection);
    if (min === null) return;
    collection.push({ grade: "新等级", min });
    invalidateEvidence();
    commit();
  }

  function removeBand(scope, dimId, index) {
    const collection = scope === "overall"
      ? state.scheme.overallBands
      : state.scheme.dimensions.find((dim) => dim.id === dimId)?.levels;
    if (!collection || collection.length <= 2) return;
    collection.splice(Number(index), 1);
    invalidateEvidence();
    commit();
  }

  function handleClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "tab") state.activeTab = target.dataset.tab;
    if (action === "select-student") state.selectedStudentId = target.dataset.studentId;
    if (action === "add-student") return addStudent();
    if (action === "add-dimension") return addDimension();
    if (action === "remove-dimension") return removeDimension(target.dataset.dimId);
    if (action === "normalize-weights") return normalizeWeightsNow();
    if (action === "reset-demo") return resetDemo();
    if (action === "add-band") return addBand(target.dataset.scope, target.dataset.dimId);
    if (action === "remove-band") return removeBand(target.dataset.scope, target.dataset.dimId, target.dataset.index);
    if (action === "dismiss-comparison") {
      const studentId = target.dataset.studentId;
      state.dismissed[studentId] = true;
      delete state.comparisons[studentId];
    }
    if (action === "set-baseline") setBaseline(target.dataset.studentId);
    commit();
  }

  function renderApp() {
    const student = selectedStudent();
    const result = getResult(student);
    const narrative = narration.buildNarration(result, state.scheme);
    $("#app").innerHTML = `
      <div class="shell">
        ${renderTopbar()}
        ${state.activeTab === "scheme"
          ? renderScheme()
          : renderWorkbench(student, result, narrative)}
      </div>`;
  }

  function renderTopbar() {
    return `<header class="topbar">
      <div class="brand">
        <h1>技能训练营评分工作台</h1>
        <p>${escapeHtml(state.scheme.name)} · 本地实时保存，刷新后数据仍保留</p>
      </div>
      <div class="tabs">
        <button data-action="tab" data-tab="score" class="${state.activeTab === "score" ? "active" : ""}">评分工作台</button>
        <button data-action="tab" data-tab="scheme" class="${state.activeTab === "scheme" ? "active" : ""}">评分方案</button>
      </div>
    </header>`;
  }

  function renderWorkbench(student, result, narrative) {
    if (!student) {
      return `<section class="panel"><button class="primary" data-action="add-student">添加第一位学员</button></section>`;
    }
    return `<main class="layout">
      ${renderStudents(result)}
      <section class="panel">
        ${renderStudentHeader(student)}
        ${renderScoreRows(result)}
      </section>
      ${renderEvidence(student, result, narrative)}
    </main>`;
  }

  function renderStudents(currentResult) {
    const cards = state.students.map((student) => {
      const result = getResult(student);
      return `<button class="student-card ${student.id === state.selectedStudentId ? "active" : ""}"
        data-action="select-student" data-student-id="${student.id}">
        <span>
          <span class="student-name">${escapeHtml(student.name)}</span>
          <span class="student-meta">${escapeHtml(student.team || "未分班")}</span>
        </span>
        <span class="pill ${gradeClass(result.overallGrade)}">${escapeHtml(result.overallGrade)}</span>
      </button>`;
    }).join("");
    return `<aside class="panel sticky">
      <h2>学员</h2>
      <div class="student-list">${cards}</div>
      <div style="margin-top:12px; display:grid; gap:8px;">
        <button class="primary" data-action="add-student">添加学员</button>
        <button data-action="reset-demo">恢复演示数据</button>
      </div>
      <p class="hint" style="margin-bottom:0;">当前选中学员总分为 <strong>${narration.formatScore(currentResult.total)}</strong>，等级会随打分和权重即时更新。</p>
    </aside>`;
  }

  function renderStudentHeader(student) {
    return `<div class="field" style="margin-bottom:12px;">
      <label>当前学员 / 班级（可直接修改）</label>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <input data-type="student-name" data-focus="student-name" value="${escapeHtml(student.name)}">
        <input data-type="student-team" data-focus="student-team" value="${escapeHtml(student.team || "")}">
      </div>
    </div>`;
  }

  function renderScoreRows(result) {
    const student = selectedStudent();
    const rows = result.entries.map((entry) => {
      const raw = entry.raw === null ? "" : entry.raw;
      const missingBadge = entry.missing
        ? `<span class="pill amber missing-badge">缺分：${escapeHtml(policyName(entry.missingPolicy))}</span>`
        : "";
      return `<div class="score-row">
        <div>
          <div class="score-name">${escapeHtml(entry.name)}${missingBadge}</div>
          <div class="score-sub">${escapeHtml(policyName(entry.missingPolicy))} · 等级阈值见方案</div>
        </div>
        <input class="${entry.missing ? "missing" : ""}" type="number" min="0" max="${entry.maxScore}"
          step="1" value="${escapeHtml(raw)}" data-type="score" data-dim-id="${entry.id}"
          data-focus="score-${entry.id}">
        <div><span class="pill ${gradeClass(entry.level.grade)}">${escapeHtml(entry.level.grade)}</span></div>
        <input type="number" min="0" max="100" value="${entry.weight}"
          data-type="weight" data-dim-id="${entry.id}"
          data-student-id="${student.id}" data-focus="score-weight-${entry.id}">
        <div>${deltaHtml(entry.delta)}</div>
        <div>
          <strong>${narration.formatScore(entry.contribution)} 分</strong>
          <div class="bar"><span style="width:${Math.max(0, Math.min(100, entry.contribution))}%"></span></div>
        </div>
      </div>`;
    }).join("");
    return `<div class="score-row head">
      <span>评分维度</span><span>原始分</span><span>维度等级</span>
      <span>权重</span><span>对总分</span><span>得分贡献</span>
    </div>${rows}`;
  }

  function snapshotHtml(snapshot, title, tone) {
    const narrative = narration.buildNarration(snapshot.outcome, state.scheme);
    return `<article class="snapshot">
      <h4><span class="pill ${tone}">${title}</span></h4>
      <p><strong>${narration.formatScore(snapshot.outcome.total)} 分 · ${escapeHtml(snapshot.outcome.overallGrade)}</strong></p>
      ${narrative.lines.slice(0, 4).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
    </article>`;
  }

  function renderEvidence(student, result, narrative) {
    const comparison = state.comparisons[student.id];
    const baseline = state.weightBaselines[student.id];
    const alert = comparison
      ? `<div class="alert ${comparison.upward ? "up" : "down"}">
          <strong>${escapeHtml(comparison.text)}</strong>
          已保留调整前依据与当前依据，供教练对照确认。
          <div class="toolbar" style="margin:10px 0 0;">
            <button data-action="set-baseline" data-student-id="${student.id}">以当前为新对照</button>
            <button data-action="dismiss-comparison" data-student-id="${student.id}">知道了</button>
          </div>
          ${baseline ? `<div class="comparison">
            ${snapshotHtml(baseline, "调整前", "gray")}
            ${snapshotHtml({ outcome: comparison.after }, "调整后", comparison.upward ? "green" : "red")}
          </div>` : ""}
        </div>`
      : `<div class="alert info">
          <strong>实时依据已同步</strong>
          修改任意维度分数或权重后，总分、等级、贡献和说明会立即重算。调整权重前聚焦到权重框时会自动记录对照基线。
        </div>`;

    return `<aside class="panel sticky evidence">
      <div class="score-hero">
        <div>
          <div class="grade">${escapeHtml(narrative.headline)}</div>
          <p>${result.nextGrade ? `距「${result.nextGrade}」还差 ${narration.formatScore(result.nextMin - result.total)} 分` : "已达到最高等级"}</p>
        </div>
        <div class="score">${narration.formatScore(result.total)}</div>
      </div>
      ${alert}
      ${narrative.lines.map((line) => `<div class="evidence-line">${escapeHtml(line)}</div>`).join("")}
      <details open>
        <summary><strong>逐维度计算依据</strong></summary>
        <ul class="detail-list">${narrative.detail.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
      </details>
    </aside>`;
  }

  function renderBands(collection, options) {
    return collection.map((band, index) => `<div class="band-grid">
      <div class="field">
        <label>${options.label} ${index + 1}</label>
        <input data-type="band-grade" data-scope="${options.scope}"
          data-dim-id="${options.dimId || ""}" data-index="${index}"
          data-focus="${options.scope}-grade-${options.dimId || "overall"}-${index}"
          value="${escapeHtml(band.grade)}">
      </div>
      <div class="field">
        <label>最低分</label>
        <input type="number" min="0" max="100" data-type="band-min"
          data-scope="${options.scope}" data-dim-id="${options.dimId || ""}"
          data-index="${index}"
          data-focus="${options.scope}-min-${options.dimId || "overall"}-${index}"
          value="${escapeHtml(band.min)}">
      </div>
      <div class="field" style="grid-column: span 2;">
        <label>规则</label>
        <div style="display:flex; gap:8px; align-items:center;">
          <input value="${index === 0 ? "达到此分即为该等级" : "低于上一级且达到此分"}" disabled>
          <button class="danger" data-action="remove-band" data-scope="${options.scope}"
            data-dim-id="${options.dimId || ""}" data-index="${index}"
            ${collection.length <= 2 ? "disabled" : ""}>删除</button>
        </div>
      </div>
    </div>`).join("");
  }

  function renderDimensionCard(dim) {
    const policyOptions = schema.MISSING_POLICIES.map((policy) =>
      `<option value="${policy.id}" ${dim.missingPolicy === policy.id ? "selected" : ""}>${policy.name}</option>`
    ).join("");
    const policy = schema.MISSING_POLICIES.find((item) => item.id === dim.missingPolicy);
    return `<article class="dimension-card">
      <div class="dimension-head">
        <div class="field">
          <label>维度名称</label>
          <input data-type="dimension-name" data-dim-id="${dim.id}"
            data-focus="dim-name-${dim.id}" value="${escapeHtml(dim.name)}">
        </div>
        <div class="field">
          <label>权重 %（合计 100）</label>
          <input type="number" min="0" max="100" data-type="weight" data-dim-id="${dim.id}"
            data-focus="weight-${dim.id}" value="${state.scheme.weights[dim.id]}">
        </div>
        <div class="field">
          <label>缺省策略</label>
          <select data-type="missing-policy" data-dim-id="${dim.id}">${policyOptions}</select>
        </div>
        <button class="danger" data-action="remove-dimension" data-dim-id="${dim.id}">删除</button>
      </div>
      <p class="hint">${escapeHtml(policy ? policy.hint : "")}</p>
      <div class="band-grid" style="grid-template-columns: 1fr 1fr;">
        <div class="field">
          <label>满分</label>
          <input type="number" min="1" max="100" data-type="max-score" data-dim-id="${dim.id}" value="${dim.maxScore || 100}">
        </div>
      </div>
      ${renderBands(dim.levels, { scope: "dimension", dimId: dim.id, label: "等级" })}
      <button data-action="add-band" data-scope="dimension" data-dim-id="${dim.id}"
        style="margin-top:10px;">添加等级</button>
    </article>`;
  }

  function renderScheme() {
    const validation = schema.validateScheme(state.scheme);
    const student = selectedStudent();
    const weightSum = Object.values(state.scheme.weights)
      .reduce((sum, value) => sum + (Number(value) || 0), 0);
    return `<main class="scheme-grid">
      <section class="panel">
        <h2>评分维度与等级规则</h2>
        <div class="field" style="max-width:420px; margin-bottom:14px;">
          <label>方案名称</label>
          <input data-type="scheme-name" data-focus="scheme-name" value="${escapeHtml(state.scheme.name)}">
        </div>
        <div class="toolbar">
          <button class="primary" data-action="add-dimension">添加维度</button>
          <button data-action="normalize-weights">一键归一化权重</button>
        </div>
        <div class="weight-summary">
          <strong>权重合计：${weightSum}%</strong>
          <span class="pill ${weightSum === 100 ? "green" : "red"}">${weightSum === 100 ? "整体一致" : "需调整"}</span>
        </div>
        ${state.scheme.dimensions.map(renderDimensionCard).join("")}
      </section>
      <aside class="panel sticky">
        <h2>总评等级</h2>
        ${renderBands(state.scheme.overallBands, { scope: "overall", label: "总评等级" })}
        <button data-action="add-band" data-scope="overall">添加总评等级</button>
        <div class="alert info" style="margin-top:14px;">
          <strong>实时联动</strong>
          权重输入会自动按比例分摊到其他维度，始终保持整数权重合计 100%。当前学员若跨过总评边界，本页会立即提示并保留前后依据。
        </div>
        ${renderSchemeComparison(student)}
        <h3>方案校验</h3>
        ${validation.valid
          ? `<div class="alert up"><strong>方案可用</strong>所有维度、缺省策略和等级阈值均通过校验。</div>`
          : `<ul class="validation-list">${validation.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>`}
      </aside>
    </main>`;
  }

  function renderSchemeComparison(student) {
    if (!student) return "";
    const comparison = state.comparisons[student.id];
    const baseline = state.weightBaselines[student.id];
    if (!comparison || !baseline) return "";
    return `<div class="alert ${comparison.upward ? "up" : "down"}" style="margin-top:14px;">
      <strong>${escapeHtml(comparison.text)}</strong>
      <div class="comparison">
        ${snapshotHtml(baseline, "调整前", "gray")}
        ${snapshotHtml({ outcome: comparison.after }, "调整后", comparison.upward ? "green" : "red")}
      </div>
    </div>`;
  }

  function init() {
    document.addEventListener("click", handleClick);
    document.addEventListener("input", handleInput);
    document.addEventListener("change", handleChange);
    document.addEventListener("focusin", handleFocusIn);
    renderApp();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
