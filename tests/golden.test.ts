import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareWithRecord, predictEclipse } from "../src/eclipse/index.ts";
import {
  buildGoldenFile,
  snapshotComparison,
  snapshotPrediction,
} from "../scripts/generate-golden.ts";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "golden.json",
);

interface GoldenFile {
  cases: Record<
    string,
    {
      input: {
        dateISO: string;
        kind: "solar" | "lunar";
        observer?: {
          latitudeDeg: number;
          longitudeDeg: number;
          utcOffsetHours: number;
        };
      };
      expected: {
        prediction: unknown;
        comparison: unknown;
      };
    }
  >;
}

function loadGolden(): GoldenFile {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as GoldenFile;
}

describe("黄金基线回归", () => {
  const golden = loadGolden();

  it("基线文件包含全部约定用例", () => {
    const regenerated = buildGoldenFile() as GoldenFile;
    assert.deepEqual(
      Object.keys(golden.cases).sort(),
      Object.keys(regenerated.cases).sort(),
      "用例清单与 scripts/generate-golden.ts 不一致",
    );
  });

  for (const [name, goldenCase] of Object.entries(golden.cases)) {
    it(`${name}: 推演结论与基线一致`, () => {
      const prediction = predictEclipse({
        date: new Date(goldenCase.input.dateISO),
        kind: goldenCase.input.kind,
        observer: goldenCase.input.observer,
      });
      const comparison = compareWithRecord(prediction);
      assert.deepEqual(
        {
          prediction: snapshotPrediction(prediction),
          comparison: snapshotComparison(comparison),
        },
        goldenCase.expected,
        `用例 ${name} 与基线不符；若属口径调整，请运行 npm run verify:update 重新固化`,
      );
    });
  }

  it("UPDATE_GOLDEN=1 时重写基线文件", (t) => {
    if (process.env.UPDATE_GOLDEN !== "1") {
      t.skip("仅在显式更新模式下执行");
      return;
    }
    writeFileSync(
      fixturePath,
      JSON.stringify(buildGoldenFile(), null, 2) + "\n",
    );
  });
});
