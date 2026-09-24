"use strict";
/* 本地状态与持久化：仅使用浏览器 localStorage，不访问任何网络服务。 */

const LS_KEY = "assetFitWorkbench.v1";

function seedState() {
  return {
    assets: [
      { id: "A1", name: "首页主视觉", width: 2400, height: 1200, purpose: "横幅",
        minReadableW: 1600, minReadableH: 800 },
      { id: "A2", name: "产品图标", width: 1024, height: 1024, purpose: "图标",
        minReadableW: 512, minReadableH: 512 },
      { id: "A3", name: "详情长图", width: 1080, height: 3200, purpose: "正文图",
        minReadableW: 900, minReadableH: 1200 },
      { id: "A4", name: "方形海报", width: 2000, height: 2000, purpose: "海报",
        minReadableW: 1500, minReadableH: 1200 },
      { id: "A5", name: "产品特写", width: 1600, height: 900, purpose: "照片",
        minReadableW: 1400, minReadableH: 700 }
    ],
    specs: [
      { id: "S1", name: "首页 Banner", targetW: 1920, targetH: 640, safeMarginPct: 0.05,
        allowScale: true, allowCrop: true, allowRecompose: false },
      { id: "S2", name: "信息流卡片", targetW: 800, targetH: 800, safeMarginPct: 0.10,
        allowScale: true, allowCrop: true, allowRecompose: false },
      { id: "S3", name: "竖屏开屏", targetW: 1080, targetH: 1920, safeMarginPct: 0.08,
        allowScale: true, allowCrop: false, allowRecompose: true }
    ],
    assignments: [
      { assetId: "A1", specId: "S1" },
      { assetId: "A1", specId: "S2" },
      { assetId: "A2", specId: "S2" },
      { assetId: "A3", specId: "S3" },
      { assetId: "A4", specId: "S2" },
      { assetId: "A4", specId: "S3" },
      { assetId: "A5", specId: "S2" }
    ],
    // 覆盖按 (素材,规格) 键存储，修改规格本身不会改动其他规格的结论
    overrides: {}
  };
}

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.assets) && Array.isArray(s.specs)) return s;
    }
  } catch (e) { /* 本地数据损坏时回退到示例数据 */ }
  return seedState();
}
function saveState() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
function resetState() { state = seedState(); saveState(); }

function pairKey(assetId, specId) { return assetId + "|" + specId; }
function getAsset(id) { return state.assets.find(a => a.id === id) || null; }
function getSpec(id) { return state.specs.find(s => s.id === id) || null; }
function nextId(prefix, list) {
  let n = list.length + 1;
  while (list.some(x => x.id === prefix + n)) n++;
  return prefix + n;
}

function upsertAsset(data) {
  if (data.id && getAsset(data.id)) {
    Object.assign(getAsset(data.id), data);
  } else {
    data.id = nextId("A", state.assets);
    state.assets.push(data);
  }
  saveState();
}
function deleteAsset(id) {
  state.assets = state.assets.filter(a => a.id !== id);
  state.assignments = state.assignments.filter(x => x.assetId !== id);
  Object.keys(state.overrides).forEach(k => { if (k.startsWith(id + "|")) delete state.overrides[k]; });
  saveState();
}
function upsertSpec(data) {
  if (data.id && getSpec(data.id)) {
    Object.assign(getSpec(data.id), data);
  } else {
    data.id = nextId("S", state.specs);
    state.specs.push(data);
  }
  saveState();
}
function deleteSpec(id) {
  state.specs = state.specs.filter(s => s.id !== id);
  state.assignments = state.assignments.filter(x => x.specId !== id);
  Object.keys(state.overrides).forEach(k => { if (k.endsWith("|" + id)) delete state.overrides[k]; });
  saveState();
}
function setAssignment(assetId, specId, on) {
  const i = state.assignments.findIndex(x => x.assetId === assetId && x.specId === specId);
  if (on && i < 0) state.assignments.push({ assetId, specId });
  if (!on && i >= 0) {
    state.assignments.splice(i, 1);
    delete state.overrides[pairKey(assetId, specId)];
  }
  saveState();
}
function setOverride(assetId, specId, strategy) {
  const k = pairKey(assetId, specId);
  if (strategy) state.overrides[k] = { strategy };
  else delete state.overrides[k];
  saveState();
}

/* 汇总当前所有分配的结论。每行只读取自己的 (素材,规格,覆盖)，
   因此同一素材在不同规格下的结果互不干扰。 */
function computeResults() {
  return state.assignments.map(a => {
    const asset = getAsset(a.assetId);
    const spec = getSpec(a.specId);
    if (!asset || !spec) return null;
    const ov = state.overrides[pairKey(a.assetId, a.specId)];
    const result = deriveFit(asset, spec, ov ? ov.strategy : null);
    return { key: pairKey(a.assetId, a.specId), asset, spec, override: ov || null, result };
  }).filter(Boolean);
}
