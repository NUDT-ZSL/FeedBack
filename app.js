/* 易读 · 低视力阅读排版工具
 * 核心机制：句子级锚点。
 * - 渲染时把正文切成句子，每句包一个 <span class="s">。
 * - 视口 35% 高度处为"阅读线"，落在阅读线上的句子即锚点。
 * - 字号/栏宽/视窗变化时，保持锚点 id 不变，只把该句滚回原来的
 *   视口比例位置，因此重排前后阅读位置不丢、不漂移。
 */
"use strict";

const $ = (id) => document.getElementById(id);
const reader = $("reader");
const marker = $("marker");
const posLabel = $("posLabel");

const READ_LINE = 0.35; // 阅读线：视口顶部往下 35%
const state = {
  sentences: [],      // 句子 span 元素
  anchorId: -1,       // 锚点句子下标
  anchorRatio: READ_LINE, // 锚点顶部距视口顶的比例
  docName: "",
  expectedScroll: 0,  // 程序滚动目标位置，用于区分用户滚动
};

/* ---------- 文档解析与渲染 ---------- */

function splitSentences(text) {
  const out = [];
  const re = /[^。！？!?；;…\n]+[。！？!?；;…]*["'”’）)\]]*\s*/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const s = m[0].trim();
    if (s) out.push(s);
  }
  return out;
}

function splitParagraphs(text) {
  let paras = text.split(/\r?\n[ \t]*\r?\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length < 3) {
    // 没有空行分段的长文：退化为按单行切
    paras = text.split(/\r?\n/).map((p) => p.trim()).filter(Boolean);
  }
  return paras;
}

function renderDocument(text, name) {
  state.docName = name || "未命名";
  const paras = splitParagraphs(text);
  const frag = document.createDocumentFragment();
  state.sentences = [];
  let sid = 0;
  for (const p of paras) {
    const pEl = document.createElement("p");
    for (const s of splitSentences(p.replace(/\r?\n/g, ""))) {
      const span = document.createElement("span");
      span.className = "s";
      span.dataset.sid = sid;
      span.textContent = s;
      pEl.appendChild(span);
      state.sentences.push(span);
      sid++;
    }
    if (pEl.childNodes.length) frag.appendChild(pEl);
  }
  reader.replaceChildren(frag);
  window.scrollTo(0, 0);
  state.anchorRatio = READ_LINE;
  captureAnchor();       // 初始锚点 = 阅读线上的第一句
  restoreAnchor();       // 立即对齐并显示标记
}

/* ---------- 锚点捕获 / 恢复 ---------- */

function captureAnchor() {
  const n = state.sentences.length;
  if (!n) { state.anchorId = -1; return; }
  const lineY = window.innerHeight * READ_LINE;
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < n; i++) {
    const r = state.sentences[i].getBoundingClientRect();
    if (r.top <= lineY && r.bottom > lineY) { best = i; bestDist = -1; break; }
    const d = Math.abs(r.top - lineY);
    if (d < bestDist) { bestDist = d; best = i; }
    if (r.top > lineY && bestDist !== Infinity) break; // 后面的只会更远
  }
  state.anchorId = best;
  const r = state.sentences[best].getBoundingClientRect();
  state.anchorRatio = clamp(r.top / window.innerHeight, 0.05, 0.9);
}

function restoreAnchor() {
  if (state.anchorId < 0) { updateMarker(); return; }
  const el = state.sentences[state.anchorId];
  const target = Math.round(
    el.getBoundingClientRect().top + window.scrollY - state.anchorRatio * window.innerHeight
  );
  state.expectedScroll = Math.max(0, target);
  window.scrollTo(0, state.expectedScroll);
  updateMarker();
}

function updateMarker() {
  for (const s of state.sentences) s.classList.remove("anchor");
  if (state.anchorId < 0) { marker.style.display = "none"; posLabel.textContent = "未加载文档"; return; }
  const el = state.sentences[state.anchorId];
  el.classList.add("anchor");
  const r = el.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight) {
    marker.style.display = "none";
  } else {
    marker.style.display = "block";
    marker.style.top = Math.round(clamp(r.top, 0, window.innerHeight - 30)) + "px";
  }
  posLabel.textContent =
    `${state.docName} · 第 ${state.anchorId + 1} / ${state.sentences.length} 句`;
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/* ---------- 布局（字号 / 行高 / 栏宽 / 分栏） ---------- */

let reflowRaf = 0;

function applyLayout() {
  const root = document.documentElement;
  root.style.setProperty("--fs", $("fontSize").value + "px");
  root.style.setProperty("--lh", $("lineHeight").value);
  root.style.setProperty("--measure", $("measure").value + "em");
  root.style.setProperty("--cols", $("columns").value);
  $("fontSizeLabel").textContent = $("fontSize").value + "px";
}

/* 连续变化（拖滑块、按住按钮、拖窗口）时：
 * 用 rAF 合并到每帧一次；锚点 id 在整个过程中保持不变，
 * 因此结果只取决于最终参数，不会累积漂移。 */
function scheduleReflow() {
  if (reflowRaf) return;
  reflowRaf = requestAnimationFrame(() => {
    reflowRaf = 0;
    applyLayout();
    restoreAnchor();
    saveSettings();
  });
}

function changeFont(delta) {
  const s = $("fontSize");
  s.value = clamp(Number(s.value) + delta, Number(s.min), Number(s.max));
  scheduleReflow();
}

/* ---------- 滚动：用户手动滚动时重新捕获锚点 ---------- */

let scrollTimer = 0;
window.addEventListener("scroll", () => {
  // 与程序滚动目标一致（±2px）时不重捕获，避免自我触发；
  // 用户真实滚动会偏离该目标，立即进入重捕获流程。
  if (Math.abs(window.scrollY - state.expectedScroll) <= 2) { updateMarker(); return; }
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    captureAnchor();
    updateMarker();
  }, 120);
}, { passive: true });

window.addEventListener("resize", scheduleReflow);

/* ---------- 控件事件 ---------- */

$("fontSize").addEventListener("input", scheduleReflow);
$("lineHeight").addEventListener("input", scheduleReflow);
$("measure").addEventListener("input", scheduleReflow);
$("columns").addEventListener("change", scheduleReflow);
$("fontMinus").addEventListener("click", () => changeFont(-2));
$("fontPlus").addEventListener("click", () => changeFont(2));
$("theme").addEventListener("change", () => {
  document.documentElement.dataset.theme = $("theme").value;
  saveSettings();
});

window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return;
  if (e.key === "+" || e.key === "=") changeFont(2);
  else if (e.key === "-" || e.key === "_") changeFont(-2);
});

/* ---------- 文件导入（UTF-8，失败回退 GBK） ---------- */

function readFile(file) {
  const tryRead = (enc, retry) => {
    const fr = new FileReader();
    fr.onload = () => {
      const text = fr.result;
      if (retry && text.includes("�")) { tryRead("gbk", false); return; }
      renderDocument(text, file.name);
    };
    fr.readAsText(file, enc);
  };
  tryRead("utf-8", true);
}

$("fileInput").addEventListener("change", (e) => {
  if (e.target.files[0]) readFile(e.target.files[0]);
});

$("sampleBtn").addEventListener("click", () => {
  fetch("sample.txt")
    .then((r) => r.text())
    .then((t) => renderDocument(t, "示例文档"))
    .catch(() => { posLabel.textContent = "示例加载失败"; });
});

/* ---------- 设置持久化 ---------- */

function saveSettings() {
  try {
    localStorage.setItem("yidu-settings", JSON.stringify({
      fs: $("fontSize").value, lh: $("lineHeight").value,
      measure: $("measure").value, cols: $("columns").value,
      theme: $("theme").value,
    }));
  } catch (_) { /* 隐私模式下忽略 */ }
}

(function init() {
  try {
    const s = JSON.parse(localStorage.getItem("yidu-settings") || "null");
    if (s) {
      $("fontSize").value = s.fs; $("lineHeight").value = s.lh;
      $("measure").value = s.measure; $("columns").value = s.cols;
      $("theme").value = s.theme;
      document.documentElement.dataset.theme = s.theme;
    }
  } catch (_) { /* 忽略损坏的存档 */ }
  applyLayout();
})();
