// INV-HIST-01: 交易历史最多保留 10 条。
// INV-HIST-02: 历史按时间倒序（最新在前），超限后丢弃最旧记录。
// INV-HIST-03: 每条记录数量、单价、总价自洽，且与对应交易一致。
import { suite } from '../harness';
import { freshManagerWithStock, recordProblems, STATION_IDS, mineralIds } from '../helpers';

suite('交易历史', (inv) => {
  // 连续 25 笔买入（超过上限），验证长度、顺序与逐条自洽
  {
    const tm = freshManagerWithStock(41, 100);
    const cap = tm.getCargoCapacity();
    const perBuy = Math.floor(cap / 25); // 8，保证 25 笔都能成交
    const station = STATION_IDS[0];
    const expected: { id: string; qty: number; price: number }[] = [];

    for (let i = 0; i < 25; i++) {
      const id = mineralIds()[i % mineralIds().length];
      const price = tm.getStationPrices(station)![id];
      const cost = tm.buyMineral(station, id, perBuy);
      const c0 = inv('INV-HIST-03', '记录数量/单价/总价自洽且与交易一致', `第${i + 1}笔买入应成交`);
      c0.eq(cost, perBuy * price, '买入花费');
      expected.push({ id, qty: perBuy, price });

      const hist = tm.getTradeHistory();
      const c1 = inv('INV-HIST-01', '历史最多保留10条', `第${i + 1}笔交易后`);
      c1.expect(hist.length <= 10, `历史长度 ${hist.length} 超过上限 10`);
      c1.eq(hist.length, Math.min(i + 1, 10), '历史长度');

      const c2 = inv('INV-HIST-02', '历史按最近顺序保留（最新在前）', `第${i + 1}笔交易后首条应为最新`);
      const head = hist[0];
      c2.eq(head.mineralId, id, '最新记录矿物');
      c2.eq(head.quantity, perBuy, '最新记录数量');
      c2.eq(head.pricePerUnit, price, '最新记录单价');
      c2.eq(head.type, 'buy', '最新记录类型');

      // 超过上限后，被保留的应是最近 10 笔（按时间倒序）
      const keep = expected.slice(-10).reverse();
      const c3 = inv('INV-HIST-02', '历史按最近顺序保留（最新在前）', `第${i + 1}笔交易后完整序列`);
      c3.expect(
        hist.every((r, idx) => r.mineralId === keep[idx].id && r.quantity === keep[idx].qty && r.pricePerUnit === keep[idx].price),
        `保留序列与最近10笔不符: 实际=${hist.map(r => r.mineralId).join(',')} 期望=${keep.map(k => k.id).join(',')}`
      );

      for (const r of hist) {
        const problems = recordProblems(r);
        const c4 = inv('INV-HIST-03', '记录数量/单价/总价自洽且与交易一致', `第${i + 1}笔交易后校验记录 ${r.type} ${r.mineralId}x${r.quantity}`);
        c4.expect(problems.length === 0, problems.join('; ') || '记录字段非法');
      }
    }
  }

  // 卖出产生的历史记录同样自洽
  {
    const tm = freshManagerWithStock(42, 50);
    tm.addMineral('iron', 30);
    tm.addMineral('gold', 12);
    const station = STATION_IDS[1];
    const prices = tm.getStationPrices(station)!;
    tm.sellAll(station);
    const hist = tm.getTradeHistory();
    const c = inv('INV-HIST-03', '记录数量/单价/总价自洽且与交易一致', '卖出全部后生成两条卖出记录');
    c.eq(hist.length, 2, '卖出两种矿物应产生2条记录');
    c.eq(hist[0].mineralId, 'gold', '最新记录应为最后卖出的矿物');
    c.eq(hist[1].mineralId, 'iron', '次新记录应为先卖出的矿物');
    for (const r of hist) {
      c.eq(r.type, 'sell', '记录类型');
      c.eq(r.pricePerUnit, prices[r.mineralId], `${r.mineralId} 单价应与站点价格一致`);
      c.eq(r.totalValue, r.quantity * r.pricePerUnit, `${r.mineralId} 总价自洽`);
    }
    const c2 = inv('INV-HIST-01', '历史最多保留10条', '卖出全部后');
    c2.expect(hist.length <= 10, '历史长度超上限');
  }
});
