import { TradeManager, MINERALS, type StationInventory, type StationPrices } from '../src/managers/TradeManager.ts';
import { checkInvariant } from './framework.ts';

export const INV_PRICE_RANGE = '价格区间';
export const INV_CARGO_CAPACITY = '货舱容量';
export const INV_CONSERVATION = '库存守恒';
export const INV_HISTORY = '交易历史';
export const INV_RESET = '重置状态';
export const INV_NON_NEGATIVE = '状态非负';

export const HISTORY_LIMIT = 10;
export const STATION_STOCK_MIN = 10;
export const STATION_STOCK_MAX = 100;

export function priceBounds(basePrice: number): { min: number; max: number } {
  return { min: Math.round(basePrice * 0.5), max: Math.round(basePrice * 2) };
}

export function assertPricesWithinBounds(tm: TradeManager, stationIds: string[], context: string): void {
  for (const stationId of stationIds) {
    const prices = tm.getStationPrices(stationId);
    checkInvariant(INV_PRICE_RANGE, prices !== null, `${context}：站点 ${stationId} 不存在`);
    for (const m of MINERALS) {
      const price = prices![m.id];
      const { min, max } = priceBounds(m.basePrice);
      checkInvariant(
        INV_PRICE_RANGE,
        Number.isInteger(price) && price >= min && price <= max,
        `${context}：站点 ${stationId} 的 ${m.name}(${m.id}) 价格为 ${price}，` +
        `超出基础价 ${m.basePrice} 的 0.5~2 倍区间 [${min}, ${max}]`
      );
    }
  }
}

export function assertCargoInvariant(tm: TradeManager, context: string): void {
  const inventory = tm.getPlayerInventory();
  let sum = 0;
  for (const m of MINERALS) {
    const amount = inventory[m.id] ?? 0;
    checkInvariant(
      INV_NON_NEGATIVE,
      amount >= 0,
      `${context}：玩家 ${m.name}(${m.id}) 库存为负数 ${amount}`
    );
    sum += amount;
  }
  checkInvariant(
    INV_CARGO_CAPACITY,
    sum === tm.getTotalCargo(),
    `${context}：getTotalCargo()=${tm.getTotalCargo()} 与逐项库存之和 ${sum} 不一致`
  );
  checkInvariant(
    INV_CARGO_CAPACITY,
    sum <= tm.getCargoCapacity(),
    `${context}：玩家库存总量 ${sum} 超过货舱容量 ${tm.getCargoCapacity()}`
  );
}

export function assertStationStockInvariant(tm: TradeManager, stationIds: string[], context: string): void {
  for (const stationId of stationIds) {
    const stock = tm.getStationInventory(stationId);
    checkInvariant(INV_NON_NEGATIVE, stock !== null, `${context}：站点 ${stationId} 不存在`);
    for (const m of MINERALS) {
      checkInvariant(
        INV_NON_NEGATIVE,
        stock![m.id] >= 0,
        `${context}：站点 ${stationId} 的 ${m.name}(${m.id}) 库存为负数 ${stock![m.id]}`
      );
    }
  }
}

export function assertHistoryInvariant(tm: TradeManager, context: string): void {
  const history = tm.getTradeHistory();
  checkInvariant(
    INV_HISTORY,
    history.length <= HISTORY_LIMIT,
    `${context}：交易历史长度 ${history.length} 超过上限 ${HISTORY_LIMIT}`
  );
  for (let i = 0; i < history.length; i++) {
    const rec = history[i];
    checkInvariant(
      INV_HISTORY,
      rec.quantity > 0 && rec.pricePerUnit > 0,
      `${context}：第 ${i + 1} 条记录数量或单价非法（数量=${rec.quantity}，单价=${rec.pricePerUnit}）`
    );
    checkInvariant(
      INV_HISTORY,
      rec.quantity * rec.pricePerUnit === rec.totalValue,
      `${context}：第 ${i + 1} 条记录（${rec.type} ${rec.mineralName}）不自洽：` +
      `数量 ${rec.quantity} × 单价 ${rec.pricePerUnit} = ${rec.quantity * rec.pricePerUnit}，但总价记为 ${rec.totalValue}`
    );
    if (i > 0) {
      checkInvariant(
        INV_HISTORY,
        history[i - 1].timestamp >= rec.timestamp,
        `${context}：第 ${i} 条记录时间戳 ${history[i - 1].timestamp} 早于第 ${i + 1} 条 ${rec.timestamp}，未按最近优先排列`
      );
    }
  }
}

export function assertAllInvariants(tm: TradeManager, stationIds: string[], context: string): void {
  assertCargoInvariant(tm, context);
  assertStationStockInvariant(tm, stationIds, context);
  assertPricesWithinBounds(tm, stationIds, context);
  assertHistoryInvariant(tm, context);
  checkInvariant(
    INV_NON_NEGATIVE,
    tm.getTotalMined() >= 0 && tm.getTotalValue() >= 0 && tm.getTradeCount() >= 0,
    `${context}：累计开采量/累计价值/交易计数出现负值（${tm.getTotalMined()}/${tm.getTotalValue()}/${tm.getTradeCount()}）`
  );
}

export interface StateSnapshot {
  player: { [mineralId: string]: number };
  stations: { [stationId: string]: StationInventory };
  prices: { [stationId: string]: StationPrices };
  totalCargo: number;
  totalValue: number;
  totalMined: number;
  tradeCount: number;
  historyLength: number;
}

export function takeSnapshot(tm: TradeManager, stationIds: string[]): StateSnapshot {
  const stations: { [stationId: string]: StationInventory } = {};
  const prices: { [stationId: string]: StationPrices } = {};
  for (const id of stationIds) {
    stations[id] = tm.getStationInventory(id)!;
    prices[id] = tm.getStationPrices(id)!;
  }
  return {
    player: tm.getPlayerInventory(),
    stations,
    prices,
    totalCargo: tm.getTotalCargo(),
    totalValue: tm.getTotalValue(),
    totalMined: tm.getTotalMined(),
    tradeCount: tm.getTradeCount(),
    historyLength: tm.getTradeHistory().length
  };
}

export function assertStateUnchanged(tm: TradeManager, before: StateSnapshot, context: string): void {
  const after = takeSnapshot(tm, Object.keys(before.stations));
  for (const m of MINERALS) {
    checkInvariant(
      INV_CONSERVATION,
      after.player[m.id] === before.player[m.id],
      `${context}：玩家 ${m.name}(${m.id}) 库存被改变 ${before.player[m.id]} -> ${after.player[m.id]}`
    );
    for (const stationId of Object.keys(before.stations)) {
      checkInvariant(
        INV_CONSERVATION,
        after.stations[stationId][m.id] === before.stations[stationId][m.id],
        `${context}：站点 ${stationId} 的 ${m.name}(${m.id}) 库存被改变 ` +
        `${before.stations[stationId][m.id]} -> ${after.stations[stationId][m.id]}`
      );
    }
  }
  checkInvariant(
    INV_CONSERVATION,
    after.totalMined === before.totalMined,
    `${context}：累计开采量被改变 ${before.totalMined} -> ${after.totalMined}`
  );
  checkInvariant(
    INV_CONSERVATION,
    after.totalValue === before.totalValue,
    `${context}：累计价值被改变 ${before.totalValue} -> ${after.totalValue}`
  );
  checkInvariant(
    INV_CONSERVATION,
    after.tradeCount === before.tradeCount,
    `${context}：交易计数被改变 ${before.tradeCount} -> ${after.tradeCount}`
  );
  checkInvariant(
    INV_HISTORY,
    after.historyLength === before.historyLength,
    `${context}：交易历史长度被改变 ${before.historyLength} -> ${after.historyLength}`
  );
}
