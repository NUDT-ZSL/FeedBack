import { readFileSync } from "node:fs";
import {
  runBatchFengshui,
  DEFAULT_BATCH_CASES,
} from "../src/fengshui/index.ts";
import type { FengshuiBatchCase } from "../src/fengshui/index.ts";

function loadCases(): FengshuiBatchCase[] {
  const file = process.argv[2];
  if (!file) {
    return DEFAULT_BATCH_CASES;
  }
  const parsed = JSON.parse(readFileSync(file, "utf-8"));
  if (!Array.isArray(parsed)) {
    throw new Error("用例文件必须是 JSON 数组");
  }
  return parsed;
}

const results = runBatchFengshui(loadCases());

const summary = {
  total: results.length,
  stable: results.filter((r) => r.stable).length,
  unstable: results.filter((r) => !r.stable).map((r) => r.case.name),
};

console.log(JSON.stringify({ summary, results }, null, 2));

if (summary.unstable.length > 0) {
  process.exitCode = 1;
}
