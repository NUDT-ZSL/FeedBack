import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  replay,
  replayAffected,
  scopeForAdjudication,
  scopeForCorrection,
} from "../src/replay/engine.ts";
import { canonicalize, digest, diffPaths } from "../src/replay/canonical.ts";
import type {
  Adjudication,
  ReplayInput,
  ReplayResult,
  SpatialRecord,
} from "../src/replay/types.ts";

interface Scenario extends ReplayInput {
  name: string;
}

interface CheckResult {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures");
const outDir = join(here, "out");
const baselinePath = join(here, "baseline.json");
const updateBaseline = process.argv.includes("--update");

const checks: CheckResult[] = [];

function recordCheck(id: string, name: string, pass: boolean, detail: string): void {
  checks.push({ id, name, pass, detail });
}

function loadScenarios(): Scenario[] {
  return readdirSync(fixturesDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Scenario);
}

function mulberry32(seed: number): () => number {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], seed: number): T[] {
  const result = [...items];
  const random = mulberry32(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function reorder(input: ReplayInput, seed: number): ReplayInput {
  return {
    records: shuffled(input.records, seed),
    events: shuffled(input.events, seed + 101),
    adjudications: shuffled(input.adjudications ?? [], seed + 202),
  };
}

function assertEqualResult(actual: ReplayResult, expected: ReplayResult): string | null {
  if (canonicalize(actual) === canonicalize(expected)) {
    return null;
  }
  return diffPaths(expected, actual, "", 20).join("; ");
}

interface Baseline {
  scenarios: Record<string, { digest: string; result: ReplayResult }>;
}

function readBaseline(): Baseline {
  try {
    return JSON.parse(readFileSync(baselinePath, "utf8")) as Baseline;
  } catch {
    return { scenarios: {} };
  }
}

const scenarios = loadScenarios();
const scenarioResults = new Map<string, ReplayResult>();

for (const scenario of scenarios) {
  const fullResult = replay(scenario);
  scenarioResults.set(scenario.name, fullResult);

  const seeds = [1, 2, 7, 42, 99];
  const orders = new Map<string, string>([
    ["as-loaded", digest(replay(scenario))],
    ["reversed", digest(replay({
      records: [...scenario.records].reverse(),
      events: [...scenario.events].reverse(),
      adjudications: [...(scenario.adjudications ?? [])].reverse(),
    }))],
    ...seeds.map((seed) => [`seed-${seed}`, digest(replay(reorder(scenario, seed)))]),
  ]);
  const uniqueDigests = new Set(orders.values());
  recordCheck(
    `${scenario.name}:order-insensitivity`,
    "回放结论与导入顺序无关",
    uniqueDigests.size === 1,
    uniqueDigests.size === 1
      ? `${orders.size} 种导入顺序得到同一结论 ${[...uniqueDigests][0]}`
      : `不同导入顺序产出不同结论: ${JSON.stringify(Object.fromEntries(orders))}`,
  );
}

const conflictScenario = scenarios.find((scenario) => scenario.name === "conflict");
if (conflictScenario !== undefined) {
  const withoutAdjudication: ReplayInput = { ...conflictScenario, adjudications: [] };
  let previous = replay(withoutAdjudication);
  const applied: Adjudication[] = [];
  let lastDifference: string | null = null;
  let scopedObjects: string[] = [];
  for (const adjudication of conflictScenario.adjudications ?? []) {
    applied.push(adjudication);
    const nextInput: ReplayInput = { ...conflictScenario, adjudications: [...applied] };
    const scope = scopeForAdjudication(withoutAdjudication, adjudication);
    scopedObjects = scope.objects;
    previous = replayAffected(previous, nextInput, scope);
    const difference = assertEqualResult(previous, replay(nextInput));
    if (difference !== null) {
      lastDifference = difference;
    }
  }
  recordCheck(
    "conflict:scoped-adjudication",
    "裁决仅重推受影响对象且与整体重推一致",
    lastDifference === null,
    lastDifference === null
      ? `裁决重推范围仅限对象 ${scopedObjects.join(", ")}，结果与整体重推一致`
      : `局部重推与整体重推不一致: ${lastDifference}`,
  );

  const finalResult = previous;
  const alphaWinner = finalResult.objectStates["obj-alpha"]?.["position"];
  const unresolvedDiagnostic = finalResult.diagnostics.some(
    (item) => item.kind === "unresolved-conflict" && item.refs[0] === "obj-beta|status|18",
  );
  recordCheck(
    "conflict:both-sides-kept",
    "矛盾双方保留且裁决/未裁决均可观察",
    alphaWinner?.recordId === "rec-101" && unresolvedDiagnostic,
    `裁决生效记录=${alphaWinner?.recordId ?? "无"}，未裁决冲突诊断=${unresolvedDiagnostic ? "已暴露" : "被静默通过"}`,
  );
}

const correctionScenario = scenarios.find((scenario) => scenario.name === "correction");
if (correctionScenario !== undefined) {
  const corrections = correctionScenario.records.filter((record) => record.corrects !== undefined);
  const baseRecords = correctionScenario.records.filter((record) => record.corrects === undefined);
  const baseInput: ReplayInput = {
    records: baseRecords,
    events: correctionScenario.events,
    adjudications: correctionScenario.adjudications,
  };
  let previous = replay(baseInput);
  const added: SpatialRecord[] = [];
  let lastDifference: string | null = null;
  for (const correction of corrections) {
    added.push(correction);
    const nextInput: ReplayInput = {
      ...baseInput,
      records: [...baseRecords, ...added],
    };
    const scope = scopeForCorrection(nextInput, correction);
    previous = replayAffected(previous, nextInput, scope);
    const difference = assertEqualResult(previous, replay(nextInput));
    if (difference !== null) {
      lastDifference = difference;
    }
  }
  recordCheck(
    "correction:scoped-replay",
    "记录修正后局部重推与全量重推一致",
    lastDifference === null,
    lastDifference === null
      ? `${corrections.length} 条修正逐条局部重推，结果均与全量重推一致`
      : `修正后局部重推与全量重推不一致: ${lastDifference}`,
  );
  const danglingExposed = previous.diagnostics.some(
    (item) => item.kind === "dangling-correction" && item.refs.includes("rec-999"),
  );
  recordCheck(
    "correction:dangling-exposed",
    "指向缺失原记录的修正被暴露",
    danglingExposed,
    danglingExposed ? "dangling-correction 诊断已输出" : "悬空修正被静默接受",
  );
}

const brokenScenario = scenarios.find((scenario) => scenario.name === "broken-links");
if (brokenScenario !== undefined) {
  const result = replay(brokenScenario);
  const missingExposed = result.diagnostics.some(
    (item) => item.kind === "missing-link" && item.refs[0] === "evt-1" && item.refs[1] === "evt-9",
  );
  const cycleExposed = result.diagnostics.some(
    (item) =>
      item.kind === "link-cycle" &&
      item.refs.length === 2 &&
      item.refs.includes("evt-2") &&
      item.refs.includes("evt-3"),
  );
  recordCheck(
    "links:missing-exposed",
    "关联指向缺失时可观察地暴露",
    missingExposed,
    missingExposed ? "missing-link 诊断已输出 (evt-1 -> evt-9)" : "缺失关联被静默跳过",
  );
  recordCheck(
    "links:cycle-exposed",
    "关联成环时可观察地暴露",
    cycleExposed,
    cycleExposed ? "link-cycle 诊断已输出 (evt-2 <-> evt-3)" : "成环关联被静默跳过",
  );
}

const baseline = readBaseline();
const nextBaseline: Baseline = { scenarios: {} };
for (const [name, result] of scenarioResults) {
  const currentDigest = digest(result);
  nextBaseline.scenarios[name] = {
    digest: currentDigest,
    result: JSON.parse(canonicalize(result)) as ReplayResult,
  };
  if (updateBaseline) {
    continue;
  }
  const expected = baseline.scenarios[name];
  if (expected === undefined) {
    recordCheck(
      `baseline:${name}`,
      "结论与基线可比较",
      false,
      "缺少基线，先运行 npm run verify:update 固化当前结论",
    );
  } else if (expected.digest !== currentDigest) {
    const changedPaths = diffPaths(expected.result, result, "", 20).join("; ");
    writeFileSync(
      join(outDir, `${name}.actual.json`),
      `${JSON.stringify(JSON.parse(canonicalize(result)), null, 2)}\n`,
    );
    recordCheck(
      `baseline:${name}`,
      "结论与基线一致",
      false,
      `结论发生变化（期望 ${expected.digest}，实际 ${currentDigest}），差异路径: ${changedPaths}；实际结果已写入 out/${name}.actual.json`,
    );
  } else {
    recordCheck(`baseline:${name}`, "结论与基线一致", true, `digest=${currentDigest}`);
  }
}

if (updateBaseline) {
  writeFileSync(baselinePath, `${JSON.stringify(nextBaseline, null, 2)}\n`);
}

const passed = checks.every((check) => check.pass);
const report = {
  status: passed ? "passed" : "failed",
  total: checks.length,
  passedCount: checks.filter((check) => check.pass).length,
  failedCount: checks.filter((check) => !check.pass).length,
  checks,
  scenarios: Object.fromEntries(
    [...scenarioResults].map(([name, result]) => [name, { digest: digest(result) }]),
  ),
};
writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

for (const check of checks) {
  console.log(`${check.pass ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}`);
}
console.log("");
if (updateBaseline) {
  console.log(`baseline.json 已更新（${Object.keys(nextBaseline.scenarios).length} 个场景）`);
}
console.log(`结果: ${report.passedCount}/${report.total} 通过，报告: verification/out/report.json`);
process.exit(passed ? 0 : 1);
