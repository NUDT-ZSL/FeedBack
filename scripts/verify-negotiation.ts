import { createSession, applyUserCounter, MAX_NEGOTIATION_ROUNDS } from '../src/utils/negotiation';
import { settleSale, type LedgerState } from '../src/utils/settlement';
import { toSettlementAmount, formatSettlement, convertToCopper, exchangeRate } from '../src/utils/currency';
import { initialGoods } from '../src/utils/mock';
import type { Currency } from '../src/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function freshState(): LedgerState {
  return {
    goods: JSON.parse(JSON.stringify(initialGoods)),
    transactions: [],
    holdings: { copper: 50000, silver: 50, silk: 10 }
  };
}

function snapshotOf(state: LedgerState): string {
  return JSON.stringify(state);
}

console.log('【用例1】多轮还价逐步收敛直至成交');
{
  const rng = mulberry32(42);
  const listPrice = 120;
  let session = createSession(listPrice, rng);
  assert(session.round === 1 && session.status === 'ongoing', '第1轮番客开价，议价进行中');
  assert(
    session.traderOfferCopper >= Math.round(listPrice * 0.5) &&
      session.traderOfferCopper <= Math.round(listPrice * 0.8),
    `番客开价 ${session.traderOfferCopper}文，低于标价20%~50%`
  );

  let userOffer = Math.round(session.traderOfferCopper * 0.6);
  let convergedRound = 0;
  while (session.status === 'ongoing') {
    const prevTraderOffer = session.traderOfferCopper;
    session = applyUserCounter(session, userOffer, rng);
    if (session.status === 'converged') {
      convergedRound = session.round;
      break;
    }
    if (session.status === 'breakdown') break;
    assert(
      session.traderOfferCopper < prevTraderOffer && session.traderOfferCopper > userOffer,
      `第${session.round}轮：番客新报价 ${session.traderOfferCopper}文 介于我方还价 ${userOffer}文 与其上一口价 ${prevTraderOffer}文 之间（同时参考双方出价）`
    );
    userOffer = userOffer + Math.ceil((session.traderOfferCopper - userOffer) / 2);
  }

  assert(session.status === 'converged', `双方报价收敛，第${convergedRound}轮达成一致`);
  assert(convergedRound > 1, '议价经历多轮后才收敛');
  assert(convergedRound <= MAX_NEGOTIATION_ROUNDS, `收敛轮次未超过上限${MAX_NEGOTIATION_ROUNDS}轮`);
  assert(
    session.history.filter(h => h.party === 'user').length >= 2 &&
      session.history.filter(h => h.party === 'trader').length >= 2,
    '议价历史完整记录了双方多轮出价'
  );

  const state = freshState();
  const dealCopper = session.traderOfferCopper;
  const result = settleSale(state, {
    goodsId: '1',
    quantity: 1,
    totalCopper: dealCopper,
    currency: 'copper',
    traderName: '阿里',
    traderOrigin: '大食'
  });
  assert(result.ok, '按收敛价结算成功');
  if (result.ok) {
    assert(state.goods[0].stock === initialGoods[0].stock - 1, '成交后库存扣减1件');
    assert(state.holdings.copper === 50000 + dealCopper, `铜钱持有量增加${dealCopper}文`);
    assert(
      state.transactions.length === 1 &&
        state.transactions[0].totalAmount === dealCopper &&
        state.transactions[0].currency === 'copper',
      '交易记录金额与成交价一致'
    );
    assert(
      state.goods[0].saleRecords.length === 1 && state.goods[0].saleRecords[0].revenue === dealCopper,
      '货物售出记录同步写入'
    );
  }
}

console.log('【用例2】番客报价同时参考双方出价（单调性）');
{
  const listPrice = 120;
  const base = createSession(listPrice, mulberry32(7));
  const low = applyUserCounter(base, Math.round(base.traderOfferCopper * 0.5), mulberry32(99));
  const high = applyUserCounter(base, Math.round(base.traderOfferCopper * 0.7), mulberry32(99));
  assert(
    low.status === 'ongoing' && high.status === 'ongoing',
    '两种还价均未立即收敛，番客需重新报价'
  );
  assert(
    high.traderOfferCopper > low.traderOfferCopper,
    `我方还价更高时番客新报价也更高（${high.traderOfferCopper}文 > ${low.traderOfferCopper}文），说明报价参考了我方出价而非仅自身上一口价`
  );
}

console.log('【用例3】超过轮次上限且无法收敛时谈崩，不产生任何变动');
{
  const rng = mulberry32(2026);
  let session = createSession(120, rng);
  const state = freshState();
  const before = snapshotOf(state);

  let counters = 0;
  while (session.status === 'ongoing') {
    session = applyUserCounter(session, 1, rng);
    counters++;
    assert(session.round <= MAX_NEGOTIATION_ROUNDS, `轮次未超过上限${MAX_NEGOTIATION_ROUNDS}轮`);
  }
  assert(session.status === 'breakdown', `我方坚持1文低价，第${MAX_NEGOTIATION_ROUNDS}轮后议价破裂`);
  assert(counters === MAX_NEGOTIATION_ROUNDS, `谈崩发生在第${MAX_NEGOTIATION_ROUNDS}次还价之后`);
  assert(snapshotOf(state) === before, '谈崩后库存、交易记录、货币持有量均无任何变动');
}

console.log('【用例4】结算货币切换后展示、应收与入账口径一致');
{
  const dealCopper = 2750;
  const currencies: Currency[] = ['copper', 'silver', 'silk'];
  for (const currency of currencies) {
    const state = freshState();
    const expected = toSettlementAmount(dealCopper, currency);
    const result = settleSale(state, { goodsId: '5', quantity: 1, totalCopper: dealCopper, currency });
    assert(result.ok, `以${currency}结算成交`);
    if (!result.ok) continue;
    assert(
      state.holdings[currency] === freshState().holdings[currency] + expected,
      `持有量按所选货币入账：+${expected}`
    );
    assert(
      result.transaction.currency === currency && result.transaction.totalAmount === expected,
      `交易记录币种与金额均为所选货币口径（${expected}）`
    );
    const displayed = formatSettlement(dealCopper, currency);
    assert(
      displayed.startsWith(String(expected)),
      `议价展示金额 ${displayed} 与入账金额 ${expected} 一致（同一汇率换算，无漂移）`
    );
    assert(
      Math.abs(convertToCopper(result.transaction.totalAmount, currency) - dealCopper) <= exchangeRate[currency] / 10000,
      '入账金额折回铜钱与成交价一致（误差在舍入精度内）'
    );
  }
  const copperState = freshState();
  const silverState = freshState();
  settleSale(copperState, { goodsId: '5', quantity: 1, totalCopper: dealCopper, currency: 'copper' });
  settleSale(silverState, { goodsId: '5', quantity: 1, totalCopper: dealCopper, currency: 'silver' });
  assert(
    convertToCopper(
      silverState.holdings.silver - freshState().holdings.silver,
      'silver'
    ) === copperState.holdings.copper - freshState().holdings.copper,
    '同一成交价切换不同结算货币，折铜价值完全相等'
  );
}

console.log('【用例5】结算任一步失败时整体回滚，不留部分写入');
{
  const state = freshState();
  const before = snapshotOf(state);
  const noStock = settleSale(state, { goodsId: '9', quantity: 99, totalCopper: 100, currency: 'copper' });
  assert(!noStock.ok, '库存不足时结算被拒绝');
  assert(snapshotOf(state) === before, '库存不足未留下任何库存/账目/持有量变动');

  const broken = freshState();
  const brokenBefore = snapshotOf(broken);
  const target = broken.goods.find(g => g.id === '1')!;
  const realRecords = target.saleRecords;
  Object.defineProperty(target, 'saleRecords', {
    get() {
      return new Proxy(realRecords, {
        get(t, prop) {
          if (prop === 'push') throw new Error('模拟售出记录写入失败');
          return (t as never)[prop];
        }
      });
    }
  });
  const failed2 = settleSale(broken, { goodsId: '1', quantity: 1, totalCopper: 100, currency: 'silver' });
  assert(!failed2.ok, '写入中途失败时结算返回失败');
  assert(snapshotOf(broken) === brokenBefore, '库存、交易记录、货币持有量全部回滚，无部分写入');
}

console.log('');
console.log(`验证完成：${passed} 项通过，${failed} 项失败`);
if (failed > 0) {
  process.exit(1);
}
