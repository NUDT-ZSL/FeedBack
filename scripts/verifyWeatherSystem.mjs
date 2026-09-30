import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const checks = [];

function test(name, run) {
  checks.push({ name, run });
}

test('同一小时重复设置时数据引用和通知保持稳定', async ({ system }) => {
  const initialData = system.getSnapshot().data;
  system.setHour(12);
  const dataAtTwelve = system.getSnapshot().data;
  let notifications = 0;
  const unsubscribe = system.subscribe(() => {
    notifications += 1;
  });

  for (let i = 0; i < 20; i += 1) {
    system.setHour(12);
  }

  assert.equal(system.getCurrentHour(), 12);
  assert.equal(system.getSnapshot().data, dataAtTwelve);
  assert.equal(notifications, 0);

  system.setHour(0);
  assert.equal(system.getSnapshot().data, initialData);
  unsubscribe();
});

test('时间轴范围保持 0-72，切换时只选择既有小时快照', async ({ system }) => {
  system.setHour(-8);
  assert.equal(system.getCurrentHour(), 0);

  system.setHour(91);
  assert.equal(system.getCurrentHour(), 72);

  system.setHour(31.6);
  assert.equal(system.getCurrentHour(), 32);
});

test('筛选开关独立生效，透明度与面板状态共用同一结果', async ({ system }) => {
  system.setHour(20);
  system.updateFilters({
    showTemperature: true,
    showPressure: true,
    showHumidity: true,
  });

  const cases = [
    {
      panelFilters: { showTemperature: false, showPressure: false, showHumidity: false },
      opacity: 0.1,
    },
    {
      panelFilters: { showTemperature: true, showPressure: false, showHumidity: false },
      opacity: 0.2 + (1 / 3) * 0.65,
    },
    {
      panelFilters: { showTemperature: true, showPressure: true, showHumidity: false },
      opacity: 0.2 + (2 / 3) * 0.65,
    },
    {
      panelFilters: { showTemperature: true, showPressure: true, showHumidity: true },
      opacity: 0.85,
    },
  ];

  for (const { panelFilters, opacity } of cases) {
    for (const [key, enabled] of Object.entries(panelFilters)) {
      system.updateFilters({ [key]: enabled });
      assert.equal(system.getFilters()[key], enabled, `面板筛选 ${key} 未同步`);
    }

    const activeCount = Object.values(panelFilters).filter(Boolean).length;
    assert.equal(Object.values(system.getFilters()).filter(Boolean).length, activeCount);

    for (const point of system.getData()) {
      const appearance = system.getParticleAppearance(point);
      assert.ok(typeof appearance.color === 'string');
      assert.ok(appearance.size > 0);
      assert.equal(appearance.opacity, opacity);
      assert.equal(system.getParticleOpacity(), opacity);
    }
  }
});

test('快速连续切换小时时每次通知的数据都属于显示小时', async ({ system }) => {
  const dataByHour = new Map();
  const emitted = [];

  for (let hour = 0; hour <= 72; hour += 1) {
    system.setHour(hour);
    dataByHour.set(hour, system.getSnapshot().data);
  }

  const unsubscribe = system.subscribe(() => {
    emitted.push(system.getSnapshot());
  });

  const sequence = [72, 3, 41, 0, 60, 11, 37, 72, 1, 18, 54, 9, 63, 24, 30];
  for (let round = 0; round < 80; round += 1) {
    for (const hour of sequence) {
      system.setHour(hour);
      const snapshot = system.getSnapshot();
      assert.equal(snapshot.currentHour, hour);
      assert.equal(snapshot.data, dataByHour.get(hour));
    }
  }

  for (const snapshot of emitted) {
    assert.equal(snapshot.data, dataByHour.get(snapshot.currentHour));
  }

  unsubscribe();
});

test('地球自转开关的快照同步，重复设置不产生多余通知', async ({ system }) => {
  system.toggleRotation(false);
  let notifications = 0;
  const unsubscribe = system.subscribe(() => {
    notifications += 1;
  });

  system.toggleRotation(true);
  assert.equal(system.getIsRotating(), true);
  assert.equal(system.getSnapshot().isRotating, true);
  system.toggleRotation(true);

  system.toggleRotation(false);
  assert.equal(system.getIsRotating(), false);
  assert.equal(system.getSnapshot().isRotating, false);
  system.toggleRotation(false);

  assert.equal(notifications, 2);
  unsubscribe();
});

test('悬停点按编号重新取数，弹窗始终读取当前小时快照', async ({ system }) => {
  for (const hour of [7, 31, 72]) {
    system.setHour(hour);
    const hoveredPoint = system.getPointById(0);
    assert.ok(hoveredPoint);
    assert.equal(hoveredPoint, system.getData()[0]);
  }
});

const vite = await createServer({
  configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const { weatherSystem } = await vite.ssrLoadModule('/src/engine/useWeatherSystem.ts');

  for (const { name, run } of checks) {
    process.stdout.write(`✓ ${name}\n`);
    await run({ system: weatherSystem });
  }

  process.stdout.write(`\n${checks.length} 项离线验证全部通过。\n`);
} finally {
  await vite.close();
}
