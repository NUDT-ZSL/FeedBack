const round = (value, precision = 3) => Number(value.toFixed(precision));

export function normalizeRect(rect = {}) {
  return {
    x: Number(rect.x ?? 0),
    y: Number(rect.y ?? 0),
    w: Number(rect.w ?? 0),
    h: Number(rect.h ?? 0)
  };
}

export function rectsIntersect(a, b) {
  a = normalizeRect(a);
  b = normalizeRect(b);
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function formatRatio(w, h) {
  const gcd = (x, y) => (Math.abs(y) < 1e-9 ? x : gcd(y, x % y));
  const divisor = gcd(Math.round(w), Math.round(h));
  return `${Math.round(w / divisor)}:${Math.round(h / divisor)}`;
}

export function normalizeAsset(input = {}) {
  const width = Number(input.width ?? input.w);
  const height = Number(input.height ?? input.h);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error(`素材“${input.name || input.id || "未命名"}”缺少有效的原始宽高。`);
  }

  const allowed = clampRect(input.allowedCrop ?? { x: 0, y: 0, w: width, h: height }, width, height);
  if (allowed.w <= 0 || allowed.h <= 0) {
    throw new Error(`素材“${input.name || "未命名"}”的可裁切区域无效。`);
  }

  const keyAreas = (input.keyAreas ?? []).map((area, index) => {
    const rect = clampRect(area, width, height);
    return { ...rect, label: area.label || `关键区域 ${index + 1}` };
  }).filter(area => area.w > 0 && area.h > 0);

  return {
    id: String(input.id ?? input.name ?? "asset"),
    name: input.name || input.id || "未命名素材",
    tags: input.tags ?? [],
    width,
    height,
    format: String(input.format || "PNG").toUpperCase(),
    allowedCrop: allowed,
    keyAreas,
    notes: input.notes || ""
  };
}

export function normalizeChannel(input = {}) {
  const width = Number(input.targetWidth ?? input.width);
  const height = Number(input.targetHeight ?? input.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error(`渠道“${input.name || input.id || "未命名"}”缺少有效的目标宽高。`);
  }

  const margin = {
    top: clampNumber(input.safeMargin?.top ?? input.safeMargin?.vertical ?? 0),
    right: clampNumber(input.safeMargin?.right ?? input.safeMargin?.horizontal ?? 0),
    bottom: clampNumber(input.safeMargin?.bottom ?? input.safeMargin?.vertical ?? 0),
    left: clampNumber(input.safeMargin?.left ?? input.safeMargin?.horizontal ?? 0)
  };

  return {
    id: String(input.id ?? input.name ?? "channel"),
    name: input.name || input.id || "未命名渠道",
    targetWidth: width,
    targetHeight: height,
    aspectRatio: width / height,
    safeMargin: margin,
    acceptedFormats: (input.acceptedFormats ?? input.formats ?? ["JPG", "PNG"]).map(format => String(format).toUpperCase()),
    maxFileSizeMB: input.maxFileSizeMB ? Number(input.maxFileSizeMB) : null
  };
}

function clampNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(number, 50);
}

function clampRect(input, width, height) {
  const x = Math.max(0, Number(input.x ?? 0));
  const y = Math.max(0, Number(input.y ?? 0));
  const w = Math.max(0, Number(input.w ?? width));
  const h = Math.max(0, Number(input.h ?? height));
  return {
    x: Math.min(x, width),
    y: Math.min(y, height),
    w: Math.min(w, width - x),
    h: Math.min(h, height - y)
  };
}

const REASONS = {
  RESOLUTION: "尺寸不足：可裁切区域无法提供目标分辨率",
  RATIO: "比例不符：需要裁切才能匹配目标宽高比",
  FORMAT: `格式不符：需要导出为渠道要求的格式`,
  MARGIN: "安全边距：关键内容无法保持在安全区内",
  CROP_AREA: "可裁切区域受限：找不到同时满足比例和边距的裁切框",
  KEY_CUT: "关键区域会被裁切或无法完整保留"
};

export const STATUS = {
  ADAPTABLE: { id: "adaptable", label: "可适配", tone: "ok" },
  NEEDS_CROP: { id: "needs_crop", label: "需裁切", tone: "warn" },
  IMPOSSIBLE: { id: "impossible", label: "不可适配", tone: "bad" }
};

export { REASONS };

export function computeCropGeometry(asset, channel) {
  const a = normalizeRect(asset.allowedCrop);
  const tw = channel.targetWidth;
  const th = channel.targetHeight;
  const margin = channel.safeMargin;
  const safeLeft = margin.left / 100;
  const safeTop = margin.top / 100;
  const safeRight = margin.right / 100;
  const safeBottom = margin.bottom / 100;
  const safeW = 1 - safeLeft - safeRight;
  const safeH = 1 - safeTop - safeBottom;

  let upper = Math.min(a.w / tw, a.h / th);
  let lower = 1;
  let blockers = [];

  if (upper <= 0) {
    return { feasible: false, s: 0, blockers: ["RESOLUTION"] };
  }

  for (const key of asset.keyAreas) {
    lower = Math.max(lower, key.w / (tw * safeW), key.h / (th * safeH));
    const topSpace = (key.y - a.y) / (th * safeTop || 1);
    const leftSpace = (key.x - a.x) / (tw * safeLeft || 1);
    const bottomSpace = (a.y + a.h - key.y - key.h) / (th * safeBottom || 1);
    const rightSpace = (a.x + a.w - key.x - key.w) / (tw * safeRight || 1);
    if (safeTop > 0) upper = Math.min(upper, topSpace);
    if (safeLeft > 0) upper = Math.min(upper, leftSpace);
    if (safeBottom > 0) upper = Math.min(upper, bottomSpace);
    if (safeRight > 0) upper = Math.min(upper, rightSpace);
  }

  const s = upper;
  if (lower > upper + 1e-9) {
    const geoMax = Math.min(a.w / tw, a.h / th);
    blockers = geoMax < 1 ? ["RESOLUTION"] : ["MARGIN", "CROP_AREA"];
    if (asset.keyAreas.length) blockers.push("KEY_CUT");
    return { feasible: false, s: round(upper, 4), minimumScale: round(lower, 4), blockers, geometricMax: geoMax };
  }

  const cropW = tw * s;
  const cropH = th * s;
  let xLow = a.x;
  let xHigh = a.x + a.w - cropW;
  let yLow = a.y;
  let yHigh = a.y + a.h - cropH;

  for (const key of asset.keyAreas) {
    xLow = Math.max(xLow, key.x + key.w - cropW + cropW * safeLeft);
    xHigh = Math.min(xHigh, key.x - cropW * safeRight);
    yLow = Math.max(yLow, key.y + key.h - cropH + cropH * safeBottom);
    yHigh = Math.min(yHigh, key.y - cropH * safeTop);
  }

  if (xLow > xHigh + 1e-7 || yLow > yHigh + 1e-7) {
    return {
      feasible: false,
      s,
      blockers: ["MARGIN", "CROP_AREA", ...(asset.keyAreas.length ? ["KEY_CUT"] : [])]
    };
  }

  const focus = focusCenter(asset.keyAreas, asset);
  const safeCenterX = safeLeft + safeW / 2;
  const safeCenterY = safeTop + safeH / 2;
  const x = clamp(focus.x - cropW * safeCenterX, xLow, xHigh);
  const y = clamp(focus.y - cropH * safeCenterY, yLow, yHigh);
  const crop = { x: round(x, 2), y: round(y, 2), w: round(cropW, 2), h: round(cropH, 2) };
  const safeRect = {
    x: round(x + cropW * safeLeft, 2),
    y: round(y + cropH * safeTop, 2),
    w: round(cropW * safeW, 2),
    h: round(cropH * safeH, 2)
  };

  return {
    feasible: true,
    s: round(s, 4),
    crop,
    safeRect,
    minimumScale: round(lower, 4),
    outputWidth: tw,
    outputHeight: th,
    risk: assessRisk(asset, crop, safeRect)
  };
}

function focusCenter(keyAreas, asset) {
  if (!keyAreas.length) {
    return { x: asset.width / 2, y: asset.height / 2 };
  }
  const minX = Math.min(...keyAreas.map(area => area.x));
  const minY = Math.min(...keyAreas.map(area => area.y));
  const maxX = Math.max(...keyAreas.map(area => area.x + area.w));
  const maxY = Math.max(...keyAreas.map(area => area.y + area.h));
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function assessRisk(asset, crop, safeRect) {
  if (!asset.keyAreas.length) {
    return { level: "warning", message: "未标注关键区域：几何方案可行，但无法确认关键内容是否丢失。" };
  }
  const keyUnion = unionRect(asset.keyAreas);
  const safeFillX = keyUnion.w / safeRect.w;
  const safeFillY = keyUnion.h / safeRect.h;
  if (safeFillX > 0.92 || safeFillY > 0.92) {
    return { level: "warning", message: "关键区域几乎占满安全区，渠道边距调整或审校时容错较低。" };
  }
  const removed = 1 - (crop.w * crop.h) / (asset.width * asset.height);
  if (removed > 0.3) {
    return { level: "warning", message: `关键区域已保护，但该方案会舍弃约 ${Math.round(removed * 100)}% 原始画面。` };
  }
  return { level: "safe", message: "已标注的关键区域完整位于安全区内，关键内容丢失风险低。" };
}

function unionRect(rects) {
  const minX = Math.min(...rects.map(rect => rect.x));
  const minY = Math.min(...rects.map(rect => rect.y));
  const maxX = Math.max(...rects.map(rect => rect.x + rect.w));
  const maxY = Math.max(...rects.map(rect => rect.y + rect.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function analyzeAsset(rawAsset, rawChannel) {
  const asset = normalizeAsset(rawAsset);
  const channel = normalizeChannel(rawChannel);
  const formatAccepted = channel.acceptedFormats.includes(asset.format);
  const ratioMismatch = Math.abs(asset.width / asset.height - channel.aspectRatio) > 1e-6;
  const directMargin = directMarginPasses(asset, channel);
  const geometry = computeCropGeometry(asset, channel);
  const sourceRatio = asset.width / asset.height;

  const checks = [
    {
      code: "SIZE",
      label: "目标尺寸",
      pass: geometry.geometricMax ? geometry.geometricMax >= 1 : geometry.s >= 1,
      expected: `${channel.targetWidth}×${channel.targetHeight}`,
      actual: `${asset.width}×${asset.height}`
    },
    {
      code: "RATIO",
      label: "宽高比",
      pass: !ratioMismatch,
      expected: `${formatRatio(channel.targetWidth, channel.targetHeight)} (${round(channel.aspectRatio, 3)})`,
      actual: `${formatRatio(asset.width, asset.height)} (${round(sourceRatio, 3)})`
    },
    {
      code: "MARGIN",
      label: "安全边距",
      pass: directMargin.pass,
      expected: marginText(channel),
      actual: directMargin.message
    },
    {
      code: "FORMAT",
      label: "格式",
      pass: formatAccepted,
      expected: channel.acceptedFormats.join(" / "),
      actual: asset.format
    }
  ];

  const reasons = [];
  if (!checks[0].pass) reasons.push(REASONS.RESOLUTION);
  if (!checks[1].pass) reasons.push(REASONS.RATIO);
  if (!checks[2].pass) reasons.push(REASONS.MARGIN);
  if (!checks[3].pass) reasons.push(REASONS.FORMAT);
  if (!geometry.feasible) reasons.push(...geometry.blockers.map(code => REASONS[code]).filter(Boolean));

  let status = STATUS.ADAPTABLE;
  if (!geometry.feasible) {
    status = STATUS.IMPOSSIBLE;
  } else if (ratioMismatch || !directMargin.pass) {
    status = STATUS.NEEDS_CROP;
  }

  const exportFormats = channel.acceptedFormats.includes(asset.format)
    ? [asset.format, ...channel.acceptedFormats.filter(format => format !== asset.format)]
    : channel.acceptedFormats;

  return {
    assetId: asset.id,
    channelId: channel.id,
    status,
    reasons: [...new Set(reasons)],
    checks,
    directUse: status === STATUS.ADAPTABLE && !ratioMismatch && directMargin.pass,
    crop: geometry.feasible ? geometry : null,
    suggestedExportFormat: exportFormats[0],
    formatConversionRequired: !formatAccepted,
    channel,
    asset
  };
}

export function analyzeBatch(rawAssets, rawChannels) {
  const assets = rawAssets.map(normalizeAsset);
  const channels = rawChannels.map(normalizeChannel);
  return assets.map(asset => ({
    asset,
    results: channels.map(channel => analyzeAsset(asset, channel))
  }));
}

export function compromiseCrop(rawAsset, rawChannels) {
  const asset = normalizeAsset(rawAsset);
  const analyses = rawChannels.map(channel => analyzeAsset(asset, channel));
  const feasible = analyses.filter(item => item.crop?.feasible);
  const unsatisfied = analyses
    .filter(item => !item.crop?.feasible)
    .map(item => ({
      channelId: item.channelId,
      name: item.channel.name,
      reasons: item.reasons
    }));

  if (!feasible.length) {
    return {
      asset,
      master: null,
      analyses,
      unsatisfied,
      risk: { level: "danger", message: "所选渠道均找不到可行裁切方案。" }
    };
  }

  const master = unionRect(feasible.map(item => item.crop.crop));
  const subCrops = feasible.map(item => {
    const rect = item.crop.crop;
    return {
      channelId: item.channelId,
      name: item.channel.name,
      x: round(rect.x - master.x, 2),
      y: round(rect.y - master.y, 2),
      w: rect.w,
      h: rect.h,
      outputWidth: item.channel.targetWidth,
      outputHeight: item.channel.targetHeight,
      risk: item.crop.risk
    };
  });

  const removed = 1 - master.w * master.h / (asset.width * asset.height);
  const risk = unsatisfied.length
    ? { level: "danger", message: `主裁切可覆盖 ${feasible.length} 个渠道；${unsatisfied.length} 个渠道仍无法满足。` }
    : removed > 0.3
      ? { level: "warning", message: `所有渠道关键区域均已保护；主裁切将舍弃约 ${Math.round(removed * 100)}% 原始画面。` }
      : { level: "safe", message: "一个主裁切可覆盖所有所选渠道，关键区域风险低。" };

  return { asset, master: { ...master, w: round(master.w, 2), h: round(master.h, 2) }, subCrops, analyses, unsatisfied, risk };
}

function directMarginPasses(asset, channel) {
  if (!asset.keyAreas.length) {
    return { pass: true, message: "未标注关键区域，暂无法自动判定内容边距。" };
  }
  const safe = {
    x: asset.width * channel.safeMargin.left / 100,
    y: asset.height * channel.safeMargin.top / 100,
    w: asset.width * (1 - (channel.safeMargin.left + channel.safeMargin.right) / 100),
    h: asset.height * (1 - (channel.safeMargin.top + channel.safeMargin.bottom) / 100)
  };
  const violations = asset.keyAreas.filter(area =>
    area.x < safe.x - 1e-6 ||
    area.y < safe.y - 1e-6 ||
    area.x + area.w > safe.x + safe.w + 1e-6 ||
    area.y + area.h > safe.y + safe.h + 1e-6
  );
  if (violations.length) {
    return { pass: false, message: `${violations.map(area => area.label).join("、")} 位于原图安全区外` };
  }
  return { pass: true, message: "关键区域均在原图安全区内" };
}

function marginText(channel) {
  const margin = channel.safeMargin;
  return `上${margin.top}% 右${margin.right}% 下${margin.bottom}% 左${margin.left}%`;
}
