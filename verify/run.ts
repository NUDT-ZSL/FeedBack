// Offline verification entry point: `node verify/run.ts`
// Exit code 0 = all chains green, 1 = at least one chain regressed.

import { Harness } from './harness.ts';
import { register as registerTerrain } from './cases/terrain.ts';
import { register as registerFence } from './cases/fence.ts';
import { register as registerHole } from './cases/hole.ts';
import { register as registerStrokes } from './cases/strokes.ts';
import { register as registerGolden } from './cases/golden.ts';

const h = new Harness();

registerTerrain(h);
registerFence(h);
registerHole(h);
registerStrokes(h);
registerGolden(h);

h.printReport();

if (h.failedCount > 0) {
  process.exitCode = 1;
}
