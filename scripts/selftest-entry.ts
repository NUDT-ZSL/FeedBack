/**
 * 引擎自测（Node，离线）：
 * 随机生成大量事件流/档位配置/变更脚本，覆盖乱序、缺来源、同时刻、
 * 阈值重叠、成环、四类处置动作，并强制核对：
 *  - 所有推演不变量成立；
 *  - 每次变更后的增量重推与整体重推逐字段一致（容差 1e-9）。
 */
import {
  Adjudication,
  BatchCase,
  CaseMutation,
  runBatch,
  runCase,
  SimConfig,
  StreamEvent,
  TierConfig,
} from "../src/engine/index";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ACTIONS: TierConfig["action"]["type"][] = [
  "drop",
  "downsample",
  "expandBuffer",
  "pauseSource",
];

function makeCase(rand: () => number, idx: number): BatchCase {
  const sources = ["sA", "sB", "sC"].slice(0, 1 + Math.floor(rand() * 3));
  const n = 40 + Math.floor(rand() * 120);
  const events: StreamEvent[] = [];
  for (let i = 0; i < n; i++) {
    const t = rand() * 20;
    events.push({
      id: `e${idx}-${i}`,
      sourceId: rand() < 0.08 ? undefined : sources[Math.floor(rand() * sources.length)],
      arrivalTime: rand() < 0.15 ? t - 5 : t, // 乱序
      payload: i,
    });
  }
  for (let i = 0; i < 10; i++) {
    events[Math.floor(rand() * n)].arrivalTime = 5; // 同时刻并发
  }

  const tierCount = 1 + Math.floor(rand() * 4);
  const rawThresholds: number[] = [];
  for (let k = 0; k < tierCount; k++) rawThresholds.push(2 + Math.floor(rand() * 12));
  if (rand() < 0.25 && tierCount >= 2) rawThresholds[1] = rawThresholds[0]; // 重叠

  const adjudications: Adjudication[] = [];
  const tiers: TierConfig[] = rawThresholds.map((threshold, k) => {
    const actionType = ACTIONS[Math.floor(rand() * ACTIONS.length)];
    return {
      id: `t${k}`,
      label: `档位${k}`,
      threshold,
      releaseBelow: threshold > 0 && rand() < 0.5 ? Math.max(0, threshold - 1) : undefined,
      consumeRate: rand() < 0.2 ? 0 : Math.floor(rand() * 8) + 1,
      action:
        actionType === "downsample"
          ? { type: "downsample", keepRatio: [0.25, 0.5, 0.75][Math.floor(rand() * 3)] }
          : actionType === "expandBuffer"
            ? { type: "expandBuffer", capacity: 2 + Math.floor(rand() * 8) }
            : actionType === "pauseSource"
              ? { type: "pauseSource", sources: rand() < 0.5 ? ["sA"] : undefined }
              : { type: "drop" },
    };
  });

  // 重叠阈值 → 人工裁决唯一生效档位
  for (let k = 0; k < tiers.length; k++) {
    for (let j = k + 1; j < tiers.length; j++) {
      if (tiers[k].threshold === tiers[j].threshold &&
          !adjudications.some((a) => a.anchor === tiers[k].threshold)) {
        const chosen = rand() < 0.5 ? tiers[k].id : tiers[j].id;
        adjudications.push({
          id: `adj-overlap-${tiers[k].threshold}-${idx}`,
          kind: "overlap",
          anchor: tiers[k].threshold,
          chosenTierId: chosen,
        });
      }
    }
  }
  // 升级链成环 → 人工裁决断点
  if (rand() < 1 / 6 && tierCount >= 2) {
    tiers[0].escalateTo = tiers[1].id;
    tiers[1].escalateTo = tiers[0].id;
    adjudications.push({
      id: `adj-cycle-${idx}`,
      kind: "cycle",
      anchor: tiers[0].id,
      chosenTierId: tiers[0].id,
    });
  }

  const config: SimConfig = {
    baseConsumeRate: 1 + Math.floor(rand() * 6),
    baseCapacity: rand() < 0.5 ? 5 + Math.floor(rand() * 15) : undefined,
    tiers,
  };

  const mutations: CaseMutation[] = [
    { kind: "sourceRate", sourceId: "sA", factor: 2 },
    { kind: "sourceRate", sourceId: "sB", factor: 0.5 },
    { kind: "tierThreshold", tierId: "t0", threshold: 1 + Math.floor(rand() * 14) },
  ];
  if (tiers.length >= 2) {
    mutations.push({ kind: "tierRate", tierId: "t1", consumeRate: 2 + Math.floor(rand() * 6) });
  }

  return { name: `random-${idx}`, events, config, adjudications, mutations };
}

const rand = mulberry32(Number(process.env.SEED ?? 20261007));
const TOTAL = 120;
const cases: BatchCase[] = [];
for (let i = 0; i < TOTAL; i++) cases.push(makeCase(rand, i));

let fail = 0;
const reports = runBatch(cases);
for (const r of reports) {
  if (!r.ok) {
    fail += 1;
    console.log(`[FAIL] ${r.caseName}`);
    r.invariantReport?.failures.forEach((f) => console.log(`   不变量: ${f}`));
    r.mutations
      .filter((m) => !m.ok)
      .forEach((m) => m.failures.forEach((f) => console.log(`   ${m.name}: ${f}`)));
  }
}

// ---- 边界用例 ----
const edge = runCase(
  [
    { id: "x1", sourceId: "a", arrivalTime: 1 },
    { id: "x2", sourceId: "a", arrivalTime: -3 },
    { id: "x3", sourceId: "a", arrivalTime: NaN },
    { id: "x2", sourceId: "a", arrivalTime: 2 },
    { id: "x4", arrivalTime: 0 },
  ] as unknown as StreamEvent[],
  { baseConsumeRate: 1, tiers: [] },
);
if (!edge.output || edge.output.stats.totalEvents !== 4 ||
    edge.output.issues.length < 3) {
  console.log("[FAIL] edge-data-quality: 数据问题显式记录数量/有效事件数不符");
  fail += 1;
}

// 未裁决的重叠阈值必须阻塞推演
const overlap = runCase(
  [{ id: "o1", sourceId: "a", arrivalTime: 0 }],
  {
    baseConsumeRate: 0,
    tiers: [
      { id: "p", threshold: 1, consumeRate: 0, action: { type: "drop" } },
      { id: "q", threshold: 1, consumeRate: 0, action: { type: "expandBuffer", capacity: 1 } },
    ],
  },
);
if (overlap.output !== null) {
  console.log("[FAIL] edge-unresolved-overlap: 未裁决重叠应阻塞推演");
  fail += 1;
}

// 暂停来源：暂停期间 held，释放后最终被消费，history 留痕
const pause = runCase(
  [
    { id: "p1", sourceId: "a", arrivalTime: 0 },
    { id: "p2", sourceId: "a", arrivalTime: 0.3 },
    { id: "p3", sourceId: "b", arrivalTime: 0.6 },
  ],
  {
    baseConsumeRate: 2,
    tiers: [
      { id: "pause", threshold: 1, consumeRate: 2, action: { type: "pauseSource", sources: ["a"] } },
    ],
  },
);
const p2 = pause.output?.events.find((e) => e.eventId === "p2");
if (!pause.output || p2?.status !== "kept" || (p2.history?.length ?? 0) < 2) {
  console.log(`[FAIL] edge-pause-release: p2 期望 held→kept 留痕，实际 ${p2?.status}/${p2.history?.join(",")}`);
  fail += 1;
}

// 降采样确定性：相同输入两次推演结论一致
const dsCfg: SimConfig = {
  baseConsumeRate: 1,
  tiers: [{ id: "ds", threshold: 1, consumeRate: 1, action: { type: "downsample", keepRatio: 0.5 } }],
};
const dsEvents: StreamEvent[] = Array.from({ length: 20 }, (_, i) => ({
  id: `d${i}`, sourceId: "a", arrivalTime: i === 0 ? 0 : 0,
}));
const ds1 = runCase(dsEvents, dsCfg).output;
const ds2 = runCase(dsEvents, dsCfg).output;
if (JSON.stringify(ds1?.events.map((e) => [e.eventId, e.status])) !==
    JSON.stringify(ds2?.events.map((e) => [e.eventId, e.status]))) {
  console.log("[FAIL] edge-downsample-determinism: 降采样结果不确定");
  fail += 1;
}

if (fail > 0) {
  console.log(`\n自测失败: ${fail} 项`);
  process.exit(1);
}
console.log(`自测通过: ${TOTAL} 个随机用例（不变量 + 增量/全量等价）与 4 个边界用例全部通过`);
