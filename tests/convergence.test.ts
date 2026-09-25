import * as THREE from 'three';
import { CityBuilder } from '../src/cityBuilder';

// Virtual clock + rAF shim so animations run deterministically in Node.
let virtualNow = 0;
let rafQueue: ((t: number) => void)[] = [];
(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => {
  rafQueue.push(cb);
  return rafQueue.length;
};
(globalThis as any).cancelAnimationFrame = () => {};
Object.defineProperty((globalThis as any).performance, 'now', {
  configurable: true,
  value: () => virtualNow
});

function step(ms: number): void {
  virtualNow += ms;
  const q = rafQueue;
  rafQueue = [];
  q.forEach(cb => cb(virtualNow));
}

function settle(builder: CityBuilder, maxMs = 30000): void {
  let t = 0;
  while (t < maxMs) {
    step(16);
    t += 16;
    const busy = builder
      .getBuildings()
      .some(b => b.scaleAnim || b.colorAnim || b.posAnim);
    if (!busy && rafQueue.length === 0) return;
  }
  throw new Error('scene did not settle');
}

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    console.log(`FAIL ${name} ${detail}`);
    failures++;
  }
}

const scene = new THREE.Scene();
const builder = new CityBuilder(scene, { gridSize: 10, density: 0.7 });

builder.generateCity();
settle(builder);
check('initial count = floor(100*0.7) = 70', builder.getBuildings().length === 70,
  `got ${builder.getBuildings().length}`);

// Rapid density toggling without settling in between.
builder.updateParams({ density: 0.9 });
builder.updateParams({ density: 0.7 });
builder.updateParams({ density: 0.9 });
builder.updateParams({ density: 0.7 });
settle(builder);
check('rapid density toggling settles at 70', builder.getBuildings().length === 70,
  `got ${builder.getBuildings().length}`);

builder.updateParams({ density: 0.9 });
settle(builder);
check('density 0.9 -> 90 buildings', builder.getBuildings().length === 90,
  `got ${builder.getBuildings().length}`);
builder.updateParams({ density: 0.7 });
settle(builder);
check('density back to 0.7 -> 70 buildings', builder.getBuildings().length === 70,
  `got ${builder.getBuildings().length}`);

for (let i = 0; i < 5; i++) {
  builder.updateParams({ density: 1.0 });
  settle(builder);
  builder.updateParams({ density: 0.7 });
  settle(builder);
}
check('after 5 up/down cycles count is 70', builder.getBuildings().length === 70,
  `got ${builder.getBuildings().length}`);
check('building ids unique', new Set(builder.getBuildings().map(b => b.id)).size === 70);

// Height distribution switch recomputes every building.
const before = new Map(builder.getBuildings().map(b => [b.id, b.height]));
builder.updateParams({ heightDistribution: 'uniform' });
settle(builder);
const changed = builder.getBuildings()
  .filter(b => Math.abs(b.height - (before.get(b.id) ?? 0)) > 1e-6).length;
check('heights recomputed on distribution switch', changed >= 65, `changed=${changed}/70`);

builder.updateParams({ heightDistribution: 'pyramid' });
settle(builder);
const all = builder.getBuildings();
const corners = all.filter(b => (b.gridX === 0 || b.gridX === 9) && (b.gridZ === 0 || b.gridZ === 9));
check('pyramid: corner heights bounded', corners.every(b => b.height <= 18.6),
  JSON.stringify(corners.map(b => b.height)));
const inner = all.filter(b => Math.hypot(b.gridX - 4.5, b.gridZ - 4.5) < 2).map(b => b.height);
const outer = all.filter(b => Math.hypot(b.gridX - 4.5, b.gridZ - 4.5) > 5).map(b => b.height);
const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
check('pyramid: center taller than edge', avg(inner) > avg(outer),
  `inner=${avg(inner).toFixed(1)} outer=${avg(outer).toFixed(1)}`);

// Color theme switch recolors every building.
const cyberpunk = ['#00f5d4', '#00bbf9', '#9b5de5', '#f15bb5', '#fee440', '#00ff88'];
builder.updateParams({ colorTheme: 'cyberpunk' });
settle(builder);
check('all colors from cyberpunk theme',
  all.every(b => cyberpunk.includes('#' + b.color.getHexString())));

builder.updateParams({ colorTheme: 'nordic' });
builder.updateParams({ colorTheme: 'sunset' });
builder.updateParams({ colorTheme: 'cyberpunk' });
settle(builder);
check('rapid theme switching converges to last theme',
  builder.getBuildings().every(b => cyberpunk.includes('#' + b.color.getHexString())));

// Spacing change keeps buildings and repositions them.
builder.updateParams({ buildingSpacing: 4.0 });
settle(builder);
check('count preserved on spacing change', builder.getBuildings().length === 70,
  `got ${builder.getBuildings().length}`);
const sample = builder.getBuildings()[0];
const expectedX = sample.gridX * 4.0 - 18;
check('positions updated to new spacing', Math.abs(sample.mesh.position.x - expectedX) < 1e-6,
  `x=${sample.mesh.position.x} expected=${expectedX}`);
const groundPlane = scene.getObjectByName('groundPlane') as THREE.Mesh;
check('ground resized for new spacing',
  (groundPlane.geometry as THREE.PlaneGeometry).parameters.width === 50);

// Removal notifications (selection panel auto-hide path).
let removedCount = 0;
builder.onBuildingRemoved = () => { removedCount++; };
builder.updateParams({ density: 0.5 });
settle(builder);
check('density 0.5 -> 50 buildings', builder.getBuildings().length === 50,
  `got ${builder.getBuildings().length}`);
check('removal callback fired 20 times', removedCount === 20, `got ${removedCount}`);

// Rapid regenerate clicks.
builder.updateParams({ density: 0.7 });
settle(builder);
for (let i = 0; i < 5; i++) builder.generateCity();
settle(builder);
check('rapid regenerate converges to 70', builder.getBuildings().length === 70,
  `got ${builder.getBuildings().length}`);
check('ids unique after rapid regenerate',
  new Set(builder.getBuildings().map(b => b.id)).size === 70);

removedCount = 0;
builder.generateCity();
check('regenerate notifies removal of all 70 old buildings', removedCount === 70,
  `got ${removedCount}`);
settle(builder);
check('count 70 after regenerate', builder.getBuildings().length === 70,
  `got ${builder.getBuildings().length}`);

console.log(failures === 0 ? 'ALL TESTS PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
