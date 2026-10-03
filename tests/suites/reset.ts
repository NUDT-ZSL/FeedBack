// INV-RESET-01: 重置后玩家库存、累计价值、累计开采量、交易计数均回到初始状态。
// INV-RESET-02: 重置后站点库存与价格重新生成，且价格仍满足 [0.5,2] 区间。
import { suite } from '../harness';
import { freshManagerWithStock, priceViolations, mineralIds, STATION_IDS } from '../helpers';

suite('重置', (inv) => {
  for (const seed of [51, 52, 53]) {
    const tm = freshManagerWithStock(seed, 40);

    // 制造大量状态：采矿、买入、卖出、价格波动
    tm.addMineral('iron', 60);
    tm.buyMineral(STATION_IDS[0], 'gold', 5);
    tm.sellAll(STATION_IDS[1]);
    tm.addMineral('platinum', 20);
    tm.fluctuatePrices();
    tm.fluctuatePrices();
    tm.reset();

    // 玩家状态归零
    {
      const c = inv('INV-RESET-01', '玩家状态全部回到初始值', `种子${seed} 玩家库存归零`);
      const invMap = tm.getPlayerInventory();
      const leftover = mineralIds().filter(id => (invMap[id] ?? 0) !== 0);
      c.expect(leftover.length === 0, `重置后仍有库存: ${leftover.map(id => `${id}=${invMap[id]}`).join(',')}`);
      c.eq(tm.getTotalCargo(), 0, '总货舱应为 0');
    }
    {
      const c = inv('INV-RESET-01', '玩家状态全部回到初始值', `种子${seed} 累计价值归零`);
      c.eq(tm.getTotalValue(), 0, '累计交易价值应为 0');
      c.eq(tm.getInventoryValue(), 0, '持有库存价值应为 0');
    }
    {
      const c = inv('INV-RESET-01', '玩家状态全部回到初始值', `种子${seed} 累计开采量归零`);
      c.eq(tm.getTotalMined(), 0, '累计开采量应为 0');
    }
    {
      const c = inv('INV-RESET-01', '玩家状态全部回到初始值', `种子${seed} 交易计数与历史归零`);
      c.eq(tm.getTradeCount(), 0, '交易计数应为 0');
      c.eq(tm.getTradeHistory().length, 0, '交易历史应为空');
    }

    // 站点重新生成：库存落在生成区间 [10,100]，价格满足约束
    {
      const c1 = inv('INV-RESET-02', '站点库存与价格重新生成且价格满足区间', `种子${seed} 站点库存重新生成`);
      for (const sid of STATION_IDS) {
        const stationInv = tm.getStationInventory(sid)!;
        for (const id of mineralIds()) {
          const q = stationInv[id];
          c1.expect(Number.isInteger(q) && q >= 10 && q <= 100, `${sid}/${id} 库存 ${q} 不在生成区间[10,100]`);
        }
        c1.expect(tm.getStationPrices(sid) !== null, `${sid} 价格表应存在`);
        c1.expect(tm.getStationName(sid) !== null, `${sid} 名称应保留`);
      }
      const v = priceViolations(tm);
      const c2 = inv('INV-RESET-02', '站点库存与价格重新生成且价格满足区间', `种子${seed} 重置后价格区间`);
      c2.expect(v.length === 0, v.join('; ') || '重置后价格越界');
    }
  }

  // 连续多次重置后系统仍可用：重新采矿/交易能正常进行
  {
    const tm = freshManagerWithStock(60, 30);
    for (let i = 0; i < 5; i++) {
      tm.addMineral('iron', 50);
      tm.sellAll(STATION_IDS[0]);
      tm.reset();
    }
    tm.addMineral('gold', 10);
    const c = inv('INV-RESET-02', '站点库存与价格重新生成且价格满足区间', '多次重置后系统仍可正常交易');
    c.eq(tm.getTotalCargo(), 10, '重置后采矿应正常入账');
    const earned = tm.sellAll(STATION_IDS[0]);
    c.expect(earned > 0, '重置后卖出应有正收益');
    c.eq(tm.getTradeCount(), 1, '重置后交易计数应重新累计');
  }
});
