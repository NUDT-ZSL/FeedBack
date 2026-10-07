import { angleTo24Mountain, generateFengshuiCommentary } from "../src/fengshui";
import {
  legacyAngleTo24Mountain,
  legacyGenerateFengshuiCommentary,
} from "./legacyReference";
import { DEFAULT_CASES } from "./defaultCases";

let failures = 0;
let checks = 0;

function checkAngle(angle: number): void {
  checks++;
  const next = angleTo24Mountain(angle);
  const prev = legacyAngleTo24Mountain(angle);
  if (next.mountain !== prev.mountain || next.direction !== prev.direction) {
    failures++;
    console.error(
      `MISMATCH angle=${angle}: new=${next.mountain}/${next.direction} legacy=${prev.mountain}/${prev.direction}`
    );
  }
}

function checkCommentary(
  position: { x: number; y: number; z: number },
  height: number,
  dragonAngle: number
): void {
  checks++;
  const next = generateFengshuiCommentary(position, height, dragonAngle);
  const prev = legacyGenerateFengshuiCommentary(position, height, dragonAngle);
  if (next !== prev) {
    failures++;
    console.error(
      `MISMATCH commentary pos=${JSON.stringify(position)} h=${height} a=${dragonAngle}:\n  new=${next}\n  legacy=${prev}`
    );
  }
}

for (const batchCase of DEFAULT_CASES) {
  checkAngle(batchCase.dragonAngle);
  checkCommentary(batchCase.position, batchCase.height, batchCase.dragonAngle);
}

let fuzzState = 123456789;
function nextRandom(): number {
  fuzzState = (fuzzState * 1103515245 + 12345) & 0x7fffffff;
  return fuzzState / 0x7fffffff;
}

for (let i = 0; i < 20000; i++) {
  const angle = (nextRandom() - 0.5) * 4e6;
  const height = (nextRandom() - 0.5) * 400 + (i % 7 === 0 ? 100 : 0);
  const position = {
    x: (nextRandom() - 0.5) * 2e6,
    y: (nextRandom() - 0.5) * 100,
    z: (nextRandom() - 0.5) * 2e6,
  };
  checkAngle(angle);
  checkCommentary(position, height, angle);
}

console.log(`Parity check: ${checks} comparisons, ${failures} mismatches`);
if (failures > 0) {
  process.exit(1);
}
