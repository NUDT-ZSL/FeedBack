// INV-CARGO-01: 玩家库存总量不得超过货舱容量。
// INV-CARGO-02: 货舱已满时继续添加矿石，库存与累计开采量均不得变化。
import { suite } from '../harness';
import { freshManager, mineralIds } from '../helpers';

suite('货舱容量', (inv) => {
  // 单次添加超过容量：只能装到容量上限
  {
    const tm = freshManager(11);
    const cap = tm.getCargoCapacity();
    const ok = tm.addMineral('iron', cap + 500);
    const c = inv('INV-CARGO-01', '库存总量不超过货舱容量', '单次添加量超过容量');
    c.expect(tm.getTotalCargo() <= cap, `总量 ${tm.getTotalCargo()} 超过容量 ${cap}`);
    c.eq(tm.getTotalCargo(), cap, '应恰好装满至容量');
    c.eq(ok, false, 'addMineral 在未能全部装入时应返回 false');
    c.eq(tm.getTotalMined(), cap, '累计开采量应等于实际装入量');
  }

  // 分多次添加直至装满，再验证部分装入
  {
    const tm = freshManager(12);
    const cap = tm.getCargoCapacity();
    tm.addMineral('iron', cap - 5);
    const ok = tm.addMineral('copper', 10); // 只剩 5 空间
    const c = inv('INV-CARGO-01', '库存总量不超过货舱容量', '剩余空间不足时的部分装入');
    c.eq(tm.getTotalCargo(), cap, '总量应等于容量');
    c.eq(tm.getPlayerInventory()['copper'], 5, '铜矿只应装入 5');
    c.eq(ok, false, '部分装入应返回 false');
    c.eq(tm.getTotalMined(), cap, '累计开采量应等于实际装入总量');
  }

  // 货舱已满：继续添加不得改变库存与累计开采量
  {
    const tm = freshManager(13);
    const cap = tm.getCargoCapacity();
    tm.addMineral('gold', cap);
    const invBefore = tm.getPlayerInventory();
    const minedBefore = tm.getTotalMined();
    for (const id of mineralIds()) {
      const ok = tm.addMineral(id, 10);
      const c = inv('INV-CARGO-02', '满舱时添加不得改变库存与累计开采量', `满舱后添加 ${id} x10`);
      c.eq(ok, false, 'addMineral 应返回 false');
      c.eq(tm.getTotalCargo(), cap, '总量不得变化');
      c.eq(tm.getTotalMined(), minedBefore, '累计开采量不得变化');
      c.expect(
        JSON.stringify(tm.getPlayerInventory()) === JSON.stringify(invBefore),
        `库存快照被改变: ${JSON.stringify(tm.getPlayerInventory())}`
      );
    }
  }

  // 零与负数量添加不得改变状态
  {
    const tm = freshManager(14);
    tm.addMineral('iron', 30);
    const before = tm.getPlayerInventory();
    const mined = tm.getTotalMined();
    for (const amt of [0, -5]) {
      tm.addMineral('iron', amt);
      const c = inv('INV-CARGO-01', '库存总量不超过货舱容量', `添加数量 ${amt}`);
      c.eq(tm.getTotalCargo(), 30, '总量不得变化');
      c.eq(tm.getTotalMined(), mined, '累计开采量不得变化');
      c.expect(JSON.stringify(tm.getPlayerInventory()) === JSON.stringify(before), '库存不得变化');
    }
  }
});
