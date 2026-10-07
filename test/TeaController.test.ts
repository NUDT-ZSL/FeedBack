import { test, beforeEach, afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TeaController,
  TEA_PRESETS,
  type TeaParams
} from '../src/TeaController.ts';
import { installTeaEnv, type TeaTestEnv } from './helpers/teaEnv.ts';

let env: TeaTestEnv;
let controller: TeaController;

const INITIAL_PARAMS: TeaParams = {
  waterTemp: 85,
  pourAngle: 45,
  brewDuration: 30
};

const FLASH_INTERVAL_MS = 500;
const MAX_FLASHES = 6;
// 第 6 次闪烁后定时器在下一个间隔自检并清除，完整周期需 +1 个间隔
const FULL_FLASH_CYCLE_MS = FLASH_INTERVAL_MS * (MAX_FLASHES + 1);

beforeEach(() => {
  env = installTeaEnv();
  controller = new TeaController();
});

afterEach(() => {
  controller.dispose();
  env.restore();
});

describe('预设加载', () => {
  test('所有预设加载后参数落在推荐区间内且当前预设被记录', () => {
    for (const preset of TEA_PRESETS) {
      const paramsEvents: TeaParams[] = [];
      const presetEvents: (string | null)[] = [];
      controller.onParamsChange(params => paramsEvents.push(params));
      controller.onPresetChange(p => presetEvents.push(p?.name ?? null));

      controller.loadPreset(preset.name);

      const params = controller.getParams();
      assert.ok(
        params.waterTemp >= preset.recommendedTemp[0] &&
          params.waterTemp <= preset.recommendedTemp[1],
        `${preset.name}: 水温 ${params.waterTemp} 不在 ${preset.recommendedTemp}`
      );
      assert.ok(
        params.pourAngle >= preset.recommendedAngle[0] &&
          params.pourAngle <= preset.recommendedAngle[1],
        `${preset.name}: 角度 ${params.pourAngle} 不在 ${preset.recommendedAngle}`
      );
      assert.ok(
        params.brewDuration >= preset.recommendedDuration[0] &&
          params.brewDuration <= preset.recommendedDuration[1],
        `${preset.name}: 时长 ${params.brewDuration} 不在 ${preset.recommendedDuration}`
      );

      assert.equal(controller.getCurrentPreset()?.name, preset.name);
      assert.deepEqual(controller.validateParams(), {
        temp: true,
        angle: true,
        duration: true
      });
      assert.ok(paramsEvents.length > 0, '应通知参数变化');
      assert.deepEqual(presetEvents, [preset.name], '当前预设应通过回调记录');
      assert.equal(env.clock.pendingCount, 0, '合规参数不应留下告警定时器');
    }
  });

  test('加载未知预设名时状态不变', () => {
    controller.loadPreset('不存在的茶');
    assert.equal(controller.getCurrentPreset(), null);
    assert.deepEqual(controller.getParams(), INITIAL_PARAMS);
  });
});

describe('参数校验与告警', () => {
  beforeEach(() => {
    controller.loadPreset('龙井');
  });

  test('三个参数各自越界时校验结果与告警一一对应，调回后告警停止', () => {
    const cases = [
      { key: 'waterTemp' as const, outOfRange: 50, backInRange: 80, resultKey: 'temp' as const },
      { key: 'pourAngle' as const, outOfRange: 80, backInRange: 40, resultKey: 'angle' as const },
      { key: 'brewDuration' as const, outOfRange: 60, backInRange: 15, resultKey: 'duration' as const }
    ];

    for (const testCase of cases) {
      const element = env.elementFor(testCase.key);

      controller[
        testCase.key === 'waterTemp'
          ? 'setWaterTemp'
          : testCase.key === 'pourAngle'
            ? 'setPourAngle'
            : 'setBrewDuration'
      ](testCase.outOfRange);

      assert.equal(
        controller.validateParams()[testCase.resultKey],
        false,
        `${testCase.key} 越界后校验应为 false`
      );
      assert.equal(env.clock.pendingCount, 1, `${testCase.key} 越界后应启动一个告警定时器`);

      env.clock.tick(FLASH_INTERVAL_MS);
      assert.ok(
        element.classList.contains('warning-flash'),
        `${testCase.key} 应出现闪烁 class`
      );
      assert.equal(element.toggleCount, 1, `${testCase.key} 应发生 1 次闪烁切换`);

      controller[
        testCase.key === 'waterTemp'
          ? 'setWaterTemp'
          : testCase.key === 'pourAngle'
            ? 'setPourAngle'
            : 'setBrewDuration'
      ](testCase.backInRange);

      assert.equal(
        controller.validateParams()[testCase.resultKey],
        true,
        `${testCase.key} 调回后校验应为 true`
      );
      assert.equal(env.clock.pendingCount, 0, `${testCase.key} 调回后告警定时器应清除`);
      assert.equal(
        element.classList.contains('warning-flash'),
        false,
        `${testCase.key} 调回后闪烁 class 应移除`
      );

      const togglesBefore = element.toggleCount;
      env.clock.tick(FLASH_INTERVAL_MS * MAX_FLASHES);
      assert.equal(
        element.toggleCount,
        togglesBefore,
        `${testCase.key} 告警停止后不应再有闪烁`
      );
    }
  });

  test('推荐区间边界值判定为合规', () => {
    controller.setWaterTemp(75);
    assert.equal(controller.validateParams().temp, true);
    controller.setWaterTemp(85);
    assert.equal(controller.validateParams().temp, true);
    controller.setWaterTemp(74);
    assert.equal(controller.validateParams().temp, false);
    controller.setWaterTemp(86);
    assert.equal(controller.validateParams().temp, false);
    env.clock.tick(FLASH_INTERVAL_MS * MAX_FLASHES);
  });

  test('未加载预设时手动调参不触发告警，校验默认全部通过', () => {
    const fresh = new TeaController();
    fresh.setWaterTemp(0);
    fresh.setPourAngle(90);
    fresh.setBrewDuration(180);
    assert.equal(env.clock.pendingCount, 0);
    assert.deepEqual(fresh.validateParams(), {
      temp: true,
      angle: true,
      duration: true
    });
  });

  test('无对应 DOM 元素时越界不抛错、不残留定时器', () => {
    env.document.elements.clear();
    controller.setWaterTemp(50);
    assert.equal(controller.validateParams().temp, false);
    assert.equal(env.clock.pendingCount, 0);
  });
});

describe('告警闪烁定时器（假时钟，无真实等待）', () => {
  beforeEach(() => {
    controller.loadPreset('龙井');
  });

  test('闪烁恰好重复 6 次后自动停止，之后不再触发', () => {
    const element = env.elementFor('waterTemp');

    controller.setWaterTemp(50);
    assert.equal(env.clock.pendingCount, 1);

    env.clock.tick(FLASH_INTERVAL_MS * MAX_FLASHES);
    assert.equal(element.toggleCount, MAX_FLASHES);

    env.clock.tick(FLASH_INTERVAL_MS);
    assert.equal(element.toggleCount, MAX_FLASHES);
    assert.equal(env.clock.pendingCount, 0, '闪烁结束后定时器应自动清除');

    env.clock.tick(FLASH_INTERVAL_MS * 10);
    assert.equal(element.toggleCount, MAX_FLASHES, '结束后不应继续闪烁');
  });

  test('重复越界可重新触发完整的闪烁周期', () => {
    const element = env.elementFor('waterTemp');

    controller.setWaterTemp(50);
    env.clock.tick(FULL_FLASH_CYCLE_MS);
    assert.equal(element.toggleCount, MAX_FLASHES);
    assert.equal(env.clock.pendingCount, 0);

    controller.setWaterTemp(49);
    assert.equal(env.clock.pendingCount, 1, '重新越界应启动新定时器');
    env.clock.tick(FULL_FLASH_CYCLE_MS);
    assert.equal(element.toggleCount, MAX_FLASHES * 2);
    assert.equal(env.clock.pendingCount, 0);
  });

  test('同一参数连续越界会重置定时器而非叠加', () => {
    const element = env.elementFor('waterTemp');

    controller.setWaterTemp(50);
    env.clock.tick(FLASH_INTERVAL_MS);
    controller.setWaterTemp(49);
    controller.setWaterTemp(48);

    assert.equal(env.clock.pendingCount, 1, '多次越界只保留一个告警定时器');
    const togglesBefore = element.toggleCount;
    env.clock.tick(FULL_FLASH_CYCLE_MS);
    assert.equal(element.toggleCount, togglesBefore + MAX_FLASHES);
    assert.equal(env.clock.pendingCount, 0);
  });

  test('一个参数调回区间不影响另一个参数的告警', () => {
    const tempElement = env.elementFor('waterTemp');
    const angleElement = env.elementFor('pourAngle');

    controller.setWaterTemp(50);
    controller.setPourAngle(80);
    assert.equal(env.clock.pendingCount, 2);

    controller.setWaterTemp(80);
    assert.equal(env.clock.pendingCount, 1);
    assert.equal(tempElement.classList.contains('warning-flash'), false);

    env.clock.tick(FLASH_INTERVAL_MS);
    assert.equal(angleElement.classList.contains('warning-flash'), true);
    assert.equal(tempElement.classList.contains('warning-flash'), false);

    env.clock.tick(FULL_FLASH_CYCLE_MS);
  });
});

describe('连续切换预设', () => {
  test('多预设切换后手动调参，参数/当前预设/校验结果一致且无残留判定', () => {
    controller.loadPreset('龙井');
    controller.setWaterTemp(50);
    assert.equal(env.clock.pendingCount, 1, '前置：龙井越界告警已启动');

    controller.loadPreset('铁观音');
    controller.loadPreset('普洱');

    const puEr = TEA_PRESETS.find(p => p.name === '普洱')!;
    assert.equal(controller.getCurrentPreset()?.name, '普洱');
    assert.deepEqual(controller.getParams(), {
      waterTemp: (puEr.recommendedTemp[0] + puEr.recommendedTemp[1]) / 2,
      pourAngle: (puEr.recommendedAngle[0] + puEr.recommendedAngle[1]) / 2,
      brewDuration: (puEr.recommendedDuration[0] + puEr.recommendedDuration[1]) / 2
    });
    assert.deepEqual(controller.validateParams(), {
      temp: true,
      angle: true,
      duration: true
    });
    assert.equal(env.clock.pendingCount, 0, '切换预设应清除上一预设的告警定时器');
    for (const key of ['waterTemp', 'pourAngle', 'brewDuration'] as const) {
      assert.equal(
        env.elementFor(key).classList.contains('warning-flash'),
        false,
        '切换预设不应残留闪烁状态'
      );
    }

    // 80 对龙井合规、对普洱越界：若出现上一预设残留判定会得到相反结果
    controller.setWaterTemp(80);
    assert.equal(controller.validateParams().temp, false);
    assert.equal(controller.getCurrentPreset()?.name, '普洱');
    assert.equal(env.clock.pendingCount, 1);
    assert.equal(env.elementFor('waterTemp').classList.contains('warning-flash'), false);
    env.clock.tick(FLASH_INTERVAL_MS);
    assert.equal(env.elementFor('waterTemp').classList.contains('warning-flash'), true);

    controller.setWaterTemp(97);
    assert.equal(controller.validateParams().temp, true);
    assert.equal(env.clock.pendingCount, 0);
  });

  test('快速连续切换不串台：回调始终给出最新预设', () => {
    const presetEvents: string[] = [];
    controller.onPresetChange(p => presetEvents.push(p?.name ?? 'null'));

    controller.loadPreset('龙井');
    controller.loadPreset('铁观音');
    controller.loadPreset('正山小种');

    assert.deepEqual(presetEvents, ['龙井', '铁观音', '正山小种']);
    assert.equal(controller.getCurrentPreset()?.name, '正山小种');
  });
});

describe('reset 与 dispose', () => {
  test('reset 后参数回初值、预设清空、告警状态归零', () => {
    controller.loadPreset('龙井');
    controller.setWaterTemp(50);
    controller.setPourAngle(80);
    env.clock.tick(FLASH_INTERVAL_MS);
    assert.equal(env.clock.pendingCount, 2);

    const paramsEvents: TeaParams[] = [];
    const presetEvents: (string | null)[] = [];
    controller.onParamsChange(params => paramsEvents.push(params));
    controller.onPresetChange(preset => presetEvents.push(preset?.name ?? null));

    controller.reset();

    assert.deepEqual(controller.getParams(), INITIAL_PARAMS);
    assert.equal(controller.getCurrentPreset(), null);
    assert.deepEqual(presetEvents, [null], 'reset 应通知当前预设清空');
    assert.deepEqual(paramsEvents, [INITIAL_PARAMS], 'reset 应通知参数回初值');
    assert.equal(env.clock.pendingCount, 0, 'reset 应清除所有告警定时器');
    for (const key of ['waterTemp', 'pourAngle', 'brewDuration'] as const) {
      assert.equal(
        env.elementFor(key).classList.contains('warning-flash'),
        false,
        'reset 应移除所有闪烁 class'
      );
    }
    assert.deepEqual(controller.validateParams(), {
      temp: true,
      angle: true,
      duration: true
    });

    const toggles = env.elementFor('waterTemp').toggleCount;
    controller.setWaterTemp(0);
    assert.equal(env.clock.pendingCount, 0, '无预设时调参不应再产生告警');
    env.clock.tick(FLASH_INTERVAL_MS * 10);
    assert.equal(env.elementFor('waterTemp').toggleCount, toggles);
  });

  test('dispose 后原有回调不再被触发，告警定时器被清除', () => {
    controller.loadPreset('铁观音');
    controller.setBrewDuration(999);
    assert.equal(env.clock.pendingCount, 1);

    let paramsCalls = 0;
    let presetCalls = 0;
    controller.onParamsChange(() => paramsCalls++);
    controller.onPresetChange(() => presetCalls++);

    controller.dispose();
    assert.equal(env.clock.pendingCount, 0);

    controller.setWaterTemp(50);
    controller.setPourAngle(10);
    controller.setBrewDuration(5);
    controller.loadPreset('普洱');
    controller.reset();

    assert.equal(paramsCalls, 0, 'dispose 后不应再触发参数回调');
    assert.equal(presetCalls, 0, 'dispose 后不应再触发预设回调');
    assert.equal(env.clock.pendingCount, 0, 'dispose 后的操作不应再产生定时器');
    env.clock.tick(FLASH_INTERVAL_MS * 20);
  });
});
