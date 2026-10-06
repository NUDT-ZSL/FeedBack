/**
 * 固定样例：一次覆盖菱形依赖、依赖成环、玉料不足、砂库存不足、
 * 砂不适用、引用缺失六类情形，供界面默认载入与批量入口复算。
 */
import type { WorkshopConfig } from "./types.js";

export function sampleConfig(): WorkshopConfig {
  return {
    materials: [
      { id: "m1", name: "和田白玉", hardness: 6.5, sizeCm: 30, remaining: 22, source: "昆仑山坑" },
      { id: "m2", name: "岫岩青玉", hardness: 5.0, sizeCm: 24, remaining: 8, source: "岫岩老坑" },
      { id: "m3", name: "独山墨玉", hardness: 6.0, sizeCm: 18, remaining: 12, source: "南阳独山" },
    ],
    sands: [
      { id: "s1", name: "粗解玉砂", grit: 80, ratio: 0.5, stock: 30, applicable: ["开料", "打磨", "素面", "掏膛", "定型"] },
      { id: "s2", name: "细解玉砂", grit: 240, ratio: 0.6, stock: 6, applicable: ["雕刻", "抛光", "镂雕", "上蜡", "描金"] },
      { id: "s3", name: "石榴砂", grit: 120, ratio: 0.4, stock: 20, applicable: ["雕刻"] },
    ],
    steps: [
      { id: "p01", name: "开料", materialId: "m1", sandId: "s1", sandBase: 4, prerequisites: [], duration: 6, intensity: 1.0 },
      { id: "p02", name: "打磨", materialId: "m1", sandId: "s1", sandBase: 3, prerequisites: ["p01"], duration: 5, intensity: 0.8 },
      { id: "p03", name: "雕刻", materialId: "m1", sandId: "s3", sandBase: 2, prerequisites: ["p01"], duration: 8, intensity: 1.2 },
      // 菱形汇合：抛光同时以打磨、雕刻为前置，两条依赖都保留
      { id: "p04", name: "抛光", materialId: "m1", sandId: "s2", sandBase: 2, prerequisites: ["p02", "p03"], duration: 4, intensity: 0.5 },
      { id: "p05", name: "镂雕", materialId: "m2", sandId: "s2", sandBase: 5, prerequisites: [], duration: 7, intensity: 1.4 },
      // 依赖成环：掏膛 ↔ 定型
      { id: "p06", name: "掏膛", materialId: "m3", sandId: "s1", sandBase: 2, prerequisites: ["p07"], duration: 5, intensity: 1.1 },
      { id: "p07", name: "定型", materialId: "m3", sandId: "s1", sandBase: 1.5, prerequisites: ["p06"], duration: 4, intensity: 0.7 },
      // 玉料余量不足（与镂雕争同一块青玉）
      { id: "p08", name: "素面", materialId: "m2", sandId: "s1", sandBase: 3, prerequisites: ["p05"], duration: 4, intensity: 1.3 },
      // 前置引用缺失
      { id: "p09", name: "描金", materialId: "m1", sandId: "s2", sandBase: 1, prerequisites: ["p99"], duration: 2, intensity: 0.3 },
      // 砂库存不足（与抛光、镂雕争同一批细砂）
      { id: "p10", name: "上蜡", materialId: "m1", sandId: "s2", sandBase: 3, prerequisites: ["p04"], duration: 3, intensity: 0.4 },
    ],
  };
}
