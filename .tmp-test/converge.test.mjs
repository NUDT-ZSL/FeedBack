import * as THREE from 'three';

// --- fake clock / timers / rAF ---
let now = 0;
let nextTimeoutId = 1;
const timeouts = new Map();
let rafQueue = [];
let nextRafId = 1;

globalThis.window = {
  setTimeout: (cb, ms) => {
    const id = nextTimeoutId++;
    timeouts.set(id, { cb, at: now + ms });
    return id;
  }
};
globalThis.clearTimeout = (id) => { timeouts.delete(id); };
globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return nextRafId++; };
globalThis.cancelAnimationFrame = () => {};
globalThis.performance = { now: () => now };

function advance(ms) {
  const end = now + ms;
  while (now < end) {
    now = Math.min(now + 16, end);
    const q = rafQueue; rafQueue = [];
    for (const cb of q) cb(now);
    for (const [id, t] of [...timeouts]) {
      if (t.at <= now) { timeouts.delete(id); t.cb(); }
    }
  }
}

const { CityBuilder } = await import('./cityBuilder.mjs');

const themes = {
  sunset: ['#ff6b35', '#f7c59f', '#ef476f', '#9b5de5', '#7209b7', '#f72585'],
  cyberpunk: ['#00f5d4', '#00bbf9', '#9b5de5', '#f15bb5', '#fee440', '#00ff88'],
  nordic: ['#f8f9fa', '#e9ecef', '#dee2e6', '#adb5bd', '#6c757d', '#a8dadc']
};

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log(`PASS  ${name}`); }
  else { failures++; console.log(`FAIL  ${name} ${extra}`); }
}

const scene = new THREE.Scene();
const city = new CityBuilder(scene, { gridSize: 10, density: 0.7 });

function sceneConsistency() {
  const buildings = city.getBuildings();
  const expectedChildren = buildings.length * 2 + 2; // mesh+glow per building, ground+grid
  return scene.children.length === expectedChildren;
}
function targetCount(d) { return Math.floor(100 * d); }

// 1. initial generate
city.generateCity();
advance(6000);
check('initial count = 70', city.getBuildings().length === 70, `got ${city.getBuildings().length}`);
check('initial scene consistent', sceneConsistency(), `children=${scene.children.length}`);

// 2. density up then settle
city.updateParams({ density: 0.9 });
advance(6000);
check('density 0.9 -> 90', city.getBuildings().length === 90, `got ${city.getBuildings().length}`);

// 3. rapid toggling without settling (the reported bug)
city.updateParams({ density: 0.7 });
advance(120);
city.updateParams({ density: 0.9 });
advance(80);
city.updateParams({ density: 0.7 });
advance(60);
city.updateParams({ density: 0.9 });
advance(40);
city.updateParams({ density: 0.7 });
advance(8000);
check('rapid toggle converges to 70', city.getBuildings().length === 70, `got ${city.getBuildings().length}`);
check('scene consistent after toggles', sceneConsistency(), `children=${scene.children.length}`);

// 4. extreme densities
city.updateParams({ density: 1.0 });
advance(8000);
check('density 1.0 -> 100', city.getBuildings().length === 100, `got ${city.getBuildings().length}`);
city.updateParams({ density: 0.2 });
advance(8000);
check('density 0.2 -> 20', city.getBuildings().length === 20, `got ${city.getBuildings().length}`);
check('scene consistent after extremes', sceneConsistency(), `children=${scene.children.length}`);

// 5. height distribution recompute for ALL buildings
city.updateParams({ density: 0.7 });
advance(8000);
const before = city.getBuildings().map(b => b.height);
city.updateParams({ heightDistribution: 'uniform' });
advance(3000);
const after = city.getBuildings();
const changed = after.filter((b, i) => Math.abs(b.height - before[i]) > 0.001).length;
check('heights recomputed for all buildings', changed >= after.length * 0.9, `changed=${changed}/${after.length}`);
check('morph settled (scale=1, geometry matches)',
  after.every(b => Math.abs(b.mesh.scale.y - 1) < 1e-6 &&
    Math.abs(b.mesh.geometry.parameters.height - b.height) < 1e-6 &&
    Math.abs(b.mesh.position.y - b.height / 2) < 1e-6));

// 6. color theme transition converges to new palette
city.updateParams({ colorTheme: 'cyberpunk' });
advance(3000);
const hexes = city.getBuildings().map(b => '#' + b.color.getHexString());
check('all colors in cyberpunk palette', hexes.every(h => themes.cyberpunk.includes(h)),
  hexes.filter(h => !themes.cyberpunk.includes(h)).slice(0, 3).join(','));
// switch again mid-transition
city.updateParams({ colorTheme: 'nordic' });
advance(200);
city.updateParams({ colorTheme: 'sunset' });
advance(3000);
const hexes2 = city.getBuildings().map(b => '#' + b.color.getHexString());
check('overlapping theme switches converge to sunset', hexes2.every(h => themes.sunset.includes(h)),
  hexes2.filter(h => !themes.sunset.includes(h)).slice(0, 3).join(','));

// 7. rapid regenerate clicks
city.generateCity();
advance(120);
city.generateCity();
advance(80);
city.generateCity();
advance(50);
city.generateCity();
advance(8000);
check('rapid regenerate -> 70', city.getBuildings().length === 70, `got ${city.getBuildings().length}`);
check('no orphan meshes after rapid regenerate', sceneConsistency(), `children=${scene.children.length}`);

// 8. spacing change repositions in place (no clear)
const idsBefore = new Set(city.getBuildings().map(b => b.id));
city.updateParams({ buildingSpacing: 4.0 });
advance(500);
const bs = city.getBuildings();
check('spacing keeps same buildings', bs.length === 70 && bs.every(b => idsBefore.has(b.id)));
const offset = 9 * 4.0 / 2;
check('positions match new spacing', bs.every(b =>
  Math.abs(b.mesh.position.x - (b.gridX * 4.0 - offset)) < 1e-6 &&
  Math.abs(b.mesh.position.z - (b.gridZ * 4.0 - offset)) < 1e-6));
check('ground rebuilt exactly once', scene.children.filter(o => o.name === 'ground').length === 1 &&
  scene.children.filter(o => o.name === 'groundPlane').length === 1);

// 9. selected building removal is observable (panel logic relies on this)
city.updateParams({ density: 0.3 });
advance(200);
const falling = city.getBuildings().filter(b => b.animationType === 'fall');
check('removals marked as falling immediately', falling.length > 0, `falling=${falling.length}`);
advance(8000);
check('density 0.3 -> 30', city.getBuildings().length === 30, `got ${city.getBuildings().length}`);
check('final scene consistent', sceneConsistency(), `children=${scene.children.length}`);

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
