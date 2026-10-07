// 链路环节 4：reset 后参数回初始值、当前预设清空、告警归零；
// dispose 后原有回调不再被触发。
import { INITIAL_PARAMS } from './helpers/env.mjs';
import { assert, assertEqual, assertDeepEqual } from './helpers/assert.mjs';

export default [
  {
    name: 'reset 后参数回初始值、预设清空、告警与定时器归零',
    fn({ controller, timers, events, dom }) {
      controller.loadPreset('铁观音');
      controller.setWaterTemp(80);
      controller.setBrewDuration(10);
      assertEqual(controller.getActiveWarnings().length, 2, '前置条件：两个参数告警激活');
      timers.advance(1000);

      controller.reset();

      assertDeepEqual(controller.getParams(), INITIAL_PARAMS, '参数应回到初始值');
      assertEqual(controller.getCurrentPreset(), null, '当前预设应清空');
      assertDeepEqual(
        controller.validateParams(),
        { temp: true, angle: true, duration: true },
        '无预设时校验应全部通过'
      );
      assertEqual(controller.getActiveWarnings().length, 0, '告警状态应归零');
      assertEqual(timers.pendingCount(), 0, '所有告警定时器应被清理');
      assertDeepEqual(
        events.params[events.params.length - 1],
        INITIAL_PARAMS,
        '参数回调应携带初始值'
      );
      assertEqual(
        events.preset[events.preset.length - 1],
        null,
        '预设回调应携带 null'
      );
      const stopEvents = events.warning.filter(e => e.active === false);
      assertDeepEqual(
        stopEvents.map(e => e.paramKey).sort(),
        ['brewDuration', 'waterTemp'],
        '两个激活的告警都应发出停止事件'
      );
      for (const key of ['waterTemp', 'brewDuration']) {
        assertEqual(
          dom.element(key).classList.contains('warning-flash'),
          false,
          `${key} 闪烁样式应被移除`
        );
      }

      const toggles = {
        waterTemp: dom.element('waterTemp').stats.toggleCount,
        brewDuration: dom.element('brewDuration').stats.toggleCount,
      };
      timers.advance(10000);
      assertEqual(
        dom.element('waterTemp').stats.toggleCount,
        toggles.waterTemp,
        'reset 后水温不应再闪烁'
      );
      assertEqual(
        dom.element('brewDuration').stats.toggleCount,
        toggles.brewDuration,
        'reset 后时长不应再闪烁'
      );
    },
  },
  {
    name: '无预设状态下 reset 同样发出初始参数与空预设事件',
    fn({ controller, events }) {
      controller.reset();
      assertEqual(events.params.length, 1, '应触发一次参数回调');
      assertDeepEqual(events.params[0], INITIAL_PARAMS, '回调参数应为初始值');
      assertDeepEqual(events.preset, [null], '预设回调应为 null');
    },
  },
  {
    name: 'dispose 后任何操作都不再触发原有回调或告警定时器',
    fn({ controller, timers, events, dom }) {
      controller.loadPreset('普洱');
      controller.dispose();

      const counts = {
        params: events.params.length,
        preset: events.preset.length,
        warning: events.warning.length,
      };
      const toggles = {
        waterTemp: dom.element('waterTemp').stats.toggleCount,
        pourAngle: dom.element('pourAngle').stats.toggleCount,
        brewDuration: dom.element('brewDuration').stats.toggleCount,
      };

      controller.setWaterTemp(10);
      controller.setPourAngle(5);
      controller.setBrewDuration(1);
      controller.loadPreset('龙井');
      controller.setWaterTemp(10);
      controller.reset();
      timers.advance(10000);

      assertEqual(events.params.length, counts.params, '参数回调不应再被触发');
      assertEqual(events.preset.length, counts.preset, '预设回调不应再被触发');
      assertEqual(events.warning.length, counts.warning, '告警回调不应再被触发');
      assertEqual(controller.getActiveWarnings().length, 0, '不应出现新告警状态');
      assertEqual(timers.pendingCount(), 0, '不应产生新的告警定时器');
      for (const key of Object.keys(toggles)) {
        assertEqual(
          dom.element(key).stats.toggleCount,
          toggles[key],
          `${key} 不应再发生闪烁`
        );
      }
    },
  },
];
