// 链路环节 1：预设加载 —— 参数落在推荐区间内、当前预设被正确记录、无告警残留。
import { TEA_PRESETS } from '../src/TeaController.ts';
import { INITIAL_PARAMS } from './helpers/env.mjs';
import { assert, assertEqual, assertDeepEqual } from './helpers/assert.mjs';

export default [
  {
    name: '每个预设加载后参数落在推荐区间且当前预设被记录',
    fn({ controller }) {
      for (const preset of TEA_PRESETS) {
        controller.loadPreset(preset.name);

        const current = controller.getCurrentPreset();
        assertEqual(current && current.name, preset.name, `${preset.name} 应被记录为当前预设`);

        const params = controller.getParams();
        assert(
          params.waterTemp >= preset.recommendedTemp[0] &&
            params.waterTemp <= preset.recommendedTemp[1],
          `${preset.name} 水温 ${params.waterTemp} 应在 ${preset.recommendedTemp} 内`
        );
        assert(
          params.pourAngle >= preset.recommendedAngle[0] &&
            params.pourAngle <= preset.recommendedAngle[1],
          `${preset.name} 注水角度 ${params.pourAngle} 应在 ${preset.recommendedAngle} 内`
        );
        assert(
          params.brewDuration >= preset.recommendedDuration[0] &&
            params.brewDuration <= preset.recommendedDuration[1],
          `${preset.name} 冲泡时长 ${params.brewDuration} 应在 ${preset.recommendedDuration} 内`
        );

        assertDeepEqual(
          controller.validateParams(),
          { temp: true, angle: true, duration: true },
          `${preset.name} 加载后校验应全部通过`
        );
        assertEqual(
          controller.getActiveWarnings().length,
          0,
          `${preset.name} 加载后不应存在告警`
        );
      }
    },
  },
  {
    name: '加载预设时回调事件与内部状态一致',
    fn({ controller, events }) {
      controller.loadPreset('龙井');

      assertEqual(events.preset.length, 1, '应触发一次预设变更回调');
      assertEqual(events.preset[0] && events.preset[0].name, '龙井', '预设回调应携带龙井');
      assertEqual(events.params.length, 3, '三个参数各触发一次参数变更回调');
      assertDeepEqual(
        events.params[events.params.length - 1],
        controller.getParams(),
        '最后一次参数回调应与当前参数一致'
      );
    },
  },
  {
    name: '未知预设名不改变任何状态',
    fn({ controller, events }) {
      controller.loadPreset('不存在的茶');

      assertEqual(controller.getCurrentPreset(), null, '当前预设应保持为空');
      assertDeepEqual(controller.getParams(), INITIAL_PARAMS, '参数应保持初始值');
      assertEqual(events.preset.length, 0, '不应触发预设回调');
      assertEqual(events.params.length, 0, '不应触发参数回调');
      assertEqual(events.warning.length, 0, '不应触发告警回调');
    },
  },
];
