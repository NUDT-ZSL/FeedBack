/**
 * 离线复算入口（无需浏览器 / WebGL）：
 *
 *   npm run replay                          # 跑内置演示场景
 *   npm run replay -- scenarios/a.json ...  # 批量复算一个或多个场景文件
 *
 * 场景 JSON 格式：
 *   {
 *     "config": {                            // 可选，缺省用内置关卡配置
 *       "fireColumns": [{ "interval": 2 }],
 *       "elevators": [{ "baseY": 0, "minHeight": -1, "maxHeight": 1.5, "speed": 0.8 }]
 *     },
 *     "ticks": 600,                          // 推演多少个固定步
 *     "dt": 0.016666,                        // 可选，缺省 1/60
 *     "events": [{ "tick": 120, "type": "fire", "id": 0 }, ...]
 *   }
 *
 * 实时运行时可在浏览器控制台执行
 *   copy(JSON.stringify({ config: ..., ticks: __sim.tick, events: __sim.eventLog }))
 * 导出事件日志后存为 JSON，用本脚本复算比对。
 */
import { readFileSync } from 'node:fs';
import {
  runScenario,
  SimConfig,
  SimEvent,
  SimSnapshot,
  FIXED_DT
} from '../src/simulation';

interface ScenarioFile {
  config?: SimConfig;
  ticks: number;
  dt?: number;
  events: SimEvent[];
}

const defaultConfig: SimConfig = {
  fireColumns: [{ interval: 2 }, { interval: 2.5 }, { interval: 1.8 }],
  elevators: [{ baseY: 0, minHeight: -1, maxHeight: 1.5, speed: 0.8 }]
};

const demoScenario: ScenarioFile = {
  ticks: 400,
  events: [
    { tick: 5, type: 'star', id: 0 },
    { tick: 5, type: 'star', id: 0 },
    { tick: 30, type: 'surface', surface: 'sand' },
    { tick: 60, type: 'hammer', id: 0, dirX: 1, dirZ: 0.5 },
    { tick: 120, type: 'fire', id: 0 },
    { tick: 120, type: 'fire', id: 0 },
    { tick: 121, type: 'fire', id: 0 },
    { tick: 150, type: 'star', id: 1 },
    { tick: 200, type: 'star', id: 2 },
    { tick: 240, type: 'fire', id: 0 },
    { tick: 300, type: 'goal', hiddenPath: true }
  ]
};

function stateChanged(prev: SimSnapshot | undefined, next: SimSnapshot): boolean {
  if (!prev) return true;
  return (
    prev.lives !== next.lives ||
    prev.score !== next.score ||
    prev.stars.length !== next.stars.length ||
    prev.gateOpen !== next.gateOpen ||
    prev.won !== next.won ||
    prev.gameOver !== next.gameOver ||
    prev.burning !== next.burning ||
    prev.currentSurface !== next.currentSurface ||
    prev.fires.some((f, i) => f.active !== next.fires[i].active) ||
    prev.elevators.some((e, i) => e.direction !== next.elevators[i].direction)
  );
}

function replay(name: string, scenario: ScenarioFile): void {
  const config = scenario.config ?? defaultConfig;
  const dt = scenario.dt ?? FIXED_DT;
  const snapshots = runScenario(config, scenario.events, scenario.ticks, dt);

  console.log(`\n=== ${name} (ticks=${scenario.ticks}, dt=${dt.toFixed(6)}) ===`);
  console.log('tick  | lives | score | stars | fire        | elevator(y,dir)     | flags');
  console.log('------+-------+-------+-------+-------------+---------------------+--------');

  let prev: SimSnapshot | undefined;
  for (const snap of snapshots) {
    if (!stateChanged(prev, snap)) continue;
    const fires = snap.fires.map((f) => (f.active ? 'ON ' : 'off')).join(' ');
    const elevators = snap.elevators
      .map((e) => `${e.y.toFixed(3)},${e.direction > 0 ? 'up' : 'dn'}`)
      .join(' ');
    const flags = [
      snap.burning ? 'burning' : '',
      snap.gateOpen ? 'gate-open' : '',
      snap.won ? (snap.wonViaHiddenPath ? 'won(hidden)' : 'won') : '',
      snap.gameOver ? 'game-over' : ''
    ]
      .filter(Boolean)
      .join(' ');
    console.log(
      `${String(snap.tick).padStart(5)} | ${String(snap.lives).padStart(5)} | ` +
        `${String(snap.score).padStart(5)} | ${String(snap.stars.length).padStart(5)} | ` +
        `${fires.padEnd(11)} | ${elevators.padEnd(19)} | ${flags}`
    );
    prev = snap;
  }

  const final = snapshots[snapshots.length - 1];
  console.log(
    `final: lives=${final.lives} score=${final.score} stars=[${final.stars}] ` +
      `gateOpen=${final.gateOpen} won=${final.won} gameOver=${final.gameOver}`
  );
}

const files = process.argv.slice(2);
if (files.length === 0) {
  replay('demo', demoScenario);
} else {
  for (const file of files) {
    replay(file, JSON.parse(readFileSync(file, 'utf-8')) as ScenarioFile);
  }
}
