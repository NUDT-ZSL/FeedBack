// INV-PRICE-01: 价格波动后各站价格必须始终落在基础价的 [0.5, 2] 倍区间。
import { suite } from '../harness';
import { rng } from '../phaser-shim.mjs';
import { freshManager, priceViolations, STATION_IDS, basePriceOf } from '../helpers';

suite('价格波动边界', (inv) => {
  // 初始注册价格即应满足区间约束
  {
    const tm = freshManager(101);
    const c = inv('INV-PRICE-01', '价格始终位于基础价[0.5,2]倍区间', '站点注册后的初始价格');
    const v = priceViolations(tm);
    c.expect(v.length === 0, v.join('; ') || '初始价格越界');
  }

  // 连续多轮随机波动（多组种子），每轮后检查全部站点全部矿物
  for (const seed of [7, 42, 1337]) {
    const tm = freshManager(seed);
    for (let round = 1; round <= 200; round++) {
      tm.fluctuatePrices();
      const v = priceViolations(tm);
      const c = inv('INV-PRICE-01', '价格始终位于基础价[0.5,2]倍区间', `种子${seed} 第${round}轮随机波动`);
      c.expect(v.length === 0, v.join('; ') || '波动后价格越界');
      if (v.length > 0) return; // 该种子已定位失败，避免刷屏
    }
  }

  // 强制持续下跌：波动系数固定为区间下限 0.9，价格应被钳制在 0.5x 基础价
  {
    const tm = freshManager(2024);
    rng.stickyFloat = 0.9; // 本轮全部 FloatBetween(0.9,1.1) 固定为下限
    for (let i = 0; i < 60; i++) {
      tm.fluctuatePrices();
    }
    rng.stickyFloat = null;
    const c = inv('INV-PRICE-01', '价格始终位于基础价[0.5,2]倍区间', '连续60轮强制下跌(系数0.9)后应钳制于下界');
    const v = priceViolations(tm);
    c.expect(v.length === 0, v.join('; ') || '下跌后价格跌破下界');
    const prices = tm.getStationPrices(STATION_IDS[0])!;
    for (const id of Object.keys(prices)) {
      c.eq(prices[id], Math.round(basePriceOf(id) * 0.5), `${STATION_IDS[0]}/${id} 应精确钳制在0.5x基础价`);
    }
  }

  // 强制持续上涨：系数固定为 1.1，价格应被钳制在 2x 基础价
  {
    const tm = freshManager(2025);
    rng.stickyFloat = 1.1; // 固定为上限
    for (let i = 0; i < 60; i++) {
      tm.fluctuatePrices();
    }
    rng.stickyFloat = null;
    const c = inv('INV-PRICE-01', '价格始终位于基础价[0.5,2]倍区间', '连续60轮强制上涨(系数1.1)后应钳制于上界');
    const v = priceViolations(tm);
    c.expect(v.length === 0, v.join('; ') || '上涨后价格超出上界');
    const prices = tm.getStationPrices(STATION_IDS[0])!;
    for (const id of Object.keys(prices)) {
      c.eq(prices[id], Math.round(basePriceOf(id) * 2), `${STATION_IDS[0]}/${id} 应精确钳制在2x基础价`);
    }
  }
});
