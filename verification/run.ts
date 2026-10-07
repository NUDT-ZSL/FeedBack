import type { Scenario } from "./types.js";
import { repeatDeterminism } from "./scenarios/repeatDeterminism.js";
import { rewindReplay } from "./scenarios/rewindReplay.js";
import { occlusionConsistency } from "./scenarios/occlusionConsistency.js";
import { longRunStability } from "./scenarios/longRunStability.js";

const scenarios: readonly Scenario[] = [
  repeatDeterminism,
  rewindReplay,
  occlusionConsistency,
  longRunStability,
];

const MAX_FAILURE_LINES_PER_SCENARIO = 20;

function main(): number {
  console.log("浑天仪推演离线验证");
  console.log("=".repeat(60));

  let passedCount = 0;
  const failedScenarios: string[] = [];

  for (const scenario of scenarios) {
    const startedAt = Date.now();
    const result = scenario.run();
    const elapsedMs = Date.now() - startedAt;

    if (result.failures.length === 0) {
      passedCount += 1;
      console.log(`✓ 通过  ${result.name}  (${elapsedMs}ms)`);
      console.log(`        ${scenario.description}`);
      console.log(`        ${result.summary}`);
    } else {
      failedScenarios.push(result.name);
      console.log(`✗ 失败  ${result.name}  (${elapsedMs}ms)`);
      console.log(`        ${scenario.description}`);
      const shown = result.failures.slice(0, MAX_FAILURE_LINES_PER_SCENARIO);
      for (const failure of shown) {
        console.log(`        - ${failure}`);
      }
      if (result.failures.length > shown.length) {
        console.log(
          `        ... 其余 ${result.failures.length - shown.length} 条失败从略`,
        );
      }
    }
  }

  console.log("=".repeat(60));
  if (failedScenarios.length === 0) {
    console.log(`全部 ${scenarios.length} 个场景通过。`);
    return 0;
  }
  console.log(
    `${passedCount}/${scenarios.length} 个场景通过，失败场景: ${failedScenarios.join(", ")}`,
  );
  return 1;
}

process.exitCode = main();
