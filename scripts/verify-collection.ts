/**
 * 收藏链路批量验证入口（离线，无网络、无浏览器依赖）。
 * 运行：npm run verify:collection
 *
 * 覆盖：正常收藏、印章越界、题跋为空、顺序冲突、
 * 单条修改/清除后的局部重推与整体重推一致性。
 */
import scrolls from '../src/data/scrolls.ts';
import { CollectionStore } from '../src/collection/store.ts';
import { deriveAll, stateSignature } from '../src/collection/derive.ts';
import {
  COLOPHON_MAX_LENGTH,
  SEAL_ROTATION_MAX,
  SEAL_POSITION_MAX,
} from '../src/collection/constants.ts';
import type { RawCollectionRecord } from '../src/collection/types.ts';

let failures = 0;
let checks = 0;

const check = (name: string, condition: boolean, detail?: unknown): void => {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}`);
    if (detail !== undefined) console.error('    ', JSON.stringify(detail, null, 2));
  }
};

const scrollIds = scrolls.map((scroll) => scroll.id);
const [s0, s1, s2, s3] = scrollIds;

const validSeal = { shape: 'circle', color: '#c0392b', rotation: 5, position: { x: 80, y: 80 } };

const record = (overrides: Partial<RawCollectionRecord> & { scrollId: string }): RawCollectionRecord => ({
  colophon: '观此卷如游名山。',
  seal: validSeal,
  requestedOrder: 0,
  collectedAt: 1000,
  ...overrides,
});

/** 场景一：正常收藏，全链路推导无任何裁决。 */
const verifyNormalCollection = (): void => {
  console.log('\n[1] 正常收藏');
  const store = new CollectionStore(scrolls);
  store.dispatch({ kind: 'collect', record: record({ scrollId: s0, requestedOrder: 0, collectedAt: 1 }) });
  store.dispatch({ kind: 'collect', record: record({ scrollId: s1, requestedOrder: 1, collectedAt: 2 }) });
  store.dispatch({ kind: 'collect', record: record({ scrollId: s2, requestedOrder: 2, collectedAt: 3 }) });
  const state = store.getState();

  check('三条收藏全部入藏', state.items.length === 3);
  check('顺序与 requestedOrder 一致', state.items.map((i) => i.scrollId).join(',') === [s0, s1, s2].join(','));
  check('印章形状颜色字保持原值', state.items.every(
    (i) => i.seal?.shape === 'circle' && i.seal?.color === '#c0392b' && i.seal?.character === '藏',
  ));
  check('题跋文本保持原值', state.items.every((i) => i.colophon === '观此卷如游名山。'));
  check('无裁决记录', state.adjudications.length === 0, state.adjudications);
};

/** 场景二：印章越界/缺失取值全部留痕，不被静默吞掉。 */
const verifySealOutOfRange = (): void => {
  console.log('\n[2] 印章越界');
  const store = new CollectionStore(scrolls);
  store.dispatch({
    kind: 'collect',
    record: record({
      scrollId: s0,
      seal: { shape: 'hexagon', color: '#ffffff', rotation: 5, position: { x: 50, y: 50 } },
    }),
  });
  let state = store.getState();
  const kinds = state.adjudications.map((a) => a.kind);
  check('非法形状+非法颜色 → 印章作废', state.items[0]?.seal === null);
  check('形状越界留痕', kinds.includes('seal-shape-invalid'));
  check('颜色越界留痕', kinds.includes('seal-color-invalid'));
  check('整枚作废留痕', kinds.includes('seal-rejected'));
  check('裁决保留输入与裁决依据', state.adjudications.every((a) => a.input !== undefined && a.reason.length > 0 && a.decision.length > 0));

  store.dispatch({
    kind: 'update',
    scrollId: s0,
    patch: { seal: { shape: 'gourd', color: '#2c3e50', rotation: 45, position: { x: 150, y: -20 } } },
  });
  state = store.getState();
  const seal = state.items[0]?.seal;
  check('旋转越界收敛到上限', seal?.rotation === SEAL_ROTATION_MAX, seal);
  check('位置越界收敛到边界', seal?.position.x === SEAL_POSITION_MAX && seal?.position.y === 0, seal);
  check('越界裁决可追溯', state.adjudications.some((a) => a.kind === 'seal-rotation-clamped' && a.input === 45 && a.output === SEAL_ROTATION_MAX));

  store.dispatch({
    kind: 'update',
    scrollId: s0,
    patch: { seal: { shape: 'square', color: '#2c2c2c' } },
  });
  state = store.getState();
  const fallback = state.items[0]?.seal;
  check('旋转缺失回退且留痕', fallback?.rotation === 0 && state.adjudications.some((a) => a.kind === 'seal-rotation-clamped'));
  check('位置缺失回退默认且留痕', state.adjudications.filter((a) => a.kind === 'seal-position-clamped').length === 2);
  check('印文与形状绑定', fallback?.character === '赏');
};

/** 场景三：题跋为空是合法结果；超长截断留痕。 */
const verifyEmptyColophon = (): void => {
  console.log('\n[3] 题跋为空');
  const store = new CollectionStore(scrolls);
  store.dispatch({ kind: 'collect', record: record({ scrollId: s0, colophon: '' }) });
  store.dispatch({ kind: 'collect', record: record({ scrollId: s1, requestedOrder: 1, colophon: '长'.repeat(COLOPHON_MAX_LENGTH + 30) }) });
  const state = store.getState();
  const empty = state.items.find((i) => i.scrollId === s0);
  const long = state.items.find((i) => i.scrollId === s1);

  check('空题跋原样保留', empty?.colophon === '');
  check('空题跋不产生裁决', !state.adjudications.some((a) => a.scrollId === s0));
  check('超长题跋截断到上限', long?.colophon.length === COLOPHON_MAX_LENGTH);
  check('截断留痕', state.adjudications.some((a) => a.scrollId === s1 && a.kind === 'colophon-truncated'));
};

/** 场景四：顺序冲突确定性裁决，非法顺序归一末尾。 */
const verifyOrderConflict = (): void => {
  console.log('\n[4] 顺序冲突');
  const store = new CollectionStore(scrolls);
  store.dispatch({ kind: 'collect', record: record({ scrollId: s0, requestedOrder: 1, collectedAt: 10 }) });
  store.dispatch({ kind: 'collect', record: record({ scrollId: s1, requestedOrder: 1, collectedAt: 5 }) });
  store.dispatch({ kind: 'collect', record: record({ scrollId: s2, requestedOrder: -3, collectedAt: 1 }) });
  const state = store.getState();

  check('冲突按收藏时间裁决（s1 先藏先排）', state.items[0]?.scrollId === s1 && state.items[1]?.scrollId === s0, state.items.map((i) => i.scrollId));
  check('非法顺序归一末尾', state.items[2]?.scrollId === s2 && state.items[2]?.order === 2);
  check('冲突双方均留痕', state.adjudications.filter((a) => a.kind === 'order-conflict').length === 2);
  check('归一留痕', state.adjudications.some((a) => a.kind === 'order-normalized' && a.scrollId === s2));
  check('最终顺序为 0..n-1 无重复', state.items.map((i) => i.order).join(',') === '0,1,2');
};

/** 场景五：单条修改/清除后，局部重推与整体重推一致，且只影响相关收藏。 */
const verifyIncrementalConsistency = (): void => {
  console.log('\n[5] 局部重推与整体重推一致');
  const store = new CollectionStore(scrolls);
  store.dispatch({ kind: 'collect', record: record({ scrollId: s0, requestedOrder: 0, collectedAt: 1 }) });
  store.dispatch({ kind: 'collect', record: record({ scrollId: s1, requestedOrder: 1, collectedAt: 2 }) });
  store.dispatch({ kind: 'collect', record: record({ scrollId: s2, requestedOrder: 2, collectedAt: 3 }) });
  store.dispatch({ kind: 'collect', record: record({ scrollId: s3, requestedOrder: 3, collectedAt: 4 }) });

  const fullSignature = (): string => stateSignature(deriveAll(store.getRawRecords(), new Map(scrolls.map((s) => [s.id, s]))));

  check('初始：局部 == 整体', stateSignature(store.getState()) === fullSignature());

  const updateReport = store.dispatch({
    kind: 'update',
    scrollId: s1,
    patch: { seal: { shape: 'oval', color: '#2c3e50', rotation: 3, position: { x: 70, y: 75 } }, colophon: '改题：墨韵悠长。' },
  });
  check('修改后：局部 == 整体', stateSignature(store.getState()) === fullSignature());
  check('修改只影响该条（顺序未变）', updateReport.affectedScrollIds.join(',') === s1, updateReport.affectedScrollIds);
  check('修改结果生效', store.getState().items.find((i) => i.scrollId === s1)?.seal?.shape === 'oval');

  const moveReport = store.dispatch({ kind: 'move', scrollId: s3, requestedOrder: 0 });
  check('调序后：局部 == 整体', stateSignature(store.getState()) === fullSignature());
  check('调序影响被挤位的收藏', [s1, s2, s3].every((id) => moveReport.affectedScrollIds.includes(id)), moveReport.affectedScrollIds);
  check('调序不影响无关收藏', !moveReport.affectedScrollIds.includes(s0), moveReport.affectedScrollIds);

  const removeReport = store.dispatch({ kind: 'remove', scrollId: s1 });
  check('清除后：局部 == 整体', stateSignature(store.getState()) === fullSignature());
  check('清除影响后续顺位移', removeReport.affectedScrollIds.includes(s1) && removeReport.affectedScrollIds.includes(s2), removeReport.affectedScrollIds);
  check('清除后数量正确', store.getState().items.length === 3);

  store.rederiveAll();
  check('整体重推后与局部状态一致', stateSignature(store.getState()) === fullSignature());
};

console.log('收藏链路批量验证（离线）');
verifyNormalCollection();
verifySealOutOfRange();
verifyEmptyColophon();
verifyOrderConflict();
verifyIncrementalConsistency();

console.log(`\n共 ${checks} 项断言，失败 ${failures} 项`);
if (failures > 0) {
  process.exit(1);
}
console.log('全部通过 ✓');
