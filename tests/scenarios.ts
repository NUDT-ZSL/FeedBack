import { TradeManager, MINERALS } from '../src/managers/TradeManager.ts';
import { createSeededRandom } from '../src/managers/random.ts';
import { scenario, checkInvariant } from './framework.ts';
import {
  INV_PRICE_RANGE,
  INV_CARGO_CAPACITY,
  INV_CONSERVATION,
  INV_HISTORY,
  INV_RESET,
  HISTORY_LIMIT,
  STATION_STOCK_MIN,
  STATION_STOCK_MAX,
  assertPricesWithinBounds,
  assertCargoInvariant,
  assertHistoryInvariant,
  assertStateUnchanged,
  takeSnapshot
} from './invariants.ts';

scenario('价格波动：反复波动后各站价格始终落在基础价 0.5~2 倍区间', () => {
  const tm = new TradeManager(createSeededRandom(42));
  tm.registerStation('st-alpha', '阿尔法站');
  tm.registerStation('st-beta', '贝塔站');
  const stationIds = ['st-alpha', 'st-beta'];

  assertPricesWithinBounds(tm, stationIds, '站点注册后初始价格');
  for (let i = 1; i <= 500; i++) {
    tm.fluctuatePrices();
    assertPricesWithinBounds(tm, stationIds, `第 ${i} 次价格波动后`);
  }
});

scenario('货舱容量：总量不超上限，满载后继续采矿不改变库存与累计开采量', () => {
  const tm = new TradeManager(createSeededRandom(7));
  const capacity = tm.getCargoCapacity();

  checkInvariant(INV_CARGO_CAPACITY, tm.addMineral('iron', 150) === true, '150 单位铁矿应全部入舱');
  checkInvariant(
    INV_CARGO_CAPACITY,
    tm.addMineral('copper', 100) === false,
    '剩余空间不足时 addMineral 应返回 false 表示未全部入舱'
  );
  checkInvariant(
    INV_CARGO_CAPACITY,
    tm.getPlayerInventory()['copper'] === capacity - 150,
    `铜矿应只入舱 ${capacity - 150} 单位，实际 ${tm.getPlayerInventory()['copper']}`
  );
  assertCargoInvariant(tm, '部分入舱后');

  const before = takeSnapshot(tm, []);
  const result = tm.addMineral('gold', 10);
  checkInvariant(INV_CARGO_CAPACITY, result === false, '货舱已满时 addMineral 应返回 false');
  checkInvariant(
    INV_CARGO_CAPACITY,
    tm.getTotalMined() === before.totalMined,
    `货舱已满时累计开采量不得增加（${before.totalMined} -> ${tm.getTotalMined()}）`
  );
  assertStateUnchanged(tm, before, '货舱已满时继续采矿');
});

scenario('卖出守恒：卖出前后站点库存与玩家库存之和不变，收益与记录自洽', () => {
  const tm = new TradeManager(createSeededRandom(11));
  tm.registerStation('st-alpha', '阿尔法站');

  tm.addMineral('iron', 40);
  tm.addMineral('gold', 15);
  const beforePlayer = tm.getPlayerInventory();
  const beforeStation = tm.getStationInventory('st-alpha')!;
  const prices = tm.getStationPrices('st-alpha')!;
  const beforeValue = tm.getTotalValue();

  const earned = tm.sellAll('st-alpha');

  let expectedEarned = 0;
  const afterPlayer = tm.getPlayerInventory();
  const afterStation = tm.getStationInventory('st-alpha')!;
  for (const m of MINERALS) {
    expectedEarned += beforePlayer[m.id] * prices[m.id];
    checkInvariant(
      INV_CONSERVATION,
      beforePlayer[m.id] + beforeStation[m.id] === afterPlayer[m.id] + afterStation[m.id],
      `卖出后 ${m.name}(${m.id}) 不守恒：交易前 玩家${beforePlayer[m.id]}+站点${beforeStation[m.id]}，` +
      `交易后 玩家${afterPlayer[m.id]}+站点${afterStation[m.id]}`
    );
    checkInvariant(
      INV_CONSERVATION,
      afterPlayer[m.id] === 0,
      `sellAll 后玩家 ${m.name}(${m.id}) 库存应清零，实际 ${afterPlayer[m.id]}`
    );
  }
  checkInvariant(INV_CONSERVATION, earned === expectedEarned, `卖出收益 ${earned} 与按价格计算 ${expectedEarned} 不符`);
  checkInvariant(
    INV_CONSERVATION,
    tm.getTotalValue() === beforeValue + expectedEarned,
    `累计价值应为 ${beforeValue + expectedEarned}，实际 ${tm.getTotalValue()}`
  );
  checkInvariant(INV_HISTORY, tm.getTradeCount() === 2, `两种矿物卖出应记 2 笔交易，实际 ${tm.getTradeCount()}`);
  assertHistoryInvariant(tm, '卖出后');
  assertCargoInvariant(tm, '卖出后');
});

scenario('买入限制：受货舱空间与站点库存双重约束，超出部分不吞掉也不凭空生成', () => {
  const tm = new TradeManager(createSeededRandom(13));
  tm.registerStation('st-alpha', '阿尔法站');

  const stock = tm.getStationInventory('st-alpha')!;
  const beforeReject = takeSnapshot(tm, ['st-alpha']);
  const costRejected = tm.buyMineral('st-alpha', 'iron', stock['iron'] + 50);
  checkInvariant(INV_CONSERVATION, costRejected === 0, `站点库存不足时买入应整笔拒绝并返回 0，实际返回 ${costRejected}`);
  assertStateUnchanged(tm, beforeReject, '站点库存不足时的买入请求');

  tm.addMineral('gold', 100);
  tm.sellAll('st-alpha');
  tm.addMineral('copper', 160);
  const space = tm.getCargoCapacity() - tm.getTotalCargo();
  const goldPrice = tm.getStationPrices('st-alpha')!['gold'];
  const beforeBuy = takeSnapshot(tm, ['st-alpha']);

  const cost = tm.buyMineral('st-alpha', 'gold', 70);
  checkInvariant(
    INV_CONSERVATION,
    cost === space * goldPrice,
    `买入成本应为 ${space} × ${goldPrice} = ${space * goldPrice}，实际返回 ${cost}`
  );
  const afterBuy = takeSnapshot(tm, ['st-alpha']);
  checkInvariant(
    INV_CONSERVATION,
    beforeBuy.stations['st-alpha']['gold'] - afterBuy.stations['st-alpha']['gold'] === space,
    `站点金矿减少量应等于实际成交量 ${space}`
  );
  checkInvariant(
    INV_CONSERVATION,
    afterBuy.player['gold'] - beforeBuy.player['gold'] === space,
    `玩家金矿增加量应等于实际成交量 ${space}`
  );
  for (const m of MINERALS) {
    checkInvariant(
      INV_CONSERVATION,
      beforeBuy.player[m.id] + beforeBuy.stations['st-alpha'][m.id] ===
        afterBuy.player[m.id] + afterBuy.stations['st-alpha'][m.id],
      `买入后 ${m.name}(${m.id}) 在玩家与站点之间不守恒`
    );
  }
  assertCargoInvariant(tm, '按剩余空间买入后');

  const beforeFull = takeSnapshot(tm, ['st-alpha']);
  const costFull = tm.buyMineral('st-alpha', 'silver', 5);
  checkInvariant(INV_CARGO_CAPACITY, costFull === 0, `货舱已满时买入应返回 0，实际返回 ${costFull}`);
  assertStateUnchanged(tm, beforeFull, '货舱已满时的买入请求');

  const beforeUnknown = takeSnapshot(tm, ['st-alpha']);
  checkInvariant(INV_CONSERVATION, tm.buyMineral('st-ghost', 'iron', 5) === 0, '不存在的站点买入应返回 0');
  assertStateUnchanged(tm, beforeUnknown, '对不存在站点的买入请求');
});

scenario('交易历史：超过上限后按最近优先保留，每条记录数量×单价=总价', () => {
  const tm = new TradeManager(createSeededRandom(5));
  tm.registerStation('st-alpha', '阿尔法站');

  const totalTrades = 25;
  for (let i = 0; i < totalTrades; i++) {
    const m = MINERALS[i % MINERALS.length];
    tm.addMineral(m.id, 3);
    tm.sellAll('st-alpha');
    checkInvariant(
      INV_HISTORY,
      tm.getTradeHistory().length === Math.min(i + 1, HISTORY_LIMIT),
      `第 ${i + 1} 笔交易后历史长度应为 ${Math.min(i + 1, HISTORY_LIMIT)}，实际 ${tm.getTradeHistory().length}`
    );
  }

  const history = tm.getTradeHistory();
  checkInvariant(
    INV_HISTORY,
    history.length === HISTORY_LIMIT,
    `完成 ${totalTrades} 笔交易后历史应只保留 ${HISTORY_LIMIT} 条，实际 ${history.length} 条`
  );
  checkInvariant(
    INV_HISTORY,
    tm.getTradeCount() === totalTrades,
    `交易计数应累计到 ${totalTrades}，实际 ${tm.getTradeCount()}`
  );
  for (let k = 0; k < history.length; k++) {
    const tradeIndex = totalTrades - 1 - k;
    const expected = MINERALS[tradeIndex % MINERALS.length];
    const rec = history[k];
    checkInvariant(
      INV_HISTORY,
      rec.mineralId === expected.id && rec.type === 'sell' && rec.stationName === '阿尔法站',
      `历史第 ${k + 1} 条应为第 ${tradeIndex + 1} 笔卖出 ${expected.name}(${expected.id})，` +
      `实际为 ${rec.type} ${rec.mineralName}(${rec.mineralId}) @ ${rec.stationName}`
    );
    checkInvariant(
      INV_HISTORY,
      rec.quantity === 3 && rec.quantity * rec.pricePerUnit === rec.totalValue,
      `历史第 ${k + 1} 条记录不自洽：数量 ${rec.quantity} × 单价 ${rec.pricePerUnit} ≠ 总价 ${rec.totalValue}`
    );
  }
  assertHistoryInvariant(tm, '溢出裁剪后');
});

scenario('重置：玩家状态归零，站点库存与价格重新生成且满足约束', () => {
  const tm = new TradeManager(createSeededRandom(9));
  tm.registerStation('st-alpha', '阿尔法站');
  tm.registerStation('st-beta', '贝塔站');
  const stationIds = ['st-alpha', 'st-beta'];

  tm.addMineral('iron', 50);
  tm.sellAll('st-alpha');
  tm.buyMineral('st-beta', 'copper', 5);
  tm.fluctuatePrices();
  const beforeReset = takeSnapshot(tm, stationIds);

  tm.reset();

  for (const m of MINERALS) {
    checkInvariant(INV_RESET, tm.getPlayerInventory()[m.id] === 0, `重置后玩家 ${m.name}(${m.id}) 库存应为 0`);
  }
  checkInvariant(INV_RESET, tm.getTotalValue() === 0, `重置后累计价值应为 0，实际 ${tm.getTotalValue()}`);
  checkInvariant(INV_RESET, tm.getTotalMined() === 0, `重置后累计开采量应为 0，实际 ${tm.getTotalMined()}`);
  checkInvariant(INV_RESET, tm.getTradeCount() === 0, `重置后交易计数应为 0，实际 ${tm.getTradeCount()}`);
  checkInvariant(INV_RESET, tm.getTradeHistory().length === 0, '重置后交易历史应为空');

  let regenerated = false;
  for (const stationId of stationIds) {
    const stock = tm.getStationInventory(stationId)!;
    for (const m of MINERALS) {
      checkInvariant(
        INV_RESET,
        Number.isInteger(stock[m.id]) && stock[m.id] >= STATION_STOCK_MIN && stock[m.id] <= STATION_STOCK_MAX,
        `重置后站点 ${stationId} 的 ${m.name}(${m.id}) 库存 ${stock[m.id]} 不在 [${STATION_STOCK_MIN}, ${STATION_STOCK_MAX}]`
      );
      if (stock[m.id] !== beforeReset.stations[stationId][m.id]) regenerated = true;
    }
  }
  checkInvariant(INV_RESET, regenerated, '重置后站点库存应重新生成，但与重置前完全一致');
  assertPricesWithinBounds(tm, stationIds, '重置后站点价格');

  checkInvariant(INV_RESET, tm.addMineral('gold', 10) === true, '重置后应能继续采矿');
  const price = tm.getStationPrices('st-alpha')!['gold'];
  const earned = tm.sellAll('st-alpha');
  checkInvariant(INV_RESET, earned === 10 * price, `重置后卖出收益应为 ${10 * price}，实际 ${earned}`);
});
