import { analyzeBatch, compromiseCrop, normalizeAsset, normalizeChannel, STATUS } from "./engine.js";
import { initialAssets, initialChannels } from "./data.js";

const state = {
  assets: structuredClone(initialAssets),
  channels: structuredClone(initialChannels),
  selectedAssetId: initialAssets[0].id,
  selectedChannelId: initialChannels[0].id,
  compromiseChannelIds: [initialChannels[0].id, initialChannels[3].id],
  showCompromise: false
};

const app = document.querySelector("#app");

function selectedAsset() {
  return state.assets.find(asset => asset.id === state.selectedAssetId) ?? state.assets[0];
}

function selectedChannel() {
  return state.channels.find(channel => channel.id === state.selectedChannelId) ?? state.channels[0];
}

function batch() {
  return analyzeBatch(state.assets, state.channels);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function badge(status) {
  return `<span class="badge ${status.tone}">${status.label}</span>`;
}

function rerender(preserve = false) {
  const active = document.activeElement;
  const focusKey = preserve ? active?.dataset?.focusKey : null;
  const selectionStart = preserve ? active?.selectionStart : null;
  const selectionEnd = preserve ? active?.selectionEnd : null;
  render();
  if (focusKey) {
    const next = document.querySelector(`[data-focus-key="${focusKey}"]`);
    if (next) {
      next.focus();
      if (selectionStart != null && next.setSelectionRange) {
        next.setSelectionRange(Math.min(selectionStart, next.value.length), Math.min(selectionEnd, next.value.length));
      }
    }
  }
}

function render() {
  if (!state.assets.length || !state.channels.length) {
    app.innerHTML = `<main class="topbar"><div><h1>缺少数据</h1><p class="subtitle">请导入素材和渠道规格，或恢复示例数据。</p><br><button class="primary" onclick="location.reload()">恢复示例</button></div></main>`;
    return;
  }

  const rows = batch();
  const asset = selectedAsset();
  const channel = selectedChannel();
  const row = rows.find(item => item.asset.id === asset.id) ?? rows[0];
  const result = row.results.find(item => item.channelId === channel.id) ?? row.results[0];

  app.innerHTML = `
    ${renderTopbar()}
    <main class="layout">
      ${renderAssetList(rows)}
      <section class="panel">
        ${renderResults(row)}
        <div class="panel-body">${renderChannelEditor(channel)}</div>
      </section>
      <section class="panel">
        <div class="panel-body">${renderPreviewAndAssetEditor(row, result)}</div>
      </section>
    </main>
    ${renderDialogs()}
  `;
  bindEvents();
}

function renderTopbar() {
  return `
    <header class="topbar">
      <div>
        <div class="eyebrow">DELIVERY SPEC WORKBENCH</div>
        <h1>素材渠道适配工作台</h1>
        <p class="subtitle">实时校验尺寸、比例、安全边距和格式，并生成单渠道或多渠道裁切方案。</p>
      </div>
      <div class="toolbar">
        <button data-action="add-asset">录入素材</button>
        <button data-action="add-channel">新增渠道</button>
        <button data-action="import-json">载入 JSON</button>
        <button data-action="export-json">导出数据</button>
        <button data-action="reset">恢复示例</button>
      </div>
    </header>
  `;
}

window.addEventListener("DOMContentLoaded", render);

function renderAssetList(rows) {
  const counts = rows.reduce((acc, row) => {
    row.results.forEach(result => acc[result.status.id]++);
    return acc;
  }, { adaptable: 0, needs_crop: 0, impossible: 0 });

  return `
    <aside class="panel">
      <div class="panel-header"><h2>素材批次</h2><span class="hint">${rows.length} 件</span></div>
      <div class="panel-body">
        <div class="summary-grid">
          <div class="summary-card"><strong>${counts.adaptable}</strong><span>可适配</span></div>
          <div class="summary-card"><strong>${counts.needs_crop}</strong><span>需裁切</span></div>
          <div class="summary-card"><strong>${counts.impossible}</strong><span>不可适配</span></div>
        </div>
        <div class="list">
          ${rows.map(({ asset, results }) => {
            const worst = results.some(item => item.status.id === STATUS.IMPOSSIBLE.id)
              ? STATUS.IMPOSSIBLE
              : results.some(item => item.status.id === STATUS.NEEDS_CROP.id)
                ? STATUS.NEEDS_CROP
                : STATUS.ADAPTABLE;
            const active = asset.id === state.selectedAssetId ? "active" : "";
            return `
              <button class="list-item ${active}" data-select-asset="${asset.id}">
                <div class="item-title"><span>${escapeHtml(asset.name)}</span>${badge(worst)}</div>
                <div class="item-meta">${asset.width}×${asset.height} · ${escapeHtml(asset.format)} · ${results.length} 个渠道</div>
                <div class="tags">${asset.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
              </button>
            `;
          }).join("")}
        </div>
      </div>
    </aside>
  `;
}

function renderResults(row) {
  return `
    <div class="panel-header">
      <h2>渠道适配结论</h2>
      <label class="inline-actions"><input type="checkbox" data-toggle-compromise ${state.showCompromise ? "checked" : ""}> 多渠道折中</label>
    </div>
    <div class="panel-body">
      ${state.showCompromise ? renderCompromise(row) : row.results.map(result => `
        <article class="result-card ${result.channelId === state.selectedChannelId ? "selected" : ""}">
          <button class="result-top" data-select-channel="${result.channelId}" style="width:100%;border:0;background:transparent;text-align:left;padding:0;">
            <strong>${escapeHtml(result.channel.name)}</strong>${badge(result.status)}
          </button>
          <div class="check-grid">
            ${result.checks.map(check => `
              <div class="check ${check.pass ? "pass" : "fail"}">
                <b>${check.label} ${check.pass ? "✓" : "×"}</b>
                <div>要求：${escapeHtml(check.expected)}</div>
                <div>当前：${escapeHtml(check.actual)}</div>
              </div>
            `).join("")}
          </div>
          ${result.reasons.length ? `<ul class="reason-list">${result.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>` : `<p class="hint">无需几何裁切；格式不符时导出阶段转换即可。</p>`}
          <div class="hint">建议导出：${escapeHtml(result.suggestedExportFormat)}${result.formatConversionRequired ? "（需要格式转换）" : ""}</div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderCompromise(row) {
  const channels = state.channels.filter(channel => state.compromiseChannelIds.includes(channel.id));
  const compromise = compromiseCrop(row.asset, channels);
  return `
    <div class="channel-picker">
      ${state.channels.map(channel => `
        <label class="checkline">
          <input type="checkbox" data-compromise-channel="${channel.id}" ${state.compromiseChannelIds.includes(channel.id) ? "checked" : ""}>
          <span>${escapeHtml(channel.name)}（${channel.targetWidth}×${channel.targetHeight}）</span>
        </label>
      `).join("")}
    </div>
    <div class="alert ${compromise.risk.level}">${escapeHtml(compromise.risk.message)}</div>
    ${compromise.master ? `
      <div class="result-card">
        <div class="result-top"><strong>统一主裁切</strong><span class="badge neutral">${Math.round(compromise.master.x)}, ${Math.round(compromise.master.y)} · ${Math.round(compromise.master.w)}×${Math.round(compromise.master.h)}</span></div>
        <p class="hint">主裁切用于保留所有渠道所需画面；各渠道交付时从主裁切二次取框，见右侧预览。</p>
        ${compromise.subCrops.map(crop => `
          <div class="subcrop-row"><span>${escapeHtml(crop.name)}：二次裁切 ${Math.round(crop.w)}×${Math.round(crop.h)} → ${crop.outputWidth}×${crop.outputHeight}</span><span class="badge ${crop.risk.level === "safe" ? "ok" : "warn"}">${crop.risk.level === "safe" ? "安全" : "注意"}</span></div>
        `).join("")}
      </div>
    ` : ""}
    ${compromise.unsatisfied.map(item => `
      <div class="result-card"><div class="result-top"><strong>${escapeHtml(item.name)}</strong>${badge(STATUS.IMPOSSIBLE)}</div><ul class="reason-list">${item.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></div>
    `).join("")}
  `;
}

function renderChannelEditor(channel) {
  return `
    <div class="section-title">渠道规格参数（修改后实时重算全部素材）</div>
    <div class="form-grid">
      ${textField("渠道名称", "name", channel.name, "channel")}
      <div class="field"><label>接受格式（逗号分隔）</label><input data-model="channel" data-key="acceptedFormats" value="${escapeHtml(channel.acceptedFormats.join(", "))}"></div>
      ${numberField("目标宽", "targetWidth", channel.targetWidth, "channel")}
      ${numberField("目标高", "targetHeight", channel.targetHeight, "channel")}
      ${numberField("上边距 %", "safeMargin.top", channel.safeMargin.top, "channel")}
      ${numberField("右边距 %", "safeMargin.right", channel.safeMargin.right, "channel")}
      ${numberField("下边距 %", "safeMargin.bottom", channel.safeMargin.bottom, "channel")}
      ${numberField("左边距 %", "safeMargin.left", channel.safeMargin.left, "channel")}
    </div>
    <div class="inline-actions" style="margin-top:10px;">
      <button data-action="delete-channel" class="danger">删除渠道</button>
    </div>
  `;
}

function renderPreviewAndAssetEditor(row, result) {
  const previewResult = result.directUse ? { ...result, crop: null } : result;
  return `
    <div class="preview-card">
      <div class="preview-toolbar">
        <div>
          <h2 style="margin:0 0 3px;font-size:17px;">裁切预览</h2>
          <div class="hint">${escapeHtml(row.asset.name)} → ${escapeHtml(result.channel.name)}</div>
        </div>
        ${badge(result.status)}
      </div>
      ${renderPreviewSvg(row.asset, previewResult)}
      ${previewResult.crop ? `
        <div class="coords">
          <div class="coord"><b>X</b>${previewResult.crop.crop.x}</div>
          <div class="coord"><b>Y</b>${previewResult.crop.crop.y}</div>
          <div class="coord"><b>裁切宽</b>${previewResult.crop.crop.w}</div>
          <div class="coord"><b>裁切高</b>${previewResult.crop.crop.h}</div>
        </div>
        <div class="alert ${previewResult.crop.risk.level}">${escapeHtml(previewResult.crop.risk.message)}</div>
      ` : result.status.id === "adaptable" ? `
        <div class="alert safe">原图尺寸、比例和安全边距可直接使用；如源格式不被接受，仅需在导出时转换格式。</div>
      ` : `<div class="alert danger">当前可裁切区域无法生成满足目标比例和安全边距的裁切框。</div>`}
      <div class="legend">
        <span><i style="background:#2563eb"></i>可裁切区域</span>
        <span><i style="background:#16a34a"></i>安全区</span>
        <span><i style="background:#f97316"></i>关键区域</span>
        <span><i style="background:transparent;border:2px solid #dc2626"></i>推荐裁切</span>
      </div>
    </div>
    ${renderAssetEditor(row.asset)}
  `;
}

function renderAssetEditor(asset) {
  return `
    <div class="section-title">素材参数与可裁切区域</div>
    <div class="form-grid">
      ${textField("素材名称", "name", asset.name, "asset")}
      <div class="field"><label>用途标签（逗号分隔）</label><input data-model="asset" data-key="tags" value="${escapeHtml(asset.tags.join(", "))}"></div>
      ${numberField("原始宽", "width", asset.width, "asset")}
      ${numberField("原始高", "height", asset.height, "asset")}
      <div class="field"><label>当前格式</label><input data-model="asset" data-key="format" value="${escapeHtml(asset.format)}"></div>
      <div class="field"></div>
      ${numberField("可裁切 X", "allowedCrop.x", asset.allowedCrop.x, "asset")}
      ${numberField("可裁切 Y", "allowedCrop.y", asset.allowedCrop.y, "asset")}
      ${numberField("可裁切宽", "allowedCrop.w", asset.allowedCrop.w, "asset")}
      ${numberField("可裁切高", "allowedCrop.h", asset.allowedCrop.h, "asset")}
    </div>
    <div class="section-title">关键区域</div>
    ${asset.keyAreas.map((area, index) => `
      <div class="form-grid" style="margin-bottom:8px;">
        ${textField("名称", `keyAreas.${index}.label`, area.label, "asset")}
        <div class="field"></div>
        ${numberField("关键 X", `keyAreas.${index}.x`, area.x, "asset")}
        ${numberField("关键 Y", `keyAreas.${index}.y`, area.y, "asset")}
        ${numberField("关键宽", `keyAreas.${index}.w`, area.w, "asset")}
        ${numberField("关键高", `keyAreas.${index}.h`, area.h, "asset")}
      </div>
    `).join("") || `<p class="hint">暂无关键区域，系统会给出几何裁切，但无法确认内容风险。</p>`}
    <div class="inline-actions" style="margin-top:10px;">
      <button data-action="add-key">添加关键区域</button>
      <button data-action="delete-asset" class="danger">删除素材</button>
    </div>
  `;
}

function textField(label, key, value, model) {
  return `<div class="field"><label>${label}</label><input data-model="${model}" data-key="${key}" value="${escapeHtml(value)}" data-focus-key="${model}.${key}"></div>`;
}

function numberField(label, key, value, model) {
  return `<div class="field"><label>${label}</label><input type="number" step="0.1" data-model="${model}" data-key="${key}" value="${value}" data-focus-key="${model}.${key}"></div>`;
}

function renderPreviewSvg(asset, result) {
  const safe = result.crop?.safeRect;
  const crop = result.crop?.crop;
  const allowed = asset.allowedCrop;
  const compromise = state.showCompromise
    ? compromiseCrop(asset, state.channels.filter(channel => state.compromiseChannelIds.includes(channel.id)))
    : null;
  const labels = [
    crop ? `<text x="${Math.min(crop.x + 8, asset.width - 180)}" y="${Math.max(crop.y + 26, 30)}" class="svg-label red">推荐裁切</text>` : "",
    `<text x="${Math.min(allowed.x + 8, asset.width - 180)}" y="${Math.max(allowed.y + 46, 48)}" class="svg-label">可裁切区域</text>`
  ].join("");
  const compromiseRects = compromise?.master ? `
    <rect x="${compromise.master.x}" y="${compromise.master.y}" width="${compromise.master.w}" height="${compromise.master.h}" fill="rgba(109,40,217,.05)" stroke="#6d28d9" stroke-width="10" stroke-dasharray="28 16"/>
    ${compromise.analyses.filter(item => item.crop).map((item, index) => `
      <rect x="${item.crop.crop.x}" y="${item.crop.crop.y}" width="${item.crop.crop.w}" height="${item.crop.crop.h}" fill="none" stroke="${index ? "#0891b2" : "#dc2626"}" stroke-width="5" stroke-dasharray="14 10"/>
    `).join("")}
  ` : "";

  return `
    <div class="canvas-wrap">
      <svg class="preview" viewBox="0 0 ${asset.width} ${asset.height}" role="img" aria-label="裁切预览">
        <defs>
          <pattern id="forbidden" width="80" height="80" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="80" stroke="#cbd5e1" stroke-width="18" opacity=".5"/>
          </pattern>
        </defs>
        <rect width="${asset.width}" height="${asset.height}" fill="#f8fafc"/>
        <rect width="${asset.width}" height="${asset.height}" fill="url(#forbidden)"/>
        <rect x="${allowed.x}" y="${allowed.y}" width="${allowed.w}" height="${allowed.h}" fill="rgba(37,99,235,.08)" stroke="#2563eb" stroke-width="5"/>
        ${asset.keyAreas.map(area => `
          <rect x="${area.x}" y="${area.y}" width="${area.w}" height="${area.h}" rx="8" fill="rgba(249,115,22,.22)" stroke="#f97316" stroke-width="5"/>
        `).join("")}
        ${safe ? `<rect x="${safe.x}" y="${safe.y}" width="${safe.w}" height="${safe.h}" fill="rgba(22,163,74,.08)" stroke="#16a34a" stroke-width="4" stroke-dasharray="16 10"/>` : ""}
        ${crop && !state.showCompromise ? `<rect x="${crop.x}" y="${crop.y}" width="${crop.w}" height="${crop.h}" fill="none" stroke="#dc2626" stroke-width="8"/>` : ""}
        ${compromiseRects}
        ${labels}
      </svg>
    </div>
  `;
}

function renderDialogs() {
  return `
    <dialog id="import-dialog">
      <form method="dialog" class="dialog-head">
        <strong>载入素材与渠道 JSON</strong><button value="cancel" aria-label="关闭">×</button>
      </form>
      <div class="dialog-body">
        <p class="hint">数据格式：{"assets": [...], "channels": [...]}。也可直接选择项目导出的 JSON 文件。</p>
        <input type="file" id="import-file" accept="application/json,.json">
        <div class="field" style="margin-top:12px;"><textarea id="import-text" placeholder='{"assets":[],"channels":[]}'></textarea></div>
        <div id="import-error" class="alert danger" hidden></div>
      </div>
      <div class="dialog-actions">
        <button id="import-confirm" class="primary">载入并替换当前数据</button>
      </div>
    </dialog>
  `;
}

function bindEvents() {
  app.querySelectorAll("[data-select-asset]").forEach(element => {
    element.addEventListener("click", () => {
      state.selectedAssetId = element.dataset.selectAsset;
      rerender();
    });
  });
  app.querySelectorAll("[data-select-channel]").forEach(element => {
    element.addEventListener("click", () => {
      state.showCompromise = false;
      state.selectedChannelId = element.dataset.selectChannel;
      rerender();
    });
  });

  const compromiseToggle = app.querySelector("[data-toggle-compromise]");
  compromiseToggle?.addEventListener("change", event => {
    state.showCompromise = event.target.checked;
    rerender();
  });
  app.querySelectorAll("[data-compromise-channel]").forEach(element => {
    element.addEventListener("change", () => {
      const id = element.dataset.compromiseChannel;
      state.compromiseChannelIds = element.checked
        ? [...new Set([...state.compromiseChannelIds, id])]
        : state.compromiseChannelIds.filter(item => item !== id);
      rerender();
    });
  });

  app.querySelectorAll("[data-model]").forEach(element => {
    element.addEventListener("change", event => applyModelChange(event.target));
  });

  app.querySelectorAll("[data-action]").forEach(element => {
    element.addEventListener("click", handleAction);
  });
}

function applyModelChange(element) {
  const isAsset = element.dataset.model === "asset";
  const target = isAsset ? selectedAsset() : selectedChannel();
  const targetId = target.id;
  const next = structuredClone(target);
  const key = element.dataset.key;
  let value = element.value;
  if (element.type === "number") {
    value = Number(value);
    if (!Number.isFinite(value)) return;
  }
  if (key === "tags") value = value.split(",").map(item => item.trim()).filter(Boolean);
  if (key === "acceptedFormats") value = value.split(",").map(item => item.trim().toUpperCase()).filter(Boolean);
  setDeep(next, key, value);
  try {
    if (isAsset) {
      const index = state.assets.findIndex(asset => asset.id === targetId);
      const normalized = normalizeAsset(next);
      normalized.id = targetId;
      state.assets[index] = normalized;
    } else {
      const index = state.channels.findIndex(channel => channel.id === targetId);
      const normalized = normalizeChannel(next);
      normalized.id = targetId;
      state.channels[index] = normalized;
    }
  } catch (error) {
    window.alert(error.message);
  }
  rerender(true);
}

function setDeep(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index];
    cursor = cursor[/^\d+$/.test(part) ? Number(part) : part];
  }
  cursor[parts.at(-1)] = value;
}

function handleAction(event) {
  const action = event.currentTarget.dataset.action;
  if (action === "add-asset") addAsset();
  if (action === "add-channel") addChannel();
  if (action === "add-key") addKeyArea();
  if (action === "delete-asset") deleteAsset();
  if (action === "delete-channel") deleteChannel();
  if (action === "reset") resetData();
  if (action === "export-json") exportJson();
  if (action === "import-json") openImport();
}

function addAsset() {
  const id = uniqueId("asset", state.assets);
  const asset = {
    id,
    name: "新素材",
    tags: ["待分类"],
    width: 1920,
    height: 1080,
    format: "PNG",
    allowedCrop: { x: 0, y: 0, w: 1920, h: 1080 },
    keyAreas: [{ x: 360, y: 240, w: 700, h: 420, label: "关键区域 1" }],
    notes: ""
  };
  state.assets.push(asset);
  state.selectedAssetId = id;
  rerender();
}

function addChannel() {
  const id = uniqueId("channel", state.channels);
  const channel = {
    id,
    name: "新渠道",
    targetWidth: 1080,
    targetHeight: 1080,
    safeMargin: { top: 8, right: 8, bottom: 8, left: 8 },
    acceptedFormats: ["JPG", "PNG"]
  };
  state.channels.push(channel);
  state.selectedChannelId = id;
  state.showCompromise = false;
  rerender();
}

function addKeyArea() {
  const asset = selectedAsset();
  asset.keyAreas.push({
    x: Math.round(asset.width * 0.25),
    y: Math.round(asset.height * 0.25),
    w: Math.round(asset.width * 0.2),
    h: Math.round(asset.height * 0.2),
    label: `关键区域 ${asset.keyAreas.length + 1}`
  });
  rerender();
}

function deleteAsset() {
  state.assets = state.assets.filter(asset => asset.id !== state.selectedAssetId);
  state.selectedAssetId = state.assets[0]?.id;
  rerender();
}

function deleteChannel() {
  state.channels = state.channels.filter(channel => channel.id !== state.selectedChannelId);
  state.compromiseChannelIds = state.compromiseChannelIds.filter(id => id !== state.selectedChannelId);
  state.selectedChannelId = state.channels[0]?.id;
  state.showCompromise = false;
  rerender();
}

function resetData() {
  state.assets = structuredClone(initialAssets);
  state.channels = structuredClone(initialChannels);
  state.selectedAssetId = initialAssets[0].id;
  state.selectedChannelId = initialChannels[0].id;
  state.compromiseChannelIds = [initialChannels[0].id, initialChannels[3].id];
  state.showCompromise = false;
  rerender();
}

function uniqueId(prefix, collection) {
  let index = collection.length + 1;
  let id = `${prefix}-${index}`;
  while (collection.some(item => item.id === id)) id = `${prefix}-${++index}`;
  return id;
}

function exportJson() {
  const data = JSON.stringify({ assets: state.assets, channels: state.channels }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "adaptation-workbench-data.json";
  link.click();
  URL.revokeObjectURL(url);
}

function openImport() {
  const dialog = document.querySelector("#import-dialog");
  dialog.showModal();
  const fileInput = dialog.querySelector("#import-file");
  const textInput = dialog.querySelector("#import-text");
  const error = dialog.querySelector("#import-error");
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    textInput.value = await file.text();
  };
  dialog.querySelector("#import-confirm").onclick = () => {
    try {
      const data = JSON.parse(textInput.value);
      if (!Array.isArray(data.assets) || !Array.isArray(data.channels)) throw new Error("JSON 必须包含 assets 数组和 channels 数组。");
      analyzeBatch(data.assets, data.channels);
      state.assets = data.assets;
      state.channels = data.channels;
      state.selectedAssetId = data.assets[0].id;
      state.selectedChannelId = data.channels[0].id;
      state.compromiseChannelIds = [data.channels[0], data.channels[3] ?? data.channels[1]].map(channel => channel.id);
      state.showCompromise = false;
      dialog.close();
      rerender();
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message;
    }
  };
}
