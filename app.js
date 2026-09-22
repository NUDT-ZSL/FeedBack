/* 素材渠道适配工作台 - 核心逻辑
 * 数据模型:
 *   asset:   { id, name, tags[], width, height, format, crop:{x,y,w,h}, key:{x,y,w,h} }
 *   channel: { id, name, width, height, margin, formats[] }
 */
"use strict";

const STORE_KEY = "adapt-workbench-v1";

let state = {
  assets: [],
  channels: [],
  selectedAssetId: null,
  selectedChannelIds: [], // 多渠道折中模式
};

/* ---------- 工具函数 ---------- */
function uid() { return "id-" + Math.random().toString(36).slice(2, 9); }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function centerOf(r) { return { cx: r.x + r.w / 2, cy: r.y + r.h / 2 }; }
function containsRect(outer, inner) {
  return inner.x >= outer.x - 1e-6 && inner.y >= outer.y - 1e-6 &&
    inner.x + inner.w <= outer.x + outer.w + 1e-6 &&
    inner.y + inner.h <= outer.y + outer.h + 1e-6;
}
function insetRect(r, m) { return { x: r.x + m, y: r.y + m, w: r.w - 2 * m, h: r.h - 2 * m }; }
function bboxOf(rects) {
  const x1 = Math.min(...rects.map(r => r.x));
  const y1 = Math.min(...rects.map(r => r.y));
  const x2 = Math.max(...rects.map(r => r.x + r.w));
  const y2 = Math.max(...rects.map(r => r.y + r.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
function fmt(n) { return Math.round(n); }

/* ---------- 裁切几何 ---------- */
// 在 region 内放置一个比例 ratio=w/h、至少 minW x minH 的矩形,
// 优先以 anchor 为中心并完整覆盖 cover(关键区域+边距)。放不下返回 null。
function planCrop(region, ratio, minW, minH, anchor, cover) {
  let w = Math.max(minW, cover ? cover.w : 0);
  let h = w / ratio;
  if (cover && h < cover.h) { h = cover.h; w = h * ratio; }
  if (h < minH) { h = minH; w = h * ratio; }
  if (w > region.w + 1e-6 || h > region.h + 1e-6) return null; // 区域放不下
  let x = anchor.cx - w / 2, y = anchor.cy - h / 2;
  if (cover) {
    x = clamp(x, cover.x + cover.w - w, cover.x);
    y = clamp(y, cover.y + cover.h - h, cover.y);
  }
  x = clamp(x, region.x, region.x + region.w - w);
  y = clamp(y, region.y, region.y + region.h - h);
  const rect = { x, y, w, h };
  if (cover && !containsRect(rect, cover)) return null;
  return rect;
}

/* ---------- 适配判定引擎 ---------- */
// 返回 { status: "ok"|"crop"|"fail", reasons[], plan, safeArea, keyLost }
// regionOverride 用于多渠道折中:在共享裁切区内评估单个渠道。
function evaluate(asset, channel, regionOverride) {
  const region = regionOverride || asset.crop;
  const reasons = [];
  const ratio = channel.width / channel.height;
  const srcRatio = asset.width / asset.height;

  // 1. 格式
  const formatOk = channel.formats.length === 0 ||
    channel.formats.includes(asset.format.toLowerCase());

  // 2. 关键区域保留所需的最小裁切范围:
  //    安全边距是目标分辨率下的像素,裁切框按比例缩放后边距同比缩放,
  //    因此安全区相对占比为 (1 - 2*margin/目标边长),关键区域必须落在其中。
  const rw = 1 - 2 * channel.margin / channel.width;
  const rh = 1 - 2 * channel.margin / channel.height;
  const kc = centerOf(asset.key);
  const cover = (rw > 0 && rh > 0) ? {
    x: kc.cx - asset.key.w / (2 * rw),
    y: kc.cy - asset.key.h / (2 * rh),
    w: asset.key.w / rw,
    h: asset.key.h / rh,
  } : null;

  let plan = cover ? planCrop(region, ratio, channel.width, channel.height, kc, cover) : null;
  let keyPreserved = !!plan;
  if (!plan) {
    // 退一步:放弃保留关键区域,仅满足尺寸与比例
    plan = planCrop(region, ratio, channel.width, channel.height, kc, null);
  }

  const sizeShort = !plan; // 区域内连目标尺寸都放不下
  if (sizeShort) {
    const maxW = Math.min(region.w, region.h * ratio);
    reasons.push("尺寸不足:可取图范围最多提供 " + fmt(maxW) + "x" + fmt(maxW / ratio) +
      ",低于目标 " + channel.width + "x" + channel.height);
  }
  if (!formatOk) {
    reasons.push("格式不符:素材为 " + asset.format + ",渠道要求 " +
      (channel.formats.join("/") || "任意"));
  }

  // 3. 判定结论
  const ratioMatch = Math.abs(srcRatio - ratio) / ratio < 0.01;
  const noCropNeeded = !regionOverride && ratioMatch &&
    asset.width >= channel.width && asset.height >= channel.height;

  let status, safeArea = null, keyLost = false;
  if (!formatOk || sizeShort) {
    status = "fail";
  } else {
    const sc = plan.w / channel.width;
    const m = channel.margin * sc;
    safeArea = insetRect(plan, m);
    keyLost = !containsRect(safeArea, asset.key);
    if (keyLost) {
      reasons.push("安全边距不足:关键内容区域超出安全区,裁切后可能丢失关键内容");
    }
    if (noCropNeeded && !keyLost &&
        containsRect(insetRect({ x: 0, y: 0, w: asset.width, h: asset.height }, m), asset.key)) {
      status = "ok";
      plan = { x: 0, y: 0, w: asset.width, h: asset.height };
      safeArea = insetRect(plan, m);
    } else {
      status = "crop";
      if (!ratioMatch) {
        reasons.push("比例不符:素材 " + srcRatio.toFixed(2) + ":1,渠道要求 " +
          ratio.toFixed(2) + ":1,需要裁切");
      } else {
        reasons.push("需要按目标尺寸与安全边距重新取景");
      }
    }
  }
  return { status, reasons, plan, safeArea, keyLost, keyPreserved };
}

/* ---------- 多渠道折中方案 ---------- */
// 为同一素材在多个渠道间寻找一个共享裁切区域,各渠道从中再取各自比例的子裁切。
function compromisePlan(asset, channels) {
  const perChannel = channels.map(ch => {
    const ev = evaluate(asset, ch);
    return { ch, ev, rect: ev.plan };
  });
  const valid = perChannel.filter(p => p.rect);
  if (valid.length === 0) {
    return { shared: null, rows: perChannel.map(p => ({
      ch: p.ch, ok: false, reason: "无可行裁切:" + p.ev.reasons.join(";") })) };
  }
  // 共享区域 = 各渠道理想裁切框的最小外接框,限制在可裁切区域内
  let shared = bboxOf(valid.map(p => p.rect));
  if (!containsRect(asset.crop, shared)) {
    const x1 = Math.max(shared.x, asset.crop.x);
    const y1 = Math.max(shared.y, asset.crop.y);
    shared = {
      x: x1, y: y1,
      w: Math.min(shared.x + shared.w, asset.crop.x + asset.crop.w) - x1,
      h: Math.min(shared.y + shared.h, asset.crop.y + asset.crop.h) - y1,
    };
  }
  // 在共享区域内逐渠道复用判定引擎
  const rows = perChannel.map(p => {
    const ev = evaluate(asset, p.ch, shared);
    if (ev.status === "fail") {
      return { ch: p.ch, ok: false,
        reason: ev.reasons.join(";") || "共享区域内无可行裁切" };
    }
    if (ev.keyLost) {
      return { ch: p.ch, ok: false, sub: ev.plan,
        reason: "关键区域超出该渠道安全边距" };
    }
    return { ch: p.ch, ok: true, sub: ev.plan, safe: ev.safeArea };
  });
  return { shared, rows };
}

/* ---------- 画布预览 ---------- */
const canvas = document.getElementById("preview-canvas");
const ctx = canvas.getContext("2d");

function drawPreview(asset, overlays) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // 素材占位图:渐变底 + 网格,按素材尺寸等比缩放居中
  const pad = 20;
  const s = Math.min((canvas.width - 2 * pad) / asset.width,
                     (canvas.height - 2 * pad) / asset.height);
  const ox = (canvas.width - asset.width * s) / 2;
  const oy = (canvas.height - asset.height * s) / 2;
  const R = r => ({ x: ox + r.x * s, y: oy + r.y * s, w: r.w * s, h: r.h * s });

  const g = ctx.createLinearGradient(ox, oy, ox + asset.width * s, oy + asset.height * s);
  g.addColorStop(0, "#334155"); g.addColorStop(1, "#1e293b");
  ctx.fillStyle = g;
  ctx.fillRect(ox, oy, asset.width * s, asset.height * s);
  ctx.strokeStyle = "#64748b";
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(ox + asset.width * s * i / 4, oy);
    ctx.lineTo(ox + asset.width * s * i / 4, oy + asset.height * s);
    ctx.moveTo(ox, oy + asset.height * s * i / 4);
    ctx.lineTo(ox + asset.width * s, oy + asset.height * s * i / 4);
    ctx.stroke();
  }
  ctx.fillStyle = "#94a3b8";
  ctx.font = "13px sans-serif";
  ctx.fillText(asset.name + "  " + asset.width + "x" + asset.height, ox + 6, oy + 18);

  const drawRect = (r, fill, stroke, dash) => {
    const q = R(r);
    ctx.save();
    if (dash) ctx.setLineDash([6, 4]);
    ctx.fillStyle = fill; ctx.fillRect(q.x, q.y, q.w, q.h);
    ctx.strokeStyle = stroke; ctx.lineWidth = 2;
    ctx.strokeRect(q.x, q.y, q.w, q.h);
    ctx.restore();
  };
  drawRect(asset.crop, "rgba(59,130,246,.18)", "rgba(59,130,246,.9)");
  drawRect(asset.key, "rgba(34,197,94,.22)", "rgba(34,197,94,.9)");
  overlays.forEach(o => {
    if (o.safe) drawRect(o.safe, "rgba(250,204,21,.15)", "rgba(250,204,21,.9)", true);
    if (o.rect) drawRect(o.rect, o.fill || "rgba(249,115,22,.2)",
                         o.stroke || "rgba(249,115,22,1)", o.dash);
    if (o.label && o.rect) {
      const q = R(o.rect);
      ctx.fillStyle = o.stroke || "#fb923c";
      ctx.fillText(o.label, q.x + 4, q.y + 14);
    }
  });
}

/* ---------- 渲染 ---------- */
const STATUS_TEXT = { ok: "可适配", crop: "需裁切", fail: "不可适配" };
const STATUS_CLASS = { ok: "badge-ok", crop: "badge-crop", fail: "badge-fail" };

function selectedAsset() { return state.assets.find(a => a.id === state.selectedAssetId); }
function selectedChannels() {
  return state.channels.filter(c => state.selectedChannelIds.includes(c.id));
}

function renderAssets() {
  const box = document.getElementById("asset-list");
  box.innerHTML = "";
  state.assets.forEach(a => {
    const div = document.createElement("div");
    div.className = "item-card" + (a.id === state.selectedAssetId ? " selected" : "");
    const badges = state.channels.map(c => {
      const ev = evaluate(a, c);
      return '<span class="badge ' + STATUS_CLASS[ev.status] + '" title="' +
        c.name + '">' + c.name + ":" + STATUS_TEXT[ev.status] + "</span>";
    }).join(" ");
    div.innerHTML =
      '<div class="title"><span>' + a.name + '</span><span>' + a.width + "x" + a.height +
      " " + a.format + "</span></div>" +
      '<div class="meta">' + a.tags.map(t => '<span class="tag">' + t + "</span>").join("") +
      "</div>" +
      (badges ? '<div class="meta">' + badges + "</div>" : "") +
      '<div class="item-actions"><button class="btn" data-act="edit">编辑</button>' +
      '<button class="btn btn-danger" data-act="del">删除</button></div>';
    div.addEventListener("click", e => {
      if (e.target.dataset.act === "edit") { fillAssetForm(a); return; }
      if (e.target.dataset.act === "del") {
        state.assets = state.assets.filter(x => x.id !== a.id);
        if (state.selectedAssetId === a.id) state.selectedAssetId = null;
        persist(); renderAll(); return;
      }
      state.selectedAssetId = a.id; persist(); renderAll();
    });
    box.appendChild(div);
  });
}

function renderChannels() {
  const box = document.getElementById("channel-list");
  box.innerHTML = "";
  const asset = selectedAsset();
  state.channels.forEach(c => {
    const div = document.createElement("div");
    div.className = "item-card" +
      (state.selectedChannelIds.includes(c.id) ? " selected" : "");
    const ratio = (c.width / c.height).toFixed(2);
    let badge = "";
    if (asset) {
      const ev = evaluate(asset, c);
      badge = '<span class="badge ' + STATUS_CLASS[ev.status] + '">' +
        STATUS_TEXT[ev.status] + "</span>";
    }
    div.innerHTML =
      '<div class="title channel-check"><label><input type="checkbox" ' +
      (state.selectedChannelIds.includes(c.id) ? "checked" : "") +
      '> <span>' + c.name + "</span></label>" + badge + "</div>" +
      '<div class="meta">' + c.width + "x" + c.height + " (" + ratio + ":1) 边距 " +
      c.margin + "px 格式 " + (c.formats.join("/") || "任意") + "</div>" +
      '<div class="item-actions"><button class="btn" data-act="edit">编辑</button>' +
      '<button class="btn btn-danger" data-act="del">删除</button></div>';
    div.querySelector("input[type=checkbox]").addEventListener("change", e => {
      if (e.target.checked) state.selectedChannelIds.push(c.id);
      else state.selectedChannelIds = state.selectedChannelIds.filter(id => id !== c.id);
      persist(); renderAll();
    });
    div.addEventListener("click", e => {
      if (e.target.closest("label") || e.target.tagName === "INPUT") return;
      if (e.target.dataset.act === "edit") { fillChannelForm(c); return; }
      if (e.target.dataset.act === "del") {
        state.channels = state.channels.filter(x => x.id !== c.id);
        state.selectedChannelIds = state.selectedChannelIds.filter(id => id !== c.id);
        persist(); renderAll(); return;
      }
      // 单击卡片:单选该渠道
      state.selectedChannelIds = [c.id]; persist(); renderAll();
    });
    box.appendChild(div);
  });
}

function renderVerdict() {
  const box = document.getElementById("verdict-box");
  const cbox = document.getElementById("compromise-box");
  const empty = document.getElementById("preview-empty");
  const subtitle = document.getElementById("preview-subtitle");
  box.innerHTML = ""; cbox.innerHTML = "";
  const asset = selectedAsset();
  const chans = selectedChannels();
  if (!asset || chans.length === 0) {
    empty.style.display = "block";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    subtitle.textContent = "";
    return;
  }
  empty.style.display = "none";
  subtitle.textContent = asset.name + " / " + chans.map(c => c.name).join("、");

  if (chans.length === 1) {
    const ch = chans[0];
    const ev = evaluate(asset, ch);
    drawPreview(asset, ev.plan ? [{ rect: ev.plan, safe: ev.safeArea,
      label: "裁切 " + fmt(ev.plan.w) + "x" + fmt(ev.plan.h) }] : []);
    const cls = ev.status === "ok" ? "verdict-ok" : ev.status === "crop" ? "verdict-crop" : "verdict-fail";
    let html = '<div class="verdict ' + cls + '"><h3>' + ch.name + ":" +
      STATUS_TEXT[ev.status] + "</h3>";
    if (ev.plan && ev.status !== "fail") {
      html += "<div>裁切方案:起点 (" + fmt(ev.plan.x) + ", " + fmt(ev.plan.y) +
        "),尺寸 " + fmt(ev.plan.w) + "x" + fmt(ev.plan.h) +
        ",缩放至 " + ch.width + "x" + ch.height + "</div>";
      html += ev.keyLost
        ? '<div class="warn">⚠ 关键内容区域超出安全边距,裁切后可能丢失关键内容</div>'
        : "<div>关键内容区域完整保留在安全边距内。</div>";
    }
    if (ev.reasons.length) {
      html += "<ul>" + ev.reasons.map(r => "<li>" + r + "</li>").join("") + "</ul>";
    }
    box.innerHTML = html + "</div>";
  } else {
    const cp = compromisePlan(asset, chans);
    const overlays = [];
    if (cp.shared) overlays.push({ rect: cp.shared,
      fill: "rgba(168,85,247,.15)", stroke: "rgba(168,85,247,1)",
      label: "共享裁切区", dash: true });
    cp.rows.forEach((r, i) => {
      if (r.sub) overlays.push({ rect: r.sub, safe: r.safe,
        stroke: ["#f97316", "#06b6d4", "#84cc16", "#e879f9"][i % 4],
        label: r.ch.name });
    });
    drawPreview(asset, overlays);
    let html = '<div class="compromise"><h3>多渠道折中裁切方案(' +
      chans.length + " 个渠道)</h3>";
    if (cp.shared) {
      html += "<div>共享裁切区:(" + fmt(cp.shared.x) + ", " + fmt(cp.shared.y) + ") " +
        fmt(cp.shared.w) + "x" + fmt(cp.shared.h) + "</div>";
    }
    html += "<table><tr><th>渠道</th><th>结果</th><th>说明</th></tr>";
    cp.rows.forEach(r => {
      html += "<tr><td>" + r.ch.name + "</td><td>" +
        (r.ok ? '<span class="badge badge-ok">可满足</span>'
              : '<span class="badge badge-fail">无法满足</span>') +
        "</td><td>" + (r.ok
          ? "子裁切 " + fmt(r.sub.w) + "x" + fmt(r.sub.h) + ",关键区域保留"
          : r.reason) + "</td></tr>";
    });
    cbox.innerHTML = html + "</table></div>";
  }
}

function renderAll() { renderAssets(); renderChannels(); renderVerdict(); }

/* ---------- 表单 ---------- */
function num(id, fallback) {
  const v = parseFloat(document.getElementById(id).value);
  return isNaN(v) ? (fallback || 0) : v;
}
function setVal(id, v) { document.getElementById(id).value = v; }

function fillAssetForm(a) {
  setVal("asset-id", a.id); setVal("asset-name", a.name);
  setVal("asset-tags", a.tags.join(", "));
  setVal("asset-w", a.width); setVal("asset-h", a.height);
  setVal("asset-format", a.format);
  setVal("asset-cx", a.crop.x); setVal("asset-cy", a.crop.y);
  setVal("asset-cw", a.crop.w); setVal("asset-ch", a.crop.h);
  setVal("asset-kx", a.key.x); setVal("asset-ky", a.key.y);
  setVal("asset-kw", a.key.w); setVal("asset-kh", a.key.h);
  document.getElementById("asset-editor").open = true;
}
function clearAssetForm() {
  document.getElementById("asset-form").reset();
  setVal("asset-id", "");
}
function fillChannelForm(c) {
  setVal("channel-id", c.id); setVal("channel-name", c.name);
  setVal("channel-w", c.width); setVal("channel-h", c.height);
  setVal("channel-margin", c.margin);
  setVal("channel-formats", c.formats.join(", "));
  document.getElementById("channel-editor").open = true;
}
function clearChannelForm() {
  document.getElementById("channel-form").reset();
  setVal("channel-id", "");
}

document.getElementById("asset-form").addEventListener("submit", e => {
  e.preventDefault();
  const id = document.getElementById("asset-id").value || uid();
  const w = num("asset-w", 1), h = num("asset-h", 1);
  const asset = {
    id,
    name: document.getElementById("asset-name").value.trim() || "未命名素材",
    tags: document.getElementById("asset-tags").value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
    width: w, height: h,
    format: document.getElementById("asset-format").value,
    crop: { x: num("asset-cx"), y: num("asset-cy"),
            w: clamp(num("asset-cw", w), 1, w), h: clamp(num("asset-ch", h), 1, h) },
    key: { x: num("asset-kx"), y: num("asset-ky"),
           w: clamp(num("asset-kw", w), 1, w), h: clamp(num("asset-kh", h), 1, h) },
  };
  const i = state.assets.findIndex(a => a.id === id);
  if (i >= 0) state.assets[i] = asset; else state.assets.push(asset);
  state.selectedAssetId = id;
  clearAssetForm(); persist(); renderAll();
});
document.getElementById("asset-cancel").addEventListener("click", clearAssetForm);

document.getElementById("channel-form").addEventListener("submit", e => {
  e.preventDefault();
  const id = document.getElementById("channel-id").value || uid();
  const ch = {
    id,
    name: document.getElementById("channel-name").value.trim() || "未命名渠道",
    width: num("channel-w", 1), height: num("channel-h", 1),
    margin: num("channel-margin"),
    formats: document.getElementById("channel-formats").value
      .split(/[,，]/).map(s => s.trim().toLowerCase()).filter(Boolean),
  };
  const i = state.channels.findIndex(c => c.id === id);
  if (i >= 0) state.channels[i] = ch; else state.channels.push(ch);
  if (!state.selectedChannelIds.includes(id)) state.selectedChannelIds.push(id);
  clearChannelForm(); persist(); renderAll();
});
document.getElementById("channel-cancel").addEventListener("click", clearChannelForm);

/* ---------- 持久化 / 导入导出 ---------- */
function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}
function restore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) state = Object.assign(state, JSON.parse(raw));
  } catch (err) { /* 忽略损坏数据 */ }
}
document.getElementById("btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ assets: state.assets, channels: state.channels }, null, 2)],
    { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "adapt-workbench.json";
  a.click();
  URL.revokeObjectURL(a.href);
});
document.getElementById("file-import").addEventListener("change", e => {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (Array.isArray(data.assets)) state.assets = data.assets;
      if (Array.isArray(data.channels)) state.channels = data.channels;
      state.selectedAssetId = state.assets[0] ? state.assets[0].id : null;
      state.selectedChannelIds = state.channels.slice(0, 1).map(c => c.id);
      persist(); renderAll();
    } catch (err) { alert("导入失败:JSON 格式不正确"); }
  };
  reader.readAsText(f);
  e.target.value = "";
});
document.getElementById("btn-reset").addEventListener("click", () => {
  if (!confirm("确定清空全部素材与渠道数据?")) return;
  state.assets = []; state.channels = [];
  state.selectedAssetId = null; state.selectedChannelIds = [];
  persist(); renderAll();
});
document.getElementById("btn-load-sample").addEventListener("click", () => {
  loadSample(); persist(); renderAll();
});

/* ---------- 示例数据 ---------- */
function loadSample() {
  state.assets = [
    { id: uid(), name: "夏季主视觉海报", tags: ["横幅", "活动"], width: 3000, height: 2000,
      format: "jpg", crop: { x: 0, y: 0, w: 3000, h: 2000 },
      key: { x: 900, y: 500, w: 1200, h: 1000 } },
    { id: uid(), name: "产品白底图", tags: ["产品图", "电商"], width: 2400, height: 2400,
      format: "png", crop: { x: 100, y: 100, w: 2200, h: 2200 },
      key: { x: 600, y: 600, w: 1200, h: 1200 } },
    { id: uid(), name: "门店实景照片", tags: ["门店", "实景"], width: 4000, height: 2250,
      format: "jpg", crop: { x: 0, y: 100, w: 4000, h: 2050 },
      key: { x: 1200, y: 600, w: 1600, h: 1100 } },
    { id: uid(), name: "品牌插画", tags: ["插画", "品牌"], width: 1600, height: 1600,
      format: "webp", crop: { x: 0, y: 0, w: 1600, h: 1600 },
      key: { x: 300, y: 300, w: 1000, h: 1000 } },
  ];
  state.channels = [
    { id: uid(), name: "公众号头图", width: 900, height: 383, margin: 40,
      formats: ["jpg", "png"] },
    { id: uid(), name: "小红书封面", width: 1080, height: 1440, margin: 60,
      formats: ["jpg", "png", "webp"] },
    { id: uid(), name: "抖音信息流", width: 1080, height: 1920, margin: 120,
      formats: ["jpg", "png"] },
    { id: uid(), name: "电商详情页", width: 750, height: 750, margin: 20,
      formats: ["jpg", "png", "webp", "gif"] },
    { id: uid(), name: "户外大屏", width: 3840, height: 1080, margin: 80,
      formats: ["jpg"] },
  ];
  state.selectedAssetId = state.assets[0].id;
  state.selectedChannelIds = [state.channels[0].id];
}

/* ---------- 启动 ---------- */
restore();
if (state.assets.length === 0 && state.channels.length === 0) {
  loadSample();
  persist();
}
renderAll();
