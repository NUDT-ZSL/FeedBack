/**
 * 离线推演：不依赖网络与浏览器，用一批预设的阀门/间隙/打包事件驱动
 * millReducer，观察每袋面粉的重量、成色与产出依据随时间的变化。
 *
 * 运行：npm run simulate
 * 同一事件序列重复运行，账目结果必须完全一致（脚本末尾自动校验）。
 */
import {
  createInitialState,
  formatDate,
  getFlourTypeName,
  getUnpackedTotals,
  millReducer,
} from './MillCore';
import type { FlourType, MillAction, MillState } from './types';

const TICK_MS = 100; // 模拟界面每 100ms 记账一次
const BASE_EPOCH = new Date('2026-10-05T08:00:00').getTime();

type ScenarioEvent =
  | { at: number; kind: 'valve'; value: number }
  | { at: number; kind: 'gap'; value: number }
  | { at: number; kind: 'pack'; flourType: FlourType }
  | { at: number; kind: 'note'; text: string };

/** 预设事件序列：覆盖正常研磨、状态变更、极端值、过载、连续打包等情形 */
const scenario: ScenarioEvent[] = [
  { at: 0, kind: 'note', text: '开磨：阀门 60%，间隙 1.5mm（中筋为主）' },
  { at: 0, kind: 'valve', value: 60 },
  { at: 5000, kind: 'note', text: '调细：间隙 1.5 -> 0.8mm 并降阀至 30%（细磨需低速，否则过载）' },
  { at: 5000, kind: 'gap', value: 0.8 },
  { at: 5000, kind: 'valve', value: 30 },
  { at: 9000, kind: 'note', text: '打包精白面：依据应包含两段不同间隙' },
  { at: 9000, kind: 'pack', flourType: 'fine' },
  { at: 9000, kind: 'note', text: '同一时刻连续打包中筋面与麸皮：两袋须独立成条' },
  { at: 9000, kind: 'pack', flourType: 'medium' },
  { at: 9000, kind: 'pack', flourType: 'bran' },
  { at: 9000, kind: 'note', text: '紧跟着再打包精白面：无累计量，不应产生批次' },
  { at: 9000, kind: 'pack', flourType: 'fine' },
  { at: 10000, kind: 'note', text: '极端值：阀门 150%（钳位到 100）、间隙 0.1mm（钳位到 0.5）' },
  { at: 10000, kind: 'valve', value: 150 },
  { at: 10000, kind: 'gap', value: 0.1 },
  { at: 11000, kind: 'note', text: '此时应处于过载停机保护，产出为零' },
  { at: 14000, kind: 'note', text: '调粗：间隙 0.5 -> 2.8mm，解除过载，麸皮为主' },
  { at: 14000, kind: 'gap', value: 2.8 },
  { at: 20000, kind: 'note', text: '打包麸皮：依据应只有 2.8mm 这一段（过载段无产出）' },
  { at: 20000, kind: 'pack', flourType: 'bran' },
  { at: 20000, kind: 'note', text: '关阀停机，再打包精白面：剩余累计量按历史分段结算' },
  { at: 20000, kind: 'valve', value: 0 },
  { at: 23000, kind: 'pack', flourType: 'fine' },
];

const eventToActions = (
  event: ScenarioEvent,
  bagCounter: { n: number }
): MillAction[] => {
  switch (event.kind) {
    case 'valve':
      return [{ type: 'SET_VALVE', valve: event.value, now: event.at }];
    case 'gap':
      return [{ type: 'SET_GAP', gap: event.value, now: event.at }];
    case 'pack': {
      bagCounter.n += 1;
      return [
        {
          type: 'PACK',
          flourType: event.flourType,
          id: `bag-${bagCounter.n}`,
          now: event.at,
          timestamp: formatDate(new Date(BASE_EPOCH + event.at)),
        },
      ];
    }
    default:
      return [];
  }
};

const runScenario = (log: (line: string) => void): MillState => {
  let state = createInitialState(0);
  const bagCounter = { n: 0 };
  const endAt = Math.max(...scenario.map((e) => e.at)) + 1000;

  const eventsByTime = new Map<number, ScenarioEvent[]>();
  for (const event of scenario) {
    const list = eventsByTime.get(event.at) ?? [];
    list.push(event);
    eventsByTime.set(event.at, list);
  }

  for (let now = 0; now <= endAt; now += TICK_MS) {
    const events = eventsByTime.get(now) ?? [];
    for (const event of events) {
      if (event.kind === 'note') {
        log(`\n[t=${(event.at / 1000).toFixed(1)}s] ※ ${event.text}`);
        continue;
      }
      for (const action of eventToActions(event, bagCounter)) {
        const before = state.batches.length;
        state = millReducer(state, action);
        if (action.type === 'SET_VALVE') {
          log(
            `[t=${(now / 1000).toFixed(1)}s] 阀门 -> ${action.valve}%` +
              `（实际 ${state.valveOpening}%，转速 ${state.wheelSpeed.toFixed(1)}，负载 ${state.load.toFixed(1)}%${state.isOverloaded ? '，过载停机' : ''}）`
          );
        } else if (action.type === 'SET_GAP') {
          log(
            `[t=${(now / 1000).toFixed(1)}s] 间隙 -> ${action.gap}mm` +
              `（实际 ${state.gap}mm，负载 ${state.load.toFixed(1)}%${state.isOverloaded ? '，过载停机' : ''}）`
          );
        } else if (action.type === 'PACK') {
          if (state.batches.length > before) {
            const batch = state.batches[state.batches.length - 1];
            log(
              `[t=${(now / 1000).toFixed(1)}s] 打包 #${batch.seq} ${getFlourTypeName(batch.type)}` +
                ` ${batch.weight.toFixed(1)} 斤（均隙 ${batch.avgGap}mm，均速 ${batch.avgSpeed}）`
            );
            for (const seg of batch.basis) {
              log(
                `    依据: 间隙 ${seg.gap}mm / 转速 ${seg.speed} / ${(seg.durationMs / 1000).toFixed(1)}s` +
                  ` / 配比 精${(seg.ratios.fine * 100).toFixed(0)}-中${(seg.ratios.medium * 100).toFixed(0)}-麸${(seg.ratios.bran * 100).toFixed(0)}` +
                  ` / 贡献 ${seg.contribution.toFixed(1)} 斤`
              );
            }
          } else {
            log(
              `[t=${(now / 1000).toFixed(1)}s] 打包 ${getFlourTypeName(action.flourType)}：无可打包累计量，跳过`
            );
          }
        }
      }
    }
    state = millReducer(state, { type: 'TICK', now: now + TICK_MS });
  }

  const totals = getUnpackedTotals(state);
  log(
    `\n推演结束：未打包余量 精白面 ${totals.fine.toFixed(2)} / 中筋面 ${totals.medium.toFixed(2)} / 麸皮 ${totals.bran.toFixed(2)} 斤`
  );
  log(`批次总数：${state.batches.length}`);
  return state;
};

/** 账目指纹：只含账目相关字段，粒子等视觉状态不参与 */
const ledgerFingerprint = (state: MillState): string =>
  JSON.stringify({
    batches: state.batches,
    sealedSegments: state.sealedSegments,
    unpacked: getUnpackedTotals(state),
  });

const lines: string[] = [];
const first = runScenario((line) => lines.push(line));
const second = runScenario(() => undefined);

console.log(lines.join('\n'));
console.log('\n--- 批次台账汇总 ---');
for (const batch of first.batches) {
  console.log(
    `#${batch.seq} [${batch.timestamp}] ${getFlourTypeName(batch.type)} ${batch.weight.toFixed(1)} 斤` +
      ` / 均隙 ${batch.avgGap}mm / 均速 ${batch.avgSpeed} / 依据 ${batch.basis.length} 段`
  );
}

const consistent = ledgerFingerprint(first) === ledgerFingerprint(second);
console.log(
  `\n确定性校验：同一序列重复运行两次，账目指纹${consistent ? '一致 ✓' : '不一致 ✗'}`
);
if (!consistent) {
  process.exit(1);
}
