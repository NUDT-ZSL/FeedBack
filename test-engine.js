"use strict";
/* 引擎校验脚本：node test-engine.js */
const { deriveFit } = require("./engine.js");

const assets = {
  A1: { id: "A1", name: "首页主视觉", width: 2400, height: 1200, minReadableW: 1600, minReadableH: 800 },
  A2: { id: "A2", name: "产品图标", width: 1024, height: 1024, minReadableW: 512, minReadableH: 512 },
  A3: { id: "A3", name: "详情长图", width: 1080, height: 3200, minReadableW: 900, minReadableH: 1200 },
  A4: { id: "A4", name: "方形海报", width: 2000, height: 2000, minReadableW: 1500, minReadableH: 1200 },
  A5: { id: "A5", name: "产品特写", width: 1600, height: 900, minReadableW: 1400, minReadableH: 700 }
};
const specs = {
  S1: { id: "S1", targetW: 1920, targetH: 640, safeMarginPct: 0.05,
        allowScale: true, allowCrop: true, allowRecompose: false },
  S2: { id: "S2", targetW: 800, targetH: 800, safeMarginPct: 0.10,
        allowScale: true, allowCrop: true, allowRecompose: false },
  S3: { id: "S3", targetW: 1080, targetH: 1920, safeMarginPct: 0.08,
        allowScale: true, allowCrop: false, allowRecompose: true }
};

let failed = 0;
function check(name, cond) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name);
  if (!cond) failed++;
}

// 1. 比例一致 -> 直接缩放
check("A2xS2 等比缩放", deriveFit(assets.A2, specs.S2, null).strategy === "scale");
check("A4xS2 等比缩放", deriveFit(assets.A4, specs.S2, null).strategy === "scale");

// 2. 比例不同且裁切会伤安全边距 -> 缩放留边
const rA1S1 = deriveFit(assets.A1, specs.S1, null);
check("A1xS1 缩放留边", rA1S1.strategy === "scale" && rA1S1.geometry.mode === "fit");
check("A1xS1 无冲突", rA1S1.conflicts.length === 0);

// 3. 长图进竖屏（禁裁切）-> 缩放留边
const rA3S3 = deriveFit(assets.A3, specs.S3, null);
check("A3xS3 缩放留边", rA3S3.strategy === "scale" && rA3S3.conflicts.length === 0);

// 4. 安全边距与最小可读区无法同时满足 -> 标出并说明约束
const rA5S2 = deriveFit(assets.A5, specs.S2, null);
check("A5xS2 结论为无法满足", rA5S2.strategy === "none");
check("A5xS2 标出安全边距冲突", rA5S2.conflicts.some(c => c.indexOf("安全边距") >= 0));
check("A5xS2 标出最小可读区冲突", rA5S2.conflicts.some(c => c.indexOf("最小可读区域") >= 0));

// 5. 允许重新构图时，约束失败 -> 重新构图并带冲突说明
const rA5S3 = deriveFit(assets.A5, specs.S3, null);
check("A5xS3 需重新构图", rA5S3.strategy === "recompose" && rA5S3.conflicts.length > 0);

// 6. 手动覆盖：强制裁切后按裁切重新校验，可撤销回自动
const ov = deriveFit(assets.A1, specs.S1, "crop");
check("覆盖为裁切", ov.strategy === "crop" && ov.overridden === true);
check("覆盖后暴露安全边距冲突", ov.conflicts.some(c => c.indexOf("安全边距") >= 0));
const back = deriveFit(assets.A1, specs.S1, null);
check("撤销覆盖回到自动结果", back.strategy === rA1S1.strategy && back.conflicts.length === 0);

// 7. 隔离性：修改 S1 不影响同一素材在 S2 下的结论
const before = deriveFit(assets.A1, specs.S2, null);
const changedS1 = Object.assign({}, specs.S1, { targetW: 1200, targetH: 1200 });
deriveFit(assets.A1, changedS1, null);
const after = deriveFit(assets.A1, specs.S2, null);
check("修改 S1 后 A1xS2 结论不变",
  JSON.stringify(before) === JSON.stringify(after));

console.log(failed ? "\n" + failed + " 项失败" : "\n全部通过");
process.exit(failed ? 1 : 0);
