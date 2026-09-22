/* 决策回放 - 交互装配 */
"use strict";

const state = { selectedId: null };
const $ = id => document.getElementById(id);

function currentDecision() {
  return store.data.decisions.find(d => d.id === state.selectedId) || null;
}

function refresh() { store.save(); renderAll(state); }

/* ---- 对话框：新建决策 ---- */
$("btn-new-decision").onclick = () => {
  $("form-decision").reset();
  $("dlg-decision").showModal();
};
$("dlg-decision").addEventListener("close", () => {
  if ($("dlg-decision").returnValue !== "ok") return;
  const title = $("inp-dec-title").value.trim();
  if (!title) return;
  const d = createDecision(title, $("inp-dec-context").value.trim());
  state.selectedId = d.id;
  refresh();
});

/* ---- 详情面板按钮（事件委托） ---- */
$("detail").addEventListener("click", e => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const d = currentDecision();
  if (!d) return;
  const act = btn.dataset.act;
  const optId = btn.dataset.opt;

  if (act === "add-option") {
    $("form-option").reset();
    $("dlg-option").showModal();
  } else if (act === "add-rationale") {
    state.rationaleOptionId = optId;
    $("form-rationale").reset();
    $("dlg-rationale").showModal();
  } else if (act === "add-info") {
    openInfoDialog(d);
  } else if (act === "recalc") {
    recalc(d, "手动重新评估");
    refresh();
  } else if (act === "compare") {
    renderCompare(d);
    $("dlg-compare").showModal();
  } else if (act === "del-decision") {
    if (confirm(`确定删除决策「${d.title}」及其全部历史？`)) {
      store.data.decisions = store.data.decisions.filter(x => x.id !== d.id);
      state.selectedId = store.data.decisions[0] ? store.data.decisions[0].id : null;
      refresh();
    }
  } else if (act === "execute" || act === "abandon") {
    const opt = d.options.find(o => o.id === optId);
    const label = act === "execute" ? "已执行" : "已放弃";
    if (confirm(`将选项「${opt.name}」标记为${label}？其评估值将冻结，不再参与后续重算。`)) {
      setOptionStatus(d, optId, act === "execute" ? "executed" : "abandoned");
      refresh();
    }
  }
});

$("dlg-option").addEventListener("close", () => {
  if ($("dlg-option").returnValue !== "ok") return;
  const d = currentDecision();
  const name = $("inp-opt-name").value.trim();
  if (d && name) { addOption(d, name); refresh(); }
});

$("dlg-rationale").addEventListener("close", () => {
  if ($("dlg-rationale").returnValue !== "ok") return;
  const d = currentDecision();
  const text = $("inp-rat-text").value.trim();
  if (d && text && state.rationaleOptionId) {
    addRationale(d, state.rationaleOptionId, text,
      $("inp-rat-dir").value, $("inp-rat-weight").value, $("inp-rat-half").value);
    recalc(d, "新增依据：" + text);
    refresh();
  }
});

/* ---- 新信息对话框 ---- */
function openInfoDialog(d) {
  $("form-info").reset();
  const optSel = $("inp-info-option");
  optSel.innerHTML = "";
  for (const o of d.options.filter(o => o.status === "open")) {
    const el = document.createElement("option");
    el.value = o.id; el.textContent = o.name;
    optSel.appendChild(el);
  }
  if (!optSel.options.length) { alert("所有选项均已冻结，无法追加信息。"); return; }
  syncInfoForm(d);
  $("dlg-info").showModal();
}

function syncInfoForm(d) {
  const mode = $("inp-info-mode").value;
  $("info-new-fields").style.display = mode === "new" ? "" : "none";
  $("info-boost-fields").style.display = mode === "boost" ? "" : "none";
  $("info-target-wrap").style.display = mode === "new" ? "none" : "";
  if (mode !== "new") {
    const optId = $("inp-info-option").value;
    const sel = $("inp-info-target");
    sel.innerHTML = "";
    for (const r of d.rationales.filter(r => r.optionId === optId && r.status === "active")) {
      const el = document.createElement("option");
      el.value = r.id;
      el.textContent = `${r.direction > 0 ? "＋" : "－"} ${r.text}（权重 ${r.weight}）`;
      sel.appendChild(el);
    }
    if (!sel.options.length) {
      const el = document.createElement("option");
      el.value = ""; el.textContent = "（该选项暂无可用依据）";
      sel.appendChild(el);
    }
  }
}

$("inp-info-mode").addEventListener("change", () => { const d = currentDecision(); if (d) syncInfoForm(d); });
$("inp-info-option").addEventListener("change", () => { const d = currentDecision(); if (d) syncInfoForm(d); });

$("dlg-info").addEventListener("close", () => {
  if ($("dlg-info").returnValue !== "ok") return;
  const d = currentDecision();
  if (!d) return;
  const text = $("inp-info-text").value.trim();
  if (!text) return;
  const mode = $("inp-info-mode").value;
  const info = { text, mode, optionId: $("inp-info-option").value };
  if (mode === "new") {
    info.direction = $("inp-info-dir").value;
    info.weight = $("inp-info-weight").value;
    info.halfLifeDays = 30;
  } else {
    info.targetId = $("inp-info-target").value;
    if (!info.targetId) { alert("目标依据不存在。"); return; }
    if (mode === "boost") info.delta = $("inp-info-delta").value;
  }
  applyInfo(d, info);
  recalc(d, "新信息：" + text);
  refresh();
});

/* ---- 启动 ---- */
store.load();
state.selectedId = store.data.decisions[0] ? store.data.decisions[0].id : null;
renderAll(state);
