/* global ReflowLib */
"use strict";

const FONT_MIN = 16;
const FONT_MAX = 96;
const $ = (id) => document.getElementById(id);
const stage = $("stage");
const article = $("article");

const state = {
  fontSize: 30,
  cols: 1,
  docName: "",
  totalSentences: 0,
  anchor: null, // 最近一次已知的阅读位置 {sid, frac}，滚动时持续更新
};

let sentSpans = []; // 缓存的句子元素，滚动时快速查找
let markerEl = null; // 当前阅读位置标记

// ---------- 文档渲染 ----------
function renderDocument(text, name) {
  const paras = ReflowLib.splitParagraphs(text);
  const frag = document.createDocumentFragment();
  let sid = 0;
  paras.forEach((para, pi) => {
    const p = document.createElement("p");
    for (const sentence of ReflowLib.splitSentences(para)) {
      const span = document.createElement("span");
      span.className = "s";
      span.dataset.sid = String(sid++);
      span.dataset.para = String(pi + 1);
      span.textContent = sentence;
      p.appendChild(span);
    }
    frag.appendChild(p);
  });
  article.replaceChildren(frag);
  sentSpans = Array.from(article.querySelectorAll(".s"));
  state.totalSentences = sid;
  state.docName = name;
  markerEl = null;
  stage.scrollTop = 0;
  applyColumns();
  updateMarker();
}

// ---------- 锚点：重排前捕获，重排后恢复 ----------
// 锚点 = 视口顶部附近第一个可见句子 + 它距视口顶的比例。
// 恢复时按同一比例放回，结果只取决于内容本身，多次微调不会累积漂移。
function captureAnchor() {
  const found = topmostVisibleSentence();
  return found ? { sid: found.el.dataset.sid, frac: found.frac } : null;
}

function restoreAnchor(anchor) {
  if (!anchor) return;
  const el = sentSpans[Number(anchor.sid)];
  if (!el) return;
  const contRect = stage.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const elTopInContent = stage.scrollTop + (r.top - contRect.top);
  stage.scrollTop = ReflowLib.restoreScrollTop(
    elTopInContent,
    anchor.frac,
    stage.clientHeight
  );
}

function topmostVisibleSentence() {
  const contTop = stage.getBoundingClientRect().top;
  const vh = stage.clientHeight || 1;
  for (const el of sentSpans) {
    const r = el.getBoundingClientRect();
    if (r.bottom > contTop + 2) {
      return { el, frac: (r.top - contTop) / vh };
    }
  }
  return null;
}

// ---------- 分栏：栏数是 (视窗宽, 字号) 的纯函数 ----------
function applyColumns() {
  const cols = ReflowLib.computeColumns(stage.clientWidth, state.fontSize);
  if (cols !== state.cols) {
    state.cols = cols;
    article.style.columnCount = String(cols);
  }
  $("status-layout").textContent =
    `字号 ${state.fontSize}px · ${cols} 栏 · 视窗 ${stage.clientWidth}px`;
}

// ---------- 阅读位置标记 ----------
function updateMarker() {
  const found = topmostVisibleSentence();
  if (!found) return;
  state.anchor = { sid: found.el.dataset.sid, frac: found.frac };
  if (markerEl) markerEl.classList.remove("marker");
  markerEl = found.el;
  markerEl.classList.add("marker");
  const sid = Number(markerEl.dataset.sid);
  const pct = state.totalSentences
    ? Math.round((100 * (sid + 1)) / state.totalSentences)
    : 0;
  $("status-pos").textContent =
    `${state.docName} · 第 ${markerEl.dataset.para} 段 · ` +
    `第 ${sid + 1}/${state.totalSentences} 句 · ${pct}%`;
}

// ---------- 字号 ----------
function setFontSize(px) {
  px = ReflowLib.clamp(Math.round(px), FONT_MIN, FONT_MAX);
  if (px === state.fontSize) return;
  const anchor = captureAnchor(); // 先记住读到哪句
  state.fontSize = px;
  document.documentElement.style.setProperty("--font-size", px + "px");
  $("font-slider").value = String(px);
  $("font-label").textContent = px + "px";
  applyColumns(); // 栏数随字号重新计算
  restoreAnchor(anchor); // 再把那句放回原位置
  updateMarker();
  saveSettings();
}

// ---------- 视窗尺寸变化：rAF 合帧，稳定收敛 ----------
let reflowScheduled = false;
new ResizeObserver(() => {
  if (reflowScheduled) return;
  reflowScheduled = true;
  requestAnimationFrame(() => {
    reflowScheduled = false;
    // 视口已经变了，此刻捕获到的是重排后的位置；
    // 必须用变化前由滚动监听存下的锚点。
    const anchor = state.anchor || captureAnchor();
    applyColumns();
    restoreAnchor(anchor);
    updateMarker();
  });
}).observe(stage);

// 滚动时让标记跟随（rAF 节流）
let scrollScheduled = false;
stage.addEventListener("scroll", () => {
  if (scrollScheduled) return;
  scrollScheduled = true;
  requestAnimationFrame(() => {
    scrollScheduled = false;
    updateMarker();
  });
});

// ---------- 导入 ----------
$("btn-open").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  renderDocument(await f.text(), f.name);
  e.target.value = "";
});
$("btn-sample").addEventListener("click", async () => {
  const r = await fetch("sample.txt");
  renderDocument(await r.text(), "示例文档");
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) renderDocument(await f.text(), f.name);
});

// ---------- 工具栏 ----------
$("btn-inc").addEventListener("click", () => setFontSize(state.fontSize + 2));
$("btn-dec").addEventListener("click", () => setFontSize(state.fontSize - 2));
$("font-slider").addEventListener("input", (e) =>
  setFontSize(Number(e.target.value))
);
$("width-select").addEventListener("change", (e) => {
  document.documentElement.style.setProperty("--stage-w", e.target.value + "%");
  saveSettings();
});
$("btn-theme").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  $("btn-theme").textContent = document.body.classList.contains("dark")
    ? "日间模式"
    : "夜间模式";
  saveSettings();
});
window.addEventListener("keydown", (e) => {
  if (!e.ctrlKey) return;
  if (e.key === "=" || e.key === "+") {
    e.preventDefault();
    setFontSize(state.fontSize + 2);
  } else if (e.key === "-") {
    e.preventDefault();
    setFontSize(state.fontSize - 2);
  }
});

// ---------- 设置持久化 ----------
function saveSettings() {
  try {
    localStorage.setItem(
      "lv-reader",
      JSON.stringify({
        fontSize: state.fontSize,
        width: $("width-select").value,
        dark: document.body.classList.contains("dark"),
      })
    );
  } catch (_) { /* 忽略隐私模式 */ }
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem("lv-reader") || "null");
    if (!s) return;
    if (s.width) {
      $("width-select").value = s.width;
      document.documentElement.style.setProperty("--stage-w", s.width + "%");
    }
    if (s.dark) {
      document.body.classList.add("dark");
      $("btn-theme").textContent = "日间模式";
    }
    if (s.fontSize) {
      state.fontSize = 0; // 强制 setFontSize 生效
      setFontSize(s.fontSize);
    }
  } catch (_) { /* 忽略损坏的存档 */ }
}

loadSettings();
applyColumns();
