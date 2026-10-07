import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runScenario, type BatchReport, type Scenario } from "../src/orchestration/batch.ts";
import { runSelfTests } from "../src/orchestration/selftest.ts";

const here = dirname(fileURLToPath(import.meta.url));

function loadScenario(path: string): Scenario {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Scenario;
  return {
    name: parsed.name ?? path,
    participants: parsed.participants ?? [],
    resources: parsed.resources ?? [],
    sessions: parsed.sessions ?? [],
    operations: parsed.operations ?? [],
  };
}

function printReport(report: BatchReport): boolean {
  console.log(`\n场景: ${report.name}  ${report.ok ? "PASS" : "FAIL"}`);
  for (const phase of report.phases) {
    console.log(
      `  [${phase.phase}] 重推=[${phase.rederived.join(", ")}] 当前场次=${phase.activeSessionId ?? "-"}`,
    );
    for (const result of phase.results) {
      const allocations = result.allocations
        .map((a) => `${a.slotId}:${a.participantId}<-${a.resourceId}`)
        .join(" ");
      console.log(`    场次 ${result.sessionId}: ${allocations || "(空)"}`);
    }
    const contentions = phase.conflicts.filter((c) => c.type === "resource-contention");
    for (const conflict of contentions) {
      console.log(
        `    冲突[归属 ${conflict.sessionId}] ${conflict.type} ${conflict.resourceId} ${conflict.slotId} ↔ ${conflict.otherSessionId}: ${conflict.message}`,
      );
    }
    for (const check of phase.checks) {
      if (!check.ok) {
        console.log(`    校验失败: ${check.name} ${check.detail ?? ""}`);
      }
    }
  }
  return report.ok;
}

function main(): void {
  const args = process.argv.slice(2);
  let failures = 0;

  const selfTests = runSelfTests();
  console.log("== 不变量自检 ==");
  for (const test of selfTests) {
    console.log(`${test.ok ? "PASS" : "FAIL"}  ${test.name}${test.ok ? "" : ` — ${test.detail}`}`);
    if (!test.ok) {
      failures += 1;
    }
  }

  const scenarioPaths = args.length > 0
    ? args.map((path) => resolve(path))
    : readdirSync(join(here, "scenarios"))
        .filter((file) => extname(file) === ".json")
        .map((file) => join(here, "scenarios", file));

  console.log("\n== 场景批量运行 ==");
  if (scenarioPaths.length === 0) {
    console.log("(无场景文件)");
  }
  for (const path of scenarioPaths) {
    const ok = printReport(runScenario(loadScenario(path)));
    if (!ok) {
      failures += 1;
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} 项失败`);
    process.exit(1);
  }
  console.log("\n全部通过");
}

main();
