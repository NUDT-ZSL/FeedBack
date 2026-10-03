import { TradeManager, MINERALS } from '../src/managers/TradeManager.ts';
import { createSeededRandom, type RandomSource } from '../src/managers/random.ts';
import { scenario, checkInvariant, InvariantViolation } from './framework.ts';
import {
  INV_CARGO_CAPACITY,
  INV_CONSERVATION,
  INV_RESET,
  assertAllInvariants,
  takeSnapshot,
  type StateSnapshot
} from './invariants.ts';

const STATION_IDS = ['fz-alpha', 'fz-beta', 'fz-gamma'];

function pick<T>(rng: RandomSource, items: T[]): T {
  return items[Math.floor(rng.next() * items.length)];
}

function randomAmount(rng: RandomSource, max: number): number {
  return Math.floor(rng.next() * (max + 1));
}

function runFuzzSeed(seed: number, steps: number): void {
  const tm = new TradeManager(createSeededRandom(seed * 7919 + 1));
  const rng = createSeededRandom(seed * 104729 + 3);
  STATION_IDS.forEach((id, i) => tm.registerStation(id, `模糊站${i + 1}`));

  for (let step = 0; step < steps; step++) {
    const where = `seed=${seed} 第 ${step + 1} 步`;
    const before: StateSnapshot = takeSnapshot(tm, STATION_IDS);
    const roll = rng.next();
    let op: string;

    try {
      if (roll < 0.25) {
        const m = pick(rng, MINERALS);
        const amount = randomAmount(rng, 59) + 1;
        op = `addMineral(${m.id}, ${amount})`;
        const result = tm.addMineral(m.id, amount);
        const space = Math.max(0, tm.getCargoCapacity() - before.totalCargo);
        const expectedAdded = Math.min(amount, space);
        const after = takeSnapshot(tm, STATION_IDS);
        checkInvariant(
          INV_CARGO_CAPACITY,
          after.totalCargo - before.totalCargo === expectedAdded,
          `${where} ${op}：入舱量应为 ${expectedAdded}，实际增加 ${after.totalCargo - before.totalCargo}`
        );
        checkInvariant(
          INV_CARGO_CAPACITY,
          after.totalMined - before.totalMined === expectedAdded,
          `${where} ${op}：累计开采量应增加 ${expectedAdded}，实际增加 ${after.totalMined - before.totalMined}`
        );
        checkInvariant(
          INV_CARGO_CAPACITY,
          result === (expectedAdded === amount),
          `${where} ${op}：返回值应为 ${expectedAdded === amount}，实际 ${result}`
        );
      } else if (roll < 0.5) {
        const stationId = pick(rng, STATION_IDS);
        op = `sellAll(${stationId})`;
        const earned = tm.sellAll(stationId);
        const after = takeSnapshot(tm, STATION_IDS);
        let expectedEarned = 0;
        let soldKinds = 0;
        for (const m of MINERALS) {
          const sold = before.player[m.id];
          expectedEarned += sold * before.prices[stationId][m.id];
          if (sold > 0) soldKinds++;
          checkInvariant(
            INV_CONSERVATION,
            before.player[m.id] + before.stations[stationId][m.id] ===
              after.player[m.id] + after.stations[stationId][m.id],
            `${where} ${op}：${m.name}(${m.id}) 不守恒（前 ${before.player[m.id]}+${before.stations[stationId][m.id]}，` +
            `后 ${after.player[m.id]}+${after.stations[stationId][m.id]}）`
          );
          checkInvariant(
            INV_CONSERVATION,
            after.player[m.id] === 0,
            `${where} ${op}：sellAll 后玩家 ${m.name}(${m.id}) 应清零，实际 ${after.player[m.id]}`
          );
        }
        checkInvariant(
          INV_CONSERVATION,
          earned === expectedEarned,
          `${where} ${op}：收益应为 ${expectedEarned}，实际 ${earned}`
        );
        checkInvariant(
          INV_CONSERVATION,
          after.totalValue === before.totalValue + expectedEarned,
          `${where} ${op}：累计价值应为 ${before.totalValue + expectedEarned}，实际 ${after.totalValue}`
        );
        checkInvariant(
          INV_CONSERVATION,
          after.tradeCount === before.tradeCount + soldKinds,
          `${where} ${op}：交易计数应增加 ${soldKinds}，实际增加 ${after.tradeCount - before.tradeCount}`
        );
      } else if (roll < 0.7) {
        const stationId = pick(rng, STATION_IDS);
        const m = pick(rng, MINERALS);
        const amount = randomAmount(rng, 80);
        op = `buyMineral(${stationId}, ${m.id}, ${amount})`;
        const cost = tm.buyMineral(stationId, m.id, amount);
        const after = takeSnapshot(tm, STATION_IDS);
        const stationHad = before.stations[stationId][m.id];
        const space = Math.max(0, tm.getCargoCapacity() - before.totalCargo);
        const price = before.prices[stationId][m.id];
        const expectedQty = stationHad < amount ? 0 : Math.min(amount, space);
        checkInvariant(
          INV_CONSERVATION,
          cost === expectedQty * price,
          `${where} ${op}：成本应为 ${expectedQty} × ${price} = ${expectedQty * price}，实际 ${cost}`
        );
        checkInvariant(
          INV_CONSERVATION,
          before.stations[stationId][m.id] - after.stations[stationId][m.id] === expectedQty,
          `${where} ${op}：站点 ${m.name} 应减少 ${expectedQty}，实际减少 ${before.stations[stationId][m.id] - after.stations[stationId][m.id]}`
        );
        checkInvariant(
          INV_CONSERVATION,
          after.player[m.id] - before.player[m.id] === expectedQty,
          `${where} ${op}：玩家 ${m.name} 应增加 ${expectedQty}，实际增加 ${after.player[m.id] - before.player[m.id]}`
        );
        checkInvariant(
          INV_CONSERVATION,
          after.tradeCount === before.tradeCount + (expectedQty > 0 ? 1 : 0),
          `${where} ${op}：交易计数变化与成交不符`
        );
      } else if (roll < 0.8) {
        op = 'fluctuatePrices()';
        tm.fluctuatePrices();
      } else if (roll < 0.88) {
        const m = pick(rng, MINERALS);
        const amount = randomAmount(rng, 30);
        op = `removeMineral(${m.id}, ${amount})`;
        const result = tm.removeMineral(m.id, amount);
        const after = takeSnapshot(tm, STATION_IDS);
        const had = before.player[m.id];
        const expectedRemoved = had >= amount ? amount : 0;
        checkInvariant(
          INV_CONSERVATION,
          before.player[m.id] - after.player[m.id] === expectedRemoved,
          `${where} ${op}：应移除 ${expectedRemoved}，实际移除 ${before.player[m.id] - after.player[m.id]}`
        );
        checkInvariant(
          INV_CONSERVATION,
          result === (had >= amount),
          `${where} ${op}：返回值应为 ${had >= amount}，实际 ${result}`
        );
      } else if (roll < 0.94) {
        const m = pick(rng, MINERALS);
        const ratio = Math.floor(rng.next() * 10) / 10;
        op = `losePartialMineral(${m.id}, ${ratio})`;
        const lost = tm.losePartialMineral(m.id, ratio);
        const after = takeSnapshot(tm, STATION_IDS);
        const expectedLost = Math.floor(before.player[m.id] * ratio);
        checkInvariant(
          INV_CONSERVATION,
          lost === expectedLost && before.player[m.id] - after.player[m.id] === expectedLost,
          `${where} ${op}：应损失 ${expectedLost}，报告损失 ${lost}，实际减少 ${before.player[m.id] - after.player[m.id]}`
        );
      } else if (roll < 0.97) {
        op = 'reset()';
        tm.reset();
        checkInvariant(INV_RESET, tm.getTotalCargo() === 0, `${where} ${op}：货舱应为空`);
        checkInvariant(INV_RESET, tm.getTotalValue() === 0, `${where} ${op}：累计价值应为 0`);
        checkInvariant(INV_RESET, tm.getTotalMined() === 0, `${where} ${op}：累计开采量应为 0`);
        checkInvariant(INV_RESET, tm.getTradeCount() === 0, `${where} ${op}：交易计数应为 0`);
        checkInvariant(INV_RESET, tm.getTradeHistory().length === 0, `${where} ${op}：交易历史应为空`);
      } else {
        op = 'noop(仅校验不变量)';
      }
    } catch (err) {
      if (err instanceof InvariantViolation) throw err;
      throw new InvariantViolation('执行异常', `${where} ${op}：抛出异常 ${err instanceof Error ? err.message : String(err)}`);
    }

    assertAllInvariants(tm, STATION_IDS, `${where} ${op} 之后`);
  }
}

scenario('模糊验证：多种子随机操作序列下全部不变量逐步成立', () => {
  for (let seed = 1; seed <= 20; seed++) {
    runFuzzSeed(seed, 300);
  }
});
