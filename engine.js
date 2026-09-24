"use strict";
/* 适配推导引擎：纯函数，不依赖 DOM，可在 Node 中直接测试。
   每个结论只由 (素材, 规格, 覆盖) 三者决定，互相独立。 */

const STRATEGY_LABELS = { scale: "缩放", crop: "裁切", recompose: "重新构图", none: "无法满足" };
const ASPECT_TOL = 0.01; // 宽高比容差

function aspect(w, h) { return w / h; }
function sameAspect(aw, ah, tw, th) {
  return Math.abs(aspect(aw, ah) - aspect(tw, th)) / aspect(tw, th) <= ASPECT_TOL;
}
function fmt(n) { return String(Math.round(n)); }

/* 计算某一策略下的几何结果与约束校验。
   返回 { scaleFactor, outW, outH, cropX, cropY, mode, checks } */
function evalStrategy(asset, spec, strategy) {
  const aw = asset.width, ah = asset.height;
  const tw = spec.targetW, th = spec.targetH;
  const safeW = tw * (1 - 2 * spec.safeMarginPct);
  const safeH = th * (1 - 2 * spec.safeMarginPct);
  let s, outW, outH, cropX = 0, cropY = 0, mode;
  if (strategy === "crop") {
    // 覆盖式缩放后居中裁切
    s = Math.max(tw / aw, th / ah);
    cropX = Math.max(0, aw * s - tw);
    cropY = Math.max(0, ah * s - th);
    outW = tw; outH = th; mode = "cover";
  } else {
    // 等比缩放；比例不一致时留边（fit）
    const exact = sameAspect(aw, ah, tw, th);
    s = exact ? tw / aw : Math.min(tw / aw, th / ah);
    outW = aw * s; outH = ah * s;
    mode = exact ? "exact" : "fit";
  }
  const rw = asset.minReadableW * s, rh = asset.minReadableH * s;
  const checks = {
    minReadable: {
      ok: rw <= outW + 1e-6 && rh <= outH + 1e-6,
      detail: "可读区 " + fmt(rw) + "×" + fmt(rh) + " / 可见区 " + fmt(outW) + "×" + fmt(outH)
    },
    safeMargin: {
      ok: rw <= safeW + 1e-6 && rh <= safeH + 1e-6,
      detail: "可读区 " + fmt(rw) + "×" + fmt(rh) + " / 安全区 " + fmt(safeW) + "×" + fmt(safeH)
    }
  };
  return { scaleFactor: s, outW, outH, cropX, cropY, mode, checks };
}

/* 把校验结果翻译成冲突说明，指出是哪项约束无法满足 */
function collectConflicts(checks) {
  const out = [];
  if (!checks) return out;
  if (!checks.safeMargin.ok) out.push("安全边距不足（" + checks.safeMargin.detail + "）");
  if (!checks.minReadable.ok) out.push("最小可读区域无法保留（" + checks.minReadable.detail + "）");
  return out;
}

function makeResult(strategy, geometry, note, overridden) {
  const checks = geometry ? geometry.checks : null;
  let label = STRATEGY_LABELS[strategy];
  if (strategy === "scale" && geometry && geometry.mode === "fit") label += "（留边）";
  return {
    strategy, label, overridden: !!overridden,
    geometry, checks,
    conflicts: collectConflicts(checks),
    note: note || ""
  };
}

/* 推导一个「素材 × 规格」的适配方案。
   overrideStrategy 为 null 表示自动推导；否则按用户覆盖的策略计算。 */
function deriveFit(asset, spec, overrideStrategy) {
  if (overrideStrategy === "recompose") {
    return makeResult("recompose", null, "手动指定重新构图，需人工处理", true);
  }
  if (overrideStrategy === "scale" || overrideStrategy === "crop") {
    const g = evalStrategy(asset, spec, overrideStrategy);
    const r = makeResult(overrideStrategy, g, "手动覆盖", true);
    if (r.conflicts.length) r.note = "手动覆盖，但存在约束冲突";
    return r;
  }
  // 自动推导：比例一致优先直接缩放
  if (spec.allowScale && sameAspect(asset.width, asset.height, spec.targetW, spec.targetH)) {
    return makeResult("scale", evalStrategy(asset, spec, "scale"), "宽高比一致，直接缩放");
  }
  let cropG = null, scaleG = null;
  if (spec.allowCrop) {
    cropG = evalStrategy(asset, spec, "crop");
    if (!collectConflicts(cropG.checks).length) {
      return makeResult("crop", cropG, "宽高比不同，覆盖式缩放后居中裁切");
    }
  }
  if (spec.allowScale) {
    scaleG = evalStrategy(asset, spec, "scale");
    if (!collectConflicts(scaleG.checks).length) {
      return makeResult("scale", scaleG, "宽高比不同且裁切不满足约束，等比缩放留边");
    }
  }
  // 自动策略全部失败：用裁切（或缩放）的校验结果说明冲突原因
  const best = cropG || scaleG;
  const r = makeResult(spec.allowRecompose ? "recompose" : "none", best, "", false);
  if (!r.conflicts.length && !best) r.conflicts.push("规格未允许任何可用策略");
  r.note = spec.allowRecompose
    ? "自动缩放/裁切均无法满足约束，需重新构图"
    : "该规格不允许重新构图，且没有策略能同时满足约束";
  return r;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { deriveFit, evalStrategy, collectConflicts, sameAspect, STRATEGY_LABELS };
}
