// 链路环节 2：参数校验与告警 —— 调出推荐区间后校验结果与告警状态和该参数一致，
// 调回区间内后告警停止。
import { assert, assertEqual, assertDeepEqual } from './helpers/assert.mjs';

const SETTERS = {
  waterTemp: (controller, value) => controller.setWaterTemp(value),
  pourAngle: (controller, value) => controller.setPourAngle(value),
  brewDuration: (controller, value) => controller.setBrewDuration(value),
};
const FIELDS = { waterTemp: 'temp', pourAngle: 'angle', brewDuration: 'duration' };
// 龙井推荐区间：水温 75-85，角度 30-45，时长 10-20
const CASES = [
  { key: 'waterTemp', outOfRange: 90, inRange: 80 },
  { key: 'pourAngle', outOfRange: 60, inRange: 40 },
  { key: 'brewDuration', outOfRange: 30, inRange: 15 },
];

export default [
  {
    name: '参数调出推荐区间后校验结果与告警状态跟随该参数',
    fn({ controller, events, dom, timers }) {
      for (const { key, outOfRange } of CASES) {
        controller.loadPreset('龙井');
        events.warning.length = 0;

        SETTERS[key](controller, outOfRange);

        const validation = controller.validateParams();
        const expected = { temp: true, angle: true, duration: true };
        expected[FIELDS[key]] = false;
        assertDeepEqual(validation, expected, `${key} 越界时只有对应校验项应为 false`);

        assertEqual(controller.isWarningActive(key), true, `${key} 越界应触发告警`);
        assertDeepEqual(
          controller.getActiveWarnings(),
          [key],
          `只有 ${key} 应处于告警状态`
        );
        assertDeepEqual(
          events.warning,
          [{ paramKey: key, active: true }],
          `${key} 越界应发出一次告警开启事件`
        );

        timers.advance(500);
        assertEqual(
          dom.element(key).stats.toggleCount,
          1,
          `${key} 告警应开始闪烁`
        );
      }
    },
  },
  {
    name: '参数调回区间内后校验恢复且告警停止',
    fn({ controller, events, dom, timers }) {
      for (const { key, outOfRange, inRange } of CASES) {
        controller.loadPreset('龙井');
        SETTERS[key](controller, outOfRange);
        timers.advance(1500);
        events.warning.length = 0;

        SETTERS[key](controller, inRange);

        assertDeepEqual(
          controller.validateParams(),
          { temp: true, angle: true, duration: true },
          `${key} 调回区间后校验应全部通过`
        );
        assertEqual(controller.isWarningActive(key), false, `${key} 告警应停止`);
        assertEqual(controller.getActiveWarnings().length, 0, '不应有残留告警');
        assertDeepEqual(
          events.warning,
          [{ paramKey: key, active: false }],
          `${key} 调回应发出一次告警停止事件`
        );
        assertEqual(
          dom.element(key).classList.contains('warning-flash'),
          false,
          `${key} 的闪烁样式应被移除`
        );
        assertEqual(timers.pendingCount(), 0, `${key} 的告警定时器应被清理`);

        const toggles = dom.element(key).stats.toggleCount;
        timers.advance(10000);
        assertEqual(
          dom.element(key).stats.toggleCount,
          toggles,
          `${key} 告警停止后不应再闪烁`
        );
      }
    },
  },
  {
    name: '参数越界（低于下限）同样触发校验失败与告警',
    fn({ controller }) {
      controller.loadPreset('龙井');
      controller.setWaterTemp(70);
      assertEqual(controller.validateParams().temp, false, '低于水温下限应校验失败');
      assertEqual(controller.isWarningActive('waterTemp'), true, '低于下限应触发告警');
    },
  },
  {
    name: '参数值被钳制在滑块量程内',
    fn({ controller }) {
      controller.setWaterTemp(150);
      controller.setPourAngle(-10);
      controller.setBrewDuration(999);
      assertDeepEqual(
        controller.getParams(),
        { waterTemp: 100, pourAngle: 0, brewDuration: 180 },
        '参数应被钳制到 0-100 / 0-90 / 0-180'
      );
    },
  },
];
