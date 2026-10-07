import { readFileSync, writeFileSync } from "node:fs";
import { analyzeFengshui, type FengshuiAnalysis } from "../src/fengshui";
import { DEFAULT_CASES, type BatchCase } from "./defaultCases";

interface BatchResult {
  label: string;
  analysis: FengshuiAnalysis;
  deterministic: boolean;
}

function parseArgs(argv: string[]): { input?: string; output?: string } {
  const args: { input?: string; output?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && argv[i + 1]) {
      args.input = argv[++i];
    } else if (argv[i] === "--output" && argv[i + 1]) {
      args.output = argv[++i];
    }
  }
  return args;
}

function loadCases(input?: string): BatchCase[] {
  if (!input) {
    return DEFAULT_CASES;
  }
  const raw = JSON.parse(readFileSync(input, "utf-8"));
  if (!Array.isArray(raw)) {
    throw new Error("Input file must contain a JSON array of cases");
  }
  return raw.map((entry, index) => ({
    label: entry.label ?? `case-${index}`,
    position: entry.position,
    height: entry.height,
    dragonAngle: entry.dragonAngle,
  }));
}

function run(cases: BatchCase[]): BatchResult[] {
  return cases.map((batchCase) => {
    const first = analyzeFengshui(batchCase);
    const second = analyzeFengshui(batchCase);
    return {
      label: batchCase.label,
      analysis: first,
      deterministic: JSON.stringify(first) === JSON.stringify(second),
    };
  });
}

const { input, output } = parseArgs(process.argv.slice(2));
const results = run(loadCases(input));
const payload = JSON.stringify(results, null, 2);

if (output) {
  writeFileSync(output, payload + "\n");
  console.log(`Wrote ${results.length} results to ${output}`);
} else {
  console.log(payload);
}

const drifted = results.filter((r) => !r.deterministic);
if (drifted.length > 0) {
  console.error(
    `Non-deterministic results detected: ${drifted.map((r) => r.label).join(", ")}`
  );
  process.exit(1);
}
