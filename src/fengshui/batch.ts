import { analyzeFengshui } from "./commentary.ts";
import type { FengshuiAnalysis } from "./commentary.ts";
import type { Position3D } from "./types.ts";

export interface FengshuiBatchCase {
  name: string;
  dragonAngle: number;
  position: Position3D;
  height: number;
}

export interface FengshuiBatchResult {
  case: FengshuiBatchCase;
  analysis: FengshuiAnalysis;
  stable: boolean;
}

export const DEFAULT_BATCH_CASES: FengshuiBatchCase[] = [
  { name: "正北0度", dragonAngle: 0, position: { x: 0, y: 0, z: 0 }, height: 50 },
  { name: "分界7.5度_壬子交界", dragonAngle: 7.5, position: { x: 1, y: 0, z: 1 }, height: 50 },
  { name: "分界下方7.499度", dragonAngle: 7.499, position: { x: 1, y: 0, z: 1 }, height: 50 },
  { name: "分界上方7.501度", dragonAngle: 7.501, position: { x: 1, y: 0, z: 1 }, height: 50 },
  { name: "二十四山各分界22.5", dragonAngle: 22.5, position: { x: 2, y: 0, z: 3 }, height: 50 },
  { name: "末界352.5度_亥壬交界", dragonAngle: 352.5, position: { x: 2, y: 0, z: 3 }, height: 50 },
  { name: "负角度-7.5等价352.5", dragonAngle: -7.5, position: { x: 2, y: 0, z: 3 }, height: 50 },
  { name: "超过一周367.5等价7.5", dragonAngle: 367.5, position: { x: 1, y: 0, z: 1 }, height: 50 },
  { name: "多周720等价0", dragonAngle: 720, position: { x: 0, y: 0, z: 0 }, height: 50 },
  { name: "大角度归一化", dragonAngle: 1000000.5, position: { x: 5, y: 0, z: -7 }, height: 50 },
  { name: "高度恰为100_仍属水局", dragonAngle: 0, position: { x: 4, y: 0, z: 9 }, height: 100 },
  { name: "高度100减极小量_水局", dragonAngle: 0, position: { x: 4, y: 0, z: 9 }, height: 99.9999999999 },
  { name: "高度100加极小量_龙脉", dragonAngle: 0, position: { x: 4, y: 0, z: 9 }, height: 100.0000000001 },
  { name: "高度为0_水局", dragonAngle: 90, position: { x: -3, y: 0, z: 6 }, height: 0 },
  { name: "负高度_水局", dragonAngle: 90, position: { x: -3, y: 0, z: 6 }, height: -50 },
  { name: "极高龙脉_1000000", dragonAngle: 270, position: { x: 10, y: 0, z: -10 }, height: 1000000 },
  { name: "极端正坐标", dragonAngle: 180, position: { x: 1e308, y: 0, z: 1e308 }, height: 1e308 },
  { name: "极端负坐标", dragonAngle: 180, position: { x: -1e308, y: 0, z: -1e308 }, height: 0 },
  { name: "微小坐标_近零", dragonAngle: 315, position: { x: 1e-300, y: 0, z: 1e-300 }, height: 50 },
  { name: "重复推演_第一次", dragonAngle: 45, position: { x: 7.5, y: 0, z: -2.25 }, height: 128 },
  { name: "重复推演_第二次", dragonAngle: 45, position: { x: 7.5, y: 0, z: -2.25 }, height: 128 },
  { name: "重复推演_第三次", dragonAngle: 45, position: { x: 7.5, y: 0, z: -2.25 }, height: 128 },
];

export function runBatchFengshui(
  cases: FengshuiBatchCase[] = DEFAULT_BATCH_CASES
): FengshuiBatchResult[] {
  return cases.map((item) => {
    const first = analyzeFengshui(item.position, item.height, item.dragonAngle);
    const second = analyzeFengshui(item.position, item.height, item.dragonAngle);
    return {
      case: item,
      analysis: first,
      stable:
        JSON.stringify(first) === JSON.stringify(second) &&
        first.commentary === second.commentary,
    };
  });
}
