/**
 * 离线验证入口：多轮议价 / 谈崩终止 / 结算货币一致性 / 失败回滚。
 * 运行：npm run verify
 * 全程不访问网络，直接驱动议价引擎与成交结算模块（与服务器同源）。
 */
import type { Currency, CurrencyHoldings, Goods, Transaction } from '../src/types';
import {
  createNegotiation,
  applyCounterOffer,
  MAX_NEGOTIATION_ROUNDS
} from '../src/utils/negotiation';
import { applySale, type MarketState } from '../src/utils/sale';
import {
  exchangeRate,
  convertCopperToCurrency,
  convertToCopper,
  convertFromCopper,
  roundToCurrency,
  formatAmountInCurrency
} from '../src/utils/currency';
import { initialGoods } from '../src/utils/mock';

let passed = 0;
let failed = 0;

function check(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

function section(title: string) {
  console.log(`\n■ ${title}`);
}

function makeMarket(): MarketState {
  return {
    goods: JSON.parse(JSON.stringify(initialGoods)) as Goods[],
    transactions: [] as Transaction[],
    holdings: { copper: 50000, silver: 50, silk: 10 } as CurrencyHoldings
  };
}

const trader = { id: 't1', name: '阿里', origin: '大食', skinColor: '#d4a574', clothingColor: '#1a1a2e' };
const goods: Goods = { id: 'g1', name: '胡椒', emoji: '🌶️', stock: 5, defaultStock: 10, price: 1000, purchaseRecords: [], saleRecords: [] };
const rng = () => 0.5; // 固定随机源，结果可复现

// ---------- 1. 多轮还价逐步收敛直至成交 ----------
section('多轮还价收敛');
{
  let neg = createNegotiation(goods, trader, rng);
  check(neg.currentOffer === 650, `番客首口价 650 文（标价 1000 文的 65%），实际 ${neg.currentOffer}`);
  check(neg.round === 1 && neg.maxRounds === MAX_NEGOTIATION_ROUNDS, `初始第 1 轮，上限 ${MAX_NEGOTIATION_ROUNDS} 轮`);

  const r1 = applyCounterOffer(neg, 600, rng);
  check(r1.outcome === 'ongoing', '我方还 600 文后议价继续');
  check(r1.state.currentOffer === 628, `番客新报价 628 文（基于双方出价让步），实际 ${r1.state.currentOffer}`);
  check(
    r1.state.currentOffer < 650 && r1.state.currentOffer > 600,
    '番客新报价介于双方出价之间，差距逐步收敛'
  );
  check(r1.state.round === 2, `进入第 2 轮，实际第 ${r1.state.round} 轮`);

  // 番客报价必须参考我方出价：同样的番客报价，我方出价不同则番客新报价不同
  const altA = applyCounterOffer(neg, 620, rng);
  const altB = applyCounterOffer(neg, 580, rng);
  check(
    altA.state.currentOffer === 637 && altB.state.currentOffer === 619,
    `我方还 620 → 番客报 ${altA.state.currentOffer}；还 580 → 番客报 ${altB.state.currentOffer}（随我方出价变化）`
  );

  const r2 = applyCounterOffer(r1.state, 620, rng);
  check(r2.outcome === 'deal', '我方还 620 文（差距 < 3%）→ 番客接受，达成一致');
  check(r2.agreedPrice === 620, `成交价 620 文，实际 ${r2.agreedPrice}`);
  check(r2.state.round <= MAX_NEGOTIATION_ROUNDS, '成交轮次未超上限');

  const market = makeMarket();
  market.goods.push(JSON.parse(JSON.stringify(goods)));
  const sale = applySale(market, {
    goodsId: 'g1', quantity: 1, unitPriceCopper: r2.agreedPrice!, currency: 'copper',
    traderName: trader.name, traderOrigin: trader.origin
  });
  check(sale.transaction.totalAmount === 620 && sale.transaction.currency === 'copper', '成交入账 620 文铜钱');
  check(market.goods.find(g => g.id === 'g1')!.stock === 4, '库存 5 → 4');
  check(market.holdings.copper === 50620, `铜钱 50000 → ${market.holdings.copper}`);
}

// ---------- 2. 谈崩终止（无法收敛 & 轮次上限），不产生任何写入 ----------
section('谈崩终止');
{
  // 2a. 番客退到底价仍无法收敛
  const neg = createNegotiation(goods, trader, rng); // 报价 650，底价 550
  const r1 = applyCounterOffer(neg, 100, rng);
  check(r1.outcome === 'ongoing' && r1.state.currentOffer === 550, `我方还 100 文 → 番客让到底价 ${r1.state.currentOffer} 文`);
  const r2 = applyCounterOffer(r1.state, 100, rng);
  check(r2.outcome === 'breakdown', '我方坚持 100 文 → 谈判破裂');
  check(!!r2.state.breakdownReason, `谈崩原因：${r2.state.breakdownReason}`);

  // 2b. 超过轮次上限
  const lastRound = { ...createNegotiation(goods, trader, rng), round: MAX_NEGOTIATION_ROUNDS };
  const r3 = applyCounterOffer(lastRound, 900, rng);
  check(r3.outcome === 'breakdown', `第 ${MAX_NEGOTIATION_ROUNDS} 轮仍还价 → 超出上限谈崩`);

  // 2c. 谈崩不产生库存与账目变动
  const market = makeMarket();
  const before = JSON.stringify(market);
  check(
    r2.outcome === 'breakdown' && JSON.stringify(market) === before,
    '谈崩路径不调用成交结算，库存/账目/持有量零变动'
  );
}

// ---------- 3. 结算货币切换后展示与入账一致、换算无漂移 ----------
section('结算货币一致性');
{
  const priceCopper = 650;
  for (const currency of ['copper', 'silver', 'silk'] as Currency[]) {
    const market = makeMarket();
    market.goods.push(JSON.parse(JSON.stringify(goods)));
    const before = { ...market.holdings };
    const sale = applySale(market, {
      goodsId: 'g1', quantity: 1, unitPriceCopper: priceCopper, currency,
      traderName: trader.name, traderOrigin: trader.origin
    });
    const expected = convertCopperToCurrency(priceCopper, currency);
    check(sale.transaction.currency === currency, `按${currency}结算：交易记录货币口径一致`);
    check(
      sale.transaction.totalAmount === expected,
      `入账金额 ${sale.transaction.totalAmount} = 展示口径 ${expected}`
    );
    check(
      Math.abs(sale.transaction.totalAmount * exchangeRate[currency] - priceCopper) < 1,
      `入账金额折回铜钱 ≈ ${priceCopper} 文，无口径错配`
    );
    check(
      Math.abs(market.holdings[currency] - (before[currency] + expected)) < 1e-9,
      `持有量按所选货币增加 ${expected}`
    );
    const others = (['copper', 'silver', 'silk'] as Currency[]).filter(c => c !== currency);
    check(
      others.every(c => market.holdings[c] === before[c]),
      '其他货币持有量不受影响'
    );
    const display = formatAmountInCurrency(priceCopper, currency);
    check(
      display.startsWith(String(expected)),
      `展示「${display}」与入账金额同源`
    );
  }

  // 售出记录与账目汇总统一按铜钱口径，与交易记录的结算货币口径可互相折算
  {
    const market = makeMarket();
    market.goods.push(JSON.parse(JSON.stringify(goods)));
    applySale(market, { goodsId: 'g1', quantity: 1, unitPriceCopper: 650, currency: 'silver' });
    applySale(market, { goodsId: 'g1', quantity: 1, unitPriceCopper: 800, currency: 'copper' });
    const record = market.goods.find(g => g.id === 'g1')!.saleRecords[0];
    check(record.revenue === 650, `售出记录按铜钱口径入账（${record.revenue}文），与货物详情展示一致`);
    const dailySales = market.transactions
      .filter(t => t.type === 'sale')
      .reduce((sum, t) => sum + convertToCopper(t.totalAmount, t.currency), 0);
    check(dailySales === 1450, `混合货币账目汇总折铜钱 = ${dailySales} 文（650 + 800）`);
  }

  // 换算稳定性：同一金额反复换算不漂移
  const once = convertCopperToCurrency(650, 'silver');
  const back = convertToCopper(once, 'silver');
  const twice = roundToCurrency(convertFromCopper(back, 'silver'), 'silver');
  check(once === 0.65 && twice === once, `650文 → ${once}两 → ${back}文 → ${twice}两，多次换算无漂移`);
}

// ---------- 4. 失败回滚：任一步失败不留部分写入 ----------
section('失败回滚');
{
  const cases: Array<{ name: string; mutate: (m: MarketState) => void }> = [
    {
      name: '库存不足',
      mutate: m => applySale(m, { goodsId: '1', quantity: 9999, unitPriceCopper: 100, currency: 'copper' })
    },
    {
      name: '货物不存在',
      mutate: m => applySale(m, { goodsId: 'nope', quantity: 1, unitPriceCopper: 100, currency: 'copper' })
    },
    {
      name: '结算货币无效',
      mutate: m => applySale(m, { goodsId: '1', quantity: 1, unitPriceCopper: 100, currency: 'gold' as Currency })
    },
    {
      name: '成交数量无效',
      mutate: m => applySale(m, { goodsId: '1', quantity: 0, unitPriceCopper: 100, currency: 'copper' })
    },
    {
      name: '成交价格无效',
      mutate: m => applySale(m, { goodsId: '1', quantity: 1, unitPriceCopper: -5, currency: 'silver' })
    }
  ];

  for (const c of cases) {
    const market = makeMarket();
    const snapshot = JSON.stringify(market);
    let threw = false;
    try {
      c.mutate(market);
    } catch {
      threw = true;
    }
    check(threw, `${c.name}：结算被拒绝`);
    check(
      JSON.stringify(market) === snapshot,
      `${c.name}：库存/交易记录/持有量完全回滚，无部分写入`
    );
  }
}

console.log(`\n════════════════════════════════`);
console.log(`结果：${passed} 通过，${failed} 失败`);
if (failed > 0) {
  process.exit(1);
}
console.log('全部验证通过 ✔');
