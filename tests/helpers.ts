// Shared helpers for the invariant suites. Everything here works purely
// through the TradeManager public API plus the shimmed RNG controller.

import { TradeManager, MINERALS } from '../src/managers/TradeManager';
import type { TradeRecord } from '../src/managers/TradeManager';
import { rng } from './phaser-shim.mjs';

export const STATION_IDS = ['station_0', 'station_1', 'station_2'] as const;
export const STATION_NAMES = ['阿尔法站', '贝塔站', '伽马站'] as const;

export function freshManager(seed: number): TradeManager {
  rng.reset(seed);
  const tm = new TradeManager();
  STATION_IDS.forEach((id, i) => tm.registerStation(id, STATION_NAMES[i]));
  return tm;
}

export function mineralIds(): string[] {
  return MINERALS.map(m => m.id);
}

export function basePriceOf(mineralId: string): number {
  const m = MINERALS.find(mm => mm.id === mineralId);
  if (!m) throw new Error(`unknown mineral ${mineralId}`);
  return m.basePrice;
}

/** Per-mineral total across player inventory and every station. */
export function globalSnapshot(tm: TradeManager): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const id of mineralIds()) totals[id] = 0;
  const player = tm.getPlayerInventory();
  for (const id of mineralIds()) totals[id] += player[id] ?? 0;
  for (const sid of STATION_IDS) {
    const inv = tm.getStationInventory(sid);
    if (!inv) throw new Error(`station ${sid} missing`);
    for (const id of mineralIds()) totals[id] += inv[id] ?? 0;
  }
  return totals;
}

export function diffSnapshot(before: Record<string, number>, after: Record<string, number>): string[] {
  const changed: string[] = [];
  for (const id of Object.keys(before)) {
    if (before[id] !== after[id]) changed.push(`${id}: ${before[id]} -> ${after[id]}`);
  }
  return changed;
}

/** True when every station price sits within [0.5x, 2x] of base price. */
export function priceViolations(tm: TradeManager): string[] {
  const out: string[] = [];
  for (const sid of STATION_IDS) {
    const prices = tm.getStationPrices(sid);
    if (!prices) {
      out.push(`站点 ${sid} 价格表缺失`);
      continue;
    }
    for (const m of MINERALS) {
      const p = prices[m.id];
      const lo = m.basePrice * 0.5;
      const hi = m.basePrice * 2;
      if (typeof p !== 'number' || p < lo || p > hi) {
        out.push(`${sid}/${m.id} 价格 ${p} 越界 [${lo}, ${hi}] (基础价 ${m.basePrice})`);
      }
    }
  }
  return out;
}

/** Validate one trade-history record for internal consistency. */
export function recordProblems(r: TradeRecord): string[] {
  const problems: string[] = [];
  if (r.type !== 'sell' && r.type !== 'buy') problems.push(`未知类型 ${r.type}`);
  if (!Number.isInteger(r.quantity) || r.quantity <= 0) problems.push(`数量非法 ${r.quantity}`);
  if (!(r.pricePerUnit > 0)) problems.push(`单价非法 ${r.pricePerUnit}`);
  if (r.totalValue !== r.quantity * r.pricePerUnit) {
    problems.push(`总价不自洽: ${r.quantity} x ${r.pricePerUnit} != ${r.totalValue}`);
  }
  if (!r.mineralName || !r.stationName) problems.push('缺少矿物名或站点名');
  return problems;
}

/**
 * Build a fresh manager whose stations have a known, uniform stock for
 * every mineral. Prices still come from the seeded PRNG (and remain in
 * range). This lets the buy suite control the station-side bound exactly.
 */
export function freshManagerWithStock(seed: number, stockEach: number): TradeManager {
  rng.reset(seed);
  const tm = new TradeManager();
  rng.stickyInt = stockEach; // every Between(10,100) during registration
  STATION_IDS.forEach((id, i) => tm.registerStation(id, STATION_NAMES[i]));
  rng.stickyInt = null;
  return tm;
}
