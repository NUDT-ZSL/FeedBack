// 无人值守批量压力验证：随机混合采矿/买入/卖出/波动/重置，逐步断言
// 全部核心不变量。参数通过全局 __FUZZ_CONFIG__ 注入（见 run.ts）。
import { suite } from '../harness';
import { rng } from '../phaser-shim.mjs';
import { freshManager, globalSnapshot, priceViolations, recordProblems, mineralIds, STATION_IDS } from '../helpers';

declare const __FUZZ_CONFIG__: { seeds: number; ops: number; baseSeed: number };

function runnableInt(maxExclusive: number): number {
  return Math.floor(rng.drawFloat() * maxExclusive);
}

const OP_NAMES = ['mine', 'buy', 'sell', 'fluctuate', 'reset', 'fill'];

suite('随机混合压力 (fuzz)', (inv) => {
  const cfg = __FUZZ_CONFIG__;
  for (let s = 0; s < cfg.seeds; s++) {
    const seed = cfg.baseSeed * 1_000_003 + s;
    const tm = freshManager(seed);
    let snapshot = globalSnapshot(tm);
    let cumulativeMined = 0;

    const checkAll = (step: number, op: string, miningGain: { id: string; delta: number } | null, rebaseline: boolean) => {
      const tag = `种子${seed} 步骤${step}(${op})`;
      const now = globalSnapshot(tm);

      // 全局矿物守恒：采矿允许指定矿物按已知量增加；重置会按设计重新生成
      // 站点库存，因此重置步只重建基线，不做守恒断言。
      if (rebaseline) {
        snapshot = now;
      } else {
        const c = inv('INV-FUZZ-01', '任意操作后玩家+全部站点矿物总量符合守恒/记账', tag);
        for (const id of mineralIds()) {
          const expected = snapshot[id] + (miningGain && miningGain.id === id ? miningGain.delta : 0);
          c.eq(now[id], expected, `矿物 ${id} 全局总量`);
        }
        snapshot = now;
      }
      // 价格区间
      {
        const v = priceViolations(tm);
        const c = inv('INV-PRICE-01', '价格始终位于基础价[0.5,2]倍区间', tag);
        c.expect(v.length === 0, v.join('; '));
      }
      // 货舱容量
      {
        const c = inv('INV-CARGO-01', '库存总量不超过货舱容量', tag);
        c.expect(tm.getTotalCargo() <= tm.getCargoCapacity(), `总量 ${tm.getTotalCargo()} > 容量 ${tm.getCargoCapacity()}`);
      }
      // 站点库存非负且为整数
      {
        const c = inv('INV-FUZZ-02', '站点库存恒为非负整数', tag);
        for (const sid of STATION_IDS) {
          const stationInv = tm.getStationInventory(sid)!;
          for (const id of mineralIds()) {
            const q = stationInv[id];
            c.expect(Number.isInteger(q) && q >= 0, `${sid}/${id}=${q}`);
          }
        }
      }
      // 历史上限与记录自洽
      {
        const hist = tm.getTradeHistory();
        const c1 = inv('INV-HIST-01', '历史最多保留10条', tag);
        c1.expect(hist.length <= 10, `长度 ${hist.length}`);
        for (const r of hist) {
          const problems = recordProblems(r);
          const c2 = inv('INV-HIST-03', '记录数量/单价/总价自洽且与交易一致', `${tag} 记录 ${r.type} ${r.mineralId}x${r.quantity}`);
          c2.expect(problems.length === 0, problems.join('; '));
        }
      }
      // 累计开采量记账
      {
        const c = inv('INV-FUZZ-03', '累计开采量与实际入账矿物一致', tag);
        c.expect(tm.getTotalMined() === cumulativeMined, `累计开采 ${tm.getTotalMined()} != 跟踪值 ${cumulativeMined}`);
      }
    };

    checkAll(0, 'init', null, false);

    for (let step = 1; step <= cfg.ops; step++) {
      const op = runnableInt(6);
      const id = mineralIds()[runnableInt(mineralIds().length)];
      const sid = STATION_IDS[runnableInt(STATION_IDS.length)];
      let miningGain: { id: string; delta: number } | null = null;

      if (op === 0) {
        const beforeCargo = tm.getTotalCargo();
        const amount = 1 + runnableInt(30);
        tm.addMineral(id, amount);
        const added = tm.getTotalCargo() - beforeCargo;
        cumulativeMined += added;
        miningGain = added > 0 ? { id, delta: added } : null;
        const c = inv('INV-CARGO-02', '满舱时添加不得改变库存与累计开采量', `种子${seed} 步骤${step} 采矿${id}x${amount}`);
        c.expect(added >= 0 && added <= amount, `实际增加 ${added} 超出请求 ${amount}`);
      } else if (op === 1) {
        tm.buyMineral(sid, id, 1 + runnableInt(25));
      } else if (op === 2) {
        tm.sellAll(sid);
      } else if (op === 3) {
        tm.fluctuatePrices();
      } else if (op === 4) {
        tm.reset();
        cumulativeMined = 0;
      } else {
        const cap = tm.getCargoCapacity();
        const beforeCargo = tm.getTotalCargo();
        const toFill = cap - beforeCargo;
        if (toFill > 0) {
          tm.addMineral(id, toFill);
          const added = tm.getTotalCargo() - beforeCargo;
          cumulativeMined += added;
          miningGain = { id, delta: added };
        }
      }

      checkAll(step, OP_NAMES[op], miningGain, op === 4);
    }
  }
});
