import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAsset, compromiseCrop, STATUS } from "./src/engine.js";
import { initialAssets, initialChannels } from "./src/data.js";

const asset = id => structuredClone(initialAssets.find(item => item.id === id));
const channel = id => structuredClone(initialChannels.find(item => item.id === id));

function assertInside(inner, outer, message) {
  assert.ok(inner.x >= outer.x - 0.01, `${message}：左侧越界`);
  assert.ok(inner.y >= outer.y - 0.01, `${message}：顶部越界`);
  assert.ok(inner.x + inner.w <= outer.x + outer.w + 0.01, `${message}：右侧越界`);
  assert.ok(inner.y + inner.h <= outer.y + outer.h + 0.01, `${message}：底部越界`);
}

test("比例不同且关键区域可落在安全区时给出需裁切方案", () => {
  const result = analyzeAsset(asset("hero-visual"), channel("website-hero"));
  assert.equal(result.status, STATUS.NEEDS_CROP);
  assert.ok(result.reasons.some(reason => reason.includes("比例")));
  assertInside(result.crop.crop, result.asset.allowedCrop, "裁切框位于可裁切区域");
  assertInside(result.crop.safeRect, result.crop.crop, "安全区位于裁切框内");
  for (const key of result.asset.keyAreas) assertInside(key, result.crop.safeRect, "关键区域位于安全区");
});

test("原图安全边距不满足但可通过裁切修正时标记为需裁切", () => {
  const result = analyzeAsset(asset("vertical-story"), channel("story-vertical"));
  assert.equal(result.status, STATUS.NEEDS_CROP);
  const marginCheck = result.checks.find(check => check.code === "MARGIN");
  assert.equal(marginCheck.pass, false);
  for (const key of result.asset.keyAreas) assertInside(key, result.crop.safeRect, "裁切后关键区域安全");
});

test("分辨率、比例和格式同时不满足时标记不可适配并列出差异", () => {
  const result = analyzeAsset(asset("small-banner"), channel("email-banner"));
  assert.equal(result.status, STATUS.IMPOSSIBLE);
  for (const label of ["尺寸", "比例", "安全边距", "格式"]) {
    assert.ok(result.reasons.join("；").includes(label), `应指出 ${label}`);
  }
  assert.equal(result.crop, null);
});

test("仅格式不符且几何条件可直接满足时标记可适配并建议转换格式", () => {
  const result = analyzeAsset(asset("app-icon-render"), channel("store-icon"));
  assert.equal(result.status, STATUS.ADAPTABLE);
  assert.equal(result.formatConversionRequired, true);
  assert.equal(result.suggestedExportFormat, "PNG");
  assert.ok(result.crop.feasible);
});

test("缩小可裁切区域后原方案立即变为不可适配", () => {
  const before = analyzeAsset(asset("product-square"), channel("social-square"));
  assert.equal(before.status, STATUS.ADAPTABLE);

  const restricted = asset("product-square");
  restricted.allowedCrop = { x: 900, y: 900, w: 300, h: 300 };
  const after = analyzeAsset(restricted, channel("social-square"));
  assert.equal(after.status, STATUS.IMPOSSIBLE);
  assert.ok(after.reasons.some(reason => reason.includes("尺寸不足")));
});

test("渠道目标尺寸变大后所有相关结论按新规格重算", () => {
  const oversized = channel("social-square");
  oversized.targetWidth = 4000;
  oversized.targetHeight = 4000;
  const result = analyzeAsset(asset("product-square"), oversized);
  assert.equal(result.status, STATUS.IMPOSSIBLE);
  const sizeCheck = result.checks.find(check => check.code === "SIZE");
  assert.equal(sizeCheck.pass, false);
});

test("多渠道折中方案保留共同主裁切并列出无法满足的渠道", () => {
  const feasibleSmallBanner = asset("small-banner");
  feasibleSmallBanner.keyAreas = [{ x: 100, y: 80, w: 760, h: 250, label: "文案和产品" }];
  const result = compromiseCrop(feasibleSmallBanner, [
    {
      id: "mobile-banner",
      name: "移动内容横幅",
      targetWidth: 800,
      targetHeight: 400,
      safeMargin: { top: 5, right: 2, bottom: 5, left: 2 },
      acceptedFormats: ["JPG", "PNG"]
    },
    channel("email-banner")
  ]);
  assert.ok(result.master);
  assertInside(result.master, result.asset.allowedCrop, "主裁切位于可裁切区域");
  assert.equal(result.unsatisfied.length, 1);
  assert.equal(result.unsatisfied[0].channelId, "email-banner");
  assert.ok(result.risk.message.includes("仍无法满足"));
});
