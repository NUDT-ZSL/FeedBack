// INV-SELL-01: 卖出前后，站点库存与玩家库存之和（按矿物）保持守恒；
//              且全系统（玩家+全部站点）每种矿物总量守恒。
import { suite } from '../harness';
import { freshManager, globalSnapshot, diffSnapshot, mineralIds, STATION_IDS } from '../helpers';

suite('卖出守恒', (inv) => {
  // 跨站点连续卖出：每次交易前后逐矿物核对全局总量
  {
    const tm = freshManager(21);
    for (let round = 0; round < 30; round++) {
      // 补充货物（留出空间）
      const space = tm.getCargoCapacity() - tm.getTotalCargo();
      if (space > 0) {
        const id = mineralIds()[round % mineralIds().length];
        tm.addMineral(id, Math.min(10, space));
      }
      const station = STATION_IDS[round % STATION_IDS.length];
      const before = globalSnapshot(tm);
      const earned = tm.sellAll(station);
      const after = globalSnapshot(tm);
      const diffs = diffSnapshot(before, after);
      const c = inv('INV-SELL-01', '卖出前后玩家+站点库存总量守恒', `第${round + 1}轮 向${station}卖出全部`);
      c.expect(diffs.length === 0, `全局矿物总量发生变化: ${diffs.join('; ')}`);
      c.expect(earned >= 0, `卖出收益为负: ${earned}`);
      if (diffs.length > 0) return;
    }
  }

  // 逐矿物核对目标站点与玩家的具体转移量
  {
    const tm = freshManager(22);
    tm.addMineral('iron', 40);
    tm.addMineral('gold', 15);
    const station = STATION_IDS[1];
    const playerBefore = tm.getPlayerInventory();
    const stationBefore = tm.getStationInventory(station)!;
    const prices = tm.getStationPrices(station)!;
    const earned = tm.sellAll(station);
    const playerAfter = tm.getPlayerInventory();
    const stationAfter = tm.getStationInventory(station)!;

    let expectedEarned = 0;
    for (const id of mineralIds()) {
      const moved = (playerBefore[id] ?? 0) - (playerAfter[id] ?? 0);
      const gained = (stationAfter[id] ?? 0) - (stationBefore[id] ?? 0);
      const c = inv('INV-SELL-01', '卖出前后玩家+站点库存总量守恒', `逐矿物核对 ${id}`);
      c.eq(moved, gained, `${id} 玩家减少量与站点增加量不一致`);
      expectedEarned += (playerBefore[id] ?? 0) * prices[id];
    }
    const c2 = inv('INV-SELL-01', '卖出前后玩家+站点库存总量守恒', '卖出收益与价格表一致');
    c2.eq(earned, expectedEarned, 'sellAll 返回值');
    c2.eq(tm.getTotalCargo(), 0, '卖出全部后货舱应为空');
  }

  // 空货舱卖出：状态不得变化
  {
    const tm = freshManager(23);
    const before = globalSnapshot(tm);
    const earned = tm.sellAll(STATION_IDS[0]);
    const after = globalSnapshot(tm);
    const c = inv('INV-SELL-01', '卖出前后玩家+站点库存总量守恒', '空货舱执行卖出全部');
    c.eq(earned, 0, '空舱卖出收益应为 0');
    c.expect(diffSnapshot(before, after).length === 0, '空舱卖出改变了库存分布');
    c.eq(tm.getTradeCount(), 0, '空舱卖出不应产生交易计数');
  }
});
