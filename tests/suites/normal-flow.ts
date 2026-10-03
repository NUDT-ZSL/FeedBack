// 正常路径冒烟：采矿 -> 跨站卖出 -> 买入 -> 波动 -> 重置，全链路关键不变量。
import { suite } from '../harness';
import { freshManager, globalSnapshot, diffSnapshot, priceViolations, mineralIds, STATION_IDS } from '../helpers';

suite('正常路径', (inv) => {
  const tm = freshManager(9001);

  // 采矿入账
  {
    tm.addMineral('iron', 50);
    tm.addMineral('gold', 20);
    const c = inv('INV-CARGO-01', '库存总量不超过货舱容量', '正常采矿入账');
    c.eq(tm.getTotalCargo(), 70, '货舱总量');
    c.eq(tm.getTotalMined(), 70, '累计开采量');
    c.expect(tm.getTotalCargo() <= tm.getCargoCapacity(), '不得超过容量');
  }

  // 跨站卖出守恒 + 收益累计
  {
    const before = globalSnapshot(tm);
    const earned = tm.sellAll(STATION_IDS[0]);
    const after = globalSnapshot(tm);
    const c = inv('INV-SELL-01', '卖出前后玩家+站点库存总量守恒', '正常路径跨站卖出');
    c.expect(diffSnapshot(before, after).length === 0, '卖出破坏全局守恒');
    c.expect(earned > 0, '卖出应有正收益');
    c.eq(tm.getTotalValue(), earned, '累计价值应等于本次收益');
    c.eq(tm.getTotalCargo(), 0, '卖出全部后货舱为空');
  }

  // 买入并再次卖出
  {
    const before = globalSnapshot(tm);
    const cost = tm.buyMineral(STATION_IDS[1], 'silver', 10);
    const after = globalSnapshot(tm);
    const c = inv('INV-BUY-01', '实际成交=min(请求,剩余空间,站点库存)', '正常路径买入10银矿');
    c.expect(diffSnapshot(before, after).length === 0, '买入破坏全局守恒');
    c.expect(cost > 0, '买入应成交');
    c.eq(tm.getPlayerInventory()['silver'], 10, '应持有10银矿');
    void mineralIds;
  }

  // 价格波动后区间约束
  {
    for (let i = 0; i < 10; i++) tm.fluctuatePrices();
    const v = priceViolations(tm);
    const c = inv('INV-PRICE-01', '价格始终位于基础价[0.5,2]倍区间', '正常路径10轮波动后');
    c.expect(v.length === 0, v.join('; ') || '价格越界');
  }

  // 重置回初始
  {
    tm.reset();
    const c = inv('INV-RESET-01', '玩家状态全部回到初始值', '正常路径末尾重置');
    c.eq(tm.getTotalCargo(), 0, '货舱归零');
    c.eq(tm.getTotalValue(), 0, '累计价值归零');
    c.eq(tm.getTotalMined(), 0, '累计开采归零');
    c.eq(tm.getTradeCount(), 0, '交易计数归零');
    const v = priceViolations(tm);
    const c2 = inv('INV-RESET-02', '站点库存与价格重新生成且价格满足区间', '正常路径末尾重置');
    c2.expect(v.length === 0, v.join('; ') || '重置后价格越界');
  }
});
