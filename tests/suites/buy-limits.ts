// INV-BUY-01: 买入数量同时受「货舱剩余空间」与「站点库存」双重限制，
//             实际成交 = min(请求量, 剩余空间, 站点库存)；超出部分既不能被
//             静默丢弃（有效需求未成交），也不能凭空生成（库存/货舱超量）。
// INV-BUY-02: 无效买入（站点不存在、未知矿物、非正数量、满舱且请求>0）
//             必须原样拒绝，任何一方库存都不得变化。
import { suite } from '../harness';
import { freshManagerWithStock, freshManager, globalSnapshot, STATION_IDS, mineralIds } from '../helpers';

const STATION = STATION_IDS[0];

suite('买入双重限制', (inv) => {
  // 站点库存不足但 >0：应部分成交，而不是整笔拒绝
  {
    const tm = freshManagerWithStock(31, 3);
    const price = tm.getStationPrices(STATION)!['iron'];
    const cost = tm.buyMineral(STATION, 'iron', 10);
    const c = inv('INV-BUY-01', '实际成交=min(请求,剩余空间,站点库存)', '站点库存3、请求10、货舱充足');
    c.eq(tm.getPlayerInventory()['iron'], 3, '应成交 3（库存上限），而非 0（整笔拒绝）或 10（凭空生成）');
    c.eq(tm.getStationInventory(STATION)!['iron'], 0, '站点应恰好减少 3');
    c.eq(cost, 3 * price, '花费应等于实际成交数量 x 单价');
    c.expect(tm.getTotalCargo() <= tm.getCargoCapacity(), '货舱不得超过容量');
  }

  // 站点库存恰好满足：应全额成交
  {
    const tm = freshManagerWithStock(32, 10);
    const price = tm.getStationPrices(STATION)!['copper'];
    const cost = tm.buyMineral(STATION, 'copper', 10);
    const c = inv('INV-BUY-01', '实际成交=min(请求,剩余空间,站点库存)', '库存10、请求10、货舱充足');
    c.eq(tm.getPlayerInventory()['copper'], 10, '应全额成交 10');
    c.eq(tm.getStationInventory(STATION)!['copper'], 0, '站点应清零');
    c.eq(cost, 10 * price, '花费应等于 10 x 单价');
  }

  // 货舱剩余空间不足：应部分成交至装满
  {
    const tm = freshManagerWithStock(33, 100);
    const cap = tm.getCargoCapacity();
    tm.addMineral('gold', cap - 4);
    const price = tm.getStationPrices(STATION)!['silver'];
    const cost = tm.buyMineral(STATION, 'silver', 20);
    const c = inv('INV-BUY-01', '实际成交=min(请求,剩余空间,站点库存)', '仅余4舱位、请求20、库存100');
    c.eq(tm.getPlayerInventory()['silver'], 4, '应只成交 4（货舱上限）');
    c.eq(tm.getStationInventory(STATION)!['silver'], 96, '站点应只减少 4');
    c.eq(cost, 4 * price, '花费应等于实际成交 4 x 单价');
    c.eq(tm.getTotalCargo(), cap, '成交后应恰好装满');
  }

  // 双重限制同时收紧：成交取二者更小
  {
    const tm = freshManagerWithStock(34, 5);
    const cap = tm.getCargoCapacity();
    tm.addMineral('iron', cap - 3);
    const cost = tm.buyMineral(STATION, 'gold', 20);
    const c = inv('INV-BUY-01', '实际成交=min(请求,剩余空间,站点库存)', '余3舱位、库存5、请求20');
    c.eq(tm.getPlayerInventory()['gold'], 3, '应成交 min(20,3,5)=3');
    c.eq(tm.getStationInventory(STATION)!['gold'], 2, '站点应从5减至2');
    c.eq(cost, 3 * tm.getStationPrices(STATION)!['gold'], '花费按实际成交 3 计');
  }

  // 任意成交都必须保持全局守恒，且站点库存/货舱永不越界
  {
    const tm = freshManagerWithStock(35, 50);
    for (let i = 0; i < 20; i++) {
      const id = mineralIds()[i % mineralIds().length];
      const sid = STATION_IDS[i % STATION_IDS.length];
      const before = globalSnapshot(tm);
      tm.buyMineral(sid, id, 10);
      const after = globalSnapshot(tm);
      const changed = Object.keys(before).filter(k => before[k] !== after[k]);
      const c = inv('INV-BUY-01', '买入不凭空生成也不静默吞掉矿物', `第${i + 1}次买入 ${sid}/${id}`);
      c.expect(changed.length === 0, `买入导致全局矿物总量变化: ${changed.map(k => `${k} ${before[k]}->${after[k]}`).join('; ')}`);
      c.expect(tm.getTotalCargo() <= tm.getCargoCapacity(), '货舱超过容量');
    }
  }

  // 无效请求：原样拒绝，状态不变
  {
    const tm = freshManagerWithStock(36, 10);
    const beforeSnap = JSON.stringify(globalSnapshot(tm));
    const beforeCargo = tm.getTotalCargo();
    const beforeCount = tm.getTradeCount();

    const c = inv('INV-BUY-02', '无效买入必须原样拒绝且状态不变', '未知站点/未知矿物/非正数量');
    c.eq(tm.buyMineral('no-such-station', 'iron', 5), 0, '未知站点应返回花费 0');
    c.eq(tm.buyMineral(STATION, 'unobtainium', 5), 0, '未知矿物应返回花费 0');
    c.eq(tm.buyMineral(STATION, 'iron', 0), 0, '数量0应返回花费 0');
    c.eq(tm.buyMineral(STATION, 'iron', -5), 0, '负数量应返回花费 0');
    c.eq(tm.getTotalCargo(), beforeCargo, '无效买入后货舱不得变化');
    c.eq(tm.getTradeCount(), beforeCount, '无效买入不应增加交易计数');
    c.expect(JSON.stringify(globalSnapshot(tm)) === beforeSnap, '无效买入改变了全局库存分布');
  }

  // 货舱已满时买入：必须拒绝，站点库存不变
  {
    const tm = freshManagerWithStock(37, 10);
    const cap = tm.getCargoCapacity();
    tm.addMineral('iron', cap);
    const stationBefore = tm.getStationInventory(STATION)!['copper'];
    const cost = tm.buyMineral(STATION, 'copper', 5);
    const c = inv('INV-BUY-02', '无效买入必须原样拒绝且状态不变', '货舱已满时买入');
    c.eq(cost, 0, '满舱买入应返回花费 0');
    c.eq(tm.getStationInventory(STATION)!['copper'], stationBefore, '站点库存不得变化');
    c.eq(tm.getTotalCargo(), cap, '货舱不得变化');
  }
});
