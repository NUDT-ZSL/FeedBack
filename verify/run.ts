/**
 * 拼合链路离线批量验证入口（零第三方依赖，Node >= 22.18 直接运行 TS）。
 *
 * 运行方式：
 *   npm run verify            （等价于 node verify/run.ts）
 *
 * 对 verify/cases/*.json 中的每一组输入：
 *   1. 分别走交互入口与批量/回放入口，断言两份拼合结论逐字段一致；
 *   2. 校验期望的完成态、进度、错误码与事件轨迹；
 *   3. 对结论做不变量审计（进度/完成态/事件轨迹/依赖一致性）；
 *   4. 支持跨用例断言“同一碎片集合不同操作顺序 -> 同一最终状态”；
 *   5. audit 类用例喂入被污染/伪造的结论，要求审计明确报出失真。
 *
 * 任一组失败时进程以退出码 1 结束，可直接接入 CI / 批量脚本。
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runBatchEntry, runInteractiveEntry } from "../src/puzzle/entries.ts";
import { auditConclusion } from "../src/puzzle/invariants.ts";
import type {
  AssemblyConclusion,
  AssemblyEvent,
  AssemblyOperation,
  ShardSet,
} from "../src/puzzle/types.ts";

interface RunExpect {
  valid?: boolean;
  complete?: boolean;
  placed?: number;
  errors?: string[];
  eventsInclude?: string[];
  eventsExclude?: string[];
  sameFinalStateAs?: string;
}

interface RunCase {
  name: string;
  type?: "run";
  shardSet: ShardSet;
  operations: AssemblyOperation[];
  expect?: RunExpect;
}

interface AuditCase {
  name: string;
  type: "audit";
  shardSet: ShardSet;
  conclusion: AssemblyConclusion;
  expect: { invariantFailures: string[] };
}

type VerificationCase = RunCase | AuditCase;

const here = dirname(fileURLToPath(import.meta.url));
const casesDir = join(here, "cases");

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function finalStateOf(conclusion: AssemblyConclusion) {
  return {
    shards: conclusion.shards,
    progress: conclusion.progress,
    completion: conclusion.completion,
  };
}

function assertSameCodeSet(actual: string[], expected: string[], label: string): string[] {
  const reasons: string[] = [];
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  for (const code of expectedSet) {
    if (!actualSet.has(code)) reasons.push(`${label}缺少 ${code}`);
  }
  for (const code of actualSet) {
    if (!expectedSet.has(code)) reasons.push(`${label}出现未预期的 ${code}`);
  }
  return reasons;
}

function evaluateRunCase(
  testCase: RunCase,
  conclusionsByName: Map<string, AssemblyConclusion>,
): string[] {
  const reasons: string[] = [];

  const interactive = runInteractiveEntry(testCase.shardSet, testCase.operations);
  const batch = runBatchEntry(testCase.shardSet, testCase.operations);

  // 风险：不同入口结论分叉
  if (stableStringify(interactive) !== stableStringify(batch)) {
    reasons.push(
      `入口结论不一致：交互入口 ${stableStringify(finalStateOf(interactive))}，批量入口 ${stableStringify(
        finalStateOf(batch),
      )}`,
    );
  }

  const conclusion = interactive;
  const expectation = testCase.expect ?? {};

  if (expectation.valid !== undefined && conclusion.valid !== expectation.valid) {
    reasons.push(`期望 valid=${expectation.valid}，实际 valid=${conclusion.valid}`);
  }
  if (expectation.complete !== undefined) {
    if (conclusion.completion.complete !== expectation.complete) {
      reasons.push(
        `期望完成态 complete=${expectation.complete}，实际 complete=${conclusion.completion.complete}`,
      );
    }
  }
  if (expectation.placed !== undefined && conclusion.progress.placed !== expectation.placed) {
    reasons.push(`期望已拼合 ${expectation.placed} 片，实际 ${conclusion.progress.placed} 片`);
  }
  if (expectation.errors !== undefined) {
    reasons.push(
      ...assertSameCodeSet(conclusion.errors.map((e) => e.code), expectation.errors, "错误码"),
    );
  }

  const eventKinds = conclusion.events.map((event: AssemblyEvent) => event.kind);
  for (const kind of expectation.eventsInclude ?? []) {
    if (!eventKinds.includes(kind)) reasons.push(`事件轨迹缺少期望事件 ${kind}`);
  }
  for (const kind of expectation.eventsExclude ?? []) {
    if (eventKinds.includes(kind)) reasons.push(`事件轨迹出现不应出现的事件 ${kind}`);
  }

  // 引擎产出的结论必须自审计通过
  const auditFailures = auditConclusion(testCase.shardSet, conclusion);
  if (auditFailures.length > 0) {
    reasons.push(...auditFailures.map((f) => `结论自审计失败[${f.code}]：${f.message}`));
  }

  if (expectation.sameFinalStateAs !== undefined) {
    const baseline = conclusionsByName.get(expectation.sameFinalStateAs);
    if (!baseline) {
      reasons.push(`找不到跨用例基准 ${expectation.sameFinalStateAs}`);
    } else if (
      stableStringify(finalStateOf(conclusion)) !== stableStringify(finalStateOf(baseline))
    ) {
      reasons.push(
        `与基准用例 ${expectation.sameFinalStateAs} 的最终状态不一致：${stableStringify(
          finalStateOf(conclusion),
        )} != ${stableStringify(finalStateOf(baseline))}`,
      );
    }
  }

  return reasons;
}

function evaluateAuditCase(testCase: AuditCase): string[] {
  const failures = auditConclusion(testCase.shardSet, testCase.conclusion);
  return assertSameCodeSet(
    failures.map((f) => f.code),
    testCase.expect.invariantFailures,
    "不变量审计",
  );
}

function main(): void {
  const files = readdirSync(casesDir)
    .filter((file) => file.endsWith(".json"))
    .sort();

  const cases: VerificationCase[] = files.map((file) => {
    const parsed = JSON.parse(readFileSync(join(casesDir, file), "utf8")) as VerificationCase;
    if (!parsed.name) throw new Error(`${file} 缺少 name 字段`);
    return parsed;
  });

  // 先跑一遍全部 run 用例，供跨用例基准比对
  const conclusionsByName = new Map<string, AssemblyConclusion>();
  for (const testCase of cases) {
    if (testCase.type === "audit") continue;
    conclusionsByName.set(
      testCase.name,
      runInteractiveEntry(testCase.shardSet, testCase.operations ?? []),
    );
  }

  let passed = 0;
  for (const testCase of cases) {
    const reasons =
      testCase.type === "audit" ? evaluateAuditCase(testCase) : evaluateRunCase(testCase, conclusionsByName);
    if (reasons.length === 0) {
      passed += 1;
      const mode = testCase.type === "audit" ? "audit" : "run: 入口一致+自审计通过";
      console.log(`[PASS] ${testCase.name}  (${mode})`);
    } else {
      console.log(`[FAIL] ${testCase.name}`);
      for (const reason of reasons) console.log(`       - ${reason}`);
    }
  }

  console.log(`\n${passed}/${cases.length} cases passed`);
  if (passed !== cases.length) process.exitCode = 1;
}

main();
